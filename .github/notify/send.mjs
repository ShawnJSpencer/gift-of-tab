// Runs on a schedule (GitHub Actions). Reads your synced Gift of Tab data from your private Gist,
// decides which reminders are due, and sends them to every device that turned notifications on.
import webpush from 'web-push';
import { decide } from './logic.mjs';

const TOKEN = process.env.GIST_TOKEN, PRIVATE = process.env.VAPID_PRIVATE_KEY;
const PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BLYmZi7Sd0gEUF9tCNrB7gw2HaIrGbV39XvbBkxlCbxfSn4luFx6wVKS8vFba7fwG9uSdsXrwrbSixct8jdjonA';
const DATA = 'gift-of-tab.json', STATE = 'gift-of-tab-notify.json';
if (!TOKEN || !PRIVATE) { console.log('GIST_TOKEN / VAPID_PRIVATE_KEY secrets are not set yet — nothing to do.'); process.exit(0); }

const gh = async (path, opts = {}) => {
  const r = await fetch('https://api.github.com' + path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}`);
  return r.json();
};
const fileText = async (f) => (f.truncated ? (await fetch(f.raw_url)).text() : f.content);

// find the data gist (same way the app does)
let gist = null;
for (let page = 1; page <= 5 && !gist; page++) {
  const list = await gh(`/gists?per_page=100&page=${page}`);
  gist = list.find(g => g.files && g.files[DATA]);
  if (list.length < 100) break;
}
if (!gist) { console.log('No Gift of Tab sync data found yet.'); process.exit(0); }
gist = await gh(`/gists/${gist.id}`);
const db = JSON.parse(await fileText(gist.files[DATA]));
const state = gist.files[STATE] ? JSON.parse(await fileText(gist.files[STATE])) : { sent: {}, dead: {} };
state.sent ||= {}; state.dead ||= {};

const subs = Object.entries(db.push || {}).filter(([, v]) => v && v.sub && !v.off && !state.dead[v.sub.endpoint]);
const due = process.env.TEST_NOTIFY ? [{ id: 'test:' + Date.now(), title: '🎸 The Gift of Tab', body: 'Notifications are working! 🤘', url: './' }] : decide(db, new Date(), state.sent);
console.log(`${subs.length} device(s), ${due.length} notification(s) due:`, due.map(d => d.id).join(', ') || '—');

webpush.setVapidDetails('mailto:notifications@gift-of-tab.app', PUBLIC, PRIVATE);
for (const msg of due) {
  let ok = 0;
  for (const [dev, v] of subs) {
    try { await webpush.sendNotification(v.sub, JSON.stringify(msg), { TTL: 4 * 3600, urgency: 'normal' }); ok++; }
    catch (e) {
      console.log(`  ${dev}: ${e.statusCode || ''} ${e.body || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) state.dead[v.sub.endpoint] = Date.now(); // device unsubscribed
    }
  }
  console.log(`sent ${msg.id} to ${ok} device(s)`);
  state.sent[msg.id] = Date.now();
}

// keep the "already sent" list short (60 days)
for (const [k, t] of Object.entries(state.sent)) if (Date.now() - t > 60 * 864e5) delete state.sent[k];
if (due.length) await gh(`/gists/${gist.id}`, { method: 'PATCH', body: JSON.stringify({ files: { [STATE]: { content: JSON.stringify(state) } } }) });
