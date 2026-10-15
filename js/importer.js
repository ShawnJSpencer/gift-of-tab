// Import tabs pasted from other sites (Ultimate Guitar, Songsterr text, ChordPro, plain chord sheets).
import { isChord, noteIndex, TUNINGS } from './theory.js';
import { uid, now, emptyCol } from './model.js';

const TAB_LINE = /^\s*([A-Ga-g][#b]?)?\s*[|:]?[-–x0-9hpbrsStT\/\\~|().<>*=^ ]*$/;
const isTabLine = (l) => TAB_LINE.test(l) && (l.match(/[-–]/g) || []).length >= 4;
const CHORD_EXTRAS = /^(\||x\d+|\(|\)|-+|N\.?C\.?|\/|\.+|%)$/i;

function isChordLine(l) {
  const toks = l.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  let chords = 0;
  for (const t of toks) {
    const tt = t.replace(/^\(|\)$/g, '');
    if (isChord(tt)) chords++;
    else if (!CHORD_EXTRAS.test(t)) return false;
  }
  return chords > 0;
}

function sectionName(l) {
  const t = l.trim();
  let m = t.match(/^\[([^\]]+)\]$/);
  if (m && !isChord(m[1])) return m[1];
  m = t.match(/^\{(?:c|comment|soc|start_of_chorus|sov|start_of_verse)(?::\s*(.*))?\}$/i);
  if (m) return m[1] || (/soc|chorus/i.test(t) ? 'Chorus' : /sov|verse/i.test(t) ? 'Verse' : '');
  m = t.match(/^(intro|verse|chorus|pre-?chorus|bridge|outro|solo|interlude|instrumental|riff|hook|refrain|coda|tag|ending)(\s*\d+)?\s*:?\s*(x\d+)?$/i);
  if (m) return t.replace(/:$/, '');
  return null;
}

function chordsOverLyrics(chordLine, lyric) {
  // Insert [Chord] markers into the lyric at each chord's column.
  const marks = [];
  for (const m of chordLine.matchAll(/\S+/g)) {
    const tok = m[0].replace(/^\(|\)$/g, '');
    if (isChord(tok)) marks.push([m.index, tok]);
  }
  let out = lyric ?? '';
  for (let i = marks.length - 1; i >= 0; i--) {
    const [pos, ch] = marks[i];
    if (out.length < pos) out = out.padEnd(pos, ' ');
    out = out.slice(0, pos) + '[' + ch + ']' + out.slice(pos);
  }
  return out.replace(/\s+$/, '');
}

function parseTabGroup(lines, chordLine, lyricLine) {
  // Each line: optional string name, then body. Find where body starts per line.
  const info = lines.map(l => {
    const m = l.match(/^\s*([A-Ga-g][#b]?)?\s*[|:]?/);
    return { name: m[1] || null, line: l };
  });
  // Assume lines are aligned: use the max prefix so chord/lyric positions line up.
  const prefix = Math.max(...lines.map(l => l.match(/^\s*([A-Ga-g][#b]?)?\s*[|:]?/)[0].length));
  const bodies = lines.map(l => l.slice(prefix));
  const width = Math.max(...bodies.map(b => b.length));
  // Bar positions: where most lines have '|'
  const bars = [];
  for (let x = 0; x < width; x++) {
    const n = bodies.filter(b => b[x] === '|').length;
    if (n >= Math.ceil(bodies.length / 2)) bars.push(x);
  }
  const cuts = [0, ...bars, width].filter((v, i, a) => i === 0 || v > a[i - 1]);
  // Tokens
  const toks = [];
  bodies.forEach((b, si) => {
    for (const m of b.matchAll(/[^-–|\s]+/g)) toks.push({ s: si, x: m.index, e: m.index + m[0].length, t: m[0] });
  });
  const chordToks = [];
  if (chordLine) for (const m of chordLine.matchAll(/\S+/g)) if (isChord(m[0])) chordToks.push({ x: m.index - prefix, t: m[0] });
  const lyricToks = [];
  if (lyricLine) for (const m of lyricLine.matchAll(/\S+/g)) lyricToks.push({ x: m.index - prefix, t: m[0] });

  const nStr = lines.length;
  const measures = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    const inM = toks.filter(t => t.x >= a && t.x < b).sort((p, q) => p.x - q.x);
    if (!inM.length && b - a < 3) continue;
    const clusters = [];
    for (const t of inM) {
      const last = clusters[clusters.length - 1];
      if (last && t.x < last.e) { last.toks.push(t); last.e = Math.max(last.e, t.e); }
      else clusters.push({ x: t.x, e: t.e, toks: [t] });
    }
    const cols = [];
    let prevEnd = a + 1;
    const pad = (gap) => { const k = Math.min(3, Math.max(0, Math.round(gap / 3) - 1)); for (let i = 0; i < k; i++) cols.push({ col: emptyCol(nStr), x: null }); };
    for (const c of clusters) {
      pad(c.x - prevEnd);
      const col = emptyCol(nStr);
      for (const t of c.toks) col.n[nStr - 1 - t.s] = t.t;
      cols.push({ col, x: c.x });
      prevEnd = c.e;
    }
    pad(b - prevEnd);
    if (!cols.length) for (let i = 0; i < 4; i++) cols.push({ col: emptyCol(nStr), x: null });
    // attach chords / lyrics to nearest column at or before their position
    const attach = (items, key) => {
      for (const it of items) {
        if (it.x < a || it.x >= b) continue;
        let best = null;
        for (const c of cols) if (c.x !== null && c.x <= it.x + 1) best = c;
        if (!best) best = cols.find(c => c.x !== null) || cols[0];
        best.col[key] = best.col[key] ? best.col[key] + ' ' + it.t : it.t;
      }
    };
    attach(chordToks, 'c');
    attach(lyricToks, 'l');
    measures.push({ cols: cols.map(c => c.col) });
  }
  const names = info.map(i => i.name);
  return { measures, names, hasLyrics: lyricToks.length > 0 };
}

export function importText(raw, opts = {}) {
  let text = String(raw || '')
    .replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .replace(/\[\/?(ch|tab)\]/g, '')            // Ultimate Guitar source tags
    .replace(/ /g, ' ');
  const lines = text.split('\n');
  const song = {
    id: uid(), title: opts.title || '', artist: opts.artist || '', instrument: 'guitar',
    tuning: TUNINGS.guitar[0].notes.slice(), tuningName: 'Standard', capo: 0, beats: 4, subdiv: 2,
    notes: '', blocks: [], created: now(), updated: now(), source: opts.source || '',
  };
  let tuningSet = false, stringsSeen = null;
  let chordBuf = null; // current chords block lines
  const flush = () => {
    if (chordBuf) {
      while (chordBuf.length && !chordBuf[chordBuf.length - 1].trim()) chordBuf.pop();
      while (chordBuf.length && !chordBuf[0].trim()) chordBuf.shift();
      if (chordBuf.length) song.blocks.push({ id: uid(), type: 'chords', text: chordBuf.join('\n') });
    }
    chordBuf = null;
  };
  const pushChordLine = (l) => { (chordBuf ||= []).push(l); };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (opts.metaLine && t === opts.metaLine) continue;
    // Metadata
    let m;
    if ((m = t.match(/^\{(?:title|t):\s*(.+)\}$/i))) { song.title ||= m[1]; continue; }
    if ((m = t.match(/^\{(?:artist|subtitle|st):\s*(.+)\}$/i))) { song.artist ||= m[1]; continue; }
    if ((m = t.match(/^\{?\s*(?:tempo|bpm)\s*[:=]?\s*(\d{2,3})\s*(?:bpm)?\s*\}?$/i)) || (m = t.match(/^(?:♩|\u2669|q)\s*=\s*(\d{2,3})$/i)) || (m = t.match(/^(\d{2,3})\s*bpm$/i))) {
      const b = +m[1]; if (b >= 30 && b <= 300) song.bpm = b; continue;
    }
    if ((m = t.match(/^\{?capo:?\s*(\d+)/i)) || (m = t.match(/^capo\s*(?:on|at)?\s*(?:fret)?\s*(\d+)/i))) { song.capo = +m[1]; continue; }
    if ((m = t.match(/^\{?tuning:?\s*(.+?)\}?$/i))) {
      const v = m[1].trim();
      const preset = [...TUNINGS.guitar, ...TUNINGS.ukulele].find(p => p.name.toLowerCase().startsWith(v.toLowerCase().replace(/\s*tuning$/, '')));
      const notes = v.replace(/[,\s]+/g, ' ').trim().split(' ');
      if (notes.length >= 4 && notes.every(n => noteIndex(n) !== undefined)) {
        song.tuning = notes; tuningSet = true;
        const p = [...TUNINGS.guitar, ...TUNINGS.ukulele].find(t => t.notes.length === notes.length && t.notes.every((x, k) => noteIndex(x) === noteIndex(notes[k])));
        song.tuningName = p ? p.name : 'Custom';
      }
      else if (/^e\s*standard|^standard/i.test(v)) { tuningSet = true; }
      else if (preset) { song.tuning = preset.notes.slice(); song.tuningName = preset.name; tuningSet = true; }
      continue;
    }
    if (/^\{(eoc|end_of_chorus|eov|end_of_verse)\}$/i.test(t)) continue;
    const sec = sectionName(l);
    if (sec !== null) { flush(); if (sec) song.blocks.push({ id: uid(), type: 'section', text: sec }); continue; }

    if (isTabLine(l)) {
      flush();
      const group = [];
      while (i < lines.length && isTabLine(lines[i])) group.push(lines[i++]);
      i--;
      // A chord line right above the group (already consumed into chordBuf?) — check original line
      let chordLine = null, lyricLine = null;
      const prev = lines[i - group.length];
      if (prev && isChordLine(prev)) {
        chordLine = prev;
        // remove it from the previous chords block if it got added
        const lastB = song.blocks[song.blocks.length - 1];
        if (lastB && lastB.type === 'chords') {
          const ls = lastB.text.split('\n'); const conv = chordsOverLyrics(prev, '');
          if (ls[ls.length - 1] === conv) { ls.pop(); if (ls.length) lastB.text = ls.join('\n'); else song.blocks.pop(); }
        }
      }
      const next = lines[i + 1];
      if (next && next.trim() && !isTabLine(next) && !isChordLine(next) && sectionName(next) === null) { lyricLine = next; i++; }
      if (group.length < 3) { group.forEach(pushChordLine); continue; }
      const parsed = parseTabGroup(group, chordLine, lyricLine);
      stringsSeen ||= group.length;
      if (!tuningSet && parsed.names.every(Boolean)) {
        const notes = parsed.names.slice().reverse().map(n => n.charAt(0).toUpperCase() + n.slice(1));
        if (notes.every(n => noteIndex(n) !== undefined)) {
          song.tuning = notes; tuningSet = true;
          const all = [...TUNINGS.guitar, ...TUNINGS.ukulele];
          const p = all.find(p => p.notes.length === notes.length && p.notes.every((x, k) => noteIndex(x) === noteIndex(notes[k])));
          song.tuningName = p ? p.name : 'Custom';
        }
      }
      if (parsed.measures.length) song.blocks.push({ id: uid(), type: 'tab', lyrics: parsed.hasLyrics, measures: parsed.measures });
      continue;
    }

    if (isChordLine(l)) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !isChordLine(next) && !isTabLine(next) && sectionName(next) === null) {
        pushChordLine(chordsOverLyrics(l, next)); i++;
      } else if (next !== undefined && isTabLine(next)) {
        // chord line above a tab: handled by tab parser
        flush();
      } else pushChordLine(chordsOverLyrics(l, ''));
      continue;
    }
    if (!t) { if (chordBuf) pushChordLine(''); continue; }
    pushChordLine(l.replace(/\s+$/, ''));
  }
  flush();

  // Instrument from string count
  if (stringsSeen === 4 || (song.tuning.length === 4)) {
    song.instrument = 'ukulele';
    if (song.tuning.length !== 4) { song.tuning = TUNINGS.ukulele[0].notes.slice(); song.tuningName = TUNINGS.ukulele[0].name; }
    else if (!tuningSet) { song.tuning = TUNINGS.ukulele[0].notes.slice(); song.tuningName = TUNINGS.ukulele[0].name; }
  }
  if (opts.instrument === 'piano') song.instrument = 'piano';
  // you picked Guitar but the tab looked like 4 strings → keep it a guitar tab (standard tuning)
  if (opts.instrument === 'guitar' && song.instrument === 'ukulele') {
    song.instrument = 'guitar'; song.tuning = TUNINGS.guitar[0].notes.slice(); song.tuningName = TUNINGS.guitar[0].name;
  }
  if (opts.instrument === 'ukulele' && song.instrument === 'guitar' && !song.blocks.some(b => b.type === 'tab')) {
    song.instrument = 'ukulele'; song.tuning = TUNINGS.ukulele[0].notes.slice(); song.tuningName = TUNINGS.ukulele[0].name;
  }
  // normalise tab blocks to the tuning's string count
  const n = song.tuning.length;
  for (const b of song.blocks) if (b.type === 'tab') for (const m of b.measures) for (const c of m.cols) {
    while (c.n.length < n) c.n.unshift(''); if (c.n.length > n) c.n = c.n.slice(c.n.length - n);
  }
  if (!song.title) song.title = 'Imported song';
  if (!song.blocks.length) song.blocks.push({ id: uid(), type: 'chords', text: '' });
  return song;
}

// Try to guess title/artist from a first line like "Wonderwall - Oasis" or "Wonderwall Chords by Oasis"
export function guessMeta(raw) {
  const first = String(raw || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  let m = first.match(/^(.+?)\s+(?:chords|tab|tabs|ukulele chords|bass tab)\s+by\s+(.+)$/i);
  if (m) return { title: m[1], artist: m[2], metaLine: first };
  m = first.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && !isTabLine(first) && !isChordLine(first)) return { title: m[1], artist: m[2], metaLine: first };
  return {};
}

// Convert any "chords over lyrics" pairs inside a text block into inline [Chord] markers.
export function convertChordSheet(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], next = lines[i + 1];
    if (isChordLine(l) && !/\[/.test(l)) {
      if (next !== undefined && next.trim() && !isChordLine(next)) { out.push(chordsOverLyrics(l, next)); i++; }
      else out.push(chordsOverLyrics(l, ''));
    } else out.push(l);
  }
  return out.join('\n');
}

// Find a tempo written in pasted text (Tempo: 120, BPM 120, ♩ = 89, 120 bpm).
export function findBpm(text) {
  const m = String(text || '').match(/(?:tempo|bpm)\s*[:=]?\s*(\d{2,3})|(?:♩|\u2669)\s*=\s*(\d{2,3})|\b(\d{2,3})\s*bpm\b/i);
  const b = m ? +(m[1] || m[2] || m[3]) : 0;
  return b >= 30 && b <= 300 ? b : null;
}
