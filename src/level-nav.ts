import { t } from './i18n';

const levels = [
  { id: 'jelly', number: '01', name: 'Jelly', href: './' },
  { id: 'bubbles', number: '02', name: t('Bubbles'), href: '?level=bubbles' },
  { id: 'aquarium', number: '03', name: 'Aquarium', href: '?level=aquarium' },
  { id: 'railway', number: '04', name: t('Model Railway'), href: '?level=railway' },
  { id: 'fire', number: '05', name: t('Campfire'), href: '?level=fire' },
  { id: 'airplane', number: '06', name: t('Model Flight'), href: '?level=airplane' },
  { id: 'plant', number: '07', name: t('Plant'), href: '?level=plant' },
  { id: 'melon', number: '08', name: 'Melon Jelly', href: 'melon-jelly.html' },
  { id: 'helicopter', number: '09', name: 'Horizon 05', href: 'horizon-05.html' },
] as const;

export function levelNav(current: (typeof levels)[number]['id']) {
  return `<nav class="level-nav" aria-label="${t('Choose level')}">${levels
    .map(
      (level) =>
        `<a href="${level.href}" aria-label="${level.number} ${level.name}"${level.id === current ? ' aria-current="page"' : ''}>${level.number} <span>${level.name}</span></a>`,
    )
    .join('')}</nav>`;
}
