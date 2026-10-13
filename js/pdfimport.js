// Read a digital PDF tab (Guitar Pro, Songsterr, Ultimate Guitar, printed tabs…) and turn it into
// tab text that the normal importer understands.
//
// How it works: each page is drawn to a hidden canvas so we can find the tab staffs (groups of 6 or 4
// evenly spaced horizontal lines) and bar lines. The PDF's text layer tells us where every fret number,
// chord name and lyric sits; each number is matched to the nearest string line and beat. Plain text
// (chord sheets, ASCII tabs) is rebuilt line by line keeping its spacing.
import { isChord, noteIndex } from './theory.js';

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

const FRET = /^(\(?\d{1,2}\)?|[xX]|<\d{1,2}>|\d{1,2}[hpb\/\\]\d{1,2})$/;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export async function pdfToTabText(file, onProgress) {
  const L = await pdfjs();
  const task = L.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages = doc.numPages;
  const parts = [];
  let scanned = 0, staves = 0, meta = {};
  for (let p = 1; p <= pages; p++) {
    onProgress && onProgress(p, pages);
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1600 / base.width) });
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => toItem(L, vp, i));
    if (items.length < 3) { scanned++; page.cleanup(); continue; }
    if (p === 1) meta = takeTitle(items, vp.height);
    const img = await raster(page, vp);
    const res = analysePage(items, img);
    staves += res.staves;
    parts.push(res.text);
    page.cleanup();
  }
  try { await task.destroy(); } catch {}
  return { text: parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), pages, scanned, staves, ...meta };
}

function toItem(L, vp, i) {
  const t = L.Util.transform(vp.transform, i.transform);
  const fs = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10;
  return { s: i.str, x: t[4], w: (i.width || 0) * vp.scale, base: t[5], fs, cy: t[5] - fs * 0.35, used: false };
}

async function raster(page, vp) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, dark = new Uint8Array(W * H);
  for (let k = 0, j = 0; k < d.length; k += 4, j++) dark[j] = (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11) < 160 ? 1 : 0;
  c.width = c.height = 0; // free memory on iPad
  return { W, H, dark };
}

// ---------- staff + bar detection
function findLines({ W, H, dark }) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let cnt = 0, run = 0, best = 0, first = -1, last = -1;
    const o = y * W;
    for (let x = 0; x < W; x++) {
      if (dark[o + x]) { cnt++; run++; if (run > best) best = run; if (first < 0) first = x; last = x; } else run = 0;
    }
    if (cnt >= W * 0.3 && best >= W * 0.06) rows.push({ y, first, last });
  }
  const lines = [];
  for (const r of rows) {
    const l = lines[lines.length - 1];
    if (l && r.y - l.y1 <= 1) { l.y1 = r.y; l.x0 = Math.min(l.x0, r.first); l.x1 = Math.max(l.x1, r.last); }
    else lines.push({ y0: r.y, y1: r.y, x0: r.first, x1: r.last });
  }
  return lines.filter(l => l.y1 - l.y0 < 7).map(l => ({ ...l, y: (l.y0 + l.y1) / 2 }));
}

function groupStaves(lines, H) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const g = [lines[i]];
    let j = i + 1;
    if (j < lines.length) {
      const sp = lines[j].y - lines[i].y;
      if (sp > H * 0.003 && sp < H * 0.03) {
        g.push(lines[j]); j++;
        while (j < lines.length && Math.abs(lines[j].y - g[g.length - 1].y - sp) <= Math.max(2, sp * 0.2)) { g.push(lines[j]); j++; }
      }
    }
    if (g.length >= 4) {
      // two staffs touching with the same spacing (rare) — split 12 into 6+6, 8 into 4+4
      const chunks = g.length === 12 ? [g.slice(0, 6), g.slice(6)] : g.length === 8 ? [g.slice(0, 4), g.slice(4)] : [g];
      for (const c of chunks) out.push({ lines: c, n: c.length, top: c[0].y, bot: c[c.length - 1].y, sp: (c[c.length - 1].y - c[0].y) / (c.length - 1) });
      i = j;
    } else i++;
  }
  return out;
}

function findBars({ W, dark }, st) {
  const top = Math.round(st.top), bot = Math.round(st.bot);
  const x0 = Math.max(0, Math.min(...st.lines.map(l => l.x0)) - 2), x1 = Math.min(W - 1, Math.max(...st.lines.map(l => l.x1)) + 2);
  const need = (bot - top + 1) * 0.9, cols = [];
  for (let x = x0; x <= x1; x++) {
    let c = 0;
    for (let y = top; y <= bot; y++) c += dark[y * W + x];
    if (c >= need) cols.push(x);
  }
  const bars = [];
  for (const x of cols) {
    const b = bars[bars.length - 1];
    if (b && x - b.e <= st.sp * 0.7) b.e = x; else bars.push({ s: x, e: x });
  }
  return { x0, x1, bars: bars.map(b => (b.s + b.e) / 2) };
}

// ---------- page analysis
function analysePage(items, img) {
  const all = groupStaves(findLines(img), img.H);
  // ASCII tabs drawn with dashes are text, not graphics — leave them to the text path
  const inBand = (st, it, pad) => it.cy >= st.top - pad && it.cy <= st.bot + pad;
  const staffs = all.filter(st => !items.some(it => inBand(st, it, st.sp) && /-{3,}|\|/.test(it.s)));
  const tabs = staffs.filter(s => s.n === 6 || s.n === 4);
  const notation = staffs.filter(s => s.n === 5 || s.n > 6);
  const segments = [];

  for (const st of tabs) {
    const { x0, x1, bars } = findBars(img, st);
    const sp = st.sp;
    // chord names may sit above a standard-notation staff that belongs to this tab staff
    const above = notation.filter(nst => nst.bot < st.top && st.top - nst.bot < sp * 12).sort((a, b) => b.bot - a.bot)[0];
    const chordTop = (above ? above.top : st.top) - sp * 4.5;
    const notes = [], chords = [], lyrics = [], tuning = [];
    for (const it of items) {
      if (it.used || it.x + it.w < x0 - sp * 3 || it.x > x1 + sp) continue;
      if (inBand(st, it, sp * 0.6)) {
        it.used = true;
        for (const m of it.s.matchAll(/\S+/g)) {
          const tok = m[0];
          const len = Math.max(1, it.s.length);
          const tx = it.x + (m.index / len) * it.w, tw = (tok.length / len) * it.w;
          const li = Math.round((it.cy - st.top) / sp);
          if (li < 0 || li >= st.n || Math.abs(it.cy - (st.top + li * sp)) > sp * 0.6) continue;
          if (FRET.test(tok) && tx >= x0 - 2) notes.push({ x: tx + tw / 2, li, t: tok.replace(/^\((\d+)\)$/, '($1)') });
          else if (/^[A-Ga-g][#b]?$/.test(tok) && tx < (bars[0] ?? x0) + sp) tuning[li] = tok;
        }
      } else if (it.cy < st.top && it.cy >= chordTop) {
        const t = it.s.trim();
        if (isChord(t)) { chords.push({ x: it.x, t }); it.used = true; }
        else if (it.cy >= st.top - sp * 3) it.used = true; // technique labels (H, P, let ring…)
      } else if (/^[TAB]$/.test(it.s.trim()) && it.x < x0 + sp * 3 && it.cy >= st.top - sp * 2 && it.cy <= st.bot + sp * 2) {
        it.used = true; // the "TAB" clef
      } else if (it.cy > st.bot && it.cy <= st.bot + sp * 4.6 && /[A-Za-z]/.test(it.s) && !isChord(it.s.trim()) && !/^\s*[\[{(]|:\s*$/.test(it.s)) {
        lyrics.push({ x: it.x, t: it.s.trim() }); it.used = true;
      }
    }
    if (!notes.length) continue;
    // beats: notes that line up vertically
    notes.sort((a, b) => a.x - b.x);
    const cols = [];
    for (const n of notes) {
      const c = cols[cols.length - 1];
      if (c && n.x - c.x <= sp * 0.55) { if (!c.n[n.li]) c.n[n.li] = n.t; }
      else { const col = { x: n.x, n: new Array(st.n).fill('') }; col.n[n.li] = n.t; cols.push(col); }
    }
    for (const ch of chords) nearest(cols, ch.x, sp).c = ch.t;
    for (const ly of lyrics) { const c = nearest(cols, ly.x, sp); c.l = c.l ? c.l + ' ' + ly.t : ly.t; }
    // bars → measures
    let edges = bars.slice();
    if (!edges.length || edges[0] > cols[0].x - sp * 0.3) edges.unshift(Math.min(x0, cols[0].x - 1));
    if (edges[edges.length - 1] < cols[cols.length - 1].x + sp * 0.3) edges.push(Math.max(x1, cols[cols.length - 1].x + 1));
    const gaps = [];
    for (let k = 1; k < cols.length; k++) gaps.push(cols[k].x - cols[k - 1].x);
    const unit = Math.max(sp * 0.9, median(gaps.filter(g => g > sp * 0.5)) || sp * 1.5);
    const measures = [];
    for (let k = 0; k < edges.length - 1; k++) {
      const inM = cols.filter(c => c.x > edges[k] && c.x < edges[k + 1]);
      if (!inM.length) continue;
      const out = [];
      inM.forEach((c, idx) => {
        if (idx) { const extra = Math.min(3, Math.max(0, Math.round((c.x - inM[idx - 1].x) / unit) - 1)); for (let e = 0; e < extra; e++) out.push(null); }
        out.push(c);
      });
      measures.push(out);
    }
    segments.push({ y: st.top, text: '\n' + staffToAscii(st.n, measures, tuning) + '\n' });
  }
  // standard notation is skipped — its symbols aren't useful as text
  for (const nst of notation) for (const it of items) if (!it.used && inBand(nst, it, nst.sp * 2)) it.used = true;
  for (const ln of textLines(items)) segments.push(ln);
  segments.sort((a, b) => a.y - b.y);
  return { text: segments.map(s => s.text).join('\n'), staves: tabs.length };
}

function nearest(cols, x, sp) {
  let best = cols[0];
  for (const c of cols) if (c.x <= x + sp * 0.8) best = c;
  return best;
}

function staffToAscii(n, measures, tuning) {
  const def = n === 6 ? ['e', 'B', 'G', 'D', 'A', 'E'] : ['A', 'E', 'C', 'G'];
  const okTuning = tuning.filter(Boolean).length === n && tuning.every(t => noteIndex(t[0].toUpperCase() + t.slice(1)) !== undefined);
  const labels = okTuning ? tuning.map((t, i) => (i === 0 && n === 6 ? t.toLowerCase() : t.toUpperCase())) : def;
  const lw = Math.max(...labels.map(l => l.length));
  const strs = labels.map(l => l.padEnd(lw) + '|');
  let chord = ' '.repeat(lw + 1), lyr = ' '.repeat(lw + 1);
  let hasC = false, hasL = false;
  for (const m of measures) {
    for (const c of m) {
      if (!c) { for (let i = 0; i < n; i++) strs[i] += '---'; chord += '   '; lyr += '   '; continue; }
      const w = Math.max(1, ...c.n.map(t => t.length), (c.c || '').length, (c.l || '').length);
      for (let i = 0; i < n; i++) strs[i] += '-' + (c.n[i] || '').padEnd(w, '-') + '-';
      chord += ' ' + (c.c || '').padEnd(w + 1); lyr += ' ' + (c.l || '').padEnd(w + 1);
      if (c.c) hasC = true; if (c.l) hasL = true;
    }
    for (let i = 0; i < n; i++) strs[i] += '|';
    chord += ' '; lyr += ' ';
  }
  return [hasC ? chord.trimEnd() : null, ...strs, hasL ? lyr.trimEnd() : null].filter(x => x !== null).join('\n');
}

// Rebuild plain text lines (keeps column spacing so chords stay over the right words).
function textLines(items) {
  const rest = items.filter(i => !i.used).sort((a, b) => a.base - b.base || a.x - b.x);
  if (!rest.length) return [];
  const cw = median(rest.filter(i => i.s.length >= 3 && i.w > 0).map(i => i.w / i.s.length)) || 6;
  const left = Math.min(...rest.map(i => i.x));
  const rows = [];
  for (const it of rest) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.base - r.base) <= Math.max(2, Math.min(it.fs, r.fs) * 0.45)) r.items.push(it);
    else rows.push({ base: it.base, fs: it.fs, items: [it] });
  }
  // rebuild each row, remembering the x position of every character
  const built = rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let s = '', end = null; const xs = [];
    for (const it of r.items) {
      const col = Math.round((it.x - left) / cw);
      while (s.length < col) { xs.push(left + s.length * cw); s += ' '; }
      if (end !== null && it.x - end > cw * 0.3 && !s.endsWith(' ')) { xs.push(end); s += ' '; }
      const wts = [...it.s].map(charWeight), tot = wts.reduce((a, b) => a + b, 0) || 1;
      let x = it.x;
      [...it.s].forEach((ch, k) => { xs.push(x); x += (wts[k] / tot) * it.w; });
      s += it.s; end = it.x + it.w;
    }
    return { y: r.base, s, xs, items: r.items };
  });
  // chord rows over proportional-font lyrics: place each chord over the letter it sits above
  for (let i = 0; i < built.length - 1; i++) {
    const a = built[i], b = built[i + 1];
    const toks = a.items.flatMap(it => [...it.s.matchAll(/\S+/g)].map(m => ({ t: m[0], x: it.x + (m.index / Math.max(1, it.s.length)) * it.w })));
    if (!toks.length || !toks.every(t => isChord(t.t))) continue;
    if (!/[a-z]/.test(b.s) || b.s.trim().split(/\s+/).every(isChord)) continue;
    let line = '';
    for (const t of toks) {
      let k = b.xs.findIndex(x => x >= t.x - cw * 0.35);
      if (k < 0) k = b.s.length + Math.max(0, Math.round((t.x - (b.xs[b.xs.length - 1] || left)) / cw));
      if (line.length && k <= line.length) k = line.length + 1;
      line = line.padEnd(k) + t.t;
    }
    a.s = line;
  }
  const out = [];
  for (const r of built) {
    const s = r.s.replace(/[\uE000-\uF8FF]/g, '').trimEnd();
    if (!/[A-Za-z0-9]/.test(s)) continue;
    if (/^\s*(page\s*)?\d+\s*(\/|of)\s*\d+\s*$/i.test(s) || /^\s*\d{1,3}\s*$/.test(s)) continue; // page numbers
    if (/https?:|www\.|\.com\b|ultimate-guitar|songsterr|©|copyright/i.test(s)) continue;
    out.push({ y: r.y, text: s });
  }
  return out;
}

function charWeight(ch) {
  if (ch === ' ') return 0.28;
  if (/[iljI.,:;'!|]/.test(ch)) return 0.26;
  if (/[ftr()\[\]\-]/.test(ch)) return 0.36;
  if (/[mwMW]/.test(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.68;
  return 0.55;
}

// Title = biggest text on page 1; "Music by …" / "by …" gives the artist.
function takeTitle(items, H) {
  const top = items.filter(i => i.base < H * 0.3);
  if (!top.length) return {};
  const maxFs = Math.max(...top.map(i => i.fs));
  const tItems = top.filter(i => i.fs >= maxFs * 0.92).sort((a, b) => a.base - b.base || a.x - b.x);
  if (maxFs < median(items.map(i => i.fs)) * 1.3) return {};
  const firstBase = tItems[0].base;
  const titleIt = tItems.filter(i => Math.abs(i.base - firstBase) < maxFs * 0.5);
  titleIt.forEach(i => { i.used = true; });
  const res = { title: titleIt.map(i => i.s.trim()).join(' ').replace(/\s+/g, ' ') };
  for (const it of top) {
    const m = it.s.trim().match(/^(?:(?:words\s*(?:&|and)\s*)?music\s+by|by|artist:)\s+(.+)$/i);
    if (m && !it.used) { res.artist = m[1]; it.used = true; break; }
  }
  return res;
}
