const FILES = ['idle', 'dizzy', 'sleepy', 'goodnight', 'skate'];

const ALIAS = {
  idle: 'idle',
  stand: 'idle',
  happy: 'idle',
  love: 'idle',
  giggle: 'idle',
  wave: 'idle',
  cuddle: 'idle',
  shy: 'idle',
  choco: 'idle',
  confused: 'dizzy',
  angry: 'dizzy',
  surprised: 'dizzy',
  hot: 'dizzy',
  unhappy: 'dizzy',
  bored: 'sleepy',
  sleepy: 'sleepy',
  goodnight: 'goodnight',
  skate: 'skate',
};

const NAMES = Object.keys(ALIAS);
const BASE_HEIGHT = 0.34;
const BASE_SPRITE_HEIGHT = 471;
const sprite = document.getElementById('sprite');
const flipper = document.getElementById('flipper');
const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const effects = document.getElementById('effects');
const menu = document.getElementById('menu');
const sleepLabel = document.getElementById('sleep-label');
const controller = document.getElementById('controller');
const taskEl = document.getElementById('task');
const taskStateEl = document.getElementById('task-state');
const taskCountEl = document.getElementById('task-count');
const taskTitleEl = document.getElementById('task-title');
const taskDetailEl = document.getElementById('task-detail');
const taskFillEl = document.getElementById('task-fill');
const taskBarEl = taskEl ? taskEl.querySelector('.task-bar') : null;

const sprites = {};

let currentName = 'idle';
let spriteMeta = null;
let userScale = 1;
let onTop = true;
let dir = 1;
let sleeping = false;
let menuOpen = false;
let dragging = false;
let down = null;
let popTimer = null;
let bubbleTimer = null;
let bubbleHideTimer = null;
let fxTimer = null;
let angryTimer = null;
let landTimer = null;
let shiverTimer = null;

const defaultEffects = {
  happy: 'hearts',
  love: 'hearts',
  cuddle: 'hearts',
  giggle: 'sparkle',
  wave: 'sparkle',
  choco: 'sparkle',
  stand: 'sparkle',
  goodnight: 'zzz',
  sleepy: 'zzz',
  confused: 'question',
  surprised: 'exclamation',
  angry: 'anger',
  hot: 'sweat',
  skate: 'sparkle',
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function applyDir() {
  const flip = currentName === 'skate' ? -dir : dir;
  flipper.style.setProperty('--dir', String(flip));
}

function setDir(value) {
  dir = value < 0 ? -1 : 1;
  applyDir();
}

function applyScale() {
  const image = sprites[currentName];
  if (!image) return;
  let height = Math.max(48, Math.round(BASE_SPRITE_HEIGHT * BASE_HEIGHT * userScale));
  const width = image.naturalWidth * (height / image.naturalHeight);
  const maxWidth = window.innerWidth - 20;
  if (width > maxWidth) height = Math.round((height * maxWidth) / width);
  sprite.style.height = `${height}px`;
  const meta = spriteMeta && spriteMeta[currentName];
  if (meta && meta.h) {
    const topGap = (Number(meta.top) / meta.h) * height;
    pet.style.marginTop = `${Math.round(Math.min(0, 6 - topGap))}px`;
  } else {
    pet.style.marginTop = '0px';
  }
}

function bump() {
  if (pet.classList.contains('walking')) return;
  pet.classList.remove('pop');
  void pet.offsetWidth;
  pet.classList.add('pop');
  clearTimeout(popTimer);
  popTimer = setTimeout(() => pet.classList.remove('pop'), 420);
}

function setSprite(name) {
  const image = sprites[name] || sprites.idle;
  if (!image) return;
  currentName = name in ALIAS ? name : 'idle';
  pet.classList.remove('kickflip');
  pet.style.removeProperty('--flip-duration');
  sprite.src = image.src;
  sprite.classList.toggle('skating', currentName === 'skate');
  applyDir();
  applyScale();
  bump();
}

function startKickflip(duration) {
  if (currentName !== 'skate') return;
  const ms = clamp(Number(duration) || 760, 420, 1100);
  pet.style.setProperty('--flip-duration', `${ms}ms`);
  pet.classList.remove('kickflip');
  void pet.offsetWidth;
  pet.classList.add('kickflip');
}

function endKickflip() {
  pet.classList.remove('kickflip');
  pet.style.removeProperty('--flip-duration');
}

function sendBubbleRect() {
  if (bubble.hidden) {
    window.pet.bubbleRect(null);
    return;
  }
  const r = bubble.getBoundingClientRect();
  window.pet.bubbleRect({ x: r.left, y: r.top, w: r.width, h: r.height });
}

function showBubble(text, hold, tag) {
  clearTimeout(bubbleTimer);
  clearTimeout(bubbleHideTimer);
  if (!text) {
    hideBubble();
    return;
  }
  bubble.hidden = false;
  bubble.textContent = '';
  if (tag) {
    const tagEl = document.createElement('span');
    tagEl.className = 'bubble-tag';
    tagEl.textContent = tag;
    const textEl = document.createElement('span');
    textEl.className = 'bubble-text';
    textEl.textContent = text;
    bubble.append(tagEl, textEl);
  } else {
    bubble.textContent = text;
  }
  bubble.classList.remove('show');
  void bubble.offsetWidth;
  bubble.classList.add('show');
  sendBubbleRect();
  setTimeout(sendBubbleRect, 230);
  const ms = clamp(Number(hold) || 3600, 1600, 6000);
  bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubble.classList.remove('show');
  clearTimeout(bubbleHideTimer);
  window.pet.bubbleRect(null);
  bubbleHideTimer = setTimeout(() => {
    if (!bubble.classList.contains('show')) {
      bubble.hidden = true;
      window.pet.bubbleRect(null);
    }
  }, 190);
}

function clearEffects() {
  clearTimeout(fxTimer);
  clearTimeout(angryTimer);
  effects.innerHTML = '';
  effects.dataset.type = '';
  pet.classList.remove('angry');
  pet.classList.remove('shivering');
  clearTimeout(shiverTimer);
}

function makeFx(cls, text) {
  const el = document.createElement('span');
  el.className = `fx ${cls}`;
  if (text) el.textContent = text;
  effects.appendChild(el);
  return el;
}

function setEffect(type, persistent) {
  clearEffects();
  if (!type) return;
  effects.dataset.type = type;

  if (type === 'zzz') {
    makeFx('z z1', 'z');
    makeFx('z z2', 'z');
    makeFx('z z3', 'z');
    if (!persistent) {
      fxTimer = setTimeout(() => {
        if (effects.dataset.type === 'zzz') effects.innerHTML = '';
      }, 2600);
    }
    return;
  }

  if (type === 'hearts') {
    for (let i = 0; i < 5; i += 1) {
      const heart = makeFx('heart', '♥');
      heart.style.left = `${12 + Math.random() * 76}%`;
      heart.style.bottom = `${34 + Math.random() * 28}%`;
      heart.style.fontSize = `${14 + Math.random() * 8}px`;
      heart.style.setProperty('--dx', `${Math.random() * 32 - 16}px`);
      heart.style.animationDelay = `${i * 0.09 + Math.random() * 0.12}s`;
    }
    fxTimer = setTimeout(() => {
      if (effects.dataset.type === 'hearts') effects.innerHTML = '';
    }, 2500);
    return;
  }

  if (type === 'sparkle') {
    for (let i = 0; i < 4; i += 1) {
      const spark = makeFx('spark', '✦');
      spark.style.left = `${4 + Math.random() * 86}%`;
      spark.style.top = `${24 + Math.random() * 40}%`;
      spark.style.fontSize = `${12 + Math.random() * 10}px`;
      spark.style.animationDelay = `${i * 0.1 + Math.random() * 0.1}s`;
    }
    fxTimer = setTimeout(() => {
      if (effects.dataset.type === 'sparkle') effects.innerHTML = '';
    }, 2300);
    return;
  }

  if (type === 'tofu') {
    for (let i = 0; i < 6; i += 1) {
      const tofu = makeFx('tofu', '');
      tofu.style.left = `${8 + Math.random() * 78}%`;
      tofu.style.bottom = `${30 + Math.random() * 32}%`;
      const size = 10 + Math.random() * 8;
      tofu.style.width = `${size}px`;
      tofu.style.height = `${size}px`;
      tofu.style.setProperty('--dx', `${Math.random() * 30 - 15}px`);
      tofu.style.animationDelay = `${i * 0.08 + Math.random() * 0.1}s`;
    }
    fxTimer = setTimeout(() => {
      if (effects.dataset.type === 'tofu') effects.innerHTML = '';
    }, 2600);
    return;
  }

  if (type === 'question') {
    makeFx('question', '?');
  } else if (type === 'exclamation') {
    makeFx('exclaim', '!');
  } else if (type === 'anger') {
    makeFx('anger', '×');
    pet.classList.remove('angry');
    void pet.offsetWidth;
    pet.classList.add('angry');
    angryTimer = setTimeout(() => pet.classList.remove('angry'), 1350);
  } else if (type === 'sweat') {
    makeFx('sweat', '');
  } else if (type === 'shiver') {
    pet.classList.remove('shivering');
    void pet.offsetWidth;
    pet.classList.add('shivering');
    clearTimeout(shiverTimer);
    shiverTimer = setTimeout(() => pet.classList.remove('shivering'), 2400);
  }

  fxTimer = setTimeout(() => {
    effects.innerHTML = '';
    effects.dataset.type = '';
  }, 1800);
}

function spawnDust(impact) {
  if (impact < 480) return;
  for (let i = 0; i < 3; i += 1) {
    const dust = makeFx(`land l${i + 1}`, '');
    dust.style.animationDuration = `${0.4 + Math.random() * 0.15}s`;
  }
}

function updateMenuState() {
  if (sleepLabel) sleepLabel.textContent = sleeping ? '叫醒它' : '睡一觉';
  const check = menu.querySelector('[data-action="toggle-ontop"]');
  if (check) check.classList.toggle('checked', onTop);
  menu.querySelectorAll('.chip').forEach((chip) => {
    const value = Number(chip.dataset.scale);
    chip.classList.toggle('active', Math.abs(value - userScale) < 0.01);
  });
}

function openMenu(x, y) {
  updateMenuState();
  menu.hidden = false;
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const mw = menu.offsetWidth || 208;
  const mh = menu.offsetHeight || 320;
  const left = clamp(x, 8, window.innerWidth - mw - 8);
  let top = y - mh - 12;
  if (top < 8) top = 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - mh - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = '';
  menuOpen = true;
  window.pet.menuState(true);
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menu.hidden = true;
  window.pet.menuState(false);
}

function detachDragListeners() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  if (!down) return;
  if (!dragging) {
    const dist = Math.hypot(e.screenX - down.startX, e.screenY - down.startY);
    if (dist < 10) return;
    dragging = true;
    closeMenu();
    hideBubble();
    pet.classList.add('dragging');
    window.pet.dragStart({ offsetX: down.offsetX, offsetY: down.offsetY });
  }
  window.pet.dragMove({ x: e.screenX, y: e.screenY });
}

function onPointerUp(e) {
  if (!down) return;
  const wasDragging = dragging;
  const id = down.id;
  down = null;
  dragging = false;
  detachDragListeners();
  try {
    sprite.releasePointerCapture(id);
  } catch {
    /* ignore */
  }
  pet.classList.remove('dragging');
  if (wasDragging) {
    window.pet.dragEnd();
  } else {
    window.pet.click();
  }
}

function onPetPointerDown(e) {
  if (e.button !== 0) return;
  if (down) return;
  e.preventDefault();
  closeMenu();
  down = {
    startX: e.screenX,
    startY: e.screenY,
    offsetX: e.clientX,
    offsetY: e.clientY,
    id: e.pointerId,
  };
  try {
    sprite.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function setHidden(data) {
  const on = !!(data && data.on);
  const side = data && data.side === 'right' ? 'right' : 'left';
  document.body.classList.toggle('hide-left', on && side === 'left');
  document.body.classList.toggle('hide-right', on && side === 'right');
  document.body.classList.toggle('hiding', on);
  if (on) {
    closeMenu();
    hideBubble();
  }
}

function setGaming(on) {
  pet.classList.toggle('gaming', !!on);
  if (controller) controller.hidden = !on;
}

function setupEvents() {
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen && !menu.contains(e.target)) closeMenu();
  }, true);

  pet.addEventListener('pointerdown', onPetPointerDown);

  pet.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (dragging) return;
    openMenu(e.clientX, e.clientY);
  });

  bubble.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    hideBubble();
  });

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'scale-small') {
      userScale = 0.8;
      applyScale();
    } else if (action === 'scale-medium') {
      userScale = 1;
      applyScale();
    } else if (action === 'scale-large') {
      userScale = 1.25;
      applyScale();
    }
    closeMenu();
    window.pet.action(action);
  });

  window.pet.onExpress((data) => {
    if (!data || !data.name) return;
    setSprite(data.name);
    const effect = data.effect === undefined ? defaultEffects[data.name] : data.effect;
    setEffect(effect || null, !!data.persistent);
    showBubble(data.speech, data.hold, data.tag);
    if (data.name === 'goodnight' && data.persistent) {
      sleeping = true;
    } else if (data.name !== 'goodnight') {
      sleeping = false;
    }
    updateMenuState();
  });

  window.pet.onWalking((data) => {
    if (data && (data.dir === 1 || data.dir === -1)) setDir(data.dir);
    const moving = !!(data && data.on);
    const running = moving && !!data.run;
    pet.classList.toggle('walking', moving && !running);
    pet.classList.toggle('running', running);
    if (moving) {
      pet.classList.remove('pop');
      closeMenu();
    }
  });

  window.pet.onFacing((data) => {
    setDir(data && data.dir);
  });

  window.pet.onBubble((data) => {
    if (!data) return;
    showBubble(data.text, data.hold);
  });

  window.pet.onEffect((data) => {
    if (!data || !data.type) return;
    setEffect(data.type, !!data.persistent);
  });

  window.pet.onKickflip((data) => {
    startKickflip(data && data.duration);
  });

  window.pet.onKickflipEnd(() => {
    endKickflip();
  });

  window.pet.onSettings((data) => {
    if (!data) return;
    userScale = Number(data.scale) || 1;
    onTop = !!data.onTop;
    if (data.manifest) spriteMeta = data.manifest;
    applyScale();
    updateMenuState();
  });

  window.pet.onHide((data) => {
    setHidden(data);
  });

  window.pet.onGame((data) => {
    setGaming(data && data.on);
  });

  window.pet.onPeek((data) => {
    const on = !!(data && data.on);
    const side = Number(data && data.side) < 0 ? 'left' : 'right';
    document.body.classList.toggle('peek', on);
    document.body.classList.toggle('peek-left', on && side === 'left');
    document.body.classList.toggle('peek-right', on && side === 'right');
  });

  window.pet.onTask((data) => {
    if (!data || !data.state) {
      taskEl.hidden = true;
      return;
    }
    const labels = {
      thinking: '思考中',
      working: '执行中',
      waiting: '等待确认',
      done: '完成',
      error: '出错',
    };
    const state = data.state;
    taskEl.hidden = false;
    taskEl.className = `task ${state}`;
    taskStateEl.textContent = `opencode · ${labels[state] || '处理中'}`;

    const progress = data.progress;
    taskEl.classList.remove('indeterminate');
    if (progress && progress.total > 0) {
      const percent = Math.round((progress.done / progress.total) * 100);
      taskCountEl.textContent = `${progress.done}/${progress.total}`;
      taskFillEl.style.width = `${percent}%`;
      if (taskBarEl) taskBarEl.hidden = false;
    } else if (state === 'thinking' || state === 'working' || state === 'waiting') {
      taskCountEl.textContent = '';
      taskEl.classList.add('indeterminate');
      if (taskBarEl) taskBarEl.hidden = false;
    } else {
      taskCountEl.textContent = '';
      taskFillEl.style.width = '0%';
      if (taskBarEl) taskBarEl.hidden = true;
    }

    const taskText = data.task || '';
    taskTitleEl.textContent = taskText ? `任务：${taskText}` : '';
    taskTitleEl.title = taskText;
    taskTitleEl.hidden = !taskText;

    const detail = data.detail || '';
    taskDetailEl.textContent = detail;
    taskDetailEl.hidden = !detail;
  });

  window.pet.onLand((data) => {
    const impact = Number(data && data.impact) || 0;
    pet.classList.remove('landing');
    void pet.offsetWidth;
    pet.classList.add('landing');
    clearTimeout(landTimer);
    landTimer = setTimeout(() => pet.classList.remove('landing'), 500);
    spawnDust(impact);
  });

  window.pet.onResetInput(() => {
    down = null;
    dragging = false;
    detachDragListeners();
    pet.classList.remove('dragging');
    closeMenu();
  });

  window.pet.onCloseMenu(() => closeMenu());
}

function loadSprites() {
  const loaded = {};
  return Promise.all(
    FILES.map(
      (name) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            loaded[name] = image;
            resolve();
          };
          image.onerror = () => resolve();
          image.src = `assets/pet/${name}.png`;
        })
    )
  ).then(() => {
    NAMES.forEach((name) => {
      const file = ALIAS[name] || name;
      if (loaded[file]) sprites[name] = loaded[file];
    });
  });
}

async function boot() {
  setupEvents();
  await loadSprites();
  if (!sprites.idle) return;
  sprite.src = sprites.idle.src;
  applyScale();
  window.pet.loaded();
}

boot();
