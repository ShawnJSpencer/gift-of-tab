// Song data model.
// Song: { id, title, artist, instrument, tuning[low→high], tuningName, capo, beats, subdiv, blocks[], created, updated }
// Blocks: {type:'section', text} | {type:'chords', text (ChordPro-style "[G]Amazing [C]grace")}
//         | {type:'tab', lyrics:bool, measures:[{cols:[{c:chord, n:[cell per string low→high], l:lyric}]}]}
import { TUNINGS } from './theory.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const now = () => Date.now();

export function stringCount(song) { return song.instrument === 'piano' ? 0 : song.tuning.length; }

export function emptyCol(n) { return { c: '', n: new Array(n).fill(''), l: '' }; }

export function newMeasure(song) {
  const k = (song.beats || 4) * (song.subdiv || 2);
  return { cols: Array.from({ length: k }, () => emptyCol(stringCount(song))) };
}

export function newTabBlock(song, measures = 2) {
  return { id: uid(), type: 'tab', lyrics: false, measures: Array.from({ length: measures }, () => newMeasure(song)) };
}

export function newSong(instrument = 'guitar') {
  const t = TUNINGS[instrument][0];
  const s = {
    id: uid(), title: 'Untitled song', artist: '', instrument, tuning: t.notes.slice(), tuningName: t.name,
    capo: 0, beats: 4, subdiv: 2, notes: '', blocks: [], created: now(), updated: now(),
  };
  if (instrument === 'piano') s.blocks.push({ id: uid(), type: 'chords', text: '' });
  else s.blocks.push(newTabBlock(s));
  return s;
}

// Change the number of strings on all tab blocks (e.g. switching guitar ↔ ukulele).
export function resizeStrings(song, n) {
  for (const b of song.blocks) if (b.type === 'tab')
    for (const m of b.measures) for (const c of m.cols) {
      if (c.n.length > n) c.n = c.n.slice(c.n.length - n);
      while (c.n.length < n) c.n.unshift('');
    }
}

export function songChords(song) {
  const set = new Set();
  for (const b of song.blocks) {
    if (b.type === 'tab') for (const m of b.measures) for (const c of m.cols) if (c.c) set.add(c.c);
    if (b.type === 'chords') for (const m of b.text.matchAll(/\[([^\]]+)\]/g)) set.add(m[1]);
  }
  return [...set];
}
