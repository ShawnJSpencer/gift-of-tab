// Piano sheet music — playback with a small Web Audio piano-ish synth.
// (On iPhone/iPad the ring/silent switch can mute web audio; turn it off to hear playback.)
import { timeline } from './model.js';

let ctx = null, master = null;
function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -18; master.ratio.value = 4;
    const g = ctx.createGain(); g.gain.value = 0.9;
    master.connect(g); g.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// One piano-like note: bright attack, falling brightness, pitch-dependent decay.
export function tone(midi, when, dur, vel = 0.5, dest = null) {
  const c = ac(); when = Math.max(when, c.currentTime);
  const f = freq(midi);
  const out = c.createGain();
  const lp = c.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(12000, f * 9), when);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2.2), when + 0.6);
  lp.connect(out); out.connect(dest || master);
  const decay = Math.max(0.6, 3.2 - (midi - 40) * 0.045); // low notes ring longer
  const peak = vel * (midi < 48 ? 0.32 : 0.26);
  const rel = when + Math.max(0.05, dur);
  out.gain.setValueAtTime(0.0001, when);
  out.gain.exponentialRampToValueAtTime(peak, when + 0.006);
  out.gain.setTargetAtTime(peak * 0.4, when + 0.006, 0.12);       // quick initial drop
  out.gain.setTargetAtTime(0.0001, when + 0.25, decay / 3);       // long natural decay
  out.gain.setTargetAtTime(0.0001, rel, 0.07);                    // key released
  const end = Math.min(rel + 0.5, when + decay + 0.3);
  const parts = [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12], [1.003, 'sine', 0.4]];
  for (const [mul, type, amp] of parts) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f * mul; g.gain.value = amp;
    o.connect(g); g.connect(lp);
    o.start(when); o.stop(end);
  }
}

// Preview a single key/chord (used while entering notes).
export function preview(midis) { const c = ac(); midis.forEach(m => tone(m, c.currentTime + 0.01, 0.6, 0.45)); }

// Play a score from a time (in 32nds). onStep(refs, t32) fires as each new onset sounds; onEnd() at the end.
export function play(score, bpm, fromT, onStep, onEnd) {
  const c = ac();
  const { events, total } = timeline(score);
  const beatUnit = 8; // tempo counts quarter notes
  const secPer32 = 60 / (bpm || 80) / beatUnit;
  const t0 = c.currentTime + 0.12 - fromT * secPer32;
  const evs = events.filter(e => e.time >= fromT);
  const bus = c.createGain(); bus.connect(master);
  let k = 0, stopped = false;
  const onsets = [...new Set(evs.map(e => e.time))].sort((a, b) => a - b);
  let oi = 0;
  const timer = setInterval(tick, 25);
  tick();
  function tick() {
    if (stopped) return;
    const horizon = c.currentTime + 0.15;
    while (k < evs.length && t0 + evs[k].time * secPer32 < horizon) {
      const e = evs[k++];
      if (!e.silent) e.midi.forEach(m => tone(m, t0 + e.time * secPer32, e.dur * secPer32 * 0.95, e.ref.s === 'b' ? 0.42 : 0.5, bus));
    }
    while (oi < onsets.length && t0 + onsets[oi] * secPer32 <= c.currentTime) {
      const t = onsets[oi++];
      onStep && onStep(evs.filter(e => e.time <= t && e.time + e.dur > t).map(e => e.ref), t);
    }
    if (t0 + total * secPer32 < c.currentTime - 0.05 && k >= evs.length) { stop(); onEnd && onEnd(); }
  }
  function stop() { stopped = true; clearInterval(timer); }
  return { stop: () => { stop(); bus.gain.setTargetAtTime(0, c.currentTime, 0.06); setTimeout(() => bus.disconnect(), 1500); } };
}
