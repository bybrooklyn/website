// Chain: links hung from a nail, with a weight on the end. Drag any part of
// it and let go. Each link is a real one, a short bar pinned to the next, so
// the chain bends at every joint and keeps its length, and pulled past its
// reach it goes straight and holds.

import { Flat, send, speed, trace, type Body, type Mote, type Scene } from "../../mote";

const LINKS = 13;
const LONG = 17;
const THICK = 6;
const WEIGHT = 20;

export const label = "A chain with a weight on the end. Drag it and let go.";

export default function chain(m: Mote): Scene {
    const flat = new Flat(2200);
    // A long line of joints wants each step taken in more parts than a pile does, and a hand that cannot out-pull it.
    flat.parts = 8;
    flat.hand.strength = 12;
    const nail: [number, number] = [m.width / 2, 26];
    const links: Body[] = [];
    let above = flat.ground;
    // Hung out to one side, so it swings as soon as it is seen.
    const lean = 0.9;
    const along = (count: number): [number, number] => [nail[0] + Math.sin(lean) * count * LONG, nail[1] + Math.cos(lean) * count * LONG];
    for (let index = 0; index < LINKS; index++) {
        const [x, y] = along(index + 0.5);
        // The links are one family: they pass through each other, as a chain folded on itself does well enough.
        const link = flat.bar(x, y, LONG + THICK, THICK, { angle: Math.PI / 2 - lean, density: 6, friction: 0.3, family: 1 });
        link.spinDamping = 0.5;
        const [px, py] = along(index);
        flat.pin(above, link, px, py);
        links.push(link);
        above = link;
    }
    const [wx, wy] = along(LINKS);
    const weight = flat.ball(wx + Math.sin(lean) * 14, wy + Math.cos(lean) * 14, WEIGHT, { density: 1.2, friction: 0.4 });
    weight.damping = 0.35;
    flat.pin(above, weight, wx, wy);
    const parts = [...links, weight];
    let pushed = 0;

    return {
        step(dt) {
            flat.step(dt);
            // Shown small in a list, it is given a push whenever it has nearly stopped.
            if (m.preview && m.time - pushed > 5 && speed(weight) < 60) {
                pushed = m.time;
                send(weight, (Math.random() < 0.5 ? -1 : 1) * 700, 0);
            }
        },
        press(x, y) {
            // A link is thin, so the nearest part within reach of the pointer is taken.
            const near = parts.toSorted((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]!;
            if (Math.hypot(near.x - x, near.y - y) < (near === weight ? WEIGHT : 14) + 12) flat.hand.take(near.x, near.y, near);
            flat.hand.move(x, y);
        },
        move: (x, y) => flat.hand.move(x, y),
        release: () => flat.hand.drop(),
        resting: () => !m.preview && flat.still && !flat.hand.held && !m.pointer.inside,
        draw() {
            const { ctx } = m;
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.arc(nail[0], nail[1], 4.5, 0, Math.PI * 2);
            ctx.fill();
            // each link alternately light and dim, as a chain's links catch the light
            links.forEach((link, index) => {
                trace(ctx, link);
                ctx.fillStyle = index % 2 ? m.color("--muted") : m.color("--ink");
                ctx.fill();
            });
            trace(ctx, weight);
            ctx.fillStyle = m.color("--accent");
            ctx.fill();
            // a mark on the weight, so it can be seen to turn
            ctx.beginPath();
            ctx.moveTo(weight.x, weight.y);
            ctx.lineTo(weight.x + Math.cos(weight.a) * WEIGHT, weight.y + Math.sin(weight.a) * WEIGHT);
            ctx.strokeStyle = m.color("--ground");
            ctx.lineWidth = 2;
            ctx.stroke();
        },
    };
}
