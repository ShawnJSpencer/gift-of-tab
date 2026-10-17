// Push notifications: each device subscribes here; the scheduled GitHub job (.github/notify) sends.
import * as S from './store.js';

export const VAPID_PUBLIC = 'BLYmZi7Sd0gEUF9tCNrB7gw2HaIrGbV39XvbBkxlCbxfSn4luFx6wVKS8vFba7fwG9uSdsXrwrbSixct8jdjonA';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function status() {
  if (!supported()) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const mine = (S.db.push || {})[S.deviceId];
  return mine && mine.sub && !mine.off && Notification.permission === 'granted' ? 'on' : 'off';
}

const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return /Mac/.test(ua) ? 'Mac' : 'Computer';
}

// Must be called from a tap (browsers only allow the permission prompt then).
export async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this app — allow them in Settings → Notifications.' : 'Notifications were not allowed.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) });
  S.db.push = S.db.push || {};
  S.db.push[S.deviceId] = { sub: sub.toJSON(), name: deviceName(), updated: Date.now() };
  const n = { ...(S.db.settings.notify || {}) };
  n.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || n.tz || 'America/Denver';
  if (!n.time) n.time = '20:00';
  S.setSetting('notify', n); // also saves + syncs
}

export async function disable() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
  S.db.push = S.db.push || {};
  S.db.push[S.deviceId] = { off: true, name: deviceName(), updated: Date.now() };
  S.save();
}

// A local test: shows a notification on this device straight away (checks permission + display).
export async function localTest() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('🎸 The Gift of Tab', { body: 'Notifications are on for this device 🤘', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'gotab-test' });
}
