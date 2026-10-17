// Playback seek bar shown along the bottom while music plays: drag to rewind or skip ahead.
import { h } from '../ui.js';

export function transport({ bars, label, onSeek }) {
  let n = Math.max(1, bars), dragging = false;
  const range = h('input', { type: 'range', min: 0, max: Math.max(0, n - 1), step: 1, value: 0, class: 'tp-range', 'aria-label': 'Playback position (bar)' });
  const text = h('span', { class: 'tp-label' });
  const el = h('div', { class: 'transport', role: 'group', 'aria-label': 'Playback position' }, range, text);
  const show = (bar) => { text.textContent = label(bar, n); range.style.setProperty('--pct', n > 1 ? (bar / (n - 1)) * 100 + '%' : '0%'); };
  range.addEventListener('pointerdown', (e) => { e.stopPropagation(); dragging = true; });
  range.addEventListener('input', () => show(+range.value));
  range.addEventListener('change', () => { dragging = false; onSeek(+range.value); });
  ['pointerup', 'pointercancel'].forEach(t => range.addEventListener(t, () => { setTimeout(() => { dragging = false; }, 50); }));
  el.addEventListener('click', (e) => e.stopPropagation());
  show(0);
  return {
    el,
    set(bar) { if (dragging) return; range.value = String(bar); show(bar); },
    setBars(b) { n = Math.max(1, b); range.max = String(Math.max(0, n - 1)); },
    toggle(on) { el.classList.toggle('on', !!on); },
  };
}
