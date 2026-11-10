// Learn: practice quizzes — chord flashcards, circle of fifths, notes by ear, find-every-note and
// music fundamentals (reading the staff, key signatures). Each has Beginner / Intermediate / Hard.
// Time spent inside a quiz counts toward the daily practice goal.
import { h, icon, btn, toast } from './ui.js';
import * as S from './store.js';
import { TUNINGS, COMMON_CHORDS, voicing, parseChord } from './theory.js';
import { chordDiagram, emojiRain } from './art.js';
import { fretboard, burstAt, noteOf, pretty } from './fretboard.js';
import { practiceTimer } from './practice.js';
import * as LS from './learnstats.js';
import * as A from './score/audio.js';
import { openPitches } from './versions.js';
import { glyph, BOTTOM, KEY_POS } from './score/render.js';

const QUIZZES = [
  { id: 'chords', emoji: '🃏', title: 'Chord flashcards', sub: 'See the chord chart, name the chord' },
  { id: 'circle', emoji: '⭕', title: 'Circle of fifths', sub: 'Place the keys, then answer key questions' },
  { id: 'ear', emoji: '👂', title: 'Notes by ear', sub: 'Hear a note, find it on the fretboard — add frets as you improve' },
  { id: 'find', emoji: '🔎', title: 'Find every note', sub: 'One note name — find all of them on the neck' },
  { id: 'read', emoji: '🎼', title: 'Music fundamentals', sub: 'Read notes on the staff and name key signatures' },
];

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// right / wrong feedback (after the note you tapped has sounded)
const right = (elm, big) => { setTimeout(() => A.chime(), 260); if (elm) burstAt(elm, big); };
const wrong = (elm) => { setTimeout(() => A.buzz(S.pref('learn.wrongsound', 'gentle')), 330); if (elm) { elm.classList.remove('shake'); void elm.offsetWidth; elm.classList.add('shake'); } };

export function learnScreen(root, nav, which) {
  const page = h('div', { class: 'page learn-page' });
  root.append(page);
  window.setTopColor('#EEF5F1');
  const quiz = QUIZZES.find(q => q.id === which);
  const stats = which === 'stats';
  // practice time only counts inside a quiz, not while browsing the Learn menu
  const timer = quiz ? practiceTimer({ onSecond: () => LS.tick(quiz.id, level(quiz.id)) }) : { el: null, stop() {} };
  page.append(h('header', { class: 'page-head learn-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': quiz || stats ? 'Back to Learn' : 'Menu', onclick: () => (quiz || stats ? nav('#/learn') : window.openDrawer()) }, icon(quiz || stats ? 'back' : 'menu')),
    h('h1', { class: 'page-title' }, quiz ? `${quiz.emoji} ${quiz.title}` : stats ? '📊 Quiz stats' : '🎓 Learn'),
    h('span', { class: 'grow' }), timer.el,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Home', onclick: () => nav('#/') }, icon('home'))));
  const body = h('div', { class: 'learn-body' });
  page.append(body);
  let cleanup = () => {};
  if (stats) LS.statsPage(body, nav);
  else if (!quiz) hub(body, nav);
  else cleanup = ({ chords: chordQuiz, circle: circleQuiz, ear: earQuiz, find: findQuiz, read: readQuiz })[quiz.id](body) || cleanup;
  return () => { timer.stop(); LS.flush(); cleanup(); };
}

function hub(body, nav) {
  const s = LS.summary();
  body.append(h('p', { class: 'hint' }, 'Practice away from a song — time spent in a quiz counts toward today’s goal.'),
    h('button', { type: 'button', class: 'card stats-strip', onclick: () => nav('#/learn/stats') },
      h('span', { class: 'ss-emoji' }, '📊'),
      h('span', { class: 'ss-text' }, h('b', {}, 'Your stats'), h('span', {}, s.answered ? `${s.answered} answered · ${Math.round(s.right / s.answered * 100)}% right · ${s.today} today · 🔥 ${s.streak}-day streak` : 'Progress, accuracy and trouble spots show up here once you start')),
      icon('next')),
    h('div', { class: 'learn-grid' }, QUIZZES.map(q => h('button', { type: 'button', class: 'card learn-card', onclick: () => nav('#/learn/' + q.id) },
      h('span', { class: 'lc-emoji' }, q.emoji), h('b', {}, q.title), h('span', {}, q.sub),
      h('span', { class: 'lc-level' }, LEVEL_NAME[level(q.id)]),
      S.pref('learn.best.' + q.id) ? h('span', { class: 'lc-best' }, '🏆 ' + S.pref('learn.best.' + q.id)) : null))),
    soundPicker());
}
function soundPicker() {
  const row = h('div', { class: 'learn-sound' });
  const paint = () => {
    const cur = S.pref('learn.wrongsound', 'gentle');
    row.innerHTML = '';
    row.append(h('span', { class: 'ls-lab' }, 'Wrong-answer sound'), h('div', { class: 'segmented' },
      [['gentle', '🙊 Gentle'], ['rock', '🎸 Rock'], ['off', '🔇 Off']].map(([k, l]) => h('button', { type: 'button', class: 'seg-btn' + (cur === k ? ' on' : ''),
        onclick: () => { S.setPref('learn.wrongsound', k); paint(); A.buzz(k); } }, l))));
  };
  paint();
  return row;
}

// ---------- shared: difficulty
const LEVELS = ['beg', 'int', 'hard'];
const LEVEL_NAME = { beg: '🌱 Beginner', int: '🌿 Intermediate', hard: '🔥 Hard' };
const level = (id) => S.pref('learn.level.' + id, 'beg');
function levelBar(id, onChange) {
  const bar = h('div', { class: 'segmented level-bar', role: 'radiogroup', 'aria-label': 'Difficulty' });
  const paint = () => { bar.innerHTML = ''; LEVELS.forEach(k => bar.append(h('button', { type: 'button', class: 'seg-btn' + (level(id) === k ? ' on' : ''), 'aria-pressed': String(level(id) === k), onclick: () => { S.setPref('learn.level.' + id, k); paint(); onChange(k); } }, LEVEL_NAME[k]))); };
  paint();
  return h('div', { class: 'learn-controls' }, bar);
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
const CHORD_LEVELS = {
  beg: ['C', 'D', 'E', 'F', 'G', 'A'],
  int: ['Am', 'Dm', 'Em', 'Bm', 'Cm', 'Gm', 'Fm', 'F#m', 'C#m', 'G#m', 'Bb', 'Eb', 'Ab', 'B', 'F#', 'Db'],
  hard: ['C7', 'D7', 'E7', 'G7', 'A7', 'B7', 'Cmaj7', 'Fmaj7', 'Gmaj7', 'Dmaj7', 'Am7', 'Em7', 'Dm7', 'Bm7', 'Dsus2', 'Dsus4', 'Asus2', 'Asus4', 'Esus4', 'Gsus4', 'Csus2', 'Cadd9', 'Gadd9', 'Bdim', 'Edim', 'Caug', 'D/F#', 'G/B', 'C/E'],
};
// F♯ and G♭ are the same sound; which name is used depends on the key. Show the other one too.
const ENHARM = { 'C#': 'D♭', Db: 'C♯', 'D#': 'E♭', Eb: 'D♯', 'F#': 'G♭', Gb: 'F♯', 'G#': 'A♭', Ab: 'G♯', 'A#': 'B♭', Bb: 'A♯' };
const prettyChord = (n) => n.replace(/#/g, '♯').replace(/([A-G])b/g, '$1♭');
function alsoCalled(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  if (!m || !ENHARM[m[1]] || m[2].includes('/')) return null;
  return h('div', { class: 'flip-also' }, `also called ${ENHARM[m[1]]}${prettyChord(m[2])}`);
}
function chordQuiz(body) {
  let style = S.pref('learn.chordstyle', 'flip');
  let card = null, flipped = false, answered = false, right_ = 0, total = 0, streak = 0, pending = 0;
  const later = (ms) => { clearTimeout(pending); pending = setTimeout(next, ms); };
  const controls = h('div', { class: 'learn-controls' });
  const stage = h('div', { class: 'chord-stage' });
  const score = h('div', { class: 'learn-score' });
  const bar = instrumentBar(() => next());
  body.append(levelBar('chords', () => { card = null; next(); }), bar, controls, score, stage);
  // each level adds to the one before; the level's own chords get a boost, and the smart picker
  // favours chords you miss or haven't seen and shows ones you've mastered less often
  const pool = () => {
    const s = currentSetup(), L = level('chords');
    const own = CHORD_LEVELS[L], names = L === 'beg' ? own : L === 'int' ? [...CHORD_LEVELS.beg, ...own] : [...CHORD_LEVELS.beg, ...CHORD_LEVELS.int, ...own];
    return names.filter(n => parseChord(n) && voicing(n, s.tuning));
  };
  const recent = [];
  function paintControls() {
    controls.innerHTML = '';
    const seg = (key, val, cur, label, fn) => h('button', { type: 'button', class: 'seg-btn' + (cur === val ? ' on' : ''), onclick: fn }, label);
    controls.append(
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
    LS.record('chords', level('chords'), card, ok, ok ? streak + 1 : 0);
    if (ok) { right_++; streak++; right(elm, streak % 5 === 0); saveBest('chords', `${streak} in a row (${LEVEL_NAME[level('chords')].slice(3)})`, (cur) => parseInt(cur, 10) < streak); }
    else { streak = 0; wrong(elm); }
    paintScore();
    if (style === 'flip') later(900);
  }
  function next() {
    clearTimeout(pending);
    const list = pool();
    const own = CHORD_LEVELS[level('chords')];
    const name = LS.pickSmart('chords', list.map(n => ({ item: n, boost: own.includes(n) && level('chords') !== 'beg' ? 1.6 : 1 })), recent, x => x.item).item;
    recent.unshift(name); recent.length = Math.min(recent.length, Math.min(3, list.length - 1));
    card = name; flipped = false; answered = false;
    const s = currentSetup();
    const front = chordDiagram(name, { instrument: s.instrument, tuning: s.tuning });
    front.querySelector('.dg-name')?.remove();
    const flipBox = h('div', { class: 'flip' },
      h('div', { class: 'flip-inner' },
        h('div', { class: 'flip-face front' }, front, h('div', { class: 'flip-q' }, LS.isWeak('chords', name) ? '🎯 One you’ve been missing' : 'What chord is this?')),
        h('div', { class: 'flip-face back' }, h('div', { class: 'flip-name' }, prettyChord(name)), alsoCalled(name), h('div', { class: 'flip-q' }, 'Did you get it?'))));
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
      const others = shuffle([...new Set(list)].filter(n => n !== name)).slice(0, 3);
      const choices = h('div', { class: 'choice-grid' }, shuffle([name, ...others]).map(n => h('button', { type: 'button', class: 'choice', onclick: (e) => {
        if (answered) return;
        const ok = n === name;
        e.currentTarget.classList.add(ok ? 'right' : 'wrong');
        if (!ok) choices.querySelectorAll('.choice').forEach(c => { if (c.textContent === prettyChord(name)) c.classList.add('right'); });
        flipBox.classList.add('flipped'); playChord(name);
        grade(ok, e.currentTarget);
        later(ok ? 1300 : 2200);
      } }, prettyChord(n))));
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
  let shown = new Set(), shownMin = new Set(), target = null, ring = 'maj', right_ = 0, total = 0, misses = 0, streak = 0, answered = false;
  const controls = h('div', { class: 'learn-controls' });
  const prompt = h('div', { class: 'learn-prompt' });
  const score = h('div', { class: 'learn-score' });
  const wheelWrap = h('div', { class: 'wheel-wrap' });
  const below = h('div', {});
  body.append(levelBar('circle', () => restart()), controls, prompt, score, wheelWrap, below);
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
    const minLeft = level('circle') === 'hard' ? [...Array(12).keys()].filter(i => !shownMin.has(i)) : []; // minors only on Hard
    if (!majLeft.length && !minLeft.length) {
      emojiRain(); A.chime();
      prompt.innerHTML = ''; prompt.append(h('b', {}, `🏆 Circle complete! ${misses} miss${misses === 1 ? '' : 'es'}.`));
      if (level('circle') === 'hard' && S.pref('learn.circlebest', 99) > misses) { S.setPref('learn.circlebest', misses); S.setPref('learn.best.circle', `whole circle with ${misses} miss${misses === 1 ? '' : 'es'}`); }
      below.innerHTML = ''; below.append(h('div', { class: 'learn-actions' }, btn('Start again', restart, { cls: 'primary', icon: 'next' })));
      wheel(true); return;
    }
    if (majLeft.length) { ring = 'maj'; target = LS.pickSmart('circle', majLeft, [], i => 'place:' + MAJ[i]); } else { ring = 'min'; target = LS.pickSmart('circle', minLeft, [], i => 'place:' + MIN[i]); }
    prompt.innerHTML = '';
    prompt.append(h('span', {}, 'Tap where '), h('b', { class: 'big-key' }, ring === 'maj' ? `${MAJ[target]} major` : `${MIN[target].replace('m', '')} minor`), h('span', {}, ring === 'maj' ? ' goes (outer ring)' : ' goes (inner ring)'));
    if (ring === 'min' && shownMin.size === 0) prompt.append(h('div', { class: 'hint' }, 'Tip: each minor key sits right inside its relative major (A minor inside C).'));
    wheel(false, (i, r, g) => {
      if (r !== ring) return toast(ring === 'maj' ? 'Use the outer ring for major keys' : 'Use the inner ring for minor keys');
      total++;
      LS.record('circle', level('circle'), 'place:' + (ring === 'maj' ? MAJ[target] : MIN[target]), i === target, i === target ? streak + 1 : 0);
      if (i === target) { (ring === 'maj' ? shown : shownMin).add(i); right_++; streak++; playKey(i, ring === 'min'); right(g); setTimeout(placeNext, 500); }
      else { misses++; streak = 0; A.pluck([48 + ROOT_PC[i]]); wrong(g); g.classList.add('miss'); }
      paintScore();
    });
  }
  // ---- key questions
  let lastKind = null;
  function ask() {
    answered = false;
    const L = level('circle');
    // Beginner sticks to the sharp side (plus F); Intermediate and Hard use every key
    const i = L === 'beg' ? rnd([0, 1, 2, 3, 4, 5, 11]) : Math.floor(Math.random() * 12);
    const kinds = [
      () => [`What’s a fifth above ${MAJ[i]}?`, MAJ[(i + 1) % 12], MAJ],
      () => [`What’s a fourth above ${MAJ[i]}?`, MAJ[(i + 11) % 12], MAJ],
      () => [`Relative minor of ${MAJ[i]} major?`, MIN[i], MIN],
      () => [`Relative major of ${MIN[i].replace('m', '')} minor?`, MAJ[i], MAJ],
      () => [`How many sharps or flats in ${MAJ[i]} major?`, SIG[i], SIG],
      () => [`Which major key has ${SIG[i]}?`, MAJ[i], MAJ],
      () => [`In the key of ${MAJ[i]}, the IV and V chords are…`, `${MAJ[(i + 11) % 12]} and ${MAJ[(i + 1) % 12]}`, MAJ.map((_, k) => `${MAJ[(k + 11) % 12]} and ${MAJ[(k + 1) % 12]}`)],
    ];
    const use = L === 'beg' ? [0, 4] : L === 'int' ? [0, 1, 2, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
    const KIND_IDS = ['fifth', 'fourth', 'relmin', 'relmaj', 'count', 'which', 'ivv'];
    const kindId = LS.pickSmart('circle', use, [lastKind], k => KIND_IDS[k]); lastKind = KIND_IDS[kindId];
    const [q, ans, from] = kinds[kindId]();
    const opts = shuffle([ans, ...shuffle(from.filter(x => x !== ans)).slice(0, 3)]);
    prompt.innerHTML = ''; prompt.append(h('b', { class: 'big-q' }, q));
    const peek = S.pref('learn.circlepeek', false);
    wheel(peek);
    below.innerHTML = '';
    const grid = h('div', { class: 'choice-grid' }, opts.map(o => h('button', { type: 'button', class: 'choice', onclick: (e) => {
      if (answered) return; answered = true; total++;
      const ok = o === ans;
      LS.record('circle', level('circle'), ['fifth', 'fourth', 'relmin', 'relmaj', 'count', 'which', 'ivv'][kindId], ok, ok ? streak + 1 : 0);
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
  function restart() {
    // Beginner starts with every other key already placed
    shown = new Set(level('circle') === 'beg' ? [0, 2, 4, 6, 8, 10] : [0]); shownMin = new Set(); right_ = total = misses = streak = 0; below.innerHTML = ''; paintScore(); mode === 'place' ? placeNext() : ask(); }
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
  const EAR = { beg: [0, true], int: [3, false], hard: [7, false] }; // frets, show names
  body.append(levelBar('ear', (k) => { [frets, names] = EAR[k]; S.setPref('learn.earfrets', frets); S.setPref('learn.earnames', names); rebuild(); }), bar, fretCtl, prompt, score, holder, actions);
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
    const nm = (x) => noteOf(x) + (Math.floor(x / 12) - 1);
    const m = LS.pickSmart('ear', [...new Set(all)], target == null ? [] : [nm(target)], nm);
    target = m; tries = 0; solved = false;
    fb.unmark('right'); fb.unmark('reveal'); fb.unmark('miss');
    if (!names) holder.querySelectorAll('.fb-dotname').forEach(d => { d.textContent = ''; });
    prompt.innerHTML = ''; prompt.append(h('b', { class: 'big-q' }, '👂 Which note was that?'), h('div', { class: 'hint' }, LS.isWeak('ear', noteOf(target) + (Math.floor(target / 12) - 1)) ? '🎯 One you’ve been missing — tap it on the fretboard.' : 'Tap it on the fretboard. Same pitch in another spot counts too.'));
    actions.innerHTML = '';
    actions.append(btn('Play it again', () => A.pluck(target), { cls: 'primary', icon: 'play' }), btn('Show me', reveal, { cls: 'ghost' }), btn('Skip', newRound, { cls: 'ghost', icon: 'next' }));
    setTimeout(() => A.pluck(target), 150);
    paintScore();
  }
  function markSolved() { if (solved) fb.positions(target).forEach(([s, f]) => fb.mark(s, f, 'right', pretty(noteOf(target)))); }
  const earItem = () => noteOf(target) + (Math.floor(target / 12) - 1);
  function reveal() {
    if (solved || target == null) return;
    if (tries === 0) LS.record('ear', level('ear'), earItem(), false, 0);
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
      if (tries === 0) LS.record('ear', level('ear'), earItem(), true, streak + 1);
      if (tries === 0) { right_++; streak++; saveBest('ear', `${streak} in a row (${frets === 0 ? 'open strings' : 'to fret ' + frets})`, (cur) => parseInt(cur, 10) < streak); }
      else streak = 0;
      markSolved(); right(cell, streak > 0 && streak % 5 === 0);
      paintScore();
      setTimeout(newRound, 1400);
    } else {
      if (tries === 0) LS.record('ear', level('ear'), earItem(), false, 0);
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
  const FIND = { beg: [false, 5], int: [false, 12], hard: [true, 15] }; // sharps & flats, last fret
  let [sharps, toFret] = FIND[level('find')];
  let pc = null, found = new Set(), need = [], misses = 0, t0 = 0, done = false, clock = null;
  const bar = instrumentBar(() => rebuild());
  const ctl = h('div', { class: 'learn-controls' });
  const head = h('div', { class: 'find-head' });
  const holder = h('div', { class: 'fb-holder' });
  const actions = h('div', { class: 'learn-actions' });
  body.append(levelBar('find', (k) => { [sharps, toFret] = FIND[k]; rebuild(); }), bar, ctl, head, holder, actions);
  let fb = null;
  function paintCtl() {
    ctl.innerHTML = '';
    ctl.append(h('div', { class: 'hint' }, `${sharps ? 'All 12 notes, sharps and flats too' : 'Natural notes (no sharps or flats)'} · open to fret ${toFret}`));
  }
  function rebuild() { fb = fretboard({ ...currentSetup(), from: 0, to: toFret, onTap: tap }); holder.innerHTML = ''; holder.append(fb.el); paintCtl(); newNote(); }
  function newNote() {
    const list = sharps ? ALLNOTES : NATURALS;
    const n = LS.pickSmart('find', list, pc == null ? [] : [ALLNOTES[pc]]);
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
    if (!misses && secs < S.pref('learn.findbest', 1e9)) { S.setPref('learn.findbest', secs); S.setPref('learn.best.find', `all ${need.length} ${pretty(ALLNOTES[pc])}’s in ${fmtTime(secs)}, no misses (to fret ${toFret})`); }
    actions.innerHTML = ''; actions.append(btn('Next note', newNote, { cls: 'primary big', icon: 'next' }));
  }
  function showAll() { need.forEach(([s, f]) => fb.mark(s, f, 'found', pretty(ALLNOTES[pc]))); done = true; clearInterval(clock); actions.innerHTML = ''; actions.append(btn('Next note', newNote, { cls: 'primary big', icon: 'next' })); }
  function tap(s, f, midi, cell) {
    A.pluck(midi);
    if (done) return;
    if (((midi % 12) + 12) % 12 === pc) {
      if (found.has(s + ':' + f)) return;
      found.add(s + ':' + f);
      LS.record('find', level('find'), ALLNOTES[pc], true);
      fb.mark(s, f, 'found', pretty(ALLNOTES[pc]));
      right(cell, found.size === need.length);
      paintHead();
      if (found.size === need.length) setTimeout(finish, 350);
    } else {
      misses++;
      LS.record('find', level('find'), ALLNOTES[pc], false, 0);
      cell.querySelector('.fb-dotname').textContent = pretty(noteOf(midi));
      cell.classList.add('miss'); setTimeout(() => { cell.classList.remove('miss'); if (!cell.classList.contains('found')) cell.querySelector('.fb-dotname').textContent = ''; }, 900);
      wrong(cell); paintHead();
    }
  }
  rebuild();
  return () => clearInterval(clock);
}

// ---------- 5. music fundamentals: read the staff, name the key
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '': 0, '#': 1, b: -1 };
const accSym = (a) => (a === '#' ? '♯' : a === 'b' ? '♭' : '');
const MAJ_BY_FIFTHS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']; // −7 … +7
const MIN_BY_FIFTHS = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
const diaOf = (p) => { const m = /^([A-G])(\d)$/.exec(p); return Number(m[2]) * 7 + LETTERS.indexOf(m[1]); };

// One staff as SVG: clef, optional key signature, optional note (diatonic number + accidental).
function staffSvg({ clef = 't', fifths = 0, note = null, acc = '' }) {
  const sp = 14, top = 3.8 * sp, W = 300, H = top + 4 * sp + 3.6 * sp;
  const bottom = BOTTOM[clef];
  const yOf = (d) => top + 4 * sp - (d - bottom) * sp / 2;
  let s = `<svg class="staff-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Staff">`;
  for (let k = 0; k < 5; k++) s += `<line x1="8" x2="${W - 8}" y1="${top + k * sp}" y2="${top + k * sp}" stroke="currentColor" stroke-width="1.3"/>`;
  s += '<g fill="currentColor">';
  s += clef === 't' ? glyph('gclef', 16, top - 1.45 * sp, 7.1 * sp).svg : glyph('fclef', 18, top, 3.3 * sp).svg;
  let x = 16 + 3.4 * sp;
  if (fifths) {
    const sharp = fifths > 0, list = KEY_POS[clef][sharp ? 's' : 'f'].slice(0, Math.abs(fifths));
    list.forEach((p, k) => { const y = yOf(diaOf(p)); s += sharp ? glyph('sharp', x + k * 1.1 * sp, y - 1.35 * sp, 2.7 * sp).svg : glyph('flat', x + k * 1.1 * sp, y - 1.7 * sp, 2.4 * sp).svg; });
  }
  if (note != null) {
    const nx = W / 2 + 30, y = yOf(note), nh = sp * 1.05;
    // ledger lines
    for (let d = bottom - 2; d >= note; d -= 2) s += `<rect x="${nx - 0.55 * sp}" y="${yOf(d) - 0.7}" width="${2.75 * sp}" height="1.4"/>`;
    for (let d = bottom + 10; d <= note; d += 2) s += `<rect x="${nx - 0.55 * sp}" y="${yOf(d) - 0.7}" width="${2.75 * sp}" height="1.4"/>`;
    s += glyph('whole', nx, y - nh / 2, nh).svg;
    if (acc === '#') s += glyph('sharp', nx - 1.6 * sp, y - 1.35 * sp, 2.7 * sp).svg;
    if (acc === 'b') s += glyph('flat', nx - 1.6 * sp, y - 1.7 * sp, 2.4 * sp).svg;
  }
  return s + '</g></svg>';
}

function readQuiz(body) {
  let mode = S.pref('learn.readmode', 'notes');
  let right_ = 0, total = 0, streak = 0, answered = false, last = null;
  const controls = h('div', { class: 'learn-controls' });
  const prompt = h('div', { class: 'learn-prompt' });
  const score = h('div', { class: 'learn-score' });
  const stage = h('div', { class: 'staff-stage' });
  const below = h('div', {});
  body.append(levelBar('read', () => restart()), controls, prompt, score, stage, below);
  function paintControls() {
    controls.innerHTML = '';
    const seg = (val, label) => h('button', { type: 'button', class: 'seg-btn' + (mode === val ? ' on' : ''), onclick: () => { mode = val; S.setPref('learn.readmode', mode); paintControls(); restart(); } }, label);
    controls.append(h('div', { class: 'segmented' }, seg('notes', '🎵 Read notes'), seg('keys', '🔑 Key signatures')));
  }
  const paintScore = () => { score.textContent = total ? `✅ ${right_} of ${total}   ·   🔥 streak ${streak}` : ''; };
  const midiOf = (d, acc) => 12 * (Math.floor(d / 7) + 1) + LETTER_SEMI[d % 7] + ACC[acc];

  // answers: a row of buttons; check(label) → true/false; onDone plays the sound
  function answers(labels, ans, sound, item, cls = 'choice-grid') {
    below.innerHTML = '';
    const grid = h('div', { class: cls }, labels.map(o => h('button', { type: 'button', class: 'choice', onclick: (e) => {
      if (answered) return; answered = true; total++;
      const ok = o === ans;
      LS.record('read', level('read'), item, ok, ok ? streak + 1 : 0);
      sound();
      e.currentTarget.classList.add(ok ? 'right' : 'wrong');
      grid.querySelectorAll('.choice').forEach(c => { if (c.textContent === ans) c.classList.add('right'); });
      if (ok) { right_++; streak++; right(e.currentTarget, streak % 5 === 0); saveBest('read', `${streak} in a row (${LEVEL_NAME[level('read')].slice(3)})`, (cur) => parseInt(cur, 10) < streak); }
      else { streak = 0; wrong(e.currentTarget); }
      paintScore();
      setTimeout(next, ok ? 1300 : 2600);
    } }, o)));
    below.append(grid);
  }

  const recentRead = [];
  function noteRound() {
    const L = level('read');
    const clef = L === 'beg' ? 't' : rnd(['t', 'b']);
    const bottom = BOTTOM[clef];
    // Beginner: on the staff (one step below to one above). Intermediate/Hard: up to 3 ledger lines either side.
    const lo = L === 'beg' ? bottom - 1 : bottom - 6, hi = L === 'beg' ? bottom + 9 : bottom + 14;
    const cands = [];
    for (let dd = lo; dd <= hi; dd++) {
      const lt = LETTERS[dd % 7];
      cands.push({ d: dd, acc: '' });
      if (L === 'hard') { if ('CDFGA'.includes(lt)) cands.push({ d: dd, acc: '#' }); if ('DEGAB'.includes(lt)) cands.push({ d: dd, acc: 'b' }); }
    }
    const itemOf = (c) => `note:${clef === 't' ? 'Treble' : 'Bass'} ${LETTERS[c.d % 7]}${c.acc}${Math.floor(c.d / 7)}`;
    const pickN = LS.pickSmart('read', cands, recentRead, itemOf);
    const d = pickN.d, acc = pickN.acc;
    recentRead.unshift(itemOf(pickN)); recentRead.length = Math.min(recentRead.length, 4);
    const letter = LETTERS[d % 7], ans = letter + accSym(acc);
    prompt.innerHTML = ''; const itemNow = `note:${clef === 't' ? 'Treble' : 'Bass'} ${letter}${acc}${Math.floor(d / 7)}`;
    prompt.append(h('b', { class: 'big-q' }, `Name this note`), h('div', { class: 'hint' }, (clef === 't' ? 'Treble clef' : 'Bass clef') + (LS.isWeak('read', itemNow) ? ' · 🎯 one you’ve been missing' : '')));
    stage.innerHTML = staffSvg({ clef, note: d, acc });
    const sound = () => A.preview([midiOf(d, acc)]);
    const item = `note:${clef === 't' ? 'Treble' : 'Bass'} ${letter}${acc}${Math.floor(d / 7)}`;
    if (L !== 'hard') return answers(LETTERS, ans, sound, item, 'choice-grid letters');
    // Hard: four spelled choices — the right one, the same letter with other accidentals, and a neighbour
    const pc = (l, a) => (LETTER_SEMI[LETTERS.indexOf(l)] + ACC[a] + 12) % 12;
    const valid = (l, a) => !(a === '#' && 'EB'.includes(l)) && !(a === 'b' && 'CF'.includes(l));
    const target = pc(letter, acc), pool = [];
    for (const l of LETTERS) for (const a of ['', '#', 'b']) if (valid(l, a) && pc(l, a) !== target) pool.push({ l, a, near: l === letter ? 0 : Math.abs(LETTERS.indexOf(l) - LETTERS.indexOf(letter)) === 1 ? 1 : 2 });
    const pick = shuffle(pool).sort((x, y) => x.near - y.near).slice(0, 3).map(o => o.l + accSym(o.a));
    answers(shuffle([ans, ...pick]), ans, sound, item);
  }

  function keyRound() {
    const L = level('read');
    const span = L === 'beg' ? 2 : L === 'int' ? 4 : 7;
    const clef = L === 'beg' ? 't' : rnd(['t', 'b']);
    const kc = [];
    for (let k = -span; k <= span; k++) { kc.push({ f: k, minor: false }); if (L === 'hard') kc.push({ f: k, minor: true, boost: 0.7 }); }
    const keyItem = (c) => `key:${(c.minor ? MIN_BY_FIFTHS : MAJ_BY_FIFTHS)[c.f + 7]} ${c.minor ? 'minor' : 'major'}`;
    const kp = LS.pickSmart('read', kc, [last], keyItem);
    last = keyItem(kp);
    const f = kp.f, minor = kp.minor;
    const names = minor ? MIN_BY_FIFTHS : MAJ_BY_FIFTHS;
    const label = (k) => `${names[k + 7]} ${minor ? 'minor' : 'major'}`;
    const ans = label(f);
    const others = shuffle([...Array(2 * span + 1).keys()].map(k => k - span).filter(k => k !== f)).sort((a, b) => Math.abs(a - f) - Math.abs(b - f)).slice(0, 3);
    prompt.innerHTML = ''; prompt.append(h('b', { class: 'big-q' }, minor ? 'Which minor key is this?' : 'Which major key is this?'),
      h('div', { class: 'hint' }, minor ? 'Find the major key first, then go down three half steps.' : f > 0 ? 'Tip: the last sharp is a half step below the key.' : f < -1 ? 'Tip: the second-to-last flat names the key.' : ' '));
    stage.innerHTML = staffSvg({ clef, fifths: f });
    const tonic = 48 + ((((f * 7) % 12) + 12) % 12) + (minor ? -3 : 0);
    const sound = () => A.preview(minor ? [tonic, tonic + 3, tonic + 7] : [tonic, tonic + 4, tonic + 7]);
    answers(shuffle([ans, ...others.map(label)]), ans, sound, 'key:' + ans);
  }

  function next() { answered = false; mode === 'notes' ? noteRound() : keyRound(); }
  function restart() { right_ = total = streak = 0; last = null; paintScore(); next(); }
  paintControls(); restart();
}
