// Piano sheet music — data model.
// score = { keyFifths: -7..7, time: [beats, unit], measures: [{ t: [events], b: [events] }] }   (t = treble/right hand, b = bass/left hand)
// event = { d: 'w'|'h'|'q'|'8'|'16', dot?: true, rest?: true, notes?: ['C#4', …], tie?: true, lyric?: '', chord?: '' }

export const DUR = { w: 32, h: 16, q: 8, '8': 4, '16': 2, '32': 1 }; // in 32nd notes
export const BEAMS = { '8': 1, '16': 2, '32': 3 };
export const DUR_ORDER = ['w', 'h', 'q', '8', '16'];
export const DUR_NAME = { w: 'Whole', h: 'Half', q: 'Quarter', '8': 'Eighth', '16': 'Sixteenth', '32': 'Thirty-second' };
export const len = (e) => DUR[e.d] * (e.dot ? 1.5 : 1);
export const capacity = (score) => score.time[0] * (32 / score.time[1]);

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

export function parsePitch(p) {
  const m = String(p).match(/^([A-G])(#|b|##|bb|n)?(-?\d)$/);
  if (!m) return null;
  const alter = { '#': 1, b: -1, '##': 2, bb: -2, n: 0 }[m[2]] ?? 0;
  const oct = +m[3];
  return { step: m[1], alter, oct, explicit: m[2] || '', midi: 12 * (oct + 1) + STEP_PC[m[1]] + alter, diatonic: oct * 7 + STEPS.indexOf(m[1]) };
}
export const midiOf = (p) => parsePitch(p).midi;
export const pitchStr = (step, alter, oct) => step + ({ 1: '#', '-1': 'b', 2: '##', '-2': 'bb', 0: '' }[alter] || '') + oct;

// Accidentals implied by the key signature: { F: 1, C: 1 } for D major, { B: -1 } for F major…
export function keyAlters(fifths) {
  const out = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(s => { out[s] = 1; });
  if (fifths < 0) SHARP_ORDER.slice().reverse().slice(0, -fifths).forEach(s => { out[s] = -1; });
  return out;
}
export const KEY_NAMES = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
export const KEY_MINOR = { '-7': 'Abm', '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m' };

// Spell a MIDI number in a key (sharps in sharp keys, flats in flat keys, key-signature notes first).
export function spell(midi, fifths) {
  const ka = keyAlters(fifths), pc = ((midi % 12) + 12) % 12, oct = Math.floor(midi / 12) - 1;
  for (const s of STEPS) { const a = ka[s] || 0; if ((STEP_PC[s] + a + 12) % 12 === pc) return fix(s, a, midi); }
  const useFlats = fifths < 0;
  for (const a of useFlats ? [-1, 1] : [1, -1]) for (const s of STEPS) if ((STEP_PC[s] + a + 12) % 12 === pc) return fix(s, a, midi);
  return pitchStr('C', 0, oct);
  function fix(s, a, m) { const o = Math.floor((m - STEP_PC[s] - a) / 12) - 1; return pitchStr(s, a, o); }
}

export function newScore() {
  return { keyFifths: 0, time: [4, 4], measures: [{ t: [], b: [] }] };
}

export const filled = (evs) => evs.reduce((a, e) => a + len(e), 0);
export const staves = (score) => score.staves || ['t', 'b'];
export const blankBar = (score) => Object.fromEntries(staves(score).map(s => [s, []]));

// Insert an event for one hand at position (m, i). Overflow flows into the next bar (new bars as needed).
export function insertEvent(score, staff, m, i, ev) {
  const cap = capacity(score);
  let mi = m, idx = i;
  while (true) {
    if (!score.measures[mi]) score.measures.push(blankBar(score));
    const evs = score.measures[mi][staff];
    if (idx > evs.length) idx = evs.length;
    if (filled(evs) + len(ev) <= cap) { evs.splice(idx, 0, ev); return { m: mi, i: idx }; }
    // doesn't fit: if inserting in the middle, push the bar's tail onward; otherwise go to the next bar
    if (idx < evs.length) {
      const tail = evs.splice(idx);
      evs.push(ev);
      while (filled(evs) > cap) tail.unshift(evs.pop());
      while (tail.length && filled(evs) + len(tail[0]) <= cap) evs.push(tail.shift());
      const at = evs.indexOf(ev);
      reflow(score, staff, mi + 1, tail);
      return at >= 0 ? { m: mi, i: at } : { m: mi + 1, i: 0 };
    }
    mi++; idx = 0;
  }
}
// Put events at the start of bar m, pushing later events onward as needed.
function reflow(score, staff, m, evs) {
  const cap = capacity(score);
  while (evs.length) {
    if (!score.measures[m]) score.measures.push(blankBar(score));
    const cur = score.measures[m][staff];
    cur.unshift(...evs); evs = [];
    while (filled(cur) > cap && cur.length > 1) evs.unshift(cur.pop());
    m++;
  }
}

export function removeEvent(score, staff, m, i) {
  const evs = score.measures[m] && score.measures[m][staff];
  if (!evs || !evs[i]) return;
  evs.splice(i, 1);
  trimEmptyEnd(score);
}
export function trimEmptyEnd(score) {
  while (score.measures.length > 1) {
    const last = score.measures[score.measures.length - 1];
    if (staves(score).some(s => last[s] && last[s].length)) break;
    score.measures.pop();
  }
}

// Move a note up/down by one step (diatonic, following the key signature).
export function stepNote(p, dir, fifths) {
  const q = parsePitch(p); if (!q) return p;
  let si = STEPS.indexOf(q.step) + dir, oct = q.oct;
  if (si > 6) { si = 0; oct++; } if (si < 0) { si = 6; oct--; }
  const s = STEPS[si];
  return pitchStr(s, keyAlters(fifths)[s] || 0, oct);
}
export function setAccidental(p, alter) { const q = parsePitch(p); return q ? pitchStr(q.step, alter, q.oct) : p; }
export function markNatural(p) { const q = parsePitch(p); return q ? q.step + 'n' + q.oct : p; }

// Transpose everything by semitones, re-spelling in the new key.
export function transposeScore(score, semis) {
  // +1 semitone = +7 on the circle of fifths (kept within -6..6)
  let f = score.keyFifths + 7 * semis; f = ((f % 12) + 12) % 12; if (f > 6) f -= 12;
  score.keyFifths = f;
  for (const m of score.measures) for (const st of staves(score)) for (const e of m[st]) {
    if (e.notes) e.notes = e.notes.map(p => spell(midiOf(p) + semis, f));
  }
  return score;
}

// Flatten into time-ordered playable notes: [{ time (in 32nds), dur, midi[] , ref }]
export function timeline(score, pitches = (e) => (e.notes || []).map(midiOf)) {
  const cap = capacity(score), out = [];
  score.measures.forEach((m, mi) => {
    for (const st of staves(score)) {
      let t = mi * cap;
      m[st].forEach((e, i) => {
        const mids = e.rest ? [] : pitches(e);
        if (mids.length) out.push({ time: t, dur: len(e), midi: mids, tie: !!e.tie, ref: { m: mi, s: st, i } });
        t += len(e);
      });
    }
  });
  // merge tied notes into one longer sound
  out.sort((a, b) => a.time - b.time);
  for (let k = 0; k < out.length; k++) {
    const a = out[k]; if (!a.tie) continue;
    const b = out.find(x => x !== a && x.time === a.time + a.dur && x.ref.s === a.ref.s && x.midi.join() === a.midi.join());
    if (b) { a.dur += b.dur; b.silent = true; }
  }
  return { events: out, total: score.measures.length * cap };
}

// Rests that add up to a length (largest first).
export function restsFor(L) {
  const out = [];
  for (const d of DUR_ORDER) {
    if (d !== '16' && L >= DUR[d] * 1.5) { out.push({ d, dot: true, rest: true }); L -= DUR[d] * 1.5; }
    while (L >= DUR[d]) { out.push({ d, rest: true }); L -= DUR[d]; }
  }
  return out;
}

// Re-bar after a time-signature change: pad short bars with rests, then pour each hand into the new bar size.
export function rebar(score, newTime) {
  const oldCap = capacity(score);
  const lastIdx = score.measures.length - 1;
  const sts = staves(score);
  const streams = Object.fromEntries(sts.map(s => [s, []]));
  score.measures.forEach((m, mi) => {
    for (const st of sts) {
      const gap = oldCap - filled(m[st]);
      streams[st].push(...m[st]);
      if (gap > 0 && mi < lastIdx) streams[st].push(...restsFor(gap));
    }
  });
  score.time = newTime;
  const cap = capacity(score);
  const out = Object.fromEntries(sts.map(s => [s, [[]]]));
  for (const st of sts) {
    for (const e of streams[st]) {
      let bar = out[st][out[st].length - 1];
      if (bar.length && filled(bar) + len(e) > cap) { bar = []; out[st].push(bar); }
      bar.push(e);
    }
  }
  const n = Math.max(...sts.map(s => out[s].length));
  score.measures = Array.from({ length: n }, (_, i) => Object.fromEntries(sts.map(s => [s, out[s][i] || []])));
  return score;
}

// Start time (32nds) of an event position.
export function timeAt(score, m, s, i) {
  const evs = (score.measures[m] && score.measures[m][s]) || [];
  return m * capacity(score) + filled(evs.slice(0, i));
}
