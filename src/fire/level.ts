import { t, mountLanguageSelector } from '../i18n';
import './style.css';
import { levelNav } from '../level-nav';
import { FireWorld, STICK_LIMIT } from './physics';
import { FireRenderer } from './render';
import { FireAudio } from './audio';

const root = document.getElementById('app')!;
root.innerHTML = `<div class="fire-app">
  <header class="fire-header studio-header">
    <a class="fire-brand" href="./" aria-label="${t('Little Worlds home')}"><span class="fire-mark">✳</span> little<span>worlds</span><sup>®</sup></a>
    ${levelNav('fire')}
    <span class="fire-edition">${t('SMALL MOMENTS. GREAT WARMTH.')}</span>
  </header>
  <main>
    <section class="fire-intro"><div><p class="fire-eyebrow"><i></i> ${t('LEVEL 05 / CAMPFIRE')}</p>
      <h1>${t('Stay a while.')}<br><em>${t('The fire is burning.')}</em></h1></div>
      <p>${t('A gentle crackle. A dance of light.')}<br>${t('And for a moment, just be here.')}</p>
    </section>
    <section class="fire-stage" aria-label="${t('Campfire at dusk')}">
      <div id="fire-world" class="fire-world"></div>
      <div class="fire-scene-label" aria-hidden="true"><span><i></i> ${t('BEING OUTSIDE')}</span><span>${t('05 — AT DUSK')}</span></div>
      <div class="fire-perspective" aria-hidden="true">◎ &nbsp; ${t('DRAG TO ORBIT · SCROLL TO ZOOM')}</div>
      <aside class="fire-settings" aria-label="${t('Campfire settings')}">
        <div class="fire-panel-title"><span>${t('YOUR LITTLE FIRE')}</span><span>↗</span></div>
        <div class="fire-readout"><span id="fire-phase">${t('In full flame')}</span><small id="fire-count">${t('wood.other', { count: 9, limit: STICK_LIMIT })}</small></div>
        <button id="fire-add" class="fire-primary">＋ <span>${t('Add wood')}</span><kbd>N</kbd></button>
        <button id="fire-ignite" class="fire-secondary">♧ <span>${t('Ignite')}</span></button>
        <label for="fire-wind">${t('Evening wind')} <output id="fire-wind-value">20%</output></label>
        <input id="fire-wind" type="range" min="0" max="100" step="1" value="20">
        <div class="fire-range"><span>${t('Still')}</span><span>${t('Fresh breeze')}</span></div>
        <p class="fire-note">${t('Wood turns to embers.')}<br>${t('A spark becomes an evening.')}</p>
        <button id="fire-audio" class="fire-option" aria-pressed="false">♫ <span>${t('Turn crackling on')}</span></button>
        <button id="fire-quality" class="fire-option" aria-pressed="false">◌ <span>${t('Lighter graphics')}</span></button>
      </aside>
    </section>
    <div class="fire-bottom"><p><span class="fire-small-flame">♨</span> ${t('A moment of peace.')}<small>${t('Add some wood. Watch the flames.')}</small></p>
      <div class="fire-toolbar"><button id="fire-pause" aria-label="${t('Pause simulation')}">Ⅱ <span>${t('Pause')}</span></button><i></i><button id="fire-reset">↻ <span>${t('Reset')}</span></button></div>
      <span class="fire-status" role="status"><i id="fire-live"></i><span id="fire-status">${t('The fire is alive')}</span></span>
    </div>
    <p id="fire-notice" class="fire-notice" role="alert"></p>
  </main>
  <footer class="fire-footer"><span>${t('Nothing to do.')} <em>${t('Just stay.')}</em></span><span>${t('SPACE: PAUSE · N: WOOD · R: RESET')} <b>✳</b></span></footer>
</div>`;
mountLanguageSelector(root);

const el = (id: string) => document.getElementById(id)!;
const world = new FireWorld();
const audio = new FireAudio();
let view: FireRenderer;
let frame = 0,
  last = performance.now(),
  light = false,
  contextLost = false,
  disposed = false,
  lastSync = -1;
const abort = new AbortController(),
  signal = abort.signal;
if (import.meta.env.DEV) {
  const params = new URLSearchParams(location.search),
    fixture = params.get('fireFixture');
  if (fixture) {
    if (fixture === 'ignition') {
      world.sticks.forEach((s) => {
        s.heat = 0;
        s.flame = 0;
        s.ember = 0;
        s.char = 0;
      });
      world.ignite();
    }
    const seconds =
      fixture === 'collapse'
        ? 140
        : fixture === 'embers'
          ? 200
          : fixture === 'cold'
            ? 270
            : fixture === 'full'
              ? 35
              : 0;
    for (let i = 0; i < seconds * 10; i++) world.advance(0.1);
    world.paused = true;
  }
  light = params.get('fireQuality') === 'light';
}
function disableControls() {
  root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach((i) => {
    i.disabled = true;
  });
}
try {
  view = new FireRenderer(el('fire-world'), world);
  if (light) view.quality(true);
} catch (error) {
  el('fire-world').innerHTML =
    `<p class="fire-error" role="alert">${t('Campfire needs WebGL 2. Please enable hardware acceleration and reload the page.')}</p>`;
  disableControls();
  throw error;
}
const wind = el('fire-wind') as HTMLInputElement;
function sync() {
  wind.value = String(Math.round(world.wind * 100));
  el('fire-wind-value').textContent = `${wind.value}%`;
  const phase =
    world.intensity > 0.45
      ? t('In full flame')
      : world.intensity > 0.06
        ? t('A gentle flicker')
        : world.glow > 0.02
          ? t('Glowing memories')
          : t('Time for a spark');
  el('fire-phase').textContent = phase;
  el('fire-count').textContent = t(world.sticks.length === 1 ? 'wood.one' : 'wood.other', {
    count: world.sticks.length,
    limit: STICK_LIMIT,
  });
  el('fire-pause').innerHTML = world.paused
    ? `▷ <span>${t('Resume')}</span>`
    : `Ⅱ <span>${t('Pause')}</span>`;
  el('fire-pause').setAttribute(
    'aria-label',
    world.paused ? t('Resume simulation') : t('Pause simulation'),
  );
  el('fire-quality').setAttribute('aria-pressed', String(light));
  el('fire-audio').setAttribute('aria-pressed', String(!audio.muted));
  el('fire-audio').innerHTML =
    `♫ <span>${t(audio.muted ? 'Turn crackling on' : 'Turn crackling off')}</span>`;
  (el('fire-add') as HTMLButtonElement).disabled =
    world.paused || world.sticks.length >= STICK_LIMIT || contextLost;
  (el('fire-ignite') as HTMLButtonElement).disabled =
    world.paused || !world.sticks.some((s) => s.fuel > 0.001) || contextLost;
  el('fire-status').textContent = world.paused
    ? t('A moment of stillness')
    : world.intensity > 0.05
      ? t('The fire is alive')
      : world.glow > 0.02
        ? t('The embers are still warm')
        : t('The evening rests');
  el('fire-live').classList.toggle('is-still', world.paused || world.intensity < 0.05);
  audio.update(world.intensity + world.glow * 0.15, world.paused || document.hidden || contextLost);
}
function pause() {
  if (!contextLost) {
    world.paused = !world.paused;
    sync();
  }
}
function add() {
  if (!contextLost) {
    world.addWood();
    sync();
  }
}
function reset() {
  if (contextLost) return;
  world.reset();
  audio.reset();
  light = false;
  view.quality(false);
  view.resetCamera();
  last = performance.now();
  lastSync = -1;
  el('fire-notice').textContent = '';
  sync();
}
wind.addEventListener(
  'input',
  () => {
    world.setWind(Number(wind.value) / 100);
    sync();
  },
  { signal },
);
el('fire-add').addEventListener('click', add, { signal });
el('fire-ignite').addEventListener(
  'click',
  () => {
    world.ignite();
    sync();
  },
  { signal },
);
el('fire-pause').addEventListener('click', pause, { signal });
el('fire-reset').addEventListener('click', reset, { signal });
el('fire-quality').addEventListener(
  'click',
  () => {
    light = !light;
    view.quality(light);
    sync();
  },
  { signal },
);
el('fire-audio').addEventListener(
  'click',
  () => {
    void audio
      .toggle()
      .then(() => {
        if (!disposed) sync();
      })
      .catch(() => {
        if (!disposed)
          el('fire-notice').textContent = t('Crackling could not start. Please try again.');
      });
  },
  { signal },
);
document.addEventListener(
  'keydown',
  (event) => {
    const target = event.target;
    if (
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (target instanceof HTMLElement &&
        (target.closest('input,button,a,textarea,select') || target.isContentEditable))
    )
      return;
    if (event.code === 'Space') {
      event.preventDefault();
      pause();
    } else if (event.key.toLowerCase() === 'n') add();
    else if (event.key.toLowerCase() === 'r') reset();
  },
  { signal },
);
document.addEventListener(
  'visibilitychange',
  () => {
    last = performance.now();
    sync();
  },
  { signal },
);
view.renderer.domElement.addEventListener(
  'webglcontextlost',
  (event) => {
    event.preventDefault();
    contextLost = true;
    world.paused = true;
    sync();
    disableControls();
    el('fire-notice').textContent = t('Graphics paused. Reload the page to restart the campfire.');
  },
  { signal },
);
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const delta = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (document.hidden || contextLost) return;
  world.advance(delta);
  view.render();
  if (now - lastSync > 200) {
    sync();
    lastSync = now;
  }
}
sync();
view.render();
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV)
  Object.assign(window, {
    __fireDebug: () => ({
      ...world.stats(),
      ...view.stats(),
      muted: audio.muted,
      hidden: document.hidden,
    }),
  });
function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(frame);
  abort.abort();
  audio.dispose();
  view.dispose();
  delete (window as unknown as Record<string, unknown>).__fireDebug;
}
window.addEventListener(
  'pagehide',
  (event) => {
    if (!event.persisted) dispose();
    else audio.update(0, true);
  },
  { signal },
);
window.addEventListener(
  'pageshow',
  () => {
    last = performance.now();
    sync();
  },
  { signal },
);
if (import.meta.hot) import.meta.hot.dispose(dispose);
