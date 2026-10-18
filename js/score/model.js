// Piano sheet music — data model.
// score = { keyFifths: -7..7, time: [beats, unit], measures: [{ t: [events], b: [events] }] }   (t = treble/right hand, b = bass/left hand)
// event = { d: 'w'|'h'|'q'|'8'|'16', dot?: true, rest?: true, notes?: ['C#4', …], tie?: true, lyric?: '', chord?: '' }

export const DUR = { w: 32, h: 16, q: 8, '8': 4, '16': 2, '32': 1 }; // in 32nd notes
export const BEAMS = { '8': 1, '16': 2, '32': 3 };
export const DUR_ORDER = ['w', 'h', 'q', '8', '16'];
export const DUR_NAME = { w: 'Whole', h: 'Half', q: 'Quarter', '8': 'Eighth', '16': 'Sixteenth', '32': 'Thirty-second' };
export const len = (e) => DUR[e.d] * (e.dot ? 1.5 : 1);
export const capacity = (score) => score.time[0] * (32 / score.time[1]);
// A bar can have its own length (e.g. a 3/4 bar in a 4/4 song): measure.cap, in 32nds.
export const capOf = (score, mi) => (score.measures[mi] && score.measures[mi].cap) || capacity(score);
export const barStart = (score, mi) => { let t = 0; for (let k = 0; k < mi && k < score.measures.length; k++) t += capOf(score, k); return t; };
export function barAtTime(score, t) { let s = 0; for (let k = 0; k < score.measures.length; k++) { const c = capOf(score, k); if (t < s + c) return k; s += c; } return Math.max(0, score.measures.length - 1); }
// time signature shown for a bar length
export const timeFor = (cap, base) => (cap === base[0] * (32 / base[1]) ? base : cap % 8 === 0 ? [cap / 8, 4] : cap % 4 === 0 ? [cap / 4, 8] : [cap / 2, 16]);

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
  let mi = m, idx = i;
  while (true) {
    if (!score.measures[mi]) score.measures.push(blankBar(score));
    const cap = capOf(score, mi);
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
  while (evs.length) {
    if (!score.measures[m]) score.measures.push(blankBar(score));
    const cap = capOf(score, m);
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
  const out = [];
  let start = 0;
  score.measures.forEach((m, mi) => {
    for (const st of staves(score)) {
      let t = start;
      m[st].forEach((e, i) => {
        const mids = e.rest ? [] : pitches(e);
        if (mids.length) out.push({ time: t, dur: len(e), midi: mids, tie: !!e.tie, ref: { m: mi, s: st, i } });
        t += len(e);
      });
    }
    start += capOf(score, mi);
  });
  // merge tied notes into one longer sound
  out.sort((a, b) => a.time - b.time);
  for (let k = 0; k < out.length; k++) {
    const a = out[k]; if (!a.tie) continue;
    const b = out.find(x => x !== a && x.time === a.time + a.dur && x.ref.s === a.ref.s && x.midi.join() === a.midi.join());
    if (b) { a.dur += b.dur; b.silent = true; }
  }
  return { events: out, total: start };
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
      const gap = (m.cap || oldCap) - filled(m[st]);
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
  return barStart(score, m) + filled(evs.slice(0, i));
}

// Beam groups: notes beam within a beat, and in 4/4 or 2/4 a group may run on through the
// half bar when a note crosses the beat (8th + dotted 8th + 16ths, as Guitar Pro draws it).
export function beamGroups(items, beatLen, barLen, beamable) {
  const half = beatLen === 8 && barLen >= 16 ? 16 : beatLen;
  const groups = [];
  let g = null;
  const close = () => { if (g && g.its.length > 1) groups.push(g); g = null; };
  for (const it of items) {
    const t = it.t, end = t + len(it.e);
    // a group may span up to two beats from the beat it starts on (so beat 2 can beam into beat 3)
    const own = half === beatLen ? (Math.floor(t / half) + 1) * half : Math.min(barLen, Math.floor(t / beatLen) * beatLen + half);
    if (!beamable(it)) { close(); continue; }
    if (g && g.last === t && t < g.end && end <= g.halfEnd) { g.its.push(it); g.last = end; g.end = Math.max(g.end, Math.min(Math.ceil(end / beatLen) * beatLen, g.halfEnd)); continue; }
    const halfEnd = own;
    if (end > halfEnd) { close(); continue; }
    const reach = Math.min(Math.ceil(end / beatLen) * beatLen, halfEnd);
    close();
    g = { its: [it], last: end, start: t, end: Math.max(reach, (Math.floor(t / beatLen) + 1) * beatLen), halfEnd };
  }
  close();
  return groups;
}

// ---------- tempo changes
// A bar may start a new tempo: measure.bpm (in the song's own numbers; score.bpm0 is the song's
// starting tempo they're relative to). Speeding the song up or down scales every change with it.
export const tempoScale = (score, bpm) => (score.bpm0 ? bpm / score.bpm0 : 1);
export function tempoAtBar(score, mi, bpm) {
  const k = tempoScale(score, bpm);
  for (let m = Math.min(mi, score.measures.length - 1); m >= 0; m--) if (score.measures[m] && score.measures[m].bpm) return score.measures[m].bpm * k;
  return bpm;
}
// seconds from the top of the song to a time in 32nds, following every tempo change
export function tempoMap(score, bpm) {
  const starts = [], secs = [], rate = [];
  let t = 0, s = 0, cur = bpm;
  const k = tempoScale(score, bpm);
  score.measures.forEach((m, mi) => {
    if (m.bpm) cur = m.bpm * k;
    const per32 = 60 / cur / 8;
    starts.push(t); secs.push(s); rate.push(per32);
    const c = capOf(score, mi); t += c; s += c * per32;
  });
  const lastRate = rate.length ? rate[rate.length - 1] : 60 / bpm / 8;
  return (time) => {
    let lo = 0, hi = starts.length - 1;
    if (hi < 0) return time * lastRate;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= time) lo = mid; else hi = mid - 1; }
    return secs[lo] + (time - starts[lo]) * rate[lo];
  };
}
