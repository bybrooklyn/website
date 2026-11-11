// Chain: links hung from a nail, with a weight on the end. Drag any part of
// it and let go. Each link is a real one, a short bar pinned to the next, so
// the chain bends at every joint and never stretches or goes slack, and
// pulled past its reach it goes straight and holds.

import { Flat, radius, send, speed, trace, where, type Body, type Mote, type Scene } from "../mote";

const LINKS = 13;
const LONG = 17;
const THICK = 6;

export const label = "A chain with a weight on the end. Drag it and let go.";

export default function chain(m: Mote): Scene {
    const flat = new Flat(2200);
    // A long line of joints wants more care each step than a pile does, and a hand that cannot out-pull it.
    flat.care = [20, 8];
    flat.hand.strength = 12;
    const nail: [number, number] = [m.width / 2, 26];
    const links: Body[] = [];
    let above = flat.ground;
    // Hung out to one side, so it swings as soon as it is seen.
    const lean = 0.9;
    const along = (count: number): [number, number] => [nail[0] + Math.sin(lean) * count * LONG, nail[1] + Math.cos(lean) * count * LONG];
    for (let index = 0; index < LINKS; index++) {
        const [x, y] = along(index + 0.5);
        const link = flat.box(x, y, THICK, LONG, { angle: -lean, density: 12, friction: 0.3 });
        link.setAngularDamping(0.6);
        const [px, py] = along(index);
        flat.pin(above, link, px, py);
        links.push(link);
        above = link;
    }
    const [wx, wy] = along(LINKS);
    const weight = flat.ball(wx + Math.sin(lean) * 14, wy + Math.cos(lean) * 14, 20, { density: 1.2, friction: 0.4 });
    weight.setLinearDamping(0.6);
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
            const near = parts.toSorted((a, b) => Math.hypot(where(a).x - x, where(a).y - y) - Math.hypot(where(b).x - x, where(b).y - y))[0]!;
            const { x: nx, y: ny } = where(near);
            if (Math.hypot(nx - x, ny - y) < Math.max(radius(near), 14) + 12) flat.hand.take(nx, ny, near);
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
            // each link as a rounded bar, alternately light and dim, as a chain's links catch the light
            links.forEach((link, index) => {
                const { x, y, a } = where(link);
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(a);
                ctx.fillStyle = index % 2 ? m.color("--muted") : m.color("--ink");
                ctx.beginPath();
                ctx.roundRect(-THICK / 2, -LONG / 2 - 2, THICK, LONG + 4, THICK / 2);
                ctx.fill();
                ctx.restore();
            });
            trace(ctx, weight);
            ctx.fillStyle = m.color("--accent");
            ctx.fill();
            // a mark on the weight, so it can be seen to turn
            const { x, y, a } = where(weight);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20);
            ctx.strokeStyle = m.color("--ground");
            ctx.lineWidth = 2;
            ctx.stroke();
        },
    };
}
