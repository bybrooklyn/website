// Solid: a shape in three dimensions that turns by itself. Drag to spin it,
// click to change it.

import { cube, diamond, paint, pyramid, turned, twenty, upright, type Mote, type Scene } from "../../mote";

export const label = "A solid shape turning in three dimensions. Drag to spin it, click to change it.";

export default function solid(m: Mote): Scene {
    const shapes = [twenty(), cube(), diamond(), pyramid()];
    let which = 0;
    let turn = turned(upright(), 0.6, 0.4);
    // How fast it is turning, in radians a second, across and over.
    let across = 0.5;
    let over = 0.16;
    let from: [number, number] | undefined;
    let moved = 0;
    const hue = 290 + Math.random() * 40;

    return {
        press(x, y) {
            from = [x, y];
            moved = 0;
            across = 0;
            over = 0;
        },
        move(x, y) {
            if (!from) return;
            const [dx, dy] = [x - from[0], y - from[1]];
            moved += Math.abs(dx) + Math.abs(dy);
            turn = turned(turn, dx * 0.012, dy * 0.012);
            // What it keeps doing when let go: the speed of the last movement.
            across = dx * 0.012 * 60;
            over = dy * 0.012 * 60;
            from = [x, y];
        },
        release() {
            // Let go without dragging: the next shape.
            if (moved < 5) {
                which = (which + 1) % shapes.length;
                across = 0.5;
                over = 0.16;
            }
            from = undefined;
        },
        step(dt) {
            if (from) return;
            turn = turned(turn, across * dt, over * dt);
            // A hard spin eases down to a slow drift, and never quite stops.
            const ease = 1 - 0.9 * dt;
            across = 0.5 + (across - 0.5) * ease;
            over = 0.16 + (over - 0.16) * ease;
        },
        draw() {
            paint(m.ctx, shapes[which]!, turn, {
                x: m.width / 2,
                y: m.height / 2,
                size: Math.min(m.width, m.height) * 0.24,
                distance: 6,
                fill: (light) => `oklch(${(0.3 + light * 0.58).toFixed(3)} ${(0.07 + light * 0.08).toFixed(3)} ${hue.toFixed(0)})`,
                edge: m.color("--ground"),
            });
        },
    };
}
