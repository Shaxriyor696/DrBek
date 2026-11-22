// iMedu AI mascot: a floating, living button. The artwork is the mascot image
// (assets/ai-mascot.webp); an SVG layer drawn in the image's own coordinates
// (1254×1254 original) sits on top and briefly shows closed eyes to make it blink,
// plus blush on hover. Clicking it opens the AI assistant.
import { h } from './ui.js?v=mwsc1ev8';

// [x, y, gradient]: eye centres measured on the original artwork; the face is lit
// from the top-left, so each lid gets the shade found around its own eye
const EYES = [[465, 802, 'mc-l'], [780, 802, 'mc-r']];

const lid = ([x, y, g]) => `
  <ellipse cx="${x}" cy="${y}" rx="78" ry="88" fill="url(#${g})"/>
  <path d="M${x - 52} ${y + 4} Q${x} ${y + 40} ${x + 52} ${y + 4}" fill="none" stroke="#1A3050" stroke-width="15" stroke-linecap="round"/>`;

const OVERLAY = `
<svg class="mascot-fx" viewBox="0 0 1254 1254" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="mc-l" x1="0" y1="0" x2=".5" y2="1">
      <stop offset="0" stop-color="#F7F5F7"/>
      <stop offset="1" stop-color="#EAE9EC"/>
    </linearGradient>
    <linearGradient id="mc-r" x1="0" y1="0" x2="1" y2=".6">
      <stop offset="0" stop-color="#EDECEE"/>
      <stop offset="1" stop-color="#E1E0E3"/>
    </linearGradient>
  </defs>
  <g class="m-lids">${EYES.map(lid).join('')}</g>
  <g class="m-cheeks" fill="#FF8E9E"><ellipse cx="392" cy="900" rx="44" ry="22"/><ellipse cx="856" cy="900" rx="44" ry="22"/></g>
</svg>`;

export function mascot(onOpen) {
  const art = h('span', { class: 'mascot-art' }, h('img', { src: 'assets/ai-mascot.webp', alt: '', width: 400, height: 400, draggable: 'false' }));
  art.insertAdjacentHTML('beforeend', OVERLAY);
  return h('button', { type: 'button', class: 'mascot', 'aria-label': 'AI yordamçini oçiş', title: 'AI yordamçi', onclick: onOpen },
    h('span', { class: 'mascot-tip' }, 'Savolingiz bormi?'), art);
}
