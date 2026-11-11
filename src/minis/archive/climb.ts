// Climb: a block with a hammer and a long way up. The hammer's head goes
// where the mouse goes, as far as the arms reach. Press it against something
// and it is the block that moves: hook a ledge and pull, plant it and vault.
// There are no places to rest your progress. Slip, and you are back wherever
// you land.
//
// The world (the rocks, the climber, the hammer and the arms) is made by
// `course()`, apart from the drawing, so that a climb can be run and tested
// without a screen.

import { Flat, trace, type Body, type Mote, type Scene } from "../../mote";

export const label = "A game: a block with a hammer climbs a tall pile of rocks. The hammer follows the mouse.";

/** How far the hammer's head can be from the middle of the block, and how near. */
export const REACH = 170;
const NEAR = 64;
/** How long the hammer's handle is, from its end to the head. One hand holds the very end. */
const HANDLE = 100;
export const SIZE = 36;
const HEAD = 11;
/** The course is this wide; it is scaled down to fit a narrower box. */
const WIDE = 680;

/** A ledge: where its middle is, how wide and tall, and how far it is tipped. Up is negative. */
type Ledge = [x: number, y: number, w: number, h: number, tip?: number];

/** How far each ledge is above the last: low enough that the hammer reaches over its end from below. */
const RISE = 88;
/**
 * Ledges go up by turns on the right and on the left, and each reaches a little past the middle, under
 * the end of the next: there is always somewhere to stand below the end you are reaching for.
 */
const ledge = (step: number, w: number, tip = 0, past = 30): Ledge => [step % 2 ? w / 2 - past : past - w / 2, -RISE * step + 10, w, 20, tip];
/** The way up, from the bottom. They get shorter toward the top. */
export const LEDGES: Ledge[] = [
    ledge(1, 250),
    ledge(2, 260, 0.04),
    ledge(3, 230, -0.04),
    ledge(4, 240, 0, 40),
    ledge(5, 200, 0.07),
    ledge(6, 220, -0.06, 36),
    ledge(7, 180),
    ledge(8, 190, 0.06),
    ledge(9, 160, 0, 36),
    ledge(10, 170, -0.05),
    ledge(11, 210),
];
/** How high the top is: the last ledge's upper face. */
export const TOP = -RISE * 11;

export interface Course {
    flat: Flat;
    rocks: Body[];
    climber: Body;
    head: Body;
    /** Send the hammer's head toward a place measured from the middle of the climber. It goes as far as the arms reach. */
    aim(dx: number, dy: number): void;
    /** How high the climber's feet are above the ground, in the world's units. */
    height(): number;
    /** Standing on the top. */
    done(): boolean;
}

export function course(): Course {
    const flat = new Flat(2000);
    const rock = { fixed: true, friction: 0.9 };
    const rocks: Body[] = [
        // the ground and the two sides
        flat.box(0, 60, 1400, 120, rock),
        flat.box(-390, -700, 100, 1900, rock),
        flat.box(390, -700, 100, 1900, rock),
        ...LEDGES.map(([x, y, w, h, tip = 0]) => flat.box(x, y, w, h, { ...rock, angle: tip, round: 5 })),
    ];
    // It stays upright, and its corners are round so that it does not catch on a ledge's edge: the game is the hammer.
    const climber = flat.box(-150, -SIZE / 2, SIZE, SIZE, { upright: true, round: 9, friction: 0.5, density: 1.5 });
    climber.damping = 0.12;
    // The head does not turn either. A head that rolled would roll off whatever it was hooked on.
    const head = flat.ball(-150, -SIZE / 2 - 70, HEAD, { upright: true, friction: 1.6, density: 1.1 });
    // The arms: quick, and strong enough to throw the block upward, not only to lift it.
    const arms = flat.motor(climber, head, 3.6, 12);
    arms.to(0, -70);
    return {
        flat, rocks, climber, head,
        aim(dx, dy) {
            const away = Math.hypot(dx, dy) || 1;
            const reach = Math.max(NEAR, Math.min(REACH, away));
            arms.to((dx / away) * reach, (dy / away) * reach);
        },
        height: () => Math.max(0, -(climber.y + SIZE / 2)),
        done: () => climber.y < TOP - SIZE / 2 + 6 && Math.abs(climber.x - 75) < 105,
    };
}

export default function climb(m: Mote): Scene {
    const { flat, rocks, climber, head, aim, height, done: atTop } = course();
    let best = m.recall("climb");
    let top = 0;
    let done = false;
    let took = 0;
    /** The world's y at the top edge of the box. It follows the climber, a little behind. */
    let camera = 0;
    let settled = false;

    const scale = () => Math.min(1, m.width / WIDE);
    /** Where the camera wants to be: the climber a little below the middle, and never below the ground. */
    const wanted = () => Math.min(climber.y - (m.height / scale()) * 0.58, 70 - m.height / scale());

    return {
        confines: true,
        step(dt) {
            if (m.preview) {
                // Shown small in a list, the hammer goes round by itself.
                aim(Math.cos(m.time * 1.7) * REACH, Math.sin(m.time * 1.7) * REACH);
            } else if (m.pointer.held || m.pointer.inside) {
                // The head goes to where the pointer is, measured from the climber as both are seen.
                aim((m.pointer.x - m.width / 2) / scale() - climber.x, m.pointer.y / scale() + camera - climber.y);
            }
            flat.step(dt);
            camera = settled ? camera + (wanted() - camera) * Math.min(1, dt * 7) : wanted();
            settled = true;
            if (!done) took += dt;
            top = Math.round(height() / 20);
            if (top > best) {
                best = top;
                m.keep("climb", best);
            }
            if (atTop()) done = true;
        },
        resize() {
            settled = false;
        },
        resting: () => false,
        draw() {
            const { ctx } = m;
            if (!settled) camera = wanted();
            ctx.save();
            ctx.translate(m.width / 2, 0);
            ctx.scale(scale(), scale());
            ctx.translate(0, -camera);

            ctx.fillStyle = m.color("--rule");
            for (const piece of rocks) {
                trace(ctx, piece);
                ctx.fill();
            }
            // the flag at the top
            ctx.strokeStyle = m.color("--ink");
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(140, TOP);
            ctx.lineTo(140, TOP - 70);
            ctx.stroke();
            ctx.fillStyle = m.color("--accent");
            ctx.beginPath();
            ctx.moveTo(140, TOP - 70);
            ctx.lineTo(98, TOP - 56);
            ctx.lineTo(140, TOP - 42);
            ctx.fill();

            drawClimber(ctx, climber, head, m.color("--ink"), m.color("--accent"), m.color("--muted"));
            ctx.restore();

            if (m.preview) return;
            // Confined, the browser hides its own pointer, so one is drawn.
            if (m.pointer.held) {
                ctx.strokeStyle = m.color("--ink");
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(m.pointer.x, m.pointer.y, 6, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = m.color("--ink");
            ctx.textAlign = "left";
            ctx.font = m.font(26, 600);
            ctx.fillText(`${top} m`, 18, 38);
            ctx.fillStyle = m.color("--muted");
            ctx.font = m.font(15);
            ctx.fillText(`best ${best} m`, 18, 60);
            ctx.textAlign = "center";
            if (done) {
                ctx.fillStyle = m.color("--ink");
                ctx.font = m.font(24, 600);
                ctx.fillText(`The top, in ${Math.floor(took / 60)}:${String(Math.floor(took % 60)).padStart(2, "0")}.`, m.width / 2, 40);
            } else if (!m.pointer.held) ctx.fillText("Click to take the hammer. Escape lets go.", m.width / 2, m.height - 18);
        },
    };
}

interface At {
    x: number;
    y: number;
}

/**
 * The climber: one of the blocks, with a triangle for a head, two arms and its hammer.
 * Change this to change how it looks. The handle is one length. One hand holds its very end
 * and the other holds it a little further along, so reaching out is the arms going out and
 * drawing the head in is the hands going back past the block.
 */
function drawClimber(ctx: CanvasRenderingContext2D, body: At, head: At, ink: string, accent: string, dim: string): void {
    const [dx, dy] = [head.x - body.x, head.y - body.y];
    const far = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / far, dy / far];
    const butt: At = { x: head.x - ux * HANDLE, y: head.y - uy * HANDLE };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // the block
    ctx.fillStyle = "oklch(0.86 0.085 300)";
    ctx.beginPath();
    ctx.roundRect(body.x - SIZE / 2, body.y - SIZE / 2, SIZE, SIZE, 9);
    ctx.fill();
    // the triangle poking out of the top
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(body.x - 11, body.y - SIZE / 2 + 2);
    ctx.lineTo(body.x, body.y - SIZE / 2 - 20);
    ctx.lineTo(body.x + 11, body.y - SIZE / 2 + 2);
    ctx.fill();

    // the handle, from its end to the head, and the head, square to it
    ctx.strokeStyle = dim;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(-8, -17, 16, 34, 4);
    ctx.fill();
    ctx.restore();

    // two arms, each from a shoulder to a hand on the handle, bent at the elbow: one hand on the very end, one a little along
    for (const [side, along] of [[-1, 0], [1, 30]] as const) {
        const shoulder: At = { x: body.x + side * (SIZE / 2 - 2), y: body.y - 6 };
        const hand: At = { x: butt.x + ux * along, y: butt.y + uy * along };
        const [hx, hy] = [hand.x - shoulder.x, hand.y - shoulder.y];
        const span = Math.hypot(hx, hy) || 1;
        // The elbow: half way, and off to the side a little. The arms are as long as they need to be,
        // so a hand is always on the handle, and they bend less the further they reach.
        const out = Math.max(4, 16 - span * 0.12) * side;
        const elbow: At = { x: shoulder.x + hx / 2 - (hy / span) * out, y: shoulder.y + hy / 2 + (hx / span) * out };
        ctx.strokeStyle = ink;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(shoulder.x, shoulder.y);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
    }
}
