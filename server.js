'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('\n[flapy] DATABASE_URL is missing.');
  console.error('        Copy .env.example to .env and paste your Neon connection string.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (e) => console.error('[flapy] pg pool error:', e.message));

/* ------------------------------------------------------------------ helpers */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUMMY_HASH = bcrypt.hashSync('flapy-dummy-password', 10);

// Slowest legit pace is ~1 point per second (max pipe speed), so a score can never exceed
// elapsed seconds (+ a little slack for network lag). Stops trivial fake scores.
const SECONDS_PER_POINT = 1.0;
const SCORE_SLACK = 2;
const HARD_MAX_SCORE = 5000;

function cleanGuestName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error('[flapy] error on', req.method, req.path, '-', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  });

const publicUser = (u) => ({ id: String(u.id), name: u.display_name, guest: u.is_guest });

async function createSession(userId) {
  const token = newToken();
  await pool.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [sha256(token), userId]);
  return token;
}

async function auth(req, res, next) {
  try {
    const h = req.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token || token.length > 128) return res.status(401).json({ error: 'Please sign in again.' });
    const { rows } = await pool.query(
      `SELECT u.id, u.display_name, u.is_guest
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [sha256(token)]
    );
    if (!rows.length) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    req.user = rows[0];
    req.tokenHash = sha256(token);
    next();
  } catch (e) {
    console.error('[flapy] auth error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

async function getRankInfo(userId) {
  const { rows } = await pool.query(
    `SELECT b.best,
            1 + (SELECT COUNT(*) FROM best_scores o
                  WHERE o.best > b.best
                     OR (o.best = b.best AND (o.achieved_at < b.achieved_at
                                          OR (o.achieved_at = b.achieved_at AND o.user_id < b.user_id)))) AS rank
       FROM best_scores b WHERE b.user_id = $1`,
    [userId]
  );
  if (!rows.length) return { best: 0, rank: null };
  return { best: rows[0].best, rank: Number(rows[0].rank) };
}

/* ------------------------------------------------------------------ schema */

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(`DELETE FROM runs WHERE started_at < now() - interval '1 day'`);
}

/* ------------------------------------------------------------------ app */

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '2kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});
const gameLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a little.' },
});

/* ---- sign up: unique username + password ---- */
app.post('/api/signup', authLimiter, wrap(async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-16 characters: letters, numbers or underscore.' });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 6-72 characters.' });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (display_name, username_lower, password_hash, is_guest)
       VALUES ($1, $2, $3, FALSE) RETURNING id, display_name, is_guest`,
      [username, username.toLowerCase(), hash]
    );
    const token = await createSession(rows[0].id);
    res.status(201).json({ token, user: publicUser(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That username is taken. Try another one.' });
    throw e;
  }
}));

/* ---- sign in ---- */
app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });

  const { rows } = await pool.query(
    `SELECT id, display_name, is_guest, password_hash FROM users WHERE username_lower = $1`,
    [username.toLowerCase()]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Wrong username or password.' });

  const token = await createSession(user.id);
  res.json({ token, user: publicUser(user) });
}));

/* ---- guest: just a name, names do NOT need to be unique ---- */
app.post('/api/guest', authLimiter, wrap(async (req, res) => {
  const name = cleanGuestName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Enter a name to play as guest.' });

  const { rows } = await pool.query(
    `INSERT INTO users (display_name, is_guest) VALUES ($1, TRUE) RETURNING id, display_name, is_guest`,
    [name]
  );
  const token = await createSession(rows[0].id);
  res.status(201).json({ token, user: publicUser(rows[0]) });
}));

/* ---- who am I (used on page load to restore the session) ---- */
app.get('/api/me', auth, wrap(async (req, res) => {
  const info = await getRankInfo(req.user.id);
  res.json({ user: publicUser(req.user), best: info.best, rank: info.rank });
}));

/* ---- logout ---- */
app.post('/api/logout', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
  res.json({ ok: true });
}));

/* ---- start a run (called when a game starts) ---- */
app.post('/api/run', auth, gameLimiter, wrap(async (req, res) => {
  const { rows } = await pool.query('INSERT INTO runs (user_id) VALUES ($1) RETURNING id', [req.user.id]);
  res.json({ runId: rows[0].id });
}));

/* ---- submit score (called when the game ends) ---- */
app.post('/api/score', auth, gameLimiter, wrap(async (req, res) => {
  const { runId, score } = req.body || {};
  if (typeof runId !== 'string' || !UUID_RE.test(runId)) return res.status(400).json({ error: 'Bad run.' });
  if (!Number.isInteger(score) || score < 0 || score > HARD_MAX_SCORE) return res.status(400).json({ error: 'Bad score.' });

  const run = await pool.query(
    `UPDATE runs SET used = TRUE
      WHERE id = $1 AND user_id = $2 AND used = FALSE
  RETURNING EXTRACT(EPOCH FROM (now() - started_at)) AS elapsed`,
    [runId, req.user.id]
  );
  if (!run.rows.length) return res.status(400).json({ error: 'This game was already saved.' });

  const elapsed = Number(run.rows[0].elapsed);
  const maxScore = Math.floor(elapsed / SECONDS_PER_POINT) + SCORE_SLACK;
  if (score > maxScore) return res.status(400).json({ error: 'Score rejected.' });

  await pool.query('INSERT INTO scores (user_id, score) VALUES ($1, $2)', [req.user.id, score]);

  let newBest = false;
  if (score > 0) {
    const up = await pool.query(
      `INSERT INTO best_scores (user_id, best, achieved_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
         SET best = EXCLUDED.best, achieved_at = now()
       WHERE EXCLUDED.best > best_scores.best
       RETURNING best`,
      [req.user.id, score]
    );
    newBest = up.rows.length > 0;
  }

  const info = await getRankInfo(req.user.id);
  res.json({ best: info.best, rank: info.rank, newBest });
}));

/* ---- global leaderboard (optional auth to mark "you") ---- */
app.get('/api/leaderboard', gameLimiter, wrap(async (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));

  let meId = null;
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) {
    const { rows } = await pool.query('SELECT user_id FROM sessions WHERE token_hash = $1', [sha256(h.slice(7).trim())]);
    if (rows.length) meId = String(rows[0].user_id);
  }

  const { rows } = await pool.query(
    `SELECT ROW_NUMBER() OVER (ORDER BY b.best DESC, b.achieved_at ASC, b.user_id ASC) AS rank,
            u.id, u.display_name, u.is_guest, b.best
       FROM best_scores b JOIN users u ON u.id = b.user_id
      ORDER BY rank
      LIMIT $1`,
    [limit]
  );
  const total = (await pool.query('SELECT COUNT(*)::int AS n FROM best_scores')).rows[0].n;

  const entries = rows.map((r) => ({
    rank: Number(r.rank),
    name: r.display_name,
    guest: r.is_guest,
    score: r.best,
    me: meId !== null && String(r.id) === meId,
  }));

  let me = null;
  if (meId !== null) {
    const info = await getRankInfo(meId);
    if (info.rank) me = { rank: info.rank, score: info.best };
  }
  res.json({ entries, me, total });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---- the game itself (static files live in /public only) ---- */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

/* ------------------------------------------------------------------ boot */

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`[flapy] running on http://localhost:${PORT}`));
    setInterval(() => {
      pool.query(`DELETE FROM runs WHERE started_at < now() - interval '1 day'`).catch(() => {});
    }, 60 * 60 * 1000).unref();
  })
  .catch((e) => {
    console.error('\n[flapy] Could not connect / set up the database:', e.message);
    console.error('        Check DATABASE_URL in your .env file.\n');
    process.exit(1);
  });
