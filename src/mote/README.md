# Mote

A small engine for tiny demos and games in the browser, in TypeScript. The minis on bybrooklyn.dev run on it.

Free to use under the MIT license in this folder, which is plainer than the license on the rest of the
site. The three libraries in `forks/` are under the MIT license too, each with its own notice.

## What is in it

| File | What it gives you |
|---|---|
| `stage.ts` | A canvas that fits its box and stays sharp, a loop in fixed steps of 1/120 s, the mouse (which a game can hold inside the box), the arrow keys and WASD, Space and Enter, the page's colors, a place for ordinary buttons, and a number kept between visits. It only runs while it can be seen and stops when the scene is at rest. |
| `flat.ts` | 2D physics: boxes, balls, shapes and walls; pins, rods and ropes; a motor; a hand to grab with. It stands on `forks/planck`. |
| `three.ts` | Simple 3D solids (the dice shapes) and a way to draw them on a 2D canvas with no WebGL. The Solid mini uses the drawing; the dice use the shapes. |
| `forks/` | planck (2D bodies), cannon (3D bodies) and three (3D drawing), copied in and changed here. See `forks/README.md`. |
| `physics.ts` | The first 2D physics written for this site, kept with its tests. The minis no longer use it. |

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

A scene can also have `press`, `double`, `move`, `release`, `keydown`, `resize`, and `resting` (return
true when nothing is moving and the loop stops until something wakes it). `confines: true` holds the
mouse inside the box once it is clicked, until Escape. `m.panel()` gives a place under the canvas for
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
