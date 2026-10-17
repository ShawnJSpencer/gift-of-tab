// Read the rhythm printed under a tab staff (Guitar Pro / Ultimate Guitar style) from the page image:
// stems hang below each beat, beams join them (1 beam = eighth, 2 = sixteenth), flags mark lone
// eighths, dots lengthen, and rest symbols fill silences. Guitar Pro "Pro" PDFs also carry rests and
// dots as music-font text, which we use when it's there. Every bar is then checked so it adds up.
import { noteIndex } from './theory.js';

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
// SMuFL code points used by Guitar Pro exports
const REST_GLYPH = { '': 32, '': 16, '': 8, '': 4, '': 2, '': 2 };
const DOT_GLYPH = '';

// One tab staff → bars of rhythm events. `cols` are the note columns the fret reader found (with x).
export function readRhythm(img, st, { edges, cols, items, nextTop, x0, x1 }) {
  const { W, H, ink } = img, sp = st.sp;
  const yA = Math.round(st.bot + sp * 0.3);
  const yB = Math.round(Math.min(H - 1, st.bot + sp * 6.5, (isFinite(nextTop) ? nextTop : H) - sp * 1.5));
  if (yB - yA < sp * 1.5) return null;
  const at = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? ink[y * W + x] : 0);
  const minStem = sp * 1.15;

  // 1. stems: thin vertical ink runs in the band under the staff
  const runs = [];
  for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
    let s = -1, best = null;
    for (let y = yA; y <= yB + 1; y++) {
      if (y <= yB && at(x, y)) { if (s < 0) s = y; }
      else if (s >= 0) { if (!best || y - s > best.e - best.s) best = { s, e: y - 1 }; s = -1; }
    }
    if (best && best.e - best.s + 1 >= minStem && best.s <= yA + sp * 2.2) runs.push({ x, ...best });
  }
  const stems = [];
  for (const r of runs) {
    const g = stems[stems.length - 1];
    if (g && r.x - g.xe <= 1) { g.xe = r.x; g.top = Math.min(g.top, r.s); g.bot = Math.max(g.bot, r.e); }
    else stems.push({ xs: r.x, xe: r.x, top: r.s, bot: r.e });
  }
  const real = stems.filter(s => s.xe - s.xs + 1 <= Math.max(3, sp * 0.3));
  if (!real.length) return null;
  for (const s of real) { s.x = (s.xs + s.xe) / 2; s.len = s.bot - s.top + 1; }

  // 2. beams & flags at the foot of each stem
  const reach = (x, y, dir) => { let n = 0; while (n < sp * 3 && at(x + dir * (n + 1), y)) n++; return n; };
  for (const s of real) {
    let bands = 0, inBand = false;
    for (let y = Math.round(s.bot - sp * 2); y <= s.bot + 1; y++) {
      const r = Math.max(reach(s.xe, y, 1), reach(s.xs, y, -1));
      const beam = r >= sp * 0.38;
      if (beam && !inBand) bands++;
      inBand = beam;
    }
    s.beams = Math.min(3, bands);
    if (!s.beams) { // a lone eighth/sixteenth carries flags instead
      const fx = Math.round(s.xe + sp * 0.35);
      let f = 0, on = false;
      for (let y = Math.round(s.bot - sp * 2.4); y <= s.bot; y++) { const v = at(fx, y) || at(fx + 1, y); if (v && !on) f++; on = !!v; }
      s.flags = Math.min(3, f);
    }
  }

  // beam groups: a beam running all the way to the next stem joins them
  for (let i = 0; i < real.length - 1; i++) {
    const s = real[i], t = real[i + 1];
    if (!s.beams || !t.beams || t.xs - s.xe > sp * 4) continue;
    for (let y = Math.round(Math.max(s.bot, t.bot) - 2); y <= Math.max(s.bot, t.bot) + 1 && !s.join; y++) {
      let c = 0; for (let x = s.xe + 1; x < t.xs; x++) c += at(x, y);
      if (c >= (t.xs - s.xe - 1) * 0.9) s.join = true;
    }
  }
  // 3. dots: music-font text first, then a small isolated blob just right of the stem
  const dotItems = items.filter(i => i.s.includes(DOT_GLYPH) && i.cy > st.bot && i.cy < yB + sp);
  dotItems.forEach(d => { d.used = true; });
  for (const s of real) {
    if (dotItems.some(d => d.x >= s.x - sp * 0.1 && d.x <= s.x + sp * 1.3 && d.cy >= yA - sp && d.cy <= s.bot + sp * 0.5)) { s.dot = true; continue; }
    let n = 0, bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1, edge = false;
    const X0 = Math.round(s.xe + 2), X1 = Math.round(s.xe + sp * 0.95), Y0 = s.top, Y1 = Math.round(s.bot - sp * 1.15);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (at(x, y)) { n++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); if (x === X0 || x === X1) edge = true; }
    if (n >= 2 && !edge && bx1 - bx0 <= sp * 0.5 && by1 - by0 <= sp * 0.5 && n >= (bx1 - bx0 + 1) * (by1 - by0 + 1) * 0.4) s.dot = true;
  }

  // 4. rests: music-font text, else shapes in the stem band that aren't stems or beams
  const rests = [];
  for (const it of items) {
    if (it.cy < st.bot || it.cy > yB + sp || it.x < x0 - sp || it.x > x1 + sp) continue;
    for (const ch of it.s) if (REST_GLYPH[ch]) { rests.push({ x: it.x + it.w / 2, L: REST_GLYPH[ch], text: true }); it.used = true; }
  }
  const stemBot = median(real.map(s => s.bot));
  if (!rests.length) rests.push(...opticalRests(img, st, real, yA, Math.round(stemBot + sp * 0.2), x0, x1));

  // 5. durations from the marks
  const medLen = median(real.filter(s => s.beams || s.flags).map(s => s.len)) || median(real.map(s => s.len));
  for (const s of real) {
    const b = s.beams || s.flags || 0;
    s.L = b === 0 ? (s.len < medLen * 0.72 ? 16 : 8) : b === 1 ? 4 : b === 2 ? 2 : 1;
    s.maybeHalf = b === 0;
  }

  // 6. pair stems & rests with note columns, bar by bar
  const bars = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k], b = edges[k + 1];
    if (b - a < sp * 2) continue;
    const inside = (x) => x > a + 1 && x < b - 1;
    const evs = [];
    for (const s of real) if (inside(s.x)) evs.push({ x: s.x, L: s.L, dot: !!s.dot, maybeHalf: s.maybeHalf, beams: s.beams || 0, stem: true, join: !!s.join });
    for (const r of rests) if (inside(r.x)) evs.push({ x: r.x, L: r.L, rest: true, whole: r.whole });
    const myCols = cols.filter(c => inside(c.x));
    // each column with notes takes the nearest stem
    for (const c of myCols) {
      if (!c.n.some(Boolean)) continue;
      let best = null, bd = sp * 0.9;
      for (const e of evs) if (e.stem && !e.col && Math.abs(e.x - c.x) < bd) { bd = Math.abs(e.x - c.x); best = e; }
      if (best) best.col = c;
      else evs.push({ x: c.x, L: null, col: c }); // no stem: a whole note (or a mark we missed)
    }
    evs.sort((p, q) => p.x - q.x);
    // a stem with nothing above it is silence we couldn't classify — keep its time as a rest
    for (const e of evs) if (e.stem && !e.col) e.rest = true;
    // lyric-only columns: their words go to the nearest beat
    for (const c of myCols) {
      if (c.n.some(Boolean)) continue;
      if (!c.l && !c.c) continue;
      let best = null, bd = Infinity;
      for (const e of evs) { const d = Math.abs(e.x - c.x) + (e.x > c.x + sp ? sp : 0); if (d < bd) { bd = d; best = e; } }
      if (best) { best.lyric = [best.lyric, c.l].filter(Boolean).join(' '); if (c.c && !best.chord) best.chord = c.c; }
    }
    if (globalThis.__rhDebug) console.log('rhythm-debug', JSON.stringify({ a: Math.round(a), sp: Math.round(sp*10)/10, stems: real.filter(s => inside(s.x)).map(s => [Math.round(s.x), s.beams, s.flags||0, s.len, s.dot?1:0]), cols: myCols.map(c => [Math.round(c.x), c.n.filter(Boolean).join('/')]) }));
    bars.push({ a, b, evs });
  }
  return { bars, stems: real.length };
}

// Rest symbols drawn as pictures (Ultimate Guitar): connected shapes in the stem band.
function opticalRests(img, st, stems, yA, yB, x0, x1) {
  const { W, H, ink } = img, sp = st.sp;
  const X0 = Math.max(0, Math.floor(x0)), X1 = Math.min(W - 1, Math.ceil(x1));
  const w = X1 - X0 + 1, h = yB - yA + 1;
  if (w <= 0 || h <= 0) return [];
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = ink[(y + yA) * W + x + X0];
  // drop stems (and a margin) and long horizontal runs (beams)
  for (const s of stems) for (let x = Math.round(s.xs - 2 - X0); x <= Math.round(s.xe + 2 - X0); x++) if (x >= 0 && x < w) for (let y = 0; y < h; y++) mask[y * w + x] = 0;
  for (let y = 0; y < h; y++) { let s = -1; for (let x = 0; x <= w; x++) { const v = x < w && mask[y * w + x]; if (v && s < 0) s = x; if (!v && s >= 0) { if (x - s > sp * 0.9) for (let k = s; k < x; k++) mask[y * w + k] = 0; s = -1; } } }
  const seen = new Uint8Array(w * h), out = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    const q = [i]; seen[i] = 1; let n = 0, bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1;
    while (q.length) {
      const j = q.pop(), x = j % w, y = (j / w) | 0; n++;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx; if (mask[k] && !seen[k]) { seen[k] = 1; q.push(k); }
      }
    }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, cx = X0 + (bx0 + bx1) / 2;
    if (bw > sp * 1.6 || bh > sp * 3.4) continue;
    // beam stubs and flags hug a stem — rests stand apart
    if (stems.some(s => X0 + bx1 >= s.xs - 4 - sp * 0.15 && X0 + bx0 <= s.xe + 4 + sp * 0.15)) continue;
    if (bh <= sp * 0.6 && bw >= sp * 0.5 && n >= bw * bh * 0.6 && yA + by1 < yB - sp * 0.5) out.push({ x: cx, L: 16, whole: true });       // block: half or whole rest
    else if (bh >= sp * 1.9 && bw <= sp * 1.3) out.push({ x: cx, L: bw >= sp * 0.95 ? 2 : 8 });           // quarter (or 16th)
    else if (bh >= sp * 1.0 && bh < sp * 1.9 && bw <= sp * 1.2) out.push({ x: cx, L: 4 });               // eighth
  }
  return out;
}

// ---------- whole song: time signature, bar-by-bar fixes, key
const TIME_FOR = { 32: [4, 4], 24: [3, 4], 16: [2, 4], 40: [5, 4], 48: [6, 4], 12: [3, 8], 56: [7, 4], 36: [9, 8] };

export function assembleTech(staffs, { tuning, strings, keyText } = {}) {
  const allBars = [];
  for (const sf of staffs) for (const bar of sf.bars) allBars.push({ ...bar, sf });
  if (!allBars.length) return null;
  // time signature: the most common bar length among fully read bars (ignoring the first and last)
  const sums = allBars.slice(1, -1).filter(b => b.evs.length && b.evs.every(e => e.L)).map(b => b.evs.reduce((t, e) => t + e.L * (e.dot ? 1.5 : 1), 0));
  const tally = {}; for (const s of sums) tally[s] = (tally[s] || 0) + 1;
  let common = +Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || 32;
  if (!TIME_FOR[common]) common = 32;
  let time = TIME_FOR[common];
  // compound time (6/8, 9/8, 12/8) when beams group the notes in dotted quarters
  const gt = {};
  for (const b of allBars) {
    let run = 0, open = false;
    for (const e of b.evs) {
      if (!e.stem || !e.beams) { open = false; run = 0; continue; }
      run += e.L * (e.dot ? 1.5 : 1);
      if (!e.join) { if (run === 8 || run === 12) gt[run] = (gt[run] || 0) + 1; run = 0; }
    }
    void open;
  }
  if ((gt[12] || 0) > (gt[8] || 0) * 1.5) { if (common === 24) time = [6, 8]; else if (common === 48) time = [12, 8]; else if (common === 36) time = [9, 8]; }
  const cap = time[0] * (32 / time[1]);
  let fixed = 0, guessed = 0;
  const measures = allBars.map((bar, bi) => {
    const evs = bar.evs.map(e => ({ ...e, L: e.L ? e.L * (e.dot ? 1.5 : 1) : null }));
    const sum = () => evs.reduce((t, e) => t + (e.L || 0), 0);
    // unknown lengths (whole notes, missed marks) share whatever time is left
    const unk = evs.filter(e => !e.L);
    if (unk.length) { const rem = cap - sum(); const each = rem > 0 ? Math.max(2, Math.floor(rem / unk.length / 2) * 2) : 8; unk.forEach(e => { e.L = each; }); }
    // triplets read as straight notes: three equal eighths/sixteenths in a row → long-short-short pattern
    let guard = 0;
    while (sum() > cap && guard++ < 12) {
      let done = false;
      for (let i = 0; i + 2 < evs.length && !done; i++) {
        const L = evs[i].L;
        if ((L === 4 || L === 2) && evs[i + 1].L === L && evs[i + 2].L === L && !evs[i].tri) { evs[i].L = L / 2; evs[i + 1].L = L / 2; evs[i].tri = evs[i + 1].tri = evs[i + 2].tri = true; done = true; }
      }
      if (!done) break;
    }
    let d = cap - sum();
    if (d > 0) { // missing dot, or a half note drawn like a quarter
      const cand = evs.filter(e => !e.rest && e.L / 2 === d && !e.dot);
      const pick = cand.find((e, i) => { const nx = evs[evs.indexOf(e) + 1]; return nx && nx.L <= e.L / 2; }) || cand[0];
      if (pick) { pick.L += d; pick.dot = true; fixed++; }
      else { const half = evs.find(e => e.maybeHalf && e.L === d); if (half) { half.L += d; fixed++; } }
    }
    d = cap - sum();
    if (d !== 0 && evs.length) {
      if (d < 0 || (d > 0 && bi > 0 && bi < allBars.length - 1 && evs.length > 1)) {
        // still doesn't add up: share the bar out by spacing (a best guess)
        if (d < 0 || unk.length) {
          const xs = evs.map(e => e.x).concat(bar.b - (bar.b - bar.a) * 0.03);
          const span = xs[xs.length - 1] - xs[0] || 1;
          let t = 0;
          evs.forEach((e, i) => { const end = i === evs.length - 1 ? cap : Math.min(cap - 2 * (evs.length - 1 - i), Math.max(t + 2, Math.round(((xs[i + 1] - xs[0]) / span) * cap / 2) * 2)); e.L = end - t; t = end; });
          guessed++;
        } else { evs.push({ x: bar.b - 1, L: d, rest: true, pad: true }); }
      } else if (d > 0 && bi === allBars.length - 1) evs.push({ x: bar.b - 1, L: d, rest: true, pad: true });
      // (a short first bar is a pickup — left as it is)
    }
    return { evs, sf: bar.sf, a: bar.a, b: bar.b };
  });

  // events in the Tech tab format (tab cells low → high)
  const out = [];
  let prev = null;
  for (const m of measures) {
    const g = [];
    for (const e of m.evs) {
      let cells = e.col && !e.rest ? e.col.n.slice().reverse().map(c => c || '') : null;
      // a stem with no fret above it is the far end of a tie: the note keeps ringing
      if (e.stem && !e.col && prev && prev.n) { prev.tie = true; cells = prev.n.map(c => (c.match(/\d+/) || [''])[0]); }
      const parts = splitLen(e.L);
      parts.forEach((p, pi) => {
        const ev = { d: p.d, ...(p.dot ? { dot: true } : {}) };
        if (!cells || !cells.some(Boolean)) ev.rest = true;
        else {
          ev.n = cells.map((c, s) => {
            const tied = /^\((\d+)\)$/.exec(c);
            if (tied && prev && prev.n && String(parseInt(prev.n[s], 10)) === tied[1]) { prev.tie = true; return tied[1]; }
            return pi === 0 ? c : (c.match(/\d+/) || [''])[0];
          });
          if (pi < parts.length - 1) ev.tie = true;
        }
        if (pi === 0) { if (e.col && e.col.c) ev.chord = e.col.c; else if (e.chord) ev.chord = e.chord; const ly = [e.col && e.col.l, e.lyric].filter(Boolean).join(' '); if (ly) ev.lyric = ly; }
        g.push(ev);
        if (ev.n) prev = ev;
      });
    }
    out.push({ g });
  }
  // section names
  staffs.forEach(sf => (sf.labels || []).forEach(l => {
    // the first bar on that line that ends after the label starts
    const mi = measures.findIndex(m => m.sf === sf && m.b > l.x + sf.sp);
    if (mi >= 0 && out[mi].g[0] && !out[mi].g[0].section) out[mi].g[0].section = l.name;
  }));
  const keyFifths = keyText != null ? keyText : guessKey(out, tuning, strings);
  return { time, keyFifths, measures: out, bars: measures.length, fixed, guessed, notes: out.reduce((t, m) => t + m.g.filter(e => !e.rest).length, 0) };
}

const VAL = [[48, 'w', true], [32, 'w'], [24, 'h', true], [16, 'h'], [12, 'q', true], [8, 'q'], [6, '8', true], [4, '8'], [3, '16', true], [2, '16'], [1, '32']];
function splitLen(L) {
  const out = []; let r = Math.max(1, Math.round(L));
  for (const [v, d, dot] of VAL) while (r >= v) { out.push({ d, dot: !!dot }); r -= v; }
  return out.length ? out : [{ d: '16' }];
}

// Key from the notes: Krumhansl–Schmuckler profiles over sounding pitch classes, weighted by length.
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const DLEN = { w: 32, h: 16, q: 8, '8': 4, '16': 2, '32': 1 };
export function guessKey(measures, tuning, strings = 6) {
  const tun = (tuning && tuning.length === strings ? tuning : strings === 4 ? ['G', 'C', 'E', 'A'] : ['E', 'A', 'D', 'G', 'B', 'E']).map(noteIndex);
  const w = new Array(12).fill(0);
  let first = null, last = null;
  for (const m of measures) for (const e of m.g) {
    if (e.rest || !e.n) continue;
    const L = DLEN[e.d] * (e.dot ? 1.5 : 1);
    let low = null;
    e.n.forEach((c, s) => { const f = parseInt(String(c).replace(/^PM|\(|</g, ''), 10); if (isNaN(f) || tun[s] == null) return; const pc = (tun[s] + f) % 12; w[pc] += L; if (low == null) low = pc; });
    if (low != null) { if (first == null) first = low; last = low; }
  }
  if (!w.some(Boolean)) return 0;
  const corr = (prof, k) => { const mx = w.reduce((a, b) => a + b) / 12, mp = prof.reduce((a, b) => a + b) / 12; let n = 0, d1 = 0, d2 = 0; for (let i = 0; i < 12; i++) { const a = w[(i + k) % 12] - mx, b = prof[i] - mp; n += a * b; d1 += a * a; d2 += b * b; } return n / Math.sqrt(d1 * d2); };
  let best = { s: -2, k: 0, minor: false };
  for (let k = 0; k < 12; k++) for (const minor of [false, true]) {
    let s = corr(minor ? MIN : MAJ, k);
    if (last === k) s += 0.04; if (first === k) s += 0.02; // songs tend to start/end on home
    if (s > best.s) best = { s, k, minor };
  }
  const tonic = best.minor ? (best.k + 3) % 12 : best.k; // relative major carries the signature
  const FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  return FIFTHS[tonic];
}
