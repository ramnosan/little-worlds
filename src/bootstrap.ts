import { initializeLanguage, t } from './i18n';

const level = new URLSearchParams(location.search).get('level');
initializeLanguage(
  level === 'plant' ||
    level === 'airplane' ||
    level === 'fire' ||
    level === 'railway' ||
    level === 'aquarium' ||
    level === 'bubbles'
    ? level
    : 'jelly',
);
// Keep each import in its own loader so production optimization cannot combine
// the branches and associate every level with the default level's CSS preload.
const loadLevel = {
  plant: () => import('./plant/level'),
  airplane: () => import('./airplane/level'),
  fire: () => import('./fire/level'),
  railway: () => import('./railway/level'),
  aquarium: () => import('./aquarium/level'),
  bubbles: () => import('./bubbles/level'),
  jelly: () => import('./main'),
};

const selectedLevel =
  level === 'plant' ||
  level === 'airplane' ||
  level === 'fire' ||
  level === 'railway' ||
  level === 'aquarium' ||
  level === 'bubbles'
    ? level
    : 'jelly';
const loading = document.getElementById('level-loading')!;
const root = document.getElementById('app')!;
const names = {
  plant: t('Plant'),
  jelly: 'Jelly',
  bubbles: t('Bubbles'),
  aquarium: 'Aquarium',
  railway: t('Model Railway'),
  fire: t('Campfire'),
  airplane: t('Model Flight'),
};
document.getElementById('loading-title')!.textContent = t('loading.title', {
  level: names[selectedLevel],
});
document.getElementById('loading-detail')!.textContent = t('loading.detail');
const retry = document.getElementById('loading-retry') as HTMLButtonElement;
retry.textContent = t('Try again');
retry.addEventListener('click', () => location.reload());

// Allow the screen to paint before synchronous scene construction begins.
const paintedFrame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

async function start() {
  try {
    await paintedFrame();
    const loaded = await loadLevel[selectedLevel]();
    if ('ready' in loaded) await loaded.ready;
    // Every level has now scheduled its render loop. Keep the overlay through
    // the first rendered frame, including asynchronous aquarium preparation.
    await paintedFrame();
    root.inert = false;
    root.removeAttribute('aria-busy');
    loading.remove();
  } catch (error) {
    console.error('Level loading failed', error);
    // A mounted level can explain a graphics failure itself. Expose its header so
    // language/navigation remain usable and avoid announcing two error panels.
    const levelError = root.querySelector('[role="alert"]');
    if (levelError) {
      root.inert = false;
      root.removeAttribute('aria-busy');
      loading.remove();
      return;
    }
    loading.dataset.error = 'true';
    loading.setAttribute('role', 'alert');
    document.getElementById('loading-title')!.textContent = t('loading.error');
    document.getElementById('loading-detail')!.textContent = t('loading.retry');
    root.removeAttribute('aria-busy');
    retry.hidden = false;
  }
}
void start();
