// Balance: a ball on a beam. Tilt the beam to roll the ball onto each mark as
// it appears. Every mark buys time, the clock runs faster as the score climbs,
// the wind gets stronger and the beam gets shorter. Falling off, or running
// out of time, ends it.

import type { Mote, Scene } from "../../mote";

const RADIUS = 12;
/** How far the beam can tip, in radians, and how fast it gets there. */
const MOST = 0.5;
const SPEED = 3.6;
/** How hard the slope pulls the ball along the beam. */
const PULL = 2600;

export const label = "A game: a ball on a beam. Tilt the beam with the mouse or the arrow keys to roll the ball onto each mark before time runs out.";

export default function balance(m: Mote): Scene {
    let state: "ready" | "playing" | "over" = m.preview ? "playing" : "ready";
    let why = "";
    let tilt = 0;
    let along = 0;
    let speed = 0;
    let score = 0;
    /** Time left, from 1 down to 0. */
    let left = 1;
    let mark = 0;
    let wind = 0;
    let gust = 0;
    /** Counts down after a mark is taken, for a flash where it was. */
    let taken = 0;
    let best = m.recall("balance-marks");
    /** After falling: where the ball is, and how it is moving, free of the beam. */
    let fallen = { x: 0, y: 0, vx: 0, vy: 0 };

    /** Half the beam's length. It gets shorter as the score climbs, down to three fifths. */
    const half = () => Math.min(m.width * 0.42, 270) * (1 - Math.min(0.4, score * 0.02));
    const pivot = (): [number, number] => [m.width / 2, m.height * 0.64];

    /** A new mark, well away from the ball. */
    const place = () => {
        const reach = half() - 22;
        do mark = (Math.random() * 2 - 1) * reach;
        while (Math.abs(mark - along) < reach * 0.55);
    };

    const begin = () => {
        state = "playing";
        tilt = 0;
        along = 0;
        speed = 0;
        score = 0;
        left = 1;
        wind = 0;
        gust = 1;
        place();
    };
    if (m.preview) begin();

    const end = (reason: string) => {
        state = "over";
        why = reason;
        const [px, py] = pivot();
        fallen = { x: px + Math.cos(tilt) * along, y: py + Math.sin(tilt) * along - RADIUS - 5, vx: Math.cos(tilt) * speed, vy: Math.sin(tilt) * speed };
        if (score > best) {
            best = score;
            m.keep("balance-marks", best);
        }
    };

    return {
        press() {
            if (state !== "playing") begin();
        },
        keydown(name) {
            if (state !== "playing" && name === "action") begin();
        },
        step(dt) {
            taken = Math.max(0, taken - dt);
            if (state === "ready") return;
            if (state === "over") {
                if (why === "fell") {
                    fallen.vy += 2400 * dt;
                    fallen.x += fallen.vx * dt;
                    fallen.y += fallen.vy * dt;
                }
                return;
            }
            // The keys tip the beam all the way; the mouse tips it toward where it is.
            let want = tilt;
            if (m.preview) want = Math.max(-MOST, Math.min(MOST, (mark - along) * 0.004 - speed * 0.0014));
            else if (m.key("left")) want = -MOST;
            else if (m.key("right")) want = MOST;
            else if (m.pointer.inside || m.pointer.down) want = Math.max(-MOST, Math.min(MOST, ((m.pointer.x - pivot()[0]) / half()) * MOST));
            tilt += Math.max(-SPEED * dt, Math.min(SPEED * dt, want - tilt));

            if (!m.preview) {
                // The clock: faster with every mark.
                left -= (0.11 + score * 0.007) * dt;
                // A gust every second or two, stronger with the score, either way.
                gust -= dt;
                if (gust <= 0) {
                    gust = 0.9 + Math.random() * 1.3;
                    wind = (Math.random() < 0.5 ? -1 : 1) * (60 + score * 16) * (0.4 + Math.random() * 0.6);
                }
            }
            speed += (PULL * Math.sin(tilt) + wind) * dt;
            speed *= 1 - 0.2 * dt;
            along += speed * dt;

            if (Math.abs(along - mark) < RADIUS + 7) {
                score++;
                left = Math.min(1, left + 0.4);
                taken = 0.35;
                place();
            }
            if (m.preview) {
                // It never loses: turned back gently at the ends.
                const edge = half() - RADIUS;
                if (Math.abs(along) > edge) {
                    along = Math.sign(along) * edge;
                    speed *= -0.3;
                }
            } else if (Math.abs(along) > half() + RADIUS * 0.4) end("fell");
            else if (left <= 0) end("time");
        },
        resting: () => state === "ready" || (state === "over" && taken === 0 && (why === "time" || fallen.y > m.height + 60)),
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
            // the beam, the mark on it, and the ball
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(tilt);
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.roundRect(-length, -5, length * 2, 10, 5);
            ctx.fill();
            if (state !== "ready") {
                ctx.strokeStyle = m.color("--accent");
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(mark, -5 - RADIUS, RADIUS + 4 + taken * 30, 0, Math.PI * 2);
                ctx.globalAlpha = state === "over" ? 0.3 : 0.9 - taken;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            if (state !== "over" || why === "time") {
                ctx.fillStyle = m.color("--accent");
                ctx.beginPath();
                ctx.arc(along, -5 - RADIUS, RADIUS, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            if (state === "over" && why === "fell") {
                ctx.fillStyle = m.color("--accent");
                ctx.beginPath();
                ctx.arc(fallen.x, fallen.y, RADIUS, 0, Math.PI * 2);
                ctx.fill();
            }
            if (m.preview) return;

            // the clock, as a bar that runs down toward the middle
            const bar = Math.min(m.width * 0.5, 320);
            ctx.fillStyle = m.color("--rule");
            ctx.fillRect(px - bar / 2, 18, bar, 4);
            ctx.fillStyle = left < 0.25 ? m.color("--ink") : m.color("--accent");
            ctx.fillRect(px - (bar * Math.max(0, left)) / 2, 18, bar * Math.max(0, left), 4);
            // the wind, as strokes that lean the way it blows
            if (state === "playing" && Math.abs(wind) > 12) {
                ctx.strokeStyle = m.color("--muted");
                ctx.lineWidth = 2;
                ctx.lineCap = "round";
                const reach = Math.max(-90, Math.min(90, wind * 0.3));
                for (const row of [0, 1, 2]) {
                    ctx.beginPath();
                    ctx.moveTo(px - reach / 2 + row * Math.sign(reach) * 8, py + 70 + row * 9);
                    ctx.lineTo(px + reach / 2 + row * Math.sign(reach) * 8, py + 70 + row * 9);
                    ctx.stroke();
                }
            }
            // the words
            ctx.textAlign = "center";
            ctx.fillStyle = m.color("--ink");
            const top = m.height * 0.22;
            if (state === "playing") {
                ctx.font = m.font(44, 600);
                ctx.fillText(String(score), px, top + 8);
            } else {
                ctx.font = m.font(22, 600);
                ctx.fillText(state === "ready" ? "Click or press Space to start" : `${score} ${score === 1 ? "mark" : "marks"}. ${why === "fell" ? "It fell" : "Out of time"}. Click to go again`, px, top);
            }
            if (best > 0) {
                ctx.fillStyle = m.color("--muted");
                ctx.font = m.font(15);
                ctx.fillText(`best ${best}`, px, top + 30);
            }
        },
    };
}
