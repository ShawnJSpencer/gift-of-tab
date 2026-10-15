// Shared pickers: tuning (strings shown low → high, E A D G B E), key, capo.
import { h } from './ui.js';
import { TUNINGS, SHARPS, noteIndex } from './theory.js';

const NOTE_CHOICES = [...new Set([...SHARPS, 'Db', 'Eb', 'Gb', 'Ab', 'Bb'])];

// Tuning picker. opts: { instrument, tuning, detect: true to offer "Detect from the tab" }
export function tuningPicker(opts) {
  let instrument = opts.instrument, tuning = (opts.tuning || TUNINGS[instrument === 'piano' ? 'guitar' : instrument][0].notes).slice();
  let detect = !!opts.detect;
  const preset = h('select', { 'aria-label': 'Tuning' });
  const strings = h('div', { class: 'strings-row' });
  const wrap = h('div', { class: 'tuning-picker' }, preset, strings);
  const presets = () => TUNINGS[instrument] || [];
  const match = () => presets().find(p => p.notes.length === tuning.length && p.notes.every((n, i) => noteIndex(n) === noteIndex(tuning[i])));
  function fillPresets() {
    preset.innerHTML = '';
    if (opts.detect) preset.append(h('option', { value: '__detect', selected: detect }, 'Detect from the tab'));
    const m = match();
    presets().forEach(p => preset.append(h('option', { value: p.name, selected: !detect && m && m.name === p.name }, `${p.name} · ${p.notes.join(' ')}`)));
    preset.append(h('option', { value: 'Custom', selected: !detect && !m }, 'Custom'));
  }
  function fillStrings() {
    strings.innerHTML = '';
    strings.hidden = detect || instrument === 'piano';
    if (strings.hidden) return;
    // low → high, left to right (string 6 … string 1 on guitar)
    tuning.forEach((nName, i) => {
      const num = tuning.length - i;
      const sel = h('select', { class: 'string-sel', 'aria-label': `String ${num}`, onchange: (e) => { tuning[i] = e.target.value; fillPresets(); opts.onChange && opts.onChange(); } },
        NOTE_CHOICES.map(nn => h('option', { value: nn, selected: noteIndex(nn) === noteIndex(nName) && (nn === nName || !NOTE_CHOICES.includes(nName)) }, nn)));
      strings.append(h('label', { class: 'string-pick' }, sel, h('span', {}, num)));
    });
  }
  preset.onchange = () => {
    detect = preset.value === '__detect';
    const p = presets().find(x => x.name === preset.value);
    if (p) tuning = p.notes.slice();
    fillStrings(); opts.onChange && opts.onChange();
  };
  fillPresets(); fillStrings();
  wrap.hidden = instrument === 'piano';
  return {
    el: wrap,
    get detect() { return detect; },
    get tuning() { return tuning.slice(); },
    get name() { const m = match(); return m ? m.name : 'Custom'; },
    setInstrument(inst) {
      instrument = inst; wrap.hidden = inst === 'piano';
      if (inst !== 'piano') tuning = TUNINGS[inst][0].notes.slice();
      fillPresets(); fillStrings();
    },
    setTuning(notes) { if (notes && notes.length) { tuning = notes.slice(); detect = false; fillPresets(); fillStrings(); } },
  };
}

// Key picker: blank, majors, minors.
export const KEYS_MAJOR = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const KEYS_MINOR = ['Am', 'A#m', 'Bbm', 'Bm', 'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m'];
export function keyPicker(value, blankLabel = '—') {
  return h('select', { 'aria-label': 'Key' },
    h('option', { value: '', selected: !value }, blankLabel),
    h('optgroup', { label: 'Major' }, KEYS_MAJOR.map(k => h('option', { value: k, selected: value === k }, k))),
    h('optgroup', { label: 'Minor' }, KEYS_MINOR.map(k => h('option', { value: k, selected: value === k }, k))));
}
export function normaliseKey(k) {
  const m = String(k || '').trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/i);
  if (!m) return null;
  const root = m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b');
  const minor = m[3] && /^m(in(or)?)?$/i.test(m[3]) && !/maj/i.test(m[3]);
  return root + (minor ? 'm' : '');
}

// Capo picker; detectLabel adds a "Detect" choice (value '').
export function capoPicker(value, detectLabel) {
  return h('select', { 'aria-label': 'Capo' },
    detectLabel ? h('option', { value: '', selected: value == null }, detectLabel) : null,
    h('option', { value: '0', selected: value === 0 }, 'No capo'),
    Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1), selected: value === i + 1 }, `Fret ${i + 1}`)));
}
