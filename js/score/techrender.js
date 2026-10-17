// Tech tab engraver: optional standard-notation staff, tab staff with fret numbers and techniques,
// and rhythm (stems, beams, flags, rests) under the tab — like Guitar Pro printouts.
import { G } from './glyphs.js';
import { glyph, glyphW, drawVoice } from './render.js';
import { len, capacity, parsePitch, keyAlters, spell } from './model.js';
import { pitchesOf } from './tech.js';

const BOTTOM_T = 4 * 7 + 2; // E4 on the treble staff's bottom line
const KEY_T = { s: ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'], f: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'] };
const n = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dia = (p) => { const q = parsePitch(p); return q ? q.diatonic : 0; };
const spacing = (L) => 1.9 + 1.35 * Math.log2(L / 2 + 1);

// Split a tab cell into what gets drawn.
export function cellParts(cell) {
  let c = String(cell || ''), pm = false, m;
  if (c.startsWith('PM')) { pm = true; c = c.slice(2); }
  const r = { pm, nums: [c], link: null, next: null, bend: null, release: false, vib: false };
  if ((m = c.match(/^(\d+)([hp])(\d+)$/))) Object.assign(r, { nums: [m[1], m[3]], link: m[2] });
  else if ((m = c.match(/^(\d+)([\/\\s])(\d+)$/))) Object.assign(r, { nums: [m[1], m[3]], link: m[2] === 's' ? (+m[3] > +m[1] ? '/' : '\\') : m[2] });
  else if ((m = c.match(/^(\d+)b(\d+)?$/))) Object.assign(r, { nums: [m[1]], bend: m[2] ? +m[2] - +m[1] : 2 });
  else if ((m = c.match(/^(\d+)r$/))) Object.assign(r, { nums: [m[1]], release: true });
  else if ((m = c.match(/^(\d+)~$/))) Object.assign(r, { nums: [m[1]], vib: true });
  else if ((m = c.match(/^(\d+)([hp\/\\s])$/))) Object.assign(r, { nums: [m[1]], next: m[2] });
  return r;
}

export function renderTech(score, song, opts = {}) {
  const width = Math.max(240, opts.width || 800);
  const sp = opts.sp || 9;
  const strings = song.tuning.length;
  const ts = 1.55 * sp, fs = 1.3 * sp;               // tab line gap, fret number size
  const tabH = (strings - 1) * ts;
  const cap = capacity(score);
  const showNot = score.notation !== false;
  const octUp = song.instrument === 'guitar' ? 12 : 0; // guitar is written an octave above where it sounds
  const ka = keyAlters(score.keyFifths), nKey = showNot ? Math.abs(score.keyFifths) : 0;
  const sel = opts.sel, playing = opts.playing;
  const beatLen = (score.time[1] === 8 && score.time[0] % 3 === 0) ? 12 : (score.time[1] === 2 ? 16 : 8);
  const NH = sp, NW = glyphW('black', NH);
  const lineW = Math.max(1, sp * 0.11), stemW = Math.max(1, sp * 0.12);
  const hasLyrics = score.measures.some(m => m.g.some(e => e.lyric));
  const digitW = fs * 0.62;

  // ---- 1. natural layout per bar
  const meas = score.measures.map((m, mi) => {
    const evs = []; const cur = {};
    let t = 0;
    const onsets = new Set([0, cap]);
    const extra = {};
    m.g.forEach((e, i) => {
      const mids = pitchesOf(e, song).map(x => x + octUp).sort((a, b) => a - b);
      const pitches = mids.map(x => spell(x, score.keyFifths));
      const accs = [];
      for (const p of pitches) {
        const q = parsePitch(p), k = q.step + q.oct, now = k in cur ? cur[k] : (ka[q.step] || 0);
        if (q.alter !== now) { accs.push({ p, alter: q.alter }); cur[k] = q.alter; }
      }
      // width needed by the widest cell
      let w = 0;
      (e.n || []).forEach(c => { if (!c) return; const P = cellParts(c); const chars = P.nums.join('').length + (P.nums.length > 1 ? 2.6 : 0); w = Math.max(w, chars * digitW); });
      extra[t] = Math.max(extra[t] || 0, w, showNot && accs.length ? 1.1 * sp : 0);
      evs.push({ e, i, t, ds: pitches.length ? pitches.map(dia) : null, accs });
      onsets.add(t); t += len(e);
    });
    const times = [...onsets].filter(x => x <= cap).sort((a, b) => a - b);
    const col = {}; let x = 1.4 * sp;
    for (let k = 0; k < times.length; k++) {
      const tt = times[k];
      x += Math.max(0, (extra[tt] || 0) - 1.2 * sp) / 2;
      col[tt] = x;
      if (k < times.length - 1) x += Math.max(spacing(times[k + 1] - tt) * sp, (extra[tt] || 0) + 1.0 * sp);
    }
    return { mi, m, evs, col, w: Math.max(x + 0.6 * sp, 7 * sp) };
  });

  // ---- 2. systems
  const headerW = (first) => (2.0 + 3.2 + nKey * 1.05 + (first ? 2.6 : 0) + 0.6) * sp;
  const systems = [];
  let cur = null;
  for (const M of meas) {
    if (!cur) cur = { ms: [], hw: headerW(true), nat: 0 };
    if (cur.ms.length && cur.hw + cur.nat + M.w > width - 4) { systems.push(cur); cur = { ms: [], hw: headerW(false), nat: 0 }; }
    cur.ms.push(M); cur.nat += M.w;
  }
  if (cur) systems.push(cur);
  systems.forEach((S, si) => {
    const avail = width - 4 - S.hw, last = si === systems.length - 1;
    const stretch = (last && S.nat < avail * 0.65) ? 1 : avail / S.nat;
    let x = S.hw;
    for (const M of S.ms) { const mx = x; M.x0 = x; M.X = (t) => mx + M.col[t] * stretch; M.x1 = x + M.w * stretch; x = M.x1; }
  });

  // ---- 3. vertical layout
  let y = 0;
  for (const S of systems) {
    const hasSec = S.ms.some(M => M.m.g.some(e => e.section));
    const hasCh = S.ms.some(M => M.m.g.some(e => e.chord));
    let hi = 8, lo = 0;
    for (const M of S.ms) for (const E of M.evs) if (E.ds) { hi = Math.max(hi, E.ds[E.ds.length - 1] - BOTTOM_T + 7); lo = Math.min(lo, E.ds[0] - BOTTOM_T - 7); }
    S.y = y;
    let yy = y + 0.6 * sp;
    if (hasSec) { S.secY = yy + 1.6 * sp; yy += 2.6 * sp; }
    if (hasCh) { S.chY = yy + 1.5 * sp; yy += 2.3 * sp; }
    if (showNot) {
      yy += Math.max(2.5 * sp, (hi - 8) * sp / 2 + 1 * sp);
      S.nTop = yy; yy += 4 * sp;
      yy += Math.max(2.2 * sp, (-lo) * sp / 2 + 0.8 * sp);
    } else yy += 1.6 * sp;
    S.tTop = yy; yy += tabH;
    S.rTop = yy + 0.9 * sp; yy = S.rTop + 3.6 * sp;
    if (hasLyrics) { S.lyY = yy + 1.3 * sp; yy += 2.2 * sp; }
    S.h = yy - y + 1.4 * sp;
    y += S.h;
  }
  const height = Math.ceil(y + sp);

  // ---- 4. draw
  const out = [], hits = [];
  const stringY = (S, s) => S.tTop + (strings - 1 - s) * ts;
  const allEvents = []; // for connectors across bars on a line
  systems.forEach((S, si) => {
    const xEnd = S.ms[S.ms.length - 1].x1, x0 = 1.0 * sp;
    // staff lines
    for (let k = 0; k < strings; k++) out.push(`<line class="sl tabl" x1="${n(x0)}" x2="${n(xEnd)}" y1="${n(S.tTop + k * ts)}" y2="${n(S.tTop + k * ts)}" stroke-width="${n(lineW)}"/>`);
    if (showNot) for (let k = 0; k < 5; k++) out.push(`<line class="sl" x1="${n(x0)}" x2="${n(xEnd)}" y1="${n(S.nTop + k * sp)}" y2="${n(S.nTop + k * sp)}" stroke-width="${n(lineW)}"/>`);
    // left lines + TAB
    out.push(`<line class="bl" x1="${n(x0)}" x2="${n(x0)}" y1="${n(S.tTop)}" y2="${n(S.tTop + tabH)}" stroke-width="${n(lineW * 1.4)}"/>`);
    if (showNot) out.push(`<line class="bl" x1="${n(x0)}" x2="${n(x0)}" y1="${n(S.nTop)}" y2="${n(S.nTop + 4 * sp)}" stroke-width="${n(lineW * 1.4)}"/>`);
    const tabFs = Math.min(tabH / 3.1, 2.4 * sp);
    ['T', 'A', 'B'].forEach((ch, k) => out.push(`<text class="tabclef" x="${n(x0 + 1.9 * sp)}" y="${n(S.tTop + tabH / 2 + (k - 1) * tabFs * 0.95 + tabFs * 0.36)}" font-size="${n(tabFs)}" text-anchor="middle">${ch}</text>`));
    let hx = 2.0 * sp;
    if (showNot) {
      out.push(`<g class="ink">${glyph('gclef', hx, S.nTop - 1.45 * sp, 7.1 * sp).svg}</g>`);
      if (octUp) out.push(`<text class="ink clef8" x="${n(hx + 1.25 * sp)}" y="${n(S.nTop + 6.5 * sp)}" font-size="${n(1.25 * sp)}" text-anchor="middle">8</text>`);
    }
    hx += 3.2 * sp;
    if (nKey) {
      const sharp = score.keyFifths > 0;
      KEY_T[sharp ? 's' : 'f'].slice(0, nKey).forEach((p, k) => {
        const yy = S.nTop + 4 * sp - (dia(p) - BOTTOM_T) * sp / 2;
        out.push(`<g class="ink">${sharp ? glyph('sharp', hx + k * 1.05 * sp, yy - 1.35 * sp, 2.7 * sp).svg : glyph('flat', hx + k * 1.05 * sp, yy - 1.7 * sp, 2.4 * sp).svg}</g>`);
      });
      hx += nKey * 1.05 * sp;
    }
    if (si === 0) {
      const digs = (num, yTop, hgt) => { const s = String(num); const dw = glyphW('t0', hgt); let xx = hx + (2.2 * sp - dw * s.length) / 2 + 0.2 * sp; for (const c of s) { out.push(`<g class="ink">${glyph('t' + c, xx, yTop, hgt).svg}</g>`); xx += dw; } };
      if (showNot) { digs(score.time[0], S.nTop, 2 * sp); digs(score.time[1], S.nTop + 2 * sp, 2 * sp); }
      const th = Math.min(tabH / 2, 2.6 * sp);
      digs(score.time[0], S.tTop + tabH / 2 - th, th); digs(score.time[1], S.tTop + tabH / 2, th);
    }
    if (si > 0) out.push(`<text class="mnum" x="${n(x0)}" y="${n((showNot ? S.nTop : S.tTop) - 1.0 * sp)}" font-size="${n(1.15 * sp)}">${S.ms[0].mi + 1}</text>`);

    for (const M of S.ms) {
      const isLast = M.mi === score.measures.length - 1;
      const bar = (yA, yB) => {
        if (isLast) {
          out.push(`<line class="bl" x1="${n(M.x1 - 0.9 * sp)}" x2="${n(M.x1 - 0.9 * sp)}" y1="${n(yA)}" y2="${n(yB)}" stroke-width="${n(lineW * 1.4)}"/>`);
          out.push(`<rect class="ink" x="${n(M.x1 - 0.55 * sp)}" y="${n(yA)}" width="${n(0.5 * sp)}" height="${n(yB - yA)}"/>`);
        } else out.push(`<line class="bl" x1="${n(M.x1)}" x2="${n(M.x1)}" y1="${n(yA)}" y2="${n(yB)}" stroke-width="${n(lineW * 1.4)}"/>`);
      };
      bar(S.tTop, S.tTop + tabH);
      if (showNot) bar(S.nTop, S.nTop + 4 * sp);
      const hit = { m: M.mi, s: 'g', x0: M.x0, x1: M.x1, tTop: S.tTop, ts, strings, xs: [], sp, top: showNot ? S.nTop : S.tTop, bottomDia: BOTTOM_T, nTop: S.nTop, rBottom: S.rTop + 3.6 * sp };
      hits.push(hit);
      const isSel = (i) => sel && sel.m === M.mi && sel.i === i;
      const isPlaying = (i) => !!(playing && playing.has(`${M.mi}g${i}`));
      if (!M.evs.length) {
        const cx = (M.x0 + M.x1) / 2 - 0.6 * sp;
        if (showNot) out.push(`<rect class="ink rest" x="${n(cx)}" y="${n(S.nTop + sp)}" width="${n(1.2 * sp)}" height="${n(0.5 * sp)}"/>`);
        out.push(`<rect class="ink rest" x="${n(cx)}" y="${n(S.rTop + 0.8 * sp)}" width="${n(1.2 * sp)}" height="${n(0.5 * sp)}"/>`);
      }
      const items = M.evs.map(E => ({ ...E, x: M.X(E.t) }));
      items.forEach(it => { it.cx = it.x + NW / 2; it.S = S; it.M = M; allEvents.push(it); });

      // notation staff (reuses the piano engraver)
      if (showNot && items.length) {
        const vItems = items.map(it => ({ ...it, ds: it.ds, e: it.ds || it.e.rest ? it.e : { ...it.e, rest: true } }));
        drawVoice(out, vItems, { top: S.nTop, bottomDia: BOTTOM_T, sp, beatLen, NW, NH, stemW, lineW, mi: M.mi, st: 'g', hit: { xs: [] }, isSel, isPlaying,
          nextFirst: () => { const nm = meas[M.mi + 1]; return nm && nm.X && S.ms.includes(nm) && nm.evs.length ? { x: nm.X(nm.evs[0].t) } : null; },
          tieEndX: Math.min(M.x1 + 1.5 * sp, width - 2), hitH: 7 });
      }

      // rhythm groups (beams per beat)
      const groups = []; let g = null;
      items.forEach(it => {
        const beamable = !it.e.rest && (it.e.d === '8' || it.e.d === '16');
        const beat = Math.floor(it.t / beatLen), inBeat = Math.floor((it.t + len(it.e) - 1) / beatLen) === beat;
        if (beamable && inBeat && g && g.beat === beat && g.last === it.t) { g.its.push(it); g.last = it.t + len(it.e); }
        else { if (g && g.its.length > 1) groups.push(g); g = beamable && inBeat ? { beat, its: [it], last: it.t + len(it.e) } : null; }
      });
      if (g && g.its.length > 1) groups.push(g);
      groups.forEach(gr => gr.its.forEach(it => { it.beamed = gr; }));
      const yStemEnd = S.rTop + 3.0 * sp, bt = 0.45 * sp;
      for (const gr of groups) {
        const a = gr.its[0].cx, b = gr.its[gr.its.length - 1].cx;
        out.push(`<rect class="ink" x="${n(a - stemW / 2)}" y="${n(yStemEnd - bt)}" width="${n(b - a + stemW)}" height="${n(bt)}"/>`);
        gr.its.forEach((it, k) => {
          if (it.e.d !== '16') return;
          const nx = gr.its[k + 1], pv = gr.its[k - 1], yy = yStemEnd - bt - 0.7 * sp + bt * 0.2;
          if (nx && nx.e.d === '16') out.push(`<rect class="ink" x="${n(it.cx - stemW / 2)}" y="${n(yy)}" width="${n(nx.cx - it.cx + stemW)}" height="${n(bt)}"/>`);
          else if (!(pv && pv.e.d === '16')) { const st = 1.0 * sp; out.push(`<rect class="ink" x="${n(nx ? it.cx - stemW / 2 : it.cx - st)}" y="${n(yy)}" width="${n(st + stemW / 2)}" height="${n(bt)}"/>`); }
        });
      }

      items.forEach((it, idx) => {
        const e = it.e, cx = it.cx;
        const cls = ['ev', isSel(it.i) ? 'sel' : '', isPlaying(it.i) ? 'playing' : ''].filter(Boolean).join(' ');
        const parts = [`<rect class="hitbox" x="${n(cx - 1.2 * sp)}" y="${n(S.tTop - 0.9 * sp)}" width="${n(2.4 * sp)}" height="${n(tabH + 5.4 * sp)}" style="fill:transparent"/>`];
        hit.xs.push({ i: it.i, x: cx });
        if (isSel(it.i)) parts.push(`<rect class="colsel" x="${n(cx - 1.15 * sp)}" y="${n(S.tTop - 0.8 * sp)}" width="${n(2.3 * sp)}" height="${n(tabH + 1.6 * sp)}" rx="${n(0.5 * sp)}"/>`);
        const prev = idx > 0 ? items[idx - 1].e : prevBarLast(M);
        const tiedIn = prev && prev.tie && !e.rest;
        let aboveY = S.tTop - 1.0 * sp;
        // fret numbers
        if (!e.rest && e.n) e.n.forEach((c, s) => {
          if (!c) return;
          const P = cellParts(c), yS = stringY(S, s);
          const draw = (txt, xx) => {
            const t = tiedIn ? `(${txt})` : txt, w = t.length * digitW + 0.25 * sp;
            parts.push(`<rect class="ko" x="${n(xx - w / 2)}" y="${n(yS - fs * 0.5)}" width="${n(w)}" height="${n(fs)}"/>`);
            parts.push(`<text class="fret" x="${n(xx)}" y="${n(yS + fs * 0.36)}" font-size="${n(fs)}" text-anchor="middle">${esc(t)}</text>`);
            return w;
          };
          if (P.nums.length === 2) {
            const off = Math.max(1.15 * sp, P.nums[0].length * digitW * 0.5 + 0.8 * sp);
            const xa = cx - off, xb = cx + off;
            draw(P.nums[0], xa); draw(P.nums[1], xb);
            connector(parts, P.link, xa, xb, yS, +P.nums[0], +P.nums[1]);
          } else draw(P.nums[0], cx);
          if (P.next) { const nx = nextOnString(it, s); connector(parts, P.next, cx, nx ? nx.cx : Math.min(it.M.x1 + 1.2 * sp, width - 4), yS, fretNum(c), nx ? fretNum(nx.e.n[s]) : fretNum(c) + 1, !nx); }
          if (P.bend != null) {
            const xb = cx + 0.55 * sp + (c.length - 1) * digitW * 0.4, top = S.tTop - 1.3 * sp;
            parts.push(`<path class="techline" d="M${n(xb)},${n(yS)} Q${n(xb + 1.1 * sp)},${n(yS)} ${n(xb + 1.1 * sp)},${n(top + 0.6 * sp)}" fill="none" stroke-width="${n(stemW)}"/>`);
            parts.push(`<path class="ink" d="M${n(xb + 0.75 * sp)},${n(top + 0.7 * sp)} L${n(xb + 1.1 * sp)},${n(top)} L${n(xb + 1.45 * sp)},${n(top + 0.7 * sp)}Z"/>`);
            parts.push(`<text class="techtxt" x="${n(xb + 1.1 * sp)}" y="${n(top - 0.25 * sp)}" font-size="${n(1.05 * sp)}" text-anchor="middle">${P.bend === 1 ? '½' : P.bend === 2 ? 'full' : P.bend / 2}</text>`);
            aboveY = Math.min(aboveY, top - 1.5 * sp);
          }
          if (P.release) {
            const xb = cx + 0.6 * sp, top = S.tTop - 1.3 * sp;
            parts.push(`<path class="techline" d="M${n(xb)},${n(top)} Q${n(xb + 1.1 * sp)},${n(top)} ${n(xb + 1.1 * sp)},${n(yS - 0.6 * sp)}" fill="none" stroke-width="${n(stemW)}"/>`);
            parts.push(`<path class="ink" d="M${n(xb + 0.75 * sp)},${n(yS - 1.2 * sp)} L${n(xb + 1.1 * sp)},${n(yS - 0.5 * sp)} L${n(xb + 1.45 * sp)},${n(yS - 1.2 * sp)}Z"/>`);
          }
          if (P.vib) {
            let d = `M${n(cx - 0.4 * sp)},${n(aboveY)}`;
            for (let k = 0; k < 4; k++) d += ` q${n(0.3 * sp)},${n(-0.45 * sp)} ${n(0.6 * sp)},0 q${n(0.3 * sp)},${n(0.45 * sp)} ${n(0.6 * sp)},0`;
            parts.push(`<path class="techline" d="${d}" fill="none" stroke-width="${n(stemW * 1.2)}"/>`);
            aboveY -= 1.1 * sp;
          }
          if (P.pm) { parts.push(`<text class="techtxt" x="${n(cx)}" y="${n(aboveY)}" font-size="${n(1.05 * sp)}" text-anchor="middle">P.M.</text>`); aboveY -= 1.2 * sp; }
        });
        // rhythm under the tab
        const rTop = S.rTop;
        if (e.rest) {
          const rx = cx - 0.5 * sp;
          if (e.d === 'w') parts.push(`<rect x="${n(cx - 0.6 * sp)}" y="${n(rTop + 0.9 * sp)}" width="${n(1.2 * sp)}" height="${n(0.45 * sp)}"/>`);
          else if (e.d === 'h') parts.push(`<rect x="${n(cx - 0.6 * sp)}" y="${n(rTop + 1.35 * sp)}" width="${n(1.2 * sp)}" height="${n(0.45 * sp)}"/>`);
          else if (e.d === 'q') parts.push(glyph('r4', rx, rTop + 0.2 * sp, 2.5 * sp).svg);
          else if (e.d === '8') parts.push(glyph('r8', rx, rTop + 0.6 * sp, 1.6 * sp).svg);
          else parts.push(glyph('r16', rx, rTop + 0.4 * sp, 2.4 * sp).svg);
          if (e.dot) parts.push(`<circle cx="${n(cx + 1.0 * sp)}" cy="${n(rTop + 1.2 * sp)}" r="${n(0.18 * sp)}"/>`);
        } else if (e.d !== 'w') {
          const y1 = e.d === 'h' ? rTop + 1.5 * sp : rTop;
          parts.push(`<line class="stem" x1="${n(cx)}" x2="${n(cx)}" y1="${n(y1)}" y2="${n(yStemEnd)}" stroke-width="${n(stemW)}"/>`);
          if (!it.beamed && (e.d === '8' || e.d === '16')) { const fh = 2.3 * sp; parts.push(glyph(e.d === '8' ? 'flag8' : 'flag16', cx - stemW / 2, yStemEnd - fh, fh, { flipY: true }).svg); }
          if (e.dot) parts.push(`<circle cx="${n(cx + 0.6 * sp)}" cy="${n(yStemEnd - 0.2 * sp)}" r="${n(0.18 * sp)}"/>`);
        }
        out.push(`<g class="${cls}" data-m="${M.mi}" data-s="g" data-i="${it.i}">${parts.join('')}</g>`);
        if (e.chord) out.push(`<text class="chordsym" x="${n(cx - 0.4 * sp)}" y="${n(S.chY)}" font-size="${n(1.5 * sp)}">${esc(e.chord)}</text>`);
        if (e.section) {
          const w = e.section.length * 0.78 * sp + 1.4 * sp;
          out.push(`<g class="secl"><rect x="${n(it.x - 0.6 * sp)}" y="${n(S.secY - 1.3 * sp)}" width="${n(w)}" height="${n(1.9 * sp)}" rx="${n(0.5 * sp)}"/><text x="${n(it.x + 0.1 * sp)}" y="${n(S.secY)}" font-size="${n(1.15 * sp)}">${esc(e.section)}</text></g>`);
        }
        if (e.lyric) out.push(`<text class="lyric" x="${n(cx)}" y="${n(S.lyY)}" font-size="${n(1.4 * sp)}" text-anchor="middle">${esc(e.lyric)}</text>`);
      });
      // string cursor (selected beat or the insertion point)
      if (sel && sel.m === M.mi) {
        let cx = null;
        const selIt = items.find(it => it.i === sel.i);
        if (selIt) cx = selIt.cx;
        else if (sel.i >= items.length) { const last = items[items.length - 1]; cx = last ? Math.min(last.cx + 2.6 * sp, M.x1 - 1.0 * sp) : M.x0 + 1.8 * sp; out.push(`<rect class="caret" x="${n(cx - 0.15 * sp)}" y="${n(S.tTop - 1.0 * sp)}" width="${n(Math.max(2, 0.3 * sp))}" height="${n(tabH + 2 * sp)}" rx="${n(0.15 * sp)}"/>`); }
        if (cx != null && sel.str != null) out.push(`<rect class="strsel" x="${n(cx - 1.0 * sp)}" y="${n(stringY(S, sel.str) - 0.75 * sp)}" width="${n(2 * sp)}" height="${n(1.5 * sp)}" rx="${n(0.35 * sp)}" stroke-width="${n(Math.max(1.5, 0.18 * sp))}"/>`);
      }
    }
  });

  function prevBarLast(M) { const pm = score.measures[M.mi - 1]; return pm && pm.g.length ? pm.g[pm.g.length - 1] : null; }
  function fretNum(c) { const m = String(c || '').match(/\d+/); return m ? +m[0] : 0; }
  function nextOnString(it, s) {
    const M = it.M, S = it.S;
    for (const cand of M.evs) if (cand.t > it.t && cand.e.n && cand.e.n[s]) return { cx: M.X(cand.t) + NW / 2, e: cand.e };
    const nm = meas[M.mi + 1];
    if (nm && S.ms.includes(nm)) for (const cand of nm.evs) if (cand.e.n && cand.e.n[s]) return { cx: nm.X(cand.t) + NW / 2, e: cand.e };
    return null;
  }
  function connector(parts, kind, xa, xb, yS, fa, fb, open) {
    const gap = 0.75 * sp;
    if (kind === 'h' || kind === 'p') {
      const x1 = xa + 0.1 * sp, x2 = xb - 0.1 * sp, yy = yS - 0.75 * sp, rise = Math.min(1.4 * sp, Math.max(0.6 * sp, (x2 - x1) * 0.22));
      parts.push(`<path class="techline" d="M${n(x1)},${n(yy)} Q${n((x1 + x2) / 2)},${n(yy - rise * 2)} ${n(x2)},${n(yy)}" fill="none" stroke-width="${n(stemW)}"/>`);
      parts.push(`<text class="techtxt" x="${n((x1 + x2) / 2)}" y="${n(yy - rise - 0.25 * sp)}" font-size="${n(1.0 * sp)}" text-anchor="middle">${kind.toUpperCase()}</text>`);
    } else {
      const up = kind === '/' || (kind === 's' && fb > fa), d = 0.35 * sp;
      const x1 = xa + gap, x2 = open ? xb : xb - gap;
      if (x2 > x1) parts.push(`<line class="techline" x1="${n(x1)}" x2="${n(x2)}" y1="${n(yS + (up ? d : -d))}" y2="${n(yS + (up ? -d : d))}" stroke-width="${n(stemW)}"/>`);
    }
  }

  const svg = `<svg class="score-svg tech-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${out.join('')}</svg>`;
  return { svg, height, hits };
}

// Which string is nearest to y in a bar's tab staff.
export function stringAt(hit, y) {
  const k = Math.round((y - hit.tTop) / hit.ts);
  if (k < -1 || k > hit.strings) return null;
  return hit.strings - 1 - Math.max(0, Math.min(hit.strings - 1, k));
}
