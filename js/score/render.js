// Piano sheet music — engraver. Lays a score out as grand-staff systems and draws it as one SVG string.
import { G } from './glyphs.js';
import { len, capacity, parsePitch, keyAlters } from './model.js';

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BOTTOM = { t: 4 * 7 + 2, b: 2 * 7 + 4 }; // diatonic number of each staff's bottom line (E4, G2)
const KEY_POS = {
  t: { s: ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'], f: ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'] },
  b: { s: ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2'], f: ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2'] },
};
const dia = (p) => { const q = parsePitch(p); return q ? q.diatonic : 0; };
const n = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Draw a glyph scaled to a height (px) with its top at yTop. Returns { svg, w }.
export function glyph(name, x, yTop, hPx, { flipY = false, cls = '' } = {}) {
  const g = G[name], [x0, y0, x1, y1] = g.b, s = hPx / (y1 - y0);
  const tf = flipY ? `translate(${n(x - x0 * s)},${n(yTop - y0 * s)}) scale(${n(s * 1000) / 1000},${n(s * 1000) / 1000})`
    : `translate(${n(x - x0 * s)},${n(yTop + y1 * s)}) scale(${n(s * 1000) / 1000},${n(-s * 1000) / 1000})`;
  return { svg: `<path${cls ? ` class="${cls}"` : ''} transform="${tf}" d="${g.d}"/>`, w: (x1 - x0) * s };
}
export const glyphW = (name, hPx) => { const [x0, y0, x1, y1] = G[name].b; return (x1 - x0) * hPx / (y1 - y0); };

// Width (in staff spaces) given to a stretch of time (32nds).
const spacing = (L) => 1.5 + 1.25 * Math.log2(L / 2 + 1);

export function render(score, opts = {}) {
  const width = Math.max(240, opts.width || 800);
  const sp = opts.sp || 9;                         // staff space in px
  const cap = capacity(score);
  const ka = keyAlters(score.keyFifths);
  const nKey = Math.abs(score.keyFifths);
  const hasLyrics = score.measures.some(m => m.t.some(e => e.lyric) || m.b.some(e => e.lyric));
  const hasChords = score.measures.some(m => m.t.some(e => e.chord) || m.b.some(e => e.chord));
  const gap = (hasLyrics ? 9.5 : 7) * sp;           // treble bottom line → bass top line
  const sel = opts.sel, playing = opts.playing;
  const beatLen = (score.time[1] === 8 && score.time[0] % 3 === 0) ? 12 : (score.time[1] === 2 ? 16 : 8);
  const NH = sp * 1.0, NW = glyphW('black', NH);   // notehead size
  const ACC_W = 1.25 * sp;

  // ---- 1. per-measure natural layout (columns by onset time across both staves)
  const accState = () => ({ ...ka });
  const meas = score.measures.map((m, mi) => {
    const onsets = new Set([0, cap]);
    const evs = { t: [], b: [] };
    let maxAcc = {};
    for (const st of ['t', 'b']) {
      let t = 0; const cur = {};
      for (const [i, e] of m[st].entries()) {
        // which notes need an accidental drawn (bar-scoped)
        const accs = [];
        if (!e.rest && e.notes) for (const p of e.notes) {
          const q = parsePitch(p); if (!q) continue;
          const k = q.step + q.oct, now = k in cur ? cur[k] : (ka[q.step] || 0);
          if (q.alter !== now || q.explicit === 'n') { accs.push({ p, alter: q.alter }); cur[k] = q.alter; }
        }
        evs[st].push({ e, i, t, accs });
        onsets.add(t);
        maxAcc[t] = Math.max(maxAcc[t] || 0, accs.length ? Math.min(accs.length, 3) : 0);
        t += len(e);
      }
    }
    const times = [...onsets].filter(t => t <= cap).sort((a, b) => a - b);
    const col = {}; let x = 1.2 * sp;
    for (let k = 0; k < times.length; k++) {
      const t = times[k];
      x += (maxAcc[t] || 0) * ACC_W * 0.85;
      col[t] = x;
      if (k < times.length - 1) x += spacing(times[k + 1] - t) * sp;
    }
    const w = Math.max(x, 7 * sp);
    return { mi, m, evs, col, w };
  });
  void accState;

  // ---- 2. break into systems and justify
  const headerW = (first) => 2.2 * sp + 3.2 * sp + nKey * 1.05 * sp + (first ? 2.4 * sp : 0) + 0.6 * sp;
  const systems = [];
  let cur = null;
  for (const M of meas) {
    const hw = headerW(systems.length === 0 && !cur);
    if (!cur) cur = { ms: [], hw, nat: 0 };
    if (cur.ms.length && cur.hw + cur.nat + M.w > width - 4) { systems.push(cur); cur = { ms: [], hw: headerW(false), nat: 0 }; }
    cur.ms.push(M); cur.nat += M.w;
  }
  if (cur) systems.push(cur);
  systems.forEach((S, si) => {
    const avail = width - 4 - S.hw;
    const last = si === systems.length - 1;
    const stretch = (last && S.nat < avail * 0.65) ? 1 : avail / S.nat;
    let x = S.hw;
    for (const M of S.ms) {
      M.x0 = x; M.scale = stretch;
      // stretch the space after the left padding, keep accidental room
      const mx = x;
      M.X = (t) => mx + M.col[t] * stretch;
      M.x1 = x + M.w * stretch; x = M.x1;
    }
  });

  // ---- 3. vertical extents per system (room for ledger notes / chords / lyrics)
  let y = 0;
  for (const S of systems) {
    let hiT = 8, loB = -4; // diatonic offsets relative to staff bottom line
    for (const M of S.ms) for (const st of ['t', 'b']) for (const E of M.evs[st]) if (!E.e.rest && E.e.notes) for (const p of E.e.notes) {
      const d = dia(p) - BOTTOM[st];
      if (st === 't') hiT = Math.max(hiT, d + 7); else loB = Math.min(loB, d - 7);
    }
    const top = Math.max(3.5 * sp, (hiT - 8) * sp / 2 + 1.5 * sp) + (hasChords ? 2.2 * sp : 0);
    const bottom = Math.max(4 * sp, (-loB) * sp / 2 + 1.5 * sp);
    S.y = y; S.tTop = y + top; S.bTop = S.tTop + 4 * sp + gap; S.h = top + 8 * sp + gap + bottom;
    y += S.h + 1.5 * sp;
  }
  const height = Math.ceil(y);

  // ---- 4. draw
  const out = [];
  const hits = []; // for tap-to-place: per measure & staff
  const lineW = Math.max(1, sp * 0.11), stemW = Math.max(1, sp * 0.12);
  const yOf = (S, st, d) => (st === 't' ? S.tTop : S.bTop) + 4 * sp - (d - BOTTOM[st]) * sp / 2;

  systems.forEach((S, si) => {
    const xEnd = S.ms[S.ms.length - 1].x1;
    // staff lines
    for (const top of [S.tTop, S.bTop]) for (let k = 0; k < 5; k++) out.push(`<line class="sl" x1="${n(1.6 * sp)}" x2="${n(xEnd)}" y1="${n(top + k * sp)}" y2="${n(top + k * sp)}" stroke-width="${n(lineW)}"/>`);
    // brace + system line
    const braceH = S.bTop + 4 * sp - S.tTop;
    { const [bx0, by0, bx1, by1] = G.brace.b, sx = 1.3 * sp / (bx1 - bx0), sy = braceH / (by1 - by0);
      out.push(`<path class="ink" transform="translate(${n(0.1 * sp - bx0 * sx)},${n(S.tTop + by1 * sy)}) scale(${n(sx * 1000) / 1000},${n(-sy * 1000) / 1000})" d="${G.brace.d}"/>`); }
    out.push(`<line class="bl" x1="${n(1.6 * sp)}" x2="${n(1.6 * sp)}" y1="${n(S.tTop)}" y2="${n(S.bTop + 4 * sp)}" stroke-width="${n(lineW * 1.4)}"/>`);
    // clefs
    let hx = 2.2 * sp;
    out.push(`<g class="ink">${glyph('gclef', hx, S.tTop - 1.45 * sp, 7.1 * sp).svg}${glyph('fclef', hx + 0.1 * sp, S.bTop + 0.0 * sp, 3.3 * sp).svg}</g>`);
    hx += 3.2 * sp;
    // key signature
    if (nKey) {
      const sharp = score.keyFifths > 0;
      for (const st of ['t', 'b']) KEY_POS[st][sharp ? 's' : 'f'].slice(0, nKey).forEach((p, k) => {
        const yy = yOf(S, st, dia(p));
        out.push(`<g class="ink">${sharp ? glyph('sharp', hx + k * 1.05 * sp, yy - 1.35 * sp, 2.7 * sp).svg : glyph('flat', hx + k * 1.05 * sp, yy - 1.7 * sp, 2.4 * sp).svg}</g>`);
      });
      hx += nKey * 1.05 * sp;
    }
    // time signature (first system)
    if (si === 0) {
      for (const top of [S.tTop, S.bTop]) {
        const digs = (num, yTop) => { const s = String(num); const dw = glyphW('t0', 2 * sp); let xx = hx + (2 * sp - dw * s.length) / 2 + 0.2 * sp; for (const c of s) { out.push(`<g class="ink">${glyph('t' + c, xx, yTop, 2 * sp).svg}</g>`); xx += dw; } };
        digs(score.time[0], top); digs(score.time[1], top + 2 * sp);
      }
    }
    // measure number
    if (si > 0) out.push(`<text class="mnum" x="${n(1.7 * sp)}" y="${n(S.tTop - 1.2 * sp)}" font-size="${n(1.15 * sp)}">${S.ms[0].mi + 1}</text>`);

    for (const M of S.ms) {
      // bar line at the end
      const isLast = M.mi === score.measures.length - 1;
      if (isLast) {
        out.push(`<line class="bl" x1="${n(M.x1 - 0.9 * sp)}" x2="${n(M.x1 - 0.9 * sp)}" y1="${n(S.tTop)}" y2="${n(S.bTop + 4 * sp)}" stroke-width="${n(lineW * 1.4)}"/>`);
        out.push(`<rect class="ink" x="${n(M.x1 - 0.55 * sp)}" y="${n(S.tTop)}" width="${n(0.5 * sp)}" height="${n(S.bTop + 4 * sp - S.tTop)}"/>`);
      } else out.push(`<line class="bl" x1="${n(M.x1)}" x2="${n(M.x1)}" y1="${n(S.tTop)}" y2="${n(S.bTop + 4 * sp)}" stroke-width="${n(lineW * 1.4)}"/>`);

      for (const st of ['t', 'b']) {
        const top = st === 't' ? S.tTop : S.bTop, mid = top + 2 * sp, botLine = top + 4 * sp;
        const hit = { m: M.mi, s: st, x0: M.x0, x1: M.x1, top, xs: [], bottomDia: BOTTOM[st], sp };
        hits.push(hit);
        const isSel = (i) => sel && sel.m === M.mi && sel.s === st && sel.i === i;
        if (!M.evs[st].length) {
          // empty staff: whole-bar rest
          const cx = (M.x0 + M.x1) / 2 - 0.6 * sp;
          out.push(`<rect class="ink rest" x="${n(cx)}" y="${n(top + sp)}" width="${n(1.2 * sp)}" height="${n(0.5 * sp)}"/>`);
          continue;
        }
        // stem directions + beam groups
        const items = M.evs[st].map(E => {
          const e = E.e, x = M.X(E.t);
          const ds = (!e.rest && e.notes && e.notes.length) ? e.notes.map(dia).sort((a, b) => a - b) : null;
          return { ...E, x, ds };
        });
        drawVoice(out, items, { top, bottomDia: BOTTOM[st], sp, beatLen, NW, NH, stemW, lineW, mi: M.mi, st, hit, isSel,
          isPlaying: (i) => !!(playing && playing.has(`${M.mi}${st}${i}`)), nextFirst: () => nextBarFirst(M, st), tieEndX: Math.min(M.x1 + 1.5 * sp, width - 2) });

        // chord symbols & lyrics (stored on either hand; drawn above / below the treble staff)
        items.forEach(it => {
          if (it.e.chord) out.push(`<text class="chordsym" x="${n(it.x)}" y="${n(S.y + 1.9 * sp)}" font-size="${n(1.55 * sp)}">${esc(it.e.chord)}</text>`);
          if (it.e.lyric) out.push(`<text class="lyric" x="${n(it.x + NW / 2)}" y="${n(S.tTop + 4 * sp + gap * 0.52)}" font-size="${n(1.45 * sp)}" text-anchor="middle">${esc(it.e.lyric)}</text>`);
        });
        // insertion caret (cursor after the last event)
        if (sel && sel.m === M.mi && sel.s === st && sel.i >= M.evs[st].length) {
          const lastIt = items[items.length - 1];
          const cx = lastIt ? Math.min(lastIt.x + NW + 1.6 * sp, M.x1 - 0.5 * sp) : M.x0 + 1.2 * sp;
          out.push(`<rect class="caret" x="${n(cx)}" y="${n(top - 1.2 * sp)}" width="${n(Math.max(2, 0.3 * sp))}" height="${n(6.4 * sp)}" rx="${n(0.15 * sp)}"/>`);
        }
      }
    }
  });

  function nextBarFirst(M, st) {
    const nm = meas[M.mi + 1];
    if (!nm || !nm.X || !nm.evs[st].length) return null;
    // only if on the same system
    const sameSys = systems.find(S => S.ms.includes(M)).ms.includes(nm);
    return sameSys ? { x: nm.X(nm.evs[st][0].t) } : null;
  }

  const svg = `<svg class="score-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${out.join('')}</svg>`;
  return { svg, height, hits, systems: systems.map(S => ({ y: S.y, h: S.h, tTop: S.tTop, bTop: S.bTop, first: S.ms[0].mi, last: S.ms[S.ms.length - 1].mi })) };
}

// Draw one voice (noteheads, stems, beams, flags, accidentals, ledger lines, ties, rests) on a five-line staff.
// items: [{ e, i, t, x, ds (sorted diatonic numbers, or null for a rest), accs: [{p, alter}] }]
export function drawVoice(out, items, o) {
  const { top, bottomDia, sp, beatLen, NW, NH, stemW, lineW, mi, st, hit, isSel = () => false, isPlaying = () => false, nextFirst = () => null, tieEndX = 0, hitH = 7 } = o;
  const mid = top + 2 * sp, botLine = top + 4 * sp;
  const yOf = (d) => botLine - (d - bottomDia) * sp / 2;
  const groups = [];
  let g = null;
  items.forEach((it) => {
    const beamable = it.ds && (it.e.d === '8' || it.e.d === '16');
    const beat = Math.floor(it.t / beatLen), endsInBeat = Math.floor((it.t + len(it.e) - 1) / beatLen) === beat;
    if (beamable && endsInBeat && g && g.beat === beat && g.last === it.t) { g.its.push(it); g.last = it.t + len(it.e); }
    else { if (g && g.its.length > 1) groups.push(g); g = beamable && endsInBeat ? { beat, its: [it], last: it.t + len(it.e) } : null; }
  });
  if (g && g.its.length > 1) groups.push(g);
  const midD = bottomDia + 4;
  const dirOf = (ds) => { const far = (ds[ds.length - 1] - midD) + (ds[0] - midD); return far >= 0 ? -1 : 1; }; // -1 = stem down
  items.forEach(it => { if (it.ds) it.dir = dirOf(it.ds); });
  groups.forEach(gr => { let s = 0; gr.its.forEach(it => { s += (it.ds[0] - midD) + (it.ds[it.ds.length - 1] - midD); }); const d = s >= 0 ? -1 : 1; gr.its.forEach(it => { it.dir = d; it.beamed = gr; }); });

  // beams: compute stem ends
  for (const gr of groups) {
    const up = gr.its[0].dir === 1;
    const pts = gr.its.map(it => ({ it, sx: up ? it.x + NW - stemW / 2 : it.x + stemW / 2, ny: yOf(up ? it.ds[it.ds.length - 1] : it.ds[0]), ny2: yOf(up ? it.ds[0] : it.ds[it.ds.length - 1]) }));
    const a = pts[0], b = pts[pts.length - 1];
    let slope = (b.ny - a.ny) / Math.max(1, b.sx - a.sx); slope = Math.max(-0.12, Math.min(0.12, slope)) * 0.6;
    const has16 = gr.its.some(it => it.e.d === '16'), minLen = (has16 ? 3.6 : 3.1) * sp;
    let y0 = up ? Infinity : -Infinity;
    for (const p of pts) { const need = up ? p.ny - minLen : p.ny + minLen; const at = need - slope * (p.sx - a.sx); y0 = up ? Math.min(y0, at) : Math.max(y0, at); }
    // keep beams from floating far off the staff
    if (up && y0 > mid) y0 = Math.min(y0, mid); if (!up && y0 < mid) y0 = Math.max(y0, mid);
    gr.beamY = (x) => y0 + slope * (x - a.sx); gr.up = up; gr.pts = pts;
    const bt = 0.5 * sp, off = up ? 1 : -1;
    const poly = (x1, x2, yo) => `<polygon class="ink" points="${n(x1)},${n(gr.beamY(x1) + yo)} ${n(x2)},${n(gr.beamY(x2) + yo)} ${n(x2)},${n(gr.beamY(x2) + yo + bt * off)} ${n(x1)},${n(gr.beamY(x1) + yo + bt * off)}"/>`;
    out.push(poly(a.sx - stemW / 2, b.sx + stemW / 2, 0));
    // secondary beams for 16ths
    const sec = 0.75 * sp * off;
    pts.forEach((p, k) => {
      if (p.it.e.d !== '16') return;
      const nx = pts[k + 1], pv = pts[k - 1];
      if (nx && nx.it.e.d === '16') out.push(poly(p.sx - stemW / 2, nx.sx + stemW / 2, sec));
      else if (!(pv && pv.it.e.d === '16')) {
        const stub = 1.1 * sp;
        if (nx) out.push(poly(p.sx - stemW / 2, p.sx + stub, sec)); else out.push(poly(p.sx - stub, p.sx + stemW / 2, sec));
      }
    });
  }

  items.forEach((it, idx) => {
    const e = it.e, x = it.x;
    const cls = ['ev', isSel(it.i) ? 'sel' : '', isPlaying(it.i) ? 'playing' : ''].filter(Boolean).join(' ');
    const parts = [`<rect class="hitbox" x="${n(x - 0.5 * sp)}" y="${n(top - 1.5 * sp)}" width="${n(NW + 1 * sp)}" height="${n(hitH * sp)}" style="fill:transparent"/>`];
    hit.xs.push({ i: it.i, x: x + NW / 2 });
    if (e.rest || !it.ds) {
      // rests
      if (e.d === 'w') parts.push(`<rect x="${n(x)}" y="${n(top + sp)}" width="${n(1.2 * sp)}" height="${n(0.5 * sp)}"/>`);
      else if (e.d === 'h') parts.push(`<rect x="${n(x)}" y="${n(mid - 0.5 * sp)}" width="${n(1.2 * sp)}" height="${n(0.5 * sp)}"/>`);
      else if (e.d === 'q') parts.push(glyph('r4', x, mid - 1.5 * sp, 3 * sp).svg);
      else if (e.d === '8') parts.push(glyph('r8', x, mid - 1.25 * sp, 1.95 * sp).svg);
      else parts.push(glyph('r16', x, mid - 1.25 * sp, 2.95 * sp).svg);
      if (e.dot) parts.push(`<circle cx="${n(x + 1.6 * sp)}" cy="${n(mid - 0.5 * sp)}" r="${n(0.2 * sp)}"/>`);
      out.push(`<g class="${cls} rest" data-m="${mi}" data-s="${st}" data-i="${it.i}">${parts.join('')}</g>`);
      return;
    }
    const dir = it.dir, ds = it.ds;
    const head = e.d === 'w' ? 'whole' : e.d === 'h' ? 'void' : 'black';
    const hw = head === 'whole' ? glyphW('whole', NH) : NW;
    // noteheads (seconds pushed to the other side of the stem)
    const shifted = new Array(ds.length).fill(0);
    if (dir === 1) { for (let k = 1; k < ds.length; k++) if (ds[k] - ds[k - 1] === 1 && !shifted[k - 1]) shifted[k] = 1; }
    else { for (let k = ds.length - 2; k >= 0; k--) if (ds[k + 1] - ds[k] === 1 && !shifted[k + 1]) shifted[k] = -1; }
    ds.forEach((d, k) => {
      const yy = yOf(d), hx2 = x + shifted[k] * (hw - stemW / 2);
      parts.push(glyph(head, hx2, yy - NH / 2 - 0.05 * sp, NH * 1.0).svg.replace('<path', '<path class="nh"'));
      if (e.dot) { const onLine = (d - bottomDia) % 2 === 0; parts.push(`<circle cx="${n(x + hw + (shifted.some(s => s > 0) ? hw : 0) + 0.45 * sp)}" cy="${n(yy - (onLine ? 0.5 * sp : 0))}" r="${n(0.19 * sp)}"/>`); }
    });
    // ledger lines
    const lx1 = x - 0.35 * sp + Math.min(0, ...shifted) * hw, lx2 = x + hw + 0.35 * sp + Math.max(0, ...shifted) * hw;
    const lo = ds[0] - bottomDia, hi = ds[ds.length - 1] - bottomDia;
    for (let k = -2; k >= lo; k -= 2) out.push(`<line class="sl ledger" x1="${n(lx1)}" x2="${n(lx2)}" y1="${n(botLine - k * sp / 2)}" y2="${n(botLine - k * sp / 2)}" stroke-width="${n(lineW * 1.3)}"/>`);
    for (let k = 10; k <= hi; k += 2) out.push(`<line class="sl ledger" x1="${n(lx1)}" x2="${n(lx2)}" y1="${n(botLine - k * sp / 2)}" y2="${n(botLine - k * sp / 2)}" stroke-width="${n(lineW * 1.3)}"/>`);
    // accidentals (stacked leftwards when close together)
    let col = 0, lastD = null;
    it.accs.slice().sort((a, b) => dia(b.p) - dia(a.p)).forEach(a => {
      const d = dia(a.p), yy = yOf(d);
      if (lastD != null && lastD - d < 6) col++; else col = 0; lastD = d;
      const ax = x - (1.05 + col * 0.95) * sp + Math.min(0, ...shifted) * hw;
      if (a.alter === 1) parts.push(glyph('sharp', ax, yy - 1.35 * sp, 2.7 * sp).svg);
      else if (a.alter === -1) parts.push(glyph('flat', ax + 0.1 * sp, yy - 1.7 * sp, 2.4 * sp).svg);
      else if (a.alter === 0) parts.push(glyph('natural', ax + 0.15 * sp, yy - 1.35 * sp, 2.7 * sp).svg);
      else if (a.alter === 2) parts.push(`<text x="${n(ax)}" y="${n(yy + 0.45 * sp)}" font-size="${n(1.6 * sp)}" font-weight="700">×</text>`);
      else if (a.alter === -2) parts.push(glyph('flat', ax - 0.6 * sp, yy - 1.7 * sp, 2.4 * sp).svg + glyph('flat', ax + 0.2 * sp, yy - 1.7 * sp, 2.4 * sp).svg);
    });
    // stem + flag
    if (e.d !== 'w') {
      const sx = dir === 1 ? x + hw - stemW / 2 : x + stemW / 2;
      const yLo = yOf(ds[0]), yHi = yOf(ds[ds.length - 1]);
      let y1, y2;
      if (it.beamed) { y1 = dir === 1 ? yLo : yHi; y2 = it.beamed.beamY(sx); }
      else if (dir === 1) { y1 = yLo; y2 = Math.min(yHi - 3.4 * sp, mid); if (e.d === '16') y2 -= 0.5 * sp; }
      else { y1 = yHi; y2 = Math.max(yLo + 3.4 * sp, mid); if (e.d === '16') y2 += 0.5 * sp; }
      parts.push(`<line class="stem" x1="${n(sx)}" x2="${n(sx)}" y1="${n(y1)}" y2="${n(y2)}" stroke-width="${n(stemW)}"/>`);
      if (!it.beamed && (e.d === '8' || e.d === '16')) {
        const fl = e.d === '8' ? 'flag8' : 'flag16', fh = (e.d === '8' ? 3.0 : 3.1) * sp;
        if (dir === 1) parts.push(glyph(fl, sx - stemW / 2, y2, fh).svg);
        else parts.push(glyph(fl, sx - stemW / 2, y2 - fh, fh, { flipY: true }).svg);
      }
    }
    // tie to the next event of this staff (may be in the next bar)
    if (e.tie) {
      const nxt = items[idx + 1] || nextFirst();
      const tx1 = x + hw + 0.15 * sp, tx2 = nxt ? nxt.x - 0.15 * sp : tieEndX;
      ds.forEach((d) => {
        const yy = yOf(d) + (dir === 1 ? 0.75 * sp : -0.75 * sp), bow = (dir === 1 ? 1 : -1) * Math.min(1.2 * sp, 0.12 * (tx2 - tx1) + 0.4 * sp), th = 0.2 * sp * (dir === 1 ? 1 : -1);
        parts.push(`<path d="M${n(tx1)},${n(yy)} C${n(tx1 + (tx2 - tx1) * 0.25)},${n(yy + bow)} ${n(tx2 - (tx2 - tx1) * 0.25)},${n(yy + bow)} ${n(tx2)},${n(yy)} C${n(tx2 - (tx2 - tx1) * 0.25)},${n(yy + bow + th)} ${n(tx1 + (tx2 - tx1) * 0.25)},${n(yy + bow + th)} ${n(tx1)},${n(yy)}Z"/>`);
      });
    }
    out.push(`<g class="${cls}" data-m="${mi}" data-s="${st}" data-i="${it.i}">${parts.join('')}</g>`);
  });
}

// Which pitch (diatonic) sits at y on a staff, and its spelled name in the key.
export function pitchAt(hit, y, fifths) {
  const d = Math.round(hit.bottomDia + ((hit.top + 4 * hit.sp) - y) / (hit.sp / 2));
  const step = STEPS[((d % 7) + 7) % 7], oct = Math.floor(d / 7);
  const a = keyAlters(fifths)[step] || 0;
  return step + (a === 1 ? '#' : a === -1 ? 'b' : '') + oct;
}
