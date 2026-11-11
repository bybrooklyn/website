// Climb: a block with a hammer and a long way up. The hammer's head goes
// where the mouse goes, as far as the handle reaches. Press it against
// something and it is the block that moves: hook a ledge and pull, plant it
// and vault. There are no places to rest your progress. Slip, and you are
// back wherever you land.

import { World, ball, rect, shape, type Body, type Mote, type Scene } from "../mote";

export const label = "A game: a block with a hammer climbs a tall pile of rocks. The hammer follows the mouse.";

/** How far the hammer reaches from the middle of the block. */
const REACH = 118;
const SIZE = 34;
/** The course is this wide; it is scaled down to fit a narrower box. */
const WIDE = 680;
/** How high the top is, in the world's units. */
const TOP = -1275;

export default function climb(m: Mote): Scene {
    const world = Object.assign(new World(), { gravity: 1700, parts: 3, passes: 12, air: 0.25 });
    const fixed = { fixed: true, friction: 0.9 };
    const rocks: Body[] = [
        rect(0, 40, 1400, 80, fixed),
        rect(-370, -700, 60, 1700, fixed),
        rect(370, -700, 60, 1700, fixed),
        shape(-130, -32, [[-80, 34], [-46, -36], [30, -46], [84, 34]], fixed),
        rect(200, -150, 190, 26, fixed),
        rect(-50, -275, 250, 22, { ...fixed, angle: -0.32 }),
        rect(-285, -330, 70, 300, fixed),
        rect(70, -440, 110, 110, { ...fixed, angle: 0.2 }),
        rect(245, -565, 150, 20, fixed),
        shape(-90, -640, [[-120, 40], [0, -60], [120, 40]], fixed),
        rect(-235, -800, 180, 24, fixed),
        ball(130, -865, 70, fixed),
        rect(270, -1010, 40, 220, fixed),
        rect(50, -1095, 160, 24, fixed),
        rect(-160, TOP + 15, 260, 30, fixed),
    ];
    const climber = rect(0, -SIZE / 2, SIZE, SIZE, { friction: 0.7 });
    // It stays upright: the game is the hammer, not keeping your balance.
    climber.ii = 0;
    const head = ball(0, -SIZE / 2 - 60, 10, { friction: 1, density: 2.5 });
    world.add(...rocks, climber, head);
    // The arm: strong enough to lift the block and a bit more.
    const arm = world.drive(climber, head, (2.6 * world.gravity) / climber.im);

    let best = m.recall("climb");
    let top = 0;
    let done = false;
    let took = 0;

    const scale = () => Math.min(1, m.width / WIDE);
    /** The world's y at the top edge of the box: the climber sits a little below the middle. */
    const camera = () => Math.min(climber.y - (m.height / scale()) * 0.6, 80 - m.height / scale());

    return {
        confines: true,
        step(dt) {
            if (m.preview) {
                // Shown small in a list, the hammer goes round by itself.
                arm.to = [Math.cos(m.time * 1.7) * REACH, Math.sin(m.time * 1.7) * REACH];
            } else if (m.pointer.held || m.pointer.inside) {
                const [x, y] = [(m.pointer.x - m.width / 2) / scale() - climber.x, m.pointer.y / scale() + camera() - climber.y];
                const away = Math.hypot(x, y) || 1;
                const reach = Math.min(REACH, away);
                arm.to = [(x / away) * reach, (y / away) * reach];
            }
            world.step(dt);
            if (!done) took += dt;
            top = Math.max(0, Math.round(-(climber.y + SIZE / 2) / 20));
            if (top > best) {
                best = top;
                m.keep("climb", best);
            }
            if (climber.y < TOP - SIZE / 2 + 4 && Math.abs(climber.x + 160) < 140) done = true;
        },
        resting: () => false,
        draw() {
            const { ctx } = m;
            ctx.save();
            ctx.translate(m.width / 2, 0);
            ctx.scale(scale(), scale());
            ctx.translate(0, -camera());

            ctx.fillStyle = m.color("--rule");
            for (const rock of rocks) {
                ctx.beginPath();
                if (rock.r) ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
                else rock.wp.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
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

            drawClimber(ctx, climber, head, m.color("--ink"), m.color("--accent"));
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

/** The climber: one of the blocks, with a triangle for a head, and its hammer. Change this to change how it looks. */
function drawClimber(ctx: CanvasRenderingContext2D, body: Body, head: Body, ink: string, accent: string): void {
    // the handle
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    // the block
    ctx.fillStyle = "oklch(0.86 0.085 300)";
    ctx.fillRect(body.x - SIZE / 2, body.y - SIZE / 2, SIZE, SIZE);
    // the triangle poking out of the top
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(body.x - 11, body.y - SIZE / 2);
    ctx.lineTo(body.x, body.y - SIZE / 2 - 20);
    ctx.lineTo(body.x + 11, body.y - SIZE / 2);
    ctx.fill();
    // the hammer's head, square to the handle
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(head.y - body.y, head.x - body.x));
    ctx.fillStyle = ink;
    ctx.fillRect(-7, -15, 14, 30);
    ctx.restore();
}
