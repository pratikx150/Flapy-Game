(() => {
  'use strict';

  // ====================================================================
  //  Flapy – canvas version
  //  • Fixed logical world height (640) scaled to any screen, so the game
  //    plays the same on phones, tablets and desktops.
  //  • Fixed-timestep physics (60 Hz) → same speed on 60/120/144 Hz screens.
  //  • One game loop, one set of listeners (the old version stacked new
  //    ones on every restart, which made the bird flap many times per press).
  // ====================================================================

  const WORLD_H = 640;           // logical height
  const STEP = 1 / 60;           // physics step (seconds)

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
    margin: 80,                  // min distance of a gap from the top / bottom
    maxGapShift: 170,            // keeps consecutive gaps reachable
    birdD: 58,                   // face diameter — same for all 3 birds
    birdX: 0.28,                 // fraction of world width
  };

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const titleEl = document.getElementById('title');
  const subtitleEl = document.getElementById('subtitle');
  const scoresEl = document.getElementById('scores');
  const finalScoreEl = document.getElementById('finalScore');
  const bestScoreEl = document.getElementById('bestScore');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const muteBtn = document.getElementById('muteBtn');

  // ---------- Images (all local, in assets/images) ----------
  function loadImg(src) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    return img;
  }
  const IMG = {
    bg:   loadImg('assets/images/background.png'),
    faceMain: loadImg('assets/images/face_main.png'),           // player bird
    face1:    loadImg('assets/images/face_follower1.png'),      // follower bird 1 (blue)
    face2:    loadImg('assets/images/face_follower2.png'),      // follower bird 2 (pink)
    pipe: loadImg('assets/images/pipe.svg'),
  };
  const ok = (img) => img.complete && img.naturalWidth > 0;

  // ---------- Storage (safe: may be blocked in private mode) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  let best = parseInt(store.get('flapy_best', '0'), 10) || 0;
  let muted = store.get('flapy_muted', '0') === '1';

  // ---------- Audio ----------
  const music = {
    fly: new Audio('assets/audio/fly.mp3'),
    catch: new Audio('assets/audio/catch.mp3'),
  };
  const lose = new Audio('assets/audio/lose.mp3');
  music.fly.loop = true;   music.fly.volume = 0.2;
  music.catch.loop = true; music.catch.volume = 0.25;
  lose.volume = 1.0;
  [music.fly, music.catch, lose].forEach(a => { a.preload = 'auto'; });

  // Small synthesised SFX so flaps / points give instant feedback
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
    flap:  () => beep(380, 0.09, 'triangle', 0.08, 620),
    point: () => { beep(880, 0.09, 'square', 0.07); setTimeout(() => beep(1320, 0.14, 'square', 0.07), 70); },
    hit:   () => beep(180, 0.25, 'sawtooth', 0.12, 60),
  };

  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audioCtx();   // resume the Web Audio context inside the user's first tap / key press
    // NOTE: the music tracks are NOT primed here. Priming (play muted, then pause)
    // raced with startMusic() and paused the music right after it started,
    // which is why there was no sound the first time you pressed Start.
    // Calling play() directly inside the click/tap/key handler is allowed by browsers.
    // Only the short "lose" sound is primed, since it plays later outside a gesture.
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
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(muted));
    if (muted) { stopMusic(); lose.pause(); }
    else if (state === 'play') startMusic();
    else if (state === 'over') lose.play().catch(() => {});
  }

  // ---------- State ----------
  let state = 'ready';           // ready | play | paused | over
  let W = 360, H = WORLD_H, scale = 1, dpr = 1;   // W = logical width
  let bird, pipes, followers, score, speed, gap, distSincePipe, lastGapY, shake, overAt;
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

  // Colour sets for the three birds (all share the same face)
  const PAL = {
    main: { body: '#ffcf1f', body2: '#ffb300', belly: '#fde9b5', wing: '#ffd21a', tail: '#ffa91f', crest: '#ffd21a' },
    blue: { body: '#b48cf5', body2: '#8a5ee0', belly: '#efe4ff', wing: '#c8a8fa', tail: '#7a4fd0', crest: '#c8a8fa' },
    pink: { body: '#ff8294', body2: '#f2546d', belly: '#ffe3e8', wing: '#ffa3b0', tail: '#e0485f', crest: '#ffa3b0' },
  };

  function resetWorld() {
    bird = { x: Math.max(132, W * CFG.birdX), y: H * 0.45, vy: 0, D: CFG.birdD, rot: 0 };
    followers = [
      { x: bird.x - 70, y: bird.y - 60, D: CFG.birdD, pal: PAL.blue, img: IMG.face1, phase: 0, side: -1 },
      { x: bird.x - 70, y: bird.y + 60, D: CFG.birdD, pal: PAL.pink, img: IMG.face2, phase: 2, side: 1 },
    ];
    pipes = [];
    score = 0;
    speed = CFG.baseSpeed;
    gap = CFG.gapStart;
    distSincePipe = CFG.pipeSpacing;   // first pipe spawns right away (off-screen)
    lastGapY = H / 2;
    shake = 0;
  }

  // ---------- Game flow ----------
  function startGame() {
    unlockAudio();
    resetWorld();
    state = 'play';
    overlay.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    lose.loop = false; lose.pause(); lose.currentTime = 0;   // stop the game-over loop on restart
    startMusic();
    flap();
    startBtn.blur();
  }

  function flap() {
    if (state !== 'play') return;
    bird.vy = CFG.flap;
    sfx.flap();
  }

  function endGame() {
    if (state !== 'play') return;
    state = 'over';
    overAt = performance.now();
    shake = 12;
    stopMusic();
    sfx.hit();
    lose.loop = true;                                          // keeps playing until the game restarts
    if (!muted) { lose.currentTime = 0; lose.play().catch(() => {}); }
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch (_) {} }
    const newBest = score > best;
    if (newBest) { best = score; store.set('flapy_best', String(best)); }
    showOverlay('over', newBest);
  }

  function showOverlay(kind, newBest) {
    overlay.classList.remove('hidden');
    pauseBtn.classList.toggle('hidden', kind !== 'paused' && kind !== 'play');
    if (kind === 'start') {
      titleEl.textContent = 'Flapy';
      subtitleEl.textContent = 'Tap, click or press Space to flap';
      scoresEl.classList.toggle('hidden', best === 0);
      finalScoreEl.parentElement.classList.add('hidden');
      bestScoreEl.textContent = best;
      startBtn.textContent = 'Start Game';
    } else if (kind === 'over') {
      titleEl.textContent = 'Game Over!';
      subtitleEl.textContent = newBest ? '🎉 New best score!' : 'Tap Restart or press Enter / Space';
      scoresEl.classList.remove('hidden');
      finalScoreEl.parentElement.classList.remove('hidden');
      finalScoreEl.textContent = score;
      bestScoreEl.textContent = best;
      startBtn.textContent = 'Restart Game';
    } else if (kind === 'paused') {
      titleEl.textContent = 'Paused';
      subtitleEl.textContent = 'Take a breath 🙂';
      scoresEl.classList.add('hidden');
      startBtn.textContent = 'Resume';
    }
  }

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    stopMusic();
    showOverlay('paused');
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    overlay.classList.add('hidden');
    if (!muted) { music.fly.play().catch(() => {}); music.catch.play().catch(() => {}); }
    lastT = performance.now();
    acc = 0;
  }

  // ---------- Update ----------
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

  function update() {
    time += STEP;

    if (state === 'ready' || state === 'over' || state === 'paused') {
      if (state === 'ready' && bird) { bird.y = H * 0.45 + Math.sin(time * 3) * 8; }
      if (shake > 0) shake *= 0.9;
      return;
    }

    // bird
    bird.vy = Math.min(bird.vy + CFG.gravity, CFG.maxFall);
    bird.y += bird.vy;
    bird.rot += ((Math.max(-0.45, Math.min(1.1, bird.vy * 0.075))) - bird.rot) * 0.2;

    const R = bird.D / 2;
    if (bird.y - R < 0) { bird.y = R; if (bird.vy < 0) bird.vy = 0; }
    if (bird.y + R * 1.35 > H) { bird.y = H - R * 1.35; endGame(); return; }

    // pipes
    distSincePipe += speed;
    if (distSincePipe >= CFG.pipeSpacing) { distSincePipe = 0; spawnPipe(); }

    const r = bird.D * 0.36;                    // forgiving hitbox, centred on the face
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
        // gentle difficulty ramp
        speed = Math.min(CFG.maxSpeed, CFG.baseSpeed + score * 0.04);
        gap = Math.max(CFG.gapMin, CFG.gapStart - score * 2);
      }
    }

    // followers: fly in formation above / below-behind the main bird
    followers.forEach((f) => {
      const dx = Math.min(80, bird.x - 70);
      const tx = bird.x - dx;
      let ty = bird.y + f.side * 72 + Math.sin(time * 2.2 + f.phase) * 6;
      ty = Math.max(f.D * 0.8 + 4, Math.min(H - f.D * 0.8, ty));
      f.x += (tx - f.x) * 0.07;
      f.y += (ty - f.y) * 0.07;
    });
  }

  // ---------- Render ----------
  function drawBackground() {
    if (ok(IMG.bg)) {
      // "cover" fit
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
      const full = 560;                       // draw pipe at constant height, clip to visible part
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

  // Draws one bird in the style of the reference picture: the face is the head,
  // a round body is tucked behind it, with a 3-feather tail, a 2-leaf crest and a wing.
  // (x, y) = centre of the face, D = face diameter (all 3 birds use the same D).
  function drawFaceBird(x, y, D, rot, pal, wingAng, faceImg, fast) {
    const R = D / 2, OL = Math.max(1.5, R * 0.07), line = '#3b2314';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = OL; ctx.strokeStyle = line;

    // leaf shape pointing along +x from the origin
    const leaf = (len, thick, fill) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.5, -thick, len, 0);
      ctx.quadraticCurveTo(len * 0.5, thick, 0, 0);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
    };

    // speed streaks behind the bird while flying
    if (fast) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1.5, R * 0.14);
      [[-2.55, 0.05, -1.75, -0.12], [-2.75, 0.5, -1.85, 0.42], [-2.45, 0.95, -1.8, 0.88]].forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath(); ctx.moveTo(x1 * R, y1 * R); ctx.lineTo(x2 * R, y2 * R); ctx.stroke();
      });
      ctx.restore();
    }

    // tail: three feathers fanning out to the left
    [0.55, 0, -0.55].forEach((a) => {
      ctx.save(); ctx.translate(-1.35 * R, 0.3 * R); ctx.rotate(Math.PI + a);
      leaf(0.95 * R, 0.5 * R, pal.tail);
      ctx.restore();
    });

    // crest: two leaves on top (hidden at the base by the face)
    ctx.save(); ctx.translate(-0.4 * R, -0.85 * R); ctx.rotate(-Math.PI / 2 - 0.45); leaf(0.85 * R, 0.5 * R, pal.crest); ctx.restore();
    ctx.save(); ctx.translate(-0.05 * R, -0.9 * R); ctx.rotate(-Math.PI / 2 + 0.25); leaf(0.8 * R, 0.5 * R, pal.crest); ctx.restore();

    // body: big round blob mostly behind the face
    const bx = -0.42 * R, by = 0.25 * R, br = 1.05 * R;
    const g = ctx.createLinearGradient(0, by - br, 0, by + br);
    g.addColorStop(0, pal.body); g.addColorStop(1, pal.body2);
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    // belly
    ctx.save();
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.ellipse(bx + 0.25 * R, by + 0.95 * R, 1.0 * R, 0.5 * R, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.belly; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();

    // wing: leaf on the side of the body, flaps around its hinge
    ctx.save(); ctx.translate(-0.4 * R, 0.42 * R); ctx.rotate(Math.PI + wingAng * 0.7);
    leaf(1.1 * R, 0.62 * R, pal.wing);
    ctx.restore();

    // face = head
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#f6ecd6'; ctx.fillRect(-R, -R, D, D);
    if (ok(faceImg)) ctx.drawImage(faceImg, -R, -R, D, D);
    ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.lineWidth = OL; ctx.strokeStyle = line; ctx.stroke();

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

    drawBackground();
    if (!bird) return;

    pipes.forEach(p => {
      const topH = p.gapY - p.gap / 2;
      const botY = p.gapY + p.gap / 2;
      drawPipe(p.x, 0, CFG.pipeW, topH, true);
      drawPipe(p.x, botY, CFG.pipeW, H - botY, false);
    });

    const flapping = state === 'play';
    const wing = (t, k) => Math.sin(t * (flapping ? 22 : 8) + k) * 0.55;
    if (state !== 'over') {
      followers.forEach((f, i) => {
        drawFaceBird(f.x, f.y, f.D, Math.sin(time * 5 + i * 2) * 0.1, f.pal, wing(time, i * 1.7), f.img, flapping);
      });
    }
    drawFaceBird(bird.x, bird.y, bird.D, state === 'ready' ? 0 : bird.rot, PAL.main, wing(time, 0), IMG.faceMain, flapping);

    // score
    if (state === 'play' || state === 'paused' || state === 'over') {
      const top = 14;
      ctx.font = '800 54px system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 7; ctx.strokeStyle = '#543847'; ctx.lineJoin = 'round';
      ctx.strokeText(score, W / 2, top + 54);
      ctx.fillStyle = '#fff';
      ctx.fillText(score, W / 2, top + 54);
    }
  }

  // ---------- Loop ----------
  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    acc += dt;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  function primaryAction() {
    unlockAudio();
    if (state === 'play') flap();
    else if (state === 'ready') startGame();
    else if (state === 'over' && performance.now() - overAt > 450) startGame();   // avoid accidental instant restart
    else if (state === 'paused') resume();
  }

  // Pointer events cover mouse, touch and pen with no 300ms delay / double-firing
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    primaryAction();
  }, { passive: false });

  // Tapping the dimmed area around the panel also works as "go"
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) { e.preventDefault(); primaryAction(); }
  });

  startBtn.addEventListener('click', () => {
    unlockAudio();
    if (state === 'paused') resume(); else startGame();
  });

  pauseBtn.addEventListener('click', () => { state === 'play' ? pause() : resume(); pauseBtn.blur(); });
  muteBtn.addEventListener('click', () => {
    unlockAudio();
    muted = !muted; store.set('flapy_muted', muted ? '1' : '0'); applyMute(); muteBtn.blur();
  });
  // make sure taps on HUD buttons never leak through as flaps
  document.querySelector('.hud').addEventListener('pointerdown', (e) => e.stopPropagation());

  const FLAP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
  window.addEventListener('keydown', (e) => {
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

  // Auto-pause if the tab / app is hidden or loses focus (e.g. phone call, tab switch)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); if (state === 'over') lose.pause(); }
    else if (state === 'over' && !muted) lose.play().catch(() => {});
  });
  window.addEventListener('blur', () => pause());

  // Block page gestures that would disturb play on mobile
  ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });

  // ---------- Boot ----------
  resize();
  resetWorld();
  applyMute();
  showOverlay('start');
  pauseBtn.classList.add('hidden');
  lastT = performance.now();
  requestAnimationFrame(frame);
})();
