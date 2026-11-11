// Chain: beads on a rope, hung from a nail, with a weight on the end. Drag
// any part of it and let go.

import { World, ball, type Body, type Mote, type Scene } from "../mote";

const BEADS = 14;
const GAP = 15;

export const label = "A chain of beads with a weight on the end. Drag it and let go.";

export default function chain(m: Mote): Scene {
    const world = Object.assign(new World(), { gravity: 1400, grip: 30, follow: 0.2 });
    const nail = ball(m.width / 2, 26, 3, { fixed: true });
    world.add(nail);
    const beads: Body[] = [];
    let above = nail;
    for (let index = 0; index < BEADS; index++) {
        const last = index === BEADS - 1;
        // Laid out to one side, so it swings as soon as it is seen.
        const bead = ball(nail.x + (index + 1) * GAP * 0.8, nail.y + (index + 1) * GAP * 0.6, last ? 20 : 4.5, { friction: 0.3 });
        world.add(bead);
        world.join(above, bead, [0, 0], [0, 0], last ? GAP + 16 : GAP, true);
        beads.push(bead);
        above = bead;
    }
    const weight = beads.at(-1)!;

    return {
        step: (dt) => world.step(dt),
        resize() {
            nail.x = m.width / 2;
        },
        press: (x, y) => {
            // A bead is small, so the nearest one within reach is taken.
            const near = beads.toSorted((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]!;
            if (Math.hypot(near.x - x, near.y - y) < Math.max(near.r, 14) + 10) world.grab([near.x, near.y]);
            world.drag([x, y]);
        },
        move: (x, y) => world.drag([x, y]),
        release: () => world.release(),
        resting: () => beads.every((bead) => bead.asleep) && !world.holding && !m.pointer.inside,
        draw() {
            const { ctx } = m;
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";
            ctx.strokeStyle = m.color("--muted");
            ctx.beginPath();
            ctx.moveTo(nail.x, nail.y);
            for (const bead of beads) ctx.lineTo(bead.x, bead.y);
            ctx.stroke();
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.arc(nail.x, nail.y, 4, 0, Math.PI * 2);
            ctx.fill();
            for (const bead of beads) {
                ctx.beginPath();
                ctx.arc(bead.x, bead.y, bead.r, 0, Math.PI * 2);
                ctx.fillStyle = bead === weight ? m.color("--accent") : m.color("--ink");
                ctx.fill();
            }
            // a mark on the weight, so it can be seen to turn
            ctx.beginPath();
            ctx.moveTo(weight.x, weight.y);
            ctx.lineTo(weight.x + Math.cos(weight.a) * weight.r, weight.y + Math.sin(weight.a) * weight.r);
            ctx.strokeStyle = m.color("--ground");
            ctx.stroke();
        },
    };
}
