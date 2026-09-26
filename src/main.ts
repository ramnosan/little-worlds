import { t } from './i18n';
import './style.css';
import { Vector3 } from 'three';
import { PhysicsWorld, MAX_BODIES, type Vec3 } from './physics/world';
import { Studio } from './render/studio';
import { Interaction } from './interaction';
import { JellyAudio } from './audio';
import { COLORS, SIZES, defaultState, mountUI, renderState, toast } from './ui';

mountUI(document.getElementById('app')!);
const world = new PhysicsWorld();
const audio = new JellyAudio();
let state = defaultState();
let studio: Studio;
try {
  studio = new Studio(document.getElementById('world')!);
} catch (error) {
  document.getElementById('world')!.innerHTML =
    `<div class="error-panel" role="alert"><h2>${t('A little help getting started.')}</h2><p>${t('Little Worlds needs WebGL 2. Please enable hardware acceleration in your browser and reload, or try a current version of Chrome, Edge, Firefox, or Safari.')}</p></div>`;
  document
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      '.settings button,.settings input,.bottom-controls button',
    )
    .forEach((el) => (el.disabled = true));
  throw error;
}
const abort = new AbortController();
const interaction = new Interaction(
  world,
  studio,
  (id) => {
    state.selected = id;
    renderState(state);
  },
  () => {
    document.getElementById('grab-hint')!.classList.add('hidden');
    audio.squish(0.7);
  },
  () => audio.squish(1),
);
if (import.meta.env.DEV)
  void import('./debug').then(({ installDiagnostics }) => installDiagnostics(world, studio));
const sync = () => {
  interaction.setMalletMode(state.mallet);
  state.count = world.bodies.length;
  world.softness = state.softness;
  world.gravity = state.gravity;
  world.paused = state.paused;
  audio.muted = state.muted;
  renderState(state);
};
function add(radius: number, color: string, origin: Vec3) {
  const body = world.spawn(radius, color, origin);
  if (body) {
    try {
      studio.add(body);
    } catch (error) {
      world.remove(body.id);
      throw error;
    }
  }
  return body;
}
function reset(announce = true) {
  interaction.cancel();
  world.clear();
  for (const id of [...studio.views.keys()]) studio.remove(id);
  state = defaultState();
  studio.quality(false);
  interaction.resetCamera();
  spawnIndex = 0;
  add(1.13, COLORS[0].value, [-2.0, 1.25, 0.8]);
  add(0.93, COLORS[2].value, [1.25, 1.05, 1.15]);
  add(0.83, COLORS[3].value, [-0.05, 1.0, -1.5]);
  sync();
  // A short deterministic settling pass presents grounded jellies on the first frame.
  for (let i = 0; i < 40; i++) world.advance(1 / 60);
  studio.sync(null, null);
  document.getElementById('grab-hint')!.classList.remove('hidden');
  if (announce) toast(t('A fresh little start.'));
}
let spawnIndex = 0;
function spawn() {
  if (world.bodies.length >= MAX_BODIES) {
    toast(t('A full house. Remove a jelly to add another.'));
    return;
  }
  const positions: Vec3[] = [
    [-2.5, 4, -1.4],
    [0, 4, 0],
    [2.6, 4, 1],
    [-2.6, 4, 1.6],
    [0.2, 4, -1.5],
  ];
  const position = [...positions[spawnIndex++ % positions.length]] as Vec3;
  const radius = SIZES[state.size];
  // Spawn above existing bodies, never through them, even when paused.
  position[1] = Math.min(
    7.9 - radius,
    Math.max(
      3.5,
      ...world.bodies
        .filter(
          (b) =>
            b.bounds[0] < position[0] + radius &&
            b.bounds[3] > position[0] - radius &&
            b.bounds[2] < position[2] + radius &&
            b.bounds[5] > position[2] - radius,
        )
        .map((b) => b.bounds[4] + radius + 0.25),
    ),
  );
  const body = add(radius, COLORS[state.color].value, position);
  if (body) {
    state.selected = body.id;
    audio.squish(0.7);
    sync();
    toast(state.paused ? t('Jelly added. Resume to let it drop.') : t('One more little softie.'));
  }
}
function pause() {
  interaction.cancel();
  state.paused = !state.paused;
  sync();
}
function remove() {
  if (state.selected === null) return;
  interaction.cancel();
  studio.remove(state.selected);
  world.remove(state.selected);
  state.selected = null;
  sync();
  toast(t('A little more room to play.'));
}
function on(id: string, callback: () => void) {
  document.getElementById(id)!.addEventListener('click', callback, { signal: abort.signal });
}
on('spawn', spawn);
on('pause', pause);
on('reset', () => reset());
on('delete', remove);
on('mallet', () => {
  state.mallet = !state.mallet;
  sync();
  toast(
    state.mallet
      ? t('Aim with the mouse. Left-click for a horizontal swing.')
      : t('Back to grabbing jellies.'),
  );
});
on('focus', () => {
  if (state.selected !== null) interaction.focus(state.selected);
});
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
  b.addEventListener(
    'click',
    () => {
      state.color = Number(b.dataset.color);
      sync();
    },
    { signal: abort.signal },
  ),
);
document.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) =>
  b.addEventListener(
    'click',
    () => {
      state.size = Number(b.dataset.size);
      sync();
    },
    { signal: abort.signal },
  ),
);
for (const name of ['softness', 'gravity'] as const)
  document.getElementById(name)!.addEventListener(
    'input',
    (e) => {
      state[name] = Number((e.target as HTMLInputElement).value) / 100;
      sync();
    },
    { signal: abort.signal },
  );
on('quality', () => {
  state.reduced = !state.reduced;
  studio.quality(state.reduced);
  sync();
  toast(
    state.reduced ? t('A little lighter on your device.') : t('All the little details, back on.'),
  );
});
on('sound', () => {
  if (!state.muted) {
    state.muted = true;
    sync();
  } else
    void audio
      .enable()
      .then(() => {
        state.muted = false;
        sync();
      })
      .catch(() => toast(t('Sound is unavailable in this browser.')));
});
const dialog = document.getElementById('help-dialog') as HTMLDialogElement;
on('help', () => {
  interaction.cancel();
  dialog.showModal();
});
on('help-close', () => dialog.close());
on('help-start', () => dialog.close());
dialog.addEventListener(
  'click',
  (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  },
  { signal: abort.signal },
);
function drawer(open: boolean) {
  document.getElementById('settings')!.classList.toggle('open', open);
  document.getElementById('drawer-toggle')!.setAttribute('aria-expanded', String(open));
}
on('drawer-toggle', () => drawer(!document.getElementById('settings')!.classList.contains('open')));
on('drawer-close', () => drawer(false));
document.addEventListener(
  'keydown',
  (event) => {
    if (
      dialog.open ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.repeat
    )
      return;
    if (event.code === 'Space') {
      event.preventDefault();
      pause();
    } else if (event.key.toLowerCase() === 'n') spawn();
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
    } else if (event.key === 'Escape') {
      interaction.cancel();
      state.selected = null;
      drawer(false);
      sync();
    }
  },
  { signal: abort.signal },
);
reset(false);
let last = performance.now(),
  frame = 0,
  time = 0,
  frameCount = 0,
  performanceTime = last;
const handleUp = new Vector3(0, 1, 0);
const handleDirection = new Vector3();
function animate(now: number) {
  frame = requestAnimationFrame(animate);
  const delta = (now - last) / 1000;
  last = now;
  if (document.hidden) return;
  world.advance(delta);
  interaction.controls.update();
  studio.sync(state.selected, interaction.hovered);
  studio.mallet.position.fromArray(world.mallet.position);
  studio.mallet.quaternion.setFromUnitVectors(
    handleUp,
    handleDirection.fromArray(world.mallet.handleDirection),
  );
  studio.render();
  if (!state.paused)
    for (const body of world.bodies) if (body.impact > 1.8) audio.squish(body.impact / 4);
  time += delta;
  frameCount++;
  if (now - performanceTime > 2000) {
    document.getElementById('performance')!.textContent = `${Math.round(frameCount / time)} fps`;
    performanceTime = now;
    frameCount = 0;
    time = 0;
  }
}
frame = requestAnimationFrame(animate);
document.addEventListener(
  'visibilitychange',
  () => {
    last = performance.now();
    time = 0;
    frameCount = 0;
    performanceTime = last;
  },
  { signal: abort.signal },
);
studio.renderer.domElement.addEventListener(
  'webglcontextlost',
  (event) => {
    event.preventDefault();
    state.paused = true;
    interaction.cancel();
    sync();
    toast(t('Graphics paused. Reload the page to restore the playground.'));
  },
  { signal: abort.signal },
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    abort.abort();
    interaction.dispose();
    studio.dispose();
    audio.dispose();
  });
