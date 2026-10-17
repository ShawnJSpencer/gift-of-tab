// Local data store (localStorage) + change notifications.
import { uid, now } from './model.js';

const KEY = 'gotab.data.v1';
const DEV = 'gotab.device';
const LOCAL = 'gotab.local'; // per-device view prefs (font size, stage mode…)

export const deviceId = (() => {
  let d = null; try { d = localStorage.getItem(DEV); } catch {}
  if (!d) { d = 'dev-' + uid(); try { localStorage.setItem(DEV, d); } catch {} }
  return d;
})();

function blank() {
  return {
    v: 1, songs: {}, playlists: {}, practice: {}, deleted: {}, push: {},
    settings: { goal: 30, concert: null, celebrated: {}, updated: 0 },
  };
}

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.songs) return Object.assign(blank(), s); } catch {}
  return blank();
}

export const db = load();
const listeners = new Set();
let saveTimer = null;

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function save(kind = 'edit') {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('save failed', e); } }, 150);
  for (const fn of listeners) fn(kind);
}
export function saveNow() { clearTimeout(saveTimer); try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }
window.addEventListener('pagehide', saveNow);

export function replaceAll(data) {
  // Keep the same song/playlist objects where possible so open screens stay bound to live data.
  const keep = { songs: db.songs || {}, playlists: db.playlists || {} };
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, blank(), data);
  for (const coll of ['songs', 'playlists']) for (const [id, obj] of Object.entries(db[coll])) {
    const old = keep[coll][id];
    if (old && old !== obj) { for (const k of Object.keys(old)) delete old[k]; Object.assign(old, obj); db[coll][id] = old; }
  }
  saveNow();
  for (const fn of listeners) fn('sync');
}

// ---- songs
export const songs = () => Object.values(db.songs);
export const getSong = (id) => db.songs[id];
export function putSong(s) { s.updated = now(); db.songs[s.id] = s; save(); return s; }
export function deleteSong(id) {
  delete db.songs[id]; db.deleted[id] = now();
  for (const p of Object.values(db.playlists)) if (p.songIds.includes(id)) { p.songIds = p.songIds.filter(x => x !== id); p.updated = now(); }
  save();
}
export function touchSong(s) { s.updated = now(); save(); }

// ---- playlists
export const playlists = () => Object.values(db.playlists).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
export function newPlaylist(name) { const p = { id: uid(), name: name || 'New playlist', songIds: [], created: now(), updated: now() }; db.playlists[p.id] = p; save(); return p; }
export function touchPlaylist(p) { p.updated = now(); save(); }
export function deletePlaylist(id) { delete db.playlists[id]; db.deleted[id] = now(); save(); }

// ---- settings
export function setSetting(k, v) { db.settings[k] = v; db.settings.updated = now(); save(); }

// ---- practice (seconds per local date, per device so devices never overwrite each other)
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addPractice(seconds) {
  const k = dayKey();
  const mine = (db.practice[deviceId] ||= {});
  mine[k] = (mine[k] || 0) + seconds;
  save('practice');
}
export function practiceOn(k) {
  let t = 0; for (const dev of Object.values(db.practice)) t += dev[k] || 0; return t;
}
export function practiceDays() {
  const all = {};
  for (const dev of Object.values(db.practice)) for (const [k, v] of Object.entries(dev)) all[k] = (all[k] || 0) + v;
  return all;
}
const MIN_DAY = 60; // a day "counts" after 1 minute of practice
export function streak() {
  const all = practiceDays();
  const d = new Date();
  if ((all[dayKey(d)] || 0) < MIN_DAY) d.setDate(d.getDate() - 1); // today not played yet — streak still alive from yesterday
  let n = 0;
  while ((all[dayKey(d)] || 0) >= MIN_DAY) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function bestStreak() {
  const keys = Object.entries(practiceDays()).filter(([, v]) => v >= MIN_DAY).map(([k]) => k).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const d = new Date(k + 'T12:00:00');
    if (prev && (d - prev) / 864e5 < 1.5) run++; else run = 1;
    best = Math.max(best, run); prev = d;
  }
  return best;
}

// ---- per-device prefs (not synced)
const localPrefs = (() => { try { return JSON.parse(localStorage.getItem(LOCAL)) || {}; } catch { return {}; } })();
export const pref = (k, d) => (k in localPrefs ? localPrefs[k] : d);
export function setPref(k, v) { localPrefs[k] = v; try { localStorage.setItem(LOCAL, JSON.stringify(localPrefs)); } catch {} }
