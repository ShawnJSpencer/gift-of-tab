// Song screen: view / edit / stage performance.
import { h, icon, btn, sheet, toast, confirmBox, field } from './ui.js';
import * as S from './store.js';
import { TUNINGS, INSTRUMENTS, COMMON_CHORDS, voicing, transposeChord, isChord, SHARPS } from './theory.js';
import { uid, newTabBlock, newMeasure, emptyCol, resizeStrings, songChords } from './model.js';
import { chordDiagram, emojiRain, logo } from './art.js';
import { convertChordSheet } from './importer.js';
import * as V from './versions.js';
import { tuningPicker, keyPicker } from './pickers.js';

const TECH = ['h', 'p', '/', '\\', 'b', 'r', '~', 'x', '( )', '<>', 'PM', 's', 't'];
const TECH_HELP = { h: 'Hammer-on', p: 'Pull-off', '/': 'Slide up', '\\': 'Slide down', b: 'Bend', r: 'Release', '~': 'Vibrato', x: 'Muted / dead note', '( )': 'Ghost note', '<>': 'Harmonic', PM: 'Palm mute', s: 'Slide', t: 'Tap' };

export function songScreen(root, songId, ctx = {}, nav) {
  let song = S.getSong(songId);
  if (!song) { root.append(h('div', { class: 'empty-state' }, 'That song could not be found.', btn('Home', () => nav('#/'), { cls: 'primary' }))); return () => {}; }

  let mode = ctx.edit ? 'edit' : 'view';
  let cursor = null; // {b: blockId, m, c, kind: 'fret'|'lyric', s}
  let undo = [], redo = [];
  const playlist = ctx.pl ? S.db.playlists[ctx.pl] : null;
  const plIndex = playlist ? playlist.songIds.indexOf(songId) : -1;

  // ---------- skeleton
  const scroll = h('div', { class: 'song-scroll', tabindex: '-1' });
  const topbar = h('div', { class: 'topbar', role: 'toolbar' });
  const handle = h('button', { class: 'menu-handle', 'aria-label': 'Show menu', type: 'button', onclick: (e) => { e.stopPropagation(); toggleBar(); } }, h('span', { class: 'pick-dot', html: '<svg viewBox="0 0 24 26"><path d="M12 25C7 21 1 13 1.5 7 2 3 6 1.5 12 1.5S22 3 22.5 7C23 13 17 21 12 25z"/></svg>' }));
  const keypad = h('div', { class: 'keypad' });
  const strip = h('div', { class: 'chord-strip' });
  const screen = h('div', { class: 'song-screen' }, scroll, handle, topbar, keypad, strip);
  root.append(screen);
  applyStage();

  function applyStage() {
    document.documentElement.classList.toggle('stage', !!S.pref('stage', false));
    screen.style.setProperty('--tabfs', S.pref('tabfs', window.innerWidth < 600 ? 15 : 18) + 'px');
  }

  // ---------- toolbar (single row, scrolls horizontally, auto-hides)
  // The pick toggles the menu bar; it stays until the pick is tapped again (remembered on this device).
  let barTimer = null;
  function topColor() { window.setTopColor(screen.classList.contains('bar-open') ? '#614C49' : (S.pref('stage') ? '#1E1817' : '#FFFBF4')); }
  function showBar() { screen.classList.add('bar-open'); handle.setAttribute('aria-label', 'Hide menu'); S.setPref('barPinned', true); topColor(); }
  function hideBar() { screen.classList.remove('bar-open'); handle.setAttribute('aria-label', 'Show menu'); S.setPref('barPinned', false); closePop(); topColor(); }
  function toggleBar() { screen.classList.contains('bar-open') ? hideBar() : showBar(); }
  topbar.addEventListener('scroll', closePop);

  const timerPill = h('button', { class: 'tb timer-pill', type: 'button', title: 'Practice timer (tap to pause)' });
  function buildBar() {
    topbar.innerHTML = '';
    const tb = (label, ico, fn, title, cls = '') => h('button', { class: 'tb ' + cls, type: 'button', title: title || label, 'aria-label': title || label, onclick: (e) => { e.stopPropagation(); fn(e); } }, ico ? icon(ico) : null, label ? h('span', {}, label) : null);
    const sep = () => h('span', { class: 'tb-sep' });
    const items = [
      tb('', 'menu', () => window.openDrawer(), 'Menu'),
      tb('', 'home', () => nav('#/'), 'Home'),
      sep(),
      mode === 'view' ? tb('Edit', 'edit', () => setMode('edit'), 'Edit this tab', 'accent') : tb('Done', 'check', () => setMode('view'), 'Finish editing', 'accent'),
    ];
    if (playlist) items.push(sep(),
      tb('', 'back', () => goPl(-1), 'Previous song in playlist'),
      h('span', { class: 'tb-label' }, `${plIndex + 1}/${playlist.songIds.length}`),
      tb('', 'next', () => goPl(1), 'Next song in playlist'));
    if (mode === 'edit') items.push(sep(),
      tb('Tab line', 'plus', () => addBlock('tab'), 'Add a tab line'),
      tb('Chords & lyrics', 'plus', () => addBlock('chords'), 'Add a chords & lyrics block'),
      tb('Section', 'plus', () => addBlock('section'), 'Add a section label'),
      sep(),
      tb('Undo', '', doUndo, 'Undo'), tb('Redo', '', doRedo, 'Redo'));
    items.push(sep(),
      tb('', 'minus', () => fontSize(-1), 'Smaller text'), h('span', { class: 'tb-label' }, 'Aa'), tb('', 'plus', () => fontSize(1), 'Bigger text'),
      sep(),
      tb(auto.on ? 'Stop' : 'Scroll', auto.on ? 'pause' : 'scroll', toggleAuto, 'Auto-scroll'),
      tb('', 'minus', () => setSpeed(-1), 'Slower scroll'), h('span', { class: 'tb-label speed' }, speedLabel()), tb('', 'plus', () => setSpeed(1), 'Faster scroll'),
      sep(),
      tb('', 'minus', () => transpose(-1), 'Transpose down'), h('span', { class: 'tb-label' }, 'Key ' + (song.transpose ? (song.transpose > 0 ? '+' : '') + song.transpose : '±0')), tb('', 'plus', () => transpose(1), 'Transpose up'),
      sep(),
      tb(instLabel(), 'music', (e) => instrumentMenu(e.currentTarget), 'Instrument: switch between guitar, ukulele and piano versions', 'inst-btn'),
      tb('Chords', 'grid', toggleStrip, 'Show chord diagrams'),
      tb(S.pref('stage') ? 'Day' : 'Stage', 'moon', () => { S.setPref('stage', !S.pref('stage')); applyStage(); buildBar(); topColor(); }, 'Stage (dark) mode'),
      tb('Song', 'gear', songSettings, 'Song settings: tuning, capo, instrument'),
      sep(), timerPill);
    topbar.append(...items);
    updateTimer();
  }

  // ---------- versions: instrument menu + stage-name badge
  const INST = { guitar: ['🎸', 'Guitar'], ukulele: ['🪕', 'Ukulele'], piano: ['🎹', 'Piano'] };
  const stageName = () => (S.db.settings.stageName || 'Olden Gray').trim() || 'Olden Gray';
  function instLabel() { return INST[song.instrument][1]; }
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', popAway, true); } }
  function popAway(e) { if (pop && !pop.contains(e.target) && !e.target.closest('.inst-btn')) closePop(); }
  function instrumentMenu(anchor) {
    if (pop) return closePop();
    const mine = V.isMine(song);
    pop = h('div', { class: 'pop-menu', role: 'menu' },
      h('div', { class: 'pop-title' }, mine ? `${stageName()} version` : 'Instrument'),
      Object.entries(INST).map(([k, [emo, label]]) => {
        const exists = V.hasVersion(song, V.versionKey(k, mine));
        return h('button', { type: 'button', role: 'menuitemradio', class: 'pop-item' + (song.instrument === k ? ' on' : ''), onclick: () => { closePop(); changeVersion(k, mine); } },
          h('span', { class: 'pop-emo' }, emo), h('span', {}, label),
          song.instrument === k ? h('span', { class: 'pop-tag' }, '✓') : !exists ? h('span', { class: 'pop-tag new' }, 'make it') : null);
      }));
    screen.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = r.bottom + 6 + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 228, r.left)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', popAway, true), 0);
  }
  function changeVersion(inst, mine) {
    pushUndo();
    if (auto.on) toggleAuto();
    const made = V.switchVersion(song, inst, mine);
    if (made === 'same') return;
    commit(); cursor = null; renderAll(); renderKeypad(); buildBar();
    scroll.scrollTop = 0;
    if (made === 'created') {
      if (mine) toast(`✨ Made your ${stageName()} version — tap Edit to change the key, chords or anything. The original stays as it was.`, 5000);
      else toast(inst === 'piano' ? '🎹 Made a piano version — chords & lyrics (moved up for the capo).' : `${INST[inst][0]} Made a ${INST[inst][1].toLowerCase()} version — check it over and edit anything that doesn't sit right.`, 4500);
    } else toast(mine ? `✨ ${stageName()} version` : `${INST[inst][0]} ${INST[inst][1]}${V.isMine(song) ? '' : ' (original)'}`);
  }
  // ---------- tempo (BPM) — each version keeps its own, so Olden Gray can differ from the radio version
  function keyChip() {
    if (!song.key) return null;
    const shown = song.transpose ? transposeChord(song.key, song.transpose, /b/.test(song.key)) : null;
    return h('span', { class: 'key-chip', title: 'Key' }, 'Key ', h('b', {}, song.key), shown ? h('span', { class: 'key-to' }, ' → ', h('b', {}, shown)) : null);
  }
  function bpmChip() {
    const orig = V.originalBpm(song);
    if (!song.bpm && mode !== 'edit') return null;
    return h('button', { type: 'button', class: 'bpm-chip' + (song.bpm ? '' : ' empty'), title: 'Tempo (BPM)', onclick: (e) => { e.stopPropagation(); bpmSheet(); } },
      h('span', { class: 'bpm-note' }, '♩'),
      song.bpm ? h('span', {}, h('b', {}, song.bpm), ' BPM') : h('span', {}, 'Add BPM'),
      orig && orig !== song.bpm ? h('span', { class: 'bpm-orig' }, `radio ${orig}`) : null);
  }
  function bpmSheet() {
    const mine = V.isMine(song), orig = V.originalBpm(song);
    let val = song.bpm || orig || 100;
    const num = h('input', { type: 'number', inputmode: 'numeric', min: 30, max: 300, value: song.bpm || '', placeholder: String(val), class: 'bpm-big', 'aria-label': 'Beats per minute' });
    const pulse = h('span', { class: 'bpm-pulse', 'aria-hidden': 'true' });
    const cur = () => { const v = Math.round(+num.value); return v >= 30 && v <= 300 ? v : null; };
    let beatTimer = null, beatN = 0;
    const beat = () => {
      clearTimeout(beatTimer);
      const b = cur(); if (!b) return;
      pulse.classList.remove('on', 'down'); void pulse.offsetWidth;
      pulse.classList.add('on'); if (beatN % (song.beats || 4) === 0) pulse.classList.add('down');
      beatN++;
      beatTimer = setTimeout(beat, 60000 / b);
    };
    const set = (v) => { num.value = Math.max(30, Math.min(300, Math.round(v))); beatN = 0; beat(); };
    num.addEventListener('input', () => { beatN = 0; beat(); });
    const step = (d) => btn(d > 0 ? '+' + d : String(d), () => set((cur() || val) + d), { cls: 'small ghost' });
    let taps = [];
    const tapBtn = h('button', { type: 'button', class: 'tap-btn', onclick: () => {
      const t = performance.now();
      if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
      taps.push(t); if (taps.length > 9) taps.shift();
      if (taps.length >= 2) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); set(60000 / iv); }
      tapBtn.classList.remove('hit'); void tapBtn.offsetWidth; tapBtn.classList.add('hit');
    } }, 'Tap the beat', h('small', {}, 'tap 4+ times to find the tempo'));
    const body = h('div', { class: 'form bpm-form' },
      mine ? h('p', { class: 'hint' }, `This is the tempo for your ${stageName()} version.` + (orig ? ` The radio version stays at ${orig} BPM.` : '')) :
        h('p', { class: 'hint' }, 'The song\'s usual (radio) tempo. Your Olden Gray version can have its own.'.replace('Olden Gray', stageName())),
      h('div', { class: 'bpm-row' }, pulse, num, h('span', { class: 'bpm-unit' }, 'BPM')),
      h('div', { class: 'row bpm-steps' }, step(-5), step(-1), step(1), step(5), mine && orig ? btn(`Use radio (${orig})`, () => set(orig), { cls: 'small ghost' }) : null),
      tapBtn,
      h('div', { class: 'row end' },
        song.bpm ? btn('Clear', () => { pushUndo(); song.bpm = null; commit(); done(); }, { cls: 'ghost danger' }) : null,
        btn('Save', () => { const v = cur(); pushUndo(); song.bpm = v; commit(); done(); }, { cls: 'primary', icon: 'check' })));
    const sh = sheet('♩ Tempo', body, { cls: 'small', onClose: () => clearTimeout(beatTimer) });
    function done() { clearTimeout(beatTimer); sh.close(); renderAll(); }
    if (cur()) beat();
  }

  function stageBadge() {
    const mine = V.isMine(song);
    return h('button', { type: 'button', class: 'stage-badge' + (mine ? ' on' : ''), title: mine ? 'Back to the original tab' : `Show your ${stageName()} version`,
      'aria-pressed': mine ? 'true' : 'false', onclick: (e) => { e.stopPropagation(); changeVersion(song.instrument, !mine); } },
      h('span', { class: 'sb-star', html: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.4 6.4 19.7l1.5-6.3L3 9.1l6.4-.6z"/></svg>' }),
      h('span', { class: 'sb-name' }, stageName()),
      mine ? h('span', { class: 'sb-sub' }, 'my version') : null);
  }

  function setMode(m) {
    mode = m; cursor = null;
    if (typeof updateTimer === 'function') { const was = editPause; editPause = mode === 'edit'; if (was !== editPause) { updateTimer(); toast(editPause ? '⏸ Practice timer paused while editing' : '▶ Practice timer running'); } }
    screen.classList.toggle('editing', mode === 'edit');
    if (mode === 'view' && auto.on) toggleAuto();
    renderAll(); buildBar(); renderKeypad();
  }

  // ---------- rendering
  const tabfs = () => S.pref('tabfs', window.innerWidth < 600 ? 15 : 18);
  function fontSize(d) { S.setPref('tabfs', Math.max(10, Math.min(40, tabfs() + d * 2))); applyStage(); layoutAll(); }
  const showChord = (c) => (song.transpose ? transposeChord(c, song.transpose, /b/.test(c)) : c);

  function renderAll() {
    const st = scroll.scrollTop;
    scroll.innerHTML = '';
    const stringsTxt = song.instrument === 'piano' ? '' : song.tuning.slice().join(' ');
    const head = h('header', { class: 'song-head' },
      h('h1', { class: 'song-title' }, song.title || 'Untitled'),
      song.artist ? h('div', { class: 'song-artist' }, song.artist) : null);
    if (mode === 'edit') head.onclick = songSettings;
    scroll.append(head);
    const meta = h('div', { class: 'meta-line' + (mode === 'edit' ? ' editable' : ''), onclick: mode === 'edit' ? songSettings : null },
      song.capo ? h('span', { class: 'capo' }, `Capo ${song.capo}`) : null,
      song.instrument !== 'piano' ? h('span', { class: 'tuning' }, `${song.tuningName && song.tuningName !== 'Custom' ? song.tuningName + ' · ' : ''}${stringsTxt}`) : h('span', { class: 'tuning' }, 'Piano · chords'),
      song.transpose ? h('span', { class: 'tp' }, `Transposed ${song.transpose > 0 ? '+' : ''}${song.transpose}`) : null,
      keyChip(),
      bpmChip(),
      stageBadge());
    scroll.append(meta);
    song.blocks.forEach((b, i) => {
      if (mode === 'edit') scroll.append(addBar(i));
      scroll.append(renderBlock(b));
    });
    if (mode === 'edit') scroll.append(addBar(song.blocks.length, true));
    if (playlist && mode === 'view') {
      const nextId = playlist.songIds[plIndex + 1];
      const nextSong = nextId && S.getSong(nextId);
      scroll.append(h('div', { class: 'pl-foot' },
        nextSong ? btn(`Next: ${nextSong.title}`, () => goPl(1), { cls: 'primary big', icon: 'next' }) : h('div', { class: 'pl-done' }, '🎸 End of ', h('b', {}, playlist.name))));
    }
    scroll.append(h('div', { class: 'scroll-pad' }));
    layoutAll();
    scroll.scrollTop = st;
  }

  function addBar(index, last) {
    const add = (type) => (e) => { e.stopPropagation(); addBlock(type, index); };
    return h('div', { class: 'add-bar' + (last ? ' last' : '') },
      h('button', { type: 'button', onclick: add('tab') }, '+ Tab'),
      h('button', { type: 'button', onclick: add('chords') }, '+ Chords / lyrics'),
      h('button', { type: 'button', onclick: add('section') }, '+ Section'));
  }

  function blockTools(b) {
    const i = song.blocks.indexOf(b);
    const t = (ico, title, fn) => h('button', { type: 'button', class: 'bt', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ico));
    const tools = h('div', { class: 'block-tools' },
      h('span', { class: 'bt-name' }, b.type === 'tab' ? 'Tab' : b.type === 'chords' ? 'Chords & lyrics' : 'Section'),
      i > 0 ? t('up', 'Move up', () => mutate(() => { song.blocks.splice(i, 1); song.blocks.splice(i - 1, 0, b); }, true)) : null,
      i < song.blocks.length - 1 ? t('down', 'Move down', () => mutate(() => { song.blocks.splice(i, 1); song.blocks.splice(i + 1, 0, b); }, true)) : null,
      t('copy', 'Duplicate', () => mutate(() => { const c = JSON.parse(JSON.stringify(b)); c.id = uid(); song.blocks.splice(i + 1, 0, c); }, true)),
      t('trash', 'Delete block', async () => { if (await confirmBox('Delete this block?')) mutate(() => song.blocks.splice(i, 1), true); }));
    if (b.type === 'tab') {
      tools.insertBefore(h('button', { type: 'button', class: 'bt txt' + (b.lyrics ? ' on' : ''), onclick: (e) => { e.stopPropagation(); mutate(() => { b.lyrics = !b.lyrics; }, b.id); } }, 'Lyrics row'), tools.children[1]);
      tools.insertBefore(h('button', { type: 'button', class: 'bt txt', onclick: (e) => { e.stopPropagation(); mutate(() => b.measures.push(newMeasure(song)), b.id); } }, '+ Bar'), tools.children[1]);
    }
    return tools;
  }

  function renderBlock(b) {
    let el;
    if (b.type === 'section') {
      el = h('section', { class: 'block section', 'data-id': b.id });
      if (mode === 'edit') {
        el.append(blockTools(b), h('input', { class: 'section-input', value: b.text || '', placeholder: 'Verse, Chorus, Bridge…', oninput: (e) => { b.text = e.target.value; commit(); }, onfocus: pushUndo }));
      } else el.append(h('h3', { class: 'section-label' }, b.text || ''));
    } else if (b.type === 'chords') {
      el = h('section', { class: 'block chords', 'data-id': b.id });
      if (mode === 'edit') {
        const ta = h('textarea', { class: 'chords-input', spellcheck: false, value: b.text, placeholder: '[G]Amazing [C]grace, how [G]sweet the sound\n\nPut chords in [brackets] right before the syllable — or paste chords-over-lyrics and tap Convert.' });
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 4 + 'px'; };
        ta.addEventListener('focus', pushUndo);
        const preview = h('div', { class: 'chords-preview', 'aria-label': 'Preview' }, renderChordText(b.text));
        ta.addEventListener('input', () => { b.text = ta.value; grow(); commit(); preview.replaceChildren(renderChordText(b.text)); });
        el.append(blockTools(b),
          h('div', { class: 'chords-edit-tools' },
            btn('Insert chord', () => chordPicker({ title: 'Insert chord', onPick: (name) => { const p = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, p) + `[${name}]` + ta.value.slice(p); b.text = ta.value; commit(); grow(); ta.focus(); ta.selectionStart = ta.selectionEnd = p + name.length + 2; } }), { icon: 'music', cls: 'small' }),
            btn('Convert chords-over-lyrics', () => { pushUndo(); ta.value = b.text = convertChordSheet(ta.value); commit(); grow(); preview.replaceChildren(renderChordText(b.text)); toast('Converted'); }, { cls: 'small ghost' })),
          ta, preview);
        requestAnimationFrame(grow);
      } else el.append(renderChordText(b.text));
    } else if (b.type === 'tab') {
      const hasChords = b.measures.some(m => m.cols.some(c => c.c));
      el = h('section', { class: 'block tab' + (b.lyrics ? ' has-lyrics' : '') + (!hasChords && mode === 'view' ? ' no-chords' : ''), 'data-id': b.id });
      if (mode === 'edit') el.append(blockTools(b));
      el.append(h('div', { class: 'tab-lines' }));
      el._measures = b.measures.map((m, mi) => renderMeasure(b, m, mi));
    }
    return el;
  }

  function renderChordText(text) {
    const wrap = h('div', { class: 'chord-text' });
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) { wrap.append(h('div', { class: 'cl blank' })); continue; }
      if (!/\[[^\]]+\]/.test(line)) { wrap.append(h('div', { class: 'cl lyric-only' }, line)); continue; }
      const row = h('div', { class: 'cl' });
      const parts = line.split(/\[([^\]]+)\]/);
      if (parts[0]) for (const w of parts[0].match(/\S*\s*/g).filter(Boolean)) row.append(h('span', { class: 'seg' }, h('span', { class: 'ch' }, ''), h('span', { class: 'ly' }, w)));
      const lyricless = parts.filter((_, i) => i % 2 === 0).join('').trim() === '';
      for (let i = 1; i < parts.length; i += 2) {
        const ch = parts[i], ly = parts[i + 1] || '';
        // keep the chord with its first word; later words become their own pieces so lines wrap nicely
        const words = lyricless ? [ly] : ly.match(/\S*\s*/g).filter(Boolean);
        row.append(h('span', { class: 'seg' + (lyricless ? ' solo' : '') },
          h('span', { class: 'ch', 'data-chord': ch }, showChord(ch)),
          h('span', { class: 'ly' }, words[0] && words[0].trim() ? words[0] : '\u00a0')));
        for (const w of words.slice(1)) row.append(h('span', { class: 'seg' }, h('span', { class: 'ch' }, ''), h('span', { class: 'ly' }, w)));
      }
      if (lyricless) row.classList.add('chords-only');
      wrap.append(row);
    }
    return wrap;
  }

  // ---------- how a tab cell is shown: drawn symbols (arcs, slides, bends) or plain letters
  const drawn = () => S.pref('notation', 'drawn') === 'drawn';
  const SLIDE_UP = '<svg viewBox="0 0 12 12"><path d="M1 10.5L11 1.5"/></svg>', SLIDE_DOWN = '<svg viewBox="0 0 12 12"><path d="M1 1.5L11 10.5"/></svg>';
  const BEND_UP = '<svg viewBox="0 0 12 20"><path d="M1 17C7 17 9 13 9 4"/><path class="fill" d="M9 1l-3 5h6z"/></svg>';
  const BEND_DOWN = '<svg viewBox="0 0 12 20"><path d="M1 3C7 3 9 7 9 15"/><path class="fill" d="M9 19l-3-5h6z"/></svg>';
  const VIB = '<svg viewBox="0 0 20 8"><path d="M1 5c2-4 3-4 5 0s3 4 5 0 3-4 5 0 2 2 3 1"/></svg>';
  const REST_SVG = '<svg viewBox="0 0 14 30"><path d="M5 1l7 8-4 5 5 7c-4-2-8-1-6 4 0 3 3 4 3 4-6-1-8-6-4-9l-4-6 4-5-1-8z"/></svg>';
  function cellDisplay(v) {
    if (!drawn()) return { node: h('span', {}, v) };
    let m;
    const pm = /^PM/.test(v); const core = pm ? v.slice(2) : v;
    const wrap = (...kids) => h('span', { class: 'tc' }, pm ? h('i', { class: 'pm' }, 'PM') : null, ...kids);
    if ((m = core.match(/^(\d+)([hp])(\d+)$/))) return { node: wrap(h('span', {}, m[1]), h('span', { class: 'tie' }, h('i', {}, m[2].toUpperCase())), h('span', {}, m[3])) };
    if ((m = core.match(/^(\d+)([\/\\s])(\d+)$/))) { const up = +m[3] > +m[1]; return { node: wrap(h('span', {}, m[1]), h('span', { class: 'sym slide', html: up ? SLIDE_UP : SLIDE_DOWN }), h('span', {}, m[3])) }; }
    if ((m = core.match(/^(\d+)b(\d+)?$/))) { const amt = m[2] ? +m[2] - +m[1] : 2; return { node: wrap(h('span', {}, m[1]), h('span', { class: 'sym bend', html: BEND_UP }, h('i', {}, amt === 1 ? '½' : amt === 2 ? 'full' : amt > 2 ? `${amt / 2}` : ''))) }; }
    if ((m = core.match(/^(\d+)r$/))) return { node: wrap(h('span', {}, m[1]), h('span', { class: 'sym bend', html: BEND_DOWN })) };
    if ((m = core.match(/^(\d+)~$/))) return { node: wrap(h('span', {}, m[1]), h('span', { class: 'sym vib', html: VIB })) };
    if ((m = core.match(/^(\d+)([hp\/\\s])$/))) return { node: wrap(h('span', {}, m[1])), tech: m[2] }; // joins the next note on this string
    return { node: wrap(h('span', {}, core)) };
  }
  // Draw arcs / slide lines between a note and the next note on the same string (across beats).
  function drawConnectors(line) {
    line.querySelectorAll('.tech-layer').forEach(e => e.remove());
    if (!drawn()) return;
    const starts = line.querySelectorAll('.sc[data-tech]');
    if (!starts.length) return;
    const lr = line.getBoundingClientRect();
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'tech-layer'); svg.setAttribute('width', lr.width); svg.setAttribute('height', lr.height);
    const cols = [...line.querySelectorAll('.col')];
    for (const a of starts) {
      const s = a.dataset.s, t = a.dataset.tech, colA = a.closest('.col');
      let b = null;
      for (let i = cols.indexOf(colA) + 1; i < cols.length && !b; i++) { const c = cols[i].querySelector(`.sc[data-s="${s}"]`); if (c && c.textContent.trim()) b = c; }
      const na = a.querySelector('.tc > span:last-child') || a, ra = na.getBoundingClientRect();
      const rb = b ? (b.querySelector('.tc > span') || b).getBoundingClientRect() : { left: lr.right - 4, right: lr.right - 4, top: ra.top, bottom: ra.bottom, width: 0 };
      const x1 = ra.left + ra.width / 2 - lr.left, x2 = rb.left + rb.width / 2 - lr.left;
      if (t === 'h' || t === 'p') {
        const y = Math.min(ra.top, rb.top) - lr.top - 1, rise = Math.min(14, Math.max(6, (x2 - x1) * 0.25));
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', `M${x1} ${y} Q${(x1 + x2) / 2} ${y - rise * 2} ${x2} ${y}`);
        path.setAttribute('class', 'arc'); svg.append(path);
        const tx = document.createElementNS(svgNS, 'text');
        tx.setAttribute('x', (x1 + x2) / 2); tx.setAttribute('y', y - rise - 3); tx.setAttribute('class', 'arc-label'); tx.textContent = t.toUpperCase();
        svg.append(tx);
      } else {
        const fa = parseInt(a.textContent, 10), fb = b ? parseInt(b.textContent, 10) : fa + 1;
        const up = t === '/' || (t === 's' && fb > fa), ym = (ra.top + ra.bottom) / 2 - lr.top, d = (ra.bottom - ra.top) * 0.35;
        const ln = document.createElementNS(svgNS, 'line');
        ln.setAttribute('x1', ra.right - lr.left + 2); ln.setAttribute('x2', rb.left - lr.left - 2);
        ln.setAttribute('y1', ym + (up ? d : -d)); ln.setAttribute('y2', ym + (up ? -d : d)); ln.setAttribute('class', 'slide-line');
        svg.append(ln);
      }
    }
    line.append(svg);
  }

  function renderMeasure(b, m, mi) {
    const n = song.tuning.length;
    const el = h('div', { class: 'measure', 'data-m': mi });
    el.append(barEl(n, b.lyrics));
    m.cols.forEach((c, ci) => {
      const beat = ci % (song.subdiv || 2) === 0;
      const col = h('div', { class: 'col' + (beat ? ' beat' : ''), 'data-c': ci });
      col.append(h('div', { class: 'cc' + (c.c ? ' has' : '') + (beat ? ' beat' : ''), 'data-chord': c.c || null }, c.c ? showChord(c.c) : ''));
      for (let r = 0; r < n; r++) {
        const si = n - 1 - r;
        const v = c.n[si] || '';
        const sel = cursor && cursor.kind === 'fret' && cursor.b === b.id && cursor.m === mi && cursor.c === ci && cursor.s === si;
        const disp = v ? cellDisplay(v) : null;
        col.append(h('div', { class: 'sc' + (sel ? ' sel' : ''), 'data-s': si, 'data-tech': disp && disp.tech ? disp.tech : null }, disp ? disp.node : ''));
      }
      if (b.lyrics) {
        const sel = cursor && cursor.kind === 'lyric' && cursor.b === b.id && cursor.m === mi && cursor.c === ci;
        col.append(h('div', { class: 'lc' + (sel ? ' sel' : '') }, c.l || ''));
      }
      if (c.r) { col.classList.add('rest'); col.append(h('div', { class: 'rest-mark', 'aria-label': 'Rest', html: REST_SVG })); }
      if (cursor && cursor.b === b.id && cursor.m === mi && cursor.c === ci) col.classList.add('cur');
      el.append(col);
    });
    return el;
  }
  function barEl(n, lyrics) {
    const bar = h('div', { class: 'bar' }, h('div', { class: 'cc' }));
    for (let r = 0; r < n; r++) bar.append(h('div', { class: 'sc' + (r === 0 ? ' top' : r === n - 1 ? ' bot' : '') }));
    if (lyrics) bar.append(h('div', { class: 'lc' }));
    return bar;
  }

  // Pack measures into lines that fit the screen; each line gets its own string labels.
  function layoutBlock(el) {
    const b = song.blocks.find(x => x.id === el.dataset.id);
    if (!b || b.type !== 'tab') return;
    const lines = el.querySelector('.tab-lines');
    lines.innerHTML = '';
    const n = song.tuning.length;
    const labels = () => {
      const lab = h('div', { class: 'labels' }, h('div', { class: 'cc' }));
      for (let r = 0; r < n; r++) lab.append(h('div', { class: 'sc' }, song.tuning[n - 1 - r]));
      if (b.lyrics) lab.append(h('div', { class: 'lc' }));
      return lab;
    };
    const endBar = () => { const e = barEl(n, b.lyrics); e.classList.add('end'); return e; };
    // measure natural widths
    const probe = h('div', { class: 'tab-line probe' }, labels());
    lines.append(probe);
    el._measures.forEach(m => probe.append(m));
    const labW = probe.firstChild.getBoundingClientRect().width;
    const widths = el._measures.map(m => m.getBoundingClientRect().width);
    probe.remove();
    const avail = lines.getBoundingClientRect().width - labW - 6;
    let cur = null, used = 0;
    el._measures.forEach((m, i) => {
      if (!cur || (used + widths[i] > avail && used > 0)) {
        if (cur) cur.append(endBar());
        cur = h('div', { class: 'tab-line' }, labels()); lines.append(cur); used = 0;
      }
      cur.append(m); used += widths[i];
    });
    if (cur) cur.append(endBar());
    lines.querySelectorAll('.tab-line').forEach(drawConnectors);
  }
  function layoutAll() { scroll.querySelectorAll('.block.tab').forEach(layoutBlock); }
  let rz = null;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { layoutAll(); }, 120); };
  window.addEventListener('resize', onResize);

  function rerenderBlock(id) {
    const old = scroll.querySelector(`.block[data-id="${id}"]`);
    const b = song.blocks.find(x => x.id === id);
    if (!old || !b) return renderAll();
    const st = scroll.scrollTop;
    const el = renderBlock(b);
    old.replaceWith(el);
    layoutBlock(el);
    scroll.scrollTop = st;
  }

  // ---------- mutations + undo
  function snapshot() { return JSON.stringify(song); }
  function pushUndo() { undo.push(snapshot()); if (undo.length > 80) undo.shift(); redo = []; }
  function commit() { S.touchSong(song); }
  function mutate(fn, rerender) {
    pushUndo(); fn(); commit();
    if (rerender === true || rerender === undefined) renderAll();
    else if (typeof rerender === 'string') rerenderBlock(rerender);
  }
  function restore(json) { const s = JSON.parse(json); Object.keys(song).forEach(k => delete song[k]); Object.assign(song, s); commit(); cursor = null; renderAll(); renderKeypad(); buildBar(); }
  function doUndo() { if (!undo.length) return toast('Nothing to undo'); redo.push(snapshot()); restore(undo.pop()); }
  function doRedo() { if (!redo.length) return toast('Nothing to redo'); undo.push(snapshot()); restore(redo.pop()); }

  function addBlock(type, index = song.blocks.length) {
    let b;
    if (type === 'tab') {
      if (song.instrument === 'piano') return toast('Piano songs use chords & lyrics blocks');
      b = newTabBlock(song);
    } else if (type === 'chords') b = { id: uid(), type: 'chords', text: '' };
    else b = { id: uid(), type: 'section', text: '' };
    mutate(() => song.blocks.splice(index, 0, b), true);
    const el = scroll.querySelector(`.block[data-id="${b.id}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); const inp = el.querySelector('input,textarea'); if (inp) setTimeout(() => inp.focus(), 300); }
  }

  // ---------- tap handling
  scroll.addEventListener('click', (e) => {
    const t = e.target;
    const cc = t.closest('.cc'), sc = t.closest('.sc'), lc = t.closest('.lc'), ch = t.closest('.ch[data-chord]');
    const col = t.closest('.col'), meas = t.closest('.measure'), blockEl = t.closest('.block');
    if (mode === 'view') {
      const name = (cc && cc.dataset.chord) || (ch && ch.dataset.chord);
      if (name) { showDiagram(showChord(name)); return; }
      if (S.pref('tapPage', true) && !t.closest('button,a,input,textarea')) {
        const y = e.clientY / window.innerHeight;
        if (y > 0.6) scroll.scrollBy({ top: scroll.clientHeight * 0.7, behavior: 'smooth' });
        else if (y < 0.25) scroll.scrollBy({ top: -scroll.clientHeight * 0.7, behavior: 'smooth' });
      }
      return;
    }
    if (!col || !meas || !blockEl) return;
    const b = song.blocks.find(x => x.id === blockEl.dataset.id);
    const mi = +meas.dataset.m, ci = +col.dataset.c;
    if (cc) {
      cursor = { b: b.id, m: mi, c: ci, kind: 'fret', s: song.tuning.length - 1 };
      rerenderBlock(b.id); renderKeypad();
      const colData = b.measures[mi].cols[ci];
      chordPicker({ title: 'Chord for this beat', current: colData.c, fillOption: true, onPick: (name, fill) => {
        mutate(() => {
          colData.c = name;
          if (fill) { const v = voicing(name, song.tuning); if (v) colData.n = v.map(f => (f < 0 ? '' : String(f))); else toast(`Couldn't work out a shape for ${name} — label only`); }
        }, b.id);
      }, onClear: () => mutate(() => { colData.c = ''; }, b.id) });
      return;
    }
    if (sc) { cursor = { b: b.id, m: mi, c: ci, kind: 'fret', s: +sc.dataset.s }; rerenderBlock(b.id); renderKeypad(); return; }
    if (lc) { cursor = { b: b.id, m: mi, c: ci, kind: 'lyric' }; rerenderBlock(b.id); renderKeypad(true); return; }
  });

  // swipe left/right between playlist songs (view mode)
  let sx = 0, sy = 0, st0 = 0;
  scroll.addEventListener('touchstart', (e) => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st0 = Date.now(); }, { passive: true });
  scroll.addEventListener('touchend', (e) => {
    if (!playlist || mode !== 'view') return;
    const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
    if (Math.abs(dx) > 120 && Math.abs(dy) < 60 && Date.now() - st0 < 600) goPl(dx < 0 ? 1 : -1);
  }, { passive: true });

  function goPl(d) {
    if (!playlist) return;
    const j = plIndex + d;
    if (j < 0) return toast('First song in the playlist');
    if (j >= playlist.songIds.length) return toast('That was the last song 🎸');
    nav(`#/song/${playlist.songIds[j]}?pl=${playlist.id}`);
  }

  // ---------- keypad (edit mode)
  function curCol() {
    if (!cursor) return null;
    const b = song.blocks.find(x => x.id === cursor.b);
    return b && b.measures[cursor.m] && b.measures[cursor.m].cols[cursor.c] ? { b, col: b.measures[cursor.m].cols[cursor.c] } : null;
  }
  function renderKeypad(focusLyric) {
    keypad.innerHTML = '';
    const cc = mode === 'edit' && curCol();
    screen.classList.toggle('kp-open', !!cc);
    if (!cc) return;
    const k = (label, fn, cls = '', title) => h('button', { type: 'button', class: 'k ' + cls, title: title || label, onclick: (e) => { e.preventDefault(); fn(); } }, label);
    const nav4 = [k('◀', () => move(0, -1), 'nav', 'Previous beat'), k('▲', () => move(-1, 0), 'nav', 'String above'), k('▼', () => move(1, 0), 'nav', 'String below'), k('▶', () => move(0, 1), 'nav', 'Next beat')];
    const ops = [k('+ Beat', insCol, 'op', 'Insert a beat after this one'), k('− Beat', delCol, 'op', 'Delete this beat'), k('+ Bar', insBar, 'op', 'Insert a bar after this one'), k('− Bar', delBar, 'op', 'Delete this bar'),
      k(cc.col.r ? 'No rest' : 'Rest', () => { mutate(() => { cc.col.r = !cc.col.r; if (cc.col.r) cc.col.n = cc.col.n.map(() => ''); }, cc.b.id); renderKeypad(); }, 'op rest-k', 'A rest (silence) on this beat'),
      k('Clear beat', () => mutate(() => { cc.col.n = cc.col.n.map(() => ''); cc.col.c = ''; }, cc.b.id), 'op'),
      k('Done', () => { cursor = null; rerenderBlock(cc.b.id); renderKeypad(); }, 'done')];
    if (cursor.kind === 'lyric') {
      const inp = h('input', { class: 'kp-lyric', value: cc.col.l || '', placeholder: 'Lyric for this beat', enterkeyhint: 'next',
        onfocus: pushUndo,
        oninput: (e) => { const cur = curCol(); if (!cur) return; cur.col.l = e.target.value; commit(); const cell = scroll.querySelector(`.block[data-id="${cur.b.id}"] .measure[data-m="${cursor.m}"] .col[data-c="${cursor.c}"] .lc`); if (cell) cell.textContent = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, true); } } });
      keypad.append(h('div', { class: 'kp-row' }, inp, k('◀', () => move(0, -1, true), 'nav'), k('▶', () => move(0, 1, true), 'nav'), ...ops.slice(-1)));
      if (focusLyric !== false) setTimeout(() => inp.focus(), 30);
      return;
    }
    const frets = [];
    for (let f = 0; f <= 24; f++) frets.push(k(String(f), () => setFret(String(f)), 'num'));
    keypad.append(
      h('div', { class: 'kp-row scroll' }, k('⌫', () => setCell(''), 'op', 'Clear note'), ...frets),
      h('div', { class: 'kp-row scroll' }, ...nav4, ...TECH.map(t => k(t, () => tech(t), 'tech', TECH_HELP[t])), ...ops));
  }
  function setCell(v) { const cc = curCol(); if (!cc) return; mutate(() => { cc.col.n[cursor.s] = v; }, cc.b.id); }
  function setFret(f) {
    const cc = curCol(); if (!cc) return;
    const cur = cc.col.n[cursor.s] || '';
    setCell(/[hp\/\\brst]$/.test(cur) ? cur + f : /^\(\)$/.test(cur) ? `(${f})` : /^<>$/.test(cur) ? `<${f}>` : f);
  }
  function tech(t) {
    const cc = curCol(); if (!cc) return;
    const cur = cc.col.n[cursor.s] || '';
    if (t === 'x') return setCell('x');
    if (t === '( )') return setCell(cur && cur !== '()' ? `(${cur.replace(/[()]/g, '')})` : '()');
    if (t === '<>') return setCell(cur && cur !== '<>' ? `<${cur.replace(/[<>]/g, '')}>` : '<>');
    if (t === 'PM') return setCell(cur.startsWith('PM') ? cur.slice(2) : 'PM' + cur);
    setCell(cur + t);
  }
  function move(ds, dc, lyric) {
    const cc = curCol(); if (!cc) return;
    const b = cc.b;
    if (ds && cursor.kind === 'fret') cursor.s = Math.max(0, Math.min(song.tuning.length - 1, cursor.s - ds));
    if (dc) {
      let m = cursor.m, c = cursor.c + dc;
      if (c >= b.measures[m].cols.length) { if (m < b.measures.length - 1) { m++; c = 0; } else c--; }
      if (c < 0) { if (m > 0) { m--; c = b.measures[m].cols.length - 1; } else c = 0; }
      cursor.m = m; cursor.c = c;
    }
    rerenderBlock(b.id);
    const li = keypad.querySelector('.kp-lyric');
    if (lyric && li && cursor.kind === 'lyric') { li.value = curCol().col.l || ''; li.focus(); } // keep the iPad keyboard up
    else renderKeypad(lyric ? true : false);
    const sel = scroll.querySelector('.sc.sel, .lc.sel'); if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function insCol() { const cc = curCol(); if (!cc) return; mutate(() => cc.b.measures[cursor.m].cols.splice(cursor.c + 1, 0, emptyCol(song.tuning.length)), cc.b.id); move(0, 1); }
  function delCol() {
    const cc = curCol(); if (!cc) return;
    const cols = cc.b.measures[cursor.m].cols;
    if (cols.length <= 1) return delBar();
    mutate(() => cols.splice(cursor.c, 1), cc.b.id); cursor.c = Math.min(cursor.c, cols.length - 1); rerenderBlock(cc.b.id); renderKeypad();
  }
  function insBar() { const cc = curCol(); if (!cc) return; mutate(() => cc.b.measures.splice(cursor.m + 1, 0, newMeasure(song)), cc.b.id); cursor.m++; cursor.c = 0; rerenderBlock(cc.b.id); renderKeypad(); }
  function delBar() {
    const cc = curCol(); if (!cc) return;
    if (cc.b.measures.length <= 1) return toast('A tab line needs at least one bar — delete the block instead');
    mutate(() => cc.b.measures.splice(cursor.m, 1), cc.b.id); cursor.m = Math.min(cursor.m, cc.b.measures.length - 1); cursor.c = 0; rerenderBlock(cc.b.id); renderKeypad();
  }

  // hardware keyboard (iPad keyboard / Mac)
  let digitBuf = '', digitTimer = null;
  const onKey = (e) => {
    if (mode !== 'edit' || !cursor || cursor.kind !== 'fret') return;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const key = e.key;
    if (/^[0-9]$/.test(key)) {
      clearTimeout(digitTimer);
      digitBuf = (digitBuf + key).slice(-2);
      if (+digitBuf > 24) digitBuf = key;
      const cur = curCol().col.n[cursor.s] || '';
      const prefix = digitBuf.length === 2 ? cur.replace(/\d+$/, '').replace(/^\d+$/, '') : '';
      if (digitBuf.length === 2) setCell(/[hp\/\\brst]$/.test(prefix) || /[hp\/\\brst]\d$/.test(cur) ? cur.slice(0, -1) + digitBuf : digitBuf);
      else setFret(key);
      digitTimer = setTimeout(() => { digitBuf = ''; }, 700);
      e.preventDefault(); return;
    }
    digitBuf = '';
    const map = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (map[key]) { move(...map[key]); e.preventDefault(); return; }
    if (key === 'Backspace' || key === 'Delete') { setCell(''); e.preventDefault(); return; }
    if (key === 'Escape') { const id = cursor.b; cursor = null; rerenderBlock(id); renderKeypad(); return; }
    if (key === ' ' || key === 'Tab') { move(0, e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (/^[hpbrstx\/\\~]$/i.test(key)) { tech(key.toLowerCase()); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- chord picker
  function chordPicker({ title, current, onPick, onClear, fillOption }) {
    let fill = S.pref('fillChord', true);
    const preview = h('div', { class: 'cp-preview' });
    const input = h('input', { class: 'cp-input', placeholder: 'Type any chord… e.g. F#m7, Cadd9, D/F#', value: current || '', autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
    const pick = (name) => {
      name = name.trim(); if (!name) return;
      name = name.charAt(0).toUpperCase() + name.slice(1);
      if (!isChord(name)) return toast(`"${name}" doesn't look like a chord`);
      S.setPref('fillChord', fill); s.close(); onPick(name, fill);
    };
    const upd = () => { preview.innerHTML = ''; const v = input.value.trim(); const nm = v && v.charAt(0).toUpperCase() + v.slice(1); if (nm && isChord(nm)) preview.append(chordDiagram(nm, song)); };
    input.addEventListener('input', upd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(input.value); });
    const used = songChords(song);
    const chip = (c) => h('button', { type: 'button', class: 'chip' + (c === current ? ' on' : ''), onclick: () => pick(c), onpointerenter: () => { preview.innerHTML = ''; preview.append(chordDiagram(c, song)); } }, c);
    const body = h('div', { class: 'chord-picker' },
      h('div', { class: 'row' }, input, btn('Use', () => pick(input.value), { cls: 'primary' })),
      fillOption && song.instrument !== 'piano' ? h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: fill, onchange: (e) => { fill = e.target.checked; } }), h('span', {}, 'Fill in the tab notes for this chord (edit them after)')) : null,
      preview,
      used.length ? h('div', { class: 'cp-group' }, h('div', { class: 'cp-label' }, 'In this song'), h('div', { class: 'chips' }, used.map(chip))) : null,
      h('div', { class: 'cp-label' }, 'Common chords'),
      ...COMMON_CHORDS.map(row => h('div', { class: 'chips' }, row.map(chip))),
      onClear && current ? h('div', { class: 'row end' }, btn('Remove chord', () => { s.close(); onClear(); }, { cls: 'danger ghost' })) : null);
    const s = sheet(title, body, { cls: 'picker' });
    upd();
  }

  function showDiagram(name) {
    const s = sheet(name, h('div', { class: 'diagram-pop' }, chordDiagram(name, song), song.capo ? h('p', { class: 'hint' }, `Shape shown relative to capo ${song.capo}.`) : null), { cls: 'small' });
    return s;
  }

  function toggleStrip() {
    if (screen.classList.toggle('strip-open')) {
      strip.innerHTML = '';
      const chords = songChords(song).map(showChord);
      strip.append(h('button', { class: 'icon-btn strip-close', type: 'button', 'aria-label': 'Close chord diagrams', onclick: toggleStrip }, icon('x')));
      if (!chords.length) strip.append(h('div', { class: 'hint pad' }, 'No chords in this song yet.'));
      chords.forEach(c => strip.append(chordDiagram(c, song)));
    }
  }

  // ---------- song settings
  function songSettings() {
    const inst = h('select', {}, Object.entries(INSTRUMENTS).map(([k, v]) => h('option', { value: k, selected: song.instrument === k }, v.name)));
    const title = h('input', { value: song.title, placeholder: 'Song title' });
    const artist = h('input', { value: song.artist, placeholder: 'Artist' });
    let instrument = song.instrument;
    const tp = tuningPicker({ instrument, tuning: song.instrument === 'piano' ? null : song.tuning });
    const keySel = keyPicker(song.key);
    inst.onchange = () => { instrument = inst.value; tp.setInstrument(instrument); capoRow.style.display = instrument === 'piano' ? 'none' : ''; };
    let capo = song.capo || 0;
    const capoVal = h('span', { class: 'stepper-val' }, capo ? 'Fret ' + capo : 'None');
    const capoRow = h('div', { class: 'stepper' },
      btn('', () => { capo = Math.max(0, capo - 1); capoVal.textContent = capo ? 'Fret ' + capo : 'None'; }, { icon: 'minus', cls: 'icon-only', title: 'Capo down' }), capoVal,
      btn('', () => { capo = Math.min(12, capo + 1); capoVal.textContent = 'Fret ' + capo; }, { icon: 'plus', cls: 'icon-only', title: 'Capo up' }));
    const beats = h('select', {}, [2, 3, 4, 5, 6, 7].map(n => h('option', { value: n, selected: (song.beats || 4) === n }, n + ' beats')));
    const subdiv = h('select', {}, [[1, 'Quarter notes'], [2, 'Eighth notes'], [3, 'Triplets'], [4, 'Sixteenths']].map(([n, l]) => h('option', { value: n, selected: (song.subdiv || 2) === n }, l)));
    const notes = h('textarea', { rows: 3, placeholder: 'Notes to self (strumming pattern, key, tempo…)' }, song.notes || '');
    const bpmIn = h('input', { type: 'number', inputmode: 'numeric', min: 30, max: 300, value: song.bpm || '', placeholder: 'e.g. 89' });
    const body = h('div', { class: 'form' },
      field('Title', title), field('Artist', artist), field('Instrument', inst),
      field('Tuning', tp.el, 'Strings low → high. Change any string individually.'),
      h('div', { class: 'two' }, field('Capo', capoRow, 'Shown above the first tab line.'), field(V.isMine(song) ? `Key (${stageName()})` : 'Key', keySel, 'Your version can be in its own key.')),
      h('div', { class: 'two' }, field('Bar length', beats), field('Beat boxes', subdiv)),
      field(V.isMine(song) ? `BPM (${stageName()} version)` : 'BPM', bpmIn, V.originalBpm(song) ? `Radio version: ${V.originalBpm(song)} BPM` : 'Each version (and your own) can have its own tempo.'),
      field('Notes', notes),
      h('div', { class: 'row end' },
        btn('Delete song', async () => { if (await confirmBox(`Delete "${song.title}"? This can't be undone.`)) { s.close(); S.deleteSong(song.id); nav('#/'); } }, { cls: 'danger ghost', icon: 'trash' }),
        btn('Duplicate', () => { const c = JSON.parse(JSON.stringify(song)); c.id = uid(); c.title += ' (copy)'; c.created = Date.now(); S.putSong(c); s.close(); nav('#/song/' + c.id + '?edit=1'); }, { cls: 'ghost', icon: 'copy' }),
        btn('Save', () => {
          pushUndo();
          song.title = title.value.trim() || 'Untitled'; song.artist = artist.value.trim();
          if (instrument !== song.instrument) {
            // switching instrument = switching to that instrument's version (made automatically the first time)
            const made = V.switchVersion(song, instrument, V.isMine(song));
            if (made === 'created' && instrument !== 'piano' && tp.tuning.length === song.tuning.length) { song.tuning = tp.tuning; song.tuningName = tp.name; }
            if (instrument !== 'piano' && made === 'created') song.capo = capo;
          } else {
            song.tuning = instrument === 'piano' ? [] : tp.tuning;
            song.tuningName = instrument === 'piano' ? '—' : tp.name;
            song.capo = instrument === 'piano' ? 0 : capo;
          }
          { const bv = Math.round(+bpmIn.value); song.bpm = bv >= 30 && bv <= 300 ? bv : null; }
          song.key = keySel.value || null;
          song.beats = +beats.value; song.subdiv = +subdiv.value; song.notes = notes.value;
          commit(); s.close(); cursor = null; renderAll(); renderKeypad(); buildBar();
        }, { cls: 'primary', icon: 'check' })));
    const s = sheet('Song settings', body);
    if (instrument === 'piano') capoRow.style.display = 'none';
  }

  // ---------- transpose / auto-scroll
  function transpose(d) { song.transpose = ((song.transpose || 0) + d + 18) % 12 - 6; if (song.transpose === -6 && d > 0) song.transpose = 6; commit(); renderAll(); buildBar(); }
  const auto = { on: false, raf: 0, acc: 0, last: 0 };
  const speedLabel = () => (song.scrollSpeed || 20) + '';
  function setSpeed(d) { song.scrollSpeed = Math.max(4, Math.min(160, (song.scrollSpeed || 20) + d * (song.scrollSpeed >= 40 ? 8 : 4))); commit(); buildBar(); }
  function toggleAuto() {
    auto.on = !auto.on;
    if (auto.on) { auto.acc = scroll.scrollTop; auto.last = performance.now(); auto.raf = requestAnimationFrame(stepAuto); }
    else cancelAnimationFrame(auto.raf);
    buildBar();
  }
  function stepAuto(t) {
    if (!auto.on) return;
    const dt = Math.min(0.1, (t - auto.last) / 1000); auto.last = t;
    if (Math.abs(scroll.scrollTop - auto.acc) > 3) auto.acc = scroll.scrollTop; // user scrolled by hand
    auto.acc += (song.scrollSpeed || 20) * dt;
    scroll.scrollTop = auto.acc;
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) { auto.on = false; buildBar(); return; }
    auto.raf = requestAnimationFrame(stepAuto);
  }

  // ---------- practice timer
  let paused = false, pending = 0, editPause = mode === 'edit'; // editing doesn't count as practice
  const goal = () => (S.db.settings.goal || 30) * 60;
  timerPill.onclick = (e) => { e.stopPropagation(); if (editPause) return toast('The timer restarts when you tap Done'); paused = !paused; updateTimer(); toast(paused ? 'Practice timer paused' : 'Practice timer running'); };
  function updateTimer() {
    const secs = S.practiceOn(S.dayKey()) + pending;
    const g = goal(), pct = Math.min(1, secs / g);
    const mm = Math.floor(secs / 60), ss = String(Math.floor(secs % 60)).padStart(2, '0');
    timerPill.innerHTML = '';
    timerPill.append(
      h('span', { class: 'ring', style: { '--p': pct } }),
      h('span', {}, editPause ? 'Editing ⏸' : paused ? 'Paused' : `${mm}:${ss}`),
      h('span', { class: 'goal' }, `/ ${S.db.settings.goal || 30}m`));
    timerPill.classList.toggle('met', secs >= g);
    handle.classList.toggle('met', secs >= g);
    handle.style.setProperty('--p', pct);
  }
  const tick = setInterval(() => {
    if (paused || editPause || document.visibilityState !== 'visible') return;
    const before = S.practiceOn(S.dayKey()) + pending;
    pending++;
    if (pending >= 10) { S.addPractice(pending); pending = 0; }
    const after = S.practiceOn(S.dayKey()) + pending;
    if (before < goal() && after >= goal()) celebrate();
    if (screen.classList.contains('bar-open')) updateTimer();
    else if (pending % 5 === 0) updateTimer();
  }, 1000);
  function celebrate() {
    const k = S.dayKey();
    const cel = { ...(S.db.settings.celebrated || {}) };
    if (cel[k]) return;
    cel[k] = true;
    // keep only recent entries
    for (const d of Object.keys(cel)) if (d < S.dayKey(new Date(Date.now() - 40 * 864e5))) delete cel[d];
    S.setSetting('celebrated', cel);
    const e = emojiRain();
    toast(`${e} Daily goal reached — ${S.db.settings.goal || 30} minutes! ${e}`, 4500);
  }

  // ---------- go
  screen.classList.toggle('editing', mode === 'edit');
  if (S.pref('barPinned', false)) screen.classList.add('bar-open');
  topColor();
  buildBar();
  renderAll();
  renderKeypad();
  if (mode === 'edit' && song.blocks.length === 1 && song.blocks[0].type === 'tab' && !song.blocks[0].measures.some(m => m.cols.some(c => c.c || c.n.some(Boolean)))) {
    toast('Tap a faint box above a beat to add a chord, or a string to add a note');
  }
  requestAnimationFrame(() => scroll.focus({ preventScroll: true }));

  return () => {
    if (pending) S.addPractice(pending);
    clearInterval(tick); cancelAnimationFrame(auto.raf); clearTimeout(barTimer);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    document.documentElement.classList.remove('stage');
  };
}
