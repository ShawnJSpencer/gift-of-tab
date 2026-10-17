// The Gift of Tab — what to notify, worked out from your synced data. Pure functions (easy to test).

const MIN_DAY = 60; // a day counts as "played" after 1 minute of practice

// Local date/time parts in a time zone, e.g. { key: '2026-10-16', hour: 20, minute: 5, weekday: 5 } (0 = Sunday)
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { key: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, weekday };
}

// Day keys are plain calendar dates, so step them with UTC arithmetic.
export function addDays(key, n) { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }

export function practiceByDay(db) {
  const all = {};
  for (const dev of Object.values(db.practice || {})) for (const [k, v] of Object.entries(dev)) all[k] = (all[k] || 0) + v;
  return all;
}

export function streakEndingBefore(all, todayKey) {
  // streak that is still alive: counts today if played, otherwise from yesterday back
  let k = (all[todayKey] || 0) >= MIN_DAY ? todayKey : addDays(todayKey, -1), n = 0;
  while ((all[k] || 0) >= MIN_DAY) { n++; k = addDays(k, -1); }
  return n;
}

const minsAt = (hhmm) => { const [h, m] = String(hhmm || '20:00').split(':').map(Number); return h * 60 + (m || 0); };
const fmtMins = (secs) => { const m = Math.round(secs / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const CONCERT_MILESTONES = new Set([365, 300, 250, 200, 180, 150, 120, 100, 90, 75, 60, 50, 45, 30, 21, 14, 10, 7, 6, 5, 4, 3, 2, 1, 0]);

// Returns [{ id, title, body, url }] to send now. `sent` is a map of ids already sent.
export function decide(db, now, sent = {}) {
  const s = db.settings || {}, n = s.notify || {};
  const tz = n.tz || 'America/Denver';
  const L = localParts(now, tz), nowMin = L.hour * 60 + L.minute;
  const all = practiceByDay(db), goal = (s.goal || 30) * 60;
  const name = (s.stageName || '').trim();
  const out = [];
  const concert = s.concert && s.concert.date ? s.concert : null;
  const daysToShow = concert ? daysBetween(L.key, concert.date.slice(0, 10)) : null;
  const showName = concert ? (concert.name || 'your concert') : '';

  // 1) Practice reminder — once, from the chosen time until 3 hours later, only if not played today
  if (n.practice !== false) {
    const start = minsAt(n.time);
    const id = `practice:${L.key}`;
    if (!sent[id] && nowMin >= start && nowMin < start + 180 && (all[L.key] || 0) < MIN_DAY) {
      const st = streakEndingBefore(all, L.key);
      const title = name ? `🎸 Time to play, ${name}!` : '🎸 Time to play!';
      let body = st > 0 ? `You haven't practised today. 🔥 Your ${st}-day streak is on the line — a quick session keeps it going.`
        : `A few minutes tonight starts a new streak. Your goal is ${s.goal || 30} minutes.`;
      if (daysToShow != null && daysToShow > 0 && daysToShow <= 60) body += ` ${daysToShow} day${daysToShow === 1 ? '' : 's'} to ${showName}.`;
      out.push({ id, title, body, url: './' });
    }
  }

  // 2) Concert countdown — milestone days, mid-morning (9am–1pm)
  if (n.concert !== false && concert && daysToShow != null && daysToShow >= 0 && CONCERT_MILESTONES.has(daysToShow)) {
    const id = `concert:${concert.date.slice(0, 10)}:${daysToShow}`;
    if (!sent[id] && nowMin >= 9 * 60 && nowMin < 13 * 60) {
      const when = new Date(concert.date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      if (daysToShow === 0) out.push({ id, title: `🎤 Show day! ${showName}`, body: `Break a leg${name ? ', ' + name : ''} 🤘 You've got this.`, url: './' });
      else out.push({ id, title: `🎤 ${daysToShow} day${daysToShow === 1 ? '' : 's'} to ${showName}`, body: `${when} · ${daysToShow <= 7 ? 'Final stretch — run your set list today!' : 'Keep the practice streak rolling.'}`, url: './#/calendar' });
    }
  }

  // 3) Weekly summary — Sunday evening (6pm–10pm), covering Monday → Sunday
  if (n.weekly !== false && L.weekday === 0) {
    const id = `weekly:${L.key}`;
    if (!sent[id] && nowMin >= 18 * 60 && nowMin < 22 * 60) {
      let days = 0, secs = 0, met = 0;
      for (let i = 0; i < 7; i++) { const v = all[addDays(L.key, -i)] || 0; if (v >= MIN_DAY) days++; if (v >= goal) met++; secs += v; }
      const st = streakEndingBefore(all, L.key);
      const bits = [`Goal met ${met} of 7 days`];
      if (st) bits.push(`🔥 ${st}-day streak`);
      if (daysToShow != null && daysToShow > 0) bits.push(`${daysToShow} days to ${showName}`);
      out.push({ id, title: days ? `📊 Your week: ${days} day${days === 1 ? '' : 's'}, ${fmtMins(secs)}` : '📊 Your week: no practice logged', body: days ? bits.join(' · ') : 'A fresh week starts tomorrow — pick a song and play 🎸', url: './#/calendar' });
    }
  }
  return out;
}
