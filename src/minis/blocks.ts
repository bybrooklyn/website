// Blocks: a small pile with real physics. Pick one up and throw it. To drop a
// new piece (a block, now and then a ball or a wedge), double-click an empty
// spot or press Space: a single click on nothing does nothing, so reaching
// for a block and missing does not add one.

import { Flat, radius, send, trace, wake, type Body, type Mote, type P, type Scene, type Wall } from "../mote";

const MOST = 60;
const FLOOR = 6;
/** Every piece is this big, wherever the pile is shown. */
const SIZE = 40;
/** A soft color at a hue. */
const pastel = (hue: number) => `oklch(0.86 0.085 ${Math.round(hue % 360)})`;

export const label = "A pile of blocks. Drag one to throw it. Double-click an empty spot, or press Space, to drop another.";

export default function blocks(m: Mote): Scene {
    const flat = new Flat(2600);
    const pile: Body[] = [];
    const colors = new Map<Body, string>();
    let hue = Math.random() * 360;
    let walls: Wall | undefined;
    const most = m.preview ? 14 : MOST;
    let dropped = 0;
    // The box's corners are rounded, and its walls follow them: how round is read from the page.
    const round = Number.parseFloat(getComputedStyle(m.canvas.parentElement ?? m.canvas).borderTopLeftRadius) || 0;

    const add = (block: Body) => {
        // A random hue, but never close to the one before it.
        hue += 70 + Math.random() * 220;
        colors.set(block, pastel(hue));
        pile.push(block);
    };

    const drop = (x: number, y: number) => {
        const pick = Math.random();
        const half = SIZE / 2;
        const block =
            pick < 0.7 ? flat.box(x, y, SIZE, SIZE)
            : pick < 0.85 ? flat.ball(x, y, half, { bounce: 0.35 })
            : flat.shape(x, y, [[0, -half], [half * 1.15, half], [-half * 1.15, half]]);
        send(block, 0, 0, (Math.random() - 0.5) * 1.2);
        add(block);
        if (pile.length > most) {
            const oldest = pile.shift()!;
            flat.remove(oldest);
            colors.delete(oldest);
        }
    };

    /** The inside of the box as one closed wall: the top and sides with the box's two upper corners as the curves they are, and the floor, which is flat from side to side. */
    const enclose = () => {
        if (walls) flat.remove(walls);
        const [w, h] = [m.width, m.height - FLOOR];
        const r = Math.min(round, w / 4, h / 4);
        const arc = (cx: number, cy: number, from: number): P[] => Array.from({ length: 7 }, (_, step): P => {
            const angle = from + (step / 6) * (Math.PI / 2);
            return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
        });
        // clockwise from the top left: each upper corner's curve, a quarter turn at a time, then the floor's square ones
        walls = flat.wall(r < 2 ? [[0, 0], [w, 0], [w, h], [0, h]] : [...arc(r, r, Math.PI), ...arc(w - r, r, -Math.PI / 2), [w, h], [0, h]], true);
        for (const block of pile) {
            // a box made narrower or lower would leave the blocks beyond it with no wall around them, falling for ever: they are brought inside
            block.x = Math.min(Math.max(block.x, block.far), Math.max(block.far, w - block.far));
            block.y = Math.min(Math.max(block.y, block.far), Math.max(block.far, h - block.far));
            wake(block);
        }
    };
    /** Anything that has got out of the box all the same is taken away, so the pile can come to rest. */
    const lost = () => {
        for (const block of pile.filter((one) => one.y > m.height + SIZE * 4 || one.x < -SIZE * 4 || one.x > m.width + SIZE * 4)) {
            pile.splice(pile.indexOf(block), 1);
            colors.delete(block);
            flat.remove(block);
        }
    };

    enclose();
    const middle = m.width / 2;
    const floor = m.height - FLOOR;
    for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) add(flat.box(middle + column * SIZE, floor - SIZE / 2 - row * SIZE, SIZE, SIZE));

    return {
        step(dt) {
            flat.step(dt);
            lost();
            // Shown small in a list, it drops a piece by itself every couple of seconds.
            if (m.preview && m.time - dropped > 2.2) {
                dropped = m.time;
                drop(m.width * (0.25 + Math.random() * 0.5), SIZE);
            }
        },
        resize: enclose,
        // Whatever is under the pointer is picked up.
        press: (x, y) => void flat.hand.take(x, y),
        // Pressed twice on an empty spot: a new piece there.
        double(x, y) {
            if (!flat.hand.held && !flat.at(x, y)) drop(x, y);
        },
        // Space: a new piece under the pointer, or at the top if the pointer is elsewhere.
        keydown(name) {
            if (name === "action") drop(m.pointer.inside ? m.pointer.x : m.width / 2, m.pointer.inside ? m.pointer.y : SIZE);
        },
        move: (x, y) => flat.hand.move(x, y),
        release: () => flat.hand.drop(),
        // Once every block has come to rest there is nothing left to animate.
        resting: () => !m.preview && flat.still && !flat.hand.held && !m.pointer.inside,
        draw() {
            const { ctx } = m;
            ctx.fillStyle = m.color("--rule");
            ctx.fillRect(0, m.height - FLOOR, m.width, FLOOR);
            for (const block of pile) {
                trace(ctx, block);
                ctx.fillStyle = colors.get(block) ?? pastel(0);
                ctx.fill();
                const r = radius(block);
                if (r) {
                    // a spoke, so a rolling ball can be seen to roll
                    const { x, y, a } = block;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
                    ctx.strokeStyle = m.color("--ground");
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        },
    };
}
