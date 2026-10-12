// Logo, chord diagrams, emoji rain, countdown.
import { h } from './ui.js';
import { parseChord, voicing, noteIndex } from './theory.js';

// ---- Logo: a guitar pick wrapped as a gift (bow on top) with a lightning bolt.
export const LOGO_MARK = `
<svg viewBox="0 0 120 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="gotPick" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#C9521F"/><stop offset="1" stop-color="#8E2F10"/>
    </linearGradient>
    <clipPath id="gotClip"><path d="M24 17H96Q112 17 110 34C106 62 76 104 65 117Q60 123 55 117C44 104 14 62 10 34Q8 17 24 17Z"/></clipPath>
  </defs>
  <path d="M23 12H97Q117 12 115 34C111 64 80 108 69 121Q60 131 51 121C40 108 9 64 5 34Q3 12 23 12Z" fill="#614C49"/>
  <path d="M24 17H96Q112 17 110 34C106 62 76 104 65 117Q60 123 55 117C44 104 14 62 10 34Q8 17 24 17Z" fill="url(#gotPick)"/>
  <g clip-path="url(#gotClip)">
    <rect x="52" y="0" width="16" height="140" fill="#6C9AA0"/>
    <rect x="0" y="46" width="120" height="14" fill="#6C9AA0"/>
    <rect x="55" y="0" width="3" height="140" fill="#C5DED3" opacity=".7"/>
    <rect x="0" y="49" width="120" height="3" fill="#C5DED3" opacity=".7"/>
    <path d="M20 30c10-8 26-10 38-10" stroke="#fff" stroke-opacity=".25" stroke-width="5" fill="none" stroke-linecap="round"/>
  </g>
  <path d="M71 30 45 70h14l-8 34 28-44H64l9-30z" fill="#E4972A" stroke="#614C49" stroke-width="3" stroke-linejoin="round"/>
  <g transform="translate(60 14)">
    <path d="M0 0C-8-14-30-16-30-5S-10 4 0 0z" fill="#6C9AA0" stroke="#614C49" stroke-width="3" stroke-linejoin="round"/>
    <path d="M0 0C8-14 30-16 30-5S10 4 0 0z" fill="#6C9AA0" stroke="#614C49" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-2 2-12 16M2 2 12 16" stroke="#614C49" stroke-width="5" stroke-linecap="round"/>
    <path d="M-2 2-12 16M2 2 12 16" stroke="#6C9AA0" stroke-width="2.5" stroke-linecap="round"/>
    <circle r="6" fill="#E4972A" stroke="#614C49" stroke-width="3"/>
  </g>
</svg>`;

export function logo(size = 'md') {
  return h('div', { class: 'logo logo-' + size },
    h('div', { class: 'logo-mark', html: LOGO_MARK }),
    h('div', { class: 'logo-word' }, h('span', { class: 'lw-small' }, 'The Gift of'), h('span', { class: 'lw-big' }, 'TAB')));
}

// ---- Chord diagrams
export function chordDiagram(name, song) {
  if (song.instrument === 'piano') return pianoDiagram(name);
  const v = voicing(name, song.tuning);
  const n = song.tuning.length;
  const W = 22 * (n - 1) + 36, H = 150;
  const wrap = h('div', { class: 'diagram' }, h('div', { class: 'dg-name' }, name));
  if (!v) { wrap.append(h('div', { class: 'dg-none' }, '?')); return wrap; }
  const fretted = v.filter(f => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const base = maxF > 4 ? Math.min(...fretted) : 1;
  const x = (i) => 18 + i * 22, y = (f) => 28 + (f - base + 0.5) * 22;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  if (base === 1) s += `<rect x="16" y="24" width="${22 * (n - 1) + 4}" height="5" rx="1" fill="currentColor"/>`;
  else s += `<text x="4" y="${y(base) + 5}" font-size="12" fill="currentColor">${base}</text>`;
  for (let f = 0; f <= 5; f++) s += `<line x1="18" x2="${x(n - 1)}" y1="${28 + f * 22}" y2="${28 + f * 22}" stroke="currentColor" stroke-opacity=".5"/>`;
  for (let i = 0; i < n; i++) s += `<line x1="${x(i)}" x2="${x(i)}" y1="28" y2="138" stroke="currentColor" stroke-opacity=".7"/>`;
  v.forEach((f, i) => {
    if (f < 0) s += `<text x="${x(i)}" y="18" text-anchor="middle" font-size="13" fill="currentColor">×</text>`;
    else if (f === 0) s += `<circle cx="${x(i)}" cy="13" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
    else s += `<circle cx="${x(i)}" cy="${y(f)}" r="8" fill="var(--rust)"/>`;
  });
  s += `<g font-size="10" fill="currentColor" opacity=".6">${song.tuning.map((t, i) => `<text x="${x(i)}" y="149" text-anchor="middle">${t}</text>`).join('')}</g></svg>`;
  wrap.insertAdjacentHTML('beforeend', s);
  return wrap;
}

function pianoDiagram(name) {
  const ch = parseChord(name);
  const wrap = h('div', { class: 'diagram piano' }, h('div', { class: 'dg-name' }, name));
  if (!ch) { wrap.append(h('div', { class: 'dg-none' }, '?')); return wrap; }
  // Two octaves starting at C; root placed in first octave, stacked upward.
  const on = new Set(ch.intervals.map(i => { let k = ch.root + i; while (k > 23) k -= 12; return k; }));
  const bass = ch.bass;
  const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [1, 3, 6, 8, 10];
  const WW = 18, W = WW * 14, H = 80;
  let s = `<svg viewBox="0 0 ${W + 2} ${H + 14}" width="${W + 2}" height="${H + 14}">`;
  for (let o = 0; o < 2; o++) whites.forEach((pc, i) => {
    const k = o * 12 + pc, xx = (o * 7 + i) * WW + 1;
    s += `<rect x="${xx}" y="1" width="${WW}" height="${H}" rx="2" fill="${on.has(k) ? 'var(--amber)' : '#fff'}" stroke="#614C49"/>`;
  });
  for (let o = 0; o < 2; o++) blacks.forEach((pc) => {
    const k = o * 12 + pc, wi = whites.filter(w => w < pc).length, xx = (o * 7 + wi) * WW + 1 - 6;
    s += `<rect x="${xx}" y="1" width="12" height="${H * 0.6}" rx="2" fill="${on.has(k) ? 'var(--rust)' : '#614C49'}"/>`;
  });
  s += `<text x="2" y="${H + 12}" font-size="11" fill="currentColor">Bass: ${['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][bass]}</text></svg>`;
  wrap.insertAdjacentHTML('beforeend', s);
  return wrap;
}

// ---- Emoji rain 🎉
const HAPPY = ['🎸','🤘','🎉','🥳','⭐','🌟','🔥','🎶','🎵','😄','😎','🙌','💖','🌈','🦄','🚀','👏','🏆','🎊','✨','😁','🥁','🎤','🍕','🍩','🌻','💃','🕺','😺','🐶','🎈','🍦','🧁','🌮','🪩','💥','😍','🤩','🥇','🎺'];
export function emojiRain(emoji) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const e = emoji || HAPPY[Math.floor(Math.random() * HAPPY.length)];
  const layer = h('div', { class: 'rain', 'aria-hidden': 'true' });
  const count = 90 + Math.floor(Math.random() * 110);
  for (let i = 0; i < count; i++) {
    const s = h('span', {}, e);
    const size = 22 + Math.random() * 34;
    s.style.cssText = `left:${Math.random() * 100}vw;font-size:${size}px;animation-delay:${Math.random() * 1.4}s;animation-duration:${2 + Math.random() * 1.8}s;--rot:${(Math.random() * 720 - 360) | 0}deg;--drift:${(Math.random() * 120 - 60) | 0}px`;
    layer.append(s);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5500);
  return e;
}

// ---- Countdown
export function countdownParts(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr.length <= 10 ? dateStr + 'T19:00:00' : dateStr);
  const ms = target - Date.now();
  const days = Math.floor(ms / 864e5);
  return { ms, past: ms < 0, days, hours: Math.floor(ms / 36e5) % 24, mins: Math.floor(ms / 6e4) % 60, secs: Math.floor(ms / 1000) % 60, target };
}
