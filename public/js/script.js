(() => {
  'use strict';

  const WORLD_H = 640;
  const STEP = 1 / 60;

  const CFG = {
    gravity: 0.42,
    flap: -7.2,
    maxFall: 10,
    baseSpeed: 2.8,
    maxSpeed: 4.0,
    pipeW: 72,
    pipeSpacing: 250,
    gapStart: 210,
    gapMin: 160,
    margin: 80,
    maxGapShift: 170,
    birdW: 96,      // drawn width of the bird image (height follows the image ratio)
    hitR: 21,       // collision circle radius
    birdX: 0.28,
  };

  // Where the "centre of mass" (head + body) sits inside each bird image (0..1).
  // The collision circle and rotation are anchored here.
  const ANCHOR = { x: 0.6, y: 0.52 };

  /* ------------------------------------------------------------------ DOM */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const overlay = $('overlay');
  const panel = overlay.querySelector('.panel');
  const titleEl = $('title');
  const subtitleEl = $('subtitle');
  const viewAuth = $('viewAuth');
  const viewMenu = $('viewMenu');
  const viewBoard = $('viewBoard');
  const authForm = $('authForm');
  const inUser = $('inUser');
  const inPass = $('inPass');
  const fieldPass = $('fieldPass');
  const userLabel = $('userLabel');
  const authMsg = $('authMsg');
  const authNote = $('authNote');
  const authSubmit = $('authSubmit');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const whoName = $('whoName');
  const whoTag = $('whoTag');
  const whoIcon = $('whoIcon');
  const who = $('who');
  const scoresEl = $('scores');
  const scoreBox = $('scoreBox');
  const finalScoreEl = $('finalScore');
  const bestScoreEl = $('bestScore');
  const rankLine = $('rankLine');
  const startBtn = $('startBtn');
  const boardBtn = $('boardBtn');
  const logoutBtn = $('logoutBtn');
  const boardStatus = $('boardStatus');
  const boardList = $('boardList');
  const boardMe = $('boardMe');
  const boardBack = $('boardBack');
  const boardRefresh = $('boardRefresh');
  const pauseBtn = $('pauseBtn');
  const muteBtn = $('muteBtn');

  /* ------------------------------------------------------------------ assets */
  function loadImg(src) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    return img;
  }

  const IMG = {
    bg: loadImg('assets/images/background.png'),
    main: loadImg('assets/images/face_main.png'),
    bird1: loadImg('assets/images/face_follower1.png'),
    bird2: loadImg('assets/images/face_follower2.png'),
    pipe: loadImg('assets/images/pipe.svg'),
  };
  const ok = (img) => img.complete && img.naturalWidth > 0;

  if (document.fonts && document.fonts.load) {
    document.fonts.load('400 56px "Lilita One"').catch(() => {});
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  let muted = store.get('flapy_muted', '0') === '1';

  /* ------------------------------------------------------------------ audio */
  const music = {
    fly: new Audio('assets/audio/fly.mp3'),
    catch: new Audio('assets/audio/catch.mp3'),
  };
  const lose = new Audio('assets/audio/lose.mp3');
  music.fly.loop = true; music.fly.volume = 0.2;
  music.catch.loop = true; music.catch.volume = 0.25;
  lose.volume = 1.0;
  [music.fly, music.catch, lose].forEach(a => { a.preload = 'auto'; });

  let ac = null;
  function audioCtx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function beep(freq, dur, type = 'sine', vol = 0.12, slideTo) {
    if (muted) return;
    const c = audioCtx(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const sfx = {
    flap: () => beep(380, 0.09, 'triangle', 0.08, 620),
    point: () => { beep(880, 0.09, 'square', 0.07); setTimeout(() => beep(1320, 0.14, 'square', 0.07), 70); },
    hit: () => beep(180, 0.25, 'sawtooth', 0.12, 60),
  };

  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audioCtx();
    const a = lose;
    a.muted = true;
    const p = a.play();
    if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    else a.muted = false;
  }

  function startMusic() {
    if (muted) return;
    music.fly.currentTime = 0; music.catch.currentTime = 0;
    music.fly.play().catch(() => {});
    music.catch.play().catch(() => {});
  }

  function stopMusic() {
    music.fly.pause(); music.catch.pause();
  }

  function applyMute() {
    const muteImg = muteBtn.querySelector('img');
    if (muteImg) {
      muteImg.src = muted ? 'assets/icons/volume-off.svg' : 'assets/icons/volume.svg';
      muteImg.alt = muted ? 'Muted' : 'Sound on';
    }
    muteBtn.setAttribute('aria-pressed', String(muted));
    if (muted) { stopMusic(); lose.pause(); }
    else if (state === 'play') startMusic();
    else if (state === 'over') lose.play().catch(() => {});
  }

  /* ------------------------------------------------------------------ account / server */
  let token = store.get('flapy_token', '');
  let user = null;          // { id, name, guest }
  let best = 0;             // this player's best score (from the server)
  let rank = null;          // this player's global rank
  let runPromise = null;    // resolves to the runId of the game in progress
  let gameId = 0;

  async function api(path, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch('api/' + path, {
        method: opts.body ? 'POST' : (opts.method || 'GET'),
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) {
        const err = new Error(data.error || 'Something went wrong. Please try again.');
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.status) throw e;
      const err = new Error("Can't reach the server. Check your connection and try again.");
      err.network = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function setSession(data) {
    token = data.token;
    store.set('flapy_token', token);
    user = data.user;
  }

  function clearSession() {
    token = '';
    user = null;
    best = 0;
    rank = null;
    runPromise = null;
    store.del('flapy_token');
  }

  /* ------------------------------------------------------------------ game state */
  let state = 'ready';
  let ui = 'none';                       // which panel is showing: auth | menu | board | none
  let W = 360, H = WORLD_H, scale = 1, dpr = 1;
  let bird, pipes, followers, particles, score, speed, gap, distSincePipe, lastGapY, shake, overAt;
  let acc = 0, lastT = 0, time = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    scale = ch / WORLD_H;
    W = cw / scale;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    if (bird) bird.x = Math.max(132, W * CFG.birdX);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  function spriteH(img, w) {
    return ok(img) ? w * img.naturalHeight / img.naturalWidth : w * 0.68;
  }

  function resetWorld() {
    bird = { x: Math.max(132, W * CFG.birdX), y: H * 0.45, vy: 0, rot: 0, squash: 0 };
    followers = [
      { x: bird.x - 70, y: bird.y - 70, img: IMG.bird1, phase: 0, side: -1 },
      { x: bird.x - 70, y: bird.y + 70, img: IMG.bird2, phase: 2, side: 1 },
    ];
    pipes = [];
    particles = [];
    score = 0;
    speed = CFG.baseSpeed;
    gap = CFG.gapStart;
    distSincePipe = CFG.pipeSpacing;
    lastGapY = H / 2;
    shake = 0;
  }

  function startGame() {
    if (!user) return;
    unlockAudio();
    resetWorld();
    state = 'play';
    gameId++;
    overlay.classList.add('hidden');
    ui = 'none';
    pauseBtn.classList.remove('hidden');
    lose.loop = false; lose.pause(); lose.currentTime = 0;
    startMusic();
    flap();
    startBtn.blur();
    // tell the server a game began (the score is later saved against this run)
    runPromise = api('run', { method: 'POST', body: {} }).then((r) => r.runId).catch((e) => {
      if (e.status === 401) sessionExpired();
      return null;
    });
  }

  function flap() {
    if (state !== 'play') return;
    bird.vy = CFG.flap;
    bird.squash = 1;
    sfx.flap();
  }

  function burst(x, y) {
    const cols = ['#ffcf1f', '#ffffff', '#e86101', '#ffb300'];
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5,
        life: 0.7 + Math.random() * 0.4, max: 1.1, r: 3 + Math.random() * 4,
        col: cols[i % cols.length], g: 0.18,
      });
    }
  }

  function endGame() {
    if (state !== 'play') return;
    state = 'over';
    overAt = performance.now();
    shake = 12;
    burst(bird.x, bird.y);
    stopMusic();
    sfx.hit();
    lose.loop = true;
    if (!muted) { lose.currentTime = 0; lose.play().catch(() => {}); }
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch (_) {} }

    const finalScore = score;
    const newBest = finalScore > best;
    if (newBest) best = finalScore;
    showMenu('over', { newBest });
    submitScore(finalScore, gameId, runPromise);
  }

  async function submitScore(finalScore, id, runP) {
    const stillHere = () => state === 'over' && id === gameId;

    if (finalScore <= 0) { if (stillHere()) showRank(); return; }
    if (stillHere()) { rankLine.textContent = 'Saving your score…'; rankLine.classList.remove('hidden'); }

    try {
      const runId = await runP;
      if (!runId) throw Object.assign(new Error('offline'), { network: true });
      const r = await api('score', { body: { runId, score: finalScore } });
      best = r.best;
      rank = r.rank;
      if (stillHere()) {
        bestScoreEl.textContent = best;
        showRank();
      }
    } catch (e) {
      if (e.status === 401) { sessionExpired(); return; }
      if (stillHere()) {
        rankLine.textContent = e.network
          ? "Score not saved - can't reach the server."
          : 'Score not saved. ' + e.message;
        rankLine.classList.remove('hidden');
      }
    }
  }

  function showRank() {
    if (!rank) { rankLine.classList.add('hidden'); rankLine.textContent = ''; return; }
    rankLine.textContent = '';
    rankLine.append('Global rank ');
    const b = document.createElement('b');
    b.textContent = '#' + rank;
    rankLine.append(b);
    rankLine.classList.remove('hidden');
  }

  /* ------------------------------------------------------------------ panels */
  function setView(name) {
    ui = name;
    viewAuth.classList.toggle('hidden', name !== 'auth');
    viewMenu.classList.toggle('hidden', name !== 'menu');
    viewBoard.classList.toggle('hidden', name !== 'board');
    overlay.classList.remove('hidden');
    titleEl.classList.remove('small');
    panel.scrollTop = 0;
  }

  let lastNewBest = false;

  function setOverTitle(newBest) {
    titleEl.textContent = 'Game Over!';
    subtitleEl.textContent = '';
    if (newBest) {
      const badge = document.createElement('span');
      badge.className = 'overlay-badge';
      const img = document.createElement('img');
      img.src = 'assets/icons/trophy.svg'; img.alt = '';
      badge.append(img, ' New best score!');
      subtitleEl.append(badge);
    } else {
      subtitleEl.textContent = 'Tap Restart or press Enter / Space';
    }
  }

  // kind: 'start' | 'over' | 'paused'
  function showMenu(kind, opts = {}) {
    if (kind === 'over') lastNewBest = !!opts.newBest;
    setView('menu');
    pauseBtn.classList.toggle('hidden', kind !== 'paused');

    whoName.textContent = user ? user.name : '';
    whoTag.classList.toggle('hidden', !(user && user.guest));
    whoIcon.src = user && user.guest ? 'assets/icons/smile.svg' : 'assets/icons/user.svg';
    who.classList.toggle('hidden', kind === 'paused');

    boardBtn.classList.toggle('hidden', kind === 'paused');
    logoutBtn.classList.toggle('hidden', kind !== 'over');   // logout only appears on Game Over
    bestScoreEl.textContent = best;

    if (kind === 'start') {
      titleEl.textContent = 'Flapy';
      subtitleEl.textContent = 'Tap, click or press Space to flap';
      scoresEl.classList.toggle('hidden', best === 0);
      scoreBox.classList.add('hidden');
      startBtn.textContent = 'Start Game';
      showRank();
    } else if (kind === 'over') {
      setOverTitle(opts.newBest);
      scoresEl.classList.remove('hidden');
      scoreBox.classList.remove('hidden');
      finalScoreEl.textContent = score;
      startBtn.textContent = 'Restart Game';
      rankLine.classList.add('hidden');
    } else if (kind === 'paused') {
      titleEl.textContent = 'Paused';
      subtitleEl.textContent = '';
      const badge = document.createElement('span');
      badge.className = 'overlay-badge';
      const img = document.createElement('img');
      img.src = 'assets/icons/smile.svg'; img.alt = '';
      badge.append(img, ' Take a breath');
      subtitleEl.append(badge);
      scoresEl.classList.add('hidden');
      rankLine.classList.add('hidden');
      startBtn.textContent = 'Resume';
    }
  }

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    stopMusic();
    showMenu('paused');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    overlay.classList.add('hidden');
    ui = 'none';
    pauseBtn.classList.remove('hidden');
    if (!muted) { music.fly.play().catch(() => {}); music.catch.play().catch(() => {}); }
    lastT = performance.now();
    acc = 0;
  }

  /* ---- auth panel ---- */
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let mode = 'login';

  function setMode(m) {
    mode = m;
    tabs.forEach((t) => {
      const on = t.dataset.mode === m;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    fieldPass.classList.toggle('hidden', m === 'guest');
    userLabel.textContent = m === 'guest' ? 'Your name' : 'Username';
    inUser.autocomplete = m === 'guest' ? 'nickname' : 'username';
    inPass.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    authSubmit.textContent = m === 'login' ? 'Sign in' : m === 'signup' ? 'Create account' : 'Play as guest';
    authNote.textContent =
      m === 'signup' ? 'Username must be unique: 3-16 letters, numbers or underscore. Password: 6+ characters.' :
      m === 'guest'  ? "Guest names don't have to be unique. Your guest score is lost if you log out." :
                       '';
    inPass.value = '';
    setAuthMsg('');
    [inUser, inPass].forEach((i) => i.classList.remove('bad'));
  }

  function setAuthMsg(text, good) {
    authMsg.textContent = text || '';
    authMsg.classList.toggle('ok', !!good);
  }

  function showAuth(message) {
    state = 'ready';
    pauseBtn.classList.add('hidden');
    setView('auth');
    titleEl.textContent = 'Flapy';
    subtitleEl.textContent = 'Sign in to save your score';
    setMode(mode);
    if (message) setAuthMsg(message);
    if (!coarse) setTimeout(() => { try { inUser.focus({ preventScroll: true }); } catch (_) {} }, 50);
  }

  function sessionExpired() {
    stopMusic(); lose.pause();
    clearSession();
    resetWorld();
    showAuth('Session expired. Please sign in again.');
  }

  tabs.forEach((t) => t.addEventListener('click', () => { setMode(t.dataset.mode); if (!coarse) inUser.focus(); }));

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (authSubmit.disabled) return;
    const name = inUser.value.trim();
    const pass = inPass.value;
    [inUser, inPass].forEach((i) => i.classList.remove('bad'));

    if (mode === 'guest') {
      if (!name) { inUser.classList.add('bad'); return setAuthMsg('Enter a name to play as guest.'); }
    } else {
      if (!name) { inUser.classList.add('bad'); return setAuthMsg('Enter your username.'); }
      if (!pass) { inPass.classList.add('bad'); return setAuthMsg('Enter your password.'); }
      if (mode === 'signup') {
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
          inUser.classList.add('bad');
          return setAuthMsg('Username must be 3-16 letters, numbers or underscore.');
        }
        if (pass.length < 6) { inPass.classList.add('bad'); return setAuthMsg('Password must be at least 6 characters.'); }
      }
    }

    const label = authSubmit.textContent;
    authSubmit.disabled = true;
    authSubmit.textContent = 'Please wait…';
    setAuthMsg('');
    try {
      const data = mode === 'guest'
        ? await api('guest', { body: { name } })
        : await api(mode === 'signup' ? 'signup' : 'login', { body: { username: name, password: pass } });
      setSession(data);
      inPass.value = '';
      best = 0; rank = null;
      try { await loadMe(); } catch (e2) { if (e2.status === 401) throw e2; }
      showMenu('start');
    } catch (err) {
      setAuthMsg(err.message);
      if (err.status === 409) inUser.classList.add('bad');
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = label;
    }
  });

  async function loadMe() {
    const me = await api('me');      // throws on 401 / network error
    user = me.user;
    best = me.best || 0;
    rank = me.rank || null;
  }

  async function logout() {
    logoutBtn.disabled = true;
    try { await api('logout', { method: 'POST', body: {} }); } catch (_) { /* clear locally anyway */ }
    logoutBtn.disabled = false;
    stopMusic(); lose.pause(); lose.currentTime = 0;
    clearSession();
    resetWorld();
    inUser.value = '';
    mode = 'login';
    showAuth();
  }

  /* ---- leaderboard panel ---- */
  let boardFrom = 'start';
  let boardReq = 0;

  function openBoard() {
    boardFrom = state === 'over' ? 'over' : 'start';
    setView('board');
    titleEl.textContent = 'Leaderboard';
    titleEl.classList.add('small');
    subtitleEl.textContent = 'Best scores from players worldwide';
    loadBoard();
  }

  function closeBoard() {
    // the menu panel still holds its old content, so just show it again
    const kind = boardFrom;
    if (kind === 'over') {
      setView('menu');
      setOverTitle(lastNewBest);
    } else {
      showMenu('start');
    }
  }
  async function loadBoard() {
    const myReq = ++boardReq;
    boardStatus.className = 'board_status';
    boardStatus.textContent = 'Loading…';
    boardList.textContent = '';
    boardMe.classList.add('hidden');
    boardRefresh.disabled = true;
    try {
      const data = await api('leaderboard?limit=20');
      if (myReq !== boardReq) return;
      renderBoard(data);
    } catch (e) {
      if (myReq !== boardReq) return;
      boardStatus.className = 'board_status err';
      boardStatus.textContent = e.message;
    } finally {
      if (myReq === boardReq) boardRefresh.disabled = false;
    }
  }

  function tagEl() {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = 'guest';
    return t;
  }

  function renderBoard(data) {
    boardList.textContent = '';
    if (!data.entries.length) {
      boardStatus.textContent = 'No scores yet. Be the first on the board!';
      return;
    }
    boardStatus.textContent = data.total + (data.total === 1 ? ' player' : ' players') + ' on the board';

    let meShown = false;
    data.entries.forEach((en) => {
      const li = document.createElement('li');
      li.className = 'row_item' + (en.me ? ' me' : '');
      const medal = document.createElement('span');
      medal.className = 'medal' + (en.rank <= 3 ? ' r' + en.rank : '');
      medal.textContent = en.rank;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = en.name;
      if (en.guest) nm.append(tagEl());
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = en.score;
      li.append(medal, nm, pts);
      boardList.append(li);
      if (en.me) meShown = true;
    });

    if (data.me && !meShown) {
      boardMe.textContent = '';
      const grow = document.createElement('span');
      grow.className = 'grow';
      grow.textContent = 'Your rank';
      const r = document.createElement('b');
      r.textContent = '#' + data.me.rank;
      const s = document.createElement('b');
      s.textContent = data.me.score;
      boardMe.append(grow, r, document.createTextNode(' · '), s);
      boardMe.classList.remove('hidden');
    }
  }

  boardBtn.addEventListener('click', openBoard);
  boardBack.addEventListener('click', closeBoard);
  boardRefresh.addEventListener('click', loadBoard);
  logoutBtn.addEventListener('click', logout);

  /* ------------------------------------------------------------------ world logic */
  function spawnPipe() {
    const half = gap / 2;
    const minY = CFG.margin + half;
    const maxY = H - CFG.margin - half;
    let y = minY + Math.random() * (maxY - minY);
    y = Math.max(lastGapY - CFG.maxGapShift, Math.min(lastGapY + CFG.maxGapShift, y));
    y = Math.max(minY, Math.min(maxY, y));
    lastGapY = y;
    pipes.push({ x: W + 20, gapY: y, gap, passed: false });
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= STEP;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy;
      p.vy += p.g;
    }
  }

  function update() {
    time += STEP;
    if (!bird) return;
    updateParticles();
    bird.squash *= 0.86;

    if (state === 'ready' || state === 'over' || state === 'paused') {
      if (state === 'ready') { bird.y = H * 0.45 + Math.sin(time * 3) * 8; }
      if (shake > 0) shake *= 0.9;
      return;
    }

    bird.vy = Math.min(bird.vy + CFG.gravity, CFG.maxFall);
    bird.y += bird.vy;
    bird.rot += ((Math.max(-0.45, Math.min(1.1, bird.vy * 0.075))) - bird.rot) * 0.2;

    const bh = spriteH(IMG.main, CFG.birdW);
    const top = bh * ANCHOR.y, bottom = bh * (1 - ANCHOR.y);
    if (bird.y - top < 0) { bird.y = top; if (bird.vy < 0) bird.vy = 0; }
    if (bird.y + bottom > H) { bird.y = H - bottom; endGame(); return; }

    // little feather puffs behind the bird
    if (Math.round(time * 60) % 5 === 0) {
      particles.push({ x: bird.x - CFG.birdW * 0.45, y: bird.y + 6, vx: -speed * 0.8, vy: 0, life: 0.45, max: 0.45, r: 4 + Math.random() * 3, col: '#ffffff', g: 0 });
    }

    distSincePipe += speed;
    if (distSincePipe >= CFG.pipeSpacing) { distSincePipe = 0; spawnPipe(); }

    const r = CFG.hitR;
    const hy = bird.y;
    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= speed;
      if (p.x + CFG.pipeW < -10) { pipes.splice(i, 1); continue; }

      const topH = p.gapY - p.gap / 2;
      const botY = p.gapY + p.gap / 2;
      if (circleRect(bird.x, hy, r, p.x, -50, CFG.pipeW, topH + 50) ||
          circleRect(bird.x, hy, r, p.x, botY, CFG.pipeW, H - botY + 50)) {
        endGame();
        return;
      }
      if (!p.passed && p.x + CFG.pipeW < bird.x - r) {
        p.passed = true;
        score++;
        sfx.point();
        speed = Math.min(CFG.maxSpeed, CFG.baseSpeed + score * 0.04);
        gap = Math.max(CFG.gapMin, CFG.gapStart - score * 2);
      }
    }

    followers.forEach((f) => {
      const fh = spriteH(f.img, CFG.birdW);
      const dx = Math.min(80, bird.x - 70);
      const tx = bird.x - dx;
      let ty = bird.y + f.side * 72 + Math.sin(time * 2.2 + f.phase) * 6;
      ty = Math.max(fh * 0.8 + 4, Math.min(H - fh * 0.8, ty));
      f.x += (tx - f.x) * 0.07;
      f.y += (ty - f.y) * 0.07;
    });
  }

  /* ------------------------------------------------------------------ drawing */
  function drawBackground() {
    if (ok(IMG.bg)) {
      const ir = IMG.bg.naturalWidth / IMG.bg.naturalHeight, cr = W / H;
      let dw, dh;
      if (cr > ir) { dw = W; dh = W / ir; } else { dh = H; dw = H * ir; }
      ctx.drawImage(IMG.bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#4fb7d6'); g.addColorStop(1, '#c9ecf4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 230 - time * 12) % (W + 200) + (W + 200)) % (W + 200) - 100;
        const cy = 80 + i * 55;
        ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 7); ctx.arc(cx + 26, cy + 6, 20, 0, 7); ctx.arc(cx - 26, cy + 6, 18, 0, 7); ctx.fill();
      }
    }
  }

  function drawPipe(x, y, w, h, flipped) {
    if (h <= 0) return;
    if (ok(IMG.pipe)) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      const full = 560;
      if (flipped) {
        ctx.translate(x, y + h); ctx.scale(1, -1);
        ctx.drawImage(IMG.pipe, 0, 0, w, full);
      } else {
        ctx.drawImage(IMG.pipe, x, y, w, full);
      }
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#5aa51d'); g.addColorStop(0.5, '#9be048'); g.addColorStop(1, '#4a8a14');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#2f5a0b'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      const capH = 26, cy = flipped ? y + h - capH : y;
      ctx.fillStyle = g; ctx.fillRect(x - 5, cy, w + 10, capH);
      ctx.strokeRect(x - 5, cy, w + 10, capH);
    }
  }

  // Draws the bird PNG as the whole bird (body, wings, tail and face are all in the image).
  function drawBird(img, x, y, rot, squash) {
    const w = CFG.birdW, h = spriteH(img, w);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(1 - 0.08 * squash, 1 + 0.12 * squash);
    if (ok(img)) {
      ctx.drawImage(img, -w * ANCHOR.x, -h * ANCHOR.y, w, h);
    } else {
      ctx.fillStyle = '#ffcf1f';
      ctx.beginPath(); ctx.arc(0, 0, CFG.hitR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    const cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const s = scale * dpr;
    let sx = 0, sy = 0;
    if (shake > 0.5) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; }
    ctx.setTransform(s, 0, 0, s, sx * s, sy * s);
    ctx.imageSmoothingQuality = 'high';

    drawBackground();
    if (!bird) return;

    pipes.forEach(p => {
      const topH = p.gapY - p.gap / 2;
      const botY = p.gapY + p.gap / 2;
      drawPipe(p.x, 0, CFG.pipeW, topH, true);
      drawPipe(p.x, botY, CFG.pipeW, H - botY, false);
    });

    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.g ? 1 : p.life / p.max + 0.3), 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (state !== 'over') {
      followers.forEach((f, i) => {
        drawBird(f.img, f.x, f.y, Math.sin(time * 5 + i * 2) * 0.1, 0.25 * Math.max(0, Math.sin(time * (state === 'play' ? 22 : 8) + i * 1.7)));
      });
    }
    drawBird(IMG.main, bird.x, bird.y, state === 'ready' ? 0 : bird.rot, bird.squash);

    if (state === 'play' || state === 'paused' || state === 'over') {
      const top = 14;
      ctx.font = '400 58px "Lilita One", "Arial Rounded MT Bold", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 8; ctx.strokeStyle = '#543847'; ctx.lineJoin = 'round';
      ctx.strokeText(score, W / 2, top + 54);
      ctx.fillStyle = '#fff';
      ctx.fillText(score, W / 2, top + 54);
    }
  }

  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    acc += dt;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ input */
  function primaryAction() {
    unlockAudio();
    if (state === 'play') flap();
    else if (ui !== 'menu') return;                       // auth / leaderboard panels are open
    else if (state === 'ready') startGame();
    else if (state === 'over' && performance.now() - overAt > 450) startGame();
    else if (state === 'paused') resume();
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    primaryAction();
  }, { passive: false });

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) { e.preventDefault(); primaryAction(); }
  });

  startBtn.addEventListener('click', () => {
    unlockAudio();
    if (state === 'paused') resume();
    else if (state === 'ready' || state === 'over') startGame();
  });

  pauseBtn.addEventListener('click', () => { state === 'play' ? pause() : resume(); pauseBtn.blur(); });
  muteBtn.addEventListener('click', () => {
    unlockAudio();
    muted = !muted; store.set('flapy_muted', muted ? '1' : '0'); applyMute(); muteBtn.blur();
  });
  document.querySelector('.hud').addEventListener('pointerdown', (e) => e.stopPropagation());

  const FLAP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;                       // typing a name / password
    if (tag === 'BUTTON' && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && state !== 'play') return; // let buttons work normally
    if (e.repeat) return;
    if (FLAP_KEYS.has(e.code)) {
      e.preventDefault();
      primaryAction();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (state === 'ready' || state === 'over') primaryAction();
      else if (state === 'paused') resume();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      state === 'play' ? pause() : state === 'paused' && resume();
    } else if (e.code === 'KeyM') {
      muteBtn.click();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); if (state === 'over') lose.pause(); }
    else if (state === 'over' && !muted) lose.play().catch(() => {});
  });
  window.addEventListener('blur', () => pause());

  ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });
  document.addEventListener('touchmove', e => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });

  /* ------------------------------------------------------------------ boot */
  async function boot() {
    resize();
    resetWorld();
    applyMute();
    pauseBtn.classList.add('hidden');
    lastT = performance.now();
    requestAnimationFrame(frame);

    if (!token) { showAuth(); return; }

    // we have a saved login: check it with the server
    setView('none');
    titleEl.textContent = 'Flapy';
    subtitleEl.textContent = 'Loading…';
    try {
      await loadMe();
      showMenu('start');
    } catch (e) {
      if (e.network) { user = null; showAuth(e.message); }     // keep the saved login, try again on reload
      else { clearSession(); showAuth(); }
    }
  }

  boot();
})();
