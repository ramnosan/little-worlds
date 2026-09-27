import { t, mountLanguageSelector } from '../i18n';
import { levelNav } from '../level-nav';
import { AirplaneWorld } from './physics';
import { AirplaneRenderer } from './render';
import { FlightControls } from './input';
import './style.css';

const root = document.getElementById('app')!;
root.innerHTML = `<div class="flight-app">
  <header class="studio-header"><a class="flight-brand" href="./" aria-label="${t('Little Worlds home')}">✳ little<b>worlds</b><sup>®</sup></a>${levelNav('airplane')}<span class="flight-edition">${t('flight.edition')}</span></header>
  <main>
    <section class="flight-intro"><div><p class="flight-eyebrow">${t('flight.eyebrow')}</p><h1>${t('flight.title')} <em>${t('flight.titleAccent')}</em></h1></div><p>${t('flight.intro')}</p></section>
    <section class="flight-stage" aria-label="${t('flight.field')}">
      <div id="flight-world"></div>
      <div class="flight-caption"><span>06 / ${t('flight.field')}</span><span id="flight-perspective">${t('flight.pilot')}</span></div>
      <div class="flight-telemetry"><div><span>${t('flight.speed')}</span><strong id="flight-speed">0</strong><small>km/h</small></div><div><span>${t('flight.height')}</span><strong id="flight-height">0</strong><small>m</small></div><div><span>${t('flight.throttle')}</span><strong id="flight-throttle-value">0</strong><small>%</small></div></div>
      <div class="flight-crash" id="flight-crash" hidden><strong>${t('flight.crashed')}</strong><p>${t('flight.crashHelp')}</p><button id="flight-restart">↻ ${t('flight.restart')}</button></div>
    </section>
    <div class="flight-console"><div class="flight-status"><i></i><span id="flight-status" role="status"></span></div><label class="flight-gas" for="flight-throttle">${t('flight.throttle')}<input id="flight-throttle" type="range" min="0" max="100" value="0"></label><div class="flight-actions"><button id="flight-camera" aria-pressed="false" aria-keyshortcuts="C">${t('flight.chaseView')}</button><button id="flight-pause"></button><button id="flight-reset">↻ ${t('Reset')}</button><button id="flight-quality" aria-pressed="false">◌ ${t('Lighter graphics')}</button></div></div>
    <div class="flight-touch"><div><p>${t('flight.leftStick')}</p><div class="flight-stick" data-stick="left" aria-label="${t('flight.leftStick')}"><i></i></div></div><span>MODE 2<br>✳</span><div><p>${t('flight.rightStick')}</p><div class="flight-stick" data-stick="right" aria-label="${t('flight.rightStick')}"><i></i></div></div></div>
    <section class="flight-guide"><div><span>01 / ${t('flight.takeoff')}</span><p>${t('flight.takeoffHelp')}</p></div><div><span>02 / ${t('flight.controls')}</span><p>${t('flight.controlsHelp')}</p></div><div><span>03 / ${t('flight.landing')}</span><p>${t('flight.landingHelp')}</p></div></section>
    <p id="flight-notice" role="alert"></p>
  </main><footer>${t('flight.footer')}<span>${t('flight.shortcuts')}</span></footer>
</div>`;
mountLanguageSelector(root);
const el = (id: string) => document.getElementById(id)!;
const world = new AirplaneWorld();
if (import.meta.env.DEV) {
  const fixture = new URLSearchParams(location.search).get('airplaneFixture');
  if (
    fixture === 'near' ||
    fixture === 'far' ||
    fixture === 'overhead' ||
    fixture === 'fields' ||
    fixture === 'field-pass'
  ) {
    world.position.set(
      ...((fixture === 'near'
        ? [-5, 6, 2]
        : fixture === 'far'
          ? [180, 70, -100]
          : fixture === 'fields'
            ? [240, 80, -60]
            : fixture === 'field-pass'
              ? [50, 5, -80]
              : [-12, 30, 19]) as [number, number, number]),
    );
    world.velocity.set(12, 0, 0);
    world.orientation.identity();
    if (fixture === 'fields' || fixture === 'field-pass')
      world.orientation.set(0, Math.sin(1.05), 0, Math.cos(1.05));
    world.state = 'flying';
    world.paused = true;
  } else if (fixture === 'crash') {
    world.position.y = 0.45;
    world.velocity.y = -5;
    world.advance(0.1);
  }
}
let view: AirplaneRenderer;
try {
  view = new AirplaneRenderer(el('flight-world'), world);
} catch (error) {
  el('flight-world').innerHTML = `<p role="alert">${t('flight.webgl')}</p>`;
  el('flight-notice').removeAttribute('role');
  root
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')
    .forEach((e) => (e.disabled = true));
  throw error;
}
view.renderer.domElement.setAttribute('aria-label', t('flight.canvas'));
const abort = new AbortController(),
  signal = abort.signal;
let frame = 0,
  last = performance.now(),
  light = false,
  contextLost = false;
const throttle = el('flight-throttle') as HTMLInputElement;
const controls = new FlightControls(world, root, { pause, reset, suspend, camera: toggleCamera });
function toggleCamera() {
  if (contextLost) return;
  view.toggleCamera();
  sync();
}
function sync() {
  const chase = view.flightCamera.mode === 'chase';
  el('flight-camera').textContent = chase ? t('flight.groundView') : t('flight.chaseView');
  el('flight-camera').setAttribute('aria-pressed', String(chase));
  el('flight-perspective').textContent = chase ? t('flight.chaseCaption') : t('flight.pilot');
  const status = contextLost
    ? t('flight.graphicsLost')
    : world.paused
      ? t('flight.paused')
      : t(`flight.${world.state}`);
  if (el('flight-status').textContent !== status) el('flight-status').textContent = status;
  el('flight-speed').textContent = String(Math.round(world.velocity.length() * 3.6));
  el('flight-height').textContent = String(Math.round(Math.max(0, world.position.y - 0.34)));
  const gas = String(Math.round(world.input.throttle * 100));
  el('flight-throttle-value').textContent = gas;
  throttle.value = gas;
  const label = world.paused ? t('Resume') : t('Pause');
  if (el('flight-pause').textContent !== label) el('flight-pause').textContent = label;
  el('flight-pause').setAttribute(
    'aria-label',
    world.paused ? t('Resume simulation') : t('Pause simulation'),
  );
  el('flight-crash').hidden = world.state !== 'crashed';
  throttle.disabled = world.paused || world.state === 'crashed' || contextLost;
  (el('flight-pause') as HTMLButtonElement).disabled = world.state === 'crashed' || contextLost;
  for (const id of ['flight-camera', 'flight-reset', 'flight-restart', 'flight-quality'])
    (el(id) as HTMLButtonElement).disabled = contextLost;
}
function pause() {
  if (contextLost || world.state === 'crashed') return;
  controls.clear();
  world.paused = !world.paused;
  el('flight-notice').textContent = '';
  last = performance.now();
  sync();
}
function suspend() {
  world.paused = true;
  last = performance.now();
  sync();
}
function reset() {
  if (contextLost) return;
  world.reset();
  controls.clear();
  el('flight-notice').textContent = '';
  light = false;
  view.quality(false);
  view.resetCamera();
  el('flight-quality').setAttribute('aria-pressed', 'false');
  last = performance.now();
  sync();
}
throttle.addEventListener(
  'input',
  () => {
    if (!throttle.disabled) world.setInput({ throttle: Number(throttle.value) / 100 });
  },
  { signal },
);
el('flight-camera').addEventListener('click', toggleCamera, { signal });
el('flight-pause').addEventListener('click', pause, { signal });
el('flight-reset').addEventListener('click', reset, { signal });
el('flight-restart').addEventListener(
  'click',
  () => {
    reset();
    view.renderer.domElement.focus({ preventScroll: true });
  },
  { signal },
);
el('flight-quality').addEventListener(
  'click',
  () => {
    light = !light;
    view.quality(light);
    el('flight-quality').setAttribute('aria-pressed', String(light));
  },
  { signal },
);
view.renderer.domElement.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault();
    contextLost = true;
    controls.clear();
    suspend();
    el('flight-notice').textContent = t('flight.graphicsLost');
  },
  { signal },
);
view.renderer.domElement.addEventListener(
  'webglcontextrestored',
  () => {
    // Three restores GPU resources first; preserve the flight and require an explicit resume.
    contextLost = false;
    controls.clear();
    world.paused = true;
    view.quality(light);
    last = performance.now();
    sync();
    el('flight-notice').textContent = t('flight.graphicsRestored');
  },
  { signal },
);
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (document.hidden || contextLost) return;
  controls.update(dt);
  world.advance(dt);
  view.render(dt);
  sync();
}
sync();
view.render(0);
frame = requestAnimationFrame(animate);
if (import.meta.env.DEV)
  Object.assign(window, { __airplaneDebug: () => ({ ...world.stats(), ...view.stats() }) });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    controls.dispose();
    abort.abort();
    view.dispose();
    delete (window as unknown as Record<string, unknown>).__airplaneDebug;
  });
