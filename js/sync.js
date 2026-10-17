// Sync with a private GitHub Gist so iPad and iPhone share the same library.
import { db, replaceAll, onChange, pref, setPref } from './store.js';

const API = 'https://api.github.com';
const FILE = 'gift-of-tab.json';
const DESC = 'The Gift of Tab — app data (do not edit)';

const listeners = new Set();
export const status = { state: 'off', last: pref('sync.last', 0), error: '' };
function setStatus(state, error = '') { status.state = state; status.error = error; for (const f of listeners) f(status); }
export const onStatus = (f) => { listeners.add(f); return () => listeners.delete(f); };

export const isConnected = () => !!pref('sync.token') && !!pref('sync.gist');

async function gh(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + pref('sync.token'), Accept: 'application/vnd.github+json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  });
  if (!r.ok) {
    const msg = r.status === 401 ? 'GitHub token was rejected — check it or make a new one.' : r.status === 404 ? 'Sync file not found (or the token lacks the gist scope).' : `GitHub error ${r.status}`;
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

export async function connect(token) {
  setPref('sync.token', token.trim());
  setStatus('syncing');
  try {
    const user = await gh('/user');
    setPref('sync.user', user.login);
    // Find an existing data gist (from another device) or create one.
    let gist = null;
    for (let page = 1; page <= 5 && !gist; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      gist = list.find(g => g.files && g.files[FILE]);
      if (list.length < 100) break;
    }
    if (!gist) gist = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(db) } } }) });
    setPref('sync.gist', gist.id);
    await syncNow();
    return user.login;
  } catch (e) {
    setPref('sync.token', ''); setPref('sync.gist', '');
    setStatus('error', e.message); throw e;
  }
}

export function disconnect() { setPref('sync.token', ''); setPref('sync.gist', ''); setPref('sync.user', ''); setStatus('off'); }

function newer(a, b) { return (a?.updated || 0) >= (b?.updated || 0) ? a : b; }

export function merge(local, remote) {
  const out = { v: 1, songs: {}, playlists: {}, practice: {}, deleted: {}, settings: {}, push: {} };
  out.deleted = { ...(remote.deleted || {}) };
  for (const [k, v] of Object.entries(local.deleted || {})) out.deleted[k] = Math.max(v, out.deleted[k] || 0);
  for (const key of ['songs', 'playlists']) {
    const ids = new Set([...Object.keys(local[key] || {}), ...Object.keys(remote[key] || {})]);
    for (const id of ids) {
      const item = newer(local[key]?.[id], remote[key]?.[id]) || local[key]?.[id] || remote[key]?.[id];
      if (!item) continue;
      if (out.deleted[id] && out.deleted[id] >= (item.updated || 0)) continue;
      out[key][id] = item;
    }
  }
  const devs = new Set([...Object.keys(local.practice || {}), ...Object.keys(remote.practice || {})]);
  for (const d of devs) {
    const a = local.practice?.[d] || {}, b = remote.practice?.[d] || {};
    const days = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) days[k] = Math.max(a[k] || 0, b[k] || 0);
    out.practice[d] = days;
  }
  // notification sign-ups: one per device, newest wins
  for (const d of new Set([...Object.keys(local.push || {}), ...Object.keys(remote.push || {})])) {
    const a = local.push?.[d], b = remote.push?.[d];
    out.push[d] = (a?.updated || 0) >= (b?.updated || 0) ? (a || b) : b;
  }
  const ls = local.settings || {}, rs = remote.settings || {};
  out.settings = { ...((ls.updated || 0) >= (rs.updated || 0) ? ls : rs) };
  out.settings.celebrated = { ...(rs.celebrated || {}), ...(ls.celebrated || {}) };
  if (out.settings.goal == null) out.settings.goal = 30;
  return out;
}

let running = null, again = false;
export async function syncNow() {
  if (!isConnected()) return;
  if (running) { again = true; return running; }
  running = (async () => {
    setStatus('syncing');
    try {
      const gist = await gh('/gists/' + pref('sync.gist'));
      const f = gist.files[FILE];
      let remote = {};
      if (f) {
        let text = f.content;
        if (f.truncated) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
        try { remote = JSON.parse(text || '{}'); } catch { remote = {}; }
      }
      const merged = merge(db, remote);
      const mergedText = JSON.stringify(merged);
      if (mergedText !== JSON.stringify(db)) replaceAll(merged);
      if (mergedText !== JSON.stringify(remote)) {
        await gh('/gists/' + pref('sync.gist'), { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: mergedText } } }) });
      }
      status.last = Date.now(); setPref('sync.last', status.last);
      setStatus('ok');
    } catch (e) {
      setStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? e.message : 'Offline — changes are saved on this device and will sync later.');
    } finally {
      running = null;
      if (again) { again = false; setTimeout(syncNow, 500); }
    }
  })();
  return running;
}

// Auto-sync: quickly after edits, slowly for practice-time ticks.
let editTimer = null, practiceDirty = false;
onChange((kind) => {
  if (!isConnected() || kind === 'sync') return;
  if (kind === 'practice') { practiceDirty = true; return; }
  clearTimeout(editTimer); editTimer = setTimeout(syncNow, 3000);
});
setInterval(() => { if (practiceDirty && isConnected() && document.visibilityState === 'visible') { practiceDirty = false; syncNow(); } }, 120000);
document.addEventListener('visibilitychange', () => { if (!isConnected()) return; if (document.visibilityState === 'visible') syncNow(); else if (practiceDirty) { practiceDirty = false; syncNow(); } });
window.addEventListener('online', () => isConnected() && syncNow());
if (isConnected()) setStatus('ok');
