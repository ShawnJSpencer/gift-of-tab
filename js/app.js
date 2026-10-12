// The Gift of Tab — app shell: routing, pop-out menu, offline support.
import { h, icon } from './ui.js';
import * as S from './store.js';
import * as Sync from './sync.js';
import { logo } from './art.js';
import { songScreen } from './song.js';
import { homeScreen, playlistScreen, calendarScreen, settingsScreen, newSongSheet, importSheet, concertSheet } from './pages.js';

const app = document.getElementById('app');
let cleanup = null;

function nav(hash) { if (location.hash === hash) route(); else location.hash = hash; }

// ---- pop-out menu
const drawer = h('nav', { class: 'drawer', 'aria-label': 'Main menu' });
const scrim = h('div', { class: 'scrim', onclick: closeDrawer });
document.body.append(scrim, drawer);
function closeDrawer() { document.body.classList.remove('drawer-open'); }
window.openDrawer = () => {
  drawer.innerHTML = '';
  const item = (ico, label, fn) => h('button', { type: 'button', class: 'dr-item', onclick: () => { closeDrawer(); fn(); } }, icon(ico), h('span', {}, label));
  const pls = S.playlists();
  drawer.append(
    h('div', { class: 'dr-logo' }, logo('md')),
    item('home', 'Home', () => nav('#/')),
    item('plus', 'New tab', () => newSongSheet(nav)),
    item('import', 'Import tab', () => importSheet(nav)),
    item('cal', 'Practice calendar', () => nav('#/calendar')),
    item('star', 'Concert date', () => concertSheet(() => route())),
    item('cloud', 'Sync & settings', () => nav('#/settings')),
    pls.length ? h('div', { class: 'dr-label' }, 'Playlists') : null,
    ...pls.map(p => item('list', p.name, () => nav('#/playlist/' + p.id))),
    h('div', { class: 'dr-foot' }, Sync.isConnected() ? '☁️ Synced via GitHub' : 'Not syncing yet'));
  document.body.classList.add('drawer-open');
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// ---- keep screen awake on tabs (stage!)
let wake = null;
async function setWake(on) {
  try {
    if (on && S.pref('wake', true) && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash.startsWith('#/song/')) setWake(true); });

// ---- router
function route() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  closeDrawer();
  document.querySelectorAll('.sheet-wrap').forEach(s => s.remove());
  app.innerHTML = '';
  window.scrollTo(0, 0);
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  document.body.dataset.screen = parts[0] || 'home';
  setWake(parts[0] === 'song');
  if (parts[0] === 'song') cleanup = songScreen(app, parts[1], { pl: q.get('pl'), edit: q.get('edit') === '1' }, nav);
  else if (parts[0] === 'playlist') cleanup = playlistScreen(app, parts[1], nav);
  else if (parts[0] === 'calendar') cleanup = calendarScreen(app, nav);
  else if (parts[0] === 'settings') cleanup = settingsScreen(app, nav);
  else cleanup = homeScreen(app, nav);
}
window.addEventListener('hashchange', route);
route();

// When another device's changes arrive, refresh views that aren't mid-edit.
S.onChange((kind) => {
  if (kind !== 'sync') return;
  const scr = document.body.dataset.screen;
  if (scr === 'song' || scr === 'home') return; // song stays put mid-performance; home refreshes itself
  route();
});

Sync.syncNow();

// ---- offline support
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
