import { initializeLanguage } from './i18n';

const level = new URLSearchParams(location.search).get('level');
initializeLanguage(
  level === 'fire' || level === 'railway' || level === 'aquarium' || level === 'bubbles'
    ? level
    : 'jelly',
);
// Keep each import in its own loader so production optimization cannot combine
// the branches and associate every level with the default level's CSS preload.
const loadLevel = {
  fire: () => import('./fire/level'),
  railway: () => import('./railway/level'),
  aquarium: () => import('./aquarium/level'),
  bubbles: () => import('./bubbles/level'),
  jelly: () => import('./main'),
};

const selectedLevel =
  level === 'fire' || level === 'railway' || level === 'aquarium' || level === 'bubbles'
    ? level
    : 'jelly';
void loadLevel[selectedLevel]();
