# Mote

A small engine for tiny demos and games in the browser, in TypeScript, so that each mini does not write its
own loop, canvas and input again. Every mini on the site runs on it except the Walker and the generalist,
whose engine is the Rust crate in `walker/`. It has a project page at `/projects/mote/` and a logo, a speck
in a beam of light.

## Where the code is

`src/mote/`. Its own `README.md` there says what each file gives and how to write and add a mini. It is
under the MIT license in that folder (`src/mote/LICENSE`), plainer than the rest of the site's code.

| File | What it is |
|---|---|
| `stage.ts` | The canvas, a loop in fixed steps of 1/120 s, mouse and keys, the page's colours, a panel for buttons, a little kept between visits, the address. Runs only while seen and stops when the scene rests. |
| `flat.ts` | 2D physics: boxes, balls, bars and shapes, walls, pins, rods, ropes, a motor, a hand to grab with. |
| `space.ts` | 3D physics: solids that fall, tumble and hit each other and fixed slabs; balls and round posts. |
| `gl.ts` | 3D drawing on WebGL 2: depth, a sun with shadows, sky light, numbers on faces, floating words, glow. |
| `solids.ts` | The shapes of dice and other solids, drawn on a 2D canvas where WebGL 2 is missing. |
| `sound.ts` | Knocks and notes made by the browser with no files, silent until turned on. |

## Built

All of the above. The physics in `flat.ts` and `space.ts` follows the soft step method Erin Catto described
for Box2D 3. Mote began on 10 Nov 2026 on forked libraries (planck, cannon and three) and by 11 Nov had
none: what was needed was written into it.

## Decided

- **No third-party libraries, by rule.** Nothing forked and nothing added: what Mote needs is written in its
  own TypeScript. `src/mote/` imports nothing from outside its folder, and `scripts/lint.ts` fails if it
  does.
- Features are added when a mini needs them.

## Open

- **Its API is uneven between its parts**, to be put right in the audit: `flat.ts` counts in pixels with y
  down and `space.ts` in units with y up; `flat.still` is a value where `space.still()` is a call; a few
  calls take a row of bare numbers.
- **Features for when a mini needs one:** a camera that pans and zooms; particles; sprites and a tile grid;
  springs and motors between bodies; one-way platforms, and sensors that notice a body without stopping it;
  saving a run and playing it back; a debug view of contacts, joints and sleeping bodies; a frame-time meter
  beyond the `?debug` step time; touch with two fingers; text input.
- **For the 3D side:** smooth shading across faces, a shadow under each solid, pictures drawn onto faces,
  loading a simple model from a file, a wireframe view, dice that hit each other corner to corner rather
  than as balls, a camera that can be moved.
- **A repository of its own**, if anyone else wants to use it.
- scriptc (which compiles TypeScript to native programs and WASI modules) was looked at: it does not draw to
  a browser canvas, so it is no use for minis; it could matter for a desktop build later.

## How to run and test

```sh
bun test src/mote     # flat.test.ts, space.test.ts, replay.test.ts, gl.test.ts
```

`gl.test.ts` draws a scene in headless Chromium and reads its pixels. `replay.test.ts` checks that a scene
run twice ends the same and that a step is fast enough.

## Known weak spots

- `stage.ts`, `solids.ts`, `sound.ts` and `index.ts` have no test beside them; they are on the lint's list
  of files written before the rule, which is not to grow.
- Mote was written before the rule that every exported thing has a sentence above it, and is held to it
  only for what is added.
