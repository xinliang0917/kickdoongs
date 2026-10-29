const api = window.blocks;
const $ = (sel) => document.querySelector(sel);

const canvas = $('#game');
const ctx = canvas.getContext('2d');
const cheerEl = $('#cheer');
const scoreEl = $('#scoreVal');
const bestEl = $('#bestVal');
const startPanel = $('#startPanel');
const overPanel = $('#overPanel');
const overTitle = $('#overTitle');
const overText = $('#overText');

const BH = 24;
const PALETTE = ['#a9c9ee', '#d2d8e0', '#eef4fb', '#c2d9f2'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

let CW = 400;
let CH = 420;

const game = {
  mode: 'ready',
  blocks: [],
  moving: null,
  falling: null,
  missAnim: null,
  particles: [],
  score: 0,
  best: 0,
  sound: true,
  dir: 1,
  speed: 150,
  submitted: false,
  bestBefore: 0,
  last: 0
};

let audioCtx = null;
let cheerTimer = null;

const sparkChars = ['✦', '✧', '·', '❄'];

function groundY() {
  return CH - 30;
}

function camera() {
  return Math.max(0, game.blocks.length * BH - CH * 0.56);
}

function surfaceY() {
  return groundY() - game.blocks.length * BH + camera();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  CW = rect.width;
  CH = rect.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tone(freq, dur = 0.07, type = 'sine', vol = 0.035, delay = 0) {
  if (!game.sound) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch {
    game.sound = false;
  }
}

function cheer(text, mood = '') {
  cheerEl.textContent = text;
  cheerEl.className = `cheer pop ${mood}`;
  clearTimeout(cheerTimer);
  cheerTimer = setTimeout(() => cheerEl.classList.remove('pop'), 340);
}

function updateScore() {
  game.score = Math.max(0, game.blocks.length - 1);
  scoreEl.textContent = game.score;
}

function paletteFor(index) {
  return PALETTE[index % PALETTE.length];
}

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBlock(x, y, w, h, color, glow = 0) {
  ctx.save();
  if (glow) {
    ctx.shadowColor = 'rgba(120, 165, 225, .85)';
    ctx.shadowBlur = glow;
  } else {
    ctx.shadowColor = 'rgba(50, 80, 130, .18)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;
  }
  roundRect(x, y, w, h, 7);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#242a3d';
  ctx.stroke();

  ctx.save();
  roundRect(x + 4, y + 4, Math.max(0, w - 8), Math.max(4, h * 0.3), 4);
  ctx.fillStyle = 'rgba(255, 255, 255, .48)';
  ctx.fill();
  ctx.restore();

  if (w > 34) {
    ctx.fillStyle = 'rgba(36, 42, 61, .32)';
    [7, w - 7].forEach((dx) => {
      ctx.beginPath();
      ctx.arc(x + dx, y + h / 2, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

function spawnParticles(x, y, count, kind = 'spark') {
  for (let i = 0; i < count; i += 1) {
    game.particles.push({
      x,
      y,
      vx: rand(-80, 80),
      vy: rand(-150, -40),
      life: rand(0.4, 0.9),
      maxLife: 0.9,
      size: rand(2, 4),
      char: kind === 'spark' ? pick(sparkChars) : '·',
      color: pick(['#7fa8e8', '#cfe2ff', '#ffffff', '#a9c9ee'])
    });
  }
}

function startGame() {
  resize();
  const baseW = clamp(CW * 0.32, 96, 148);
  game.blocks = [{ x: (CW - baseW) / 2, w: baseW, color: paletteFor(0) }];
  game.mode = 'playing';
  game.score = 0;
  game.submitted = false;
  game.bestBefore = game.best;
  game.missAnim = null;
  game.particles = [];
  game.dir = chance(0.5) ? 1 : -1;
  game.speed = 150;
  game.moving = {
    x: game.dir > 0 ? 8 : CW - 8 - baseW,
    w: baseW,
    color: paletteFor(1)
  };
  updateScore();
  startPanel.classList.add('hidden');
  overPanel.classList.add('hidden');
  cheer('姐姐加油！呜旻在下面接着，不会让塔倒的！', 'happy');
  tone(523, 0.09);
  tone(784, 0.12, 'sine', 0.03, 0.08);
}

function drop() {
  if (game.mode === 'ready' || game.mode === 'over') {
    startGame();
    return;
  }
  if (game.mode !== 'playing' || !game.moving) return;
  game.falling = {
    ...game.moving,
    y: 22,
    vy: 110
  };
  game.moving = null;
  game.mode = 'falling';
  tone(440, 0.05, 'triangle', 0.03);
}

function shakeCheer() {
  cheerEl.classList.remove('pop');
  void cheerEl.offsetWidth;
  cheerEl.classList.add('pop');
}

function onLanded() {
  const prev = game.blocks[game.blocks.length - 1];
  const f = game.falling;
  const left = Math.max(f.x, prev.x);
  const right = Math.min(f.x + f.w, prev.x + prev.w);
  const overlap = right - left;
  if (overlap < 12) {
    game.falling = null;
    game.missAnim = { x: f.x, y: f.y, w: f.w, vy: 90, vx: f.x + f.w / 2 < CW / 2 ? -120 : 120, rot: 0, color: f.color };
    game.mode = 'over';
    cheer('啊……积木滑下去了。呜旻没有接住……', 'sad');
    tone(330, 0.14, 'triangle', 0.04);
    tone(220, 0.22, 'triangle', 0.04, 0.13);
    setTimeout(showOver, 780);
    return;
  }
  const perfect = Math.abs(left - prev.x) < 4 && Math.abs(overlap - prev.w) < 4;
  game.blocks.push({ x: left, w: overlap, color: f.color });
  game.falling = null;
  updateScore();
  spawnParticles(left + overlap / 2, surfaceY() + BH / 2, perfect ? 10 : 4);
  if (perfect) {
    cheer(pick(['完美对齐！wool！wool！', '分毫不差，姐姐好厉害！', '呜旻看得尾巴都直了！']), 'happy');
    tone(659, 0.08, 'sine', 0.03);
    tone(880, 0.12, 'sine', 0.03, 0.07);
  } else if (overlap < 26) {
    cheer(pick(['好险好险，就差一点点！', '呜旻的心都提到嗓子眼啦。', '这块有点悬，姐姐稳住！']), 'sad');
    shakeCheer();
  } else if (game.score > 0 && game.score % 3 === 0) {
    cheer(pick([`${game.score} 层啦！姐姐真棒！`, '塔越来越高，呜旻仰得脖子都酸了。', '继续继续，呜旻接着呢！']), 'happy');
  }
  game.mode = 'playing';
  game.speed = Math.min(330, 150 + game.score * 13);
  game.moving = {
    x: game.dir > 0 ? 8 : CW - 8 - overlap,
    w: overlap,
    color: paletteFor(game.blocks.length)
  };
}

function showOver() {
  overPanel.classList.remove('hidden');
  const beatBest = game.score > game.best && game.score > 0;
  overTitle.textContent = beatBest ? '新纪录！wool！wool！' : game.score <= 2 ? '呜旻有点难过……' : '塔倒啦……';
  overText.textContent = game.score > 0
    ? `姐姐搭了 ${game.score} 层，最好的一次是 ${Math.max(game.best, game.score)} 层。`
    : '这次一块都没搭上去，再来一次嘛。';
  if (game.score > 0) cheer(beatBest ? '新纪录！呜旻要给姐姐鼓掌！' : '呜旻接着呢……下次一定还能更高！', beatBest ? 'happy' : '');
  if (!game.submitted) {
    game.submitted = true;
    api.submit(game.score).then((res) => {
      if (!res) return;
      game.best = Math.max(game.best, res.best || 0);
      bestEl.textContent = game.best;
      if (res.isBest) {
        overTitle.textContent = '新纪录！wool！wool！';
        overText.textContent = `姐姐搭了 ${game.score} 层，新纪录！呜旻把这一刻记在内存里了。`;
        cheer('新纪录！呜旻要给姐姐鼓掌！', 'happy');
      }
    }).catch(() => {});
  }
}

function update(dt, now) {
  if (game.mode === 'playing' && game.moving) {
    game.moving.x += game.dir * game.speed * dt;
    const maxX = CW - 8 - game.moving.w;
    if (game.moving.x <= 8) {
      game.moving.x = 8;
      game.dir = 1;
    }
    if (game.moving.x >= maxX) {
      game.moving.x = maxX;
      game.dir = -1;
    }
  }

  if (game.mode === 'falling' && game.falling) {
    game.falling.vy += 2500 * dt;
    game.falling.y += game.falling.vy * dt;
    const targetTop = surfaceY() - BH;
    if (game.falling.y >= targetTop) {
      game.falling.y = targetTop;
      onLanded();
    }
  }

  if (game.missAnim) {
    const m = game.missAnim;
    m.vy += 1800 * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.rot += m.vx * dt * 0.02;
    if (m.y > CH + 120) game.missAnim = null;
  }

  game.particles.forEach((p) => {
    p.life -= dt;
    p.vy += 260 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  });
  game.particles = game.particles.filter((p) => p.life > 0);
}

function draw(now) {
  ctx.clearRect(0, 0, CW, CH);
  const gy = groundY();

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#5f86c9';
  ctx.beginPath();
  ctx.ellipse(CW / 2, gy + 10, Math.min(CW * 0.3, 130), 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (game.mode === 'ready') {
    const baseW = clamp(CW * 0.32, 96, 148);
    const floatY = gy - BH + Math.sin(now / 620) * 3;
    drawBlock((CW - baseW) / 2, floatY, baseW, BH, PALETTE[0]);
    const showW = baseW * 0.82;
    drawBlock((CW - showW) / 2, gy - 96 + Math.sin(now / 700 + 1) * 5, showW, BH, PALETTE[1], 10);
  }

  const cam = camera();
  game.blocks.forEach((b, i) => {
    const y = gy - (i + 1) * BH + cam;
    if (y > CH + 30 || y < -40) return;
    drawBlock(b.x, y, b.w, BH, b.color);
  });

  if (game.mode === 'playing' && game.moving) {
    const top = surfaceY();
    ctx.save();
    ctx.strokeStyle = 'rgba(95, 134, 201, .25)';
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(game.moving.x + game.moving.w / 2, 50);
    ctx.lineTo(game.moving.x + game.moving.w / 2, top);
    ctx.stroke();
    ctx.restore();
    drawBlock(game.moving.x, 22, game.moving.w, BH, game.moving.color, 12);
  }

  if (game.falling) {
    drawBlock(game.falling.x, game.falling.y, game.falling.w, BH, game.falling.color);
  }

  if (game.missAnim) {
    const m = game.missAnim;
    ctx.save();
    ctx.translate(m.x + m.w / 2, m.y + BH / 2);
    ctx.rotate(m.rot);
    ctx.globalAlpha = 0.9;
    drawBlock(-m.w / 2, -BH / 2, m.w, BH, m.color);
    ctx.restore();
  }

  game.particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.font = `${p.size * 4}px "Microsoft YaHei UI", sans-serif`;
    ctx.fillText(p.char, p.x, p.y);
    ctx.restore();
  });
}

function loop(now) {
  const dt = Math.min(0.033, (now - (game.last || now)) / 1000);
  game.last = now;
  update(dt, now);
  draw(now);
  requestAnimationFrame(loop);
}

function bind() {
  $('#closeBtn').addEventListener('click', () => api.close());
  $('#startBtn').addEventListener('click', startGame);
  $('#retryBtn').addEventListener('click', startGame);
  canvas.addEventListener('click', () => drop());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (game.mode === 'over') {
        setTimeout(startGame, 60);
      } else {
        drop();
      }
    }
    if (e.key === 'Escape') api.close();
  });
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
}

async function init() {
  bind();
  try {
    const info = await api.load();
    game.best = (info && info.best) || 0;
    game.sound = !info || info.sound !== false;
  } catch {
    game.best = 0;
  }
  bestEl.textContent = game.best;
  resize();
  requestAnimationFrame(loop);
}

init();
