// Climb: a block with a hammer and a long way up. The hammer's head goes
// where the mouse goes, as far as the arms reach. Press it against something
// and it is the block that moves: hook a ledge and pull, plant it and vault.
// There are no places to rest your progress. Slip, and you are back wherever
// you land.

import { Flat, trace, where, type Body, type Mote, type Scene } from "../mote";

export const label = "A game: a block with a hammer climbs a tall pile of rocks. The hammer follows the mouse.";

/** How far the hammer's head can be from the middle of the block, and how long its handle is. */
const REACH = 120;
const HANDLE = 150;
const SIZE = 36;
/** The course is this wide; it is scaled down to fit a narrower box. */
const WIDE = 680;
/** How high the top is, in the world's units. */
const TOP = -1275;

export default function climb(m: Mote): Scene {
    const flat = new Flat(2000);
    flat.care = [12, 6];
    const rock = { fixed: true, friction: 0.9 };
    const rocks: Body[] = [
        flat.box(0, 40, 1400, 80, rock),
        flat.box(-370, -700, 60, 1700, rock),
        flat.box(370, -700, 60, 1700, rock),
        flat.shape(-130, -32, [[-80, 34], [-46, -36], [30, -46], [84, 34]], rock),
        flat.box(200, -150, 190, 26, rock),
        flat.box(-50, -275, 250, 22, { ...rock, angle: -0.32 }),
        flat.box(-285, -330, 70, 300, rock),
        flat.box(70, -440, 110, 110, { ...rock, angle: 0.2 }),
        flat.box(245, -565, 150, 20, rock),
        flat.shape(-90, -640, [[-120, 40], [0, -60], [120, 40]], rock),
        flat.box(-235, -800, 180, 24, rock),
        flat.ball(130, -865, 70, rock),
        flat.box(270, -1010, 40, 220, rock),
        flat.box(50, -1095, 160, 24, rock),
        flat.box(-160, TOP + 15, 260, 30, rock),
    ];
    // It stays upright: the game is the hammer, not keeping your balance.
    const climber = flat.box(0, -SIZE / 2, SIZE, SIZE, { friction: 0.6, upright: true, density: 1.2 });
    climber.setLinearDamping(0.15);
    const head = flat.ball(0, -SIZE / 2 - 70, 11, { friction: 1.4, density: 2.5, quick: true });
    // The arms: strong enough to lift the block, with something to spare.
    const arms = flat.motor(climber, head, 3.4);
    arms.to(0, -70);

    let best = m.recall("climb");
    let top = 0;
    let done = false;
    let took = 0;

    const scale = () => Math.min(1, m.width / WIDE);
    /** The world's y at the top edge of the box: the climber sits a little below the middle. */
    const camera = () => Math.min(where(climber).y - (m.height / scale()) * 0.6, 80 - m.height / scale());

    return {
        confines: true,
        step(dt) {
            const me = where(climber);
            if (m.preview) {
                // Shown small in a list, the hammer goes round by itself.
                arms.to(Math.cos(m.time * 1.7) * REACH, Math.sin(m.time * 1.7) * REACH);
            } else if (m.pointer.held || m.pointer.inside) {
                const [x, y] = [(m.pointer.x - m.width / 2) / scale() - me.x, m.pointer.y / scale() + camera() - me.y];
                const away = Math.hypot(x, y) || 1;
                const reach = Math.min(REACH, away);
                arms.to((x / away) * reach, (y / away) * reach);
            }
            flat.step(dt);
            if (!done) took += dt;
            top = Math.max(0, Math.round(-(me.y + SIZE / 2) / 20));
            if (top > best) {
                best = top;
                m.keep("climb", best);
            }
            if (me.y < TOP - SIZE / 2 + 4 && Math.abs(me.x + 160) < 140) done = true;
        },
        resting: () => false,
        draw() {
            const { ctx } = m;
            ctx.save();
            ctx.translate(m.width / 2, 0);
            ctx.scale(scale(), scale());
            ctx.translate(0, -camera());

            ctx.fillStyle = m.color("--rule");
            for (const piece of rocks) {
                trace(ctx, piece);
                ctx.fill();
            }
            // the flag at the top
            ctx.strokeStyle = m.color("--ink");
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-160, TOP);
            ctx.lineTo(-160, TOP - 70);
            ctx.stroke();
            ctx.fillStyle = m.color("--accent");
            ctx.beginPath();
            ctx.moveTo(-160, TOP - 70);
            ctx.lineTo(-118, TOP - 56);
            ctx.lineTo(-160, TOP - 42);
            ctx.fill();

            drawClimber(ctx, where(climber), where(head), m.color("--ink"), m.color("--accent"), m.color("--muted"));
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
 * Change this to change how it looks. The hammer's handle is one length: when the head is
 * close in, the rest of the handle sticks out behind the hands, as a real one would.
 */
function drawClimber(ctx: CanvasRenderingContext2D, body: At, head: At, ink: string, accent: string, dim: string): void {
    const [dx, dy] = [head.x - body.x, head.y - body.y];
    const far = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / far, dy / far];
    const butt: At = { x: head.x - ux * HANDLE, y: head.y - uy * HANDLE };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // the handle, from its butt to the head
    ctx.strokeStyle = dim;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    // the head, square to the handle
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(-8, -17, 16, 34, 3);
    ctx.fill();
    ctx.restore();

    // the block
    ctx.fillStyle = "oklch(0.86 0.085 300)";
    ctx.beginPath();
    ctx.roundRect(body.x - SIZE / 2, body.y - SIZE / 2, SIZE, SIZE, 4);
    ctx.fill();
    // the triangle poking out of the top
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(body.x - 11, body.y - SIZE / 2 + 1);
    ctx.lineTo(body.x, body.y - SIZE / 2 - 21);
    ctx.lineTo(body.x + 11, body.y - SIZE / 2 + 1);
    ctx.fill();

    // two arms, each from a shoulder to a hand on the handle, bent at the elbow
    const UPPER = 30;
    const FORE = 30;
    for (const [side, grip] of [[-1, 0.42], [1, 0.62]] as const) {
        const shoulder: At = { x: body.x + side * (SIZE / 2 - 3), y: body.y - SIZE / 2 + 9 };
        // where this hand is: part of the way from the butt to the head, but never further than the arm can reach
        let hand: At = { x: butt.x + ux * HANDLE * grip, y: butt.y + uy * HANDLE * grip };
        const [hx, hy] = [hand.x - shoulder.x, hand.y - shoulder.y];
        const span = Math.hypot(hx, hy) || 1;
        const reach = Math.min(span, UPPER + FORE - 1);
        hand = { x: shoulder.x + (hx / span) * reach, y: shoulder.y + (hy / span) * reach };
        // the elbow: off to the side of the line from shoulder to hand, by as much as the arm's two lengths leave over
        const along = (UPPER * UPPER - FORE * FORE + reach * reach) / (2 * reach);
        const out = Math.sqrt(Math.max(0, UPPER * UPPER - along * along)) * side;
        const elbow: At = { x: shoulder.x + (hx / span) * along - (hy / span) * out, y: shoulder.y + (hy / span) * along + (hx / span) * out };
        ctx.strokeStyle = ink;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(shoulder.x, shoulder.y);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}
