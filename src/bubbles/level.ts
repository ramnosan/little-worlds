import { t, mountLanguageSelector } from '../i18n';
import { levelNav } from '../level-nav';
import './style.css';
import { BubbleWorld, BUBBLE_LIMIT } from './physics';
import { BubbleRenderer } from './render';
import { BubbleInteraction } from './interaction';
import { loadBubbleFixture } from './fixtures';

const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="bubble-app">
    <div id="bubble-world"></div><div class="scene-shade" aria-hidden="true"></div>
    <header class="bubble-header studio-header">
      <a class="bubble-brand" href="./" aria-label="${t('Little Worlds home')}"><span class="brand-orbit" aria-hidden="true">◌</span> little<span>worlds</span><sup>®</sup></a>
      ${levelNav('bubbles')}
      <span class="header-note">${t('SMALL EXPERIMENTS. BIG WONDERS.')}</span>
    </header>
    <main class="bubble-main">
      <section class="bubble-intro" aria-labelledby="bubble-title">
        <div class="bubble-eyebrow"><span></span> ${t('LEVEL 02 / BUBBLES')}</div>
        <h1 id="bubble-title">${t('A breath.')}<br>${t('A little')} <em>${t('wonder.')}</em></h1>
        <p>${t('Catch the light in a bubble.')}<br>${t('And let it drift away.')}</p>
        <div class="bubble-goal"><div class="goal-top"><span>${t('YOUR LITTLE GOAL')}</span><span id="goal-count">0 / 12</span></div>
          <p id="goal-description">${t('Create 12 bubbles.')}</p>
          <div class="goal-track" role="progressbar" aria-label="${t('Bubbles created')}" aria-valuemin="0" aria-valuemax="12" aria-valuenow="0"><div id="goal-fill"></div></div>
          <span id="goal-message" role="status" aria-live="polite">${t('One at a time. At your own pace.')}</span>
        </div>
        <div class="bubble-settings">
          <label for="bubble-wind"><span>${t('A gentle breeze')}</span><output id="wind-value">${t('Gentle')}</output></label>
          <input id="bubble-wind" type="range" min="0" max="100" value="45" aria-label="${t('Wind strength')}">
          <div class="wind-labels"><span>${t('Still')}</span><span>${t('Lively')}</span></div>
          <button id="bubble-quality" class="text-button" aria-pressed="false">◌ &nbsp; ${t('Lighter graphics')}</button>
        </div>
      </section>
      <div class="scene-caption" aria-hidden="true"><span class="live-light"></span> ${t('GOLDEN HOUR')} <span class="caption-line"></span> 17:42</div>
      <section class="blow-controls" aria-label="${t('Create bubbles')}">
        <div class="blow-hint" id="blow-hint">${t('Hold. Let it grow. Release.')}</div>
        <button id="blow" aria-label="${t('Blow a bubble')}" aria-describedby="blow-hint"><span class="blow-icon" aria-hidden="true">◯<i>◦</i></span><span id="blow-label">${t('Blow a bubble')}</span><kbd>${t('SPACE')}</kbd><span id="blow-meter"></span></button>
        <p id="interaction-hint">${t('The longer you blow, the bigger the bubble.')}</p>
      </section>
      <div class="bubble-toolbar"><button id="bubble-darts" aria-pressed="false" aria-label="${t('Throw darts')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 20 13-13m-4 0 3-4 1 4 4 1-4 3-4-4ZM4 20l2-5 3 3-5 2Z"/></svg><span>${t('Throw darts')}</span></button><span></span><button id="bubble-pause" aria-label="${t('Pause simulation')}">Ⅱ <span>${t('Pause')}</span></button><span></span><button id="bubble-reset">↻ <span>${t('Reset')}</span></button></div>
      <div class="bubble-status"><span class="live-light"></span><span id="bubble-count">${t('bubble.other', { count: 6 })}</span><span id="dart-count" hidden>${t('dart.other', { count: 0 })}</span></div>
      <div class="bubble-notice" id="bubble-notice" role="status" aria-live="polite"></div>
    </main>
    <footer class="bubble-footer"><span>${t('A fleeting moment.')} <em>${t('Just for you.')}</em></span><span>${t('LEFT-DRAG: MOVE BUBBLE · CLICK: POP · RIGHT-DRAG: ORBIT · SCROLL: ZOOM')} <span>✳</span></span></footer>
  </div>`;

mountLanguageSelector(root);

const el = (id: string) => document.getElementById(id)!;
const world = new BubbleWorld();
let view: BubbleRenderer;
try {
  view = new BubbleRenderer(el('bubble-world'));
} catch (error) {
  el('bubble-world').innerHTML =
    `<div class="bubble-error" role="alert">${t('Bubbles needs WebGL 2. Please enable hardware acceleration and reload the page.')}</div>`;
  root
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')
    .forEach((b) => (b.disabled = true));
  throw error;
}
world.onPop = (b) => view.pop(b);
const interaction = new BubbleInteraction(
  view,
  (id) => {
    if (world.paused) return;
    world.pop(id);
    updateUI();
  },
  (x, y) => {
    if (world.paused) return;
    const shot = view.dartShot(x, y);
    if (!world.throwDart(shot.origin, shot.direction))
      notice(t('All darts are in flight. You can throw again shortly.'));
  },
  world,
);
const abort = new AbortController();
const signal = abort.signal;
const blow = el('blow') as HTMLButtonElement;
let holding = false,
  heldTime = 0,
  frame = 0,
  last = performance.now(),
  reduced = false;
let dartMode = false;
let source: 'pointer' | 'keyboard' | null = null;
let noticeTimer: ReturnType<typeof setTimeout>;
function notice(message: string) {
  el('bubble-notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el('bubble-notice').textContent = ''), 3200);
}
function updateUI() {
  el('dart-count').hidden = !dartMode && world.darts.hits === 0;
  el('dart-count').textContent =
    `· ${t(world.darts.hits === 1 ? 'dart.one' : 'dart.other', { count: world.darts.hits })}`;
  el('goal-count').textContent = `${Math.min(world.created, 12)} / 12`;
  el('goal-fill').style.width = `${Math.min(world.created / 12, 1) * 100}%`;
  root
    .querySelector('.goal-track')!
    .setAttribute('aria-valuenow', String(Math.min(world.created, 12)));
  el('goal-description').textContent =
    world.created >= 12 ? t('A dozen little wonders.') : t('Create 12 bubbles.');
  el('goal-message').textContent =
    world.created >= 12
      ? t('Goal reached. You can keep blowing bubbles.')
      : t('One at a time. At your own pace.');
  el('bubble-count').textContent = world.paused
    ? t('Time stands still')
    : t(world.bubbles.length === 1 ? 'bubble.one' : 'bubble.other', {
        count: world.bubbles.length,
      });
  blow.disabled = world.paused || world.bubbles.length >= BUBBLE_LIMIT;
  el('bubble-pause').innerHTML = world.paused
    ? `▷ <span>${t('Resume')}</span>`
    : `Ⅱ <span>${t('Pause')}</span>`;
  el('bubble-pause').setAttribute(
    'aria-label',
    world.paused ? t('Resume simulation') : t('Pause simulation'),
  );
}
function radius() {
  return Math.min(1.12, 0.22 + Math.pow(heldTime, 0.72) * 0.53);
}
function begin(input: 'pointer' | 'keyboard') {
  if (holding || world.paused || world.bubbles.length >= BUBBLE_LIMIT) return;
  holding = true;
  heldTime = 0;
  source = input;
  blow.classList.add('is-blowing');
  el('blow-label').textContent = t('And … blow');
}
function cancel() {
  holding = false;
  source = null;
  heldTime = 0;
  blow.classList.remove('is-blowing');
  el('blow-label').textContent = t('Blow a bubble');
  el('blow-meter').style.width = '0%';
  view.setPreview(0, world.time);
}
function release() {
  if (!holding) return;
  const r = radius();
  const origin = view.origin();
  origin[1] += r * 0.22;
  origin[2] -= r * 0.35;
  world.spawn(r, origin);
  cancel();
  updateUI();
}
function single() {
  if (world.paused || holding) return;
  if (!world.spawn(0.45, view.origin()))
    notice(t('32 bubbles are already dancing. Pop one to blow another.'));
  updateUI();
}
function pause() {
  cancel();
  interaction.cancel();
  world.paused = !world.paused;
  updateUI();
}
function reset() {
  cancel();
  world.reset();
  view.clear();
  interaction.reset();
  setDartMode(false);
  reduced = false;
  world.setQuality(false);
  view.quality(false);
  el('bubble-quality').setAttribute('aria-pressed', 'false');
  (el('bubble-wind') as HTMLInputElement).value = '45';
  el('wind-value').textContent = t('Gentle');
  // Decorative opening bubbles demonstrate the film without advancing the player's goal.
  const initial: [number, [number, number, number]][] =
    window.innerWidth < 700
      ? [
          [0.74, [1.0, 0.0, 0]],
          [0.36, [1.7, 1.35, -1.1]],
          [0.28, [2.4, 0.4, -2]],
          [0.4, [0.0, -0.75, 0.6]],
          [0.2, [1.5, -1.35, -1]],
          [0.23, [2.25, -1.2, 0.2]],
        ]
      : [
          [1.05, [2.05, 2.15, 0]],
          [0.7, [-0.15, 3.35, -1.1]],
          [0.48, [3.9, 3.45, -2]],
          [0.63, [3.65, 0.35, 0.6]],
          [0.28, [1.0, 4.4, -1]],
          [0.32, [-0.7, 0.45, 0.2]],
        ];
  for (const [r, p] of initial) {
    const b = world.spawn(r, p, false)!;
    b.age = 2;
  }
  updateUI();
}

function setDartMode(enabled: boolean) {
  cancel();
  dartMode = enabled;
  view.dartMode = enabled;
  interaction.setDartMode(enabled);
  el('bubble-darts').setAttribute('aria-pressed', String(enabled));
  el('bubble-darts').setAttribute('aria-label', enabled ? t('Put down darts') : t('Throw darts'));
  el('bubble-darts').querySelector('span')!.textContent = enabled
    ? t('Put down darts')
    : t('Throw darts');
  el('interaction-hint').textContent = enabled
    ? t('Aim and click / tap to throw. Right-drag to orbit.')
    : t('The longer you blow, the bigger the bubble.');
  updateUI();
}
el('bubble-darts').addEventListener('click', () => setDartMode(!dartMode), { signal });

// Explicit touch taps keep the toolbar responsive immediately after a canvas gesture.
// Cancel the compatibility click so each action still runs exactly once.
root.querySelectorAll<HTMLButtonElement>('.bubble-toolbar button').forEach((button) => {
  let start: { x: number; y: number } | null = null;
  button.addEventListener(
    'touchstart',
    (e) => {
      start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    { signal, passive: true },
  );
  button.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (
        !t ||
        e.touches.length !== 1 ||
        (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8)
      )
        start = null;
    },
    { signal, passive: true },
  );
  button.addEventListener(
    'touchcancel',
    () => {
      start = null;
    },
    { signal },
  );
  button.addEventListener(
    'touchend',
    (e) => {
      const began = start;
      start = null;
      const t = e.changedTouches[0],
        r = button.getBoundingClientRect();
      if (
        !began ||
        !t ||
        e.touches.length ||
        button.disabled ||
        Math.hypot(t.clientX - began.x, t.clientY - began.y) > 8 ||
        t.clientX < r.left ||
        t.clientX > r.right ||
        t.clientY < r.top ||
        t.clientY > r.bottom
      )
        return;
      e.preventDefault();
      button.focus({ preventScroll: true });
      button.click();
    },
    { signal, passive: false },
  );
});

blow.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0) return;
    begin('pointer');
    if (holding) blow.setPointerCapture(e.pointerId);
  },
  { signal },
);
blow.addEventListener(
  'pointerup',
  () => {
    if (source === 'pointer') release();
  },
  { signal },
);
blow.addEventListener('pointercancel', cancel, { signal });
blow.addEventListener(
  'lostpointercapture',
  () => {
    if (holding && source === 'pointer') cancel();
  },
  { signal },
);
// Assistive technologies dispatch a click without pointer/keyboard events.
blow.addEventListener(
  'click',
  (e) => {
    if (e.detail === 0 && !holding) single();
  },
  { signal },
);
el('bubble-pause').addEventListener('click', pause, { signal });
el('bubble-reset').addEventListener(
  'click',
  () => {
    reset();
    notice(t('A fresh moment.'));
  },
  { signal },
);
el('bubble-wind').addEventListener(
  'input',
  (e) => {
    world.wind = Number((e.target as HTMLInputElement).value) / 100;
    el('wind-value').textContent =
      world.wind === 0
        ? t('Still')
        : world.wind < 0.35
          ? t('Barely there')
          : world.wind < 0.7
            ? t('Gentle')
            : t('Lively');
  },
  { signal },
);
el('bubble-quality').addEventListener(
  'click',
  () => {
    reduced = !reduced;
    world.setQuality(reduced);
    view.quality(reduced);
    el('bubble-quality').setAttribute('aria-pressed', String(reduced));
  },
  { signal },
);
function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches('input,select,textarea,a') ||
      target.isContentEditable ||
      (target instanceof HTMLButtonElement && target !== blow))
  );
}
document.addEventListener(
  'keydown',
  (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
    if (e.code === 'Space' || (e.code === 'Enter' && e.target === blow)) {
      e.preventDefault();
      if (!e.repeat) begin('keyboard');
    } else if (!e.repeat && e.key.toLowerCase() === 'n') single();
    else if (!e.repeat && e.key.toLowerCase() === 'p') pause();
    else if (!e.repeat && e.key.toLowerCase() === 'd') setDartMode(!dartMode);
    else if (e.code === 'Escape') {
      cancel();
      interaction.cancel();
      if (dartMode) setDartMode(false);
    }
  },
  { signal },
);
document.addEventListener(
  'keyup',
  (e) => {
    if ((e.code === 'Space' || e.code === 'Enter') && source === 'keyboard') {
      e.preventDefault();
      release();
    }
  },
  { signal },
);
window.addEventListener('blur', cancel, { signal });
document.addEventListener(
  'visibilitychange',
  () => {
    cancel();
    last = performance.now();
  },
  { signal },
);
view.renderer.domElement.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault();
    cancel();
    interaction.cancel();
    world.paused = true;
    updateUI();
    notice(t('Graphics interrupted. Please reload the page.'));
  },
  { signal },
);
reset();
let animationRate = 1;
if (import.meta.env.DEV) {
  const query = new URLSearchParams(location.search);
  if (query.get('bubbleQuality') === 'light' && query.has('bubbleFixture')) {
    world.setQuality(true);
    reduced = true;
    view.quality(true);
    el('bubble-quality').setAttribute('aria-pressed', 'true');
  }
  if (
    loadBubbleFixture(
      world,
      query.get('bubbleFixture'),
      innerWidth < 700,
      query.has('bubbleProgress') ? Number(query.get('bubbleProgress')) : undefined,
    )
  ) {
    if (query.get('bubbleSlow') === '1') animationRate = 0.2;
    updateUI();
  }
}
let previousCount = world.bubbles.length,
  previousHits = 0;
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const delta = Math.min((now - last) / 1000, 0.1) * animationRate;
  last = now;
  if (document.hidden) return;
  if (holding && !world.paused) {
    heldTime += delta;
    view.setPreview(radius(), world.time);
    el('blow-meter').style.width = `${Math.min(heldTime / 2.1, 1) * 100}%`;
  }
  world.advance(delta);
  interaction.update();
  view.sync(world, world.paused ? 0 : delta);
  if (previousCount !== world.bubbles.length || previousHits !== world.darts.hits) {
    updateUI();
    previousCount = world.bubbles.length;
    previousHits = world.darts.hits;
  }
}
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV) {
  window.__bubbleDebug = () => ({
    created: world.created,
    paused: world.paused,
    time: world.time,
    holding,
    dartMode,
    drag: world.dragState,
    darts: world.darts.projectiles.map((d) => ({
      ...d,
      position: [...d.position],
      velocity: [...d.velocity],
    })),
    dartsThrown: world.darts.thrown,
    dartHits: world.darts.hits,
    camera: view.camera.position.toArray(),
    target: interaction.controls.target.toArray(),
    bonds: world.bonds,
    sharedFilms: world.sharedFilms,
    fusions: world.fusions,
    fusionResources: world.fusionResources,
    fusionMotion: world.fusionMotion,
    bubbles: world.bubbles.map((b) => ({
      ...b,
      deformationAxis: [...b.deformationAxis],
      position: [...b.position],
      velocity: [...b.velocity],
      contacts: b.contacts.map((c) => ({
        normal: [...c.normal],
        offset: c.offset,
        region: c.region ? { center: [...c.region.center], radius: c.region.radius } : undefined,
      })),
      screen: (() => {
        const p = view.camera.position.clone().fromArray(b.position).project(view.camera);
        const rect = view.renderer.domElement.getBoundingClientRect();
        return {
          x: rect.left + ((p.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - p.y) * rect.height) / 2,
        };
      })(),
    })),
    memory: { ...view.renderer.info.memory },
  });
}
declare global {
  interface Window {
    __bubbleDebug: () => {
      created: number;
      paused: boolean;
      time: number;
      holding: boolean;
      dartMode: boolean;
      drag: BubbleWorld['dragState'];
      darts: { id: number; position: number[]; velocity: number[]; age: number }[];
      dartsThrown: number;
      dartHits: number;
      camera: number[];
      target: number[];
      bonds: ReturnType<BubbleWorld['bonds']['slice']>;
      sharedFilms: BubbleWorld['sharedFilms'];
      fusions: BubbleWorld['fusions'];
      fusionResources: BubbleWorld['fusionResources'];
      fusionMotion: BubbleWorld['fusionMotion'];
      bubbles: {
        id: number;
        position: number[];
        velocity: number[];
        radius: number;
        age: number;
        deformation: number;
        contacts: { normal: number[]; offset: number }[];
        screen: { x: number; y: number };
      }[];
      memory: { geometries: number; textures: number };
    };
  }
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    clearTimeout(noticeTimer);
    abort.abort();
    interaction.dispose();
    view.dispose();
    world.dispose();
    delete (window as Partial<Window>).__bubbleDebug;
  });
