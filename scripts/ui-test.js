// Scripted end-to-end run, loaded by src/main.js when STICKS_TEST_SCRIPT points here.
// Drives the real window with synthetic input (the OS mouse is ignored in this mode),
// asserts each stage of peel -> hold -> crumple -> throw -> toss -> restore, and saves screenshots.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function run(win, app) {
  const out = process.env.STICKS_SHOTS;
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code);
  const failures = [];
  const check = (cond, msg) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) failures.push(msg);
  };
  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
  };
  const mouse = (type, x, y, opts = {}) => wc.sendInputEvent({
    type, x: Math.round(x), y: Math.round(y), button: opts.button || 'left', clickCount: 1, modifiers: opts.mods || [],
  });
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n]);
  const drag = async (pts, ms = 10) => {
    for (const [x, y] of pts) {
      mouse('mouseMove', x, y, { mods: ['leftButtonDown'] });
      await sleep(ms);
    }
  };
  const state = () => js(`({
    mode: __sticks.interaction ? (__sticks.interaction.ball ? 'ball' : __sticks.interaction.crumple ? 'hold' : 'drag') : null,
    notes: __sticks.entries.size,
    balls: [...__sticks.balls].map(b => ({ x: b.body.position.x, y: b.body.position.y, r: b.radius, inBin: b.inBin, held: b.held, doneAt: b.doneAt || 0, text: b.note.text })),
  })`);

  try {
    await sleep(1800);
    // No background is painted: the overlay stays transparent and click-through while the test
    // runs, so it never covers the desktop. Screenshots show transparent areas as white.
    const { H, n } = await js(`(() => { const n = [...__sticks.entries.values()][0].note; return { H: innerHeight, n }; })()`);
    check(!!n, 'first run shows a welcome note');
    await shot('01-welcome');

    // peel from the bottom-right corner until it lets go of the wall
    const S = await js(`__sticks.noteSize`);
    const cx = n.x + S - 9, cy = n.y + S - 7;
    mouse('mouseMove', cx, cy);
    await sleep(80);
    mouse('mouseDown', cx, cy);
    await drag(line(cx, cy, cx - 85, cy - 80, 16));
    await sleep(120);
    check((await state()).mode === 'drag', 'a short drag curls the corner but the glue still holds');
    await shot('02-peeling');
    // a diagonal peel only lets go once ~80% of the sheet is up (~270px of drag)
    await drag(line(cx - 85, cy - 80, cx - S - 20, cy - S - 20, 16));
    await sleep(150); // let the curl catch up with the cursor before swinging away
    await drag(line(cx - S - 20, cy - S - 20, cx + 60, cy - 120, 16), 14);
    await sleep(500);
    check((await state()).mode === 'hold', 'peeling past the glue strip detaches the note into the hand');
    await shot('03-held');

    // right-click while holding crumples it into a ball that stays in the hand
    const hx = cx + 60, hy = cy - 120;
    mouse('mouseDown', hx, hy, { button: 'right', mods: ['leftButtonDown'] });
    mouse('mouseUp', hx, hy, { button: 'right', mods: ['leftButtonDown'] });
    await sleep(250);
    await shot('04-crumpling');
    await sleep(500);
    let s = await state();
    check(s.notes === 0 && s.balls.length === 1 && s.balls[0].held, 'crumpled into a ball held by the cursor');
    check(Math.hypot(s.balls[0].x - hx, s.balls[0].y - hy) < 4, 'the ball sits under the cursor');
    await shot('05-ball-in-hand');

    // fling it; it must fly, then come to rest on the floor (top of the taskbar)
    await drag(line(hx, hy, hx + 140, hy - 40, 8), 10);
    mouse('mouseUp', hx + 140, hy - 40);
    await sleep(150);
    await shot('06-thrown');
    await sleep(3000);
    s = await state();
    check(s.balls.length === 1 && !s.balls[0].held && (s.balls[0].y > H - 60 || s.balls[0].inBin), `thrown ball lands on the floor or in the bin ${JSON.stringify(s.balls)}`);
    const inBinBefore = s.balls.filter((x) => x.inBin).length;

    // a new note, Shift+click the trash button => crumple and lob it straight into the bin
    await js(`__sticks.newNote()`);
    await sleep(400);
    await js(`[...__sticks.entries.values()].pop().setText('Ship the sticky notes app')`);
    const btn = await js(`(() => { const r = [...__sticks.entries.values()].pop().el.querySelector('.done').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    mouse('mouseMove', btn.x, btn.y);
    await sleep(150);
    await shot('07-new-note-hover');
    mouse('mouseDown', btn.x, btn.y, { mods: ['shift'] });
    mouse('mouseUp', btn.x, btn.y, { mods: ['shift'] });
    await sleep(300);
    await shot('08-crumple-on-wall');
    await sleep(3200);
    s = await state();
    check(s.balls.filter((x) => x.inBin).length === inBinBefore + 1, 'Shift+✓ tosses the ball into the bin');
    const binX = await js(`__sticks.physics.binX`);
    mouse('mouseMove', binX, H - 30);
    await sleep(300);
    await shot('09-bin');

    // right-click the ball in the bin: it un-crumples back onto the wall
    const b = s.balls.find((x) => x.text === 'Ship the sticky notes app');
    const notesBefore = s.notes;
    mouse('mouseDown', b.x, b.y, { button: 'right' });
    mouse('mouseUp', b.x, b.y, { button: 'right' });
    await sleep(350);
    await shot('10-restoring');
    await sleep(900);
    s = await state();
    check(s.notes === notesBefore + 1 && s.balls.every((x) => x.text !== 'Ship the sticky notes app'), 'right-click restores the note from the bin');
    await shot('11-restored');
    check(await js(`[...__sticks.entries.values()].some(e => e.note.text === 'Ship the sticky notes app')`), 'restored note keeps its text');

    // ---- checklist: Enter turns lines into items, clicking a box ticks it
    const key = async (keyCode, ch) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      if (ch) wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
      await sleep(15);
    };
    const type = async (text) => { for (const ch of text) await key(ch, ch); };
    await js(`[...__sticks.entries.values()].find(e => e.note.text === 'Ship the sticky notes app').editor.focusEnd()`);
    await key('Enter');
    await type('milk');
    await key('Enter');
    await type('bread');
    await sleep(100);
    const listText = await js(`[...__sticks.entries.values()].find(e => e.note.text.includes('milk')).note.text`);
    check(listText === 'Ship the sticky notes app\n[ ] milk\n[ ] bread', `Enter starts a checklist under a heading that stays plain ${JSON.stringify(listText)}`);
    await key('Enter');
    await key('Enter'); // Enter on an empty item ends the list
    await type('note');
    await sleep(100);
    const afterList = await js(`[...__sticks.entries.values()].find(e => e.note.text.includes('milk')).note.text`);
    check(afterList.endsWith('[ ] bread\nnote'), `Enter on an empty item ends the checklist ${JSON.stringify(afterList)}`);
    // boxes: [0] heading (hidden), [1] milk, [2] bread
    const box = await js(`(() => { const r = [...__sticks.entries.values()].find(e => e.note.text.includes('milk')).editor.el.querySelectorAll('.box')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    mouse('mouseMove', box.x, box.y);
    await sleep(60);
    mouse('mouseDown', box.x, box.y);
    await sleep(40);
    mouse('mouseUp', box.x, box.y);
    await sleep(150);
    const ticked = await js(`[...__sticks.entries.values()].find(e => e.note.text.includes('milk')).note.text`);
    check(ticked.includes('[x] milk') && ticked.includes('[ ] bread'), 'clicking a box ticks the item off');
    await js(`document.activeElement?.blur()`);
    await shot('11b-checklist');

    // ---- doodles: pen on, draw, undo, draw again, Esc back to typing
    const listNote = `[...__sticks.entries.values()].find(e => e.note.text.includes('milk'))`;
    const centerOf = (sel) => js(`(() => { const r = ${listNote}.el.querySelector('${sel}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const click = async (pt) => {
      mouse('mouseMove', pt.x, pt.y);
      await sleep(60);
      mouse('mouseDown', pt.x, pt.y);
      await sleep(40);
      mouse('mouseUp', pt.x, pt.y);
      await sleep(80);
    };
    const doodle = async (x0, y0) => {
      mouse('mouseMove', x0, y0);
      await sleep(40);
      mouse('mouseDown', x0, y0);
      for (let i = 1; i <= 16; i++) {
        mouse('mouseMove', x0 + i * 7, y0 + Math.sin(i / 2.5) * 22, { mods: ['leftButtonDown'] });
        await sleep(14);
      }
      mouse('mouseUp', x0 + 112, y0 + Math.sin(16 / 2.5) * 22);
      await sleep(100);
    };
    await click(await centerOf('.pen'));
    check(await js(`${listNote}.el.classList.contains('drawing')`), 'the pen button switches the note to doodle mode');
    const ln = await js(`${listNote}.note`);
    await doodle(ln.x + 40, ln.y + 160);
    let strokes = await js(`${listNote}.note.doodles`);
    check(strokes.length === 1 && strokes[0].pts.length >= 20, `dragging draws a stroke (${strokes[0]?.pts.length / 2} points)`);
    await click(await centerOf('.undo'));
    check((await js(`${listNote}.note.doodles.length`)) === 0, 'undo removes the last stroke');
    await doodle(ln.x + 40, ln.y + 160);
    await shot('11c-doodle');
    await key('Escape');
    check(!(await js(`${listNote}.el.classList.contains('drawing')`)) && (await js(`${listNote}.note.doodles.length`)) === 1, 'Esc leaves doodle mode and keeps the drawing');

    // ---- the pad: write on the top sheet, peel it off, a blank sheet stays behind
    const p = await js(`(() => { const p = __sticks.pad; p.setText('Call the bank'); return p.note; })()`);
    check(!!p, 'there is a sticky pad on the desktop');
    // doodle on the pad's top sheet before peeling it
    const padPen = await js(`(() => { const r = __sticks.pad.el.querySelector('.pen').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await click(padPen);
    await doodle(p.x + 40, p.y + 150);
    await key('Escape');
    check((await js(`__sticks.pad.note.doodles.length`)) === 1, 'you can doodle on the pad before peeling');
    const px = p.x + S - 9, py = p.y + S - 7;
    mouse('mouseMove', px, py);
    await sleep(60);
    // watch frame pacing from here through the peel, detach and carry
    await js(`window.__frames = []; (function f(t) { __frames.push(t); if (__frames.length < 600) requestAnimationFrame(f); })(performance.now())`);
    mouse('mouseDown', px, py);
    await drag(line(px, py, px - 70, py - 70, 12));
    await sleep(100);
    const padVisible = await js(`getComputedStyle(__sticks.pad.el).visibility === 'visible' && __sticks.pad.el.classList.contains('peeling')`);
    check(padVisible, 'while peeling, the pad stays put underneath');
    await shot('12-pad-peeling');
    const notesOnWall = (await state()).notes;
    await drag(line(px - 70, py - 70, px - 40, py - S - 40, 12));
    await sleep(80);
    s = await state();
    check(s.mode === 'hold' && s.notes === notesOnWall + 1, 'the top sheet comes off the pad as a new note');
    check(await js(`__sticks.pad.note.text === '' && __sticks.pad.note.doodles.length === 0`), 'a fresh blank sheet is left on the pad');
    check(await js(`[...__sticks.entries.values()].some(e => e.note.text === 'Call the bank' && e.note.doodles.length === 1)`), 'the doodle comes off with the peeled sheet');
    // carry it far across the screen and stick it there
    const dest = { x: 1000, y: 160 };
    await drag(line(px - 40, py - S - 40, dest.x, dest.y, 30), 12);
    await sleep(700);
    await shot('13-carrying');
    mouse('mouseUp', dest.x, dest.y);
    await sleep(500);
    const stuck = await js(`(() => { const n = [...__sticks.entries.values()].map(e => e.note).find(n => n.text === 'Call the bank'); return n && { x: n.x, y: n.y, rot: n.rot, hidden: [...__sticks.entries.values()].find(e => e.note === n).el.classList.contains('lifted') }; })()`);
    check(stuck && !stuck.hidden, 'the peeled note is stuck on the wall');
    check(stuck && Math.abs(stuck.x + S / 2 - dest.x) < 30 && Math.abs(stuck.y + 16 - dest.y) < 30,
      `it sticks right where it was dropped ${JSON.stringify(stuck)}`);
    check(stuck && stuck.rot === 0, 'and it sticks perfectly straight');
    const gaps = await js(`__frames.slice(1).map((t, i) => t - __frames[i])`);
    const worst = Math.max(...gaps);
    console.log(`peel → carry → stick: ${gaps.length} frames, worst frame ${worst.toFixed(1)}ms, ${gaps.filter((g) => g > 25).length} frames over 25ms`);
    check(worst < 60, `no hitch during peel, detach and carry (worst frame ${worst.toFixed(1)}ms)`);
    await shot('14-stuck-anywhere');

    // ---- drag a note by its body; a plain click still starts typing
    mouse('mouseDown', dest.x, dest.y + 100);
    await drag(line(dest.x, dest.y + 100, dest.x - 300, dest.y + 250, 15));
    mouse('mouseUp', dest.x - 300, dest.y + 250);
    await sleep(100);
    const moved = await js(`[...__sticks.entries.values()].map(e => e.note).find(n => n.text === 'Call the bank')`);
    check(Math.abs(moved.x - (stuck.x - 300)) < 3 && Math.abs(moved.y - (stuck.y + 150)) < 3, 'dragging the body of a note moves it');
    mouse('mouseDown', dest.x - 300, dest.y + 250);
    mouse('mouseUp', dest.x - 300, dest.y + 250);
    await sleep(100);
    check(await js(`[...__sticks.entries.values()].find(e => e.note.text === 'Call the bank').editor.isEditing`), 'a click without dragging starts editing');
    await js(`document.activeElement?.blur()`);

    // ---- done -> ball drops; drag it along the floor into the bin: no shaking
    const done = await js(`(() => { const r = [...__sticks.entries.values()].find(e => e.note.text === 'Call the bank').el.querySelector('.done').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    mouse('mouseMove', done.x, done.y);
    await sleep(80);
    mouse('mouseDown', done.x, done.y);
    await sleep(40);
    mouse('mouseUp', done.x, done.y);
    await sleep(2600);
    s = await state();
    const ball = s.balls.find((x) => x.text === 'Call the bank');
    check(!!ball && !ball.inBin && ball.y > H - 60, `the done note dropped to the floor as a ball ${JSON.stringify(s.balls)}`);
    mouse('mouseMove', ball.x, ball.y);
    await sleep(60);
    mouse('mouseDown', ball.x, ball.y);
    const bx = await js(`__sticks.physics.binX`);
    const route = [...line(ball.x, ball.y, bx - 110, H - 15, 30), ...line(bx - 110, H - 15, bx - 110, H - 160, 10), ...line(bx - 110, H - 160, bx, H - 160, 10), ...line(bx, H - 160, bx, H - 60, 10)];
    let maxDev = 0;
    for (const [x, y] of route) {
      mouse('mouseMove', x, y, { mods: ['leftButtonDown'] });
      await sleep(20);
      await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); // measure what was drawn
      const h = (await state()).balls.find((q) => q.held);
      if (h) {
        const dev = Math.hypot(h.x - x, h.y - Math.min(y, H - h.r));
        maxDev = Math.max(maxDev, dev);
      }
    }
    check(maxDev < 3, `the held ball follows the cursor without shaking (max deviation ${maxDev.toFixed(1)}px)`);
    mouse('mouseUp', bx, H - 60);
    await sleep(1800);
    const a = (await state()).balls;
    await sleep(400);
    const b2 = (await state()).balls;
    const drift = Math.max(...a.map((q, i) => Math.hypot(q.x - b2[i].x, q.y - b2[i].y)));
    check(a.find((q) => q.text === 'Call the bank')?.inBin, 'dropping it over the bin puts it in');
    check(drift < 0.01 && !(await js(`__sticks.physics.active`)), `everything settles and stays still (drift ${drift.toFixed(3)}px)`);
    await shot('15-dropped-in-bin');
  } catch (err) {
    failures.push(String(err?.stack || err));
    console.error(err);
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  console.log(`screenshots: ${out}`);
  await sleep(700); // let the debounced save land
  app.exit(failures.length ? 1 : 0);
};
