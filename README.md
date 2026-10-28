# Sticks

Sticky notes for the Windows desktop that behave like paper. Peel one off by its corner, crumple it when the task is done, and throw it in the dustbin.

## Controls

| Do this | What happens |
|---|---|
| Write on the **pad** (bottom-left), then peel its corner | The top sheet comes off as a new note and a blank sheet stays on the pad |
| Click a note | Start typing; it's saved automatically |
| Enter | Starts a checklist item on the next line; the line you typed (e.g. a heading) stays as it is. Enter on an empty item ends the list; Shift+Enter adds a plain line |
| Click a checkbox | Ticks the item off (strikethrough); click again to untick |
| Pen button (on a note or the pad) | Doodle mode: draw anywhere on the paper. Undo button or Ctrl+Z removes the last stroke; Esc or the pen again goes back to typing. Doodles stay on the paper when it's peeled, crumpled or restored |
| Drag a note (body or top strip) | Slides it anywhere on the screen |
| Drag a bottom corner | The corner curls up. Pull past the glue strip and the note comes off in your hand, hanging from its top edge |
| Release a held note | It sticks right there, wherever on the screen you let go, perfectly straight |
| Right-click / Space / scroll while holding | Crumples it into a ball in your hand |
| Trash-can button or Ctrl+Enter | Done: crumples the note in place, ready to throw in the bin |
| Shift + trash-can button | Crumples it and lobs it straight into the bin |
| Drag a ball | It stays glued to the cursor (passing through everything) — drop it over the bin, or flick it to throw |
| Double-click a ball | Perfect lob into the bin |
| Right-click a ball | Un-crumples it back onto the wall |
| Hover the bin | Shows the done count and **Restore** / **Empty** buttons; drag the bin to move it. The bin holds 4 balls; when it's full, the oldest paper gets squashed down out of sight (it's kept in your done history) |
| Ctrl+Alt+N / Ctrl+Alt+H | Show the notes and wiggle the pad (new notes only come off the pad) / hide or show all notes. Both work from anywhere |

The tray icon has: show the note pad, hide/show notes, empty the bin, notes on the desktop / always on top, sounds, start with Windows, and quit.

## Run, test, build

```sh
npm install
npm start          # run it
npm run dev        # run with DevTools open
npm run test:ui    # scripted end-to-end run: peel, hold, crumple, throw, toss, restore (screenshots in test-output/)
npm run dist       # dist/Sticks Setup 1.0.0.exe (installer) and dist/Sticks 1.0.0.exe (portable)
```

Notes are saved to `%APPDATA%\sticks\sticks.json`.

## How it works

- **One transparent overlay** covers the work area of the primary monitor. Clicks pass through to the desktop everywhere except notes, balls and the bin (`setIgnoreMouseEvents` with `forward`, plus hit-testing on every mouse move).
- **Notes at rest are plain DOM** (a textarea, so typing, IME and spellcheck work normally). As soon as paper moves, the note is swapped for its **3D twin**: a 30×30 mesh in Three.js with the note drawn onto a canvas texture. The camera is placed so the z = 0 plane maps 1:1 to screen pixels and the lighting sums to exactly 1 on a flat sheet, so the swap is seamless.
- **Peel** (`src/renderer/deform.js`): the paper rolls around a cylinder along a fold line. The fold position is solved by bisection so the curled corner lands under the cursor. Once the fold reaches the glue strip, the note detaches.
- **Held notes** swing like a pendulum from your fingers, driven by gravity minus the hand's acceleration, with a little flutter.
- **Crumple**: each vertex is mapped onto a lumpy ball shaped by ridged 3D noise. The edges fold in first, wrinkles peak mid-crumple, and flat shading turns the creases into facets. A seed makes each ball's shape reproducible after a restart.
- **Physics** is matter-js at a fixed 60 Hz step. The bin is a tapered pair of walls with round rim colliders, which is why near misses can rim out. The "perfect lob" uses the integrator's closed-form ballistic solution.
- **Sounds** are synthesised in WebAudio (filtered noise grains and metal partials), so there are no audio files.

## Known limits

- Primary monitor only.
- By default notes live on the desktop: behind every app, like a desktop widget (the desktop window owns the overlay, the trick Rainmeter's "On desktop" uses, via [koffi](https://koffi.dev)). Clicking a note brings it forward until you click another app. The tray can switch to "Notes always on top" instead.
- The installer is unsigned, so SmartScreen will warn the first time it runs.
