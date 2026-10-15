// Song versions: one arrangement per instrument, plus a personal "stage name" version of each
// (e.g. Olden Gray) for your own key, chord choices and edits.
// The active version's fields live directly on the song (so the rest of the app is unchanged);
// the others are stored in song.versions keyed "guitar", "ukulele", "piano", "guitar:mine", …
import { TUNINGS, noteIndex, voicing, transposeChord, noteName } from './theory.js';
import { uid } from './model.js';

const FIELDS = ['instrument', 'tuning', 'tuningName', 'capo', 'transpose', 'blocks', 'bpm', 'key'];
const clone = (o) => JSON.parse(JSON.stringify(o));

export const versionKey = (inst, mine) => inst + (mine ? ':mine' : '');
export const activeKey = (song) => song.active || versionKey(song.instrument, false);
export const isMine = (song) => activeKey(song).endsWith(':mine');
export const hasVersion = (song, key) => key === activeKey(song) || !!(song.versions && song.versions[key]);
export const hasMine = (song) => isMine(song) || Object.keys(song.versions || {}).some(k => k.endsWith(':mine'));

function snapshot(song) { const o = {}; for (const f of FIELDS) o[f] = clone(song[f] ?? null); return o; }
function load(song, v) { for (const f of FIELDS) song[f] = clone(v[f] ?? null); song.transpose = song.transpose || 0; song.capo = song.capo || 0; }

// Switch the song to another version, creating it if needed. Returns 'switched' | 'created'.
export function switchVersion(song, instrument, mine) {
  const from = activeKey(song), to = versionKey(instrument, mine);
  if (from === to) return 'same';
  song.versions = song.versions || {};
  song.versions[from] = snapshot(song);
  let made = 'switched';
  if (!song.versions[to]) {
    made = 'created';
    // a personal version starts as a copy of that instrument's original (or of what you're looking at)
    const base = mine ? song.versions[versionKey(instrument, false)] : song.versions[versionKey(instrument, true)];
    const src = base || song.versions[from];
    song.versions[to] = src.instrument === instrument ? clone(src) : convert(src, instrument);
  }
  load(song, song.versions[to]);
  delete song.versions[to];
  song.active = to;
  return made;
}

// ---------- conversion between instruments
const STD = { guitar: TUNINGS.guitar[0], ukulele: TUNINGS.ukulele[0] };

// MIDI pitch of each open string (low → high as stored).
export function openPitches(tuning, instrument, tuningName = '') {
  const pcs = tuning.map(noteIndex);
  if (instrument === 'ukulele') {
    const p = [];
    p[1] = 48 + ((pcs[1] - 7 + 12) % 12) + 7; // second string between G3 and F#4
    for (let i = 2; i < pcs.length; i++) { let x = p[i - 1] + 1; while (x % 12 !== pcs[i]) x++; p[i] = x; }
    let s0 = p[1] + 1; while (s0 % 12 !== pcs[0]) s0++;                 // re-entrant high string (G in GCEA)
    if (/bari/i.test(tuningName) || s0 - p[1] > 9) { s0 -= 12; }        // baritone: low D
    p[0] = s0;
    return p;
  }
  const p = [36 + pcs[0]]; // lowest string between C2 and B2
  for (let i = 1; i < pcs.length; i++) { let x = p[i - 1] + 1; while (x % 12 !== pcs[i]) x++; p[i] = x; }
  return p;
}

function convert(src, target) {
  const v = clone(src);
  v.instrument = target;
  if (target === 'piano') {
    v.tuning = []; v.tuningName = '—';
    const shift = src.capo || 0; v.capo = 0; // piano plays the sounding chords
    const tp = (c) => (shift ? transposeChord(c, shift, /b/.test(c)) : c);
    v.blocks = src.blocks.map(b => {
      if (b.type === 'chords') return { ...clone(b), id: uid(), text: shift ? b.text.replace(/\[([^\]]+)\]/g, (m, c) => `[${tp(c)}]`) : b.text };
      if (b.type !== 'tab') return clone(b);
      return { id: uid(), type: 'chords', text: tabToChordText(b, src, tp) };
    }).filter(Boolean);
    return v;
  }
  const t = STD[target];
  v.tuning = t.notes.slice(); v.tuningName = t.name;
  if (src.instrument === 'piano') { v.capo = 0; return v; }
  const fromOpen = openPitches(src.tuning, src.instrument, src.tuningName);
  const toOpen = openPitches(v.tuning, target, v.tuningName);
  v.blocks = src.blocks.map(b => (b.type === 'tab' ? convertTab(b, src, v, fromOpen, toOpen) : clone(b)));
  return v;
}

function tabToChordText(b, src, tp) {
  const lines = [];
  let line = '', notes = [];
  const open = openPitches(src.tuning, src.instrument, src.tuningName);
  for (const m of b.measures) {
    for (const c of m.cols) {
      if (c.c || c.l) line += (c.c ? `[${tp(c.c)}]` : '') + (c.l ? c.l + ' ' : c.c ? ' ' : '');
      c.n.forEach((f, i) => { const k = parseInt(f, 10); if (!isNaN(k)) notes.push(noteName(open[i] + (src.capo || 0) + k)); });
    }
  }
  const hasLyrics = b.measures.some(m => m.cols.some(c => c.l));
  if (line.trim()) lines.push(line.trimEnd());
  if (notes.length && !hasLyrics) lines.push('Notes: ' + notes.slice(0, 48).join(' '));
  return lines.join('\n');
}

function convertTab(b, src, dst, fromOpen, toOpen) {
  const n = dst.tuning.length;
  const out = { ...clone(b), id: uid() };
  const lo = toOpen.reduce((a, x) => Math.min(a, x)), hi = Math.max(...toOpen) + 15;
  for (const m of out.measures) for (const c of m.cols) {
    const old = c.n;
    const played = old.filter(x => x !== '').length;
    c.n = new Array(n).fill('');
    if (!played) continue;
    // a strummed chord → use the target instrument's shape for it
    if (c.c && played >= 3) { const shape = voicing(c.c, dst.tuning); if (shape) { c.n = shape.map(f => (f < 0 ? '' : String(f))); continue; } }
    // otherwise move each note to the same pitch on the new instrument
    const notes = [];
    old.forEach((tok, i) => {
      const m2 = String(tok).match(/^(\(|<)?(\d{1,2})(.*)$/);
      if (!m2) return;
      let pitch = fromOpen[i] + (src.capo || 0) + +m2[2];
      while (pitch < lo + (dst.capo || 0)) pitch += 12;
      while (pitch > hi + (dst.capo || 0)) pitch -= 12;
      notes.push({ pitch, pre: m2[1] || '', rest: m2[3] || '', base: +m2[2] });
    });
    notes.sort((a, b2) => b2.pitch - a.pitch);
    const used = new Set();
    for (const nt of notes) {
      let best = -1, bestF = 99;
      for (let s = n - 1; s >= 0; s--) {
        if (used.has(s)) continue;
        const f = nt.pitch - toOpen[s] - (dst.capo || 0);
        if (f >= 0 && f <= 15 && f < bestF) { best = s; bestF = f; }
      }
      if (best < 0) continue;
      used.add(best);
      const delta = bestF - nt.base;
      const rest = nt.rest.replace(/\d+/g, (d) => String(Math.max(0, +d + delta))); // e.g. 5h7 → keep the same interval
      c.n[best] = nt.pre + bestF + rest;
    }
  }
  return out;
}

// The original (radio) version's BPM, when you're looking at your own version of the same instrument.
export function originalBpm(song) {
  if (!isMine(song)) return null;
  const o = song.versions && song.versions[versionKey(song.instrument, false)];
  return o && o.bpm ? o.bpm : null;
}
