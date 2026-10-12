// The Gift of Tab — music theory: notes, tunings, chords, voicings, transposition.

export const SHARPS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const FLATS  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const NOTE_INDEX = { C:0,'B#':0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11 };

export function noteIndex(n) { return NOTE_INDEX[n] ?? NOTE_INDEX[(n||'').charAt(0).toUpperCase() + (n||'').slice(1)]; }

// Instruments. Strings are listed LOW → HIGH (tab renders them high on top).
export const INSTRUMENTS = {
  guitar:  { name: '6-string guitar', strings: 6 },
  ukulele: { name: 'Ukulele', strings: 4 },
  piano:   { name: 'Piano (chords & lyrics)', strings: 0 },
};

export const TUNINGS = {
  guitar: [
    { name: 'Standard', notes: ['E','A','D','G','B','E'] },
    { name: 'Drop D', notes: ['D','A','D','G','B','E'] },
    { name: 'Double Drop D', notes: ['D','A','D','G','B','D'] },
    { name: 'DADGAD', notes: ['D','A','D','G','A','D'] },
    { name: 'Open G', notes: ['D','G','D','G','B','D'] },
    { name: 'Open D', notes: ['D','A','D','F#','A','D'] },
    { name: 'Open E', notes: ['E','B','E','G#','B','E'] },
    { name: 'Open C', notes: ['C','G','C','G','C','E'] },
    { name: 'Half step down', notes: ['Eb','Ab','Db','Gb','Bb','Eb'] },
    { name: 'Full step down', notes: ['D','G','C','F','A','D'] },
    { name: 'Drop C', notes: ['C','G','C','F','A','D'] },
  ],
  ukulele: [
    { name: 'Standard (GCEA)', notes: ['G','C','E','A'] },
    { name: 'D tuning (ADF#B)', notes: ['A','D','F#','B'] },
    { name: 'Baritone (DGBE)', notes: ['D','G','B','E'] },
  ],
  piano: [{ name: '—', notes: [] }],
};

// Chord qualities → intervals (semitones from root). Order matters for parsing (longest first).
const QUALITIES = [
  ['maj7', [0,4,7,11]], ['M7', [0,4,7,11]], ['maj9', [0,4,7,11,2]], ['m7b5', [0,3,6,10]], ['dim7', [0,3,6,9]],
  ['mmaj7', [0,3,7,11]], ['m9', [0,3,7,10,2]], ['m7', [0,3,7,10]], ['m6', [0,3,7,9]], ['madd9', [0,3,7,2]],
  ['7sus4', [0,5,7,10]], ['sus2', [0,2,7]], ['sus4', [0,5,7]], ['sus', [0,5,7]], ['add9', [0,4,7,2]], ['add2', [0,2,4,7]],
  ['dim', [0,3,6]], ['aug', [0,4,8]], ['+', [0,4,8]], ['13', [0,4,7,10,9]], ['11', [0,4,7,10,5]], ['9', [0,4,7,10,2]],
  ['7', [0,4,7,10]], ['6', [0,4,7,9]], ['5', [0,7]], ['min', [0,3,7]], ['m', [0,3,7]], ['-', [0,3,7]], ['maj', [0,4,7]], ['', [0,4,7]],
];

export function parseChord(name) {
  if (!name) return null;
  const m = String(name).trim().match(/^([A-G])([#b]?)([^/\s]*)(?:\/([A-G][#b]?))?$/);
  if (!m) return null;
  const root = noteIndex(m[1] + m[2]);
  let q = m[3];
  const found = QUALITIES.find(([k]) => q === k) || QUALITIES.find(([k]) => k && q.startsWith(k));
  if (!found) return null;
  const bass = m[4] ? noteIndex(m[4]) : root;
  return { root, quality: found[0], intervals: found[1], bass, pcs: [...new Set(found[1].map(i => (root + i) % 12))], name: String(name).trim() };
}

export const CHORD_RE = /^[A-G][#b]?(?:maj7|maj9|M7|m7b5|dim7|mmaj7|m9|m7|m6|madd9|7sus4|sus2|sus4|sus|add9|add2|dim|aug|\+|13|11|9|7|6|5|min|m|-|maj)?(?:\/[A-G][#b]?)?$/;
export function isChord(tok) { return CHORD_RE.test(tok); }

// Hand-picked shapes for standard tunings (low → high; -1 = muted).
const GUITAR_SHAPES = {
  'C':[-1,3,2,0,1,0],'C7':[-1,3,2,3,1,0],'Cmaj7':[-1,3,2,0,0,0],'Cadd9':[-1,3,2,0,3,0],'Cm':[-1,3,5,5,4,3],'Csus2':[-1,3,0,0,1,3],'Csus4':[-1,3,3,0,1,1],
  'D':[-1,-1,0,2,3,2],'Dm':[-1,-1,0,2,3,1],'D7':[-1,-1,0,2,1,2],'Dmaj7':[-1,-1,0,2,2,2],'Dm7':[-1,-1,0,2,1,1],'Dsus2':[-1,-1,0,2,3,0],'Dsus4':[-1,-1,0,2,3,3],'D/F#':[2,0,0,2,3,2],
  'E':[0,2,2,1,0,0],'Em':[0,2,2,0,0,0],'E7':[0,2,0,1,0,0],'Em7':[0,2,2,0,3,0],'Esus4':[0,2,2,2,0,0],'Emaj7':[0,2,1,1,0,0],
  'F':[1,3,3,2,1,1],'Fmaj7':[-1,-1,3,2,1,0],'Fm':[1,3,3,1,1,1],'F7':[1,3,1,2,1,1],
  'G':[3,2,0,0,0,3],'G7':[3,2,0,0,0,1],'Gmaj7':[3,2,0,0,0,2],'Gm':[3,5,5,3,3,3],'Gsus4':[3,3,0,0,1,3],'G/B':[-1,2,0,0,0,3],
  'A':[-1,0,2,2,2,0],'Am':[-1,0,2,2,1,0],'A7':[-1,0,2,0,2,0],'Am7':[-1,0,2,0,1,0],'Asus2':[-1,0,2,2,0,0],'Asus4':[-1,0,2,2,3,0],'Amaj7':[-1,0,2,1,2,0],
  'B':[-1,2,4,4,4,2],'Bm':[-1,2,4,4,3,2],'B7':[-1,2,1,2,0,2],'Bm7':[-1,2,0,2,0,2],
  'Bb':[-1,1,3,3,3,1],'Bbmaj7':[-1,1,3,2,3,1],'F#m':[2,4,4,2,2,2],'F#':[2,4,4,3,2,2],'C#m':[-1,4,6,6,5,4],'G#m':[4,6,6,4,4,4],'Eb':[-1,-1,1,3,4,3],'Ab':[4,6,6,5,4,4],
};
const UKE_SHAPES = { // G C E A
  'C':[0,0,0,3],'C7':[0,0,0,1],'Cmaj7':[0,0,0,2],'Cm':[0,3,3,3],'D':[2,2,2,0],'Dm':[2,2,1,0],'D7':[2,2,2,3],'Dm7':[2,2,1,3],
  'E':[4,4,4,2],'Em':[0,4,3,2],'E7':[1,2,0,2],'Em7':[0,2,0,2],'F':[2,0,1,0],'Fmaj7':[2,4,1,3],'Fm':[1,0,1,3],
  'G':[0,2,3,2],'G7':[0,2,1,2],'Gm':[0,2,3,1],'A':[2,1,0,0],'Am':[2,0,0,0],'A7':[0,1,0,0],'Am7':[0,0,0,0],
  'B':[4,3,2,2],'Bm':[4,2,2,2],'B7':[2,3,2,2],'Bb':[3,2,1,1],'F#m':[2,1,2,0],'C#m':[1,1,0,4],'Asus4':[2,2,0,0],'Dsus4':[0,2,3,0],
};

export const COMMON_CHORDS = [
  ['C','Cmaj7','C7','Cadd9','Cm','Csus2'], ['D','Dm','D7','Dmaj7','Dm7','Dsus2','Dsus4','D/F#'],
  ['E','Em','E7','Em7','Esus4'], ['F','Fmaj7','Fm','F7'], ['G','G7','Gmaj7','Gm','Gsus4','G/B'],
  ['A','Am','A7','Am7','Asus2','Asus4'], ['B','Bm','B7','Bm7','Bb'], ['F#m','C#m','G#m','Eb','Ab'],
];

const sameTuning = (a, b) => a.length === b.length && a.every((n, i) => noteIndex(n) === noteIndex(b[i]));

// Returns frets per string LOW → HIGH (-1 = muted), relative to the capo.
export function voicing(chordName, tuning) {
  const ch = parseChord(chordName);
  if (!ch || !tuning || !tuning.length) return null;
  if (tuning.length === 6 && sameTuning(tuning, ['E','A','D','G','B','E']) && GUITAR_SHAPES[chordName]) return GUITAR_SHAPES[chordName].slice();
  if (tuning.length === 4 && sameTuning(tuning, ['G','C','E','A']) && UKE_SHAPES[chordName]) return UKE_SHAPES[chordName].slice();
  return searchVoicing(ch, tuning.map(noteIndex));
}

function searchVoicing(ch, open) {
  const n = open.length, need = new Set(ch.pcs);
  let best = null, bestScore = -Infinity;
  for (let base = 0; base <= 10; base++) {
    const opts = open.map(o => {
      const c = [-1];
      for (let f = 0; f <= 12; f++) if ((f === 0 || (f >= base && f <= base + 3)) && need.has((o + f) % 12)) c.push(f);
      return c;
    });
    const cur = new Array(n);
    const rec = (i) => {
      if (i === n) { const s = score(cur); if (s > bestScore) { bestScore = s; best = cur.slice(); } return; }
      for (const f of opts[i]) { cur[i] = f; rec(i + 1); }
    };
    rec(0);
  }
  function score(v) {
    const played = v.map((f, i) => f < 0 ? null : (open[i] + f) % 12);
    const firstPlayed = played.findIndex(p => p !== null);
    if (firstPlayed < 0) return -Infinity;
    // muted strings only allowed on the bass side (guitar) — none in the middle
    for (let i = firstPlayed; i < n; i++) if (played[i] === null) return -Infinity;
    const got = new Set(played.filter(p => p !== null));
    for (const p of need) if (!got.has(p) && !(ch.pcs.length > 3 && p === (ch.root + 7) % 12)) return -Infinity;
    const fretted = v.filter(f => f > 0);
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    if (span > 3) return -Infinity;
    let s = 0;
    s += (n - firstPlayed) * 10;                         // more strings
    if (n > 4) s += played[firstPlayed] === ch.bass ? 40 : -30; // correct bass (not for reentrant uke)
    else s -= firstPlayed * 40;
    s -= span * 3;
    s -= (fretted.length ? Math.min(...fretted) : 0) * 2; // lower position
    s += v.filter(f => f === 0).length * 3;               // open strings
    s -= new Set(fretted).size > 3 ? 8 : 0;
    return s;
  }
  return best;
}

export function transposeChord(name, steps, preferFlats) {
  return String(name).replace(/([A-G][#b]?)/g, (m) => {
    const i = noteIndex(m); if (i === undefined) return m;
    const k = ((i + steps) % 12 + 12) % 12;
    return (preferFlats ? FLATS : SHARPS)[k];
  });
}

export function noteName(pc, preferFlats) { return (preferFlats ? FLATS : SHARPS)[((pc % 12) + 12) % 12]; }

// Piano: which keys (pitch classes, plus bass) to show.
export function pianoNotes(chordName) {
  const ch = parseChord(chordName); if (!ch) return null;
  const notes = ch.intervals.map(i => ch.root + i);
  return { bass: ch.bass, notes };
}
