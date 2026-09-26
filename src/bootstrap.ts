import { initializeLanguage } from './i18n';

const level = new URLSearchParams(location.search).get('level');
initializeLanguage(
  level === 'fire' || level === 'railway' || level === 'aquarium' || level === 'bubbles'
    ? level
    : 'jelly',
);
if (level === 'fire') {
  void import('./fire/level');
} else if (level === 'railway') {
  void import('./railway/level');
} else if (level === 'aquarium') {
  void import('./aquarium/level');
} else if (level === 'bubbles') {
  void import('./bubbles/level');
} else {
  void import('./main');
}
