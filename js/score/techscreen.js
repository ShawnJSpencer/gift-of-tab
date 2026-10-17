// Tech tab screen: tab with rhythm, time & key signatures and optional standard notation.
import { h, icon, btn, sheet, toast, confirmBox, field } from '../ui.js';
import * as S from '../store.js';
import * as V from '../versions.js';
import { emojiRain } from '../art.js';
import { tuningPicker } from '../pickers.js';
import * as M from './model.js';
import { renderTech, stringAt } from './techrender.js';
import { newTech, pitchesOf, fretOf } from './tech.js';
import * as A from './audio.js';
import { G } from './glyphs.js';

const TIMES = [[4, 4], [3, 4], [2, 4], [6, 8], [2, 2], [5, 4], [3, 8], [9, 8], [12, 8]];
const TECH = ['h', 'p', '/', '\\', 'b', 'r', '~', 'x', '( )', '<>', 'PM'];
const TECH_HELP = { h: 'Hammer-on (to the next note)', p: 'Pull-off (to the next note)', '/': 'Slide up', '\\': 'Slide down', b: 'Bend', r: 'Release', '~': 'Vibrato', x: 'Muted / dead note', '( )': 'Ghost note', '<>': 'Harmonic', PM: 'Palm mute' };
const INST = { guitar: '🎸 Guitar', ukulele: '🪕 Ukulele' };

function gl(name, x, yTop, hgt, flip) {
  const [x0, y0, x1, y1] = G[name].b, s = hgt / (y1 - y0);
  return flip ? `<path transform="translate(${x - x0 * s},${yTop - y0 * s}) scale(${s},${s})" d="${G[name].d}"/>`
    : `<path transform="translate(${x - x0 * s},${yTop + y1 * s}) scale(${s},${-s})" d="${G[name].d}"/>`;
}
// rhythm-style duration icons (stems down, like under the tab)
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

export function techScreen(root, songId, ctx = {}, nav) {
  const song = S.getSong(songId);
  if (!song) { root.append(h('div', { class: 'empty-state' }, 'That song could not be found.', btn('Home', () => nav('#/'), { cls: 'primary' }))); return () => {}; }
  if (!song.tech) song.tech = newTech();
  const sc = () => song.tech;
  const nStr = () => song.tuning.length;

  let mode = ctx.edit ? 'edit' : 'view';
  let sel = mode === 'edit' ? { m: 0, s: 'g', i: 0, str: nStr() - 1 } : null;
  let dur = 'q', dotOn = false;
  let undo = [], redo = [];
  let player = null, playing = false, layout = null;
  const playlist = ctx.pl ? S.db.playlists[ctx.pl] : null;
  const plIndex = playlist ? playlist.songIds.indexOf(songId) : -1;

  const scroll = h('div', { class: 'song-scroll score-scroll', tabindex: '-1' });
  const topbar = h('div', { class: 'topbar', role: 'toolbar' });
  const handle = h('button', { class: 'menu-handle', 'aria-label': 'Show menu', type: 'button', onclick: (e) => { e.stopPropagation(); toggleBar(); } }, h('span', { class: 'pick-dot', html: '<svg viewBox="0 0 24 26"><path d="M12 25C7 21 1 13 1.5 7 2 3 6 1.5 12 1.5S22 3 22.5 7C23 13 17 21 12 25z"/></svg>' }));
  const keypad = h('div', { class: 'keypad score-pad' });
  const screen = h('div', { class: 'song-screen score-screen tech-screen' }, scroll, handle, topbar, keypad);
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
  const spPx = () => S.pref('techsp', window.innerWidth < 600 ? 8 : 10);
  function buildBar() {
    topbar.innerHTML = '';
    const tb = (label, ico, fn, title, cls = '') => h('button', { class: 'tb ' + cls, type: 'button', title: title || label, 'aria-label': title || label, onclick: (e) => { e.stopPropagation(); fn(e); } }, ico ? icon(ico) : null, label ? h('span', {}, label) : null);
    const sep = () => h('span', { class: 'tb-sep' });
    const items = [
      tb('', 'menu', () => window.openDrawer(), 'Menu'),
      tb('', 'home', () => nav('#/'), 'Home'),
      sep(),
      mode === 'view' ? tb('Edit', 'edit', () => setMode('edit'), 'Edit this tab', 'accent') : tb('Done', 'check', () => setMode('view'), 'Finish editing', 'accent'),
      tb(player ? 'Stop' : 'Play', player ? 'pause' : 'play', togglePlay, player ? 'Stop playback' : 'Play the tab', 'play-btn'),
    ];
    if (playlist) items.push(sep(),
      tb('', 'back', () => goPl(-1), 'Previous song in playlist'),
      h('span', { class: 'tb-label' }, `${plIndex + 1}/${playlist.songIds.length}`),
      tb('', 'next', () => goPl(1), 'Next song in playlist'));
    if (mode === 'edit') items.push(sep(), tb('Undo', '', doUndo, 'Undo'), tb('Redo', '', doRedo, 'Redo'), tb('Bar', 'plus', addBarAfter, 'Add an empty bar after this one'));
    items.push(sep(),
      tb('', 'minus', () => tempo(-4), 'Slower'), h('span', { class: 'tb-label' }, `♩=${song.bpm || 90}`), tb('', 'plus', () => tempo(4), 'Faster'),
      sep(),
      tb('', 'minus', () => zoom(-1), 'Smaller'), h('span', { class: 'tb-label' }, 'Aa'), tb('', 'plus', () => zoom(1), 'Bigger'),
      sep(),
      tb(sc().notation !== false ? 'Notes on' : 'Notes off', 'music', toggleNotation, 'Show or hide the standard notation staff'),
      tb(S.pref('stage') ? 'Day' : 'Stage', 'moon', () => { S.setPref('stage', !S.pref('stage')); applyStage(); buildBar(); topColor(); }, 'Stage (dark) mode'),
      tb('Tab', 'gear', techSettings, 'Title, tuning, capo, key, time signature, tempo'),
      sep(), timerPill);
    topbar.append(...items);
    updateTimer();
  }
  function zoom(d) { S.setPref('techsp', Math.max(5, Math.min(18, spPx() + d))); draw(); }
  function tempo(d) { song.bpm = Math.max(30, Math.min(260, (song.bpm || 90) + d)); S.touchSong(song); buildBar(); renderMeta(); }
  function toggleNotation() { sc().notation = sc().notation === false; S.touchSong(song); draw(); buildBar(); }

  // ---------- header
  const stageName = () => (S.db.settings.stageName || 'Olden Gray').trim() || 'Olden Gray';
  const head = h('header', { class: 'song-head' });
  const meta = h('div', { class: 'meta-line' });
  function renderMeta() {
    head.innerHTML = '';
    head.append(h('h1', { class: 'song-title' }, song.title || 'Untitled'));
    if (song.artist) head.append(h('div', { class: 'song-artist' }, song.artist));
    head.onclick = mode === 'edit' ? techSettings : null;
    meta.innerHTML = '';
    const mine = V.isMine(song);
    if (song.capo) meta.append(h('span', { class: 'capo' }, `Capo ${song.capo}`));
    meta.append(
      h('span', { class: 'tuning' }, `${INST[song.instrument] || ''} · Tech tab · ${song.tuningName && song.tuningName !== 'Custom' ? song.tuningName + ' · ' : ''}${song.tuning.join(' ')}`),
      h('span', { class: 'key-chip' }, 'Key ', h('b', {}, `${M.KEY_NAMES[sc().keyFifths]}`), h('span', { class: 'key-to' }, ` / ${M.KEY_MINOR[sc().keyFifths]}`)),
      h('span', { class: 'key-chip' }, h('b', {}, `${sc().time[0]}/${sc().time[1]}`)),
      h('button', { type: 'button', class: 'bpm-chip', title: 'Tempo', onclick: (e) => { e.stopPropagation(); techSettings(); } }, h('span', {}, h('b', {}, song.bpm || 90), ' BPM')),
      h('button', { type: 'button', class: 'stage-badge' + (mine ? ' on' : ''), title: mine ? 'Back to the original' : `Show your ${stageName()} version`, 'aria-pressed': mine ? 'true' : 'false',
        onclick: (e) => { e.stopPropagation(); switchMine(!mine); } },
        h('span', { class: 'sb-star', html: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.4 6.4 19.7l1.5-6.3L3 9.1l6.4-.6z"/></svg>' }),
        h('span', { class: 'sb-name' }, stageName()), mine ? h('span', { class: 'sb-sub' }, 'my version') : null));
  }
  function switchMine(mine) {
    stopPlay();
    const made = V.switchVersion(song, song.instrument, mine);
    if (!song.tech) song.tech = newTech();
    S.touchSong(song); undo = []; redo = [];
    if (sel) sel = { m: 0, s: 'g', i: 0, str: nStr() - 1 };
    renderMeta(); draw(); buildBar(); renderPad();
    if (made === 'created') toast(`⭐ Made your ${stageName()} version — change anything, the original stays safe`, 3800);
  }

  // ---------- drawing
  const foot = h('div', {});
  scroll.append(head, meta, wrap, foot, h('div', { class: 'scroll-pad' }));
  function draw() {
    if (mode === 'edit' && sel) ensureBar(sel.m);
    layout = renderTech(sc(), song, { width: Math.max(260, scroll.clientWidth - 28), sp: spPx(), sel: mode === 'edit' ? sel : null });
    wrap.innerHTML = layout.svg;
    foot.innerHTML = '';
    const empty = !sc().measures.some(m => m.g.length);
    if (empty && mode === 'view') foot.append(h('div', { class: 'score-empty' }, 'No notes yet. ', btn('Start writing', () => setMode('edit'), { cls: 'primary', icon: 'edit' })));
    if (playlist && mode === 'view') {
      const nextId = playlist.songIds[plIndex + 1], nextSong = nextId && S.getSong(nextId);
      foot.append(h('div', { class: 'pl-foot' }, nextSong ? btn(`Next: ${nextSong.title}`, () => goPl(1), { cls: 'primary big', icon: 'next' }) : h('div', { class: 'pl-done' }, '🎸 End of ', h('b', {}, playlist.name))));
    }
  }
  function ensureBar(m) { while (sc().measures.length <= m) sc().measures.push({ g: [] }); }

  // ---------- selection
  const evs = (m) => (sc().measures[m] ? sc().measures[m].g : []);
  const selEvent = () => (sel && evs(sel.m)[sel.i]) || null;
  const full = (m) => M.filled(evs(m)) >= M.capacity(sc());
  function moveSel(d) {
    if (!sel) return;
    let { m, i } = sel;
    if (d > 0) {
      if (i < evs(m).length) { i++; if (i >= evs(m).length && full(m)) { m++; i = 0; ensureBar(m); } }
      else if (m < sc().measures.length - 1) { m++; i = 0; }
    } else if (i > 0) i--;
    else if (m > 0) { m--; i = Math.max(0, full(m) ? evs(m).length - 1 : evs(m).length); }
    sel = { ...sel, m, i }; afterSel(true);
  }
  function moveString(d) { if (!sel) return; sel.str = Math.max(0, Math.min(nStr() - 1, (sel.str ?? 0) + d)); afterSel(false); }
  function afterSel(sound) {
    draw(); renderPad();
    const e = selEvent();
    if (sound && e) A.preview(pitchesOf(e, song), 'pluck');
    reveal();
  }
  function reveal() {
    const el = wrap.querySelector('.strsel, .caret, .ev.sel'); if (!el) return;
    const r = el.getBoundingClientRect(), padTop = mode === 'edit' ? keypad.getBoundingClientRect().top : window.innerHeight, sr = scroll.getBoundingClientRect();
    if (r.bottom > padTop - 30) scroll.scrollTop += r.bottom - padTop + 90;
    else if (r.top < sr.top + 60) scroll.scrollTop -= sr.top + 120 - r.top;
  }

  // ---------- edits
  const snapshot = () => JSON.stringify(sc());
  function pushUndo() { undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo = []; }
  const commit = () => S.touchSong(song);
  function fixSel() { if (!sel) return; sel.m = Math.min(sel.m, sc().measures.length - 1); sel.i = Math.min(sel.i, evs(sel.m).length); sel.str = Math.min(sel.str ?? 0, nStr() - 1); }
  function doUndo() { if (!undo.length) return toast('Nothing to undo'); redo.push(snapshot()); song.tech = JSON.parse(undo.pop()); fixSel(); commit(); draw(); renderPad(); buildBar(); renderMeta(); }
  function doRedo() { if (!redo.length) return toast('Nothing to redo'); undo.push(snapshot()); song.tech = JSON.parse(redo.pop()); fixSel(); commit(); draw(); renderPad(); buildBar(); renderMeta(); }
  const blankCells = () => new Array(nStr()).fill('');

  // the beat under the cursor, creating one at the insertion point if needed
  function beatForWriting() {
    let e = selEvent();
    if (e) { if (e.rest) { delete e.rest; e.n = blankCells(); } if (!e.n) e.n = blankCells(); return e; }
    e = { d: dur, ...(dotOn ? { dot: true } : {}), n: blankCells() };
    const pos = M.insertEvent(sc(), 'g', sel.m, sel.i, e);
    sel = { ...sel, m: pos.m, i: pos.i };
    return e;
  }
  function setCell(v) {
    if (!sel) return;
    if (!v && !selEvent()) return;
    pushUndo();
    const e = beatForWriting();
    e.n[sel.str] = v;
    if (!e.n.some(Boolean) && !e.chord && !e.lyric) { e.n = blankCells(); }
    commit(); draw(); renderPad();
    const f = fretOf(v);
    if (f != null) A.preview([pitchesOf({ n: e.n.map((c, s) => (s === sel.str ? c : '')) }, song)[0]].filter(x => x != null), 'pluck');
  }
  function curCell() { const e = selEvent(); return (e && e.n && e.n[sel.str]) || ''; }
  function setFret(f) {
    const cur = curCell();
    setCell(/[hp\/\\brs]$/.test(cur) ? cur + f : cur === '()' ? `(${f})` : cur === '<>' ? `<${f}>` : cur === 'PM' ? 'PM' + f : String(f));
  }
  function tech(t) {
    const cur = curCell();
    if (t === 'x') return setCell('x');
    if (t === '( )') return setCell(cur && cur !== '()' ? `(${cur.replace(/[()]/g, '')})` : '()');
    if (t === '<>') return setCell(cur && cur !== '<>' ? `<${cur.replace(/[<>]/g, '')}>` : '<>');
    if (t === 'PM') return setCell(cur.startsWith('PM') ? cur.slice(2) : 'PM' + cur);
    if (!cur) return toast('Type the fret first, then the technique');
    setCell(/[hp\/\\brs~]$/.test(cur) ? cur.slice(0, -1) + t : cur + t);
  }
  function reTime(change) {
    const e = selEvent(); if (!e) return false;
    pushUndo();
    const copy = { ...e }; change(copy);
    evs(sel.m).splice(sel.i, 1);
    const at = M.insertEvent(sc(), 'g', sel.m, sel.i, copy);
    sel = { ...sel, m: at.m, i: at.i }; commit(); draw(); return true;
  }
  function setDur(d) { dur = d; reTime(c => { c.d = d; }); renderPad(); }
  function toggleDot() { if (!reTime(c => { if (c.dot) delete c.dot; else c.dot = true; dotOn = !!c.dot; })) dotOn = !dotOn; renderPad(); }
  function rest() {
    if (!sel) return;
    const e = selEvent();
    pushUndo();
    if (e) { if (e.rest) { delete e.rest; e.n = blankCells(); } else { e.rest = true; delete e.n; delete e.tie; } }
    else { const pos = M.insertEvent(sc(), 'g', sel.m, sel.i, { d: dur, ...(dotOn ? { dot: true } : {}), rest: true }); sel = { ...sel, m: pos.m, i: pos.i + 1 }; if (sel.i >= evs(sel.m).length && full(sel.m)) { sel.m++; sel.i = 0; ensureBar(sel.m); } }
    commit(); draw(); renderPad();
  }
  function toggleTie() {
    const e = selEvent(); if (!e || e.rest) return toast('Pick a beat with notes to tie');
    pushUndo(); if (e.tie) delete e.tie; else e.tie = true; commit(); draw(); renderPad();
    if (e.tie) toast('Tied into the next beat — it shows in brackets and isn’t picked again');
  }
  function insertBeat() {
    if (!sel) return;
    pushUndo();
    const pos = M.insertEvent(sc(), 'g', sel.m, Math.min(sel.i, evs(sel.m).length), { d: dur, ...(dotOn ? { dot: true } : {}), rest: true });
    sel = { ...sel, m: pos.m, i: pos.i }; commit(); draw(); renderPad();
  }
  function deleteBeat() {
    if (!sel) return;
    let { m, i } = sel;
    if (!evs(m)[i]) { if (i > 0) i--; else return; }
    pushUndo(); M.removeEvent(sc(), 'g', m, i);
    sel = { ...sel, m: Math.min(m, sc().measures.length - 1), i }; fixSel(); commit(); draw(); renderPad();
  }
  function addBarAfter() {
    const m = sel ? sel.m : sc().measures.length - 1;
    pushUndo(); sc().measures.splice(m + 1, 0, { g: [] }); sel = { m: m + 1, s: 'g', i: 0, str: sel ? sel.str : 0 }; commit(); draw(); renderPad(); reveal();
  }
  function deleteBar() {
    if (!sel) return;
    pushUndo();
    if (sc().measures.length === 1) sc().measures = [{ g: [] }]; else sc().measures.splice(sel.m, 1);
    sel = { ...sel, m: Math.min(sel.m, sc().measures.length - 1), i: 0 }; commit(); draw(); renderPad();
  }
  function setText(kind, val) {
    const e = selEvent(); if (!e) return;
    if (kind === 'chord' && val) val = val.charAt(0).toUpperCase() + val.slice(1);
    if (val) e[kind] = val; else delete e[kind];
    commit(); draw();
  }

  // ---------- taps
  wrap.addEventListener('click', (ev) => {
    if (!layout) return;
    const r = wrap.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const g = ev.target.closest && ev.target.closest('.ev');
    if (mode !== 'edit') {
      if (g) { const e = evs(+g.dataset.m)[+g.dataset.i]; if (e) A.preview(pitchesOf(e, song), 'pluck'); }
      return;
    }
    let best = null, bestD = Infinity;
    for (const hit of layout.hits) {
      if (y < hit.top - 3 * hit.sp || y > hit.rBottom + 1.5 * hit.sp) continue;
      const d = x < hit.x0 ? hit.x0 - x : x > hit.x1 ? x - hit.x1 : 0;
      if (d < bestD) { best = hit; bestD = d; }
    }
    if (!best) return;
    const str = stringAt(best, y);
    let i;
    if (g && +g.dataset.m === best.m) i = +g.dataset.i;
    else {
      const near = best.xs.reduce((a, c) => (!a || Math.abs(c.x - x) < Math.abs(a.x - x) ? c : a), null);
      const lastX = best.xs.length ? best.xs[best.xs.length - 1].x : -1e9;
      if (near && Math.abs(near.x - x) < 1.4 * best.sp) i = near.i;
      else if (x > lastX) i = evs(best.m).length;
      else i = near ? near.i : 0;
    }
    let m = best.m;
    if (i >= evs(m).length && full(m)) { m++; i = 0; ensureBar(m); }
    sel = { m, s: 'g', i, str: str ?? (sel ? sel.str : 0) };
    const e = selEvent(); if (e) { dur = e.d; dotOn = !!e.dot; }
    afterSel(true);
  });

  // ---------- keypad
  function renderPad() {
    keypad.innerHTML = '';
    const open = mode === 'edit';
    screen.classList.toggle('kp-open', open);
    if (!open) return;
    const e = selEvent();
    const k = (label, fn, cls = '', title, on) => h('button', { type: 'button', class: 'k ' + cls + (on ? ' on' : ''), title: title || label, 'aria-label': title || label, 'aria-pressed': on == null ? null : String(!!on), onclick: (ev) => { ev.preventDefault(); fn(); } }, typeof label === 'string' && label.startsWith('<svg') ? h('span', { html: label }) : label);
    const curDur = e ? e.d : dur, curDot = e ? !!e.dot : dotOn;
    const frets = [];
    for (let f = 0; f <= 24; f++) frets.push(k(String(f), () => setFret(f), 'num'));
    const row1 = h('div', { class: 'kp-row scroll' },
      ...M.DUR_ORDER.map(d => k(durIcon(d), () => setDur(d), 'dur', M.DUR_NAME[d] + ' note', curDur === d)),
      k('•', toggleDot, 'dur dot', 'Dotted (half as long again)', curDot),
      k(durIcon(curDur, true), rest, 'dur', e && e.rest ? 'Turn the rest back into a beat' : 'Rest', e && e.rest),
      k('‿', toggleTie, 'acc', 'Tie into the next beat', e && e.tie),
      h('span', { class: 'kp-gap' }),
      k('◀', () => moveSel(-1), 'nav', 'Previous beat'), k('▲', () => moveString(1), 'nav', 'String above'), k('▼', () => moveString(-1), 'nav', 'String below'), k('▶', () => moveSel(1), 'nav', 'Next beat'),
      h('span', { class: 'kp-gap' }),
      k('+ Beat', insertBeat, 'op', 'Insert a beat here'), k('− Beat', deleteBeat, 'op', 'Delete this beat'), k('− Bar', deleteBar, 'op', 'Delete this bar'),
      k('Done', () => setMode('view'), 'done'));
    const row2 = h('div', { class: 'kp-row scroll' }, k('⌫', () => setCell(''), 'op', 'Clear this string'), ...frets, ...TECH.map(t => k(t, () => tech(t), 'tech', TECH_HELP[t])));
    const inp = (cls, kind, ph) => h('input', { class: 'kp-lyric ' + cls, value: (e && e[kind]) || '', placeholder: e ? ph : 'Select a beat first', disabled: !e, enterkeyhint: kind === 'lyric' ? 'next' : 'done',
      onfocus: pushUndo, oninput: (ev) => setText(kind, ev.target.value.trim()),
      onkeydown: (ev) => { if (ev.key === 'Enter' || (kind === 'lyric' && ev.key === 'Tab')) { ev.preventDefault(); if (kind === 'lyric') { moveSel(ev.shiftKey ? -1 : 1); const n2 = keypad.querySelector('.kp-ly'); if (n2 && !n2.disabled) { n2.focus(); n2.select(); } } else ev.target.blur(); } } });
    const row3 = h('div', { class: 'kp-row' }, inp('kp-ly', 'lyric', 'Lyric (Enter → next beat)'), inp('kp-chord', 'chord', 'Chord'), inp('kp-sec', 'section', 'Section (Verse…)'));
    keypad.append(row1, row2, row3);
    requestAnimationFrame(() => screen.style.setProperty('--padh', keypad.offsetHeight + 'px'));
  }

  // hardware keyboard
  let digitBuf = '', digitTimer = null;
  const onKey = (e) => {
    if (mode !== 'edit') { if (e.key === ' ' && !(e.target.closest && e.target.closest('input,textarea'))) { e.preventDefault(); togglePlay(); } return; }
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    const key = e.key;
    if (/^[0-9]$/.test(key)) {
      clearTimeout(digitTimer);
      digitBuf = (digitBuf + key).slice(-2); if (+digitBuf > 24) digitBuf = key;
      if (digitBuf.length === 2) { const cur = curCell(); setCell(cur.replace(/\d+$/, '') + digitBuf); } else setFret(+key);
      digitTimer = setTimeout(() => { digitBuf = ''; }, 700); e.preventDefault(); return;
    }
    digitBuf = '';
    const map = { ArrowLeft: () => moveSel(-1), ArrowRight: () => moveSel(1), ArrowUp: () => moveString(1), ArrowDown: () => moveString(-1) };
    if (map[key]) { map[key](); e.preventDefault(); return; }
    if (key === 'Backspace' || key === 'Delete') { setCell(''); e.preventDefault(); return; }
    if (key === ' ' || key === 'Tab') { moveSel(e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (key === '.') { toggleDot(); e.preventDefault(); return; }
    if (key === 'r' || key === 'R') { rest(); e.preventDefault(); return; }
    if (/^[hpbx\/\\~]$/i.test(key)) { tech(key.toLowerCase()); e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && key === 'z') { e.shiftKey ? doRedo() : doUndo(); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);

  function setMode(m) {
    stopPlay();
    mode = m;
    if (m === 'edit') sel = sel || { m: 0, s: 'g', i: 0, str: nStr() - 1 };
    else { sel = null; M.trimEmptyEnd(sc()); commit(); }
    const was = editPause; editPause = mode === 'edit';
    if (was !== editPause) { updateTimer(); toast(editPause ? '⏸ Practice timer paused while editing' : '▶ Practice timer running'); }
    screen.classList.toggle('editing', mode === 'edit');
    renderMeta(); draw(); buildBar(); renderPad();
    if (m === 'edit' && !sc().measures.some(x => x.g.length)) hint();
  }
  const hint = () => toast('Pick a note length, then tap a string and type the fret', 3800);

  // ---------- playback
  function togglePlay() { player ? stopPlay() : startPlay(); }
  function startPlay() {
    if (!sc().measures.some(x => x.g.some(e => !e.rest))) return toast('Add some notes first');
    const from = sel ? sel.m * M.capacity(sc()) : 0;
    wrap.classList.add('is-playing');
    player = A.play(sc(), song.bpm || 90, from, (refs) => {
      wrap.querySelectorAll('.ev.playing').forEach(x => x.classList.remove('playing'));
      let first = null;
      for (const r of refs) wrap.querySelectorAll(`.ev[data-m="${r.m}"][data-i="${r.i}"]`).forEach(el => { el.classList.add('playing'); first = first || el; });
      if (first) {
        const rr = first.getBoundingClientRect(), limit = (mode === 'edit' ? keypad.getBoundingClientRect().top : window.innerHeight) * 0.72;
        if (rr.top > limit || rr.top < 40) scroll.scrollBy({ top: rr.top - 140, behavior: 'smooth' });
      }
    }, () => stopPlay(), { pitches: (e) => pitchesOf(e, song), timbre: 'pluck' });
    playing = true; buildBar();
  }
  function stopPlay() {
    if (player) { player.stop(); player = null; }
    playing = false;
    wrap.classList.remove('is-playing');
    wrap.querySelectorAll('.ev.playing').forEach(x => x.classList.remove('playing'));
    buildBar();
  }

  // ---------- settings
  function techSettings() {
    const title = h('input', { value: song.title, placeholder: 'Song title' });
    const artist = h('input', { value: song.artist, placeholder: 'Artist' });
    const tp = tuningPicker({ instrument: song.instrument, tuning: song.tuning });
    let capo = song.capo || 0;
    const capoVal = h('span', { class: 'stepper-val' }, capo ? 'Fret ' + capo : 'None');
    const capoRow = h('div', { class: 'stepper' },
      btn('', () => { capo = Math.max(0, capo - 1); capoVal.textContent = capo ? 'Fret ' + capo : 'None'; }, { icon: 'minus', cls: 'icon-only', title: 'Capo down' }), capoVal,
      btn('', () => { capo = Math.min(12, capo + 1); capoVal.textContent = 'Fret ' + capo; }, { icon: 'plus', cls: 'icon-only', title: 'Capo up' }));
    const keySel = h('select', {}, Object.keys(M.KEY_NAMES).map(Number).sort((a, b) => a - b).map(f => h('option', { value: f, selected: sc().keyFifths === f },
      `${M.KEY_NAMES[f]} major / ${M.KEY_MINOR[f]}  (${f === 0 ? 'no sharps or flats' : Math.abs(f) + (f > 0 ? ' sharp' : ' flat') + (Math.abs(f) > 1 ? 's' : '')})`)));
    const timeSel = h('select', {}, TIMES.map(([a, b]) => h('option', { value: `${a}/${b}`, selected: sc().time[0] === a && sc().time[1] === b }, `${a}/${b}`)));
    const bpmIn = h('input', { type: 'number', inputmode: 'numeric', min: 30, max: 260, value: song.bpm || 90 });
    const notChk = h('input', { type: 'checkbox', checked: sc().notation !== false });
    const notes = h('textarea', { rows: 3, placeholder: 'Notes to self (strumming, feel…)' }, song.notes || '');
    const body = h('div', { class: 'form' },
      field('Title', title), field('Artist', artist),
      field('Tuning', tp.el, 'Strings low → high. Fret numbers stay put; the notes follow the tuning.'),
      h('div', { class: 'two' }, field('Capo', capoRow), field('Key signature', keySel)),
      h('div', { class: 'two' }, field('Time signature', timeSel, 'Bars are re-filled to fit'), field('Tempo (BPM)', bpmIn, 'Quarter-note beats per minute')),
      h('label', { class: 'switch-row' }, notChk, h('span', {}, 'Show standard notation above the tab')),
      field('Notes', notes),
      h('div', { class: 'row end' },
        btn('Delete song', async () => { if (await confirmBox(`Delete "${song.title}"? This can't be undone.`)) { s.close(); stopPlay(); S.deleteSong(song.id); nav('#/'); } }, { cls: 'danger ghost', icon: 'trash' }),
        btn('Save', () => {
          pushUndo();
          song.title = title.value.trim() || 'Untitled'; song.artist = artist.value.trim(); song.notes = notes.value;
          if (tp.tuning.length === song.tuning.length) { song.tuning = tp.tuning; song.tuningName = tp.name; }
          song.capo = capo;
          sc().keyFifths = +keySel.value; song.key = M.KEY_NAMES[sc().keyFifths];
          const [a, b] = timeSel.value.split('/').map(Number);
          if (a !== sc().time[0] || b !== sc().time[1]) M.rebar(sc(), [a, b]);
          { const v = Math.round(+bpmIn.value); song.bpm = v >= 30 && v <= 260 ? v : 90; }
          sc().notation = notChk.checked;
          commit(); s.close(); fixSel(); renderMeta(); draw(); buildBar(); renderPad();
        }, { cls: 'primary', icon: 'check' })));
    const s = sheet('Tech tab settings', body);
  }
  function goPl(d) {
    if (!playlist) return;
    const j = plIndex + d;
    if (j < 0) return toast('First song in the playlist');
    if (j >= playlist.songIds.length) return toast('That was the last song 🎸');
    nav(`#/song/${playlist.songIds[j]}?pl=${playlist.id}`);
  }

  // ---------- practice timer
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

  let rz = null, lastW = 0;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (Math.abs(scroll.clientWidth - lastW) > 4) { lastW = scroll.clientWidth; draw(); } }, 120); };
  window.addEventListener('resize', onResize);
  const offChange = S.onChange((kind) => { if (kind === 'sync' && !player) { if (!song.tech) song.tech = newTech(); fixSel(); renderMeta(); draw(); } });

  screen.classList.toggle('editing', mode === 'edit');
  if (S.pref('barPinned', false)) screen.classList.add('bar-open');
  topColor(); buildBar(); renderMeta(); draw(); renderPad();
  lastW = scroll.clientWidth;
  if (mode === 'edit' && !sc().measures.some(x => x.g.length)) hint();
  requestAnimationFrame(() => scroll.focus({ preventScroll: true }));

  return () => {
    if (pending) S.addPractice(pending);
    stopPlay(); clearInterval(tick);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    offChange();
    document.documentElement.classList.remove('stage');
  };
}
