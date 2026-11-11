// Blocks: a small pile with real physics. Pick one up and throw it. To drop a
// new piece (a block, now and then a ball or a wedge), double-click an empty
// spot or press Space: a single click on nothing does nothing, so reaching
// for a block and missing does not add one.

import { World, ball, rect, shape, wake, type Body, type Mote, type Scene } from "../mote";

const MOST = 60;
const FLOOR = 6;
/** The box's top corners are rounded; a slope this size across each keeps blocks out of the part that is cut off. */
const CORNER = 14;
/** A soft color at a hue. */
const pastel = (hue: number) => `oklch(0.86 0.085 ${Math.round(hue % 360)})`;

export const label = "A pile of blocks. Drag one to throw it. Double-click an empty spot, or press Space, to drop another.";

export default function blocks(m: Mote): Scene {
    // The blocks are sized to the box, and gravity to the blocks, so a fall across
    // a big box takes as long as one across a small box and nothing looks slow.
    const SIZE = Math.round(Math.max(34, Math.min(52, Math.min(m.width, m.height) / 11)));
    // Carried, a block trails the pointer a little, as something with weight would.
    const world = Object.assign(new World(), { gravity: SIZE * 62, grip: 17, follow: 0.115 });
    const most = m.preview ? 14 : MOST;
    let dropped = 0;
    const pile: Body[] = [];
    const colors = new Map<Body, string>();
    let hue = Math.random() * 360;
    let walls: Body[] = [];

    const add = (block: Body) => {
        // A random hue, but never close to the one before it.
        hue += 70 + Math.random() * 220;
        colors.set(block, pastel(hue));
        pile.push(block);
        world.add(block);
    };

    const drop = (x: number, y: number) => {
        const pick = Math.random();
        const half = SIZE / 2;
        const block =
            pick < 0.7 ? rect(x, y, SIZE, SIZE)
            : pick < 0.85 ? ball(x, y, half, { bounce: 0.4 })
            : shape(x, y, [[0, -half], [half * 1.15, half], [-half * 1.15, half]]);
        block.w = (Math.random() - 0.5) * 1.2;
        add(block);
        if (pile.length > most) {
            const oldest = pile.shift()!;
            world.remove(oldest);
            colors.delete(oldest);
        }
    };

    /** The floor, walls and roof around the box as it now is. */
    const enclose = () => {
        const { width, height } = m;
        const thick = 200;
        for (const wall of walls) world.remove(wall);
        walls = [
            rect(width / 2, height - FLOOR + thick / 2, width + thick * 2, thick, { fixed: true }),
            rect(-thick / 2, height / 2, thick, height * 6, { fixed: true }),
            rect(width + thick / 2, height / 2, thick, height * 6, { fixed: true }),
            rect(width / 2, -thick / 2, width + thick * 2, thick, { fixed: true }),
            // slopes across the two rounded corners at the top
            shape(CORNER / 3, CORNER / 3, [[0, 0], [CORNER, 0], [0, CORNER]], { fixed: true }),
            shape(width - CORNER / 3, CORNER / 3, [[0, 0], [0, CORNER], [-CORNER, 0]], { fixed: true }),
        ];
        world.add(...walls);
        for (const block of pile) wake(block);
    };

    /** However hard something is pushed or thrown, it stays inside the box. */
    const contain = () => {
        const floor = m.height - FLOOR;
        for (const block of pile) {
            const xs = block.r ? [block.x - block.r, block.x + block.r] : block.wp.map((corner) => corner[0]);
            const ys = block.r ? [block.y - block.r, block.y + block.r] : block.wp.map((corner) => corner[1]);
            const low = Math.max(...ys) - floor;
            const left = -Math.min(...xs);
            const right = Math.max(...xs) - m.width;
            const high = -Math.min(...ys);
            if (high > 0) {
                block.y += high;
                block.vy = Math.max(block.vy, 0);
            }
            if (low > 0) {
                block.y -= low;
                block.vy = Math.min(block.vy, 0);
            }
            if (left > 0) {
                block.x += left;
                block.vx = Math.max(block.vx, 0);
            }
            if (right > 0) {
                block.x -= right;
                block.vx = Math.min(block.vx, 0);
            }
        }
    };

    enclose();
    const middle = m.width / 2;
    const floor = m.height - FLOOR;
    for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) {
        const block = rect(middle + column * SIZE, floor - SIZE / 2 - row * SIZE, SIZE, SIZE);
        block.asleep = true;
        add(block);
    }

    return {
        step(dt) {
            world.step(dt);
            contain();
            // Shown small in a list, it drops a piece by itself every couple of seconds.
            if (m.preview && m.time - dropped > 2.2) {
                dropped = m.time;
                drop(m.width * (0.25 + Math.random() * 0.5), SIZE);
            }
        },
        resize: enclose,
        // Whatever is under the pointer is picked up.
        press(x, y) {
            world.grab([x, y]);
        },
        // Pressed twice on an empty spot: a new piece there.
        double(x, y) {
            if (!world.holding && !world.at([x, y])) drop(x, y);
        },
        // Space: a new piece under the pointer, or at the top if the pointer is elsewhere.
        keydown(name) {
            if (name === "action") drop(m.pointer.inside ? m.pointer.x : m.width / 2, m.pointer.inside ? m.pointer.y : SIZE);
        },
        move: (x, y) => world.drag([x, y]),
        release: () => world.release(),
        // Once every block has come to rest there is nothing left to animate.
        resting: () => !m.preview && pile.every((block) => block.asleep) && !world.holding && !m.pointer.inside,
        draw() {
            const { ctx } = m;
            const scale = window.devicePixelRatio || 1;
            ctx.fillStyle = m.color("--rule");
            ctx.fillRect(0, m.height - FLOOR, m.width, FLOOR);
            for (const block of pile) {
                // A block at rest is drawn on whole pixels, and square to the box if it is
                // within a couple of degrees of it, so a settled pile has no slivers between blocks.
                const square = Math.round(block.a / (Math.PI / 2)) * (Math.PI / 2);
                const settled = block.asleep && !block.r && Math.abs(block.a - square) < 0.04;
                const fill = colors.get(block) ?? pastel(0);
                ctx.save();
                ctx.translate(block.asleep ? Math.round(block.x * scale) / scale : block.x, block.asleep ? Math.round(block.y * scale) / scale : block.y);
                ctx.rotate(settled ? square : block.a);
                ctx.beginPath();
                if (block.r) ctx.arc(0, 0, block.r, 0, Math.PI * 2);
                else {
                    block.p.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                    ctx.closePath();
                }
                ctx.fillStyle = fill;
                ctx.fill();
                // Each block is drawn a little past its edge in its own color, which closes the
                // small gaps blocks come to rest with. Whole pixels, so a resting edge stays crisp.
                ctx.strokeStyle = fill;
                ctx.lineWidth = block.asleep ? 4 : 2;
                ctx.lineJoin = "miter";
                ctx.stroke();
                if (block.r) {
                    // a spoke, so a rolling ball can be seen to roll
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(block.r, 0);
                    ctx.strokeStyle = m.color("--ground");
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
                ctx.restore();
            }
        },
    };
}
