const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const WIN_W = 360;
const WIN_H = 460;
const GRAVITY = 2200;
const BASE_HEIGHT = 0.35;
const PET_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'assets', 'pet', 'manifest.json'), 'utf8')
);
app.setName('花东');

let win = null;
let tray = null;
let mode = 'idle';
let cfg = { x: null, scale: 1, energy: 82, onTop: true };
let loopTimer = null;
let behaviorTimer = null;
let exprTimer = null;
let energyTimer = null;
let lastTick = Date.now();
let lastScreenCheck = 0;
let sleepSince = 0;
let lastUserAction = Date.now();
let clickTimes = [];
let revealed = false;
let pointerEnabled = false;
let menuOpen = false;
let bubbleBox = null;
let currentSprite = 'idle';
let facing = 1;
let taskInfo = null;
let taskSig = '';
let taskHideTimer = null;
let taskPollTimer = null;
let taskActive = false;
let taskLastStamp = 0;
let taskMissingSince = 0;
let darkMode = false;
let darkStay = false;
let darkTimer = null;
let attentionTop = false;
let attentionTimer = null;
let walk = { targetX: 0, dir: 1, speed: 72, wa: null, endAt: 0, run: false };
let fall = { vx: 0, vy: 0, ground: 0 };
let jump = { vx: 0, vy: 0, ground: 0, wa: null };
let skate = {
  startX: 0,
  endX: 0,
  dir: 1,
  startedAt: 0,
  duration: 0,
  ground: 0,
  hopStart: 0,
  hopDuration: 0,
  hopDone: false,
  hopEnded: false,
};
let drag = { active: false, offsetX: 0, offsetY: 0, samples: [] };
const alphaCache = new Map();

const idleLines = [
  '嘤嘤，姐姐在忙什么呀？',
  '姐姐，我在这里哦。',
  '嘤嘤……姐姐看我一眼嘛。',
  '姐姐，今天也一起待着吧。',
  '姐姐的世界里，有没有我呀？',
  '嘤嘤，好想一直跟着姐姐。',
];

const darkLines = [
  '哼，别烦我。',
  '再戳我就咬你。',
  '我现在不想理你。',
  '离我远点……',
  '烦死了。',
  '别碰我。',
  '只喜欢我一个人吧...',
  '我的世界里只有你...',
  '不要抛下我...',
  '只看着我...',
  '好喜欢姐姐...',
];

const petLines = {
  happy: ['嘤嘤，好舒服～', '姐姐再摸摸～', '好喜欢姐姐...', '嘤嘤，今天也最喜欢姐姐。'],
  love: ['最喜欢姐姐了。', '抱抱姐姐！', '嘤嘤，想和姐姐贴贴。'],
  giggle: ['嘻嘻，痒痒的。', '嘤嘤，姐姐今天心情好吗？'],
  wave: ['嘤嘤，姐姐好！', '看见姐姐啦～', '姐姐回来啦～'],
  cuddle: ['陪姐姐再待一会儿嘛。', '靠着姐姐真安心。'],
};

const feedLines = [
  '🎵I hate it ～but I love it～🎵',
];
const veggieLines = [
  '小虫！嘤嘤，谢谢姐姐！',
  '姐姐怎么知道我喜欢这个～',
  '再来一只好不好？',
];
const sleepLines = ['姐姐晚安……嘤嘤。', '晚安姐姐，要梦见我哦。', '姐姐，我困了，眯一下下。'];
const wakeLines = ['唔……姐姐，我睡醒了。', '再睡五分钟……姐姐等等我。', '姐姐早，伸个懒腰～'];
const angryLines = ['只看着我...', '不要抛下我...', '嘤嘤……姐姐别不理我。'];
const grabLines = ['姐姐，要去哪儿？', '不要抛下我...', '姐姐轻点轻点～'];
const landLines = ['呜……姐姐，屁股疼。', '姐姐，安全落地！', '吓我一跳……姐姐。'];
const runLines = ['嘤嘤，跑起来啦～', '姐姐看我跑得快不快！', '冲呀！'];
const tiredLines = ['呼……跑累了。', '姐姐，我跑不动了……', '要喝水……'];
const jumpLines = ['跳！', '姐姐看我跳得高不高！', '嘤～'];
const skateStartLines = ['滑板时间！嘤嘤～', '姐姐看我滑板～', '出发咯！', '看我的滑板！'];
const skateEndLines = ['滑完啦～', '姐姐，我滑得好不好？', '还想再滑一次！', '稳稳落地！'];

const TASK_EXPRESSION = {
  thinking: 'confused',
  working: 'hot',
  waiting: 'surprised',
  done: 'happy',
  error: 'angry',
};

const TASK_EFFECT = {
  thinking: 'question',
  working: 'sweat',
  waiting: 'exclamation',
  done: 'hearts',
  error: 'anger',
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isNight() {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function loadConfig() {
  try {
    const file = path.join(app.getPath('userData'), 'config.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg = { ...cfg, ...raw };
  } catch {
    /* first run */
  }
}

function saveConfig() {
  try {
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      if (Number.isFinite(b.x)) cfg.x = b.x;
    }
    cfg.energy = Math.round(cfg.energy);
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
  } catch {
    /* non fatal */
  }
}

function groundFor(wa) {
  return wa.y + wa.height - WIN_H;
}

function displayForWindow() {
  const b = win.getBounds();
  return screen.getDisplayNearestPoint({
    x: Math.round(b.x + WIN_W / 2),
    y: Math.round(b.y + WIN_H / 2),
  });
}

function workAreaForWindow() {
  return displayForWindow().workArea;
}

function isOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX >= 80 && overlapY >= 80;
  });
}

function ensureOnScreen() {
  if (!win || win.isDestroyed() || drag.active) return;
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  const b = win.getBounds();
  if (isOnAnyDisplay(b)) return;

  const display = screen.getDisplayNearestPoint({
    x: Math.round(b.x + WIN_W / 2),
    y: Math.round(b.y + WIN_H / 2),
  });
  const wa = display.workArea;
  const nx = clamp(b.x, wa.x, wa.x + wa.width - WIN_W);
  const ny = clamp(b.y, wa.y, groundFor(wa));
  win.setPosition(Math.round(nx), Math.round(ny), false);
  stopWalk();
  saveConfig();
}

function positionInitial() {
  let display = screen.getPrimaryDisplay();
  if (Number.isFinite(cfg.x)) {
    const primary = display.workArea;
    display = screen.getDisplayNearestPoint({
      x: Math.round(cfg.x + WIN_W / 2),
      y: primary.y + primary.height - 40,
    });
  }
  const wa = display.workArea;
  const fallbackX = wa.x + wa.width - WIN_W - 40;
  const x = clamp(Number.isFinite(cfg.x) ? cfg.x : fallbackX, wa.x, wa.x + wa.width - WIN_W);
  win.setBounds({
    x: Math.round(x),
    y: groundFor(wa),
    width: WIN_W,
    height: WIN_H,
  });
}

function express(name, { speech = null, effect, hold = 3000, persistent = false, keepSpeech = false } = {}) {
  const displayName = darkMode ? 'back' : name;
  const finalSpeech = darkMode && !keepSpeech && speech ? pick(darkLines) : speech;
  const finalEffect = darkMode && (effect === 'hearts' || effect === 'sparkle') ? 'dark' : effect;
  currentSprite = displayName;
  send('pet:express', {
    name: displayName,
    speech: finalSpeech,
    effect: finalEffect,
    hold,
    persistent,
    sleeping: name === 'goodnight',
  });
  clearTimeout(exprTimer);
  exprTimer = null;
  if (persistent) return;
  exprTimer = setTimeout(() => {
    if (mode === 'sleep' || mode === 'drag' || mode === 'fall' || mode === 'jump') return;
    send('pet:express', {
      name: darkMode ? 'back' : 'idle',
      speech: null,
      effect: null,
      hold: 0,
      persistent: false,
      sleeping: false,
    });
  }, hold);
}

function clearDark() {
  darkMode = false;
  darkStay = false;
  clearTimeout(darkTimer);
  darkTimer = null;
}

function showLight(speech = null, effect = null, hold = 0) {
  clearDark();
  express('idle', { speech, effect, hold });
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function showDark(speech = null, effect = 'dark', hold = 6000, stay = false) {
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  if (mode === 'sleep') wake();
  stopWalk();
  darkMode = true;
  darkStay = stay;
  clearTimeout(darkTimer);
  express('back', { speech, effect, hold, persistent: true, keepSpeech: true });
  if (!stay) {
    darkTimer = setTimeout(() => {
      if (darkMode && mode === 'idle') showLight();
    }, hold);
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function toggleFlip() {
  ensureVisible();
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  if (mode === 'sleep') wake();
  stopWalk();
  if (darkMode) {
    showLight('嘤嘤……姐姐还是喜欢正面的我吧。', 'hearts', 2600);
  } else {
    showDark(pick(darkLines), 'dark', 6500, true);
  }
  scheduleBehavior();
}

function setWalking(on, dir, run = false) {
  send('pet:walking', { on, dir, run });
}

function sendSettings() {
  send('pet:settings', { scale: cfg.scale, onTop: cfg.onTop });
}

function taskFilePath() {
  return path.join(app.getPath('userData'), 'opencode-status.json');
}

function clearTask() {
  clearTimeout(taskHideTimer);
  taskHideTimer = null;
  const hadTask = !!taskInfo;
  const wasTaskSprite = Object.values(TASK_EXPRESSION).includes(currentSprite);
  taskInfo = null;
  taskSig = '';
  taskActive = false;
  taskMissingSince = 0;
  if (attentionTop && !cfg.onTop) {
    clearTimeout(attentionTimer);
    attentionTop = false;
    win?.setAlwaysOnTop(false);
  }
  send('pet:task', null);
  if (hadTask && wasTaskSprite && mode === 'idle') {
    express('idle', { speech: null, effect: null, hold: 0 });
  }
}

function applyTask(data) {
  const state = ['thinking', 'working', 'waiting', 'done', 'error'].includes(data.state)
    ? data.state
    : 'working';
  const active = state === 'thinking' || state === 'working' || state === 'waiting';
  let progress = null;
  if (data.progress && Number(data.progress.total) > 0) {
    const total = Math.max(0, Math.floor(Number(data.progress.total)));
    const done = Math.min(total, Math.max(0, Math.floor(Number(data.progress.done) || 0)));
    progress = {
      done,
      total,
      current: typeof data.progress.current === 'string' ? data.progress.current : '',
    };
  }
  const message = typeof data.message === 'string' ? data.message : '';
  const task = typeof data.task === 'string' ? data.task : '';
  const detail = typeof data.detail === 'string' ? data.detail : progress?.current || '';
  taskInfo = { state, message, task, detail, progress };
  taskActive = active;
  if (!darkStay) clearDark();
  send('pet:task', { state, message, task, detail, progress });

  clearTimeout(taskHideTimer);
  taskHideTimer = null;
  if (!active) {
    taskHideTimer = setTimeout(
      () => {
        if (taskInfo && taskInfo.state === state) clearTask();
      },
      15000
    );
  }

  const sig = [state, message, task, detail, progress?.done, progress?.total].join('|');
  if (sig === taskSig) return;
  taskSig = sig;

  if (mode === 'sleep') wake();
  stopWalk();
  express(TASK_EXPRESSION[state], {
    speech: message || null,
    effect: TASK_EFFECT[state],
    hold: active ? 5200 : state === 'done' ? 6000 : 4000,
    persistent: active,
    keepSpeech: true,
  });

  if (state === 'waiting') {
    showForAttention();
  } else if (attentionTop && !cfg.onTop) {
    clearTimeout(attentionTimer);
    attentionTop = false;
    win?.setAlwaysOnTop(false);
  }
}

function pollTask() {
  if (!revealed || !win || win.isDestroyed()) return;
  let raw;
  try {
    raw = fs.readFileSync(taskFilePath(), 'utf8');
  } catch {
    if (!taskInfo) return;
    if (!taskMissingSince) taskMissingSince = Date.now();
    else if (Date.now() - taskMissingSince > 20000) clearTask();
    return;
  }
  taskMissingSince = 0;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (!data || typeof data !== 'object') return;
  if (!data.state || data.state === 'idle') {
    if (taskInfo) clearTask();
    return;
  }

  const stamp = Number(data.updatedAt) || 0;
  if (stamp <= taskLastStamp) return;
  taskLastStamp = stamp;

  const active = ['thinking', 'working', 'waiting'].includes(data.state);
  const age = Date.now() - stamp;
  if (age > (active ? 10 * 60 * 1000 : 60 * 1000)) {
    if (taskInfo) clearTask();
    return;
  }
  applyTask(data);
}

function stopWalk() {
  stopSkate();
  if (mode === 'walk' || mode === 'run') {
    mode = 'idle';
    setWalking(false);
    saveConfig();
  }
}

function startWalk() {
  if (!revealed || drag.active || mode === 'sleep' || mode === 'drag' || mode === 'fall' || mode === 'jump') {
    return;
  }
  stopWalk();
  if (!darkStay) clearDark();
  const wa = workAreaForWindow();
  const minX = wa.x + 6;
  const maxX = wa.x + wa.width - WIN_W - 6;
  if (maxX <= minX) return;
  const b = win.getBounds();
  let target = Math.round(minX + Math.random() * (maxX - minX));
  if (Math.abs(target - b.x) < 130) {
    target = b.x > (minX + maxX) / 2 ? minX : maxX;
  }
  walk = {
    targetX: clamp(target, minX, maxX),
    dir: target > b.x ? 1 : -1,
    speed: 58 + Math.random() * 42,
    wa,
    endAt: Date.now() + 15000,
    run: false,
  };
  facing = walk.dir;
  mode = 'walk';
  setWalking(true, walk.dir, false);
  express('idle', { speech: Math.random() < 0.4 ? '去那边看看～' : null, hold: 2200 });
}

function startRun() {
  if (!revealed || drag.active || mode === 'sleep' || mode === 'drag' || mode === 'fall' || mode === 'jump') {
    return;
  }
  stopWalk();
  if (!darkStay) clearDark();
  const wa = workAreaForWindow();
  const minX = wa.x + 4;
  const maxX = wa.x + wa.width - WIN_W - 4;
  if (maxX <= minX) return;
  const b = win.getBounds();
  const target = b.x > (minX + maxX) / 2 ? minX : maxX;
  const duration = 2200 + Math.random() * 1800;
  walk = {
    targetX: target,
    dir: target > b.x ? 1 : -1,
    speed: 190 + Math.random() * 85,
    wa,
    endAt: Date.now() + duration,
    run: true,
  };
  facing = walk.dir;
  mode = 'run';
  setWalking(true, walk.dir, true);
  express('happy', { speech: pick(runLines), effect: 'sparkle', hold: duration + 250 });
}

function startJump() {
  if (!revealed || drag.active || mode === 'sleep' || mode === 'drag' || mode === 'fall' || mode === 'jump') {
    return;
  }
  stopWalk();
  if (!darkStay) clearDark();
  const wa = workAreaForWindow();
  const ground = groundFor(wa);
  const b = win.getBounds();
  if (b.y !== ground) win.setPosition(b.x, ground, false);
  jump = {
    vy: -640,
    vx: facing * (45 + Math.random() * 65),
    ground,
    wa,
  };
  mode = 'jump';
  setWalking(false);
  express('giggle', { speech: pick(jumpLines), effect: 'sparkle', hold: 2400 });
}

function finishWalk(nx, wa) {
  const wasRun = walk.run;
  mode = 'idle';
  setWalking(false);
  win.setPosition(Math.round(nx), groundFor(wa), false);
  if (wasRun) {
    express('hot', { speech: pick(tiredLines), effect: 'sweat', hold: 2600 });
  } else {
    express('idle', {
      speech: Math.random() < 0.3 ? '到了！' : null,
      hold: 1600,
    });
  }
  saveConfig();
}

function finishJump() {
  const impact = Math.abs(jump.vy);
  mode = 'idle';
  setWalking(false);
  const wa = workAreaForWindow();
  const b = win.getBounds();
  win.setPosition(
    Math.round(clamp(b.x, wa.x, wa.x + wa.width - WIN_W)),
    Math.round(groundFor(wa)),
    false
  );
  send('pet:land', { impact });
  express('happy', { speech: pick(jumpLines), effect: 'sparkle', hold: 1900 });
  saveConfig();
}

function setFacing(next) {
  facing = next < 0 ? -1 : 1;
  send('pet:facing', { dir: facing });
}

function stopSkate() {
  if (mode !== 'skate') return;
  mode = 'idle';
}

function startSkate() {
  ensureVisible();
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  if (mode === 'sleep') wake();
  stopWalk();
  stopSkate();
  if (!darkStay) clearDark();

  const wa = workAreaForWindow();
  const b = win.getBounds();
  const minX = wa.x;
  const maxX = wa.x + wa.width - WIN_W;
  const ground = groundFor(wa);
  const roomRight = maxX - b.x;
  const roomLeft = b.x - minX;

  let dir = Math.random() < 0.5 ? 1 : -1;
  if (roomRight < 180 && roomLeft > roomRight) dir = -1;
  else if (roomLeft < 180 && roomRight > roomLeft) dir = 1;

  const room = dir > 0 ? roomRight : roomLeft;
  const distance = Math.max(0, Math.min(room, 320 + Math.random() * 640));
  const duration = clamp(800 + (distance / 175) * 1000, 1400, 7200);
  const hopAt = 0.38 + Math.random() * 0.2;
  const hopDuration = clamp(duration * 0.22, 520, 760);
  const hopStart = clamp(duration * hopAt, 200, duration - hopDuration - 80);
  const startedAt = Date.now();

  skate = {
    startX: b.x,
    endX: clamp(b.x + dir * distance, minX, maxX),
    dir,
    startedAt,
    duration,
    ground,
    hopStart: startedAt + hopStart,
    hopDuration,
    hopDone: false,
    hopEnded: false,
  };

  mode = 'skate';
  setFacing(dir);
  win.setPosition(Math.round(b.x), ground, false);
  express('skate', {
    speech: pick(skateStartLines),
    effect: 'sparkle',
    hold: 3400,
    persistent: true,
  });
}

function finishSkate() {
  if (mode !== 'skate') return;
  mode = 'idle';
  win.setPosition(Math.round(skate.endX), skate.ground, false);
  express('happy', {
    speech: pick(skateEndLines),
    effect: 'sparkle',
    hold: 2600,
  });
  saveConfig();
  scheduleBehavior();
}

function petClick(fromMenu = false) {
  lastUserAction = Date.now();
  scheduleBehavior();
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  if (mode === 'sleep') {
    wake();
    return;
  }
  stopWalk();
  if (darkMode) {
    cfg.energy = Math.min(100, cfg.energy + 0.4);
    showDark(pick(darkLines), 'dark', 5200, darkStay);
    return;
  }
  const now = Date.now();
  if (!fromMenu) {
    clickTimes = clickTimes.filter((t) => now - t < 2600);
    clickTimes.push(now);
    if (clickTimes.length >= 5) {
      showDark(pick(angryLines), 'dark', 5200);
      return;
    }
  }
  cfg.energy = Math.min(100, cfg.energy + 0.4);
  const name = pick(['happy', 'love', 'giggle', 'wave', 'cuddle']);
  const effect = ['happy', 'love', 'cuddle'].includes(name) ? 'hearts' : 'sparkle';
  express(name, { speech: pick(petLines[name]), effect, hold: 2800 });
}

function feed() {
  ensureVisible();
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  if (mode === 'sleep') wake();
  stopWalk();
  if (!darkStay) clearDark();
  mode = 'idle';
  cfg.energy = Math.min(100, cfg.energy + 28);
  express('snack', { speech: pick(feedLines), effect: 'sparkle', hold: 4200 });
  scheduleBehavior();
}

function feedVeggies() {
  ensureVisible();
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  if (mode === 'sleep') wake();
  stopWalk();
  if (!darkStay) clearDark();
  mode = 'idle';
  cfg.energy = Math.min(100, cfg.energy + 34);
  express('happy', { speech: pick(veggieLines), effect: 'sparkle', hold: 4200 });
  scheduleBehavior();
}

function goSleep(auto = false) {
  if (mode === 'drag' || mode === 'fall' || mode === 'jump') return;
  stopWalk();
  if (!darkStay) clearDark();
  mode = 'sleep';
  sleepSince = Date.now();
  express('goodnight', {
    speech: auto ? '姐姐，我困了，先睡一下……' : pick(sleepLines),
    effect: 'zzz',
    persistent: true,
    hold: 6000,
  });
  setWalking(false);
}

function wake() {
  if (mode !== 'sleep') return;
  mode = 'idle';
  cfg.energy = Math.max(cfg.energy, 40);
  express('sleepy', { speech: pick(wakeLines), hold: 2600 });
}

function toggleSleep() {
  ensureVisible();
  if (mode === 'sleep') wake();
  else goSleep(false);
}

function startFall() {
  drag.active = false;
  const b = win.getBounds();
  const wa = workAreaForWindow();
  const ground = groundFor(wa);
  const nx = clamp(b.x, wa.x, wa.x + wa.width - WIN_W);
  let ny = b.y;

  let vx = 0;
  let vy = 0;
  const samples = drag.samples;
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt > 0.02) {
      vx = (last.x - first.x) / dt;
      vy = (last.y - first.y) / dt;
    }
  }
  drag.samples = [];

  if (ny > ground) ny = ground;

  if (ny >= ground - 2 && Math.abs(vy) < 160) {
    mode = 'idle';
    win.setPosition(Math.round(nx), ground, false);
    express('hot', { speech: '放我下来啦～', hold: 2200 });
    saveConfig();
    return;
  }

  mode = 'fall';
  fall = {
    vx: clamp(vx * 0.45, -1500, 1500),
    vy: clamp(vy * 0.25, -300, 900),
    ground,
  };
  win.setPosition(Math.round(nx), Math.round(ny), false);
  express('surprised', {
    speech: Math.abs(fall.vy) > 260 || Math.abs(fall.vx) > 400 ? '哇啊啊——！' : '嘿咻！',
    effect: 'exclamation',
    hold: 5000,
  });
}

function land() {
  const impact = fall.vy;
  mode = 'idle';
  const wa = workAreaForWindow();
  const b = win.getBounds();
  fall = { vx: 0, vy: 0, ground: groundFor(wa) };
  win.setPosition(
    Math.round(clamp(b.x, wa.x, wa.x + wa.width - WIN_W)),
    Math.round(fall.ground),
    false
  );
  if (impact > 1250) {
    express('angry', { speech: pick(landLines), effect: 'anger', hold: 2800 });
  } else {
    express('surprised', { speech: '安全落地！', effect: 'sparkle', hold: 1900 });
  }
  send('pet:land', { impact });
  saveConfig();
}

function tick() {
  if (!win || win.isDestroyed() || !revealed) return;
  const now = Date.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt > 0.08) dt = 0.08;
  if (dt <= 0) return;
  if (!win.isVisible()) return;
  updatePointer();
  if (drag.active || mode === 'drag') return;

  if (now - socialLastWrite > 1000) {
    socialLastWrite = now;
    writePresence();
    checkSocial(now);
  }

  if (now - lastScreenCheck > 1200) {
    lastScreenCheck = now;
    ensureOnScreen();
  }

  if (mode === 'walk' || mode === 'run') {
    const b = win.getBounds();
    const wa = walk.wa || workAreaForWindow();
    const minX = wa.x;
    const maxX = wa.x + wa.width - WIN_W;
    let nx = b.x + walk.dir * walk.speed * dt;
    const done =
      Date.now() > walk.endAt ||
      (walk.dir > 0 && nx >= walk.targetX) ||
      (walk.dir < 0 && nx <= walk.targetX) ||
      nx <= minX ||
      nx >= maxX;
    if (done) {
      nx = clamp(walk.dir > 0 ? Math.min(nx, walk.targetX) : Math.max(nx, walk.targetX), minX, maxX);
      finishWalk(nx, wa);
    } else {
      win.setPosition(Math.round(nx), groundFor(wa), false);
    }
  } else if (mode === 'jump') {
    const b = win.getBounds();
    const wa = workAreaForWindow();
    const ground = groundFor(wa);
    jump.vy += GRAVITY * dt;
    let nx = b.x + jump.vx * dt;
    let ny = b.y + jump.vy * dt;
    if (nx < wa.x) {
      nx = wa.x;
      jump.vx = 0;
    } else if (nx > wa.x + wa.width - WIN_W) {
      nx = wa.x + wa.width - WIN_W;
      jump.vx = 0;
    }
    if (ny >= ground) {
      ny = ground;
      win.setPosition(Math.round(nx), Math.round(ny), false);
      finishJump();
    } else {
      win.setPosition(Math.round(nx), Math.round(ny), false);
    }
  } else if (mode === 'fall') {
    const b = win.getBounds();
    const wa = workAreaForWindow();
    const ground = groundFor(wa);
    fall.ground = ground;
    fall.vy += GRAVITY * dt;
    fall.vx *= Math.pow(0.35, dt);
    let nx = b.x + fall.vx * dt;
    let ny = b.y + fall.vy * dt;
    if (nx < wa.x) {
      nx = wa.x;
      fall.vx = Math.abs(fall.vx) * 0.35;
    } else if (nx > wa.x + wa.width - WIN_W) {
      nx = wa.x + wa.width - WIN_W;
      fall.vx = -Math.abs(fall.vx) * 0.35;
    }
    if (ny >= ground) {
      ny = ground;
      win.setPosition(Math.round(nx), Math.round(ny), false);
      land();
    } else {
      win.setPosition(Math.round(nx), Math.round(ny), false);
    }
  } else if (mode === 'skate') {
    const progress = clamp((now - skate.startedAt) / skate.duration, 0, 1);
    const eased =
      progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const nx = skate.startX + (skate.endX - skate.startX) * eased;
    let ny = skate.ground;

    const hopT = (now - skate.hopStart) / skate.hopDuration;
    if (hopT > 0 && hopT < 1) {
      ny -= Math.sin(Math.PI * hopT) * 82;
      if (!skate.hopDone) {
        skate.hopDone = true;
        send('pet:effect', { type: 'sparkle' });
        send('pet:bubble', { text: '尖翻！', hold: 1600 });
        send('pet:kickflip', { duration: skate.hopDuration });
      }
    } else if (skate.hopDone && !skate.hopEnded) {
      skate.hopEnded = true;
      send('pet:kickflip-end');
      send('pet:effect', { type: 'sparkle' });
    }

    if (progress >= 1) {
      win.setPosition(Math.round(skate.endX), skate.ground, false);
      finishSkate();
    } else {
      win.setPosition(Math.round(nx), Math.round(ny), false);
    }
  }
}

function idleBehavior() {
  if (Date.now() < socialQuietUntil) {
    scheduleBehavior();
    return;
  }

  if (revealed && mode === 'idle' && !drag.active) {
    if (taskActive) {
      scheduleBehavior();
      return;
    }
    if (currentSprite === 'skate' || (darkMode && !darkStay)) {
      scheduleBehavior();
      return;
    }
    const r = Math.random();
    const d = isNight() ? 0.3 : 0.16;
    if ((isNight() && r < 0.32) || (cfg.energy < 28 && r < 0.5)) {
      goSleep(true);
    } else if (r < d) {
      showDark(pick(darkLines), 'dark', 5200 + Math.random() * 3200, darkStay);
    } else if (r < d + 0.08) {
      startWalk();
    } else if (r < d + 0.14) {
      startRun();
    } else if (r < d + 0.2) {
      startJump();
    } else if (r < d + 0.3) {
      express('sleepy', { speech: '哈啊……姐姐，我有点困。嘤嘤。', effect: 'zzz', hold: 2600 });
    } else if (r < d + 0.38) {
      express('bored', { speech: '好无聊……姐姐陪我玩嘛。', hold: 2800 });
    } else if (r < d + 0.44) {
      express('confused', { speech: '嗯？姐姐你在忙吗？', effect: 'question', hold: 2600 });
    } else if (r < d + 0.5) {
      express('hot', { speech: '好热……姐姐，我想吃蓝莓。', effect: 'sweat', hold: 2600 });
    } else if (r < d + 0.56) {
      express('cuddle', { speech: '姐姐陪我待一会儿吧。', effect: 'hearts', hold: 3000 });
    } else if (r < d + 0.62) {
      express('giggle', { speech: '想到开心的事！嘤嘤。', effect: 'sparkle', hold: 2600 });
    } else {
      express('idle', { speech: pick(idleLines), hold: 3600 });
    }
  }
  scheduleBehavior();
}

const SOCIAL_ID = 'huadong';
const SOCIAL_NAME = '花东';
const socialLines = {"tuxuan": ["兔玹，要一起散步吗？", "兔玹，你在忙什么？", "兔玹，一起玩吧。"], "jiuwang": ["啾汪，别闹。", "啾汪，一起玩吧。", "啾汪，你好呀。"], "default": ["一起玩吗？", "你好呀。"]};
const socialDarkLines = {"tuxuan": ["兔玹，别靠过来。", "姐姐是我的。", "哼，你也在啊。"], "jiuwang": ["啾汪，离我远点。", "别抢姐姐。", "哼。"], "default": ["别靠过来。", "哼。"]};
let socialDir = null;
let socialLastWrite = 0;
let socialCooldownUntil = 0;
let socialQuietUntil = 0;
let socialLastAt = 0;
let socialLastTarget = '';

function getSocialDir() {
  if (!socialDir) {
    socialDir = path.join(app.getPath('appData'), 'desktop-pets');
    fs.mkdirSync(socialDir, { recursive: true });
  }
  return socialDir;
}

function writePresence() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const data = {
    id: SOCIAL_ID,
    name: SOCIAL_NAME,
    x: b.x,
    y: b.y,
    w: WIN_W,
    h: WIN_H,
    mode,
    facing,
    visible: win.isVisible(),
    busy: !!taskActive,
    socialAt: socialLastAt,
    socialTarget: socialLastTarget,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(path.join(getSocialDir(), `social-${SOCIAL_ID}.json`), JSON.stringify(data));
  } catch {}
}

function socialInteract(other, now) {
  const me = win.getBounds();
  const dir = other.x + WIN_W / 2 > me.x + WIN_W / 2 ? 1 : -1;
  setFacing(dir);
  socialCooldownUntil = now + 30000 + Math.random() * 30000;
  socialQuietUntil = now + 4200;
  socialLastAt = now;
  socialLastTarget = other.id || '';
  const isDark = typeof darkMode !== 'undefined' && darkMode;
  const lines = isDark
    ? socialDarkLines[other.id] || socialDarkLines.default
    : socialLines[other.id] || socialLines.default;
  const speech = pick(lines);
  if (isDark) {
    express('back', { speech, effect: 'dark', hold: 3400, keepSpeech: true });
  } else {
    const expr = pick(['happy', 'wave', 'love']);
    express(expr, { speech, effect: expr === 'love' ? 'hearts' : 'sparkle', hold: 3400 });
  }
}

function checkSocial(now) {
  if (!revealed || !win || win.isDestroyed() || !win.isVisible()) return;
  if (drag.active || mode !== 'idle' || taskActive || now < socialCooldownUntil) return;
  let files;
  try {
    files = fs.readdirSync(getSocialDir());
  } catch {
    return;
  }
  const me = win.getBounds();
  const myDisplay = screen.getDisplayNearestPoint({
    x: Math.round(me.x + WIN_W / 2),
    y: Math.round(me.y + WIN_H),
  });
  for (const file of files) {
    if (!file.startsWith('social-') || file === `social-${SOCIAL_ID}.json` || !file.endsWith('.json')) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(getSocialDir(), file), 'utf8'));
    } catch {
      continue;
    }
    if (!data || !data.id || data.id === SOCIAL_ID || data.visible === false || data.busy) continue;
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) continue;
    if (now - Number(data.updatedAt) > 3000) continue;
    if (data.mode !== 'idle') continue;
    const otherDisplay = screen.getDisplayNearestPoint({
      x: Math.round(data.x + WIN_W / 2),
      y: Math.round(data.y + WIN_H),
    });
    if (otherDisplay.id !== myDisplay.id) continue;
    const dx = Math.abs(data.x + WIN_W / 2 - (me.x + WIN_W / 2));
    const dy = Math.abs(data.y + WIN_H - (me.y + WIN_H));
    if (dx < 360 && dy < 80) {
      socialInteract(data, now);
      return;
    }
  }
}

function scheduleBehavior() {
  clearTimeout(behaviorTimer);
  behaviorTimer = setTimeout(idleBehavior, 30000 + Math.random() * 40000);
}

function setScale(scale) {
  cfg.scale = scale;
  sendSettings();
  saveConfig();
}

function setOnTop(onTop) {
  cfg.onTop = !!onTop;
  if (win) {
    win.setAlwaysOnTop(cfg.onTop, 'normal');
    if (cfg.onTop) {
      win.moveTop();
      setTimeout(bringToFront, 100);
    }
  }
  sendSettings();
  saveConfig();
}

function bringToFront() {
  if (!win || win.isDestroyed() || !cfg.onTop) return;
  win.setAlwaysOnTop(true, 'normal');
  win.moveTop();
}

function keepLayered() {
  if (!win || win.isDestroyed()) return;
  try {
    win.setOpacity(0.999);
  } catch {
    /* ignore */
  }
}

function spriteAlpha(name) {
  if (alphaCache.has(name)) return alphaCache.get(name);
  try {
    const image = nativeImage.createFromPath(
      path.join(__dirname, 'assets', 'pet', `${name}.png`)
    );
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const info = { w: size.width, h: size.height, data: image.toBitmap() };
    if (!info.data || info.data.length < info.w * info.h * 4) return null;
    alphaCache.set(name, info);
    return info;
  } catch {
    return null;
  }
}

function pointOverPet(px, py) {
  const info = spriteAlpha(currentSprite);
  if (!info) return false;
  const meta = PET_MANIFEST[currentSprite] || PET_MANIFEST.idle || info;
  const w = meta.w * BASE_HEIGHT * cfg.scale;
  const h = meta.h * BASE_HEIGHT * cfg.scale;
  const left = (WIN_W - w) / 2;
  const top = WIN_H - h;
  if (px < left - 2 || px > left + w + 2 || py < top - 2 || py > top + h + 2) {
    return false;
  }
  let nx = (px - left) / w;
  const ny = (py - top) / h;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;
  const mirrored = currentSprite === 'skate' ? facing > 0 : facing < 0;
  if (mirrored) nx = 1 - nx;
  const ix = clamp(Math.floor(nx * info.w), 0, info.w - 1);
  const iy = clamp(Math.floor(ny * info.h), 0, info.h - 1);
  let maxAlpha = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const ax = clamp(ix + ox, 0, info.w - 1);
      const ay = clamp(iy + oy, 0, info.h - 1);
      maxAlpha = Math.max(maxAlpha, info.data[(ay * info.w + ax) * 4 + 3]);
    }
  }
  return maxAlpha > 18;
}

function pointInBubble(px, py) {
  if (!bubbleBox) return false;
  const { x, y, w, h } = bubbleBox;
  return px >= x - 3 && px <= x + w + 3 && py >= y - 3 && py <= y + h + 3;
}

function setPointerEnabled(next) {
  const value = !!next;
  if (value === pointerEnabled) return;
  pointerEnabled = value;
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!value, { forward: true });
  keepLayered();
  if (value) bringToFront();
}

function updatePointer() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const bounds = win.getBounds();
  const point = screen.getCursorScreenPoint();
  const inside =
    point.x >= bounds.x &&
    point.x < bounds.x + WIN_W &&
    point.y >= bounds.y &&
    point.y < bounds.y + WIN_H;

  if (drag.active) {
    setPointerEnabled(true);
    return;
  }

  if (menuOpen) {
    if (inside) {
      setPointerEnabled(true);
    } else {
      menuOpen = false;
      send('pet:close-menu');
      setPointerEnabled(false);
    }
    return;
  }

  const localX = point.x - bounds.x;
  const localY = point.y - bounds.y;
  const over = inside && (pointOverPet(localX, localY) || pointInBubble(localX, localY));
  setPointerEnabled(over);
}

function ensureVisible() {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  ensureOnScreen();
  bringToFront();
}

function showForAttention() {
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const b = win.getBounds();
  const onDisplay =
    b.x < wa.x + wa.width &&
    b.x + b.width > wa.x &&
    b.y < wa.y + wa.height &&
    b.y + b.height > wa.y;

  if (!onDisplay) {
    const x = clamp(wa.x + wa.width - WIN_W - 40, wa.x, wa.x + wa.width - WIN_W);
    win.setBounds({
      x: Math.round(x),
      y: Math.round(groundFor(wa)),
      width: WIN_W,
      height: WIN_H,
    });
  }

  if (!cfg.onTop) {
    clearTimeout(attentionTimer);
    attentionTop = true;
    win.setAlwaysOnTop(true, 'normal');
    attentionTimer = setTimeout(() => {
      if (attentionTop && !cfg.onTop) {
        attentionTop = false;
        win?.setAlwaysOnTop(false);
      }
    }, 20000);
  }

  ensureVisible();
  keepLayered();
  win.showInactive();
  win.moveTop();
}

function toggleShow() {
  if (!win) return;
  if (win.isVisible()) {
    pointerEnabled = false;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.hide();
  } else {
    ensureVisible();
    pointerEnabled = false;
    win.setIgnoreMouseEvents(true, { forward: true });
    keepLayered();
    send('pet:reset-input');
    setTimeout(bringToFront, 80);
  }
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: win && win.isVisible() ? '隐藏花东' : '显示花东', click: toggleShow },
    { type: 'separator' },
    { label: '摸摸头', click: () => { ensureVisible(); petClick(true); } },
    { label: '喂蓝莓', click: feed },
    { label: '喂小虫', click: feedVeggies },
    { label: mode === 'sleep' ? '叫醒它' : '睡一觉', click: toggleSleep },
    { label: '去散步', click: () => { ensureVisible(); startWalk(); } },
    { label: '跑一跑', click: () => { ensureVisible(); startRun(); } },
    { label: '跳一跳', click: () => { ensureVisible(); startJump(); } },
    { label: '玩滑板', click: startSkate },
    { label: darkMode ? '翻回正面' : '翻个面', click: toggleFlip },
    { type: 'separator' },
    {
      label: '大小',
      submenu: [
        { label: '小', type: 'radio', checked: cfg.scale === 0.8, click: () => setScale(0.8) },
        { label: '中', type: 'radio', checked: cfg.scale === 1, click: () => setScale(1) },
        { label: '大', type: 'radio', checked: cfg.scale === 1.25, click: () => setScale(1.25) },
      ],
    },
    { label: '总在最前', type: 'checkbox', checked: cfg.onTop, click: (item) => setOnTop(item.checked) },
    { type: 'separator' },
    { label: '退出', click: () => { saveConfig(); app.quit(); } },
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  try {
    const size = process.platform === 'darwin' ? 18 : 32;
    icon = nativeImage.createFromPath(iconPath).resize({ width: size, height: size });
  } catch {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('花东 · 桌面宠物');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleShow);
}

function handleAction(action) {
  switch (action) {
    case 'pet':
      ensureVisible();
      petClick(true);
      break;
    case 'feed':
      feed();
      break;
    case 'feed-veggies':
      feedVeggies();
      break;
    case 'sleep':
      toggleSleep();
      break;
    case 'walk':
      ensureVisible();
      startWalk();
      break;
    case 'run':
      ensureVisible();
      startRun();
      break;
    case 'jump':
      ensureVisible();
      startJump();
      break;
    case 'skate':
      startSkate();
      break;
    case 'flip':
      toggleFlip();
      break;
    case 'scale-small':
      setScale(0.8);
      break;
    case 'scale-medium':
      setScale(1);
      break;
    case 'scale-large':
      setScale(1.25);
      break;
    case 'toggle-ontop':
      setOnTop(!cfg.onTop);
      break;
    case 'hide':
      pointerEnabled = false;
      win.setIgnoreMouseEvents(true, { forward: true });
      win.hide();
      if (tray) tray.setContextMenu(buildTrayMenu());
      break;
    case 'quit':
      saveConfig();
      app.quit();
      break;
    default:
      break;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    roundedCorners: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(cfg.onTop, 'normal');
  win.setIgnoreMouseEvents(true, { forward: true });
  pointerEnabled = false;
  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.once('ready-to-show', () => {
    if (revealed) win.showInactive();
  });

  win.on('hide', () => {
    pointerEnabled = false;
    if (tray) tray.setContextMenu(buildTrayMenu());
  });
  win.on('show', () => {
    if (tray) tray.setContextMenu(buildTrayMenu());
  });
  win.on('closed', () => {
    win = null;
  });
}

function reveal() {
  if (revealed) return;
  revealed = true;
  positionInitial();
  win.showInactive();
  keepLayered();
  bringToFront();
  setTimeout(() => {
    keepLayered();
    bringToFront();
  }, 120);
  sendSettings();
  if (isNight()) {
    express('sleepy', { speech: '姐姐这么晚还没睡呀……嘤嘤。', effect: 'zzz', hold: 4000 });
  } else {
    express('wave', { speech: '嘤嘤，姐姐好呀，我是花东～', effect: 'sparkle', hold: 3600 });
  }
  lastTick = Date.now();
  loopTimer = setInterval(tick, 16);
  energyTimer = setInterval(() => {
    if (mode === 'sleep') {
      cfg.energy = Math.min(100, cfg.energy + 1.6);
      const slept = Date.now() - sleepSince;
      if ((slept > 30000 && cfg.energy >= 99) || slept > 240000) wake();
    } else {
      cfg.energy = Math.max(0, cfg.energy - 0.03);
      if (cfg.energy <= 15 && mode === 'idle' && !taskActive && currentSprite !== 'skate') goSleep(true);
    }
  }, 1000);
  taskPollTimer = setInterval(pollTask, 600);
  pollTask();
  scheduleBehavior();
}

ipcMain.on('pet:loaded', () => {
  reveal();
});

ipcMain.on('pet:bubble-rect', (_e, rect) => {
  bubbleBox = rect && rect.w > 0 && rect.h > 0 ? rect : null;
});

ipcMain.on('pet:menu-state', (_e, open) => {
  menuOpen = !!open;
  if (menuOpen) setPointerEnabled(true);
  else updatePointer();
});

ipcMain.on('pet:click', () => {
  petClick();
});

ipcMain.on('pet:drag-start', (_e, info) => {
  if (mode === 'fall' || mode === 'drag') {
    /* still allow grabbing mid-fall */
  }
  const wasDark = darkMode;
  if (!darkStay) clearDark();
  stopWalk();
  mode = 'drag';
  drag.active = true;
  setPointerEnabled(true);
  drag.offsetX = Number(info?.offsetX) || 0;
  drag.offsetY = Number(info?.offsetY) || 0;
  drag.samples = [];
  clearTimeout(exprTimer);
  express('surprised', {
    speech: wasDark ? pick(darkLines) : pick(grabLines),
    effect: 'exclamation',
    hold: 3000,
  });
});

ipcMain.on('pet:drag-move', () => {
  if (!drag.active || !win) return;
  const point = screen.getCursorScreenPoint();
  const x = Math.round(point.x - drag.offsetX);
  const y = Math.round(point.y - drag.offsetY);
  win.setPosition(x, y, false);
  drag.samples.push({ t: Date.now(), x, y });
  if (drag.samples.length > 12) drag.samples.shift();
});

ipcMain.on('pet:drag-end', () => {
  if (!drag.active) return;
  startFall();
});

ipcMain.on('pet:action', (_e, action) => {
  handleAction(action);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    ensureVisible();
    pointerEnabled = false;
    win?.setIgnoreMouseEvents(true, { forward: true });
    updatePointer();
    send('pet:reset-input');
    petClick(true);
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    loadConfig();
    createWindow();
    createTray();
    if (process.argv.includes('--skate-test')) {
      setTimeout(() => startSkate(), 2500);
    }
  });

  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  app.on('before-quit', () => {
    clearInterval(loopTimer);
    clearInterval(energyTimer);
    clearInterval(taskPollTimer);
    clearTimeout(behaviorTimer);
    clearTimeout(exprTimer);
    clearTimeout(taskHideTimer);
    clearTimeout(attentionTimer);
    saveConfig();
  });

  app.on('display-metrics-changed', () => {
    if (!win || !revealed || drag.active) return;
    const b = win.getBounds();
    const wa = workAreaForWindow();
    win.setPosition(
      Math.round(clamp(b.x, wa.x, wa.x + wa.width - WIN_W)),
      Math.min(b.y, groundFor(wa)),
      false
    );
    setTimeout(ensureOnScreen, 400);
  });

  app.on('display-added', () => setTimeout(ensureOnScreen, 400));
  app.on('display-removed', () => setTimeout(ensureOnScreen, 400));
}


