-- Flapy schema. server.js runs this automatically on start (every statement is IF NOT EXISTS),
-- so you only need this file if you want to run it by hand in the Neon SQL editor.

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  display_name   TEXT        NOT NULL,
  username_lower TEXT        UNIQUE,          -- NULL for guests, unique (case-insensitive) for accounts
  password_hash  TEXT,                        -- NULL for guests
  is_guest       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,                -- sha256 of the token the browser holds
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- One row per game started; the score must be submitted against it (basic anti-cheat).
CREATE TABLE IF NOT EXISTS runs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used       BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Every finished game.
CREATE TABLE IF NOT EXISTS scores (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER     NOT NULL CHECK (score >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scores_user_idx ON scores(user_id);

-- Best score per player (this powers the leaderboard).
CREATE TABLE IF NOT EXISTS best_scores (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  best        INTEGER     NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS best_scores_rank_idx ON best_scores(best DESC, achieved_at ASC);
