// Read a digital PDF tab (Guitar Pro, Songsterr, Ultimate Guitar, printed tabs…) and turn it into
// tab text that the normal importer understands.
//
// How it works: each page is drawn to a hidden canvas so we can find the tab staffs (groups of 6 or 4
// evenly spaced horizontal lines) and bar lines. The PDF's text layer tells us where every fret number,
// chord name and lyric sits; each number is matched to the nearest string line and beat. Plain text
// (chord sheets, ASCII tabs) is rebuilt line by line keeping its spacing.
import { isChord, noteIndex } from './theory.js';
import { UG, FONT } from './glyphs.js';

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

export async function pdfToTabText(file, onProgress, opts = {}) {
  const L = await pdfjs();
  const task = L.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages = doc.numPages;
  const parts = [];
  let scanned = 0, staves = 0, meta = {};
  // how many strings to expect: the instrument you picked, else a 'Tuning: E A D G B E' line
  let expect = opts.instrument === 'guitar' ? 6 : opts.instrument === 'ukulele' ? 4 : 0;
  for (let p = 1; p <= pages; p++) {
    onProgress && onProgress(p, pages);
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, (opts.width || 1600) / base.width) });
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => toItem(L, vp, i));
    // (pages with no text may still hold tab drawn as a picture — read those optically)
    if (p === 1) meta = { ...meta, ...takeTitle(items, vp.height) };
    let img = await raster(page, vp);
    if (!expect) { const tl = items.map(i => i.s).join(' ').match(/tuning\s*:?\s*((?:[A-G][#b]?(?=\s|$)\s*){4,7})/); if (tl) { const n = tl[1].match(/[A-G][#b]?/g).length; if (n === 6 || n === 4) expect = n; } }
    let res = analysePage(items.map(i => ({ ...i })), img, expect);
    // tab drawn as pictures reads most reliably when the strings are ~28px apart — re-read finer if needed
    if (res.ocr && res.sp && Math.abs(res.sp - 28) > 1) {
      const k = Math.min(28 / res.sp, 2600 / vp.width);
      if (Math.abs(k - 1) > 0.03) {
        const vp2 = page.getViewport({ scale: vp.scale * k });
        img = await raster(page, vp2);
        const fresh = tc.items.filter(i => i.str && i.str.trim()).map(i => toItem(L, vp2, i));
        if (p === 1) takeTitle(fresh, vp2.height);
        res = analysePage(fresh, img, expect);
      }
    }
    staves += res.staves;
    if (items.length < 3 && !res.staves) scanned++;
    if (res.ocr) meta.ocr = true;
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
  const W = c.width, H = c.height, dark = new Uint8Array(W * H), ink = new Uint8Array(W * H);
  for (let k = 0, j = 0; k < d.length; k += 4, j++) {
    const lum = d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11;
    dark[j] = lum < 228 ? 1 : 0; // thin, faint grey staff lines count too
    ink[j] = lum < 140 ? 1 : 0;  // solid ink only — keeps numbers apart from brackets and lines
  }
  c.width = c.height = 0; // free memory on iPad
  return { W, H, dark, ink };
}

// ---------- staff + bar detection
// Row statistics: how much of the row is ink, and the longest stretch of line — bridging the small
// white gaps that notes punch into a string line (e.g. power chords with an 8 on every beat).
function rowStats(dark, W, y) {
  const o = y * W, gap = Math.round(W * 0.03);
  let cnt = 0, run = 0, best = 0, bridged = 0, bStart = -1, lastDark = -1e9, first = -1, last = -1;
  for (let x = 0; x < W; x++) {
    if (dark[o + x]) {
      cnt++; run++; if (run > best) best = run;
      if (first < 0) first = x; last = x;
      if (x - lastDark - 1 > gap) bStart = x;
      lastDark = x;
      if (x - bStart + 1 > bridged) bridged = x - bStart + 1;
    } else run = 0;
  }
  return { cnt, best, bridged, first, last };
}

function findLines({ W, H, dark }) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const r = rowStats(dark, W, y);
    if (r.cnt >= W * 0.3 && (r.best >= W * 0.06 || r.bridged >= W * 0.45)) rows.push({ y, first: r.first, last: r.last });
  }
  const lines = [];
  for (const r of rows) {
    const l = lines[lines.length - 1];
    if (l && r.y - l.y1 <= 1) { l.y1 = r.y; l.x0 = Math.min(l.x0, r.first); l.x1 = Math.max(l.x1, r.last); }
    else lines.push({ y0: r.y, y1: r.y, x0: r.first, x1: r.last });
  }
  return lines.filter(l => l.y1 - l.y0 < 7).map(l => ({ ...l, y: (l.y0 + l.y1) / 2 }));
}

// A guitar staff that came out with 4 or 5 lines (a string hidden under lots of notes): look one
// spacing above/below for the missing line with looser rules.
function completeStaff(img, st, want) {
  const { W, H, dark } = img;
  const probe = (yc) => {
    for (let d = -2; d <= 2; d++) {
      const y = Math.round(yc + d); if (y < 0 || y >= H) continue;
      const r = rowStats(dark, W, y);
      if (r.cnt >= W * 0.15 && r.bridged >= W * 0.3) return { y0: y, y1: y, y, x0: r.first, x1: r.last };
    }
    return null;
  };
  let guard = 0;
  while (st.lines.length < want && guard++ < 3) {
    const below = probe(st.bot + st.sp), above = probe(st.top - st.sp);
    const add = below || above; if (!add) break;
    if (add === below) st.lines.push(add); else st.lines.unshift(add);
    st.n = st.lines.length; st.top = st.lines[0].y; st.bot = st.lines[st.lines.length - 1].y;
  }
  return st;
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
function analysePage(items, img, expect) {
  const all = groupStaves(findLines(img), img.H);
  // ASCII tabs drawn with dashes are text, not graphics — leave them to the text path
  const inBand = (st, it, pad) => it.cy >= st.top - pad && it.cy <= st.bot + pad;
  const staffs = all.filter(st => !items.some(it => inBand(st, it, st.sp) && /-{3,}|\|/.test(it.s)));
  // a guitar tab (tuning says 6 strings, or another staff on the page has 6) whose staff came out short
  const want6 = expect === 6 || staffs.some(st => st.n === 6);
  if (want6) for (const st of staffs) if (st.n === 4 || st.n === 5) completeStaff(img, st, 6);
  const tabs = staffs.filter(s => s.n === 6 || (s.n === 4 && !want6));
  const notation = staffs.filter(s => s.n === 5 || s.n > 6);
  const segments = [];
  let usedOcr = false, prevBot = null;

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
    let usedOcrHere = false;
    if (!notes.length) { notes.push(...ocrStaff(img, st, bars, x0, x1)); if (notes.length) usedOcr = usedOcrHere = true; }
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
    const measures = [], starts = [];
    for (let k = 0; k < edges.length - 1; k++) {
      const inM = cols.filter(c => c.x > edges[k] && c.x < edges[k + 1]);
      if (!inM.length) continue;
      const out = [];
      inM.forEach((c, idx) => {
        if (idx) { const extra = Math.min(3, Math.max(0, Math.round((c.x - inM[idx - 1].x) / unit) - 1)); for (let e = 0; e < extra; e++) out.push(null); }
        out.push(c);
      });
      measures.push(out); starts.push(edges[k]);
    }
    // section names drawn in the picture (Intro, Verse 1, Chorus…) — may start mid-line
    const labels = usedOcrHere ? findSections(img, st, x0, x1, prevBot) : [];
    let text = '', from = 0;
    const cuts = labels.map(l => ({ ...l, k: Math.max(0, starts.filter(sx => sx <= l.x + sp).length - 1) })).sort((a, b) => a.k - b.k);
    for (const c of cuts) {
      if (c.k > from) { text += '\n' + staffToAscii(st.n, measures.slice(from, c.k), tuning) + '\n'; from = c.k; }
      text += '\n[' + c.name + ']\n';
    }
    text += '\n' + staffToAscii(st.n, measures.slice(from), tuning) + '\n';
    segments.push({ y: st.top, text });
    prevBot = st.bot;
  }
  // standard notation is skipped — its symbols aren't useful as text
  for (const nst of notation) for (const it of items) if (!it.used && inBand(nst, it, nst.sp * 2)) it.used = true;
  for (const ln of textLines(items)) segments.push(ln);
  segments.sort((a, b) => a.y - b.y);
  return { text: segments.map(s => s.text).join('\n'), staves: tabs.length, ocr: usedOcr, sp: median(tabs.map(t => t.sp)) };
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
    if (/^\s*\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/.test(s)) continue; // print date header
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
  const sub = top.filter(i => !i.used && i.base > firstBase && i.base < firstBase + maxFs * 2.2 && i.fs >= maxFs * 0.5).sort((a, b) => a.base - b.base);
  if (sub.length && !/^(tuning|capo|key|tempo)/i.test(sub[0].s.trim())) { const b0 = sub[0].base; const art = sub.filter(i => Math.abs(i.base - b0) < maxFs * 0.4); res.artist = art.map(i => i.s.trim()).join(' '); art.forEach(i => { i.used = true; }); }
  for (const it of top) {
    if (res.artist) break;
    const m = it.s.trim().match(/^(?:(?:words\s*(?:&|and)\s*)?music\s+by|by|artist:)\s+(.+)$/i);
    if (m && !it.used) { res.artist = m[1]; it.used = true; break; }
  }
  return res;
}

// ================= Reading tab drawn as pictures =================
// Some PDFs (e.g. Ultimate Guitar "Official" tabs, clean scans) contain the tab as an image, so there is
// no text to read. We read the digits optically: remove the string and bar lines, cut out each remaining
// shape, and compare it with the digits 0–9 drawn in common fonts.
const GRID = 16;
const SANS = ['Arial', 'Helvetica', 'Helvetica Neue', 'Liberation Sans', 'DejaVu Sans', 'Verdana', 'sans-serif'];
const SERIF = ['Times New Roman', 'Times', 'Georgia', 'Liberation Serif', 'DejaVu Serif', 'serif'];
const TEMPLATE_CACHE = {};
function templates(fonts = SANS) {
  const key = fonts.join();
  if (TEMPLATE_CACHE[key]) return TEMPLATE_CACHE[key];
  if (fonts === SANS) { // built-in shapes: identical on every device
    const dec = (s) => Float32Array.from(s, ch => (+ch) / 9);
    return (TEMPLATE_CACHE[key] = [...UG, ...FONT].map(([ch, v]) => ({ ch, v: dec(v) })));
  }
  const TEMPLATES = TEMPLATE_CACHE[key] = [];
  const c = document.createElement('canvas'); c.width = 90; c.height = 110;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const chars = '0123456789()/\\TABH';  // letters are there so the TAB sign isn't mistaken for digits
  for (const f of fonts) for (const wgt of ['bold', 'normal']) for (const ch of chars) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 90, 110);
    ctx.fillStyle = '#000'; ctx.font = `${wgt} 72px "${f}"`; ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, 12, 85);
    const d = ctx.getImageData(0, 0, 90, 110).data;
    const W = 90, H = 110, m = new Uint8Array(W * H);
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] < 128) { m[y * W + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    TEMPLATES.push({ ch, v: normGlyph((x, y) => m[y * W + x], x0, y0, x1 - x0 + 1, y1 - y0 + 1) });
  }
  return TEMPLATES;
}

// Scale a glyph to GRID px tall (keeping its shape), centred in a GRID×GRID box; returns coverage 0..1.
function normGlyph(get, bx, by, w, h) {
  const out = new Float32Array(GRID * GRID);
  const tw = Math.max(1, Math.min(GRID, Math.round(GRID * w / h))), off = (GRID - tw) / 2;
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    if (gx < Math.floor(off) || gx >= Math.ceil(off + tw)) continue;
    let hit = 0, n = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const fx = (gx + (sx + 0.5) / 3 - off) / tw, fy = (gy + (sy + 0.5) / 3) / GRID;
      if (fx < 0 || fx >= 1) continue;
      n++; hit += get(bx + Math.floor(fx * w), by + Math.floor(fy * h)) ? 1 : 0;
    }
    out[gy * GRID + gx] = n ? hit / n : 0;
  }
  return out;
}

// Count closed loops in a glyph (6 has one, 5 has none, 8 has two) — a reliable tie-breaker.
function holes(get, w, h) { return holeBoxes(get, w, h).length; }
// Enclosed background regions of a glyph, with their boxes (relative to the glyph height).
function holeBoxes(get, w, h) {
  const seen = new Uint8Array((w + 2) * (h + 2)), W2 = w + 2;
  const bg = (x, y) => x < 0 || y < 0 || x >= w || y >= h || !get(x, y);
  const out = [];
  for (let sy = -1; sy <= h; sy++) for (let sx = -1; sx <= w; sx++) {
    const i0 = (sy + 1) * W2 + sx + 1;
    if (seen[i0] || !bg(sx, sy)) continue;
    let size = 0, edge = false, y0 = h, y1 = -1; const st = [[sx, sy]]; seen[i0] = 1;
    while (st.length) {
      const [x, y] = st.pop(); size++;
      if (x < 0 || y < 0 || x >= w || y >= h) edge = true; else { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < -1 || ny < -1 || nx > w || ny > h) continue;
        const j = (ny + 1) * W2 + nx + 1;
        if (!seen[j] && bg(nx, ny)) { seen[j] = 1; st.push([nx, ny]); }
      }
    }
    if (!edge && size >= Math.max(2, w * h * 0.012)) out.push({ top: y0 / h, bot: (y1 + 1) / h, size });
  }
  return out;
}
const LOOPS = { 0: '123457', 1: '0469', 2: '8' }; // digits allowed for each loop count (4 can be open or closed)

function classify(v, loops, fonts) {
  const allow = loops == null ? null : (LOOPS[Math.min(2, loops)] || '');
  let best = null, bestD = Infinity;
  for (const t of templates(fonts)) {
    if (allow && /\d/.test(t.ch) && !allow.includes(t.ch)) continue;
    if (t.ch === 'x' && loops) continue; // an X has no loops
    let d = 0;
    for (let i = 0; i < v.length; i++) d += Math.abs(v[i] - t.v[i]);
    if (d < bestD) { bestD = d; best = t.ch; }
  }
  return { ch: best, d: bestD };
}

function ocrStaff({ W, dark: lineInk, ink }, st, bars, x0, x1) {
  const dark = ink || lineInk;
  const sp = st.sp;
  const top = Math.max(0, Math.floor(st.top - sp * 0.7)), bot = Math.ceil(st.bot + sp * 0.7);
  const left = Math.max(0, Math.floor(x0)), right = Math.min(W - 1, Math.ceil(x1));
  const w = right - left + 1, h = bot - top + 1;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = dark[(top + y) * W + left + x];
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  // remove string lines: only long horizontal runs (a digit's own strokes — like the waist of an 8 — are short)
  const minRun = Math.max(6, sp * 0.9);
  for (const l of st.lines) {
    for (let y = Math.round(l.y0) - top - 1; y <= Math.round(l.y1) - top + 1; y++) {
      if (y < 0 || y >= h) continue;
      let x = 0;
      while (x < w) {
        if (!m[y * w + x]) { x++; continue; }
        let e = x; while (e < w && m[y * w + e]) e++;
        if (e - x >= minRun) for (let k = x; k < e; k++) m[y * w + k] = 0;
        x = e;
      }
    }
  }
  // remove bar lines
  for (const bx of bars) {
    const cx = Math.round(bx) - left;
    for (let y = 0; y < h; y++) for (let x = cx - 3; x <= cx + 3; x++) if (x >= 0 && x < w && !at(cx - 5, y) && !at(cx + 5, y)) m[y * w + x] = 0;
  }
  // connected shapes
  const lab = new Int32Array(w * h), comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    const id = comps.length + 1, c = { id, x0: w, y0: h, x1: -1, y1: -1, n: 0 };
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k - x) / w;
      c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h) { const j = ny * w + nx; if (m[j] && !lab[j]) { lab[j] = id; stack.push(j); } }
      }
    }
    comps.push(c);
  }
  for (const c of comps) { c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; c.cy = top + (c.y0 + c.y1) / 2; }
  // digit-sized shapes sitting on a string
  let cand = comps.filter(c => c.h >= sp * 0.4 && c.h <= sp * 1.25 && c.w <= sp * 1.1 && c.h / c.w >= 0.9 && c.n >= 6);
  const H = median(cand.map(c => c.h));
  if (!H) return [];
  cand = cand.filter(c => c.h >= H * 0.78 && c.h <= H * 1.18);
  const glyphs = [];
  for (const c of cand) {
    const li = Math.round((c.cy - st.top) / sp);
    if (li < 0 || li >= st.n || Math.abs(c.cy - (st.top + li * sp)) > sp * 0.42) continue;
    const inC = (x, y) => lab[(c.y0 + y) * w + c.x0 + x] === c.id;
    const v = normGlyph((x, y) => lab[y * w + x] === c.id, c.x0, c.y0, c.w, c.h);
    const hb = holeBoxes(inC, c.w, c.h);
    const r = classify(v, hb.length);
    if (!/[\dx]/.test(r.ch) || r.d > GRID * GRID * 0.32) continue;
    let ch = r.ch;
    // shape rules that don't depend on fonts: where the loop sits tells 0, 6 and 9 apart
    if (hb.length === 1 && /[0469]/.test(ch)) {
      const hl = hb[0], tall = hl.bot - hl.top, mid = (hl.top + hl.bot) / 2;
      if (tall >= 0.5) {
        // a 0 is empty in the middle; an 8 whose waist leaked still has ink at its centre
        let ink = 0, n = 0;
        for (let y = Math.floor(c.h * 0.4); y <= Math.ceil(c.h * 0.6); y++) for (let x = Math.floor(c.w * 0.38); x <= Math.ceil(c.w * 0.62); x++) { n++; ink += inC(x, y) ? 1 : 0; }
        ch = ink / n > 0.45 ? '8' : '0';
      }
      else if (mid > 0.56) ch = '6';
      else if (ch === '0' || ch === '6') ch = c.w / c.h < 0.62 && mid < 0.45 ? '9' : ch;
    } else if (hb.length >= 2) ch = '8';
    glyphs.push({ li, x0: left + c.x0, x1: left + c.x1, ch, v, loops: Math.min(2, hb.length) });
  }
  // the same shape in one tab line must read the same: let near-identical glyphs vote
  for (const g of glyphs) {
    const votes = {};
    for (const o of glyphs) {
      if (o.loops !== g.loops) continue; // never let a 0 outvote an 8 (different number of loops)
      let d = 0; for (let i = 0; i < g.v.length; i++) d += Math.abs(g.v[i] - o.v[i]);
      if (d < GRID * GRID * 0.05) votes[o.ch] = (votes[o.ch] || 0) + 1;
    }
    g.vote = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  }
  for (const g of glyphs) g.ch = g.vote;
  // join neighbouring digits on the same string (e.g. 1 + 2 → 12)
  glyphs.sort((a, b) => a.li - b.li || a.x0 - b.x0);
  const notes = [];
  for (const g of glyphs) {
    const last = notes[notes.length - 1];
    if (last && last.li === g.li && g.x0 - last.x1 <= H * 0.6 && last.t.length < 2 && (last.t === '1' || last.t === '2') && g.ch !== 'x' && last.t !== 'x') { last.t += g.ch; last.x1 = g.x1; }
    else notes.push({ li: g.li, x0: g.x0, x1: g.x1, t: g.ch });
  }
  return notes.map(n => ({ x: (n.x0 + n.x1) / 2, li: n.li, t: n.t }));
}


// ---------- section names drawn as pictures
const SECTION_WORDS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Bridge', 'Outro', 'Solo', 'Interlude', 'Instrumental', 'Riff', 'Ending', 'Tag', 'Breakdown', 'Hook', 'Refrain', 'Coda'];
const WG_H = 12, WG_W = 44;
function wordGrid(get, bx, by, w, h) {
  const out = new Float32Array(WG_W * WG_H);
  for (let gy = 0; gy < WG_H; gy++) for (let gx = 0; gx < WG_W; gx++) {
    let hit = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++)
      hit += get(bx + Math.floor(((gx + (sx + 0.5) / 3) / WG_W) * w), by + Math.floor(((gy + (sy + 0.5) / 3) / WG_H) * h)) ? 1 : 0;
    out[gy * WG_W + gx] = hit / 9;
  }
  return out;
}
let WORD_T = null;
function wordTemplates() {
  if (WORD_T) return WORD_T;
  WORD_T = [];
  const c = document.createElement('canvas'); c.width = 900; c.height = 140;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // also the word with its first 1–2 letters missing — printouts sometimes cut labels off at the page edge
  const variants = [];
  for (const word of SECTION_WORDS) { variants.push([word, word]); for (const k of [1, 2, 3]) if (word.length - k >= 4) variants.push([word.slice(k), word]); }
  for (const f of [...SERIF, ...SANS]) for (const wgt of ['bold', 'normal']) for (const [text, word] of variants) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 140);
    ctx.fillStyle = '#000'; ctx.font = `${wgt} 80px "${f}"`; ctx.fillText(text, 10, 100);
    const d = ctx.getImageData(0, 0, 900, 140).data;
    let x0 = 900, x1 = -1, y0 = 140, y1 = -1;
    for (let y = 0; y < 140; y++) for (let x = 0; x < 900; x++) if (d[(y * 900 + x) * 4] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    const get = (x, y) => d[(y * 900 + x) * 4] < 128;
    WORD_T.push({ word, v: wordGrid(get, x0, y0, x1 - x0 + 1, y1 - y0 + 1), aspect: (x1 - x0 + 1) / (y1 - y0 + 1) });
  }
  return WORD_T;
}

function components(m, w, h) {
  const lab = new Int32Array(w * h), comps = [], stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    const id = comps.length + 1, c = { id, x0: w, y0: h, x1: -1, y1: -1, n: 0 };
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k - x) / w;
      c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h) { const j = ny * w + nx; if (m[j] && !lab[j]) { lab[j] = id; stack.push(j); } }
      }
    }
    c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1;
    comps.push(c);
  }
  return { lab, comps };
}

function findSections({ W, dark }, st, x0, x1, prevBot) {
  const sp = st.sp;
  const yA = Math.max(prevBot == null ? 0 : Math.round(prevBot + sp * 4), Math.floor(st.top - sp * 4.2)), yB = Math.floor(st.top - sp * 0.7);
  if (yB - yA < sp * 0.8) return [];
  const left = Math.max(0, Math.floor(x0 - sp * 4)), w = Math.min(W - 1, Math.ceil(x1)) - left + 1, h = yB - yA + 1; // labels can hang off the left edge
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = dark[(yA + y) * W + left + x];
  const { comps } = components(m, w, h);
  const letters = comps.filter(c => c.h >= sp * 0.25 && c.h <= sp * 1.9 && c.n >= 4).sort((a, b) => a.x0 - b.x0);
  const group = (items, gap) => {
    const out = [];
    for (const c of items) {
      const g = out.find(g => {
        if (c.x0 - g.x1 > gap || c.x0 < g.x0) return false;
        const last = g.parts[g.parts.length - 1];           // letters of one word sit on the same line
        const ov = Math.min(c.y1, last.y1) - Math.max(c.y0, last.y0);
        return ov >= 0.45 * Math.min(c.h, last.h);
      });
      if (g) { g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); g.parts.push(c); }
      else out.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, parts: [c] });
    }
    return out;
  };
  const words = group(letters, sp * 0.45);
  const found = [];
  const used = new Set();
  const matchBox = (x0, y0, x1, y1) => {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bh < sp * 0.55 || bh > sp * 2.2 || bw < bh * 1.2) return null;
    const v = wordGrid((x, y) => m[y * w + x], x0, y0, bw, bh);
    let best = null, bestD = Infinity;
    for (const t of wordTemplates()) {
      const ar = (bw / bh) / t.aspect;
      if (ar < 0.72 || ar > 1.38) continue;
      let d = 0; for (let i = 0; i < v.length; i++) d += Math.abs(v[i] - t.v[i]);
      d = d / v.length + Math.abs(Math.log(ar)) * 0.15;
      if (d < bestD) { bestD = d; best = t.word; }
    }
    return best && bestD <= 0.235 ? { word: best, bh } : null;
  };
  const digitsOf = (parts) => {
    if (!parts.length || parts.length > 2) return null;
    const r = parts.map(c => classify(normGlyph((x, y) => m[y * w + x], c.x0, c.y0, c.w, c.h), null, SERIF));
    return r.every(x => /\d/.test(x.ch) && x.d < GRID * GRID * 0.3) ? r.map(x => x.ch).join('') : null;
  };
  const box = (parts) => parts.reduce((b, c) => ({ x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) }), { x0: Infinity, y0: Infinity, x1: -1, y1: -1 });
  for (const wd of words) {
    if (used.has(wd)) continue;
    const parts = wd.parts.slice().sort((p, q) => p.x0 - q.x0);
    // try the whole group, then without 1–2 trailing shapes (a number glued on: "Verse 2")
    for (let cut = 0; cut <= Math.min(2, parts.length - 2); cut++) {
      const head = parts.slice(0, parts.length - cut), tail = parts.slice(parts.length - cut);
      const bb = box(head);
      const hit = matchBox(bb.x0, bb.y0, bb.x1, bb.y1);
      if (!hit) continue;
      let name = hit.word;
      if (cut) { const d = digitsOf(tail); if (!d) continue; name += ' ' + d; }
      else {
        const next = words.find(o => o !== wd && !used.has(o) && o.x0 > wd.x1 && o.x0 - wd.x1 <= sp * 1.2 && Math.abs(o.y1 - wd.y1) <= sp * 0.35);
        const d = next && digitsOf(next.parts);
        if (d) { name += ' ' + d; used.add(next); }
      }
      found.push({ x: left + bb.x0, name });
      break;
    }
  }
  return found;
}

