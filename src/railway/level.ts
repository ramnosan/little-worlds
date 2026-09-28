import { t, mountLanguageSelector } from '../i18n';
import './style.css';
import { levelNav } from '../level-nav';
import { RailwayWorld } from './physics';
import { RailwayRenderer } from './render';

const root = document.getElementById('app')!;
root.innerHTML = `<div class="railway-app">
  <header class="rw-header studio-header">
    <a class="rw-brand" href="./" aria-label="${t('Little Worlds home')}"><span class="rw-mark">✳</span> little<span>worlds</span><sup>®</sup></a>
    ${levelNav('railway')}
    <span class="rw-edition">${t('SMALL WORLDS. GREAT JOURNEYS.')}</span>
  </header>
  <main>
    <section class="rw-intro"><p class="rw-eyebrow"><span></span> ${t('LEVEL 04 / MODEL RAILWAY')}</p>
      <h1>${t('A great journey.')}<br><em>${t('In miniature.')}</em></h1>
      <p>${t('Through fir forests and rocky hills.')}<br>${t('A little Alpine journey, lap by lap.')}</p>
    </section>
    <div class="rw-layout">
      <section class="rw-stage" aria-label="${t('Kleinwald miniature world')}">
        <div class="rw-scene" id="railway-world"></div>
        <div class="rw-caption" aria-hidden="true"><span>04 — KLEINWALD</span><span>${t('A WORLD ON A TABLE')}</span></div>
      </section>
      <aside class="rw-settings" aria-label="${t('Model railway settings')}">
        <div class="rw-panel-title"><span>${t('YOUR LITTLE TIMETABLE')}</span><span>↗</span></div>
        <div class="rw-ticket"><span>${t('ROUND TRIP')}</span><strong>Kleinwald <i>↻</i> Kleinwald</strong><small>${t('1 locomotive · 2 carriages · endless time')}</small></div>
        <label for="rw-speed">${t('Speed')} <output id="rw-speed-value">100%</output></label>
        <input id="rw-speed" type="range" min="0" max="200" step="5" value="100">
        <div class="rw-range-labels"><span>${t('Stopped')}</span><span>${t('Full speed')}</span></div>
        <p class="rw-note">${t('A slow glide through the trees.')}<br>${t('A lively turn around the bend.')}</p>
        <button id="rw-follow" class="rw-quality rw-follow" aria-pressed="false"><span aria-hidden="true">◎</span> <span>${t('Follow train')}</span></button>
        <button id="rw-quality" class="rw-quality" aria-pressed="false">◌ <span>${t('Lighter graphics')}</span></button>
      </aside>
    </div>
    <div class="rw-bottom">
      <p class="rw-hint"><span>◎</span> ${t('A new perspective.')}<small id="rw-camera-hint">${t('Drag to orbit · Scroll or pinch to zoom')}</small></p>
      <div class="rw-toolbar"><button id="rw-pause" aria-label="${t('Pause simulation')}">Ⅱ <span>${t('Pause')}</span></button><span></span><button id="rw-reset">↻ <span>${t('Reset')}</span></button></div>
      <p class="rw-status" role="status"><span id="rw-live"></span><span id="rw-status">${t('Travelling through Kleinwald')}</span></p>
    </div>
    <p id="rw-notice" class="rw-notice" role="alert"></p>
  </main>
  <footer class="rw-footer"><span>${t('Enjoy the journey.')} <em>${t('Lap by lap.')}</em></span><span>${t('SPACE: PAUSE · R: RESET')} <b>✳</b></span></footer>
</div>`;

mountLanguageSelector(root);

const el = (id: string) => document.getElementById(id)!;
const world = new RailwayWorld();
let view: RailwayRenderer;
try {
  view = new RailwayRenderer(el('railway-world'), world);
} catch (error) {
  el('railway-world').innerHTML =
    `<p class="rw-error" role="alert">${t('Model Railway needs WebGL 2. Please enable hardware acceleration and reload the page.')}</p>`;
  root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach((input) => {
    input.disabled = true;
  });
  throw error;
}
const abort = new AbortController(),
  signal = abort.signal;
const speed = el('rw-speed') as HTMLInputElement;
let frame = 0,
  last = performance.now(),
  light = false,
  contextLost = false;

function sync() {
  speed.value = String(Math.round(world.speed * 100));
  el('rw-speed-value').textContent = `${speed.value}%`;
  el('rw-pause').innerHTML = world.paused
    ? `▷ <span>${t('Resume')}</span>`
    : `Ⅱ <span>${t('Pause')}</span>`;
  el('rw-pause').setAttribute(
    'aria-label',
    world.paused ? t('Resume simulation') : t('Pause simulation'),
  );
  el('rw-quality').setAttribute('aria-pressed', String(light));
  el('rw-follow').setAttribute('aria-pressed', String(view.followTrain));
  root.querySelector('.rw-layout')!.classList.toggle('is-following', view.followTrain);
  el('rw-camera-hint').textContent = view.followTrain
    ? t('Following the train · Disable Follow train to orbit and zoom')
    : t('Drag to orbit · Scroll or pinch to zoom');
  el('rw-status').textContent = world.paused
    ? t('A little travel break')
    : world.speed === 0
      ? t('Ready to depart')
      : t('Travelling through Kleinwald');
  el('rw-live').classList.toggle('is-still', world.paused || world.speed === 0);
}
function pause() {
  if (!contextLost) {
    world.paused = !world.paused;
    sync();
  }
}
function reset() {
  if (contextLost) return;
  world.reset();
  light = false;
  view.quality(false);
  view.resetCamera();
  last = performance.now();
  sync();
}
speed.addEventListener(
  'input',
  () => {
    world.setSpeed(Number(speed.value) / 100);
    sync();
  },
  { signal },
);
el('rw-pause').addEventListener('click', pause, { signal });
el('rw-reset').addEventListener('click', reset, { signal });
el('rw-follow').addEventListener(
  'click',
  () => {
    if (contextLost) return;
    view.setFollowTrain(!view.followTrain);
    sync();
  },
  { signal },
);
el('rw-quality').addEventListener(
  'click',
  () => {
    light = !light;
    view.quality(light);
    sync();
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
      event.metaKey ||
      event.altKey ||
      (target instanceof HTMLElement &&
        (target.closest('input,button,a,select,textarea') || target.isContentEditable))
    )
      return;
    if (event.code === 'Space') {
      event.preventDefault();
      pause();
    } else if (event.key.toLowerCase() === 'r') reset();
  },
  { signal },
);
document.addEventListener(
  'visibilitychange',
  () => {
    last = performance.now();
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
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach((input) => {
      input.disabled = true;
    });
    el('rw-notice').textContent = t('Graphics paused. Reload the page to restore the playground.');
  },
  { signal },
);
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const delta = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (document.hidden || contextLost) return;
  world.advance(delta);
  view.render(delta);
}
sync();
view.render();
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV)
  Object.assign(window, { __railwayDebug: () => ({ ...world.stats(), ...view.stats() }) });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    abort.abort();
    view.dispose();
    delete (window as unknown as Record<string, unknown>).__railwayDebug;
  });
