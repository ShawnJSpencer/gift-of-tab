// Practice timer for screens other than a tab (the quizzes): counts toward today's goal while
// you're actively working — it pauses after a couple of minutes with no taps, or when the app is hidden.
import { h, toast } from './ui.js';
import * as S from './store.js';
import { emojiRain } from './art.js';

const IDLE = 120; // seconds without a tap before the clock pauses

export function practiceTimer(opts = {}) {
  const pill = h('button', { type: 'button', class: 'tb timer-pill learn-timer', title: 'Practice time today (quizzes count!)' });
  let pending = 0, idle = 0;
  const goal = () => (S.db.settings.goal || 30) * 60;
  const poke = () => { idle = 0; };
  ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, poke, { passive: true }));
  function paint() {
    const secs = S.practiceOn(S.dayKey()) + pending, g = goal(), pct = Math.min(1, secs / g);
    const mm = Math.floor(secs / 60), ss = String(Math.floor(secs % 60)).padStart(2, '0');
    pill.innerHTML = '';
    pill.append(h('span', { class: 'ring', style: { '--p': pct } }), h('span', {}, idle >= IDLE ? 'Paused' : `${mm}:${ss}`), h('span', { class: 'goal' }, `/ ${S.db.settings.goal || 30}m`));
    pill.classList.toggle('met', secs >= g);
  }
  pill.onclick = () => toast(idle >= IDLE ? 'Timer paused — it starts again as soon as you tap' : 'Quiz time counts toward today’s practice ⏱️');
  const tick = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (idle++ >= IDLE) { paint(); return; }
    const before = S.practiceOn(S.dayKey()) + pending;
    pending++;
    opts.onSecond && opts.onSecond();
    if (pending >= 10) { S.addPractice(pending); pending = 0; }
    const after = S.practiceOn(S.dayKey()) + pending;
    if (before < goal() && after >= goal()) celebrate();
    paint();
  }, 1000);
  paint();
  function celebrate() {
    const k = S.dayKey(), cel = { ...(S.db.settings.celebrated || {}) };
    if (cel[k]) return;
    cel[k] = true;
    S.setSetting('celebrated', cel);
    const e = emojiRain();
    toast(`${e} Daily goal reached — ${S.db.settings.goal || 30} minutes! ${e}`, 4500);
  }
  return {
    el: pill,
    stop() {
      clearInterval(tick);
      if (pending) S.addPractice(pending);
      pending = 0;
      ['pointerdown', 'keydown'].forEach(t => document.removeEventListener(t, poke));
    },
  };
}
