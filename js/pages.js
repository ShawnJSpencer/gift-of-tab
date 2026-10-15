// Home, playlists, practice calendar, concert, import, sync settings.
import { h, icon, btn, sheet, toast, confirmBox, field, fmtDate } from './ui.js';
import * as S from './store.js';
import * as Sync from './sync.js';
import { logo, countdownParts, emojiRain } from './art.js';
import { newSong } from './model.js';
import { importText, guessMeta, findBpm } from './importer.js';
import { hasMine } from './versions.js';

const instEmoji = { guitar: '🎸', ukulele: '🪕', piano: '🎹' };

// ================= HOME =================
export function homeScreen(root, nav) {
  const view = { tab: S.pref('home.tab', 'songs'), sort: S.pref('home.sort', 'title'), q: '' };
  const page = h('div', { class: 'home' });
  root.append(page);
  let cdTimer = null;

  function render() {
    page.innerHTML = '';
    page.append(h('header', { class: 'home-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Menu', onclick: () => window.openDrawer() }, icon('menu')),
      logo('lg'),
      syncDot(nav)));

    // --- hero: countdown · streak · today
    const st = S.streak();
    const today = S.practiceOn(S.dayKey());
    const goal = (S.db.settings.goal || 30) * 60;
    const pct = Math.min(1, today / goal);
    const concert = S.db.settings.concert;
    const cd = concert && countdownParts(concert.date);
    const cdCard = h('button', { class: 'card hero countdown', type: 'button', onclick: () => concertSheet(render) });
    if (cd && !cd.past) {
      cdCard.append(
        h('div', { class: 'hero-kicker' }, '🎤 ' + (concert.name || 'Concert') ),
        h('div', { class: 'cd-big' }, h('span', { class: 'num' }, cd.days), h('span', { class: 'unit' }, cd.days === 1 ? 'day to go' : 'days to go')),
        h('div', { class: 'cd-small' }, h('span', { class: 'cd-live' }), ' · ', cd.target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })));
      const tickCd = () => { const p = countdownParts(concert.date); const el = cdCard.querySelector('.cd-live'); if (el && p) el.textContent = `${p.hours}h ${p.mins}m ${String(p.secs).padStart(2, '0')}s`; };
      tickCd(); cdTimer = setInterval(tickCd, 1000);
    } else if (cd && cd.past) {
      cdCard.append(h('div', { class: 'hero-kicker' }, '🤘 ' + (concert.name || 'Concert')), h('div', { class: 'cd-big' }, h('span', { class: 'unit' }, 'Show time has passed!')), h('div', { class: 'cd-small' }, 'Tap to set your next concert date'));
    } else {
      cdCard.append(h('div', { class: 'hero-kicker' }, '🎤 Concert countdown'), h('div', { class: 'cd-big' }, h('span', { class: 'unit' }, 'Set your show date')), h('div', { class: 'cd-small' }, 'Tap to pick the big day'));
    }
    const streakCard = h('button', { class: 'card hero streak', type: 'button', onclick: () => nav('#/calendar') },
      h('div', { class: 'hero-kicker' }, '🔥 Streak'),
      h('div', { class: 'cd-big' }, h('span', { class: 'num' }, st), h('span', { class: 'unit' }, st === 1 ? 'day in a row' : 'days in a row')),
      h('div', { class: 'cd-small' }, st ? (today >= 60 ? 'You played today — keep it rolling!' : 'Play today to keep it going') : 'Play a tab to start a streak'));
    const todayCard = h('button', { class: 'card hero today', type: 'button', onclick: () => nav('#/calendar') },
      h('div', { class: 'hero-kicker' }, '⏱️ Today'),
      h('div', { class: 'today-row' },
        h('div', { class: 'big-ring', style: { '--p': pct } }, h('span', {}, Math.floor(today / 60))),
        h('div', {}, h('div', { class: 'today-min' }, `${Math.floor(today / 60)} of ${S.db.settings.goal || 30} min`), h('div', { class: 'cd-small' }, pct >= 1 ? 'Goal smashed 🎉' : 'Practice time counts while a tab is open'))));
    page.append(h('div', { class: 'hero-grid' }, cdCard, streakCard, todayCard));

    // --- file menu: new / import / recent
    const recent = S.songs().sort((a, b) => b.updated - a.updated).slice(0, 12);
    page.append(h('section', { class: 'file-menu' },
      h('h2', { class: 'sec-title' }, 'File'),
      h('div', { class: 'recent-strip' },
        h('button', { class: 'card file-card new', type: 'button', onclick: () => newSongSheet(nav) }, icon('plus'), h('b', {}, 'New tab')),
        h('button', { class: 'card file-card imp', type: 'button', onclick: () => importSheet(nav) }, icon('import'), h('b', {}, 'Import tab')),
        recent.map(s => h('button', { class: 'card file-card', type: 'button', onclick: () => nav('#/song/' + s.id) },
          h('span', { class: 'fc-inst' }, instEmoji[s.instrument] || '🎸'),
          h('b', { class: 'fc-title' }, s.title), h('span', { class: 'fc-artist' }, s.artist || '—'), h('span', { class: 'fc-when' }, 'Edited ' + fmtDate(s.updated)))))));

    // --- library
    const seg = (k, label) => h('button', { type: 'button', class: 'seg-btn' + (view.tab === k ? ' on' : ''), onclick: () => { view.tab = k; S.setPref('home.tab', k); render(); } }, label);
    const lib = h('section', { class: 'library' });
    lib.append(h('div', { class: 'lib-head' },
      h('div', { class: 'segmented' }, seg('songs', `Tabs (${S.songs().length})`), seg('playlists', `Playlists (${S.playlists().length})`))));
    if (view.tab === 'songs') {
      const sortBtn = (k, label) => h('button', { type: 'button', class: 'chip' + (view.sort === k ? ' on' : ''), onclick: () => { view.sort = k; S.setPref('home.sort', k); renderList(); } }, label);
      const search = h('input', { class: 'search', type: 'search', placeholder: 'Search tabs…', value: view.q, oninput: (e) => { view.q = e.target.value; renderList(); } });
      const listEl = h('div', { class: 'song-list' });
      const sortRow = h('div', { class: 'sort-row' }, h('span', { class: 'muted' }, 'Sort by'), sortBtn('title', 'Song title'), sortBtn('artist', 'Artist'), sortBtn('updated', 'Recent'));
      lib.append(h('div', { class: 'lib-tools' }, h('label', { class: 'search-wrap' }, icon('search'), search), sortRow), listEl);
      function renderList() {
        sortRow.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', ['title', 'artist', 'updated'][i] === view.sort));
        listEl.innerHTML = '';
        const q = view.q.toLowerCase();
        let list = S.songs().filter(s => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q));
        const key = (s) => (view.sort === 'artist' ? (s.artist || '~') + ' ' + s.title : s.title).toLowerCase();
        list.sort((a, b) => view.sort === 'updated' ? b.updated - a.updated : key(a).localeCompare(key(b)));
        if (!list.length) { listEl.append(h('div', { class: 'empty' }, S.songs().length ? 'No tabs match your search.' : 'No tabs yet — tap “New tab” or “Import tab” to get rolling. 🤘')); return; }
        let group = null;
        for (const s of list) {
          if (view.sort !== 'updated') {
            const g = view.sort === 'artist' ? (s.artist || 'Unknown artist') : (s.title[0] || '#').toUpperCase();
            if (g !== group) { group = g; listEl.append(h('div', { class: 'group-label' }, g)); }
          }
          listEl.append(songRow(s, nav, render));
        }
      }
      renderList();
    } else {
      const grid = h('div', { class: 'pl-grid' },
        h('button', { class: 'card pl-card new', type: 'button', onclick: () => { const p = S.newPlaylist('New playlist'); nav('#/playlist/' + p.id); } }, icon('plus'), h('b', {}, 'New playlist')),
        S.playlists().map((p, i) => h('button', { class: 'card pl-card c' + (i % 4), type: 'button', onclick: () => nav('#/playlist/' + p.id) },
          h('b', {}, p.name), h('span', {}, `${p.songIds.length} song${p.songIds.length === 1 ? '' : 's'}`))));
      lib.append(grid);
    }
    page.append(lib);
  }
  render();
  const off = S.onChange((k) => { if (k === 'sync') { clearInterval(cdTimer); render(); } });
  maybeCountdownPopup();
  return () => { clearInterval(cdTimer); off(); };
}

function songRow(s, nav, rerender) {
  const more = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More options', onclick: (e) => { e.stopPropagation(); songMenu(s, nav, rerender); } }, icon('dots'));
  return h('div', { class: 'song-row', role: 'button', tabindex: 0, onclick: () => nav('#/song/' + s.id), onkeydown: (e) => { if (e.key === 'Enter') nav('#/song/' + s.id); } },
    h('span', { class: 'sr-inst' }, instEmoji[s.instrument] || '🎸'),
    h('div', { class: 'sr-main' }, h('b', {}, s.title), h('span', {}, s.artist || '—')),
    hasMine(s) ? h('span', { class: 'tag mine' }, '★ ' + ((S.db.settings.stageName || '').trim() || 'Olden Gray')) : null,
    s.capo ? h('span', { class: 'tag' }, 'Capo ' + s.capo) : null,
    s.instrument !== 'piano' && s.tuningName && !/^Standard/.test(s.tuningName) ? h('span', { class: 'tag t2' }, s.tuningName) : null,
    more);
}

function songMenu(s, nav, rerender) {
  const pls = S.playlists();
  const sh = sheet(s.title, h('div', { class: 'menu-list' },
    btn('Open', () => { sh.close(); nav('#/song/' + s.id); }, { icon: 'music' }),
    btn('Edit', () => { sh.close(); nav('#/song/' + s.id + '?edit=1'); }, { icon: 'edit' }),
    h('div', { class: 'cp-label' }, 'Add to playlist'),
    pls.length ? pls.map(p => btn((p.songIds.includes(s.id) ? '✓ ' : '+ ') + p.name, () => {
      if (!p.songIds.includes(s.id)) { p.songIds.push(s.id); S.touchPlaylist(p); toast(`Added to ${p.name}`); }
      sh.close();
    }, { cls: 'ghost' })) : h('p', { class: 'hint' }, 'No playlists yet.'),
    btn('New playlist with this song', () => { const p = S.newPlaylist('New playlist'); p.songIds.push(s.id); S.touchPlaylist(p); sh.close(); nav('#/playlist/' + p.id); }, { cls: 'ghost', icon: 'plus' }),
    h('hr'),
    btn('Delete tab', async () => { if (await confirmBox(`Delete "${s.title}"?`)) { S.deleteSong(s.id); sh.close(); rerender(); } }, { cls: 'danger ghost', icon: 'trash' })), { cls: 'small' });
}

function syncDot(nav) {
  const dot = h('button', { class: 'sync-dot', type: 'button', onclick: () => nav('#/settings'), title: 'Sync' }, icon('cloud'), h('span', {}));
  const upd = (st) => {
    dot.dataset.state = Sync.isConnected() ? st.state : 'off';
    dot.lastChild.textContent = !Sync.isConnected() ? 'Not synced' : st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync problem' : st.state === 'offline' ? 'Offline' : 'Synced';
  };
  upd(Sync.status);
  const off = Sync.onStatus(upd);
  const mo = new MutationObserver(() => { if (!dot.isConnected) { off(); mo.disconnect(); } });
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
  return dot;
}

// ================= COUNTDOWN POPUP =================
function maybeCountdownPopup() {
  const c = S.db.settings.concert;
  if (!c || !c.date) return;
  const p = countdownParts(c.date);
  if (!p || p.past) return;
  const k = S.dayKey();
  if (S.pref('cdPopup') === k) return;
  S.setPref('cdPopup', k);
  setTimeout(() => showCountdown(), 400);
}
export function showCountdown() {
  const c = S.db.settings.concert; if (!c) return;
  const box = h('div', { class: 'cd-pop' });
  const units = ['days', 'hours', 'mins', 'secs'];
  const cells = units.map(u => h('div', { class: 'cd-cell ' + u }, h('b', {}, '0'), h('span', {}, u)));
  box.append(h('div', { class: 'cd-pop-title' }, c.name || 'The big show'),
    h('div', { class: 'cd-cells' }, cells),
    h('div', { class: 'cd-pop-date' }, countdownParts(c.date).target.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
  const upd = () => { const p = countdownParts(c.date); if (!p) return; units.forEach((u, i) => { cells[i].firstChild.textContent = Math.max(0, p[u]); }); };
  upd();
  const t = setInterval(upd, 1000);
  sheet('🎤 Countdown to the stage', box, { cls: 'cd-sheet', onClose: () => clearInterval(t) });
  emojiRain('🎸');
}

export function concertSheet(after) {
  const c = S.db.settings.concert || {};
  const name = h('input', { value: c.name || '', placeholder: 'e.g. Summer Showcase' });
  const [d0, t0] = (c.date || '').split('T');
  const date = h('input', { type: 'date', value: d0 || '' });
  const time = h('input', { type: 'time', value: (t0 || '19:00').slice(0, 5) });
  const s = sheet('Concert date', h('div', { class: 'form' },
    field('Show name', name), h('div', { class: 'two' }, field('Date', date), field('Start time', time)),
    h('div', { class: 'row end' },
      c.date ? btn('Clear', () => { S.setSetting('concert', null); s.close(); after && after(); }, { cls: 'ghost danger' }) : null,
      btn('Save', () => {
        if (!date.value) return toast('Pick a date');
        S.setSetting('concert', { name: name.value.trim(), date: date.value + 'T' + (time.value || '19:00') + ':00' });
        s.close(); after && after(); S.setPref('cdPopup', S.dayKey()); showCountdown();
      }, { cls: 'primary', icon: 'check' }))), { cls: 'small' });
}

// ================= NEW / IMPORT =================
export function newSongSheet(nav) {
  const make = (inst) => { const s = newSong(inst); S.putSong(s); sh.close(); nav('#/song/' + s.id + '?edit=1'); };
  const sh = sheet('New tab', h('div', { class: 'inst-pick' },
    h('button', { type: 'button', class: 'card inst', onclick: () => make('guitar') }, h('span', { class: 'big-emoji' }, '🎸'), h('b', {}, 'Guitar'), h('span', {}, '6-string · standard EADGBE')),
    h('button', { type: 'button', class: 'card inst', onclick: () => make('ukulele') }, h('span', { class: 'big-emoji' }, '🪕'), h('b', {}, 'Ukulele'), h('span', {}, 'GCEA')),
    h('button', { type: 'button', class: 'card inst', onclick: () => make('piano') }, h('span', { class: 'big-emoji' }, '🎹'), h('b', {}, 'Piano'), h('span', {}, 'Chords & lyrics'))), { cls: 'small' });
}

export function importSheet(nav) {
  const ta = h('textarea', { class: 'import-ta', rows: 12, spellcheck: false, placeholder: 'Paste the whole tab here — chords over lyrics, tab lines (e|---3---), ChordPro, section names like [Chorus]…' });
  const title = h('input', { placeholder: 'Song title' }), artist = h('input', { placeholder: 'Artist' });
  const bpm = h('input', { type: 'number', inputmode: 'numeric', min: 30, max: 300, placeholder: 'e.g. 89', class: 'bpm-input' });
  const inst = h('select', {}, h('option', { value: 'auto' }, 'Detect automatically'), h('option', { value: 'guitar' }, 'Guitar'), h('option', { value: 'ukulele' }, 'Ukulele'), h('option', { value: 'piano' }, 'Piano (chords)'));
  ta.addEventListener('input', () => { const g = guessMeta(ta.value); if (g.title && !title.value) title.value = g.title; if (g.artist && !artist.value) artist.value = g.artist; const b = findBpm(ta.value); if (b && !bpm.value) bpm.value = b; });
  const paste = btn('Paste text', async () => { try { ta.value = await navigator.clipboard.readText(); ta.dispatchEvent(new Event('input')); } catch { toast('Tap in the box and paste instead'); ta.focus(); } }, { cls: 'ghost small', icon: 'copy' });
  const pdfNote = h('p', { class: 'hint pdf-note' });
  const inp = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'hidden', onchange: async () => {
      const f = inp.files[0]; if (!f) return;
      pdfBtn.disabled = true; pdfNote.textContent = 'Reading the PDF…';
      try {
        const { pdfToTabText } = await import('./pdfimport.js');
        const r = await pdfToTabText(f, (p, n) => { pdfNote.textContent = `Reading page ${p} of ${n}…`; });
        if (!r.text.trim()) {
          pdfNote.textContent = r.scanned ? 'Couldn\'t find any tab in this PDF — it may be a photo or a blurry scan.' : 'No tab or text was found in this PDF.';
        } else {
          ta.value = r.text;
          if (r.title && !title.value) title.value = r.title;
          if (r.artist && !artist.value) artist.value = r.artist;
          ta.dispatchEvent(new Event('input'));
          if (!title.value) title.value = f.name.replace(/\.pdf$/i, '');
          pdfNote.textContent = `Read ${r.pages} page${r.pages === 1 ? '' : 's'}` + (r.staves ? ` and ${r.staves} tab line${r.staves === 1 ? '' : 's'}` : '') + '. Check it below, fix anything odd, then tap Import.' +
            (r.ocr ? ' Some of the tab was drawn as pictures and read by shape — give the numbers a quick check.' : '') +
            (r.scanned ? ` (${r.scanned} page${r.scanned === 1 ? '' : 's'} couldn't be read.)` : '');
        }
      } catch (e) { console.error(e); pdfNote.textContent = 'Sorry — that PDF couldn\'t be opened (' + (e.message || e) + ').'; }
      pdfBtn.disabled = false; inp.value = '';
    } });
  const pdfBtn = btn('Open a PDF', () => inp.click(), { cls: 'small', icon: 'import' });
  const s = sheet('Import a tab', h('div', { class: 'form' },
    h('p', { class: 'hint' }, 'Paste tab text copied from Ultimate Guitar, Songsterr or any site — or open a PDF tab (Guitar Pro, Songsterr and other downloaded/printed PDFs). Chords, six-line tab, lyrics and section names become an editable tab.'),
    h('div', { class: 'row' }, paste, pdfBtn, inp), pdfNote, ta,
    h('div', { class: 'two' }, field('Title', title), field('Artist', artist)),
    h('div', { class: 'two' }, field('Instrument', inst), field('BPM (radio version)', bpm, 'Optional — you can set it later too.')),
    h('div', { class: 'row end' }, btn('Import', () => {
      if (!ta.value.trim()) return toast('Paste a tab first');
      const g = guessMeta(ta.value);
      const song = importText(ta.value, { title: title.value.trim() || g.title, artist: artist.value.trim() || g.artist, metaLine: g.metaLine, instrument: inst.value });
      const bv = +bpm.value; if (bv >= 30 && bv <= 300) song.bpm = Math.round(bv);
      if (inst.value === 'ukulele' && song.instrument !== 'ukulele' && !song.blocks.some(b => b.type === 'tab')) { song.instrument = 'ukulele'; song.tuning = ['G', 'C', 'E', 'A']; song.tuningName = 'Standard (GCEA)'; }
      S.putSong(song); s.close(); toast('Imported! Tap Edit to customise.'); nav('#/song/' + song.id);
    }, { cls: 'primary', icon: 'import' }))));
  setTimeout(() => ta.focus(), 300);
}

// ================= PLAYLIST =================
export function playlistScreen(root, id, nav) {
  const p = S.db.playlists[id];
  const page = h('div', { class: 'page' });
  root.append(page);
  if (!p) { page.append(h('div', { class: 'empty' }, 'Playlist not found.'), btn('Home', () => nav('#/'), { cls: 'primary' })); return; }
  function render() {
    page.innerHTML = '';
    const name = h('input', { class: 'pl-name', value: p.name, 'aria-label': 'Playlist name', oninput: (e) => { p.name = e.target.value; S.touchPlaylist(p); } });
    page.append(pageHead(nav, name),
      h('div', { class: 'row wrap' },
        btn('Play from the top', () => p.songIds.length ? nav(`#/song/${p.songIds[0]}?pl=${p.id}`) : toast('Add some songs first'), { cls: 'primary big', icon: 'play' }),
        btn('Add tabs', () => addSongs(p, render), { icon: 'plus' }),
        btn('Delete playlist', async () => { if (await confirmBox(`Delete the playlist "${p.name}"? The tabs stay in your library.`)) { S.deletePlaylist(p.id); nav('#/'); } }, { cls: 'ghost danger', icon: 'trash' })));
    const list = h('ol', { class: 'pl-list' });
    p.songIds.forEach((sid, i) => {
      const s = S.getSong(sid); if (!s) return;
      const mv = (d) => { const j = i + d; if (j < 0 || j >= p.songIds.length) return; p.songIds.splice(i, 1); p.songIds.splice(j, 0, sid); S.touchPlaylist(p); render(); };
      list.append(h('li', { class: 'pl-item' },
        h('span', { class: 'pl-num' }, i + 1),
        h('button', { class: 'pl-open', type: 'button', onclick: () => nav(`#/song/${sid}?pl=${p.id}`) }, h('b', {}, s.title), h('span', {}, s.artist || '')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move up', onclick: () => mv(-1), disabled: i === 0 }, icon('up')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move down', onclick: () => mv(1), disabled: i === p.songIds.length - 1 }, icon('down')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove from playlist', onclick: () => { p.songIds.splice(i, 1); S.touchPlaylist(p); render(); } }, icon('x'))));
    });
    page.append(p.songIds.length ? list : h('div', { class: 'empty' }, 'No songs yet — tap “Add tabs”.'));
    page.append(h('p', { class: 'hint' }, 'On stage: swipe left/right on a song to move through the playlist, or use the arrows in the hidden menu.'));
  }
  render();
}

function addSongs(p, after) {
  const chosen = new Set(p.songIds);
  const list = S.songs().sort((a, b) => a.title.localeCompare(b.title));
  const s = sheet('Add tabs to ' + p.name, h('div', { class: 'form' },
    list.length ? h('div', { class: 'check-list' }, list.map(song => h('label', { class: 'check-row' },
      h('input', { type: 'checkbox', checked: chosen.has(song.id), onchange: (e) => e.target.checked ? chosen.add(song.id) : chosen.delete(song.id) }),
      h('span', {}, h('b', {}, song.title), ' ', h('span', { class: 'muted' }, song.artist || ''))))) : h('p', {}, 'No tabs in your library yet.'),
    h('div', { class: 'row end' }, btn('Done', () => {
      p.songIds = [...p.songIds.filter(id => chosen.has(id)), ...[...chosen].filter(id => !p.songIds.includes(id))];
      S.touchPlaylist(p); s.close(); after();
    }, { cls: 'primary', icon: 'check' }))));
}

function pageHead(nav, titleEl) {
  return h('header', { class: 'page-head' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Menu', onclick: () => window.openDrawer() }, icon('menu')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Home', onclick: () => nav('#/') }, icon('home')),
    typeof titleEl === 'string' ? h('h1', {}, titleEl) : titleEl);
}

// ================= CALENDAR =================
export function calendarScreen(root, nav) {
  const page = h('div', { class: 'page' });
  root.append(page);
  const now = new Date();
  let ym = { y: now.getFullYear(), m: now.getMonth() };
  function render() {
    page.innerHTML = '';
    const all = S.practiceDays();
    const goal = (S.db.settings.goal || 30) * 60;
    const first = new Date(ym.y, ym.m, 1);
    const daysIn = new Date(ym.y, ym.m + 1, 0).getDate();
    let monthTotal = 0, monthDays = 0;
    const grid = h('div', { class: 'cal-grid' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => h('div', { class: 'cal-dow' }, d)));
    for (let i = 0; i < first.getDay(); i++) grid.append(h('div', { class: 'cal-day blank' }));
    const concertDay = S.db.settings.concert?.date?.slice(0, 10);
    for (let d = 1; d <= daysIn; d++) {
      const k = S.dayKey(new Date(ym.y, ym.m, d));
      const secs = all[k] || 0;
      if (secs >= 60) { monthDays++; monthTotal += secs; }
      const cls = secs >= goal ? 'met' : secs >= 60 ? 'some' : '';
      grid.append(h('div', { class: `cal-day ${cls}${k === S.dayKey() ? ' today' : ''}${k === concertDay ? ' concert' : ''}`, title: secs ? `${Math.round(secs / 60)} min` : '' },
        h('span', { class: 'd' }, d),
        secs >= goal ? h('span', { class: 'e' }, '⭐') : k === concertDay ? h('span', { class: 'e' }, '🎤') : secs >= 60 ? h('span', { class: 'm' }, Math.round(secs / 60) + 'm') : null));
    }
    const goalVal = h('span', { class: 'stepper-val' }, (S.db.settings.goal || 30) + ' min');
    const step = (d) => { S.setSetting('goal', Math.max(5, Math.min(240, (S.db.settings.goal || 30) + d))); render(); };
    page.append(pageHead(nav, 'Practice'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat s1' }, h('b', {}, S.streak()), h('span', {}, 'day streak 🔥')),
        h('div', { class: 'stat s2' }, h('b', {}, S.bestStreak()), h('span', {}, 'best streak 🏆')),
        h('div', { class: 'stat s3' }, h('b', {}, monthDays), h('span', {}, 'days played this month')),
        h('div', { class: 'stat s4' }, h('b', {}, Math.round(monthTotal / 60)), h('span', {}, 'minutes this month'))),
      h('div', { class: 'card goal-card' }, h('b', {}, 'Daily goal'),
        h('div', { class: 'stepper' }, btn('', () => step(-5), { icon: 'minus', cls: 'icon-only', title: 'Less' }), goalVal, btn('', () => step(5), { icon: 'plus', cls: 'icon-only', title: 'More' })),
        h('span', { class: 'hint' }, 'Time counts while a tab is open. Hit the goal for an emoji party 🎉')),
      h('div', { class: 'card cal' },
        h('div', { class: 'cal-head' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onclick: () => { ym.m--; if (ym.m < 0) { ym.m = 11; ym.y--; } render(); } }, icon('back')),
          h('b', {}, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', onclick: () => { ym.m++; if (ym.m > 11) { ym.m = 0; ym.y++; } render(); } }, icon('next'))),
        grid,
        h('div', { class: 'cal-legend' }, h('span', { class: 'lg some' }), 'Played', h('span', { class: 'lg met' }), 'Goal met ⭐', h('span', {}, '🎤 Concert'))),
      h('div', { class: 'row' }, btn('Concert date', () => concertSheet(render), { icon: 'star' }), btn('Test the emoji party', () => emojiRain(), { cls: 'ghost' })));
  }
  render();
}

// ================= SETTINGS / SYNC =================
export function settingsScreen(root, nav) {
  const page = h('div', { class: 'page' });
  root.append(page);
  function render() {
    page.innerHTML = '';
    page.append(pageHead(nav, 'Sync & settings'));
    const st = Sync.status;
    const card = h('div', { class: 'card form' });
    if (Sync.isConnected()) {
      card.append(h('h2', {}, '☁️ Syncing with GitHub'),
        h('p', {}, 'Signed in as ', h('b', {}, S.pref('sync.user') || 'GitHub'), '. Your tabs, playlists, concert date and practice history are saved to a private Gist and shared between your devices.'),
        h('p', { class: 'hint' }, st.state === 'error' || st.state === 'offline' ? '⚠️ ' + st.error : st.last ? 'Last synced ' + fmtDate(st.last) : ''),
        h('div', { class: 'row' },
          btn('Sync now', async () => { await Sync.syncNow(); render(); toast(Sync.status.state === 'ok' ? 'Synced ✓' : Sync.status.error); }, { cls: 'primary', icon: 'sync' }),
          btn('Disconnect this device', async () => { if (await confirmBox('Stop syncing on this device? Your tabs stay here and in the Gist.', 'Disconnect')) { Sync.disconnect(); render(); } }, { cls: 'ghost' })));
    } else {
      const tok = h('input', { type: 'password', placeholder: 'ghp_… or github_pat_…', autocomplete: 'off' });
      card.append(h('h2', {}, '☁️ Sync between iPad & iPhone'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Open ', h('a', { href: 'https://github.com/settings/tokens/new?scopes=gist&description=The%20Gift%20of%20Tab', target: '_blank', rel: 'noopener' }, 'this GitHub page'), ' (signed in as ShawnJSpencer).'),
          h('li', {}, 'Set Expiration to “No expiration”, keep only the ', h('b', {}, 'gist'), ' box ticked, and tap “Generate token”.'),
          h('li', {}, 'Copy the token and paste it below. Do the same on your other device — use the same token or make a second one.')),
        field('GitHub token', tok, 'Stored only on this device. It can only read/write your Gists.'),
        h('div', { class: 'row' }, btn('Connect', async () => {
          if (!tok.value.trim()) return toast('Paste your token first');
          try { const u = await Sync.connect(tok.value); toast('Connected as ' + u + ' ✓'); render(); } catch (e) { toast(e.message, 4000); render(); }
        }, { cls: 'primary', icon: 'cloud' })),
        h('p', { class: 'hint err' }, st.state === 'error' ? st.error : ''));
    }
    page.append(card);

    const stageIn = h('input', { value: S.db.settings.stageName || 'Olden Gray', placeholder: 'Olden Gray', onchange: (e) => { S.setSetting('stageName', e.target.value.trim() || 'Olden Gray'); toast('Stage name saved ★'); } });
    page.append(h('div', { class: 'card form' }, h('h2', {}, '★ Stage name'),
      field('Your stage name', stageIn, 'Shown on the gold star in every song. Tap it to switch between the original tab and your own version (your key, your chord choices).')));
    page.append(h('div', { class: 'card form' }, h('h2', {}, 'Performance'),
      h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: S.pref('tapPage', true), onchange: (e) => S.setPref('tapPage', e.target.checked) }), h('span', {}, 'Tap the bottom of the screen to page down (top to page up) while viewing a tab')),
      h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: S.pref('stage', false), onchange: (e) => S.setPref('stage', e.target.checked) }), h('span', {}, 'Stage mode (dark screen) for tabs')),
      h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: S.pref('wake', true), onchange: (e) => { S.setPref('wake', e.target.checked); } }), h('span', {}, 'Keep the screen awake while a tab is open'))));

    page.append(h('div', { class: 'card form' }, h('h2', {}, 'Backup'),
      h('p', { class: 'hint' }, 'A backup file is a safety net in addition to sync.'),
      h('div', { class: 'row wrap' },
        btn('Download backup', () => {
          const blob = new Blob([JSON.stringify(S.db, null, 1)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `gift-of-tab-backup-${S.dayKey()}.json` }); document.body.append(a); a.click(); a.remove();
        }, { icon: 'import' }),
        btn('Restore from backup', () => {
          const inp = h('input', { type: 'file', accept: '.json,application/json', onchange: async () => {
            try {
              const data = JSON.parse(await inp.files[0].text());
              if (!data.songs) throw new Error('Not a Gift of Tab backup');
              S.replaceAll(Sync.merge(S.db, data)); toast('Backup merged in ✓'); Sync.syncNow();
            } catch (e) { toast(e.message); }
          } }); inp.click();
        }, { cls: 'ghost' }))));
  }
  render();
}
