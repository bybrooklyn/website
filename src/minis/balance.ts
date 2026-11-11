// Balance: a ball on a beam. Tilt the beam to keep the ball on it for as long
// as you can. The wind gets stronger the longer you last.

import type { Mote, Scene } from "../mote";

const RADIUS = 13;
/** How far the beam can tip, in radians, and how fast. */
const MOST = 0.42;
const SPEED = 2.6;

export const label = "A game: a ball on a beam. Tilt the beam with the arrow keys or by dragging to keep the ball on.";

export default function balance(m: Mote): Scene {
    let state: "ready" | "playing" | "over" = "ready";
    let tilt = 0;
    let along = 0;
    let speed = 0;
    let lasted = 0;
    let wind = 0;
    let gust = 0;
    let best = m.recall("balance");
    /** After falling: where the ball is, and how it is moving, free of the beam. */
    let fallen = { x: 0, y: 0, vx: 0, vy: 0 };

    const half = () => Math.min(m.width * 0.4, 250);
    const pivot = (): [number, number] => [m.width / 2, m.height * 0.62];

    const begin = () => {
        state = "playing";
        tilt = 0;
        along = (Math.random() - 0.5) * 30;
        speed = 0;
        lasted = 0;
        wind = 0;
        gust = 0;
    };

    return {
        press() {
            if (state !== "playing") begin();
        },
        keydown(name) {
            if (state !== "playing" && name === "action") begin();
        },
        step(dt) {
            if (state === "ready") return;
            if (state === "over") {
                fallen.vy += 1500 * dt;
                fallen.x += fallen.vx * dt;
                fallen.y += fallen.vy * dt;
                return;
            }
            lasted += dt;
            // The keys tip the beam; a held pointer tips it toward where it is.
            let want = tilt;
            if (m.key("left")) want = -MOST;
            else if (m.key("right")) want = MOST;
            else if (m.pointer.down) want = Math.max(-MOST, Math.min(MOST, ((m.pointer.x - pivot()[0]) / half()) * MOST));
            const change = Math.max(-SPEED * dt, Math.min(SPEED * dt, want - tilt));
            tilt += change;
            // A gust comes now and then, a little stronger each time.
            gust -= dt;
            if (gust <= 0) {
                gust = 1.2 + Math.random() * 1.6;
                wind = (Math.random() < 0.5 ? -1 : 1) * (40 + lasted * 9) * Math.random();
            }
            speed += (1500 * Math.sin(tilt) + wind) * dt;
            speed *= 1 - 0.25 * dt;
            along += speed * dt;
            if (Math.abs(along) > half() + RADIUS * 0.4) {
                state = "over";
                const [px, py] = pivot();
                fallen = { x: px + Math.cos(tilt) * along, y: py + Math.sin(tilt) * along - RADIUS - 5, vx: Math.cos(tilt) * speed, vy: Math.sin(tilt) * speed };
                if (lasted > best) {
                    best = lasted;
                    m.keep("balance", Math.round(best * 10) / 10);
                }
            }
        },
        resting: () => state === "ready" || (state === "over" && fallen.y > m.height + 60),
        draw() {
            const { ctx } = m;
            const [px, py] = pivot();
            const length = half();
            // the stand
            ctx.fillStyle = m.color("--rule");
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px - 26, py + 46);
            ctx.lineTo(px + 26, py + 46);
            ctx.closePath();
            ctx.fill();
            // the beam
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(tilt);
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.roundRect(-length, -5, length * 2, 10, 5);
            ctx.fill();
            if (state !== "over") {
                ctx.fillStyle = m.color("--accent");
                ctx.beginPath();
                ctx.arc(along, -5 - RADIUS, RADIUS, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            if (state === "over") {
                ctx.fillStyle = m.color("--accent");
                ctx.beginPath();
                ctx.arc(fallen.x, fallen.y, RADIUS, 0, Math.PI * 2);
                ctx.fill();
            }
            // the wind, as a mark that leans the way it blows
            if (state === "playing" && Math.abs(wind) > 8) {
                ctx.strokeStyle = m.color("--muted");
                ctx.lineWidth = 2;
                ctx.lineCap = "round";
                const reach = Math.max(-60, Math.min(60, wind * 0.25));
                for (const row of [0, 1, 2]) {
                    ctx.beginPath();
                    ctx.moveTo(px - reach / 2, 26 + row * 9);
                    ctx.lineTo(px + reach / 2, 26 + row * 9);
                    ctx.stroke();
                }
            }
            // the words
            ctx.textAlign = "center";
            ctx.fillStyle = m.color("--ink");
            ctx.font = m.font(state === "playing" ? 30 : 22, 600);
            const top = m.height * 0.2;
            if (state === "playing") ctx.fillText(lasted.toFixed(1), px, top);
            else if (state === "ready") ctx.fillText("Click or press Space to start", px, top);
            else ctx.fillText(`${lasted.toFixed(1)} seconds. Click to go again`, px, top);
            if (best > 0) {
                ctx.fillStyle = m.color("--muted");
                ctx.font = m.font(15);
                ctx.fillText(`best ${best.toFixed(1)}`, px, top + 26);
            }
        },
    };
}
