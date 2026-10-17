// Piano sheet music screen: read, perform, edit (piano keyboard + tap the staff) and play back.
import { h, icon, btn, sheet, toast, confirmBox, field } from '../ui.js';
import * as S from '../store.js';
import * as V from '../versions.js';
import { emojiRain } from '../art.js';
import { transposeChord } from '../theory.js';
import { G } from './glyphs.js';
import * as M from './model.js';
import { render, pitchAt } from './render.js';
import * as A from './audio.js';

const TIMES = [[4, 4], [3, 4], [2, 4], [6, 8], [2, 2], [5, 4], [3, 8], [9, 8], [12, 8]];
const KB_LO = 36, KB_HI = 96; // C2 … C7

// tiny SVG icons built from the notation glyphs
function gl(name, x, yTop, hgt, flip) {
  const [x0, y0, x1, y1] = G[name].b, s = hgt / (y1 - y0);
  return flip ? `<path transform="translate(${x - x0 * s},${yTop - y0 * s}) scale(${s},${s})" d="${G[name].d}"/>`
    : `<path transform="translate(${x - x0 * s},${yTop + y1 * s}) scale(${s},${-s})" d="${G[name].d}"/>`;
}
function durIcon(d, rest) {
  let inner = '';
  if (rest) inner = d === 'w' ? '<rect x="7" y="9" width="10" height="4"/>' : d === 'h' ? '<rect x="7" y="11" width="10" height="4"/>' : gl({ q: 'r4', '8': 'r8', '16': 'r16' }[d], 8, d === 'q' ? 3 : 5, d === 'q' ? 18 : 15);
  else {
    const head = d === 'w' ? 'whole' : d === 'h' ? 'void' : 'black';
    inner = gl(head, d === 'w' ? 6 : 5, 15, 6.5);
    if (d !== 'w') inner += '<rect x="12.6" y="3" width="1.4" height="15"/>';
    if (d === '8' || d === '16') inner += gl(d === '8' ? 'flag8' : 'flag16', 13.2, 3, 11);
  }
  return `<svg viewBox="0 0 24 24" class="dur-ic" aria-hidden="true">${inner}</svg>`;
}
const clefIcon = (st) => `<svg viewBox="0 0 24 30" class="dur-ic clef-ic" aria-hidden="true">${st === 't' ? gl('gclef', 5, 1, 28) : gl('fclef', 3, 6, 15)}</svg>`;

export function scoreScreen(root, songId, ctx = {}, nav) {
  const song = S.getSong(songId);
  if (!song) { root.append(h('div', { class: 'empty-state' }, 'That song could not be found.', btn('Home', () => nav('#/'), { cls: 'primary' }))); return () => {}; }
  if (!song.score) song.score = M.newScore();
  const sc = () => song.score;

  let mode = ctx.edit ? 'edit' : 'view';
  let sel = mode === 'edit' ? { m: 0, s: 't', i: 0 } : null;
  let dur = 'q', dotOn = false, chordMode = false, insertMode = false;
  const lastMidi = { t: 72, b: 48 };
  let undo = [], redo = [];
  let player = null, layout = null;
  const playlist = ctx.pl ? S.db.playlists[ctx.pl] : null;
  const plIndex = playlist ? playlist.songIds.indexOf(songId) : -1;

  // ---------- skeleton (same chrome as the tab screen)
  const scroll = h('div', { class: 'song-scroll score-scroll', tabindex: '-1' });
  const topbar = h('div', { class: 'topbar', role: 'toolbar' });
  const handle = h('button', { class: 'menu-handle', 'aria-label': 'Show menu', type: 'button', onclick: (e) => { e.stopPropagation(); toggleBar(); } }, h('span', { class: 'pick-dot', html: '<svg viewBox="0 0 24 26"><path d="M12 25C7 21 1 13 1.5 7 2 3 6 1.5 12 1.5S22 3 22.5 7C23 13 17 21 12 25z"/></svg>' }));
  const keypad = h('div', { class: 'keypad score-pad' });
  const screen = h('div', { class: 'song-screen score-screen' }, scroll, handle, topbar, keypad);
  root.append(screen);
  const wrap = h('div', { class: 'score-wrap' });

  function applyStage() { document.documentElement.classList.toggle('stage', !!S.pref('stage', false)); }
  applyStage();
  function topColor() { window.setTopColor(screen.classList.contains('bar-open') ? '#614C49' : (S.pref('stage') ? '#1E1817' : '#FFFBF4')); }
  function showBar() { screen.classList.add('bar-open'); handle.setAttribute('aria-label', 'Hide menu'); S.setPref('barPinned', true); topColor(); }
  function hideBar() { screen.classList.remove('bar-open'); handle.setAttribute('aria-label', 'Show menu'); S.setPref('barPinned', false); topColor(); }
  function toggleBar() { screen.classList.contains('bar-open') ? hideBar() : showBar(); }

  // ---------- toolbar
  const timerPill = h('button', { class: 'tb timer-pill', type: 'button', title: 'Practice timer (tap to pause)' });
  const spPx = () => S.pref('scoresp', window.innerWidth < 600 ? 7.5 : 10);
  function buildBar() {
    topbar.innerHTML = '';
    const tb = (label, ico, fn, title, cls = '') => h('button', { class: 'tb ' + cls, type: 'button', title: title || label, 'aria-label': title || label, onclick: (e) => { e.stopPropagation(); fn(e); } }, ico ? icon(ico) : null, label ? h('span', {}, label) : null);
    const sep = () => h('span', { class: 'tb-sep' });
    const items = [
      tb('', 'menu', () => window.openDrawer(), 'Menu'),
      tb('', 'home', () => nav('#/'), 'Home'),
      sep(),
      mode === 'view' ? tb('Edit', 'edit', () => setMode('edit'), 'Edit this music', 'accent') : tb('Done', 'check', () => setMode('view'), 'Finish editing', 'accent'),
      tb(player ? 'Stop' : 'Play', player ? 'pause' : 'play', togglePlay, player ? 'Stop playback' : 'Play the music', 'play-btn'),
    ];
    if (playlist) items.push(sep(),
      tb('', 'back', () => goPl(-1), 'Previous song in playlist'),
      h('span', { class: 'tb-label' }, `${plIndex + 1}/${playlist.songIds.length}`),
      tb('', 'next', () => goPl(1), 'Next song in playlist'));
    if (mode === 'edit') items.push(sep(), tb('Undo', '', doUndo, 'Undo'), tb('Redo', '', doRedo, 'Redo'),
      tb('Bar', 'plus', addBarAfter, 'Add an empty bar after this one'));
    items.push(sep(),
      tb('', 'minus', () => tempo(-4), 'Slower'), h('span', { class: 'tb-label' }, `♩=${song.bpm || 80}`), tb('', 'plus', () => tempo(4), 'Faster'),
      sep(),
      tb('', 'minus', () => zoom(-1), 'Smaller music'), h('span', { class: 'tb-label' }, 'Aa'), tb('', 'plus', () => zoom(1), 'Bigger music'),
      sep(),
      tb('', 'minus', () => transposeBy(-1), 'Transpose down a semitone'), h('span', { class: 'tb-label' }, 'Key ' + M.KEY_NAMES[sc().keyFifths]), tb('', 'plus', () => transposeBy(1), 'Transpose up a semitone'),
      sep(),
      tb(S.pref('stage') ? 'Day' : 'Stage', 'moon', () => { S.setPref('stage', !S.pref('stage')); applyStage(); buildBar(); topColor(); }, 'Stage (dark) mode'),
      tb('Score', 'gear', scoreSettings, 'Title, key, time signature, tempo'),
      sep(), timerPill);
    topbar.append(...items);
    updateTimer();
  }
  function zoom(d) { S.setPref('scoresp', Math.max(5, Math.min(18, spPx() + d))); draw(); }
  function tempo(d) { song.bpm = Math.max(30, Math.min(240, (song.bpm || 80) + d)); S.touchSong(song); buildBar(); renderMeta(); }

  // ---------- header
  const stageName = () => (S.db.settings.stageName || 'Olden Gray').trim() || 'Olden Gray';
  const head = h('header', { class: 'song-head' });
  const meta = h('div', { class: 'meta-line' });
  function renderMeta() {
    head.innerHTML = '';
    head.append(h('h1', { class: 'song-title' }, song.title || 'Untitled'));
    if (song.artist) head.append(h('div', { class: 'song-artist' }, song.artist));
    head.onclick = mode === 'edit' ? scoreSettings : null;
    meta.innerHTML = '';
    const mine = V.isMine(song);
    meta.append(
      h('span', { class: 'tuning' }, '🎼 Piano · sheet music'),
      h('span', { class: 'key-chip' }, 'Key ', h('b', {}, `${M.KEY_NAMES[sc().keyFifths]} major`), h('span', { class: 'key-to' }, ` / ${M.KEY_MINOR[sc().keyFifths]}`)),
      h('span', { class: 'key-chip' }, h('b', {}, `${sc().time[0]}/${sc().time[1]}`)),
      h('button', { type: 'button', class: 'bpm-chip', title: 'Tempo', onclick: (e) => { e.stopPropagation(); scoreSettings(); } }, h('span', {}, h('b', {}, song.bpm || 80), ' BPM')),
      h('button', { type: 'button', class: 'stage-badge' + (mine ? ' on' : ''), title: mine ? 'Back to the original' : `Show your ${stageName()} version`, 'aria-pressed': mine ? 'true' : 'false',
        onclick: (e) => { e.stopPropagation(); switchMine(!mine); } },
        h('span', { class: 'sb-star', html: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.4 6.4 19.7l1.5-6.3L3 9.1l6.4-.6z"/></svg>' }),
        h('span', { class: 'sb-name' }, stageName()), mine ? h('span', { class: 'sb-sub' }, 'my version') : null));
  }
  function switchMine(mine) {
    stopPlay();
    const made = V.switchVersion(song, 'piano', mine);
    if (!song.score) song.score = M.newScore();
    S.touchSong(song); undo = []; redo = [];
    if (sel) sel = { m: 0, s: 't', i: 0 };
    renderMeta(); draw(); buildBar(); renderPad();
    if (made === 'created') toast(`⭐ Made your ${stageName()} version — change anything, the original stays safe`, 3800);
  }

  // ---------- drawing
  const foot = h('div', {});
  scroll.append(head, meta, wrap, foot, h('div', { class: 'scroll-pad' }));
  function draw() {
    const width = Math.max(260, scroll.clientWidth - 28);
    const s = sc();
    if (mode === 'edit' && sel) ensureBar(sel.m);
    layout = render(s, { width, sp: spPx(), sel: mode === 'edit' ? sel : null });
    wrap.innerHTML = layout.svg;
    foot.innerHTML = '';
    const empty = !s.measures.some(m => m.t.length || m.b.length);
    if (empty && mode === 'view') foot.append(h('div', { class: 'score-empty' }, 'No notes yet. ', btn('Start writing', () => setMode('edit'), { cls: 'primary', icon: 'edit' })));
    if (playlist && mode === 'view') {
      const nextId = playlist.songIds[plIndex + 1], nextSong = nextId && S.getSong(nextId);
      foot.append(h('div', { class: 'pl-foot' }, nextSong ? btn(`Next: ${nextSong.title}`, () => goPl(1), { cls: 'primary big', icon: 'next' }) : h('div', { class: 'pl-done' }, '🎹 End of ', h('b', {}, playlist.name))));
    }
  }
  function ensureBar(m) { while (sc().measures.length <= m) sc().measures.push({ t: [], b: [] }); }

  // ---------- selection helpers
  const evsAt = (m, s) => (sc().measures[m] ? sc().measures[m][s] : []);
  const selEvent = () => (sel && evsAt(sel.m, sel.s)[sel.i]) || null;
  function full(m, s) { return M.filled(evsAt(m, s)) >= M.capacity(sc()); }
  function after(pos, s) {
    let { m, i } = pos; i++;
    if (i >= evsAt(m, s).length && full(m, s)) { m++; i = 0; ensureBar(m); }
    return { m, s, i };
  }
  function moveSel(d) {
    if (!sel) return;
    let { m, s, i } = sel;
    if (d > 0) {
      if (i < evsAt(m, s).length) { const nx = after({ m, i }, s); m = nx.m; i = nx.i; }
      else if (m < sc().measures.length - 1) { m++; i = 0; }
    } else {
      if (i > 0) i--;
      else if (m > 0) { m--; i = Math.max(0, full(m, s) ? evsAt(m, s).length - 1 : evsAt(m, s).length); }
    }
    sel = { m, s, i }; afterSelChange(true);
  }
  function afterSelChange(sound) {
    draw(); renderPad();
    const e = selEvent();
    if (sound && e && !e.rest && e.notes) A.preview(e.notes.map(M.midiOf));
    revealSel();
  }
  function revealSel() {
    const el = wrap.querySelector('.ev.sel, .caret'); if (!el) return;
    const r = el.getBoundingClientRect(), padTop = keypad.getBoundingClientRect().top;
    const sr = scroll.getBoundingClientRect();
    if (r.bottom > padTop - 20) scroll.scrollTop += r.bottom - padTop + 60;
    else if (r.top < sr.top + 60) scroll.scrollTop -= sr.top + 60 - r.top;
  }

  // ---------- editing ops
  function snapshot() { return JSON.stringify(sc()); }
  function pushUndo() { undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo = []; }
  function commit() { S.touchSong(song); }
  function doUndo() { if (!undo.length) return toast('Nothing to undo'); redo.push(snapshot()); song.score = JSON.parse(undo.pop()); fixSel(); commit(); draw(); renderPad(); buildBar(); renderMeta(); }
  function doRedo() { if (!redo.length) return toast('Nothing to redo'); undo.push(snapshot()); song.score = JSON.parse(redo.pop()); fixSel(); commit(); draw(); renderPad(); buildBar(); renderMeta(); }
  function fixSel() { if (!sel) return; sel.m = Math.min(sel.m, sc().measures.length - 1); sel.i = Math.min(sel.i, evsAt(sel.m, sel.s).length); }

  function place(ev) {
    if (!sel) sel = { m: 0, s: 't', i: 0 };
    pushUndo();
    const cur = selEvent();
    let pos;
    if (cur && !insertMode) {
      if (cur.lyric) ev.lyric = cur.lyric;
      if (cur.chord) ev.chord = cur.chord;
      evsAt(sel.m, sel.s).splice(sel.i, 1);
      pos = M.insertEvent(sc(), sel.s, sel.m, sel.i, ev);
    } else pos = M.insertEvent(sc(), sel.s, sel.m, sel.i, ev);
    sel = after(pos, sel.s);
    commit(); draw(); renderPad(); revealSel();
  }
  function keyPressed(midi) {
    const s = sel ? sel.s : 't';
    const p = M.spell(midi, sc().keyFifths);
    lastMidi[s] = midi;
    A.preview([midi]);
    if (mode !== 'edit') return;
    const cur = selEvent();
    if (chordMode) {
      // add to the selected chord (or to the note just entered)
      const target = cur && !cur.rest ? cur : prevEvent();
      if (target && !target.rest && target.notes) {
        if (target.notes.some(q => M.midiOf(q) === midi)) return toast('Already in the chord');
        pushUndo(); target.notes = [...target.notes, p].sort((a, b) => M.midiOf(a) - M.midiOf(b)); commit(); draw(); renderPad(); return;
      }
    }
    place({ d: dur, ...(dotOn ? { dot: true } : {}), notes: [p] });
  }
  function prevEvent() {
    if (!sel) return null;
    if (sel.i > 0) return evsAt(sel.m, sel.s)[sel.i - 1];
    if (sel.m > 0) { const e = evsAt(sel.m - 1, sel.s); return e[e.length - 1] || null; }
    return null;
  }
  // events that edit buttons act on: the selected one, or the one just entered
  function target() { return selEvent() || prevEvent(); }
  function targetPos() {
    if (selEvent()) return { ...sel };
    if (!sel) return null;
    if (sel.i > 0) return { m: sel.m, s: sel.s, i: sel.i - 1 };
    if (sel.m > 0 && evsAt(sel.m - 1, sel.s).length) return { m: sel.m - 1, s: sel.s, i: evsAt(sel.m - 1, sel.s).length - 1 };
    return null;
  }
  function setDur(d) {
    dur = d;
    const pos = selEvent() ? { ...sel } : null;
    if (pos) { // re-time the selected note
      const e = selEvent();
      if (e.d !== d) {
        pushUndo(); const copy = { ...e, d }; evsAt(pos.m, pos.s).splice(pos.i, 1);
        const at = M.insertEvent(sc(), pos.s, pos.m, pos.i, copy); sel = { m: at.m, s: pos.s, i: at.i }; commit(); draw();
      }
    }
    renderPad();
  }
  function toggleDot() {
    const e = selEvent();
    if (e) { pushUndo(); const copy = { ...e }; if (copy.dot) delete copy.dot; else copy.dot = true; evsAt(sel.m, sel.s).splice(sel.i, 1); const at = M.insertEvent(sc(), sel.s, sel.m, sel.i, copy); sel = { m: at.m, s: sel.s, i: at.i }; dotOn = !!copy.dot; commit(); draw(); }
    else dotOn = !dotOn;
    renderPad();
  }
  function addRest() { place({ d: dur, ...(dotOn ? { dot: true } : {}), rest: true }); }
  function toggleTie() {
    const e = target(); if (!e || e.rest) return toast('Pick a note to tie');
    pushUndo(); if (e.tie) delete e.tie; else e.tie = true; commit(); draw(); renderPad();
    if (e.tie) toast('Tied to the next note — give it the same pitch');
  }
  function accidental(alter) {
    const e = target(); if (!e || e.rest || !e.notes) return toast('Pick a note first');
    pushUndo();
    e.notes = e.notes.map(p => (alter === 'n' ? M.markNatural(p) : M.setAccidental(p, alter)));
    commit(); draw(); renderPad(); A.preview(e.notes.map(M.midiOf));
  }
  function step(dir) {
    const e = target(); if (!e || e.rest || !e.notes) return;
    pushUndo(); e.notes = e.notes.map(p => M.stepNote(p, dir, sc().keyFifths)); commit(); draw(); renderPad(); A.preview(e.notes.map(M.midiOf));
  }
  function octave(dir) {
    const e = target(); if (!e || e.rest || !e.notes) return;
    pushUndo(); e.notes = e.notes.map(p => { const q = M.parsePitch(p); return p.replace(/-?\d$/, String(q.oct + dir)); }); commit(); draw(); renderPad(); A.preview(e.notes.map(M.midiOf));
  }
  function del() {
    if (!sel) return;
    const pos = targetPos(); if (!pos) return;
    pushUndo(); M.removeEvent(sc(), pos.s, pos.m, pos.i);
    sel = { m: Math.min(pos.m, sc().measures.length - 1), s: pos.s, i: pos.i };
    fixSel(); commit(); draw(); renderPad();
  }
  function switchStaff(s) {
    if (!sel) sel = { m: 0, s, i: 0 };
    sel = { m: sel.m, s, i: Math.min(sel.i, evsAt(sel.m, s).length) };
    afterSelChange(false); scrollKeyboardTo(s === 't' ? 60 : 43);
  }
  function addBarAfter() {
    const m = sel ? sel.m : sc().measures.length - 1;
    pushUndo(); sc().measures.splice(m + 1, 0, { t: [], b: [] }); sel = { m: m + 1, s: sel ? sel.s : 't', i: 0 }; commit(); draw(); renderPad(); revealSel();
  }
  function deleteBar() {
    if (!sel) return;
    if (sc().measures.length === 1) { pushUndo(); sc().measures = [{ t: [], b: [] }]; }
    else { pushUndo(); sc().measures.splice(sel.m, 1); }
    sel = { m: Math.min(sel.m, sc().measures.length - 1), s: sel.s, i: 0 }; commit(); draw(); renderPad();
  }
  function setText(kind, val) {
    const e = selEvent(); if (!e) return;
    if (kind === 'chord' && val) val = val.charAt(0).toUpperCase() + val.slice(1);
    if (val) e[kind] = val; else delete e[kind];
    commit(); draw();
  }

  // ---------- tap the staff
  wrap.addEventListener('click', (ev) => {
    if (!layout) return;
    const r = wrap.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const g = ev.target.closest && ev.target.closest('.ev');
    if (mode !== 'edit') {
      if (g) { const e = evsAt(+g.dataset.m, g.dataset.s)[+g.dataset.i]; if (e && e.notes && !e.rest) A.preview(e.notes.map(M.midiOf)); }
      return;
    }
    if (g && chordMode) {
      sel = { m: +g.dataset.m, s: g.dataset.s, i: +g.dataset.i };
      const hit = layout.hits.find(q => q.m === sel.m && q.s === sel.s);
      if (hit) { keyPressed(M.midiOf(pitchAt(hit, y, sc().keyFifths))); return; }
    }
    if (g) { sel = { m: +g.dataset.m, s: g.dataset.s, i: +g.dataset.i }; const e = selEvent(); if (e && e.d) { dur = e.d; dotOn = !!e.dot; } afterSelChange(true); return; }
    // which staff/bar was tapped?
    let best = null, bestD = Infinity;
    for (const hit of layout.hits) {
      if (x < hit.x0 || x > hit.x1) continue;
      const cy = hit.top + 2 * hit.sp, d = Math.abs(y - cy);
      if (d < bestD && d < 7 * hit.sp) { best = hit; bestD = d; }
    }
    if (!best) { // tapped right of the last bar on a line: add to that bar
      for (const hit of layout.hits) {
        const cy = hit.top + 2 * hit.sp, d = Math.abs(y - cy);
        if (d < 7 * hit.sp && x > hit.x1 && (!best || hit.x1 > best.x1 || (hit.x1 === best.x1 && d < bestD))) { best = hit; bestD = d; }
      }
    }
    if (!best) return;
    const evs = evsAt(best.m, best.s);
    const near = best.xs.reduce((a, c) => (Math.abs(c.x - x) < Math.abs((a ? a.x : 1e9) - x) ? c : a), null);
    const pitch = pitchAt(best, y, sc().keyFifths);
    if (near && Math.abs(near.x - x) < 1.6 * best.sp) {
      sel = { m: best.m, s: best.s, i: near.i };
      if (chordMode) { keyPressed(M.midiOf(pitch)); return; }
      const e = selEvent(); if (e && e.d) { dur = e.d; dotOn = !!e.dot; }
      afterSelChange(true); return;
    }
    const lastX = best.xs.length ? best.xs[best.xs.length - 1].x : -1e9;
    if (x > lastX) {
      sel = { m: best.m, s: best.s, i: evs.length };
      if (full(best.m, best.s)) { sel = { m: best.m + 1, s: best.s, i: 0 }; ensureBar(best.m + 1); }
      keyPressed(M.midiOf(pitch));
    }
  });

  // ---------- edit panel
  let kb = null;
  function renderPad() {
    keypad.innerHTML = '';
    const open = mode === 'edit';
    screen.classList.toggle('kp-open', open);
    if (!open) return;
    const e = selEvent();
    const k = (label, fn, cls = '', title, on) => h('button', { type: 'button', class: 'k ' + cls + (on ? ' on' : ''), title: title || label, 'aria-label': title || label, 'aria-pressed': on == null ? null : String(!!on), onclick: (ev) => { ev.preventDefault(); fn(); } }, typeof label === 'string' && label.startsWith('<svg') ? h('span', { html: label }) : label);
    const s = sel ? sel.s : 't';
    const curDur = e ? e.d : dur, curDot = e ? !!e.dot : dotOn;
    const row1 = h('div', { class: 'kp-row scroll' },
      k(clefIcon('t'), () => switchStaff('t'), 'staff', 'Right hand (treble clef)', s === 't'),
      k(clefIcon('b'), () => switchStaff('b'), 'staff', 'Left hand (bass clef)', s === 'b'),
      h('span', { class: 'kp-gap' }),
      ...M.DUR_ORDER.map(d => k(durIcon(d), () => setDur(d), 'dur', M.DUR_NAME[d] + ' note', curDur === d)),
      k('•', toggleDot, 'dur dot', 'Dotted (half as long again)', curDot),
      k(durIcon(curDur, true), addRest, 'dur', 'Add a ' + M.DUR_NAME[curDur].toLowerCase() + ' rest'),
      h('span', { class: 'kp-gap' }),
      k('♯', () => accidental(1), 'acc', 'Sharp'), k('♭', () => accidental(-1), 'acc', 'Flat'), k('♮', () => accidental('n'), 'acc', 'Natural'),
      k('‿', toggleTie, 'acc', 'Tie to the next note', target() && target().tie),
      k('+ Chord', () => { chordMode = !chordMode; renderPad(); toast(chordMode ? 'Chord mode: keys add notes to the selected chord' : 'Chord mode off'); }, 'op', 'Stack notes into a chord', chordMode),
      k('Insert', () => { insertMode = !insertMode; renderPad(); toast(insertMode ? 'Insert: new notes go before the selected one' : 'Overwrite: new notes replace the selected one'); }, 'op', 'Insert instead of replacing', insertMode),
      h('span', { class: 'kp-gap' }),
      k('◀', () => moveSel(-1), 'nav', 'Previous'), k('▶', () => moveSel(1), 'nav', 'Next'),
      k('▲', () => step(1), 'nav', 'Up a step'), k('▼', () => step(-1), 'nav', 'Down a step'),
      k('8va', () => octave(1), 'op', 'Up an octave'), k('8vb', () => octave(-1), 'op', 'Down an octave'),
      k('⌫', del, 'op', 'Delete note'),
      k('− Bar', deleteBar, 'op', 'Delete this bar'),
      k('Done', () => setMode('view'), 'done'));
    const lyr = h('input', { class: 'kp-lyric', value: (e && e.lyric) || '', placeholder: e ? 'Lyric (Enter → next note)' : 'Select a note to add a lyric', disabled: !e, enterkeyhint: 'next',
      onfocus: pushUndo, oninput: (ev) => setText('lyric', ev.target.value.trim()),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); nextNoteForText(ev.shiftKey ? -1 : 1, 'lyric'); } } });
    const chd = h('input', { class: 'kp-lyric kp-chord', value: (e && e.chord) || '', placeholder: 'Chord (e.g. Am7)', disabled: !e, autocapitalize: 'characters', enterkeyhint: 'done',
      onfocus: pushUndo, oninput: (ev) => setText('chord', ev.target.value.trim()),
      onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } } });
    const row2 = h('div', { class: 'kp-row' }, lyr, chd);
    kb = keyboard(e && !e.rest && e.notes ? e.notes.map(M.midiOf) : []);
    keypad.append(row1, row2, kb.el);
    requestAnimationFrame(() => { screen.style.setProperty('--padh', keypad.offsetHeight + 'px'); if (kb.first) { scrollKeyboardTo(s === 't' ? 60 : 43, true); kb.first = false; } });
  }
  function nextNoteForText(d, kind) {
    moveSel(d);
    // keep typing lyrics without re-tapping
    const inp = keypad.querySelector(kind === 'lyric' ? '.kp-lyric:not(.kp-chord)' : '.kp-chord');
    if (inp && !inp.disabled) { inp.focus(); inp.select && inp.select(); }
  }
  let kbScroll = null;
  function keyboard(lit) {
    const el = h('div', { class: 'piano-kb', role: 'group', 'aria-label': 'Piano keyboard' });
    const inner = h('div', { class: 'pk-inner' });
    let wi = 0;
    const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
    for (let m = KB_LO; m <= KB_HI; m++) {
      const black = isBlack(m);
      const key = h('button', { type: 'button', class: 'pk ' + (black ? 'black' : 'white') + (lit.includes(m) ? ' lit' : '') + (m === 60 ? ' mid' : ''), 'aria-label': M.spell(m, sc().keyFifths).replace(/(\d)$/, ' $1'),
        style: black ? { left: `calc(${wi} * var(--wk) - var(--bk) / 2)` } : {},
        onpointerdown: (ev) => { ev.preventDefault(); key.classList.add('down'); keyPressed(m); },
        onpointerup: () => key.classList.remove('down'), onpointerleave: () => key.classList.remove('down') },
        !black && m % 12 === 0 ? h('span', { class: 'pk-lab' }, 'C' + (m / 12 - 1)) : null);
      inner.append(key);
      if (!black) wi++;
    }
    inner.style.setProperty('--n', wi);
    el.append(inner);
    if (kbScroll != null) requestAnimationFrame(() => { el.scrollLeft = kbScroll; });
    el.addEventListener('scroll', () => { kbScroll = el.scrollLeft; }, { passive: true });
    return { el, first: kbScroll == null };
  }
  function scrollKeyboardTo(midi, instant) {
    const el = keypad.querySelector('.piano-kb'); if (!el) return;
    const keyEl = [...el.querySelectorAll('.pk.white')][Math.round((midi - KB_LO) * 7 / 12)];
    if (!keyEl) return;
    const left = keyEl.offsetLeft - el.clientWidth / 2 + keyEl.offsetWidth * 3;
    el.scrollTo({ left: Math.max(0, left), behavior: instant ? 'auto' : 'smooth' });
  }

  // hardware keyboard: letters A–G place notes, arrows move, ↑↓ step, Backspace deletes
  const onKey = (e) => {
    if (mode !== 'edit') { if (e.key === ' ' && !e.target.closest('input,textarea')) { e.preventDefault(); togglePlay(); } return; }
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    const key = e.key;
    if (/^[a-g]$/i.test(key) && !e.metaKey && !e.ctrlKey) {
      const s = sel ? sel.s : 't', step = key.toUpperCase();
      const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + (M.keyAlters(sc().keyFifths)[step] || 0);
      let best = null; for (let m = lastMidi[s] - 6; m <= lastMidi[s] + 6; m++) if (((m % 12) + 12) % 12 === ((pc % 12) + 12) % 12) { best = m; break; }
      if (best != null) keyPressed(best);
      e.preventDefault(); return;
    }
    const durKeys = { 1: '16', 2: '8', 3: 'q', 4: 'h', 5: 'w' };
    if (durKeys[key]) { setDur(durKeys[key]); e.preventDefault(); return; }
    if (key === '.') { toggleDot(); e.preventDefault(); return; }
    if (key === '0' || key === 'r') { addRest(); e.preventDefault(); return; }
    if (key === 'ArrowLeft') { moveSel(-1); e.preventDefault(); return; }
    if (key === 'ArrowRight') { moveSel(1); e.preventDefault(); return; }
    if (key === 'ArrowUp') { e.shiftKey || e.metaKey ? octave(1) : step(1); e.preventDefault(); return; }
    if (key === 'ArrowDown') { e.shiftKey || e.metaKey ? octave(-1) : step(-1); e.preventDefault(); return; }
    if (key === 'Backspace' || key === 'Delete') { del(); e.preventDefault(); return; }
    if (key === '#' || key === '+') { accidental(1); e.preventDefault(); return; }
    if (key === '-') { accidental(-1); e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && key === 'z') { e.shiftKey ? doRedo() : doUndo(); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- modes
  function setMode(m) {
    stopPlay();
    mode = m;
    if (m === 'edit') { sel = sel || { m: 0, s: 't', i: 0 }; }
    else { sel = null; M.trimEmptyEnd(sc()); commit(); }
    const was = editPause; editPause = mode === 'edit';
    if (was !== editPause) { updateTimer(); toast(editPause ? '⏸ Practice timer paused while editing' : '▶ Practice timer running'); }
    screen.classList.toggle('editing', mode === 'edit');
    renderMeta(); draw(); buildBar(); renderPad();
    if (m === 'edit' && !sc().measures.some(x => x.t.length || x.b.length)) toast('Tap a piano key (or tap the staff) to add notes', 3500);
  }

  // ---------- playback
  function togglePlay() { player ? stopPlay() : startPlay(); }
  function startPlay() {
    const s = sc();
    if (!s.measures.some(x => x.t.length || x.b.length)) return toast('Add some notes first');
    let from = 0;
    if (sel) from = sel.m * M.capacity(s);
    wrap.classList.add('is-playing');
    player = A.play(s, song.bpm || 80, from, (refs) => {
      wrap.querySelectorAll('.ev.playing').forEach(x => x.classList.remove('playing'));
      let first = null;
      for (const r of refs) { const el = wrap.querySelector(`.ev[data-m="${r.m}"][data-s="${r.s}"][data-i="${r.i}"]`); if (el) { el.classList.add('playing'); first = first || el; } }
      if (first) {
        const rr = first.getBoundingClientRect(), limit = (mode === 'edit' ? keypad.getBoundingClientRect().top : window.innerHeight) * 0.72;
        if (rr.top > limit || rr.top < 40) scroll.scrollBy({ top: rr.top - 120, behavior: 'smooth' });
      }
    }, () => { stopPlay(); });
    playing = true; buildBar();
  }
  let playing = false;
  function stopPlay() {
    if (player) { player.stop(); player = null; }
    playing = false;
    wrap.classList.remove('is-playing');
    wrap.querySelectorAll('.ev.playing').forEach(x => x.classList.remove('playing'));
    buildBar();
  }

  // ---------- transpose / settings
  function transposeBy(semis) {
    stopPlay(); pushUndo();
    M.transposeScore(sc(), semis);
    const flats = sc().keyFifths < 0;
    for (const m of sc().measures) for (const st of ['t', 'b']) for (const e of m[st]) if (e.chord) e.chord = transposeChord(e.chord, semis, flats);
    commit(); draw(); buildBar(); renderMeta(); renderPad();
    toast(`Now in ${M.KEY_NAMES[sc().keyFifths]} major`);
  }
  function scoreSettings() {
    const title = h('input', { value: song.title, placeholder: 'Song title' });
    const artist = h('input', { value: song.artist, placeholder: 'Artist / composer' });
    const keySel = h('select', {}, Object.keys(M.KEY_NAMES).map(Number).sort((a, b) => a - b).map(f => h('option', { value: f, selected: sc().keyFifths === f },
      `${M.KEY_NAMES[f]} major / ${M.KEY_MINOR[f]}  (${f === 0 ? 'no sharps or flats' : Math.abs(f) + (f > 0 ? ' sharp' : ' flat') + (Math.abs(f) > 1 ? 's' : '')})`)));
    const keyMode = h('select', {}, h('option', { value: 'move' }, 'Move the notes too (transpose)'), h('option', { value: 'keep' }, 'Keep the notes, just change the signature'));
    const timeSel = h('select', {}, TIMES.map(([a, b]) => h('option', { value: `${a}/${b}`, selected: sc().time[0] === a && sc().time[1] === b }, `${a}/${b}`)));
    const bpmIn = h('input', { type: 'number', inputmode: 'numeric', min: 30, max: 240, value: song.bpm || 80 });
    const notes = h('textarea', { rows: 3, placeholder: 'Notes to self (fingering, pedalling, feel…)' }, song.notes || '');
    const body = h('div', { class: 'form' },
      field('Title', title), field('Artist', artist),
      h('div', { class: 'row2' }, field('Key signature', keySel), field('When the key changes', keyMode)),
      h('div', { class: 'row2' }, field('Time signature', timeSel, 'Bars are re-filled to fit'), field('Tempo (BPM)', bpmIn, 'Quarter-note beats per minute')),
      field('Notes', notes),
      h('div', { class: 'row between' },
        btn('Delete song', async () => { if (await confirmBox(`Delete "${song.title}"? This can't be undone.`)) { s.close(); stopPlay(); S.deleteSong(song.id); nav('#/'); } }, { cls: 'danger ghost', icon: 'trash' }),
        btn('Save', () => {
          pushUndo();
          song.title = title.value.trim() || 'Untitled'; song.artist = artist.value.trim(); song.notes = notes.value;
          const f = +keySel.value;
          if (f !== sc().keyFifths) {
            if (keyMode.value === 'move') {
              // shortest move to the new key
              let semis = ((f - sc().keyFifths) * 7 % 12 + 12) % 12; if (semis > 6) semis -= 12;
              M.transposeScore(sc(), semis); sc().keyFifths = f;
              const flats = f < 0;
              for (const m of sc().measures) for (const st of ['t', 'b']) for (const e of m[st]) {
                if (e.notes) e.notes = e.notes.map(p => M.spell(M.midiOf(p), f));
                if (e.chord) e.chord = transposeChord(e.chord, semis, flats);
              }
            } else {
              sc().keyFifths = f;
              for (const m of sc().measures) for (const st of ['t', 'b']) for (const e of m[st]) if (e.notes) e.notes = e.notes.map(p => p.replace(/^([A-G])n/, '$1'));
            }
          }
          const [a, b] = timeSel.value.split('/').map(Number);
          if (a !== sc().time[0] || b !== sc().time[1]) M.rebar(sc(), [a, b]);
          { const v = Math.round(+bpmIn.value); song.bpm = v >= 30 && v <= 240 ? v : 80; }
          song.key = M.KEY_NAMES[sc().keyFifths];
          commit(); s.close(); fixSel(); renderMeta(); draw(); buildBar(); renderPad();
        }, { cls: 'primary', icon: 'check' })));
    const s = sheet('Score settings', body);
  }
  function goPl(d) {
    if (!playlist) return;
    const j = plIndex + d;
    if (j < 0) return toast('First song in the playlist');
    if (j >= playlist.songIds.length) return toast('That was the last song 🎹');
    nav(`#/song/${playlist.songIds[j]}?pl=${playlist.id}`);
  }

  // ---------- practice timer (counts while reading/playing, pauses while editing)
  let paused = false, pending = 0, editPause = mode === 'edit';
  const goal = () => (S.db.settings.goal || 30) * 60;
  timerPill.onclick = (e) => { e.stopPropagation(); if (editPause) return toast('The timer restarts when you tap Done'); paused = !paused; updateTimer(); toast(paused ? 'Practice timer paused' : 'Practice timer running'); };
  function updateTimer() {
    const secs = S.practiceOn(S.dayKey()) + pending, g = goal(), pct = Math.min(1, secs / g);
    const mm = Math.floor(secs / 60), ss = String(Math.floor(secs % 60)).padStart(2, '0');
    timerPill.innerHTML = '';
    timerPill.append(h('span', { class: 'ring', style: { '--p': pct } }), h('span', {}, editPause ? 'Editing ⏸' : paused ? 'Paused' : `${mm}:${ss}`), h('span', { class: 'goal' }, `/ ${S.db.settings.goal || 30}m`));
    timerPill.classList.toggle('met', secs >= g); handle.classList.toggle('met', secs >= g); handle.style.setProperty('--p', pct);
  }
  const tick = setInterval(() => {
    if (paused || (editPause && !playing) || document.visibilityState !== 'visible') return;
    const before = S.practiceOn(S.dayKey()) + pending;
    pending++;
    if (pending >= 10) { S.addPractice(pending); pending = 0; }
    const after = S.practiceOn(S.dayKey()) + pending;
    if (before < goal() && after >= goal()) celebrate();
    if (screen.classList.contains('bar-open') || pending % 5 === 0) updateTimer();
  }, 1000);
  function celebrate() {
    const k = S.dayKey(), cel = { ...(S.db.settings.celebrated || {}) };
    if (cel[k]) return;
    cel[k] = true;
    for (const d of Object.keys(cel)) if (d < S.dayKey(new Date(Date.now() - 40 * 864e5))) delete cel[d];
    S.setSetting('celebrated', cel);
    const e = emojiRain();
    toast(`${e} Daily goal reached — ${S.db.settings.goal || 30} minutes! ${e}`, 4500);
  }

  // re-flow on rotate / resize
  let rz = null, lastW = 0;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (Math.abs(scroll.clientWidth - lastW) > 4) { lastW = scroll.clientWidth; draw(); } }, 120); };
  window.addEventListener('resize', onResize);
  // live sync updates from the other device
  const offChange = S.onChange((kind) => { if (kind === 'sync' && !player) { if (!song.score) song.score = M.newScore(); fixSel(); renderMeta(); draw(); } });

  // ---------- go
  screen.classList.toggle('editing', mode === 'edit');
  if (S.pref('barPinned', false)) screen.classList.add('bar-open');
  topColor(); buildBar(); renderMeta(); draw(); renderPad();
  lastW = scroll.clientWidth;
  if (mode === 'edit' && !sc().measures.some(x => x.t.length || x.b.length)) toast('Tap a piano key (or tap the staff) to add notes', 3500);
  requestAnimationFrame(() => scroll.focus({ preventScroll: true }));

  return () => {
    if (pending) S.addPractice(pending);
    stopPlay();
    clearInterval(tick);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    offChange();
    document.documentElement.classList.remove('stage');
  };
}
