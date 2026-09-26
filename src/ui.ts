import { t, mountLanguageSelector } from './i18n';
import { levelNav } from './level-nav';
export const COLORS = [
  { name: t('Strawberry'), value: '#ec839a' },
  { name: t('Peach'), value: '#f4b183' },
  { name: t('Mint'), value: '#83bba2' },
  { name: t('Lavender'), value: '#b4a0dd' },
];
export const SIZES = [0.65, 0.9, 1.15];
export interface UIState {
  mallet: boolean;
  color: number;
  size: number;
  softness: number;
  gravity: number;
  paused: boolean;
  muted: boolean;
  reduced: boolean;
  selected: number | null;
  count: number;
}
export const defaultState = (): UIState => ({
  mallet: false,
  color: 0,
  size: 1,
  softness: 0.5,
  gravity: 1,
  paused: false,
  muted: true,
  reduced: false,
  selected: null,
  count: 3,
});

const paths: Record<string, string> = {
  mallet: '<circle cx="9" cy="15" r="6"/><path d="m13 10 6-7 3 3-7 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="3"/>',
  play: '<path d="m9 5 10 7-10 7Z"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
  sliders:
    '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 16h.01"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  hand: '<path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-4-2-6-4l-4-5a2 2 0 0 1 3-2l2 2"/>',
  orbit:
    '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="2"/>',
  zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  leaf: '<path d="M19 4C6 2 2 9 6 15s14 3 13-11ZM5 20 15 9"/>',
};
export const icon = (name: string) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.plus}</svg>`;

export function mountUI(root: HTMLElement) {
  root.innerHTML = `
    <header class="header studio-header">
      <a class="brand" href="./" aria-label="${t('Little Worlds home')}"><svg class="brand-mark" width="39" height="39" viewBox="0 0 48 48" aria-hidden="true"><path d="M6 28C4 17 12 6 23 7c10 0 15 9 18 18 3 11-5 16-18 15C12 40 8 36 6 28Z" fill="currentColor"/><ellipse cx="17" cy="18" rx="3" ry="5" transform="rotate(35 17 18)" fill="#eff4df"/></svg><span>little<span class="brand-light">worlds</span><span class="brand-dot">®</span></span></a>
      ${levelNav('jelly')}
      <nav class="header-actions" aria-label="${t('Studio controls')}"><button class="icon-button" id="sound" aria-label="${t('Turn sound on')}" title="${t('Turn sound on')}">${icon('mute')}</button><span class="nav-divider"></span><button class="help-button" id="help" aria-label="${t('How to play')}">${icon('help')}<span>${t('How to play')}</span></button></nav>
    </header>
    <main>
      <div class="intro"><div class="eyebrow"><span class="line"></span> ${t('LESS THINKING. MORE SQUISHING.')}</div><h1>${t('A soft little space')} <em>${t('to play.')}</em></h1><p>${t('No rules. No rush. Just a little jelly.')}</p></div>
      <button id="drawer-toggle" class="drawer-toggle" aria-expanded="false" aria-controls="settings">${icon('sliders')} ${t('Make it yours')}</button>
      <aside class="settings" id="settings" aria-label="${t('Playground settings')}">
        <div class="panel-heading"><span class="panel-icon">${icon('sliders')}</span><h2>${t('Make it yours')}</h2><button id="drawer-close" class="icon-button mobile-only" aria-label="${t('Close settings')}">${icon('close')}</button></div>
        <section class="control-section"><div class="control-label"><h3 id="color-label">${t('Jelly color')}</h3><span id="color-name">${t('Strawberry')}</span></div><div class="swatches" role="group" aria-label="${t('Jelly color')}">${COLORS.map((c, i) => `<button class="swatch ${i === 0 ? 'active' : ''}" style="--swatch:${c.value}" data-color="${i}" aria-label="${c.name}" aria-pressed="${i === 0}" title="${c.name}"><span></span></button>`).join('')}</div>
        <div class="control-label size-label"><h3>${t('Size')}</h3><span>${t('Just right')}</span></div><div class="size-options" role="group" aria-label="${t('Jelly size')}">${[t('Small'), t('Medium'), t('Large')].map((s, i) => `<button data-size="${i}" class="size-button ${i === 1 ? 'active' : ''}" aria-pressed="${i === 1}"><span class="size-dot size-${i}"></span>${s}</button>`).join('')}</div>
        <button id="spawn" class="spawn-button">${icon('plus')} ${t('Add a jelly')} <kbd>N</kbd></button></section>
        <section class="tool-section"><button id="mallet" class="mallet-button" aria-pressed="false">${icon('mallet')}<span>${t('Pick up mallet')}</span></button><p id="tool-hint">${t('Grab a jelly, or pick up the mallet to give it a whack.')}</p></section>
        <section class="control-section physics-section"><div class="section-caption">${t('A LITTLE PHYSICS')}</div><label class="control-label" for="softness"><span>${t('Softness')}</span><output id="softness-value">50%</output></label><input id="softness" type="range" min="0" max="100" value="50" style="--fill:50%"/><div class="range-labels"><span>${t('Firm')}</span><span>${t('Extra squishy')}</span></div><label class="control-label gravity-label" for="gravity"><span>${t('Gravity')}</span><output id="gravity-value">1.0×</output></label><input id="gravity" type="range" min="0" max="200" value="100" style="--fill:50%"/><div class="range-labels"><span>${t('Floaty')}</span><span>${t('Grounded')}</span></div></section>
        <div class="quality-row"><span>${icon('leaf')} ${t('Lighter graphics')}</span><button class="switch" id="quality" role="switch" aria-checked="false" aria-label="${t('Lighter graphics')}"><span></span></button></div>
      </aside>
      <div id="world" class="world"></div>
      <div class="scene-meta"><span class="scene-pill"><span class="tiny-dot"></span> ${t('THE PLAYGROUND')}</span><span class="scene-number">${t('EXPERIMENT 001')}</span></div>
      <div class="grab-hint" id="grab-hint">${icon('hand')} ${t('Go on, give it a squish.')}</div>
      <div class="scene-status"><span id="live-dot" class="tiny-dot"></span><span id="live-label">${t('Live simulation')}</span><span class="status-divider">/</span><span id="body-count">${t('jelly.other', { count: 3 })}</span><span class="performance" id="performance"></span></div>
      <div class="bottom-controls"><div class="playback-controls"><button id="pause" class="tool-button">${icon('pause')}<span>${t('Pause')}</span><kbd>${t('key.space')}</kbd></button><span class="toolbar-divider"></span><button id="reset" class="tool-button">${icon('reset')}<span>${t('Reset')}</span></button><span class="toolbar-divider"></span><button id="focus" class="tool-button delete-button" disabled title="${t('Focus selected body')}" aria-label="${t('Focus selected body')}">${icon('zoom')}</button><button id="delete" class="tool-button delete-button" disabled title="${t('Select a jelly to remove it')}" aria-label="${t('Delete selected jelly')}">${icon('trash')}</button></div></div>
      <div class="interaction-guide"><span>${icon('hand')} ${t('Drag to squish')}</span><span>${icon('orbit')} ${t('Drag space to orbit')}</span><span>${icon('zoom')} ${t('Scroll to zoom')}</span></div>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
    </main>
    <footer><span>${t('A small experiment in')} <span class="footer-serif">${t('feeling good.')}</span></span><span class="footer-right">${t('MADE FOR THE JOY OF IT')} <span class="footer-star">✳</span></span></footer>
    <dialog id="help-dialog"><button class="dialog-close icon-button" id="help-close" aria-label="${t('Close help')}">${icon('close')}</button><div class="eyebrow">${t('WELCOME TO YOUR LITTLE PLAYGROUND')}</div><h2>${t('Stay a little.')}<br><em>${t('Squish a lot.')}</em></h2><p>${t('Pick up a jelly, give it a stretch, and let it go. There’s no right way to play.')}</p><ul><li>${icon('hand')}<span><strong>${t('Grab & stretch')}</strong>${t('Drag any jelly. Release while moving to toss it.')}</span></li><li>${icon('orbit')}<span><strong>${t('Find your angle')}</strong>${t('Drag empty space or right-drag to orbit. Scroll to zoom.')}</span></li><li>${icon('sliders')}<span><strong>${t('Make a little mess')}</strong>${t('Add up to 8 jellies. Try extra softness or zero gravity.')}</span></li></ul><div class="help-shortcuts"><span><kbd>N</kbd> ${t('New jelly')}</span><span><kbd>${t('key.space')}</kbd> ${t('Pause')}</span><span><kbd>${t('key.delete')}</kbd> ${t('Remove selected')}</span></div><button id="help-start" class="spawn-button">${t('Let’s play')} ${icon('arrow')}</button></dialog>
  `;
  mountLanguageSelector(root);
}

export function renderState(s: UIState) {
  document.getElementById('mallet')!.setAttribute('aria-pressed', String(s.mallet));
  document.querySelector('#mallet span')!.textContent = s.mallet
    ? t('Put down mallet')
    : t('Pick up mallet');
  document.getElementById('tool-hint')!.textContent = s.mallet
    ? t('Move to aim. Left-click to swing. Right-drag to orbit.')
    : t('Grab a jelly, or pick up the mallet to give it a whack.');
  document.getElementById('grab-hint')!.innerHTML = s.mallet
    ? `${icon('mallet')} ${t('Left-click to swing.')}`
    : `${icon('hand')} ${t('Go on, give it a squish.')}`;
  document.querySelector('.interaction-guide')!.innerHTML = s.mallet
    ? `<span>${icon('mallet')} ${t('Click to swing')}</span><span>${icon('orbit')} ${t('Right-drag to orbit')}</span><span>${icon('zoom')} ${t('Scroll to zoom')}</span>`
    : `<span>${icon('hand')} ${t('Drag to squish')}</span><span>${icon('orbit')} ${t('Drag space to orbit')}</span><span>${icon('zoom')} ${t('Scroll to zoom')}</span>`;
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => {
    const active = Number(b.dataset.color) === s.color;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => {
    const active = Number(b.dataset.size) === s.size;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('color-name')!.textContent = COLORS[s.color].name;
  document.querySelector('.size-label span')!.textContent = [
    t('Little one'),
    t('Just right'),
    t('Big softie'),
  ][s.size];
  for (const [key, value, label] of [
    ['softness', s.softness * 100, `${Math.round(s.softness * 100)}%`],
    ['gravity', s.gravity * 100, `${s.gravity.toFixed(1)}×`],
  ] as const) {
    const input = document.getElementById(key) as HTMLInputElement;
    input.value = String(value);
    input.style.setProperty('--fill', `${(value / Number(input.max)) * 100}%`);
    document.getElementById(`${key}-value`)!.textContent = label;
  }
  const pause = document.getElementById('pause')!;
  pause.innerHTML = `${icon(s.paused ? 'play' : 'pause')}<span>${s.paused ? t('Resume') : t('Pause')}</span><kbd>${t('key.space')}</kbd>`;
  pause.setAttribute('aria-label', s.paused ? t('Resume simulation') : t('Pause simulation'));
  const sound = document.getElementById('sound')!;
  sound.innerHTML = icon(s.muted ? 'mute' : 'sound');
  sound.setAttribute('aria-label', s.muted ? t('Turn sound on') : t('Turn sound off'));
  sound.setAttribute('title', s.muted ? t('Turn sound on') : t('Turn sound off'));
  document.getElementById('quality')!.setAttribute('aria-checked', String(s.reduced));
  (document.getElementById('delete') as HTMLButtonElement).disabled = s.selected === null;
  (document.getElementById('focus') as HTMLButtonElement).disabled = s.selected === null;
  (document.getElementById('spawn') as HTMLButtonElement).disabled = s.count >= 8;
  document.getElementById('body-count')!.textContent =
    t(s.count === 1 ? 'jelly.one' : 'jelly.other', { count: s.count }) +
    (s.count === 8 ? t('count.full') : '');
  document.getElementById('live-label')!.textContent = s.paused
    ? t('Taking a breather')
    : t('Live simulation');
  document.getElementById('live-dot')!.classList.toggle('paused', s.paused);
}

let toastTimeout: ReturnType<typeof setTimeout>;
export function toast(message: string) {
  const el = document.getElementById('toast')!;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('visible'), 2400);
}
