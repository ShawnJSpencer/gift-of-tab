// Learn: practice quizzes — chord flashcards, circle of fifths, notes by ear, and find-every-note.
// Time spent here counts toward the daily practice goal.
import { h, icon, btn, toast } from './ui.js';
import * as S from './store.js';
import { TUNINGS, COMMON_CHORDS, voicing, parseChord } from './theory.js';
import { chordDiagram, emojiRain } from './art.js';
import { fretboard, burstAt, noteOf, pretty } from './fretboard.js';
import { practiceTimer } from './practice.js';
import * as A from './score/audio.js';
import { openPitches } from './versions.js';

const QUIZZES = [
  { id: 'chords', emoji: '🃏', title: 'Chord flashcards', sub: 'See the chord chart, name the chord' },
  { id: 'circle', emoji: '⭕', title: 'Circle of fifths', sub: 'Place the keys, then answer key questions' },
  { id: 'ear', emoji: '👂', title: 'Notes by ear', sub: 'Hear a note, find it on the fretboard — add frets as you improve' },
  { id: 'find', emoji: '🔎', title: 'Find every note', sub: 'One note name — find all of them on the neck' },
];

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// right / wrong feedback (after the note you tapped has sounded)
const right = (elm, big) => { setTimeout(() => A.chime(), 260); if (elm) burstAt(elm, big); };
const wrong = (elm) => { setTimeout(() => A.buzz(), 330); if (elm) { elm.classList.remove('shake'); void elm.offsetWidth; elm.classList.add('shake'); } };

export function learnScreen(root, nav, which) {
  const page = h('div', { class: 'page learn-page' });
  root.append(page);
  window.setTopColor('#EEF5F1');
  const timer = practiceTimer();
  const quiz = QUIZZES.find(q => q.id === which);
  page.append(h('header', { class: 'page-head learn-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': quiz ? 'Back to Learn' : 'Menu', onclick: () => (quiz ? nav('#/learn') : window.openDrawer()) }, icon(quiz ? 'back' : 'menu')),
    h('h1', { class: 'page-title' }, quiz ? `${quiz.emoji} ${quiz.title}` : '🎓 Learn'),
    h('span', { class: 'grow' }), timer.el,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Home', onclick: () => nav('#/') }, icon('home'))));
  const body = h('div', { class: 'learn-body' });
  page.append(body);
  let cleanup = () => {};
  if (!quiz) hub(body, nav);
  else cleanup = ({ chords: chordQuiz, circle: circleQuiz, ear: earQuiz, find: findQuiz })[quiz.id](body) || cleanup;
  return () => { timer.stop(); cleanup(); };
}

function hub(body, nav) {
  body.append(h('p', { class: 'hint' }, 'Practice away from a song — every minute here counts toward today’s goal.'),
    h('div', { class: 'learn-grid' }, QUIZZES.map(q => h('button', { type: 'button', class: 'card learn-card', onclick: () => nav('#/learn/' + q.id) },
      h('span', { class: 'lc-emoji' }, q.emoji), h('b', {}, q.title), h('span', {}, q.sub),
      S.pref('learn.best.' + q.id) ? h('span', { class: 'lc-best' }, '🏆 ' + S.pref('learn.best.' + q.id)) : null))));
}

// ---------- shared: instrument & tuning picker for fretboard quizzes
function instrumentBar(onChange) {
  const bar = h('div', { class: 'learn-bar' });
  function paint() {
    bar.innerHTML = '';
    const inst = S.pref('learn.inst', 'guitar');
    const list = TUNINGS[inst];
    const tname = S.pref('learn.tuning.' + inst, list[0].name);
    bar.append(
      h('div', { class: 'segmented' }, [['guitar', '🎸 Guitar'], ['ukulele', '🪕 Ukulele']].map(([k, l]) =>
        h('button', { type: 'button', class: 'seg-btn' + (inst === k ? ' on' : ''), onclick: () => { S.setPref('learn.inst', k); paint(); onChange(); } }, l))),
      h('select', { class: 'learn-tuning', 'aria-label': 'Tuning', onchange: (e) => { S.setPref('learn.tuning.' + inst, e.target.value); onChange(); } },
        list.map(t => h('option', { value: t.name, selected: t.name === tname }, `${t.name} (${t.notes.join(' ')})`))));
  }
  paint();
  return bar;
}
function currentSetup() {
  const inst = S.pref('learn.inst', 'guitar');
  const list = TUNINGS[inst];
  const t = list.find(x => x.name === S.pref('learn.tuning.' + inst, list[0].name)) || list[0];
  return { instrument: inst, tuning: t.notes, tuningName: t.name };
}
function saveBest(id, text, better) { const cur = S.pref('learn.best.' + id); if (!cur || better(cur)) S.setPref('learn.best.' + id, text); }

// ---------- 1. chord flashcards
const BASIC = ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'D7', 'E7', 'A7', 'G7', 'C7', 'B7', 'F', 'Fmaj7', 'Cmaj7', 'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Cadd9', 'Em7', 'Am7'];
function chordQuiz(body) {
  let set = S.pref('learn.chordset', 'basic'), style = S.pref('learn.chordstyle', 'flip');
  let card = null, flipped = false, answered = false, right_ = 0, total = 0, streak = 0;
  const controls = h('div', { class: 'learn-controls' });
  const stage = h('div', { class: 'chord-stage' });
  const score = h('div', { class: 'learn-score' });
  const bar = instrumentBar(() => next());
  body.append(bar, controls, score, stage);
  const pool = () => {
    const s = currentSetup();
    const names = set === 'basic' ? BASIC : [...new Set([...BASIC, ...COMMON_CHORDS.flat()])];
    return names.filter(n => parseChord(n) && voicing(n, s.tuning));
  };
  function paintControls() {
    controls.innerHTML = '';
    const seg = (key, val, cur, label, fn) => h('button', { type: 'button', class: 'seg-btn' + (cur === val ? ' on' : ''), onclick: fn }, label);
    controls.append(
      h('div', { class: 'segmented' }, seg('set', 'basic', set, 'Open chords', () => { set = 'basic'; S.setPref('learn.chordset', set); paintControls(); next(); }), seg('set', 'all', set, 'All chords', () => { set = 'all'; S.setPref('learn.chordset', set); paintControls(); next(); })),
      h('div', { class: 'segmented' }, seg('st', 'flip', style, '🔄 Flip card', () => { style = 'flip'; S.setPref('learn.chordstyle', style); paintControls(); next(); }), seg('st', 'choice', style, '🔘 Pick the name', () => { style = 'choice'; S.setPref('learn.chordstyle', style); paintControls(); next(); })));
  }
  function paintScore() { score.textContent = total ? `✅ ${right_} of ${total}   ·   🔥 streak ${streak}` : 'Name the chord from its chart'; }
  function playChord(name) {
    const s = currentSetup(), v = voicing(name, s.tuning);
    if (!v) return;
    const open = openPitches(s.tuning, s.instrument, s.tuningName);
    A.pluck(v.map((f, i) => (f < 0 ? null : open[i] + f)).filter(x => x != null));
  }
  function grade(ok, elm) {
    if (answered) return;
    answered = true; total++;
    if (ok) { right_++; streak++; right(elm, streak % 5 === 0); saveBest('chords', `${streak} in a row`, (cur) => parseInt(cur, 10) < streak); }
    else { streak = 0; wrong(elm); }
    paintScore();
    if (style === 'flip') setTimeout(next, 900);
  }
  function next() {
    const list = pool();
    let name; do { name = rnd(list); } while (list.length > 1 && card && name === card);
    card = name; flipped = false; answered = false;
    const s = currentSetup();
    const front = chordDiagram(name, { instrument: s.instrument, tuning: s.tuning });
    front.querySelector('.dg-name')?.remove();
    const flipBox = h('div', { class: 'flip' },
      h('div', { class: 'flip-inner' },
        h('div', { class: 'flip-face front' }, front, h('div', { class: 'flip-q' }, 'What chord is this?')),
        h('div', { class: 'flip-face back' }, h('div', { class: 'flip-name' }, name), h('div', { class: 'flip-q' }, 'Did you get it?'))));
    stage.innerHTML = '';
    const flip = () => { flipped = !flipped; flipBox.classList.toggle('flipped', flipped); if (flipped) playChord(name); paintActions(); };
    flipBox.addEventListener('click', () => { if (style === 'flip') flip(); });
    const actions = h('div', { class: 'learn-actions' });
    function paintActions() {
      actions.innerHTML = '';
      actions.append(btn('Hear it', () => playChord(name), { cls: 'ghost', icon: 'play' }));
      if (style === 'flip') {
        if (!flipped) actions.append(btn('Flip to check', flip, { cls: 'primary big', icon: 'swap' }));
        else actions.append(btn('Missed it', (e) => grade(false, e.currentTarget), { cls: 'danger' }), btn('Got it!', (e) => grade(true, e.currentTarget), { cls: 'primary', icon: 'check' }));
      } else actions.append(btn('Next chord', next, { cls: 'ghost', icon: 'next' }));
    }
    paintActions();
    stage.append(flipBox);
    if (style === 'choice') {
      const others = shuffle(list.filter(n => n !== name)).slice(0, 3);
      const choices = h('div', { class: 'choice-grid' }, shuffle([name, ...others]).map(n => h('button', { type: 'button', class: 'choice', onclick: (e) => {
        if (answered) return;
        const ok = n === name;
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        if (!ok) choices.querySelectorAll('.choice').forEach(c => { if (c.textContent === name) c.classList.add('right'); });
        flipBox.classList.add('flipped'); playChord(name);
        grade(ok, e.currentTarget);
        setTimeout(next, ok ? 1300 : 2200);
      } }, n)));
      stage.append(choices);
    }
    stage.append(actions);
    paintScore();
  }
  paintControls(); next();
}

// ---------- 2. circle of fifths
const MAJ = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
const MIN = ['Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m', 'E♭m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm'];
const SIG = ['no sharps or flats', '1 sharp', '2 sharps', '3 sharps', '4 sharps', '5 sharps', '6 sharps', '5 flats', '4 flats', '3 flats', '2 flats', '1 flat'];
const ROOT_PC = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
function circleQuiz(body) {
  let mode = S.pref('learn.circlemode', 'place');
  let shown = new Set([0]), shownMin = new Set(), target = null, ring = 'maj', right_ = 0, total = 0, misses = 0, streak = 0, answered = false;
  const controls = h('div', { class: 'learn-controls' });
  const prompt = h('div', { class: 'learn-prompt' });
  const score = h('div', { class: 'learn-score' });
  const wheelWrap = h('div', { class: 'wheel-wrap' });
  const below = h('div', {});
  body.append(controls, prompt, score, wheelWrap, below);
  function paintControls() {
    controls.innerHTML = '';
    const seg = (val, label) => h('button', { type: 'button', class: 'seg-btn' + (mode === val ? ' on' : ''), onclick: () => { mode = val; S.setPref('learn.circlemode', mode); restart(); paintControls(); } }, label);
    controls.append(h('div', { class: 'segmented' }, seg('place', '🧩 Place the keys'), seg('ask', '❓ Key questions')));
  }
  function wheel(showAll, onPick) {
    const R1 = 150, R2 = 104, R3 = 62, C = 160;
    let s = '<svg viewBox="0 0 320 320" class="wheel">';
    const pt = (r, a) => [C + r * Math.sin(a), C - r * Math.cos(a)];
    for (let i = 0; i < 12; i++) {
      const a0 = (i - 0.5) * Math.PI / 6, a1 = (i + 0.5) * Math.PI / 6;
      const seg = (ro, ri, cls, ii, label) => {
        const [x0, y0] = pt(ro, a0), [x1, y1] = pt(ro, a1), [x2, y2] = pt(ri, a1), [x3, y3] = pt(ri, a0);
        const [tx, ty] = pt((ro + ri) / 2, (a0 + a1) / 2);
        return `<g class="wseg ${cls}" data-i="${ii}" data-ring="${cls.includes('maj') ? 'maj' : 'min'}"><path d="M${x0},${y0} A${ro},${ro} 0 0 1 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 0 0 ${x3},${y3}Z"/><text x="${tx}" y="${ty + 6}" text-anchor="middle">${label}</text></g>`;
      };
      const majOn = showAll || shown.has(i), minOn = showAll || shownMin.has(i);
      s += seg(R1, R2, 'maj' + (majOn ? ' on' : ''), i, majOn ? MAJ[i] : '');
      s += seg(R2, R3, 'min' + (minOn ? ' on' : ''), i, minOn ? MIN[i] : '');
    }
    s += `<circle cx="${C}" cy="${C}" r="${R3 - 2}" class="whub"/><text x="${C}" y="${C - 4}" text-anchor="middle" class="whub-t">Circle of</text><text x="${C}" y="${C + 16}" text-anchor="middle" class="whub-t">fifths</text></svg>`;
    wheelWrap.innerHTML = s;
    wheelWrap.querySelectorAll('.wseg').forEach(g => g.addEventListener('click', () => onPick && onPick(+g.dataset.i, g.dataset.ring, g)));
  }
  // the key's home chord (minor roots sit a minor third below their relative major)
  const playKey = (i, minor) => { const root = minor ? 45 + ((ROOT_PC[i] + 9) % 12) : 48 + ROOT_PC[i]; A.pluck(minor ? [root, root + 3, root + 7, root + 12] : [root, root + 4, root + 7, root + 12], 0.05); };
  // ---- place the keys
  function placeNext() {
    const majLeft = [...Array(12).keys()].filter(i => !shown.has(i));
    const minLeft = [...Array(12).keys()].filter(i => !shownMin.has(i));
    if (!majLeft.length && !minLeft.length) {
      emojiRain(); A.chime();
      prompt.innerHTML = ''; prompt.append(h('b', {}, `🏆 Circle complete! ${misses} miss${misses === 1 ? '' : 'es'}.`));
      if (S.pref('learn.circlebest', 99) > misses) { S.setPref('learn.circlebest', misses); S.setPref('learn.best.circle', `whole circle with ${misses} miss${misses === 1 ? '' : 'es'}`); }
      below.innerHTML = ''; below.append(h('div', { class: 'learn-actions' }, btn('Start again', restart, { cls: 'primary', icon: 'next' })));
      wheel(true); return;
    }
    if (majLeft.length) { ring = 'maj'; target = rnd(majLeft); } else { ring = 'min'; target = rnd(minLeft); }
    prompt.innerHTML = '';
    prompt.append(h('span', {}, 'Tap where '), h('b', { class: 'big-key' }, ring === 'maj' ? `${MAJ[target]} major` : `${MIN[target].replace('m', '')} minor`), h('span', {}, ring === 'maj' ? ' goes (outer ring)' : ' goes (inner ring)'));
    if (ring === 'min' && shownMin.size === 0) prompt.append(h('div', { class: 'hint' }, 'Tip: each minor key sits right inside its relative major (A minor inside C).'));
    wheel(false, (i, r, g) => {
      if (r !== ring) return toast(ring === 'maj' ? 'Use the outer ring for major keys' : 'Use the inner ring for minor keys');
      total++;
      if (i === target) { (ring === 'maj' ? shown : shownMin).add(i); right_++; streak++; playKey(i, ring === 'min'); right(g); setTimeout(placeNext, 500); }
      else { misses++; streak = 0; A.pluck([48 + ROOT_PC[i]]); wrong(g); g.classList.add('miss'); }
      paintScore();
    });
  }
  // ---- key questions
  function ask() {
    answered = false;
    const i = Math.floor(Math.random() * 12);
    const kinds = [
      () => [`What’s a fifth above ${MAJ[i]}?`, MAJ[(i + 1) % 12], MAJ],
      () => [`What’s a fourth above ${MAJ[i]}?`, MAJ[(i + 11) % 12], MAJ],
      () => [`Relative minor of ${MAJ[i]} major?`, MIN[i], MIN],
      () => [`Relative major of ${MIN[i].replace('m', '')} minor?`, MAJ[i], MAJ],
      () => [`How many sharps or flats in ${MAJ[i]} major?`, SIG[i], SIG],
      () => [`Which major key has ${SIG[i]}?`, MAJ[i], MAJ],
      () => [`In the key of ${MAJ[i]}, the IV and V chords are…`, `${MAJ[(i + 11) % 12]} and ${MAJ[(i + 1) % 12]}`, MAJ.map((_, k) => `${MAJ[(k + 11) % 12]} and ${MAJ[(k + 1) % 12]}`)],
    ];
    const [q, ans, from] = rnd(kinds)();
    const opts = shuffle([ans, ...shuffle(from.filter(x => x !== ans)).slice(0, 3)]);
    prompt.innerHTML = ''; prompt.append(h('b', { class: 'big-q' }, q));
    const peek = S.pref('learn.circlepeek', false);
    wheel(peek);
    below.innerHTML = '';
    const grid = h('div', { class: 'choice-grid' }, opts.map(o => h('button', { type: 'button', class: 'choice', onclick: (e) => {
      if (answered) return; answered = true; total++;
      const ok = o === ans;
      e.currentTarget.classList.add(ok ? 'right' : 'wrong');
      grid.querySelectorAll('.choice').forEach(c => { if (c.textContent === ans) c.classList.add('right'); });
      if (ok) { right_++; streak++; right(e.currentTarget, streak % 5 === 0); }
      else { streak = 0; wrong(e.currentTarget); }
      paintScore(); wheel(true);
      setTimeout(ask, ok ? 1400 : 2600);
    } }, o)));
    below.append(grid, h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: peek, onchange: (e) => { S.setPref('learn.circlepeek', e.target.checked); wheel(e.target.checked); } }), h('span', {}, 'Show the circle while I answer')));
  }
  function paintScore() { score.textContent = total ? `✅ ${right_} of ${total}   ·   🔥 streak ${streak}` : ''; }
  function restart() { shown = new Set([0]); shownMin = new Set(); right_ = total = misses = streak = 0; below.innerHTML = ''; paintScore(); mode === 'place' ? placeNext() : ask(); }
  paintControls(); restart();
}

// ---------- 3. notes by ear
function earQuiz(body) {
  let frets = S.pref('learn.earfrets', 0), names = S.pref('learn.earnames', false);
  let target = null, tries = 0, right_ = 0, rounds = 0, streak = 0, started = false, solved = false;
  const bar = instrumentBar(() => rebuild());
  const prompt = h('div', { class: 'learn-prompt' });
  const score = h('div', { class: 'learn-score' });
  const holder = h('div', { class: 'fb-holder' });
  const actions = h('div', { class: 'learn-actions' });
  const fretCtl = h('div', { class: 'learn-controls' });
  body.append(bar, fretCtl, prompt, score, holder, actions);
  let fb = null;
  function rebuild() {
    const s = currentSetup();
    fb = fretboard({ ...s, from: 0, to: frets, showNames: names, onTap: tap });
    holder.innerHTML = ''; holder.append(fb.el);
    paintFretCtl();
    if (started) newRound(); else paintIdle();
  }
  function paintFretCtl() {
    fretCtl.innerHTML = '';
    fretCtl.append(
      h('div', { class: 'fret-stepper' },
        btn('', () => setFrets(-1), { icon: 'minus', cls: 'icon-only', title: 'One fewer fret' }),
        h('b', {}, frets === 0 ? 'Open strings only' : `Open + ${frets} fret${frets === 1 ? '' : 's'}`),
        btn('Add a fret', () => setFrets(1), { icon: 'plus', cls: 'ghost' })),
      h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: names, onchange: (e) => { names = e.target.checked; S.setPref('learn.earnames', names); fb.set({ showNames: names }); markSolved(); } }), h('span', {}, 'Show note names')));
  }
  function setFrets(d) { const nf = Math.max(0, Math.min(15, frets + d)); if (nf === frets) return; frets = nf; S.setPref('learn.earfrets', frets); rebuild(); }
  function paintIdle() {
    prompt.innerHTML = ''; prompt.append(h('span', {}, 'A note will play — tap where you think it is on the strings shown.'));
    actions.innerHTML = ''; actions.append(btn('Start — play a note', () => { started = true; newRound(); }, { cls: 'primary big', icon: 'play' }));
    paintScore();
  }
  function newRound() {
    const all = [];
    for (let s = 0; s < fb.open.length; s++) for (let f = 0; f <= frets; f++) all.push(fb.open[s] + f);
    let m; do { m = rnd(all); } while (all.length > 1 && m === target);
    target = m; tries = 0; solved = false;
    fb.unmark('right'); fb.unmark('reveal'); fb.unmark('miss');
    if (!names) holder.querySelectorAll('.fb-dotname').forEach(d => { d.textContent = ''; });
    prompt.innerHTML = ''; prompt.append(h('b', { class: 'big-q' }, '👂 Which note was that?'), h('div', { class: 'hint' }, 'Tap it on the fretboard. Same pitch in another spot counts too.'));
    actions.innerHTML = '';
    actions.append(btn('Play it again', () => A.pluck(target), { cls: 'primary', icon: 'play' }), btn('Show me', reveal, { cls: 'ghost' }), btn('Skip', newRound, { cls: 'ghost', icon: 'next' }));
    setTimeout(() => A.pluck(target), 150);
    paintScore();
  }
  function markSolved() { if (solved) fb.positions(target).forEach(([s, f]) => fb.mark(s, f, 'right', pretty(noteOf(target)))); }
  function reveal() {
    if (solved || target == null) return;
    solved = true; rounds++; streak = 0;
    fb.positions(target).forEach(([s, f]) => fb.mark(s, f, 'reveal', pretty(noteOf(target))));
    A.pluck(target); paintScore();
    setTimeout(newRound, 2200);
  }
  function tap(s, f, midi, cell) {
    A.pluck(midi);
    if (!started || solved) return;
    if (midi === target) {
      solved = true; rounds++;
      if (tries === 0) { right_++; streak++; saveBest('ear', `${streak} in a row (${frets === 0 ? 'open strings' : 'to fret ' + frets})`, (cur) => parseInt(cur, 10) < streak); }
      else streak = 0;
      markSolved(); right(cell, streak > 0 && streak % 5 === 0);
      paintScore();
      setTimeout(newRound, 1400);
    } else {
      tries++;
      cell.classList.add('miss'); setTimeout(() => cell.classList.remove('miss'), 700);
      wrong(cell);
    }
  }
  function paintScore() { score.textContent = rounds ? `✅ ${right_} of ${rounds} first try   ·   🔥 streak ${streak}` : ''; }
  rebuild();
}

// ---------- 4. find every note
const NATURALS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ALLNOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function findQuiz(body) {
  let sharps = S.pref('learn.findsharps', false), toFret = S.pref('learn.findto', 12);
  let pc = null, found = new Set(), need = [], misses = 0, t0 = 0, done = false, clock = null;
  const bar = instrumentBar(() => rebuild());
  const ctl = h('div', { class: 'learn-controls' });
  const head = h('div', { class: 'find-head' });
  const holder = h('div', { class: 'fb-holder' });
  const actions = h('div', { class: 'learn-actions' });
  body.append(bar, ctl, head, holder, actions);
  let fb = null;
  function paintCtl() {
    ctl.innerHTML = '';
    ctl.append(
      h('div', { class: 'segmented' }, [[12, 'Frets 0–12'], [15, 'Frets 0–15']].map(([v, l]) => h('button', { type: 'button', class: 'seg-btn' + (toFret === v ? ' on' : ''), onclick: () => { toFret = v; S.setPref('learn.findto', v); rebuild(); } }, l))),
      h('label', { class: 'switch-row' }, h('input', { type: 'checkbox', checked: sharps, onchange: (e) => { sharps = e.target.checked; S.setPref('learn.findsharps', sharps); newNote(); } }), h('span', {}, 'Include sharps')));
  }
  function rebuild() { fb = fretboard({ ...currentSetup(), from: 0, to: toFret, onTap: tap }); holder.innerHTML = ''; holder.append(fb.el); paintCtl(); newNote(); }
  function newNote() {
    const list = sharps ? ALLNOTES : NATURALS;
    let n; do { n = rnd(list); } while (list.length > 1 && ALLNOTES.indexOf(n) === pc);
    pc = ALLNOTES.indexOf(n);
    found = new Set(); misses = 0; done = false; t0 = performance.now();
    need = fb.positions(pc, true);
    fb.unmark('found'); holder.querySelectorAll('.fb-dotname').forEach(d => { d.textContent = ''; });
    actions.innerHTML = ''; actions.append(btn('New note', newNote, { cls: 'ghost', icon: 'next' }), btn('Show me', showAll, { cls: 'ghost' }));
    clearInterval(clock); clock = setInterval(paintHead, 1000);
    paintHead();
  }
  function paintHead() {
    head.innerHTML = '';
    const secs = (performance.now() - t0) / 1000;
    head.append(h('div', { class: 'find-note' }, pretty(ALLNOTES[pc])),
      h('div', { class: 'find-count' }, h('b', {}, `${found.size}`), ` / ${need.length}`),
      h('div', { class: 'find-meta' }, `⏱ ${fmtTime(secs)}   ·   ✗ ${misses}`));
  }
  function finish() {
    done = true; clearInterval(clock); paintHead();
    const secs = (performance.now() - t0) / 1000;
    emojiRain();
    toast(`🏆 All ${need.length} ${pretty(ALLNOTES[pc])}’s in ${fmtTime(secs)} with ${misses} miss${misses === 1 ? '' : 'es'}!`, 4000);
    if (!misses && secs < S.pref('learn.findbest', 1e9)) { S.setPref('learn.findbest', secs); S.setPref('learn.best.find', `all ${need.length} ${pretty(ALLNOTES[pc])}’s in ${fmtTime(secs)}, no misses`); }
    actions.innerHTML = ''; actions.append(btn('Next note', newNote, { cls: 'primary big', icon: 'next' }));
  }
  function showAll() { need.forEach(([s, f]) => fb.mark(s, f, 'found', pretty(ALLNOTES[pc]))); done = true; clearInterval(clock); actions.innerHTML = ''; actions.append(btn('Next note', newNote, { cls: 'primary big', icon: 'next' })); }
  function tap(s, f, midi, cell) {
    A.pluck(midi);
    if (done) return;
    if (((midi % 12) + 12) % 12 === pc) {
      if (found.has(s + ':' + f)) return;
      found.add(s + ':' + f);
      fb.mark(s, f, 'found', pretty(ALLNOTES[pc]));
      right(cell, found.size === need.length);
      paintHead();
      if (found.size === need.length) setTimeout(finish, 350);
    } else {
      misses++;
      cell.querySelector('.fb-dotname').textContent = pretty(noteOf(midi));
      cell.classList.add('miss'); setTimeout(() => { cell.classList.remove('miss'); if (!cell.classList.contains('found')) cell.querySelector('.fb-dotname').textContent = ''; }, 900);
      wrong(cell); paintHead();
    }
  }
  rebuild();
  return () => clearInterval(clock);
}
