import * as THREE from './lib/three.js';
import { Stage, Sheet, createBin } from './stage.js';
import { Physics, BIN, Body, Sleeping } from './physics.js';
import { Sound } from './sound.js';
import { NOTE_SIZE as S, GLUE_FRACTION, COLORS, COLOR_ORDER, drawDoodles } from './paper.js';
import * as D from './deform.js';
import { NoteEditor } from './editor.js';

const api = window.sticks;
const sound = new Sound();
const notesLayer = document.getElementById('notes');
const binUI = document.getElementById('bin-ui');
const binCount = binUI.querySelector('.bin-count');

const stage = new Stage(document.getElementById('stage'));
const physics = new Physics(sound);
let W = window.innerWidth;
let H = window.innerHeight;
stage.resize(W, H);
physics.layout(W, H);
const bin = createBin(stage, BIN);

const HOLD_GRAVITY = 2600; // px/s², how hard a held note swings back under the fingers
const SHEET_Z = 0.6; // keeps the flat 3D sheet just above the shadow-catching wall
const BALL_GLOW = 0.32; // see Sheet.setGlow
const GRIP = { x: 0, y: S / 2 - 16 }; // where a detached note is held: the middle of its glue strip
const COLLIDE_ALL = 0xffffffff;
const BIN_AXIS_Z = BIN.topHalf; // the bin's back touches the wall, so its axis is this far out
const BIN_CAPACITY = 4; // balls that fit below the rim; more get squashed down (see sinkOldest)
const PEN_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M15.5 4.5l4 4L8.5 19.5 3.8 20.2l.7-4.7z"/><path d="M13 7l4 4"/></svg>`;
const UNDO_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>`;
const DRAW_TOOLS = `
      <button class="btn pen" title="Doodle on this note (Esc to stop)">${PEN_ICON}</button>
      <button class="btn undo" title="Undo last stroke (Ctrl+Z)">${UNDO_ICON}</button>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 7h16M9 7V4.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V7M6.5 7l.9 12.2c.1.9.8 1.8 1.8 1.8h5.6c1 0 1.7-.9 1.8-1.8L17.5 7M10 11v6M14 11v6"/></svg>`;

let doc = { version: 1, notes: [], balls: [], bin: null, stats: { done: 0 }, history: [] };
const entries = new Map(); // note id -> { note, el, ta }
const balls = new Set();
const actors = new Set(); // per-frame animations: { update(dt, time) -> false when finished }
let interaction = null; // the current drag, if any
let topZ = 1;

// One line per user action; shown in the terminal with STICKS_LOG=1 (npm run log).
const log = (...parts) => console.info(parts.join(' '));
window.addEventListener('error', (e) => console.error('Uncaught:', e.error?.stack || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason?.stack || e.reason));

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const rad = (deg) => (deg * Math.PI) / 180;
const randSeed = () => (Math.random() * 2 ** 31) | 0;

// ---------------------------------------------------------------- pointer tracking

const pointer = { x: W / 2, y: H / 2, samples: [] };

function trackPointer(e) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  const now = performance.now();
  pointer.samples.push({ t: now, x: e.clientX, y: e.clientY });
  while (pointer.samples.length > 2 && now - pointer.samples[0].t > 100) pointer.samples.shift();
}

/** Pointer velocity in px/ms over the last ~100 ms. */
function pointerVelocity() {
  const s = pointer.samples;
  if (s.length < 2) return { x: 0, y: 0 };
  const a = s[0], b = s[s.length - 1];
  const dt = Math.max(8, b.t - a.t);
  if (performance.now() - b.t > 80) return { x: 0, y: 0 }; // the hand stopped before letting go
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

// ---------------------------------------------------------------- click-through

let captured = null;
function setCaptured(on) {
  if (on === captured) return;
  captured = on;
  api.setIgnoreMouse(!on);
}

function refreshCapture(x = pointer.x, y = pointer.y) {
  const nearBin = updateBinMenu(x, y);
  if (interaction) return setCaptured(true);
  const el = document.elementFromPoint(x, y);
  setCaptured(nearBin || !!(el && el.closest('.note, #bin-ui')) || !!ballAt(x, y));
}

/**
 * The bin's Restore/Empty pill sits above the bin, often behind a heap of paper balls. Treat the
 * bin, the pill and the space between them as one zone so the pill doesn't vanish on the way up.
 */
function updateBinMenu(x, y) {
  const pill = binUI.querySelector('.bin-pill').getBoundingClientRect();
  const box = binUI.getBoundingClientRect();
  const pad = 12;
  const near = !binUI.classList.contains('dragging') &&
    x >= Math.min(box.left, pill.left) - pad && x <= Math.max(box.right, pill.right) + pad &&
    y >= pill.top - pad && y <= box.bottom + pad;
  binUI.classList.toggle('show', near);
  return near;
}
document.documentElement.addEventListener('mouseleave', () => binUI.classList.remove('show'));

window.addEventListener('mousemove', (e) => {
  trackPointer(e);
  refreshCapture(e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e) => {
  trackPointer(e);
  // a second button pressed mid-drag arrives as a "chorded" pointermove, not a pointerdown
  if (e.button === 2 && interaction?.crumple) interaction.crumple();
  if (interaction?.move) interaction.move(e);
});
window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  const it = interaction;
  if (it?.up) it.up(e);
  refreshCapture(e.clientX, e.clientY);
});
window.addEventListener('blur', () => {
  // focus lost mid-drag (e.g. Alt+Tab): let go gracefully
  if (interaction?.up) interaction.up();
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  interaction?.crumple?.(); // last-resort path for a right-click while holding a note
});

// ---------------------------------------------------------------- frame loop

let rafId = 0;
let lastFrame = 0;

function kick() {
  if (!rafId) {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (balls.size) physics.step(dt * 1000);
  for (const a of actors) if (a.update(dt, now / 1000) === false) actors.delete(a);
  if (interaction?.tick) interaction.tick(dt, now / 1000);
  for (const ball of balls) ball.sync();
  stage.render();

  const busy = actors.size || (interaction && !interaction.passive) || physics.active;
  if (busy) {
    rafId = requestAnimationFrame(frame);
  } else {
    rafId = 0;
    scheduleSave(); // everything has come to rest: remember where it all ended up
  }
}

function animate(duration, step, done) {
  let t = 0;
  actors.add({
    update(dt) {
      t = Math.min(1, t + dt / duration);
      step(t);
      if (t >= 1) {
        done?.();
        return false;
      }
    },
  });
  kick();
}

// ---------------------------------------------------------------- persistence

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

// Quitting from the tray (or a restart) must not drop an edit still waiting on the save timer.
window.addEventListener('beforeunload', () => saveNow());

function saveNow() {
  doc.notes = [...entries.values()].map((e) => e.note).sort((a, b) => a.z - b.z);
  doc.balls = [...balls].map((b) => b.record());
  doc.bin = { x: physics.binX };
  const { x, y, color, text, doodles } = pad.note;
  doc.pad = { x, y, color, text, doodles };
  api.save(doc);
}

// ---------------------------------------------------------------- notes on the wall

function noteCenter(note) {
  return { x: note.x + S / 2, y: note.y + S / 2 };
}

function clampNote(note) {
  note.x = D.clamp(note.x, -S * 0.4, W - S * 0.6);
  note.y = D.clamp(note.y, 0, H - S * 0.5);
}

function styleNote(entry) {
  const { note, el } = entry;
  const c = COLORS[note.color] || COLORS.yellow;
  el.style.left = `${note.x}px`;
  el.style.top = `${note.y}px`;
  el.style.transform = `rotate(${note.rot}deg)`;
  el.style.zIndex = note.z;
  el.style.setProperty('--paper', c.paper);
  el.style.setProperty('--shade', c.shade);
  el.style.setProperty('--back', c.back);
  el.style.setProperty('--ink', c.ink);
}

function mountNote(note, { focus = false, slap = false } = {}) {
  const el = document.createElement('div');
  el.className = 'note';
  el.innerHTML = `
    <div class="curl-shadow"></div>
    <div class="paper"></div>
    <div class="grip">
      <button class="btn color" title="Change colour"></button>${DRAW_TOOLS}
      <span class="spacer"></span>
      <button class="btn done" title="Done? Crumple it, then throw it in the bin (Ctrl+Enter)&#10;Shift+click: crumple and toss it straight in">${TRASH_ICON}</button>
    </div>
    <div class="peel peel-br" title="Peel me off"></div>
    <div class="peel peel-bl" title="Peel me off"></div>`;
  const entry = { note, el };
  attachEditor(entry, (e) => crumpleFromWall(entry, { toss: e.shiftKey }));
  attachInk(entry);
  entries.set(note.id, entry);
  topZ = Math.max(topZ, note.z || 0);
  styleNote(entry);
  notesLayer.appendChild(el);

  el.addEventListener('pointerdown', () => raise(entry), true);
  enableDragging(entry);
  el.querySelector('.color').addEventListener('click', () => {
    note.color = COLOR_ORDER[(COLOR_ORDER.indexOf(note.color) + 1) % COLOR_ORDER.length];
    styleNote(entry);
    renderInk(entry); // doodles use the colour's ink
    scheduleSave();
  });
  el.querySelector('.done').addEventListener('click', (e) => crumpleFromWall(entry, { toss: e.shiftKey }));
  for (const corner of ['br', 'bl']) {
    el.querySelector(`.peel-${corner}`).addEventListener('pointerdown', (e) => {
      if (e.button === 0) startPeel(entry, corner, e);
    });
  }

  if (slap) {
    el.classList.add('slap');
    el.addEventListener('animationend', () => el.classList.remove('slap'), { once: true });
    sound.pat();
  }
  if (focus) requestAnimationFrame(() => entry.editor.focusEnd());
  return entry;
}

/** Gives a note (or the pad) its checklist-capable text editor, kept in sync with note.text. */
function attachEditor(entry, onCtrlEnter) {
  const { note, el } = entry;
  const editor = new NoteEditor({
    onCtrlEnter,
    onToggle: (done) => {
      log(done ? 'checklist item ticked' : 'checklist item unticked');
      if (done) sound.tick(); else sound.flap();
    },
    onChange: (text) => {
      note.text = text;
      note.updated = Date.now();
      scheduleSave();
    },
  });
  editor.setText(note.text);
  el.querySelector('.grip').after(editor.el);
  entry.editor = editor;
  entry.setText = (text) => {
    editor.setText(text);
    note.text = text;
    scheduleSave();
  };
}

// ---------------------------------------------------------------- doodles

let drawingEntry = null; // the note (or pad) in doodle mode, if any
const STROKE_WIDTH = 2.6;

/** A drawing layer over the note's text; it only takes the mouse while doodle mode is on. */
function attachInk(entry) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ink';
  entry.editor.el.after(canvas);
  entry.ink = canvas;
  entry.note.doodles ??= [];
  renderInk(entry);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && drawingEntry === entry) startStroke(entry, e);
  });
  entry.el.querySelector('.pen').addEventListener('click', () => setDrawing(entry, drawingEntry !== entry));
  entry.el.querySelector('.undo').addEventListener('click', () => undoStroke(entry));
}

function renderInk(entry) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = entry.ink;
  if (canvas.width !== Math.round(S * dpr)) canvas.width = canvas.height = Math.round(S * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  drawDoodles(ctx, entry.note.doodles, (COLORS[entry.note.color] || COLORS.yellow).ink);
}

function setDrawing(entry, on) {
  if (drawingEntry && drawingEntry !== entry) drawingEntry.el.classList.remove('drawing');
  entry.el.classList.toggle('drawing', on);
  drawingEntry = on ? entry : null;
  if (on) entry.editor.blur();
  log(on ? 'doodle mode on' : 'doodle mode off');
}

function startStroke(entry, e) {
  e.preventDefault();
  e.stopPropagation();
  const { note } = entry;
  const stroke = { w: STROKE_WIDTH, pts: [] };
  const add = (cx, cy) => {
    const x = Math.round((cx - note.x) * 10) / 10;
    const y = Math.round((cy - note.y) * 10) / 10;
    const p = stroke.pts;
    if (p.length && Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 1.2) return;
    p.push(x, y);
  };
  add(e.clientX, e.clientY);
  note.doodles.push(stroke);
  entry.ink.setPointerCapture(e.pointerId);
  renderInk(entry);
  interaction = {
    passive: true,
    move(ev) {
      // coalesced events keep fast strokes smooth instead of turning them into polygons
      for (const c of ev.getCoalescedEvents?.() ?? [ev]) add(c.clientX, c.clientY);
      renderInk(entry);
    },
    up() {
      interaction = null;
      note.updated = Date.now();
      log(`doodled a stroke (${stroke.pts.length / 2} points)`);
      scheduleSave();
    },
  };
  setCaptured(true);
}

function undoStroke(entry) {
  if (!entry.note.doodles.length) return;
  entry.note.doodles.pop();
  log(`undid a stroke (${entry.note.doodles.length} left)`);
  renderInk(entry);
  scheduleSave();
}

window.addEventListener('keydown', (e) => {
  if (!drawingEntry) return;
  if (e.key === 'Escape') setDrawing(drawingEntry, false);
  else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    undoStroke(drawingEntry);
  }
});

function unmountNote(entry) {
  entry.el.remove();
  entries.delete(entry.note.id);
}

function raise(entry) {
  if (entry.note.z === topZ) return;
  entry.note.z = ++topZ;
  entry.el.style.zIndex = entry.note.z;
  scheduleSave();
}

// Users only get new notes by peeling the pad; this shortcut exists for the scripted UI test.
function newNote(at) {
  const count = entries.size;
  const note = {
    id: uid(),
    text: '',
    color: count === 0 ? 'yellow' : COLOR_ORDER[Math.floor(Math.random() * COLOR_ORDER.length)],
    x: at?.x ?? W * 0.5 - S / 2 + (count % 6) * 30,
    y: at?.y ?? H * 0.18 + (count % 6) * 30,
    rot: 0,
    z: ++topZ,
    created: Date.now(),
    updated: Date.now(),
  };
  clampNote(note);
  mountNote(note, { focus: true, slap: true });
  log('new note');
  scheduleSave();
}

// ---------------------------------------------------------------- the pad

let pad = null; // { note, el, ta }: note holds the pad's position, colour and top-sheet text

function mountPad(state) {
  const el = document.createElement('div');
  el.className = 'note pad';
  el.innerHTML = `
    <div class="curl-shadow"></div>
    <div class="stack"></div>
    <div class="paper"></div>
    <div class="grip">
      <button class="btn color" title="Change pad colour"></button>${DRAW_TOOLS}
      <span class="spacer"></span>
    </div>
    <div class="peel peel-br" title="Peel the top sheet off"></div>
    <div class="peel peel-bl" title="Peel the top sheet off"></div>`;
  const note = { id: 'pad', text: '', color: 'yellow', ...state, rot: 0, z: 0 };
  pad = { note, el };
  attachEditor(pad);
  attachInk(pad);
  clampNote(note);
  styleNote(pad);
  notesLayer.appendChild(el);

  enableDragging(pad);
  el.querySelector('.color').addEventListener('click', () => {
    note.color = COLOR_ORDER[(COLOR_ORDER.indexOf(note.color) + 1) % COLOR_ORDER.length];
    styleNote(pad);
    renderInk(pad);
    scheduleSave();
  });
  for (const corner of ['br', 'bl']) {
    el.querySelector(`.peel-${corner}`).addEventListener('pointerdown', (e) => {
      if (e.button === 0) startPeel(pad, corner, e, { fromPad: true });
    });
  }
}

/** The top sheet comes away as a note of its own; a fresh blank sheet is left on the pad. */
function tearFromPad() {
  const p = pad.note;
  const note = { id: uid(), text: p.text, doodles: p.doodles || [], color: p.color, x: p.x, y: p.y, rot: 0, z: ++topZ, created: Date.now(), updated: Date.now() };
  const entry = mountNote(note);
  setLifted(entry, true);
  pad.setText('');
  pad.note.doodles = [];
  renderInk(pad);
  pad.el.classList.remove('peeling');
  scheduleSave();
  return entry;
}

/** Toggles the DOM note for its 3D twin (the twin takes over while paper is in motion). */
function setLifted(entry, lifted) {
  entry.el.classList.toggle('lifted', lifted);
  if (!lifted) return;
  entry.editor.blur();
  if (drawingEntry === entry) setDrawing(entry, false);
}

function placeSheetOnNote(sheet, note) {
  const c = noteCenter(note);
  sheet.group.position.set(c.x, -c.y, 0);
  sheet.group.rotation.z = -rad(note.rot);
}

/** Screen point -> the sheet's local (unrotated, y-up) coordinates. */
function toLocal(group, sx, sy) {
  const dx = sx - group.position.x;
  const dy = -sy - group.position.y;
  const t = group.rotation.z;
  const c = Math.cos(t), s = Math.sin(t);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

// ---------------------------------------------------------------- slide (drag a note around the wall)

/**
 * Drag by the top strip, or by the body of a note that isn't being edited. With `clickToEdit`,
 * a press that doesn't move becomes a click that starts typing instead.
 */
function startSlide(entry, e, { clickToEdit = false } = {}) {
  e.preventDefault(); // also keeps the editor from grabbing focus until we know it's a click
  const { note, el } = entry;
  const ox = e.clientX - note.x, oy = e.clientY - note.y;
  let moved = !clickToEdit;
  el.setPointerCapture(e.pointerId);
  if (moved) el.classList.add('sliding');
  interaction = {
    passive: true, // plain DOM drag: no need to keep the 3D loop running
    move(ev) {
      if (!moved) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        moved = true;
        el.classList.add('sliding');
      }
      note.x = ev.clientX - ox;
      note.y = ev.clientY - oy;
      clampNote(note);
      styleNote(entry);
    },
    up() {
      el.classList.remove('sliding');
      interaction = null;
      if (!moved) {
        entry.editor.focusAt(e.clientX, e.clientY);
      } else if (note.x !== e.clientX - ox || note.y !== e.clientY - oy) {
        log(`moved ${note.id === 'pad' ? 'pad' : 'note'} to ${Math.round(note.x)},${Math.round(note.y)}`);
        scheduleSave();
      }
    },
  };
  setCaptured(true);
}

function enableDragging(entry) {
  entry.el.querySelector('.grip').addEventListener('pointerdown', (e) => {
    if (e.button === 0 && !e.target.closest('.btn')) startSlide(entry, e);
  });
  entry.editor.el.addEventListener('pointerdown', (e) => {
    // while editing, the mouse selects text as usual
    if (e.button === 0 && !entry.editor.isEditing) startSlide(entry, e, { clickToEdit: true });
  });
}

// ---------------------------------------------------------------- peel

/** Peel a stuck note, or the top sheet of the pad (which leaves the next sheet behind). */
function startPeel(entry, corner, e, { fromPad = false } = {}) {
  e.preventDefault();
  e.stopPropagation();
  const note = entry.note;
  const sheet = new Sheet(stage, note, entry.editor.el.scrollTop);
  placeSheetOnNote(sheet, note);
  sheet.flatten(SHEET_Z);
  const lift = (on) => {
    if (!fromPad) return setLifted(entry, on);
    // only the top sheet comes up; the pad and the blank sheet under it stay put
    entry.el.classList.toggle('peeling', on);
    if (on) entry.editor.blur();
  };
  lift(true);
  log(`peel started (${fromPad ? 'pad' : 'note'}, ${corner === 'br' ? 'bottom-right' : 'bottom-left'} corner)`);

  const P0 ={ x: corner === 'br' ? S / 2 : -S / 2, y: -S / 2 };
  const il = Math.hypot(P0.x, P0.y);
  const inward = { x: -P0.x / il, y: -P0.y / il };
  const down = toLocal(sheet.group, e.clientX, e.clientY);
  let lastLen = 0;
  let Q = { ...P0 };
  // keep receiving moves even if the cursor leaves the overlay (e.g. over the taskbar)
  document.documentElement.setPointerCapture(e.pointerId);

  const shape = () => {
    const fold = D.solvePeel(P0, Q, inward);
    if (fold) D.applyPeel(sheet.base, sheet.pos, fold, SHEET_Z);
    else sheet.flatten(SHEET_Z);
    sheet.commit();
    return fold;
  };

  let target = { ...P0 };
  interaction = {
    move() {
      const p = toLocal(sheet.group, pointer.x, pointer.y);
      target = { x: P0.x + p.x - down.x, y: P0.y + p.y - down.y };
      kick();
    },
    // The corner glides after the cursor (a short exponential follow) instead of snapping to
    // each mouse event, which is what made the curl look steppy on a real mouse.
    tick(dt) {
      const k = 1 - Math.exp(-dt * 26);
      Q = { x: Q.x + (target.x - Q.x) * k, y: Q.y + (target.y - Q.y) * k };
      const fold = shape();
      if (!fold) return;
      sound.peelTick(Math.abs(fold.len - lastLen));
      lastLen = fold.len;
      if (D.peelDetaches(fold, sheet.base, S, S, GLUE_FRACTION)) startHold(fromPad ? tearFromPad() : entry, sheet, P0);
    },
    up() {
      // not peeled far enough: the corner springs back onto the wall
      interaction = null;
      log(`let go before the glue released (pulled ${Math.round(lastLen)}px) — corner springs back`);
      const from = { ...Q };
      sound.flap();
      animate(0.28, (t) => {
        const k = 1 - D.easeOutBack(t);
        Q = { x: P0.x + (from.x - P0.x) * k, y: P0.y + (from.y - P0.y) * k };
        shape();
      }, () => {
        sheet.dispose();
        lift(false);
        stage.render();
      });
    },
  };
  setCaptured(true);
  kick();
}

// ---------------------------------------------------------------- held in hand

function startHold(entry, sheet, corner) {
  sound.rip();
  log('glue released — note is in your hand');
  const from = Float32Array.from(sheet.pos);
  const hang = new Float32Array(sheet.pos.length);
  const group = sheet.group;
  // Where the paper was when it let go, so the hand-off blends from exactly what is on screen.
  const fromX = group.position.x, fromY = group.position.y, fromTheta = group.rotation.z;
  let theta = group.rotation.z;
  let omega = 0;
  let blend = 0;
  let regrip = 0;
  let vPrev = { x: 0, y: 0 };
  let acc = { x: 0, y: 0 };
  let crumpling = null;
  // The note comes off held by the corner it was peeled from, then the fingers shift to the
  // top of the glue strip so it hangs upright and sticks exactly where it is dropped.
  const G = { ...corner };

  const it = {
    entry, sheet,
    tick(dt, time) {
      if (!crumpling && regrip < 1) {
        regrip = Math.min(1, regrip + dt / 0.35);
        const k = D.easeInOut(regrip);
        G.x = D.lerp(corner.x, GRIP.x, k);
        G.y = D.lerp(corner.y, GRIP.y, k);
      }
      const inertia = (S * S + S * S) / 12 + G.x * G.x + G.y * G.y;
      // The fingers are the pivot; gravity minus the hand's acceleration swings the note.
      const v = pointerVelocity();
      const vw = { x: v.x * 1000, y: -v.y * 1000 };
      const a = { x: (vw.x - vPrev.x) / Math.max(dt, 1e-3), y: (vw.y - vPrev.y) / Math.max(dt, 1e-3) };
      vPrev = vw;
      acc.x += (D.clamp(a.x, -2e4, 2e4) - acc.x) * 0.25;
      acc.y += (D.clamp(a.y, -2e4, 2e4) - acc.y) * 0.25;
      const g = { x: -acc.x * 0.6, y: -HOLD_GRAVITY - acc.y * 0.6 };
      const c = Math.cos(theta), s = Math.sin(theta);
      const rx = -(G.x * c - G.y * s), ry = -(G.x * s + G.y * c);
      const torque = rx * g.y - ry * g.x;
      omega += (torque / inertia) * dt;
      omega *= Math.exp(-(crumpling ? 9 : 3.4) * dt);
      theta += omega * dt;

      const c2 = Math.cos(theta), s2 = Math.sin(theta);
      group.rotation.z = theta;
      group.position.set(pointer.x - (G.x * c2 - G.y * s2), -pointer.y - (G.x * s2 + G.y * c2), 0);

      if (crumpling) return;
      const speed = Math.hypot(vw.x, vw.y);
      D.applyHold(sheet.base, hang, G, S, S, time, D.clamp(speed / 1600, 0, 1) + Math.min(0.25, Math.abs(omega) * 0.1));
      if (blend >= 1) {
        sheet.pos.set(hang);
      } else {
        // The peeled shape is pinned where it was in the world and re-expressed in the moving
        // hand's frame each frame; otherwise the sheet would jump to the cursor on release.
        blend = Math.min(1, blend + dt / 0.32);
        const e = D.easeInOut(blend);
        const c0 = Math.cos(fromTheta), s0 = Math.sin(fromTheta);
        for (let i = 0; i < hang.length; i += 3) {
          const fx = from[i], fy = from[i + 1];
          const dx = c0 * fx - s0 * fy + fromX - group.position.x;
          const dy = s0 * fx + c0 * fy + fromY - group.position.y;
          sheet.pos[i] = D.lerp(c2 * dx + s2 * dy, hang[i], e);
          sheet.pos[i + 1] = D.lerp(-s2 * dx + c2 * dy, hang[i + 1], e);
          sheet.pos[i + 2] = D.lerp(from[i + 2], hang[i + 2], e);
        }
      }
      sheet.commit();
    },
    crumple() {
      if (crumpling) return;
      crumpling = { release: null };
      crumpleSheet(entry, sheet, { ...G }, 30, (ball) => {
        // keep it in the hand; if the button was released mid-crumple, throw it now
        grabBall(ball);
        if (crumpling.release) interaction.up();
      });
    },
    up() {
      if (crumpling) {
        crumpling.release = true;
        return;
      }
      interaction = null;
      stickBack(entry, sheet, theta);
    },
  };
  interaction = it;
}

/** Releasing a held note sticks it back on the wall where it was dropped. */
function stickBack(entry, sheet, theta) {
  const note = entry.note;
  const group = sheet.group;
  const from = Float32Array.from(sheet.pos);
  const fromTheta = theta;
  // notes always go up perfectly straight, however they were swinging when dropped
  const targetDeg = 0;
  // rotate around the centre, which stays where it hangs
  const cx = group.position.x, cy = -group.position.y;
  note.x = cx - S / 2;
  note.y = cy - S / 2;
  note.rot = targetDeg;
  clampNote(note);
  const target = noteCenter(note);
  const turn = -rad(targetDeg) - fromTheta;
  const turnShort = Math.atan2(Math.sin(turn), Math.cos(turn));

  animate(0.24, (t) => {
    const e = D.easeInOut(t);
    group.rotation.z = fromTheta + turnShort * e;
    group.position.set(D.lerp(cx, target.x, e), -D.lerp(cy, target.y, e), 0);
    for (let i = 0; i < from.length; i += 3) {
      sheet.pos[i] = D.lerp(from[i], sheet.base[i], e);
      sheet.pos[i + 1] = D.lerp(from[i + 1], sheet.base[i + 1], e);
      sheet.pos[i + 2] = D.lerp(from[i + 2], SHEET_Z, e);
    }
    sheet.commit();
  }, () => {
    sound.pat();
    log(`stuck on the wall at ${Math.round(note.x)},${Math.round(note.y)}`);
    styleNote(entry);
    raise(entry);
    setLifted(entry, false);
    entry.el.classList.add('slap');
    entry.el.addEventListener('animationend', () => entry.el.classList.remove('slap'), { once: true });
    sheet.dispose();
    stage.render();
    scheduleSave();
  });
}

window.addEventListener('mousedown', (e) => {
  if (e.button === 2 && interaction?.crumple) interaction.crumple();
});
window.addEventListener('wheel', () => interaction?.crumple?.(), { passive: true });
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.key === 'c') && interaction?.crumple) {
    e.preventDefault();
    interaction.crumple();
  }
});

// ---------------------------------------------------------------- crumple

/** Done button / Ctrl+Enter: the note lifts off the wall and is crushed in place. */
function crumpleFromWall(entry, { toss = false } = {}) {
  if (interaction?.entry === entry) return;
  const sheet = new Sheet(stage, entry.note, entry.editor.el.scrollTop);
  placeSheetOnNote(sheet, entry.note);
  sheet.flatten(SHEET_Z);
  setLifted(entry, true);
  crumpleSheet(entry, sheet, { x: 0, y: 0 }, SHEET_Z, (ball) => {
    if (toss) setTimeout(() => tossIntoBin(ball), 120);
    else Body.setVelocity(ball.body, { x: (Math.random() - 0.5) * 2, y: -3 });
  });
}

/** Crushes the sheet's current shape into a ball centred on local point `at`. */
function crumpleSheet(entry, sheet, at, z0, done) {
  const seed = randSeed();
  const crumple = D.makeCrumple(sheet.base, S, S, seed);
  const from = Float32Array.from(sheet.pos);
  const cz = z0 + crumple.radius;
  sheet.setFaceted(true);
  sound.crumple(0.55);
  log(`crumpling (${entry.note.doodles?.length || 0} doodle strokes on it)`);
  unmountNote(entry);
  scheduleSave();

  animate(0.55, (t) => {
    D.applyCrumple(from, sheet.pos, crumple, t, at.x, at.y, cz);
    sheet.setGlow(BALL_GLOW * D.smoothstep(0, 0.6, t));
    sheet.commit();
  }, () => {
    // re-centre the geometry on the ball so it can spin about its own middle
    for (let i = 0; i < sheet.pos.length; i += 3) {
      sheet.pos[i] -= at.x;
      sheet.pos[i + 1] -= at.y;
      sheet.pos[i + 2] -= cz;
    }
    sheet.commit();
    const world = sheet.group.localToWorld(new THREE.Vector3(at.x, at.y, 0));
    const ball = new Ball(entry.note, seed, sheet, crumple, world.x, -world.y);
    done?.(ball);
    scheduleSave();
  });
}

// ---------------------------------------------------------------- paper balls

class Ball {
  constructor(note, seed, sheet, crumple, x, y, { angle = 0, inBin = false, counted = false, doneAt } = {}) {
    this.note = note;
    this.seed = seed;
    this.sheet = sheet;
    this.crumple = crumple;
    this.radius = crumple.radius;
    this.inBin = inBin;
    this.counted = counted;
    this.doneAt = doneAt;
    this.held = false;
    this.z = inBin ? BIN_AXIS_Z : this.radius + 1;
    this.group = new THREE.Group();
    this.group.add(sheet.group);
    sheet.group.position.set(0, 0, 0);
    stage.scene.add(this.group);
    this.body = physics.addBall(this, x, y, this.radius * 0.96);
    Body.setAngle(this.body, angle);
    balls.add(this);
    this.sync();
    kick();
  }

  static fromRecord(r) {
    const sheet = new Sheet(stage, r.note);
    const crumple = D.makeCrumple(sheet.base, S, S, r.seed);
    sheet.pos.set(crumple.target);
    sheet.setFaceted(true);
    sheet.setGlow(BALL_GLOW);
    sheet.commit();
    sheet.group.rotation.z = -rad(r.note.rot || 0);
    return new Ball(r.note, r.seed, sheet, crumple, r.x, r.y, r);
  }

  record() {
    const { x, y } = this.body.position;
    return { note: this.note, seed: this.seed, x, y, angle: this.body.angle, inBin: this.inBin, counted: this.counted, doneAt: this.doneAt };
  }

  sync() {
    this.followHand();
    const { x, y } = this.body.position;
    // Outside the bin a ball rests against the wall; inside it sits on the bin's axis, where the
    // round bin is as wide as its 2D outline. Near the back wall the bin is narrower, so balls
    // that physics keeps inside would visibly poke through its sides.
    const inside = physics.isInsideBin(x, y, this.radius);
    const zTarget = !this.held && (inside || this.inBin) ? BIN_AXIS_Z : this.radius + 1;
    this.z += (zTarget - this.z) * 0.25;
    stage.atDepth(x, y, this.z, this.group.position);
    // and a touch smaller in there, so the lumpiest bits of paper stay clear of the curved wall
    const inBinness = (this.z - this.radius - 1) / (BIN_AXIS_Z - this.radius - 1);
    this.group.scale.setScalar(1 - 0.1 * D.clamp(inBinness, 0, 1));
    this.group.rotation.z = -this.body.angle;
    if (this.held) return;

    if (inside && !this.inBin) {
      this.inBin = true;
      this.doneAt = Date.now();
      sound.inBin();
      if (!this.counted) {
        this.counted = true;
        doc.stats.done = (doc.stats.done || 0) + 1;
      }
      wobbleBin(Math.min(1, this.body.speed / 12));
      log(`ball landed in the bin (${doc.stats.done} done total)`);
      if (inBinBalls().length > BIN_CAPACITY) sinkOldest();
      updateBinCount();
      scheduleSave();
    } else if (!inside && this.inBin && y < H - BIN.height - this.radius) {
      this.inBin = false; // bounced back out
      updateBinCount();
    } else if (!inside && this.body.isSleeping && inBinBalls().length >= BIN_CAPACITY - 1 &&
      Math.abs(x - physics.binX) < BIN.topHalf && y < H - BIN.height + this.radius) {
      // resting on top of a full bin: make room so it settles in
      sinkOldest();
    }
  }

  onCollide() {
    if (this.tossing) {
      this.body.frictionAir = 0.006;
      this.tossing = false;
    }
  }

  /**
   * A held ball sits exactly under the cursor. It is placed after the engine steps, with no
   * velocity of its own: giving it the hand's velocity made the integrator carry it past the
   * cursor every step, so it shook back and forth. The throw speed comes from the pointer.
   */
  followHand() {
    if (!this.held) return;
    Sleeping.set(this.body, false);
    const r = this.radius;
    Body.setPosition(this.body, { x: D.clamp(pointer.x, r, W - r), y: Math.min(pointer.y, H - r) }, false);
    Body.setVelocity(this.body, { x: 0, y: 0 });
    Body.setAngularVelocity(this.body, 0);
  }

  dispose() {
    physics.removeBall(this.body);
    this.group.removeFromParent();
    this.sheet.dispose();
    balls.delete(this);
  }
}

function ballAt(x, y) {
  let best = null, bestD = Infinity;
  for (const b of balls) {
    const d = Math.hypot(b.body.position.x - x, b.body.position.y - y);
    if (d < b.radius + 8 && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

function grabBall(ball) {
  ball.held = true;
  ball.tossing = false;
  ball.body.frictionAir = 0.006;
  // In the hand the ball passes through the floor, the bin and other balls. Otherwise the
  // solver keeps shoving back against the cursor and the ball shakes wherever it touches.
  ball.body.collisionFilter.mask = 0;
  Sleeping.set(ball.body, false);
  log('ball picked up');
  interaction = {
    ball,
    up() {
      interaction = null;
      ball.held = false;
      ball.body.collisionFilter.mask = COLLIDE_ALL;
      const v = pointerVelocity();
      const scale = 1000 / 60; // px/ms -> px per physics step
      let vx = v.x * scale, vy = v.y * scale;
      const speed = Math.hypot(vx, vy);
      const cap = 75;
      if (speed > cap) { vx *= cap / speed; vy *= cap / speed; }
      Body.setVelocity(ball.body, { x: vx, y: vy });
      Body.setAngularVelocity(ball.body, vx * 0.012 + (Math.random() - 0.5) * 0.1);
      if (speed > 10) sound.whoosh(speed);
      log(speed > 3 ? `ball thrown (${Math.round(speed * 60)} px/s)` : 'ball dropped');
      refreshCapture();
      kick();
    },
  };
  setCaptured(true);
  kick();
}

/** Double-click a ball: a perfect lob into the bin. */
function tossIntoBin(ball) {
  if (!balls.has(ball)) return;
  ball.held = false;
  const p = ball.body.position;
  const tx = physics.binX + (Math.random() - 0.5) * 20;
  const ty = H - BIN.height * 0.55;
  const dist = Math.hypot(tx - p.x, ty - p.y);
  const n = Math.round(D.clamp(34 + dist / 20, 34, 85));
  // aim so the arc clears the rim from above
  const v = physics.ballisticVelocity(p, tx, ty, n);
  ball.body.frictionAir = 0;
  ball.tossing = true;
  log('auto-toss into the bin');
  Sleeping.set(ball.body, false);
  Body.setVelocity(ball.body, v);
  Body.setAngularVelocity(ball.body, (Math.random() - 0.5) * 0.3);
  sound.whoosh(Math.hypot(v.x, v.y) * 1.5);
  kick();
}

/** Right-click a ball (or "Restore" on the bin): smooth the paper back out and stick it up again. */
function restoreBall(ball) {
  if (!balls.has(ball)) return;
  const { sheet, crumple, note } = ball;
  log('restoring a note from a ball');
  const start = sheet.group.getWorldPosition(new THREE.Vector3());
  const startRot = ball.group.rotation.z + sheet.group.rotation.z;
  physics.removeBall(ball.body);
  balls.delete(ball);
  ball.group.removeFromParent();
  stage.scene.add(sheet.group);
  sheet.group.position.copy(start);
  sheet.group.rotation.z = startRot;

  note.x = D.clamp(note.x, 0, W - S);
  note.y = D.clamp(note.y, 0, H - S - BIN.height * 0.5);
  note.z = ++topZ;
  const target = noteCenter(note);
  const turn = -rad(note.rot) - startRot;
  const turnShort = Math.atan2(Math.sin(turn), Math.cos(turn));
  const flat = new Float32Array(sheet.pos.length);
  for (let i = 0; i < flat.length; i += 3) {
    flat[i] = sheet.base[i];
    flat[i + 1] = sheet.base[i + 1];
    flat[i + 2] = SHEET_Z;
  }
  sound.crumple(0.45);
  animate(0.7, (t) => {
    const e = D.easeInOut(t);
    sheet.group.position.set(D.lerp(start.x, target.x, e), D.lerp(start.y, -target.y, e), D.lerp(start.z, 0, e) + Math.sin(Math.PI * t) * 40);
    sheet.group.rotation.z = startRot + turnShort * e;
    D.applyCrumple(flat, sheet.pos, crumple, 1 - t, 0, 0, 0);
    sheet.setGlow(BALL_GLOW * (1 - D.smoothstep(0.3, 0.9, t)));
    sheet.commit();
    if (t > 0.9) sheet.setFaceted(false);
  }, () => {
    const entry = mountNote(note);
    setLifted(entry, false);
    entry.el.classList.add('slap');
    sound.pat();
    sheet.dispose();
    updateBinCount();
    stage.render();
    scheduleSave();
  });
}

// ---------------------------------------------------------------- the bin

function placeBin(x) {
  // A gap between the rim and a screen edge narrower than a ball would wedge balls on the rim
  // forever, so the bin either sits flush against the edge or leaves room for a ball to drop.
  const flush = BIN.topHalf + BIN.rimR;
  const minGap = 70;
  if (x - flush < minGap) x = x - flush < minGap / 2 ? flush : flush + minGap;
  if (W - x - flush < minGap) x = W - x - flush < minGap / 2 ? W - flush : W - flush - minGap;
  const dx = x - (physics.binX ?? x);
  physics.placeBin(x);
  bin.place(x, H);
  for (const b of balls) {
    if (b.inBin) Body.setPosition(b.body, { x: b.body.position.x + dx, y: b.body.position.y });
  }
  binUI.style.left = `${x - BIN.topHalf - 8}px`;
  binUI.style.top = `${H - BIN.height - 6}px`;
  binUI.style.width = `${BIN.topHalf * 2 + 16}px`;
  binUI.style.height = `${BIN.height + 6}px`;
}

function wobbleBin(strength) {
  const amp = 0.012 + strength * 0.03;
  animate(0.5, (t) => {
    bin.group.rotation.z = Math.sin(t * Math.PI * 4) * (1 - t) * amp;
  });
}

function updateBinCount() {
  const inBin = [...balls].filter((b) => b.inBin).length;
  binCount.textContent = inBin ? `${inBin} in the bin · ${doc.stats.done || 0} done total` : `${doc.stats.done || 0} done total`;
  binUI.classList.toggle('has-balls', inBin > 0);
}

function inBinBalls() {
  return [...balls].filter((b) => b.inBin);
}

/**
 * Auto-compacting bin: when it's full, the oldest paper is squashed down out of sight (kept in
 * the done history, like Empty does), so the bin never overflows onto the desk.
 */
function sinkOldest() {
  const oldest = inBinBalls().sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0))[0];
  if (!oldest) return;
  doc.history.unshift({ ...oldest.note, doneAt: oldest.doneAt || Date.now() });
  doc.history = doc.history.slice(0, 500);
  physics.removeBall(oldest.body);
  balls.delete(oldest);
  physics.wakeAll();
  const g = oldest.group;
  const s0 = g.scale.x;
  animate(0.35, (t) => g.scale.setScalar(s0 * (1 - D.easeInOut(t))), () => {
    g.removeFromParent();
    oldest.sheet.dispose();
  });
  log('bin full — the oldest paper got squashed down');
  updateBinCount();
  scheduleSave();
}

function emptyBin() {
  const trash = [...balls].filter((b) => b.inBin);
  if (!trash.length) return;
  sound.inBin();
  log(`emptied the bin (${trash.length} ${trash.length === 1 ? 'note' : 'notes'})`);
  trash.forEach((ball, i) => {
    doc.history.unshift({ ...ball.note, doneAt: ball.doneAt || Date.now() });
    const g = ball.group;
    const s0 = g.scale.x;
    physics.removeBall(ball.body);
    balls.delete(ball);
    animate(0.25 + i * 0.04, (t) => g.scale.setScalar(s0 * (1 - D.easeInOut(t))), () => {
      g.removeFromParent();
      ball.sheet.dispose();
    });
  });
  doc.history = doc.history.slice(0, 500);
  updateBinCount();
  scheduleSave();
}

function restoreLast() {
  const inBin = [...balls].filter((b) => b.inBin).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (inBin[0]) restoreBall(inBin[0]);
}

binUI.addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'empty') emptyBin();
  if (act === 'restore') restoreLast();
});

binUI.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  e.preventDefault();
  const ox = e.clientX - physics.binX;
  binUI.setPointerCapture(e.pointerId);
  binUI.classList.add('dragging');
  interaction = {
    passive: true,
    move(ev) {
      placeBin(ev.clientX - ox);
      physics.wakeAll();
      kick();
    },
    up() {
      binUI.classList.remove('dragging');
      interaction = null;
      log(`moved the bin to x=${Math.round(physics.binX)}`);
      scheduleSave();
    },
  };
  setCaptured(true);
});

// ---------------------------------------------------------------- picking up balls

let lastBallClick = { ball: null, t: 0 };

function onBallPointerDown(ball, e) {
  e.preventDefault();
  if (e.button === 2) return restoreBall(ball);
  const now = performance.now();
  if (lastBallClick.ball === ball && now - lastBallClick.t < 380) {
    lastBallClick = { ball: null, t: 0 };
    return tossIntoBin(ball);
  }
  lastBallClick = { ball, t: now };
  document.documentElement.setPointerCapture(e.pointerId);
  grabBall(ball);
}

// Capture phase: balls are drawn above the notes, so they win clicks over whatever is beneath.
window.addEventListener('pointerdown', (e) => {
  trackPointer(e);
  if (interaction) {
    if (e.button === 2) interaction.crumple?.();
    return;
  }
  // the bin's Restore/Empty buttons often sit in front of a heap of balls: buttons win
  if (binUI.classList.contains('show') && e.target.closest('.bin-pill')) return;
  const ball = ballAt(e.clientX, e.clientY);
  if (!ball) return;
  e.stopPropagation();
  onBallPointerDown(ball, e);
}, true);

// ---------------------------------------------------------------- commands from the tray

/** New notes only ever come off the pad, so "new note" just points at it. */
function showPad() {
  pad.el.classList.remove('nudge');
  void pad.el.offsetWidth; // restart the animation
  pad.el.classList.add('nudge');
  sound.flap();
  log('pointed at the pad');
}

api.onCommand((cmd) => {
  if (cmd.type === 'show-pad') showPad();
  if (cmd.type === 'empty-bin') emptyBin();
  if (cmd.type === 'settings') sound.enabled = cmd.settings.sound;
});

window.addEventListener('resize', () => {
  W = window.innerWidth;
  H = window.innerHeight;
  stage.resize(W, H);
  physics.layout(W, H);
  placeBin(physics.binX);
  for (const entry of [...entries.values(), pad]) {
    clampNote(entry.note);
    styleNote(entry);
  }
  for (const b of balls) {
    const p = b.body.position;
    Body.setPosition(b.body, { x: D.clamp(p.x, b.radius, W - b.radius), y: Math.min(p.y, H - b.radius) });
  }
  physics.wakeAll();
  kick();
});

// ---------------------------------------------------------------- boot

/**
 * Compiles the paper shaders (flat and crumpled, plus their shadow passes) up front by drawing
 * an invisible, sub-pixel sheet. Otherwise the first peel and first crumple stall for a moment.
 */
function warmUpShaders() {
  const sheet = new Sheet(stage, { text: '', color: 'yellow' });
  sheet.group.position.set(W / 2, -H / 2, SHEET_Z);
  sheet.group.scale.setScalar(1e-4);
  stage.render();
  sheet.setFaceted(true);
  sheet.setGlow(BALL_GLOW);
  stage.render();
  sheet.dispose();
}

const WELCOME = `Hi! I'm Sticks.
[ ] Peel my corner ↘
[ ] Enter = checklist
[x] Stick me anywhere
Done? Trash me ↗`;

async function boot() {
  const data = await api.load();
  sound.enabled = data.settings?.sound !== false;
  doc = { ...doc, ...data };
  delete doc.settings;
  doc.stats ??= { done: 0 };
  doc.history ??= [];

  placeBin(doc.bin?.x ?? W - BIN.topHalf - 110);
  warmUpShaders();
  mountPad(doc.pad ?? { x: 48, y: H - S - 60 });
  for (const note of doc.notes) {
    note.rot = 0; // notes saved by earlier versions could be tilted
    clampNote(note);
    mountNote(note);
  }
  for (const r of doc.balls || []) Ball.fromRecord(r);
  // bins saved before auto-compacting existed may hold more than fits
  while (inBinBalls().length > BIN_CAPACITY) sinkOldest();

  if (!data.notes?.length && !data.balls?.length && !data.history?.length) {
    const note = { id: uid(), text: WELCOME, color: 'yellow', x: W / 2 - S / 2, y: H * 0.2, rot: 0, z: ++topZ, created: Date.now(), updated: Date.now() };
    mountNote(note, { slap: true });
    scheduleSave();
  }
  updateBinCount();
  stage.render();
  kick();
  refreshCapture();
  log(`ready: ${entries.size} notes on the wall, ${balls.size} paper balls, screen ${W}x${H}`);

  // handle for devtools and the scripted UI test
  window.__sticks = { noteSize: S, entries, balls, physics, pointer, newNote, emptyBin, get pad() { return pad; }, get interaction() { return interaction; } };
}

boot();
