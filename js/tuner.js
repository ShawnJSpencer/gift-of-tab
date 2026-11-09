// Tuner: listens through the microphone and shows how close you are to the note.
// Guitar and ukulele modes (with every alternate tuning in the app) and a chromatic "any note" mode.
import { h, icon, btn, toast } from './ui.js';
import * as S from './store.js';
import { TUNINGS, SHARPS } from './theory.js';
import { openPitches } from './versions.js';
import * as A from './score/audio.js';

const IN_TUNE = 5; // cents either side that counts as in tune

// YIN pitch detection — steady on low guitar strings, ignores most overtones.
function detectPitch(buf, sr) {
  let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return null; // too quiet
  const W = Math.floor(buf.length / 2), maxTau = Math.min(W, Math.floor(sr / 60)), minTau = Math.floor(sr / 1400);
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) { let s = 0; for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; } d[tau] = s; }
  // cumulative mean normalised difference
  let run = 0; d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; d[tau] = d[tau] * tau / (run || 1); }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) if (d[t] < 0.12) { while (t + 1 <= maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
  if (tau < 0) { // no clear dip: take the deepest, if it's convincing
    let best = minTau; for (let t = minTau; t <= maxTau; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.3) return null; tau = best;
  }
  // parabolic interpolation for sub-sample accuracy
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const shift = (a + c - 2 * b) ? (a - c) / (2 * (a + c - 2 * b)) : 0;
  return { f: sr / (tau + shift), level: rms };
}

export function tunerScreen(root, nav) {
  let mode = S.pref('tuner.mode', 'guitar');
  let a4 = S.pref('tuner.a4', 440);
  let locked = null; // string index the player picked, or null for automatic
  let stream = null, actx = null, analyser = null, raf = 0, buf = null;
  const hist = [];

  const page = h('div', { class: 'page tuner-page' });
  root.append(page);
  window.setTopColor('#EEF5F1');

  const head = h('header', { class: 'page-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Menu', onclick: () => window.openDrawer() }, icon('menu')),
    h('h1', { class: 'page-title' }, '🎚️ Tuner'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Home', onclick: () => nav('#/') }, icon('home')));
  const modeRow = h('div', { class: 'segmented tuner-modes' });
  const tuningRow = h('div', { class: 'tuner-tuning' });
  const strings = h('div', { class: 'tuner-strings' });
  const noteEl = h('div', { class: 'tn-note' }, '–');
  const octEl = h('span', { class: 'tn-oct' });
  const hint = h('div', { class: 'tn-hint' }, 'Tap Start and play a string');
  const hzEl = h('div', { class: 'tn-hz' });
  const needle = h('div', { class: 'tn-needle' });
  const gauge = h('div', { class: 'tn-gauge' },
    h('div', { class: 'tn-scale', html: scaleSvg() }), needle, h('div', { class: 'tn-zone' }));
  const startBtn = btn('Start listening', () => (stream ? stop() : start()), { cls: 'primary big', icon: 'mic' });
  const a4Row = h('div', { class: 'tuner-a4' });
  page.append(head,
    h('div', { class: 'card tuner-card' }, modeRow, tuningRow, h('div', { class: 'tn-display' }, h('div', { class: 'tn-notewrap' }, noteEl, octEl), gauge, hint, hzEl), strings, h('div', { class: 'row center' }, startBtn)),
    a4Row,
    h('p', { class: 'hint center' }, 'Your iPad will ask to use the microphone the first time. Nothing is recorded or saved — it only listens while this screen is open.'));

  function scaleSvg() {
    let s = '<svg viewBox="0 0 300 160" aria-hidden="true">';
    for (let c = -50; c <= 50; c += 5) {
      const ang = (c / 50) * 60 * Math.PI / 180, big = c % 25 === 0, r1 = big ? 112 : 120, r2 = 132;
      s += `<line x1="${150 + Math.sin(ang) * r1}" y1="${150 - Math.cos(ang) * r1}" x2="${150 + Math.sin(ang) * r2}" y2="${150 - Math.cos(ang) * r2}" stroke="currentColor" stroke-width="${big ? 3 : 1.5}" stroke-linecap="round" opacity="${big ? 0.9 : 0.5}"/>`;
    }
    s += '<text x="40" y="150" font-size="16" fill="currentColor" opacity=".7">♭</text><text x="252" y="150" font-size="16" fill="currentColor" opacity=".7">♯</text></svg>';
    return s;
  }

  const tunings = () => (mode === 'ukulele' ? TUNINGS.ukulele : TUNINGS.guitar);
  const curTuning = () => { const name = S.pref('tuner.t.' + mode, tunings()[0].name); return tunings().find(t => t.name === name) || tunings()[0]; };
  const targets = () => { if (mode === 'chromatic') return []; const t = curTuning(); return openPitches(t.notes, mode, t.name); };

  function buildControls() {
    modeRow.innerHTML = '';
    for (const [k, label] of [['guitar', '🎸 Guitar'], ['ukulele', '🪕 Ukulele'], ['chromatic', '🎵 Any note']])
      modeRow.append(h('button', { type: 'button', class: 'seg-btn' + (mode === k ? ' on' : ''), onclick: () => { mode = k; S.setPref('tuner.mode', k); locked = null; buildControls(); } }, label));
    tuningRow.innerHTML = '';
    if (mode !== 'chromatic') {
      const sel = h('select', { 'aria-label': 'Tuning', onchange: (e) => { S.setPref('tuner.t.' + mode, e.target.value); locked = null; buildStrings(); } },
        tunings().map(t => h('option', { value: t.name, selected: t.name === curTuning().name }, `${t.name} — ${t.notes.join(' ')}`)));
      tuningRow.append(h('label', { class: 'tn-tlabel' }, 'Tuning', sel));
    } else tuningRow.append(h('div', { class: 'hint' }, 'Play any note — the tuner shows the closest one and how far off you are.'));
    buildStrings();
    a4Row.innerHTML = '';
    a4Row.append(h('span', {}, 'Reference pitch'),
      btn('', () => setA4(-1), { icon: 'minus', cls: 'icon-only', title: 'Lower' }), h('b', {}, `A = ${a4} Hz`), btn('', () => setA4(1), { icon: 'plus', cls: 'icon-only', title: 'Higher' }));
  }
  function setA4(d) { a4 = Math.max(430, Math.min(450, a4 + d)); S.setPref('tuner.a4', a4); buildControls(); }
  function buildStrings() {
    strings.innerHTML = '';
    if (mode === 'chromatic') return;
    const t = curTuning(), mids = targets();
    strings.append(h('button', { type: 'button', class: 'tn-str auto' + (locked == null ? ' on' : ''), onclick: () => { locked = null; buildStrings(); } }, 'Auto'));
    t.notes.forEach((nm, i) => strings.append(h('button', { type: 'button', class: 'tn-str' + (locked === i ? ' on' : ''), 'data-i': i, title: 'Tune this string (plays its note)',
      onclick: () => { locked = i; buildStrings(); A.reference(mids[i], a4); } }, h('b', {}, nm.replace('#', '♯')), h('small', {}, String(mids[i] / 12 - 1 | 0)))));
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      stream = null;
      toast(e && e.name === 'NotAllowedError' ? '🎤 Microphone access was blocked — allow it for this app in Settings › Safari › Microphone (or the website settings), then try again.' : '🎤 Couldn’t open the microphone on this device.', 6000);
      return;
    }
    const C = window.AudioContext || window.webkitAudioContext;
    actx = new C();
    if (actx.state !== 'running') { try { await actx.resume(); } catch {} }
    const src = actx.createMediaStreamSource(stream);
    analyser = actx.createAnalyser(); analyser.fftSize = 4096;
    src.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    startBtn.querySelector('span:last-child').textContent = 'Stop listening';
    page.classList.add('listening');
    hint.textContent = 'Listening… play a string';
    loop();
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    try { actx && actx.close(); } catch {}
    actx = null;
    page.classList.remove('listening', 'intune');
    if (startBtn.isConnected) startBtn.querySelector('span:last-child').textContent = 'Start listening';
    hint.textContent = 'Tap Start and play a string';
  }
  let lastHeard = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    const r = detectPitch(buf, actx.sampleRate);
    const now = performance.now();
    if (!r || r.f < 50 || r.f > 1400) { if (now - lastHeard > 1200) { page.classList.remove('intune'); needle.style.setProperty('--a', '0deg'); needle.classList.add('idle'); } return; }
    lastHeard = now;
    hist.push(r.f); if (hist.length > 5) hist.shift();
    const f = [...hist].sort((x, y) => x - y)[hist.length >> 1];
    const exact = 69 + 12 * Math.log2(f / a4);
    let target;
    if (mode === 'chromatic') target = Math.round(exact);
    else {
      const mids = targets();
      if (locked != null) target = mids[locked];
      else { target = mids.reduce((b, m) => (Math.abs(m - exact) < Math.abs(b - exact) ? m : b), mids[0]); }
      strings.querySelectorAll('.tn-str').forEach(b => b.classList.toggle('hear', locked == null && b.dataset.i != null && mids[+b.dataset.i] === target));
    }
    const cents = Math.max(-50, Math.min(50, (exact - target) * 100));
    const name = SHARPS[((target % 12) + 12) % 12];
    noteEl.textContent = name.replace('#', '♯'); octEl.textContent = String(Math.floor(target / 12) - 1);
    needle.classList.remove('idle');
    needle.style.setProperty('--a', (cents / 50) * 60 + 'deg');
    const ok = Math.abs(cents) <= IN_TUNE;
    page.classList.toggle('intune', ok);
    const far = Math.abs((exact - target) * 100) > 50;
    hint.textContent = ok ? '✓ In tune!' : far ? (exact < target ? 'Way low — tighten (tune up)' : 'Way high — loosen (tune down)') : cents < 0 ? `${Math.round(-cents)}¢ flat — tune up ↑` : `${Math.round(cents)}¢ sharp — tune down ↓`;
    hzEl.textContent = `${f.toFixed(1)} Hz`;
  }

  buildControls();
  return () => stop();
}
