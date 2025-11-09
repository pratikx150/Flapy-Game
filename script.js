// === Game constants ===
let move_speed = 3;
let gravity = 0.5;
// === Elements ===
let bird = document.querySelector('.bird');
let follower1 = document.querySelector('.follower1');
let follower2 = document.querySelector('.follower2');
let score_val = document.querySelector('.score_val');
let message = document.querySelector('.message');
let score_title = document.querySelector('.score_title');
let start_btn = document.querySelector('.start_btn');
// === Audio ===
let flySound = document.getElementById('flySound');
let loseSound = document.getElementById('loseSound');
let startSound = document.getElementById('startSound');
let catchSound = document.getElementById('catchSound');
// === Audio setup ===
flySound.volume = 0.2;
loseSound.volume = 1.0;
let audioUnlocked = false;
// === Game state ===
let game_state = 'Start';
let backgroundRect = { top: 0, bottom: window.innerHeight };
// Update background rect
function updateBackgroundRect() {
  backgroundRect.bottom = window.innerHeight;
}
// === Audio Unlock on First Touch (Mobile Fix) ===
let unlockAudios = () => {
  if (audioUnlocked) return;
  [flySound, loseSound, startSound, catchSound].forEach(audio => {
    audio.muted = true;
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    }).catch(err => console.log('Audio unlock error:', err));
    audio.volume = audio === flySound ? 0.2 : 1.0;
  });
  audioUnlocked = true;
};
// === Controls ===
start_btn.addEventListener('click', startGame);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && game_state !== 'Play') {
    startGame();
  }
});
// === Touch Controls ===
let lastTouchTime = 0;
document.addEventListener('touchstart', (e) => {
  e.preventDefault();
  unlockAudios();
  const currentTime = Date.now();
  if (currentTime - lastTouchTime < 300) return;
  lastTouchTime = currentTime;
  if (game_state === 'Start') {
    startGame();
  } else if (game_state === 'Play') {
    let jumpEvent = new KeyboardEvent('keydown', { key: ' ' });
    document.dispatchEvent(jumpEvent);
  }
}, { passive: false });
window.addEventListener('resize', updateBackgroundRect);
updateBackgroundRect();
function startGame() {
  if (game_state !== 'Play') {
    document.querySelectorAll('.pipe_sprite').forEach((e) => e.remove());
    bird.style.top = '40vh';
    bird.style.left = '20vw';
    follower1.style.left = '10vw';
    follower2.style.left = '5vw';
    follower1.style.top = '45vh';
    follower2.style.top = '50vh';
    game_state = 'Play';
    message.innerHTML = '';
    start_btn.classList.add('hidden');
    score_title.innerHTML = 'Score : ';
    score_val.innerHTML = '0';
    follower1.classList.remove('hidden');
    follower2.classList.remove('hidden');
    unlockAudios();
    flySound.loop = true;
    catchSound.loop = true;
    flySound.currentTime = 0;
    catchSound.currentTime = 0;
    loseSound.pause();
    loseSound.currentTime = 0;
    startSound.currentTime = 0;
    Promise.all([
      flySound.play().catch(err => console.log('Fly sound play error:', err)),
      catchSound.play().catch(err => console.log('Catch sound play error:', err)),
      startSound.play().then(() => {
        startSound.pause();
        startSound.currentTime = 0;
      }).catch(err => console.log('Start sound play error:', err))
    ]);
    play();
    moveFollowers();
  }
}
function play() {
  let bird_dy = 0;
  let bird_props = bird.getBoundingClientRect();
  let pipe_seperation = 0;
  let pipe_gap = 45;
  // Bird gravity & controls (prevent keydown spam)
  let keysPressed = new Set();
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowUp' || e.key === ' ') && !keysPressed.has(e.key)) {
      keysPressed.add(e.key);
      bird_dy = -7.6;
    }
    if (e.key === 'Enter' && game_state !== 'Play') {
      startGame();
    }
  });
  document.addEventListener('keyup', (e) => {
    keysPressed.delete(e.key);
  });
  function apply_gravity() {
    if (game_state !== 'Play') return;
    bird_dy += gravity;
    bird_props = bird.getBoundingClientRect();
    if (bird_props.top <= 0 || bird_props.bottom >= backgroundRect.bottom) {
      endGame();
      return;
    }
    bird.style.top = (bird_props.top + bird_dy) + 'px';
    bird_props = bird.getBoundingClientRect();
    requestAnimationFrame(apply_gravity);
  }
  requestAnimationFrame(apply_gravity);
  // Pipe creation & movement (unchanged, but with collision)
  function create_pipe() {
    if (game_state !== 'Play') return;
    if (pipe_seperation > 100) {
      pipe_seperation = 0;
      let pipe_posi = Math.floor(Math.random() * 40) + 10;
      let pipe_sprite_inv = document.createElement('div');
      pipe_sprite_inv.className = 'pipe_sprite';
      pipe_sprite_inv.style.top = (pipe_posi - 70) + 'vh';
      pipe_sprite_inv.style.left = '100vw';
      document.body.appendChild(pipe_sprite_inv);
      let pipe_sprite = document.createElement('div');
      pipe_sprite.className = 'pipe_sprite';
      pipe_sprite.style.top = (pipe_posi + pipe_gap) + 'vh';
      pipe_sprite.style.left = '100vw';
      pipe_sprite.increase_score = '1';
      document.body.appendChild(pipe_sprite);
    }
    pipe_seperation++;
    move_pipes();
    requestAnimationFrame(create_pipe);
  }
  requestAnimationFrame(create_pipe);
  function move_pipes() {
    let pipe_sprite = document.querySelectorAll('.pipe_sprite');
    let bird_props = bird.getBoundingClientRect();
    pipe_sprite.forEach((element) => {
      let pipe_props = element.getBoundingClientRect();
      if (pipe_props.right <= 0) {
        element.remove();
      } else {
        if (
          bird_props.left < pipe_props.left + pipe_props.width &&
          bird_props.left + bird_props.width > pipe_props.left &&
          bird_props.top < pipe_props.top + pipe_props.height &&
          bird_props.top + bird_props.height > pipe_props.top
        ) {
          endGame();
        } else if (
          pipe_props.right < bird_props.left &&
          pipe_props.right + move_speed >= bird_props.left &&
          element.increase_score === '1'
        ) {
          score_val.innerHTML = +score_val.innerHTML + 1;
        }
        element.style.left = (pipe_props.left - move_speed) + 'px';
      }
    });
  }
}
function endGame() {
  game_state = 'End';
  message.innerHTML = 'Game Over!';
  message.style.left = '20vw';
  start_btn.classList.remove('hidden');
  start_btn.innerHTML = 'Restart Game';
  flySound.pause();
  catchSound.pause();
  flySound.currentTime = 0;
  catchSound.currentTime = 0;
  follower1.classList.add('hidden');
  follower2.classList.add('hidden');
  // Lose sound x3
  loseSound.currentTime = 0;
  let playCount = 0;
  loseSound.play();
  loseSound.addEventListener('ended', function handler() {
    playCount++;
    if (playCount < 3) {
      loseSound.currentTime = 0;
      loseSound.play();
    } else {
      loseSound.removeEventListener('ended', handler);
    }
  }, { once: true });
}
// === Followers - Clamped to Viewport ===
function moveFollowers() {
  let f1TargetY = 0;
  let f2TargetY = 0;
  const isMobile = window.innerWidth <= 768;
  const lerp = isMobile ? 0.08 : 0.05; // Tighter on mobile
  const offset1 = isMobile ? 50 : 100;
  const offset2 = isMobile ? 90 : 180;
  function updateFollowers() {
    if (game_state !== 'Play') return;
    let birdRect = bird.getBoundingClientRect();
    let birdX = birdRect.left;
    let birdY = birdRect.top;
    let f1X = parseFloat(follower1.style.left || '0');
    let f1Y = parseFloat(follower1.style.top || '0');
    let f2X = parseFloat(follower2.style.left || '0');
    let f2Y = parseFloat(follower2.style.top || '0');
    f1TargetY += (Math.random() - 0.5) * 3;
    f2TargetY += (Math.random() - 0.5) * 3;
    // Calculate targets
    let target1X = birdX - offset1;
    let target1Y = birdY + 30 + f1TargetY;
    let target2X = birdX - offset2;
    let target2Y = birdY + 50 + f2TargetY;
    // CLAMP TO VIEWPORT (prevents out-of-frame)
    target1X = Math.max(0, Math.min(window.innerWidth - 60, target1X)); // 60px = follower width
    target1Y = Math.max(0, Math.min(window.innerHeight - 60, target1Y));
    target2X = Math.max(0, Math.min(window.innerWidth - 50, target2X));
    target2Y = Math.max(0, Math.min(window.innerHeight - 50, target2Y));
    // Smooth lerp
    follower1.style.left = f1X + (target1X - f1X) * lerp + 'px';
    follower1.style.top = f1Y + (target1Y - f1Y) * lerp + 'px';
    follower2.style.left = f2X + (target2X - f2X) * lerp + 'px';
    follower2.style.top = f2Y + (target2Y - f2Y) * lerp + 'px';
    follower1.style.transform = `rotate(${Math.sin(Date.now() / 200) * 5}deg)`;
    follower2.style.transform = `rotate(${Math.cos(Date.now() / 250) * 5}deg)`;
    requestAnimationFrame(updateFollowers);
  }
  requestAnimationFrame(updateFollowers);
}