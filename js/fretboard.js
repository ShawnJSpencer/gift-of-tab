// A tappable fretboard (strings run across, high string on top like tab) for the quizzes,
// plus a little emoji burst for celebrating a right answer at the spot you tapped.
import { h } from './ui.js';
import { openPitches } from './versions.js';
import { SHARPS } from './theory.js';

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

export const noteOf = (midi) => SHARPS[((midi % 12) + 12) % 12];
export const pretty = (n) => n.replace('#', '♯');

// opts: { instrument, tuning (low → high), tuningName, from, to, showNames, onTap(s, f, midi, cell) }
export function fretboard(opts) {
  const open = openPitches(opts.tuning, opts.instrument, opts.tuningName);
  const n = opts.tuning.length;
  const el = h('div', { class: 'fb-wrap' });
  const board = h('div', { class: 'fb', role: 'grid', 'aria-label': 'Fretboard' });
  el.append(board);
  const cells = {};
  function draw() {
    board.innerHTML = '';
    const from = opts.from || 0, to = opts.to;
    board.style.setProperty('--cols', to - from + 1);
    board.style.setProperty('--rows', n);
    // fret numbers along the top
    const numRow = h('div', { class: 'fb-nums' });
    for (let f = from; f <= to; f++) numRow.append(h('span', { class: 'fb-num' + (INLAYS.includes(f) || f === 12 ? ' dot' : '') }, f === 0 ? 'Open' : String(f)));
    board.append(numRow);
    const grid = h('div', { class: 'fb-grid' + (from === 0 ? ' has-open' : '') });
    for (let row = 0; row < n; row++) {
      const s = n - 1 - row; // top row = highest string
      for (let f = from; f <= to; f++) {
        const midi = open[s] + f;
        const cell = h('button', { type: 'button', class: 'fb-cell' + (f === 0 ? ' open' : '') + (f === 1 && from === 0 ? ' after-nut' : ''), 'aria-label': `String ${row + 1} (${opts.tuning[s]}), ${f === 0 ? 'open' : 'fret ' + f}`,
          style: { '--gauge': (1 + s * 0.35) + 'px' },
          onclick: (e) => opts.onTap && opts.onTap(s, f, midi, cell, e) },
          h('span', { class: 'fb-string' }), h('span', { class: 'fb-dotname' }, opts.showNames ? pretty(noteOf(midi)) : ''));
        cells[s + ':' + f] = cell;
        grid.append(cell);
      }
    }
    // inlay dots behind the strings
    const inl = h('div', { class: 'fb-inlays' });
    for (let f = from; f <= to; f++) inl.append(h('span', {}, f === 12 || f === 24 ? '●●' : INLAYS.includes(f) ? '●' : ''));
    board.append(grid, inl);
  }
  draw();
  return {
    el, open,
    cell: (s, f) => cells[s + ':' + f],
    set(o) { Object.assign(opts, o); for (const k in cells) delete cells[k]; draw(); },
    mark(s, f, cls, label) { const c = cells[s + ':' + f]; if (!c) return; c.classList.add(cls); if (label != null) c.querySelector('.fb-dotname').textContent = label; },
    unmark(cls) { el.querySelectorAll('.' + cls).forEach(c => c.classList.remove(cls)); },
    positions(midiOrPc, byPc) { // every [s, f] on the shown frets for a pitch (or pitch class)
      const out = [];
      for (let s = 0; s < n; s++) for (let f = opts.from || 0; f <= opts.to; f++) {
        const m = open[s] + f;
        if (byPc ? ((m % 12) + 12) % 12 === midiOrPc : m === midiOrPc) out.push([s, f]);
      }
      return out;
    },
  };
}

// Emoji fireworks from a point on screen.
const PARTY = ['🎉', '⭐', '🤘', '🔥', '🎸', '✨', '🥳', '🎶', '💥', '🙌'];
export function burst(x, y, big = false) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = h('div', { class: 'burst', 'aria-hidden': 'true', style: { left: x + 'px', top: y + 'px' } });
  const count = big ? 26 : 12;
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.4, d = (big ? 120 : 70) + Math.random() * (big ? 90 : 50);
    const s = h('span', {}, PARTY[Math.floor(Math.random() * PARTY.length)]);
    s.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 20}px;font-size:${(big ? 26 : 20) + Math.random() * 12}px;animation-delay:${Math.random() * 0.08}s`;
    layer.append(s);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1300);
}
export function burstAt(elm, big) { const r = elm.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, big); }
