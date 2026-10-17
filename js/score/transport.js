// Playback seek bar shown along the bottom while music plays: drag to rewind or skip ahead.
import { h } from '../ui.js';

export function transport({ bars, label, onSeek, onPause }) {
  let n = Math.max(1, bars), dragging = false;
  const range = h('input', { type: 'range', min: 0, max: Math.max(0, n - 1), step: 1, value: 0, class: 'tp-range', 'aria-label': 'Playback position (bar)' });
  const text = h('span', { class: 'tp-label' });
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
  const pp = h('button', { type: 'button', class: 'tp-pp', 'aria-label': 'Pause', html: PAUSE, onclick: (e) => { e.stopPropagation(); onPause && onPause(); } });
  const el = h('div', { class: 'transport', role: 'group', 'aria-label': 'Playback position' }, pp, range, text);
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
    setPaused(p) { el.classList.toggle('paused', !!p); pp.innerHTML = p ? PLAY : PAUSE; pp.setAttribute('aria-label', p ? 'Resume' : 'Pause'); },
  };
}
