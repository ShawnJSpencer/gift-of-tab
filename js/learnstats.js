// Learn statistics: every quiz answer is counted by day, quiz and level, and by item (which chord,
// which note, which key…) so the stats page can show progress, trends and weak spots.
// Stored in the synced data, one bucket per device (like practice time), so iPad and iPhone add up.
//   db.learn[device] = { d: { day: { 'chords.beg': [answered, right, seconds] } },
//                        i: { chords: { Am: [answered, right, lastTime] } },
//                        s: { 'chords.beg': bestStreak } }
import { h, btn } from './ui.js';
import * as S from './store.js';

export const QUIZ_NAMES = { chords: '🃏 Chord flashcards', circle: '⭕ Circle of fifths', ear: '👂 Notes by ear', find: '🔎 Find every note', read: '🎼 Music fundamentals' };
const LV = { beg: '🌱 Beginner', int: '🌿 Intermediate', hard: '🔥 Hard' };

function mine() {
  const L = (S.db.learn ||= {});
  const m = (L[S.deviceId] ||= {});
  m.d ||= {}; m.i ||= {}; m.s ||= {};
  return m;
}
let unsaved = 0;
function touch(force) { if (force || ++unsaved >= 10) { unsaved = 0; S.save('practice'); } }

// One answer. item: what was asked (a chord name, a note…); streak: the current streak after it.
export function record(quiz, lvl, item, ok, streak = 0) {
  const m = mine(), day = S.dayKey(), k = quiz + '.' + lvl;
  const d = ((m.d[day] ||= {})[k] ||= [0, 0, 0]);
  d[0]++; if (ok) d[1]++;
  if (item != null) {
    const it = ((m.i[quiz] ||= {})[item] ||= [0, 0, 0]);
    it[0]++; if (ok) it[1]++; it[2] = Date.now();
  }
  if (streak > (m.s[k] || 0)) m.s[k] = streak;
  touch(true);
}
// A second spent actively in a quiz.
export function tick(quiz, lvl) {
  const m = mine(), d = ((m.d[S.dayKey()] ||= {})[quiz + '.' + lvl] ||= [0, 0, 0]);
  d[2]++; touch(false);
}
export function flush() { if (unsaved) touch(true); }

// Merge two copies of the learn data: every number only ever grows, so take the larger.
export function mergeLearn(a = {}, b = {}) {
  if (typeof a === 'number' || typeof b === 'number') return Math.max(+a || 0, +b || 0);
  if (Array.isArray(a) || Array.isArray(b)) { a = a || []; b = b || []; return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => Math.max(a[i] || 0, b[i] || 0)); }
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) out[k] = mergeLearn(a?.[k], b?.[k]);
  return out;
}

// ---------- totals across devices
function all() {
  const days = {}, items = {}, best = {};
  for (const dev of Object.values(S.db.learn || {})) {
    for (const [day, ks] of Object.entries(dev.d || {})) for (const [k, v] of Object.entries(ks)) {
      const t = ((days[day] ||= {})[k] ||= [0, 0, 0]); v.forEach((x, i) => { t[i] += x || 0; });
    }
    for (const [q, its] of Object.entries(dev.i || {})) for (const [it, v] of Object.entries(its)) {
      const t = ((items[q] ||= {})[it] ||= [0, 0, 0]); t[0] += v[0] || 0; t[1] += v[1] || 0; t[2] = Math.max(t[2], v[2] || 0);
    }
    for (const [k, v] of Object.entries(dev.s || {})) best[k] = Math.max(best[k] || 0, v);
  }
  return { days, items, best };
}
const sum = (rows) => rows.reduce((t, v) => [t[0] + v[0], t[1] + v[1], t[2] + v[2]], [0, 0, 0]);
const pct = (r, n) => (n ? Math.round((r / n) * 100) : 0);
const dayStr = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return S.dayKey(d); };
const fmtMin = (s) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);
function rangeTotals(days, from, to, filter = () => true) { // from/to = days ago (inclusive)
  const rows = [];
  for (let o = from; o <= to; o++) for (const [k, v] of Object.entries(days[dayStr(o)] || {})) if (filter(k)) rows.push(v);
  return sum(rows);
}

// Short summary for the Learn menu.
export function summary() {
  const { days } = all();
  const tot = sum(Object.values(days).flatMap(ks => Object.values(ks)));
  const today = sum(Object.values(days[S.dayKey()] || {}));
  return { answered: tot[0], right: tot[1], secs: tot[2], today: today[0], streak: dayStreak(days) };
}
function dayStreak(days) {
  const has = (o) => Object.values(days[dayStr(o)] || {}).some(v => v[0] > 0);
  let o = has(0) ? 0 : 1, n = 0;
  while (has(o)) { n++; o++; }
  return n;
}

// Friendly labels for stored items.
const pretty = (s) => String(s).replace(/#/g, '♯').replace(/([A-G])b/g, '$1♭');
const CIRCLE_KINDS = { fifth: 'Fifth above', fourth: 'Fourth above', relmin: 'Relative minor', relmaj: 'Relative major', count: 'Count sharps/flats', which: 'Key from sharps/flats', ivv: 'IV and V chords' };
function itemLabel(quiz, it) {
  if (quiz === 'circle') return it.startsWith('place:') ? `Place ${pretty(it.slice(6))}` : CIRCLE_KINDS[it] || it;
  if (quiz === 'ear') return pretty(it);
  if (quiz === 'find') return `All the ${pretty(it)}’s`;
  if (quiz === 'read') return pretty(it.replace(/^note:/, '').replace(/^key:/, 'Key: '));
  return pretty(it);
}

// ---------- the stats page
export function statsPage(body, nav) {
  const { days, items, best } = all();
  const s = summary();
  if (!s.answered) {
    body.append(h('div', { class: 'card stats-empty' }, h('b', {}, 'No quiz answers yet'), h('p', {}, 'Take any quiz and your progress, accuracy and trouble spots will show up here.'),
      btn('Go to the quizzes', () => nav('#/learn'), { cls: 'primary', icon: 'next' })));
    return;
  }
  const week = rangeTotals(days, 0, 6), prev = rangeTotals(days, 7, 13);
  const trend = (a, b) => (!b[0] || !a[0] ? '' : pct(a[1], a[0]) - pct(b[1], b[0]));
  const tr = trend(week, prev);
  body.append(h('div', { class: 'stat-tiles' },
    tile(s.answered.toLocaleString(), 'questions answered'),
    tile(pct(s.right, s.answered) + '%', 'right overall'),
    tile(fmtMin(s.secs), 'time in quizzes'),
    tile(`${s.streak} day${s.streak === 1 ? '' : 's'}`, 'quiz streak 🔥'),
    tile(week[0] ? pct(week[1], week[0]) + '%' : '–', 'right this week', '', tr === '' ? null : tr >= 0 ? `▲ ${tr}% vs last week` : `▼ ${-tr}% vs last week`, tr >= 0 ? 'up' : 'down')));

  // last 14 days
  const chart = h('div', { class: 'card stats-chart' }, h('div', { class: 'sc-title' }, 'Last 14 days'));
  const bars = h('div', { class: 'sc-bars' });
  const span = [...Array(14).keys()].reverse().map(o => ({ o, v: sum(Object.values(days[dayStr(o)] || {})) }));
  const max = Math.max(1, ...span.map(x => x.v[0]));
  for (const { o, v } of span) {
    const d = new Date(); d.setDate(d.getDate() - o);
    bars.append(h('div', { class: 'sc-col', title: `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${v[0]} answered, ${v[1]} right, ${fmtMin(v[2])}` },
      h('span', { class: 'sc-n' }, v[0] ? String(v[0]) : ''),
      h('div', { class: 'sc-stack', style: { height: (v[0] / max) * 100 + '%' } }, h('i', { class: 'sc-wrong', style: { flex: v[0] - v[1] } }), h('i', { class: 'sc-right', style: { flex: v[1] } })),
      h('span', { class: 'sc-day' + (o === 0 ? ' today' : '') }, d.toLocaleDateString(undefined, { weekday: 'narrow' }))));
  }
  chart.append(bars, h('div', { class: 'sc-key' }, h('span', {}, h('i', { class: 'sc-today' }), 'today'), h('span', {}, h('i', { class: 'sc-right' }), 'right'), h('span', {}, h('i', { class: 'sc-wrong' }), 'missed')));
  body.append(chart);

  // per quiz
  for (const [q, name] of Object.entries(QUIZ_NAMES)) {
    const rows = Object.keys(LV).map(lv => ({ lv, t: sum(Object.values(days).map(ks => ks[q + '.' + lv] || [0, 0, 0])) })).filter(r => r.t[0] || r.t[2]);
    if (!rows.length) continue;
    const card = h('div', { class: 'card stats-quiz' }, h('div', { class: 'sq-head' }, h('b', {}, name), btn('Practice', () => nav('#/learn/' + q), { cls: 'ghost', icon: 'next' })));
    const tbl = h('div', { class: 'sq-levels' }, h('span', { class: 'th' }, 'Level'), h('span', { class: 'th' }, 'Asked'), h('span', { class: 'th' }, 'Right'), h('span', { class: 'th' }, 'Best streak'), h('span', { class: 'th' }, 'Time'));
    for (const { lv, t } of rows) {
      const p = pct(t[1], t[0]);
      tbl.append(h('span', {}, LV[lv]), h('span', {}, String(t[0])),
        h('span', {}, t[0] ? h('span', { class: 'acc-bar' }, h('i', { style: { width: p + '%' }, class: p >= 85 ? 'good' : p >= 60 ? 'ok' : 'low' }), h('em', {}, p + '%')) : '–'),
        h('span', {}, best[q + '.' + lv] ? `🔥 ${best[q + '.' + lv]}` : '–'), h('span', {}, fmtMin(t[2])));
    }
    card.append(tbl);
    const qw = rangeTotals(days, 0, 6, k => k.startsWith(q + '.')), qp = rangeTotals(days, 7, 13, k => k.startsWith(q + '.'));
    const qt = trend(qw, qp);
    if (qt !== '') card.append(h('div', { class: 'sq-trend ' + (qt >= 0 ? 'up' : 'down') }, qt >= 0 ? `▲ ${qt}% more right this week than last` : `▼ ${-qt}% fewer right this week than last`));
    // weak and strong spots (need a few tries before judging)
    const its = Object.entries(items[q] || {}).filter(([, v]) => v[0] >= 3).map(([k, v]) => ({ k, n: v[0], p: pct(v[1], v[0]) }));
    const weak = its.filter(x => x.p < 100).sort((a, b) => a.p - b.p || b.n - a.n).slice(0, 6);
    const strong = its.filter(x => x.p >= 85).sort((a, b) => b.p - a.p || b.n - a.n).slice(0, 6);
    if (weak.length) card.append(h('div', { class: 'sq-spots' }, h('span', { class: 'sq-lab' }, '🎯 Work on'), weak.map(x => chip(itemLabel(q, x.k), x, 'weak'))));
    if (strong.length) card.append(h('div', { class: 'sq-spots' }, h('span', { class: 'sq-lab' }, '💪 Got these'), strong.map(x => chip(itemLabel(q, x.k), x, 'strong'))));
    if (!its.length) card.append(h('div', { class: 'hint' }, 'Answer a few more and your trouble spots will show up here.'));
    body.append(card);
  }
  body.append(h('p', { class: 'hint center' }, 'Stats add up across your devices when sync is on.'));
}
const tile = (big, small, cls = '', note = null, noteCls = '') => h('div', { class: 'card stat-tile ' + cls }, h('b', {}, big), h('span', {}, small), note ? h('em', { class: 'st-note ' + noteCls }, note) : null);
const chip = (label, x, cls) => h('span', { class: 'spot ' + cls, title: `${x.n} tries, ${x.p}% right` }, label, h('small', {}, `${x.p}%`));


// ---------- smart picking: favour what you miss and what's new, go easy on what you've mastered
// Weight of one item from its history across devices.
export function weightOf(quiz, item) {
  let n = 0, r = 0;
  for (const dev of Object.values(S.db.learn || {})) { const v = dev.i?.[quiz]?.[item]; if (v) { n += v[0] || 0; r += v[1] || 0; } }
  if (!n) return 2;                                   // never seen: bring it in
  const acc = (r + 1) / (n + 2);                      // smoothed so one lucky answer isn't "mastered"
  let w = 0.25 + 4 * (1 - acc);
  if (n >= 6 && r / n >= 0.9) w *= 0.5;               // clearly known: show it less
  return w;
}
// Is this one you've been missing? (for a little 🎯 tag)
export function isWeak(quiz, item) {
  let n = 0, r = 0;
  for (const dev of Object.values(S.db.learn || {})) { const v = dev.i?.[quiz]?.[item]; if (v) { n += v[0] || 0; r += v[1] || 0; } }
  return n >= 3 && r / n < 0.7;
}
// Pick one of `list` (items or {item, boost}) by weight, skipping the most recent picks when there's choice.
export function pickSmart(quiz, list, recent = [], keyOf = (x) => x) {
  const fresh = list.filter(x => !recent.includes(keyOf(x)));
  const pool = fresh.length ? fresh : list;
  const ws = pool.map(x => weightOf(quiz, keyOf(x)) * (x && x.boost || 1));
  let t = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { t -= ws[i]; if (t <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
