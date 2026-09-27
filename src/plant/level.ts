import { mountLanguageSelector, t } from '../i18n';
import { levelNav } from '../level-nav';
import { PlantWorld, SPEEDS, BED, clamp, type Point } from './growth';
import { PlantRenderer } from './render';
import './style.css';
const root = document.getElementById('app')!;
root.innerHTML = `<div class="plant-app">
<header class="studio-header plant-header"><a class="plant-brand" href="./" aria-label="${t('Little Worlds home')}"><span class="plant-mark">✳</span> little<span>worlds</span><sup>®</sup></a>${levelNav('plant')}<span class="plant-edition">${t('plant.edition')}</span></header>
<main class="plant-main"><section class="plant-intro"><p class="plant-eyebrow"><span></span>${t('plant.eyebrow')}</p>
<h1>${t('plant.title')}<br><em>${t('plant.titleAccent')}</em></h1><p class="plant-description">${t('plant.intro')}</p>
<p class="plant-instructions">${t('plant.instructions')}</p>
<div class="plant-species"><span>IRIS × HOLLANDICA</span><strong>${t('plant.species')}</strong><p>${t('plant.speciesNote')}</p></div>
<div class="plant-stage-card"><label class="plant-small-label" for="plant-select">${t('plant.select')}</label><select id="plant-select"></select><strong id="plant-stage"></strong><p id="plant-stage-detail"></p><p id="plant-age"></p></div>
<p class="plant-time-note">${t('plant.timeNote')}</p></section>
<section class="plant-experiment" aria-label="${t('plant.experiment')}"><div class="plant-scene-frame"><div id="plant-world" class="plant-world"></div><div class="plant-scene-caption" aria-hidden="true"><span>07 / ${t('plant.caption')}</span><span>${t('plant.cutaway')}</span></div></div>
<div class="plant-controls"><div class="plant-toolbar"><button id="plant-tool" aria-pressed="true">${t('plant.tool')}</button><button id="plant-pause"></button>
<fieldset class="plant-speeds"><legend>${t('plant.speed')}</legend>${SPEEDS.map((s) => `<button data-speed="${s}" aria-pressed="${s === 1}">${s}×</button>`).join('')}</fieldset>
<span class="plant-clock">${t('plant.elapsed')} <output id="plant-elapsed">00:00</output></span><button id="plant-reset">↻ ${t('plant.restart')}</button><button id="plant-fit">⊡ ${t('plant.fit')}</button></div>
<div class="plant-control-notes"><span id="plant-status" role="status"></span><span id="plant-count"></span><span>${t('plant.keyboard')}</span></div></div>
<p id="plant-notice" role="status" class="plant-notice"></p></section></main>
<footer class="plant-footer"><span>${t('plant.footer')}</span><span>${t('plant.shortcuts')}</span></footer></div>`;
mountLanguageSelector(root);
const el = (id: string) => document.getElementById(id)!;
const world = new PlantWorld();
world.plantBulb([0, -0.85, 0.6]);
let selected: number | null = 1,
  view: PlantRenderer;
try {
  view = new PlantRenderer(el('plant-world'), world);
} catch (error) {
  el('plant-world').innerHTML = `<p class="plant-error" role="alert">${t('plant.webglError')}</p>`;
  root
    .querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.plant-controls button,#plant-select')
    .forEach((b) => (b.disabled = true));
  throw error;
}
const canvas = view.renderer.domElement;
canvas.setAttribute('aria-label', t('plant.canvas'));
canvas.setAttribute('aria-describedby', 'plant-notice');
const abort = new AbortController(),
  { signal } = abort;
let last = performance.now(),
  frame = 0,
  contextLost = false,
  optionCount = -1,
  lastSync = '',
  keyboard: Point = [1.5, -0.85, 0.6];
const select = el('plant-select') as HTMLSelectElement,
  pauseButton = el('plant-pause') as HTMLButtonElement;
function time(seconds: number) {
  const n = Math.floor(seconds);
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}
function setText(id: string, value: string) {
  if (el(id).textContent !== value) el(id).textContent = value;
}
function sync() {
  const p = world.plants.find((p) => p.id === selected);
  if (optionCount !== world.plants.length) {
    select.replaceChildren(new Option(t('plant.none'), ''));
    for (const plant of world.plants)
      select.add(new Option(t('plant.identity', { id: plant.id }), String(plant.id)));
    optionCount = world.plants.length;
  }
  select.value = selected === null ? '' : String(selected);
  const signature = `${selected}:${p?.stage}`;
  if (lastSync !== signature) {
    lastSync = signature;
    setText('plant-stage', p ? t(`plant.stage.${p.stage}`) : t('plant.empty'));
    setText('plant-stage-detail', p ? t(`plant.detail.${p.stage}`) : t('plant.instructions'));
  }
  setText('plant-age', p ? `${t('plant.age')} · ${time(world.elapsed - p.plantedAt)}` : '');
  setText('plant-elapsed', time(world.elapsed));
  setText('plant-count', t('plant.count', { count: world.plants.length }));
  setText('plant-pause', world.paused ? t('Resume') : t('Pause'));
  pauseButton.setAttribute(
    'aria-label',
    world.paused ? t('Resume simulation') : t('Pause simulation'),
  );
  setText('plant-status', world.paused ? t('plant.paused') : t('plant.growing'));
  root
    .querySelectorAll<HTMLButtonElement>('[data-speed]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === world.speed)),
    );
  view.select(selected);
}
function pause() {
  if (contextLost) return;
  world.paused = !world.paused;
  last = performance.now();
  sync();
}
function reset() {
  if (contextLost) return;
  world.reset();
  selected = null;
  keyboard = [0, -0.85, 0.6];
  view.fit();
  view.showPreview(null);
  setText('plant-notice', t('plant.empty'));
  last = performance.now();
  sync();
}
function plant(point: Point) {
  if (contextLost) return;
  const r = world.plantBulb(point);
  if (r.ok) {
    selected = r.id;
    setText('plant-notice', t('plant.planted'));
    view.showPreview(null);
  } else setText('plant-notice', t(`plant.${r.reason}`));
  sync();
}
pauseButton.addEventListener('click', pause, { signal });
el('plant-reset').addEventListener('click', reset, { signal });
el('plant-fit').addEventListener('click', () => view.fit(), { signal });
el('plant-tool').addEventListener(
  'click',
  () => {
    canvas.focus();
    view.showPreview(keyboard);
  },
  { signal },
);
select.addEventListener(
  'change',
  () => {
    selected = select.value ? Number(select.value) : null;
    sync();
  },
  { signal },
);
root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
  b.addEventListener(
    'click',
    () => {
      const n = Number(b.dataset.speed);
      if (n === 1 || n === 5 || n === 20) world.speed = n;
      sync();
    },
    { signal },
  ),
);
const pointers = new Map<number, { x: number; y: number; cancelled: boolean; button: number }>();
canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (contextLost) return;
    canvas.focus();
    if (pointers.size) for (const p of pointers.values()) p.cancelled = true;
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      cancelled: pointers.size > 0,
      button: e.button,
    });
    canvas.setPointerCapture(e.pointerId);
  },
  { signal },
);
canvas.addEventListener(
  'pointermove',
  (e) => {
    const p = pointers.get(e.pointerId);
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.cancelled = true;
    if (contextLost || pointers.size > 1) {
      view.showPreview(null);
      return;
    }
    const point = view.pointAt(e.clientX, e.clientY);
    view.showPreview(point && point[1] < -0.3 && point[1] > -1.5 ? point : null);
  },
  { signal },
);
canvas.addEventListener(
  'pointerup',
  (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!p || p.cancelled || p.button !== 0 || contextLost) return;
    const id = view.pick(e.clientX, e.clientY);
    if (id !== null) {
      selected = id;
      sync();
      view.showPreview(null);
      return;
    }
    const point = view.pointAt(e.clientX, e.clientY);
    if (point) plant(point);
  },
  { signal },
);
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId), { signal });
canvas.addEventListener('pointerleave', () => view.showPreview(null), { signal });
canvas.addEventListener(
  'keydown',
  (e) => {
    if (contextLost) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Enter') {
        plant(keyboard);
        return;
      }
      if (e.key === 'ArrowLeft') keyboard[0] -= 0.2;
      if (e.key === 'ArrowRight') keyboard[0] += 0.2;
      if (e.key === 'ArrowUp') keyboard[1] += 0.05;
      if (e.key === 'ArrowDown') keyboard[1] -= 0.05;
      keyboard = [
        clamp(keyboard[0], -5.6, 5.6),
        clamp(keyboard[1], BED.plantingBottom, BED.plantingTop),
        0.6,
      ];
      view.showPreview(keyboard);
      const placement = world.canPlant(keyboard);
      setText('plant-notice', placement.ok ? t('plant.keyboard') : t(`plant.${placement.reason}`));
    }
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
      (e.target instanceof Element &&
        e.target.closest('input,button,select,textarea,a,[contenteditable="true"]'))
    )
      return;
    if (e.code === 'Space') {
      e.preventDefault();
      pause();
    } else if (e.key.toLowerCase() === 'r') reset();
  },
  { signal },
);
document.addEventListener(
  'visibilitychange',
  () => {
    last = performance.now();
    pointers.clear();
    view.showPreview(null);
  },
  { signal },
);
canvas.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault();
    contextLost = true;
    world.paused = true;
    view.controls.enabled = false;
    pointers.clear();
    root
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        '.plant-controls button,#plant-select',
      )
      .forEach((b) => (b.disabled = true));
    setText('plant-notice', t('plant.graphicsLost'));
    sync();
  },
  { signal },
);
canvas.addEventListener(
  'webglcontextrestored',
  () => {
    contextLost = false;
    world.paused = true;
    view.controls.enabled = true;
    view.invalidate();
    last = performance.now();
    root
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        '.plant-controls button,#plant-select',
      )
      .forEach((b) => (b.disabled = false));
    setText('plant-notice', t('plant.graphicsRestored'));
    sync();
  },
  { signal },
);
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  if (document.hidden || contextLost) return;
  world.advance(Math.min(dt, 0.25));
  view.render();
  sync();
}
sync();
view.render();
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV)
  Object.assign(window, {
    __plantDebug: () => ({ ...world.snapshot(), selected, ...view.stats() }),
    __plantTest: {
      stats: () => view.stats(),
      advance: (seconds: number) => {
        const speed = world.speed;
        world.speed = 1;
        world.paused = false;
        world.advance(seconds);
        world.paused = true;
        world.speed = speed;
        view.render();
        sync();
      },
      plant: (x: number, y = -0.85) => {
        plant([x, y, 0.6]);
        view.render();
      },
      project: (x: number, y = -0.85) => view.project([x, y, 0.6]),
      reset: () => {
        reset();
        world.paused = true;
        view.render();
        sync();
      },
    },
  });
function dispose() {
  cancelAnimationFrame(frame);
  abort.abort();
  view.dispose();
  delete (window as unknown as Record<string, unknown>).__plantDebug;
  delete (window as unknown as Record<string, unknown>).__plantTest;
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
window.addEventListener('pagehide', dispose, { once: true, signal });
