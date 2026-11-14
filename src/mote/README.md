# Mote

A small engine for tiny demos and games in the browser, in TypeScript. The minis on bybrooklyn.dev run on it.

Free to use under the MIT license in this folder, which is plainer than the license on the rest of the
site. It has no dependencies.

## What is in it

| File | What it gives you |
|---|---|
| `stage.ts` | A canvas that fits its box and stays sharp, a loop in fixed steps of 1/120 s, the mouse, the arrow keys and WASD, Space and Enter, the page's colors, a place for ordinary buttons, something small kept between visits (`m.keep`, `m.recall`), and the page's address to read and set (`m.link`). It only runs while it can be seen and stops when the scene is at rest. With `?debug` in the address it shows how long a step takes. |
| `flat.ts` | 2D physics: boxes, balls, bars and shapes, with rounded corners if wanted; walls; pins, rods and ropes; a motor; a hand to grab with. Friction, bounce, sleep. `flat.hit` is told of every hard knock. |
| `solids.ts` | The shapes of the dice, a ball, a rod and other solids, and a way to draw one on a 2D canvas with no WebGL. The dice tower falls back to it where WebGL 2 is missing. |
| `space.ts` | 3D physics: solids that fall, tumble and hit each other and fixed slabs, corner to corner and edge to edge. Each turns as its shape says (its inertia tensor), so a long bar tumbles as a real one does. Balls that roll truly, with a rolling cost and bounce; islands that sleep together. The dice tower runs on it. |
| `track.ts` | Fixed track for balls, worked out by formula and not by faces: a section (gutter, V, bed with walls, tube, two rails) swept along a smooth curve through points or a helix, banked or kept level, and a profile turned into a funnel or a bowl. Pieces that meet end to end join into one surface. Drawn from the same numbers. |
| `grid.ts` | Which pairs of bodies are near enough to be worth a closer look, for both kinds of physics: a hashed grid, with large fixed bodies such as floors and walls kept apart. |
| `cells.ts` | A grid of cells, each a whole number of pixels, on WebGL 2: four bytes a cell, read straight from wherever they are kept (a WebAssembly module's memory) into one texture, the first byte picking a color from a palette and the second making it lighter or darker. Only the rows that changed are sent again. `fitted` places a grid in a canvas, `cellUnder` finds the cell under the pointer. |
| `gl.ts` | 3D drawing on WebGL 2: real depth, one sun with shadows, light from the sky, numbers on faces, signs (words that float in front of everything), and glow: a part with `emit` shines and bleeds light around itself. |
| `sound.ts` | Knocks and notes made by the browser, with no files. Silent until the visitor turns it on. |

`flat.ts` and `space.ts` solve a step the same way, after the soft step method Erin Catto described for
Box2D 3 (https://box2d.org/posts/2024/02/solver2d/): where things touch is found once, and the step is
then taken in a few small parts, each solving every contact and joint as a stiff, damped spring. `flat.test.ts` and `space.test.ts` say what each is held to, in numbers. `replay.test.ts` checks that
the same scene run twice ends the same and that a step is fast enough, and `gl.test.ts` draws a scene
in headless Chromium and reads its pixels.

## A mini

```ts
import { Flat, trace, type Mote, type Scene } from "../mote";

export const label = "A ball that falls.";

export default function falling(m: Mote): Scene {
    const flat = new Flat();
    flat.wall([[0, m.height], [m.width, m.height]]);
    const one = flat.ball(m.width / 2, 20, 12, { bounce: 0.5 });
    return {
        step: (dt) => flat.step(dt),
        draw() {
            trace(m.ctx, one);
            m.ctx.fillStyle = m.color("--accent");
            m.ctx.fill();
        },
    };
}
```

A scene can also have `press`, `double`, `move`, `release`, `keydown`, `resize`, `resting` (return
true when nothing is moving and the loop stops until something wakes it), `debug` (lines to show with
`?debug` in the address) and `destroy` (the mini is being taken away).  `m.panel()` gives a place under the canvas for
ordinary buttons and text. `m.preview` is true when the mini is being shown small in the list.

`flat.ts` also has `flat.motor(a, b, strength)`: a motor that pushes `b` toward a place beside `a` and
pushes `a` back as hard.

Run the tests with `bun run test`.

## Adding one to the site

1. `src/minis/<name>.ts`: the scene, as above.
2. `src/content/minis/<name>.mdx`: its name, a sentence, `kind` (toy or game), `space` (2D or 3D),
   `controls`, `order`, and a few words about it.

It then has a page at `/minis/<name>/` and a place in the list. To put one inside a post:
`<div class="mote" data-mini="<name>"></div>` with `import "../scripts/mini"` in a script.

Outside this site, copy the folder and call `mote(element, scene)`.
