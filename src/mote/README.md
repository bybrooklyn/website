# Mote

A small engine for tiny demos and games in the browser. TypeScript, no dependencies, about 1,200
lines. The minis on bybrooklyn.dev run on it.

Free to use under the MIT license in this folder, which is plainer than the license on the rest of the site.

## What is in it

| File | What it gives you |
|---|---|
| `stage.ts` | A canvas that fits its box and stays sharp, a loop in fixed steps of 1/120 s, the pointer, the arrow keys and WASD, Space and Enter, the page's colors, and a number kept between visits. It only runs while it can be seen and stops when the scene is at rest. |
| `physics.ts` | 2D rigid bodies: balls and convex shapes, friction and bounce, pins and ropes, picking things up and throwing them, sleeping. |
| `three.ts` | 3D solids made of flat faces, turned, shaded and drawn on the same 2D canvas. No WebGL. |
| `solid.ts` | 3D solids that fall and tumble: corners against flat surfaces, with bounce and rub. Enough for dice. |

## A mini

```ts
import { World, ball, type Mote, type Scene } from "../mote";

export const label = "A ball that falls.";

export default function falling(m: Mote): Scene {
    const world = new World();
    const one = ball(m.width / 2, 20, 12);
    world.add(one);
    return {
        step: (dt) => world.step(dt),
        draw() {
            m.ctx.fillStyle = m.color("--accent");
            m.ctx.beginPath();
            m.ctx.arc(one.x, one.y, one.r, 0, Math.PI * 2);
            m.ctx.fill();
        },
    };
}
```

A scene can also have `press`, `double`, `move`, `release`, `keydown`, `resize`, and `resting` (return
true when nothing is moving and the loop stops until something wakes it). `confines: true` holds the
mouse inside the box once it is clicked, until Escape. `m.panel()` gives a place under the canvas for
ordinary buttons and text. `m.preview` is true when the mini is being shown small in the list.

`physics.ts` also has `world.drive(a, b, force)`: a motor that pushes `b` toward a place beside `a` and
pushes `a` back as hard.

Run the tests with `bun run test`.

## Adding one to the site

1. `src/minis/<name>.ts`: the scene, as above.
2. `src/content/minis/<name>.mdx`: its name, a sentence, `kind` (toy or game), `space` (2D or 3D),
   `controls`, `order`, and a few words about it.

It then has a page at `/minis/<name>/` and a place in the list. To put one inside a post:
`<div class="mote" data-mini="<name>"></div>` with `import "../scripts/mini"` in a script.

Outside this site, copy the folder and call `mote(element, scene)`.
