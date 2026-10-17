// Tech tab — data helpers. A tech tab is a score with one staff ('g') whose events hold tab cells:
// score = { keyFifths, time: [n, d], staves: ['g'], notation: true, measures: [{ g: [event] }] }
// event = { d, dot?, rest?, n: [cell per string, low → high], tie?, lyric?, chord?, section? }
// Cells use the same text as the plain tab: '5', '0h2', '5h', '7/', '5b', '5r', '5~', 'x', '(5)', '<12>', 'PM5'.
import { DUR, DUR_ORDER, capacity, restsFor, KEY_NAMES, KEY_MINOR } from './model.js';
import { openPitches } from '../versions.js';

export function newTech() {
  return { keyFifths: 0, time: [4, 4], staves: ['g'], notation: true, measures: [{ g: [] }] };
}

const core = (cell) => String(cell || '').replace(/^PM/, '');
// The fret that sounds first in a cell (null for muted/empty).
export function fretOf(cell) {
  const c = core(cell);
  if (!c || /^x$/i.test(c)) return null;
  const m = c.match(/\d+/);
  return m ? +m[0] : null;
}
export const hasNotes = (e) => !e.rest && e.n && e.n.some(c => fretOf(c) != null || /^x$/i.test(core(c)));

// Sounding MIDI pitches of an event.
export function pitchesOf(e, song) {
  if (e.rest || !e.n) return [];
  const open = openPitches(song.tuning, song.instrument, song.tuningName);
  const out = [];
  e.n.forEach((c, s) => { const f = fretOf(c); if (f != null && open[s] != null) out.push(open[s] + (song.capo || 0) + f); });
  return out;
}

// Note values that add up to a length (for durations that aren't a single note value).
export function notesFor(L) {
  const out = [];
  for (const d of DUR_ORDER) {
    if (d !== '16' && L >= DUR[d] * 1.5) { out.push({ d, dot: true }); L -= DUR[d] * 1.5; }
    while (L >= DUR[d]) { out.push({ d }); L -= DUR[d]; }
  }
  return out;
}

// Turn a plain tab song into a tech tab. Beat spacing in the plain tab becomes the rhythm: columns are
// spread evenly across the bar and snapped to sixteenths, so it's a starting point to check by ear.
export function fromTab(song) {
  const sc = newTech();
  sc.time = [song.beats || 4, 4];
  if (song.key) { const f = Object.keys(KEY_NAMES).find(k => KEY_NAMES[k] === song.key || KEY_MINOR[k] === song.key); if (f != null) sc.keyFifths = +f; }
  const cap = capacity(sc), n = song.tuning.length;
  sc.measures = [];
  let pendingSection = null;
  for (const b of song.blocks || []) {
    if (b.type === 'section') { pendingSection = b.text || null; continue; }
    if (b.type !== 'tab') continue;
    for (const meas of b.measures) {
      const cols = meas.cols || [];
      const k = Math.max(1, cols.length);
      const onsets = [];
      cols.forEach((c, ci) => {
        const has = c.r || (c.n || []).some(Boolean) || c.c || c.l;
        if (has) onsets.push({ t: Math.min(cap - 2, Math.round((ci / k) * cap / 2) * 2), c });
      });
      // merge onsets that snapped to the same time
      const merged = [];
      for (const o of onsets) {
        const last = merged[merged.length - 1];
        if (last && last.t === o.t) { last.c = { ...last.c, n: (last.c.n || []).map((v, s) => v || (o.c.n || [])[s] || ''), c: last.c.c || o.c.c, l: [last.c.l, o.c.l].filter(Boolean).join(' ') }; }
        else merged.push({ ...o });
      }
      const evs = [];
      if (!merged.length || merged[0].t > 0) evs.push(...restsFor(merged.length ? merged[0].t : cap).map(r => ({ ...r })));
      merged.forEach((o, j) => {
        const end = j + 1 < merged.length ? merged[j + 1].t : cap;
        const parts = notesFor(end - o.t);
        const cells = Array.from({ length: n }, (_, s) => (o.c.n || [])[s] || '');
        const isRest = o.c.r || !cells.some(Boolean);
        parts.forEach((p, pi) => {
          const e = { d: p.d, ...(p.dot ? { dot: true } : {}) };
          if (isRest) e.rest = true;
          else { e.n = pi === 0 ? cells.slice() : cells.map(c => (fretOf(c) != null ? String(fretOf(c)) : '')); if (pi < parts.length - 1) e.tie = true; }
          if (pi === 0) { if (o.c.c) e.chord = o.c.c; if (o.c.l) e.lyric = o.c.l; }
          evs.push(e);
        });
      });
      if (pendingSection && evs.length) { evs[0].section = pendingSection; pendingSection = null; }
      sc.measures.push({ g: evs });
    }
  }
  if (!sc.measures.length) sc.measures = [{ g: [] }];
  return sc;
}
