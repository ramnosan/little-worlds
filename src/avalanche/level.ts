import { mountLanguageSelector, t } from '../i18n';
import { levelNav } from '../level-nav';
import { AvalancheWorld, type SnowKind } from './physics';
import { AvalancheRenderer } from './render';
import './style.css';

const root = document.getElementById('app')!;
root.innerHTML = `<div class="avalanche-app">
  <header class="studio-header"><a class="avalanche-brand" href="./" aria-label="${t('Little Worlds home')}"><span aria-hidden="true">✳</span> little<b>worlds</b><sup>®</sup></a>${levelNav('avalanche')}<span class="avalanche-edition">${t('avalanche.edition')}</span></header>
  <main class="avalanche-main">
    <section class="avalanche-landscape" aria-label="${t('avalanche.experiment')}">
      <div class="avalanche-heading"><p class="avalanche-eyebrow"><span></span>${t('avalanche.eyebrow')}</p><h1>${t('avalanche.title')}<br><em>${t('avalanche.accent')}</em></h1><p class="avalanche-intro">${t('avalanche.intro')}</p></div>
      <div id="avalanche-world"></div>
      <div class="avalanche-scene-label"><span class="avalanche-compass" aria-hidden="true">↑<small>N</small></span><div><strong>${t('avalanche.sceneLabel')}</strong><span>${t('avalanche.sceneNote')}</span></div></div>
      <div class="avalanche-view" role="group" aria-label="${t('avalanche.camera')}"><button id="avalanche-overview" aria-pressed="true">${t('avalanche.overview')}</button><button id="avalanche-top" aria-pressed="false">${t('avalanche.top')}</button></div>
      <p class="avalanche-gesture">${t('avalanche.hint')}</p>
    </section>
    <aside class="avalanche-panel" aria-label="${t('avalanche.controls')}">
      <div class="avalanche-panel-title"><span>FIELD NOTES / 010</span><span aria-hidden="true">↗</span></div>
      <h2>${t('avalanche.controls')}</h2>
      <fieldset class="avalanche-field"><legend>${t('avalanche.snow')}</legend><div class="avalanche-segment"><button data-snow="powder" aria-pressed="true">❄ ${t('avalanche.powder')}</button><button data-snow="wet" aria-pressed="false">◒ ${t('avalanche.wet')}</button></div></fieldset>
      <div class="avalanche-depth"><label for="avalanche-depth">${t('avalanche.depth')}</label><output id="avalanche-depth-value" for="avalanche-depth">1.0 m</output><input id="avalanche-depth" type="range" min="0.5" max="2" value="1" step="0.1"><div><span>0.5 m</span><span>2.0 m</span></div></div>
      <p class="avalanche-setting-note">${t('avalanche.settingsNote')}</p>
      <button class="avalanche-release" id="avalanche-release"><span aria-hidden="true">↘</span><span id="avalanche-release-label">${t('avalanche.release')}</span></button>
      <div class="avalanche-playback"><button id="avalanche-pause" disabled>${t('Pause')}</button><div role="group" aria-label="${t('avalanche.speed')}"><button data-speed="0.25" aria-pressed="false">¼×</button><button data-speed="1" aria-pressed="true">1×</button><button data-speed="2" aria-pressed="false">2×</button></div><button id="avalanche-reset" title="${t('avalanche.reset')}" aria-label="${t('avalanche.reset')}">↺</button></div>
      <section class="avalanche-observation"><div class="avalanche-status"><span></span><strong id="avalanche-status" role="status"></strong></div><ol class="avalanche-stages"><li data-stage="0">01 ${t('avalanche.chapter1')}</li><li data-stage="1">02 ${t('avalanche.chapter2')}</li><li data-stage="2">03 ${t('avalanche.chapter3')}</li></ol><p id="avalanche-detail"></p>
      <dl class="avalanche-metrics"><div><dt>${t('avalanche.time')}</dt><dd><output id="avalanche-time">0.0</output><small>s</small></dd></div><div><dt>${t('avalanche.velocity')}</dt><dd><output id="avalanche-velocity">0</output><small>km/h</small></dd></div><div><dt>${t('avalanche.distance')}</dt><dd><output id="avalanche-distance">0</output><small>m</small></dd></div><div><dt>${t('avalanche.volume')}</dt><dd><output id="avalanche-volume">0</output><small>m³</small></dd></div></dl></section>
      <details class="avalanche-research"><summary>${t('avalanche.sources')} <span aria-hidden="true">+</span></summary><p>${t('avalanche.sourceNote')}</p><a href="https://www.slf.ch/en/avalanches/avalanche-science-and-prevention/avalanche-types/" target="_blank" rel="noreferrer">${t('avalanche.slf')} ↗</a><a href="https://ramms.ch/ramms-avalanche/mathematical-model/" target="_blank" rel="noreferrer">${t('avalanche.ramms')} ↗</a></details>
      <p id="avalanche-notice" role="status"></p>
    </aside>
  </main><footer class="avalanche-footer"><span>${t('avalanche.footer')}</span><span>${t('avalanche.shortcuts')}</span><span>LITTLE WORLDS — 10</span></footer>
</div>`;
mountLanguageSelector(root);
const el = (id: string) => document.getElementById(`avalanche-${id}`)!;
const world = new AvalancheWorld();
let view: AvalancheRenderer;
try {
  view = new AvalancheRenderer(el('world'), world);
} catch (error) {
  el('world').innerHTML = `<p class="avalanche-error" role="alert">${t('avalanche.webgl')}</p>`;
  root
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      '.avalanche-main button, .avalanche-main input',
    )
    .forEach((b) => (b.disabled = true));
  throw error;
}
const canvas = view.renderer.domElement;
canvas.setAttribute('aria-label', t('avalanche.canvas'));
const abort = new AbortController(),
  { signal } = abort;
const depth = el('depth') as HTMLInputElement;
const pause = el('pause') as HTMLButtonElement;
const release = el('release') as HTMLButtonElement;
let speed = 1,
  last = performance.now(),
  frame = 0,
  lost = false,
  phase = '';
function setText(id: string, text: string) {
  if (el(id).textContent !== text) el(id).textContent = text;
}
function sync() {
  setText('time', world.elapsed.toFixed(1));
  setText('velocity', (world.peakSpeed * 3.6).toFixed(0));
  setText('distance', world.front.toFixed(0));
  setText(
    'volume',
    Math.round(world.releasedVolume + world.entrainedVolume).toLocaleString(
      document.documentElement.lang,
    ),
  );
  setText('pause', world.paused ? t('Resume') : t('Pause'));
  pause.setAttribute('aria-pressed', String(world.paused));
  pause.disabled = lost || world.phase === 'ready';
  release.disabled = lost || (world.phase !== 'ready' && world.phase !== 'settled');
  setText(
    'release-label',
    world.phase === 'settled' ? t('avalanche.replay') : t('avalanche.release'),
  );
  setText('status', world.paused ? t('avalanche.pause') : t(`avalanche.phase.${world.phase}`));
  if (phase !== world.phase) {
    phase = world.phase;
    setText('detail', t(`avalanche.detail.${world.phase}`));
    const stage = world.phase === 'flow' ? 1 : world.phase === 'settled' ? 2 : 0;
    root.querySelectorAll<HTMLElement>('[data-stage]').forEach((e) => {
      if (Number(e.dataset.stage) === stage) e.setAttribute('aria-current', 'step');
      else e.removeAttribute('aria-current');
    });
  }
  el('depth-value').textContent = `${world.depth.toFixed(1)} m`;
  depth.setAttribute('aria-valuetext', `${world.depth.toFixed(1)} m`);
  root
    .querySelectorAll<HTMLButtonElement>('[data-snow]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snow === world.kind)));
}
function reset(kind: SnowKind = world.kind) {
  if (lost) return;
  world.reset(Number(depth.value), kind);
  view.reset();
  last = performance.now();
  setText('notice', '');
  sync();
}
function trigger() {
  if (lost) return;
  if (world.phase === 'settled') reset();
  world.release();
  last = performance.now();
  sync();
}
function togglePause() {
  if (lost || world.phase === 'ready') return;
  world.paused = !world.paused;
  last = performance.now();
  sync();
}
release.addEventListener('click', trigger, { signal });
pause.addEventListener('click', togglePause, { signal });
el('reset').addEventListener('click', () => reset(), { signal });
depth.addEventListener('input', () => reset(), { signal });
root
  .querySelectorAll<HTMLButtonElement>('[data-snow]')
  .forEach((b) => b.addEventListener('click', () => reset(b.dataset.snow as SnowKind), { signal }));
root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
  b.addEventListener(
    'click',
    () => {
      speed = Number(b.dataset.speed);
      root
        .querySelectorAll<HTMLButtonElement>('[data-speed]')
        .forEach((a) => a.setAttribute('aria-pressed', String(a === b)));
    },
    { signal },
  ),
);
for (const name of ['overview', 'top'])
  el(name).addEventListener(
    'click',
    () => {
      view.fit(name === 'top');
      el('overview').setAttribute('aria-pressed', String(name === 'overview'));
      el('top').setAttribute('aria-pressed', String(name === 'top'));
    },
    { signal },
  );
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }), { signal });
canvas.addEventListener(
  'keydown',
  (e) => {
    if (lost) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      trigger();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    }
    if (e.key.toLowerCase() === 'r') reset();
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const offset = view.camera.position.clone().sub(view.controls.target);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const angle = e.key === 'ArrowLeft' ? -0.09 : 0.09,
          x = offset.x;
        offset.x = Math.cos(angle) * x + Math.sin(angle) * offset.z;
        offset.z = -Math.sin(angle) * x + Math.cos(angle) * offset.z;
      } else offset.y = Math.max(200, Math.min(2000, offset.y + (e.key === 'ArrowUp' ? 70 : -70)));
      view.camera.position.copy(view.controls.target).add(offset);
      view.controls.update();
    }
  },
  { signal },
);
canvas.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault();
    lost = true;
    world.paused = true;
    view.controls.enabled = false;
    root
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        '.avalanche-main button, .avalanche-main input',
      )
      .forEach((b) => (b.disabled = true));
    setText('notice', t('avalanche.graphicsLost'));
    sync();
  },
  { signal },
);
canvas.addEventListener(
  'webglcontextrestored',
  () => {
    lost = false;
    view.controls.enabled = true;
    last = performance.now();
    root
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        '.avalanche-main button, .avalanche-main input',
      )
      .forEach((b) => (b.disabled = false));
    setText('notice', t('avalanche.graphicsRestored'));
    sync();
  },
  { signal },
);
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const dt = Math.min(0.08, (now - last) / 1000);
  last = now;
  if (document.hidden || lost) return;
  world.advance(dt * speed);
  view.render(dt * speed);
  sync();
}
sync();
view.render();
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV)
  Object.assign(window, {
    __avalancheDebug: () => ({
      ...world.snapshot(),
      speed,
      camera: view.camera.position.toArray(),
      ...view.stats(),
    }),
  });
function dispose() {
  cancelAnimationFrame(frame);
  abort.abort();
  view.dispose();
  delete (window as unknown as Record<string, unknown>).__avalancheDebug;
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
// Preserve a live page if it enters the browser back/forward cache.
window.addEventListener(
  'pagehide',
  (e) => {
    if (!e.persisted) dispose();
  },
  { signal },
);
