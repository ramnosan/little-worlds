import { t, mountLanguageSelector } from '../i18n';
import { levelNav } from '../level-nav';
import './style.css';
import { AquariumWorld, BALL_LIMIT } from './physics';
import { AquariumRenderer } from './render';
import { readMode, saveMode } from './mode';

const root = document.getElementById('app')!;
root.innerHTML = `<div class="aquarium-app">
  <header class="aq-header studio-header"><a class="aq-brand" href="./" aria-label="${t('Little Worlds home')}"><span class="aq-mark">◌</span> little<span>worlds</span><sup>®</sup></a>
    ${levelNav('aquarium')}
    <span class="aq-edition">${t('SMALL EXPERIMENTS. BIG WONDERS.')}</span></header>
  <main>
    <section class="aq-intro"><p class="aq-eyebrow"><span></span> ${t('LEVEL 03 / AQUARIUM')}</p>
      <h1>${t('A little sea.')}<br><em>${t('In your hands.')}</em></h1>
      <p class="aq-description">${t('Touch the water. Watch the waves.')}<br>${t('And let the everyday drift away.')}</p>
    </section>
    <div class="aq-scene" id="aquarium-world"></div>
    <div class="aq-specimen" aria-hidden="true"><span>${t('03 — GLASS TANK')}</span><i></i><span>${t('LIGHT · WATER · MOVEMENT')}</span></div>
    <aside class="aq-settings" aria-label="${t('Aquarium settings')}">
      <div class="aq-panel-title"><span>${t('YOUR LITTLE SEA')}</span><span>≈</span></div>
      <div class="aq-light-controls"><label for="aq-time">${t('aq.time')} <output id="aq-time-value">15:00</output></label>
      <input id="aq-time" type="range" min="0" max="1439" value="900" aria-label="${t('aq.time')}">
      <button id="aq-cycle" class="aq-toggle" aria-pressed="true"><span>${t('aq.cycle')}</span><i></i></button></div>
      <label for="aq-strength">${t('Wave strength')} <output id="aq-strength-value">45%</output></label>
      <input id="aq-strength" type="range" min="0" max="100" value="45">
      <div class="aq-range-labels"><span>${t('Gentle')}</span><span>${t('Lively')}</span></div>
      <label for="aq-damping">${t('Settling')} <output id="aq-damping-value">55%</output></label>
      <input id="aq-damping" type="range" min="0" max="100" value="55">
      <div class="aq-range-labels"><span>${t('Lasting waves')}</span><span>${t('Quickly calm')}</span></div>
      <button id="aq-waves" class="aq-toggle" aria-pressed="true"><span>${t('Gentle waves')}</span><i></i></button>
      <button id="aq-ball" class="aq-ball">＋ ${t('Add a floating ball')} <kbd>N</kbd></button>
      <p class="aq-panel-note">${t('A little splash. A growing circle.')}</p>
      <button id="aq-quality" class="aq-quality" aria-pressed="false">◌ &nbsp; ${t('aq.graphicsHigh')}</button>
    </aside>
    <div class="aq-bottom"><div class="aq-hint"><span class="aq-ripple-icon">◎</span><span>${t('Make little circles.')}<small>${t('Click & drag to move the water.')}</small></span></div>
      <div class="aq-toolbar"><button id="aq-ripple" aria-label="${t('Make a wave')}" aria-describedby="aq-charge-hint">◎ <span>${t('Make a wave')}</span></button><span class="aq-divider"></span><button id="aq-pause" aria-label="${t('Pause simulation')}">Ⅱ <span>${t('Pause')}</span></button><span class="aq-divider"></span><button id="aq-reset">↻ <span>${t('Reset')}</span></button></div>
      <p id="aq-charge-hint" class="aq-charge-hint">${t('Hold to charge · Release for a wave')}</p>
      <div class="aq-status"><span class="aq-live"></span><span id="aq-status">${t('Water in motion')}</span><span id="aq-count">${t('ball.other', { count: 0, limit: BALL_LIMIT })}</span><span id="aq-koi-status" role="status">${t('Loading koi …')}</span><button id="aq-koi-retry" hidden>${t('Try again')}</button></div>
    </div>
    <p id="aq-notice" class="aq-notice" role="status" aria-live="polite"></p>
  </main>
  <footer class="aq-footer"><span>${t('A little peace.')} <em>${t('Wave by wave.')}</em> · <a href="./models/koi/credits.html" target="_blank" rel="noopener">Koi: 7PLUS · CC BY 4.0</a></span><span>${t('RIGHT-DRAG: ORBIT · SCROLL: ZOOM')} <b>✳</b></span></footer>
</div>`;
mountLanguageSelector(root);

const el = (id: string) => document.getElementById(id)!;
const world = new AquariumWorld();
let view: AquariumRenderer;
let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  /* A session-only choice remains available. */
}
const initialMode = readMode(storage);
try {
  view = new AquariumRenderer(el('aquarium-world'), world, { mode: initialMode });
} catch (error) {
  el('aquarium-world').innerHTML =
    `<div class="aq-error" role="alert">${t('Aquarium needs WebGL 2. Please enable hardware acceleration and reload the page.')}</div>`;
  root
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')
    .forEach((e) => (e.disabled = true));
  throw error;
}
const abort = new AbortController(),
  signal = abort.signal;
let frame = 0,
  last = performance.now(),
  reduced = initialMode === 'efficient',
  contextLost = false;
let drag: number | null = null,
  touchStart: { id: number; x: number; y: number } | null = null,
  lastRipple = 0;
const touchPointers = new Set<number>();
let noticeTimer: ReturnType<typeof setTimeout>;
const canvas = view.renderer.domElement;
const rippleButton = el('aq-ripple') as HTMLButtonElement;
const rippleLabel = rippleButton.querySelector('span')!;
let chargeStart: number | null = null;
let chargeInput: number | string | null = null;
function chargeAmount(now = performance.now()) {
  return chargeStart === null ? 0 : Math.min(1, Math.max(0, (now - chargeStart) / 4000));
}
function updateCharge(now: number) {
  const amount = chargeAmount(now);
  rippleButton.style.setProperty('--charge', String(amount));
  rippleLabel.textContent =
    chargeStart === null
      ? t('Make a wave')
      : t('wave.charge', { amount: Math.round(amount * 100) });
}
function cancelCharge() {
  const pointer = chargeInput;
  chargeStart = null;
  chargeInput = null;
  rippleButton.classList.remove('is-charging');
  if (typeof pointer === 'number' && rippleButton.hasPointerCapture(pointer))
    rippleButton.releasePointerCapture(pointer);
  updateCharge(performance.now());
}
function startCharge(input: number | string) {
  if (rippleButton.disabled || chargeStart !== null) return;
  chargeStart = performance.now();
  chargeInput = input;
  rippleButton.classList.add('is-charging');
  updateCharge(chargeStart);
}
function releaseCharge() {
  if (chargeStart === null) return;
  const amount = chargeAmount();
  cancelCharge();
  if (!world.paused && !contextLost) world.ripple(0, 0, amount);
}
function notice(message: string) {
  el('aq-notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el('aq-notice').textContent = ''), 3000);
}
function cancel() {
  cancelCharge();
  if (drag !== null && canvas.hasPointerCapture(drag)) canvas.releasePointerCapture(drag);
  drag = null;
  touchStart = null;
  touchPointers.clear();
}
function sync() {
  el('aq-waves').setAttribute('aria-pressed', String(world.waveMaker));
  el('aq-quality').setAttribute('aria-pressed', String(reduced));
  el('aq-quality').textContent = t(reduced ? 'aq.graphicsEfficient' : 'aq.graphicsHigh');
  view.invalidate();
  el('aq-pause').innerHTML = world.paused
    ? `▷ <span>${t('Resume')}</span>`
    : `Ⅱ <span>${t('Pause')}</span>`;
  el('aq-pause').setAttribute(
    'aria-label',
    world.paused ? t('Resume simulation') : t('Pause simulation'),
  );
  el('aq-status').textContent = world.paused ? t('Time stands still') : t('Water in motion');
  el('aq-count').textContent = t(world.balls.length === 1 ? 'ball.one' : 'ball.other', {
    count: world.balls.length,
    limit: BALL_LIMIT,
  });
  (el('aq-ball') as HTMLButtonElement).disabled =
    world.paused || world.balls.length >= BALL_LIMIT || contextLost;
  (el('aq-ripple') as HTMLButtonElement).disabled = world.paused || contextLost;
  for (const name of ['strength', 'damping'] as const) {
    (el(`aq-${name}`) as HTMLInputElement).value = String(Math.round(world[name] * 100));
    el(`aq-${name}-value`).textContent = `${Math.round(world[name] * 100)}%`;
  }
}
function pause() {
  if (contextLost) return;
  cancel();
  world.paused = !world.paused;
  sync();
}
function addBall() {
  if (world.addBall()) {
    sync();
    notice(t('A little ball takes a dip.'));
  }
}
function reset() {
  if (contextLost) return;
  cancel();
  world.reset();
  view.lighting.reset();
  view.invalidate();
  view.resetCamera();
  sync();
  notice(t('Everything is calm again.'));
}
function on(id: string, callback: () => void) {
  el(id).addEventListener('click', callback, { signal });
}
on('aq-pause', pause);
on('aq-ball', addBall);
on('aq-cycle', () => {
  view.lighting.automatic = !view.lighting.automatic;
  syncLighting();
});
el('aq-time').addEventListener(
  'input',
  (event) => {
    view.lighting.setTime(Number((event.target as HTMLInputElement).value) / 1440);
    syncLighting();
  },
  { signal },
);
function syncLighting() {
  const minutes = Math.floor(view.lighting.phase * 1440 + 1e-7);
  const label = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  (el('aq-time') as HTMLInputElement).value = String(minutes);
  el('aq-time').setAttribute('aria-valuetext', label);
  el('aq-time-value').textContent = label;
  el('aq-cycle').setAttribute('aria-pressed', String(view.lighting.automatic));
}
rippleButton.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0 || !e.isPrimary || rippleButton.disabled || chargeStart !== null) return;
    startCharge(e.pointerId);
    rippleButton.setPointerCapture(e.pointerId);
  },
  { signal },
);
rippleButton.addEventListener(
  'pointerup',
  (e) => {
    if (chargeInput === e.pointerId) releaseCharge();
  },
  { signal },
);
for (const type of ['pointercancel', 'lostpointercapture'] as const)
  rippleButton.addEventListener(
    type,
    (e) => {
      if (chargeInput === e.pointerId) cancelCharge();
    },
    { signal },
  );
rippleButton.addEventListener(
  'keydown',
  (e) => {
    if (e.code === 'Escape') cancelCharge();
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) startCharge(e.code);
  },
  { signal },
);
rippleButton.addEventListener(
  'keyup',
  (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    if (chargeInput === e.code) releaseCharge();
  },
  { signal },
);
rippleButton.addEventListener('blur', cancelCharge, { signal });
rippleButton.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
rippleButton.addEventListener(
  'click',
  (e) => {
    // Assistive activation has no preceding hold; pointer/keyboard releases already fired.
    if (e.detail === 0 && chargeStart === null && !rippleButton.disabled) world.ripple(0, 0);
  },
  { signal },
);
on('aq-reset', reset);
on('aq-koi-retry', () => {
  if (!contextLost) void view.koi.load(reduced);
});
view.koi.onStatus = () => {
  const { status, count } = view.koi.snapshot();
  el('aq-koi-status').textContent = count
    ? t('koi.count', { count })
    : status === 'loading'
      ? t('Loading koi …')
      : t('Koi unavailable');
  const retry = el('aq-koi-retry') as HTMLButtonElement;
  retry.hidden = status !== 'error' && status !== 'unavailable';
  retry.disabled = contextLost;
};
export const ready = Promise.all([view.ready, view.koi.load(reduced)]);
on('aq-waves', () => {
  world.waveMaker = !world.waveMaker;
  sync();
});
on('aq-quality', () => {
  reduced = !reduced;
  view.quality(reduced);
  saveMode(reduced ? 'efficient' : 'high', storage);
  sync();
});
for (const name of ['strength', 'damping'] as const)
  el(`aq-${name}`).addEventListener(
    'input',
    (event) => {
      world[name] = Number((event.target as HTMLInputElement).value) / 100;
      sync();
    },
    { signal },
  );
function disturb(x: number, y: number) {
  const hit = view.pick(x, y);
  if (hit) world.ripple(hit.x, hit.z);
}
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType === 'touch') {
      touchPointers.add(e.pointerId);
      touchStart =
        touchPointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
      return;
    }
    if (e.button !== 0 || world.paused) return;
    drag = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    disturb(e.clientX, e.clientY);
    lastRipple = performance.now();
  },
  { signal },
);
canvas.addEventListener(
  'pointermove',
  (e) => {
    if (touchStart && Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) > 9)
      touchStart = null;
    if (e.pointerId === drag && performance.now() - lastRipple > 35) {
      disturb(e.clientX, e.clientY);
      lastRipple = performance.now();
    }
  },
  { signal },
);
canvas.addEventListener(
  'pointerup',
  (e) => {
    if (touchStart?.id === e.pointerId && touchPointers.size === 1) disturb(e.clientX, e.clientY);
    touchPointers.delete(e.pointerId);
    touchStart = null;
    if (e.pointerId === drag) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      drag = null;
    }
  },
  { signal },
);
canvas.addEventListener('pointercancel', cancel, { signal });
canvas.addEventListener(
  'lostpointercapture',
  () => {
    drag = null;
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
document.addEventListener(
  'keydown',
  (e) => {
    if (
      e.repeat ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLButtonElement ||
      e.target instanceof HTMLAnchorElement
    )
      return;
    if (e.code === 'Space') {
      e.preventDefault();
      pause();
    } else if (e.key.toLowerCase() === 'n') addBall();
    else if (e.key.toLowerCase() === 'r') reset();
  },
  { signal },
);
canvas.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault();
    contextLost = true;
    world.paused = true;
    cancel();
    sync();
    root
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')
      .forEach((e) => (e.disabled = true));
    el('aq-notice').textContent = t('Graphics paused. Reload the page to restore the playground.');
    clearTimeout(noticeTimer);
  },
  { signal },
);
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const delta = (now - last) / 1000;
  last = now;
  if (document.hidden || contextLost) return;
  if (chargeStart !== null) updateCharge(now);
  world.advance(delta);
  view.lighting.advance(Math.min(delta, 0.1), world.paused);
  syncLighting();
  view.render(now);
}
sync();
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV) {
  Object.assign(window, {
    __aquariumDebug: () => ({
      ...world.stats(),
      camera: view.camera.position.toArray(),
      drawCalls: view.renderer.info.render.calls,
      geometries: view.renderer.info.memory.geometries,
      textures: view.renderer.info.memory.textures,
      koi: { ...view.koi.snapshot(), fish: world.koi.snapshot(), enabled: world.koi.enabled },
      lighting: view.lighting.snapshot(),
      rendering: view.renderingSnapshot(),
    }),
  });
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    clearTimeout(noticeTimer);
    cancel();
    abort.abort();
    view.dispose();
    delete (window as unknown as Record<string, unknown>).__aquariumDebug;
  });
