// Comet: pull back from anywhere and let go, and the comet curves round the planets toward the hole.
// The flight is in flight.ts and the fields, each proven winnable, in fields.ts; here they are drawn
// and played.
//
// On screen there is the sky, the planets as flat circles (the bigger, the stronger the pull), the
// hole as a ring, the comet as a point and its trail. While aiming, a line pulled back from the
// comet shows the pull. A missed shot leaves its trail, faint, to aim the next one against, and the
// comet is back at once. Reaching the ring, it is caught, spirals in, and its trail is drawn in after
// it; after a moment's stillness the comet rises out of the hole and moves to where the next field
// starts, while the planets of the one shrink away and the next one's grow.
//
// The field is one shape, fitted whole to the canvas and turned on its side on a tall screen, so a
// field is the same puzzle on a phone and a desktop. A field is a link: ?seed=…&field=….

import { sounds } from "../mote/sound";
import { el, type Mote, type Scene } from "../mote/stage";
import { wholeText } from "./checked";
import { LONGEST_SEED, MOST_LEVEL, kept, making, type Made } from "./fields";
import { CATCH, FASTEST, HIGH, STEP, WEAKEST, WIDE, advance, launch, velocity, nearest, type Comet, type Field } from "./flight";

export const label = "Comet, a game: pull back and let go, and the comet curves round the planets into the hole.";

/** A pull shorter than this, in pixels, is a tap: letting go does nothing. */
const DEAD = 8;
/** Past this part of a full pull, the line gives less for each pixel more: it resists. */
const GIVE = 0.72;
/** How many missed shots stay on the field, faint, and how bright each is, the last first. */
const KEPT = [0.22, 0.11, 0.05];
/** The arrival: how long the comet takes to spiral in and how far round it goes, the trail drawn in after it, the stillness after, and the move to the next field, in seconds. */
const SPIRAL = 0.95;
const TURNS = 1.6;
const DRAWN = 1.05;
const STILL = 0.45;
const MOVE = 0.9;
/** When the comet is swallowed the ring gives a little, inward, for this long, by this part of its size. */
const GIVE_TIME = 0.32;
const GIVE_DEPTH = 0.12;

const PLANET = "oklch(0.33 0.035 290)";
const COMET = "oklch(0.97 0.015 300)";

/** Quick to start and slow to settle, as the site's --ease. */
const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 4;
/** Slow to start and quick to finish. */
const sink = (t: number) => Math.min(1, Math.max(0, t)) ** 2.4;

/** A name for a new sky: syllables of the browser's own chance. */
function christen(): string {
    const [hard, soft] = ["bdfgklmnprstvz", "aeiou"];
    const pick = crypto.getRandomValues(new Uint32Array(6));
    return Array.from({ length: 3 }, (_, i) => hard[pick[i * 2]! % hard.length]! + soft[pick[i * 2 + 1]! % soft.length]!).join("");
}

type Phase = "making" | "aim" | "fly" | "caught" | "still" | "move";

export default function comet(m: Mote): Scene {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sound = m.preview ? undefined : sounds(m);

    // ---- which field: the address, or where this visitor left off, or a new sky ----
    // What earlier versions kept was for other fields: the run is kept under a new version, and the old bests are let go.
    try {
        localStorage.removeItem("mote:comet-bests");
    } catch {
        // storage is off: nothing was kept
    }
    const linked = m.link.get("seed");
    const left = kept(m.recall<unknown>("comet-run", null, 2));
    const place = m.preview ? { seed: "lumen", level: 3 } : linked ? { seed: linked.slice(0, LONGEST_SEED), level: wholeText(m.link.get("field"), 1, MOST_LEVEL, 1) } : (left ?? { seed: christen(), level: 1 });
    let level = place.level;
    let shots = 0;
    let made: Made | undefined;
    /** The field being made now, a little at a time while the page waits; and the next, while this one is played. */
    let asked: Generator<undefined, Made> | undefined = making(place.seed, level);
    let next: { work: Generator<undefined, Made>; done?: Made } | undefined;

    let phase: Phase = "making";
    /** How long the present phase has lasted, in seconds. */
    let age = 0;
    let flying: Comet | undefined;
    /** The flight's path, x and y one after the other, and where its tail is while it is drawn in. */
    let path: number[] = [];
    let tail = 0;
    /** Missed shots, the last first. */
    let missed: number[][] = [];
    /** The comet caught in the ring: how far from the hole's middle it was caught and at what angle, which way it turns, and where it is now from the middle. */
    let caught = { r: 0, angle: 0, turn: 1, x: 0, y: 0, gone: false };
    /** Seconds since the comet was swallowed, or less than 0 before it is. */
    let since = -1;
    /** The field before, while the next one comes. */
    let leaving: Field | undefined;

    // ---- aiming ----
    /** A pull with the pointer: where it was pressed and where it is now, in pixels. */
    let pulling: { fromX: number; fromY: number; x: number; y: number } | undefined;
    /** Aiming with the keyboard: a direction from AIMS and a strength. */
    let keyed = false;
    let aim = 0;
    let power = 0.6;

    // ---- the view: the whole field fitted to the canvas, turned upright on a tall screen ----
    let view = { scale: 1, x: 0, y: 0, upright: false };
    const fit = () => {
        const upright = m.height > m.width * 1.05;
        const [wide, high] = upright ? [HIGH, WIDE] : [WIDE, HIGH];
        const room = m.preview ? 6 : 14;
        const scale = Math.min((m.width - room * 2) / wide, (m.height - room * 2) / high);
        view = { scale, upright, x: (m.width - wide * scale) / 2, y: (m.height - high * scale) / 2 };
    };
    /** A place in the field, on the screen. */
    const screen = (x: number, y: number): [number, number] => (view.upright ? [view.x + (HIGH - y) * view.scale, view.y + x * view.scale] : [view.x + x * view.scale, view.y + y * view.scale]);
    /** A move on the screen, as a move in the field. */
    const inField = (dx: number, dy: number): [number, number] => (view.upright ? [dy / view.scale, -dx / view.scale] : [dx / view.scale, dy / view.scale]);
    /** A move in the field, as a move on the screen. */
    const onScreen = (dx: number, dy: number): [number, number] => (view.upright ? [-dy * view.scale, dx * view.scale] : [dx * view.scale, dy * view.scale]);
    /** How long a full pull is, in pixels. */
    const longest = () => Math.max(120, Math.min(220, 0.42 * Math.min(m.width, m.height)));

    /** How strong a pull of `long` pixels is, from the weakest to 1: as long as the pull at first, then giving less and less near full. */
    const strengthOf = (long: number) => {
        const part = (long - DEAD) / (longest() - DEAD);
        const felt = part < GIVE ? part : GIVE + (1 - GIVE) * (1 - Math.exp(-(part - GIVE) / (1 - GIVE)));
        return WEAKEST + (1 - WEAKEST) * Math.min(1, Math.max(0, felt / 0.985));
    };
    /** The launch the pull or the keyboard would make: its velocity in the field, its strength, and the line's direction on the screen. */
    const launching = (): { vx: number; vy: number; power: number; dx: number; dy: number } | undefined => {
        if (pulling) {
            const [dx, dy] = [pulling.x - pulling.fromX, pulling.y - pulling.fromY];
            const long = Math.hypot(dx, dy);
            if (long < DEAD) return undefined;
            const strong = strengthOf(long);
            const [fx, fy] = inField(-dx, -dy);
            const unit = Math.hypot(fx, fy);
            return { vx: (fx / unit) * strong * FASTEST, vy: (fy / unit) * strong * FASTEST, power: strong, dx: dx / long, dy: dy / long };
        }
        if (!keyed) return undefined;
        const [vx, vy] = velocity(aim, power);
        const [sx, sy] = onScreen(-vx, -vy);
        const unit = Math.hypot(sx, sy);
        return { vx, vy, power, dx: sx / unit, dy: sy / unit };
    };

    // ---- the line under the canvas: which field, and the shots on it ----
    let tell = () => {};
    if (!m.preview) {
        const said = el("p", { class: "comet-said" });
        said.setAttribute("aria-live", "polite");
        m.panel().append(el("div", { class: "comet-line" }, said, sound!.button));
        tell = () => {
            const count = `${shots} ${shots === 1 ? "shot" : "shots"}`;
            said.textContent = phase === "caught" || phase === "still" || phase === "move" ? `Field ${level}, in ${count}.` : shots ? `Field ${level}, ${count}.` : `Field ${level}.`;
        };
    }
    const remember = () => {
        if (m.preview) return;
        m.keep("comet-run", { seed: place.seed, level }, 2);
        m.link.set("seed", place.seed);
        m.link.set("field", String(level));
    };

    /** A field to play, from the move or at once. */
    const arrive = (fresh: Made) => {
        made = fresh;
        [phase, age, flying, path, tail, missed, shots, pulling, since] = ["aim", 0, undefined, [], 0, [], 0, undefined, -1];
        const field = fresh.field;
        aim = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
        next = m.preview ? undefined : { work: making(place.seed, level + 1) };
        remember();
        tell();
        m.wake();
    };

    /** Keeps the flight just ended, faint, and has the comet back at the start. */
    const miss = () => {
        if (path.length > 2) missed = [path, ...missed].slice(0, KEPT.length);
        [phase, age, flying, path] = ["aim", 0, undefined, []];
    };
    const shoot = (vx: number, vy: number, strong: number) => {
        if (phase !== "aim" || !made) return;
        shots++;
        flying = launch(made.field, vx, vy);
        path = [flying.x, flying.y];
        [phase, age, keyed] = ["fly", 0, false];
        sound?.tone(196 * 2 ** (strong * 1.5), 0.22, 0.06);
        tell();
        m.wake();
    };
    /** The comet has reached the ring: from here it is drawn in, by the picture and not the flight. */
    const catching = () => {
        const comet = flying!;
        const hole = made!.field.hole;
        const [x, y] = [comet.x - hole.x, comet.y - hole.y];
        caught = { r: Math.hypot(x, y), angle: Math.atan2(y, x), turn: x * comet.vy - y * comet.vx < 0 ? -1 : 1, x, y, gone: false };
        [phase, age, tail] = ["caught", 0, 0];
        tell();
        if (reduced) swallow();
    };
    const swallow = () => {
        caught.gone = true;
        since = 0;
        [caught.x, caught.y] = [0, 0];
        sound?.tone(98, 1.6, 0.13);
    };

    // ---- the keyboard: arrows aim and set the strength, Enter or Space lets go, Escape puts the pull down ----
    if (!m.preview) {
        // A touch the system takes away (a gesture, an alert) is not a letting go, though the stage hands it on as one.
        m.canvas.parentElement?.addEventListener("pointercancel", () => (pulling = undefined), { capture: true });
        m.canvas.addEventListener("keydown", (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const key = event.key;
            const by = event.shiftKey ? 10 : 1;
            if (key === "Escape" && (pulling || keyed)) [pulling, keyed] = [undefined, false];
            else if (key === "ArrowLeft" || key === "ArrowRight") {
                keyed = true;
                aim += key === "ArrowLeft" ? -by : by;
            } else if (key === "ArrowUp" || key === "ArrowDown") {
                keyed = true;
                power = Math.round(Math.max(WEAKEST, Math.min(1, power + (key === "ArrowUp" ? 0.02 : -0.02) * (event.shiftKey ? 5 : 1))) * 100) / 100;
            } else if ((key === "Enter" || key === " ") && !event.repeat) {
                if (phase === "fly") miss();
                else if (!keyed) keyed = true;
                else shoot(...velocity(aim, power), power);
            } else return;
            m.wake();
        });
    }

    fit();
    tell();
    remember();

    // ---- drawing, in the field's own units ----
    const ink = (field: number) => field / view.scale;
    const planets = (ctx: CanvasRenderingContext2D, field: Field, size: (x: number, y: number) => number) => {
        ctx.fillStyle = PLANET;
        for (const planet of field.planets) {
            const r = planet.r * size(planet.x, planet.y);
            if (r <= 0.2) continue;
            ctx.beginPath();
            ctx.arc(planet.x, planet.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    };
    const ring = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
        if (r <= 0.2) return;
        ctx.strokeStyle = m.color("--accent");
        ctx.lineWidth = ink(1.6);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
    };
    /** A path as a thin line, from `from` (in points) to its end, fading toward its tail. */
    const trail = (ctx: CanvasRenderingContext2D, points: number[], from: number, bright: number, fades: boolean) => {
        const count = points.length / 2;
        if (count - from < 2) return;
        ctx.strokeStyle = COMET;
        ctx.lineWidth = ink(1.5);
        ctx.lineJoin = "round";
        if (!fades) {
            ctx.globalAlpha = bright;
            ctx.beginPath();
            ctx.moveTo(points[from * 2]!, points[from * 2 + 1]!);
            for (let i = from + 1; i < count; i++) ctx.lineTo(points[i * 2]!, points[i * 2 + 1]!);
            ctx.stroke();
            ctx.globalAlpha = 1;
            return;
        }
        // pieces end to end, each a little brighter than the one behind it; square ends, so no piece overlaps the next
        ctx.lineCap = "butt";
        const pieces = 40;
        const each = Math.max(1, Math.ceil((count - from) / pieces));
        for (let start = from; start < count - 1; start += each) {
            const t = (start + each / 2 - from) / (count - from);
            ctx.globalAlpha = bright * (0.08 + 0.92 * t * t);
            ctx.beginPath();
            ctx.moveTo(points[start * 2]!, points[start * 2 + 1]!);
            for (let i = start + 1; i <= Math.min(count - 1, start + each); i++) ctx.lineTo(points[i * 2]!, points[i * 2 + 1]!);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    };
    const head = (ctx: CanvasRenderingContext2D, x: number, y: number, size = 1) => {
        if (size <= 0.02) return;
        ctx.fillStyle = COMET;
        ctx.beginPath();
        ctx.arc(x, y, ink(2.6) * size, 0, Math.PI * 2);
        ctx.fill();
    };
    /** The pull: a line from the comet back the way it is pulled, as long as the pull. On the screen, not in the field. */
    const line = (ctx: CanvasRenderingContext2D, field: Field) => {
        const sent = launching();
        if (!sent) return;
        const [cx, cy] = screen(field.start.x, field.start.y);
        const long = DEAD + ((sent.power - WEAKEST) / (1 - WEAKEST)) * (longest() - DEAD);
        ctx.save();
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        ctx.strokeStyle = COMET;
        ctx.globalAlpha = 0.35 + 0.5 * sent.power;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + sent.dx * 5, cy + sent.dy * 5);
        ctx.lineTo(cx + sent.dx * long, cy + sent.dy * long);
        ctx.stroke();
        ctx.restore();
    };

    /** In the list, small, it plays its own winning shot now and then. */
    const auto = () => {
        if (!m.preview || !made || phase !== "aim" || age < 1.1) return;
        const { aim: toward, power: strong } = made.solution;
        shoot(...velocity(toward, strong), strong);
    };

    return {
        resize: fit,
        press(x, y) {
            if (m.preview || !made) return;
            if (phase !== "aim" && phase !== "fly") return;
            keyed = false;
            pulling = { fromX: x, fromY: y, x, y };
        },
        move(x, y) {
            if (!pulling) return;
            [pulling.x, pulling.y] = [x, y];
            // a pull begun while the comet flies gives that shot up, and becomes the next one; a tap leaves the flight alone
            if (phase === "fly" && Math.hypot(x - pulling.fromX, y - pulling.fromY) >= DEAD) miss();
        },
        release(x, y) {
            if (!pulling) return;
            [pulling.x, pulling.y] = [x, y];
            const sent = launching();
            pulling = undefined;
            if (sent) shoot(sent.vx, sent.vy, sent.power);
        },
        step(dt) {
            age += dt;
            if (since >= 0) since += dt;
            // a field asked for now is made with most of each step; the next one with a little of each, while this one is played
            const work = asked ?? (next && !next.done ? next.work : undefined);
            if (work) {
                const until = performance.now() + (asked ? 6 : 1.5);
                while (performance.now() < until) {
                    const piece = work.next();
                    if (!piece.done) continue;
                    if (asked) {
                        asked = undefined;
                        arrive(piece.value);
                    } else next!.done = piece.value;
                    break;
                }
            }
            if (!made) return;
            const field = made.field;
            auto();
            if (phase === "fly" && flying) {
                advance(field, flying);
                path.push(flying.x, flying.y);
                if (flying.ended === "won") catching();
                else if (flying.ended) miss();
            } else if (phase === "caught") {
                // caught by the ring, it slows at once, then spirals in the way it was going round, the circle closing and the turning quickening
                const c = caught;
                if (!c.gone) {
                    const s = Math.min(1, age / SPIRAL);
                    const r = c.r * (1 - s) ** 1.5;
                    const angle = c.angle + c.turn * TURNS * Math.PI * 2 * (0.3 * s + 0.7 * s * s);
                    [c.x, c.y] = [Math.cos(angle) * r, Math.sin(angle) * r];
                    path.push(field.hole.x + c.x, field.hole.y + c.y);
                    if (s >= 1) swallow();
                }
                tail = Math.floor((path.length / 2) * (reduced ? 1 : sink(age / DRAWN)));
                if (c.gone && tail >= path.length / 2 - 1) [phase, age] = ["still", 0];
            } else if (phase === "still") {
                if (m.preview && age > STILL) [phase, age, path, missed, since] = ["aim", 0, [], [], -1];
                else if (next?.done && age > STILL) {
                    leaving = field;
                    level++;
                    arrive(next.done);
                    if (!reduced) [phase, age] = ["move", 0];
                }
            } else if (phase === "move" && age >= MOVE) [phase, age, leaving] = ["aim", 0, undefined];
        },
        resting: () => !m.preview && phase === "aim" && !pulling && !asked && (!next || next.done !== undefined),
        debug: () => (made ? [`field ${place.seed} ${level}: ${made.field.planets.length} planets, ${made.wins} winning launches, ${made.tries} tries`, `a way in: aim ${made.solution.aim}, power ${made.solution.power.toFixed(2)}, ${made.solution.window} degrees, ${(made.solution.steps * STEP).toFixed(2)} s`, `${phase} ${age.toFixed(2)}`] : ["making"]),
        draw() {
            const { ctx } = m;
            if (m.debug && made) {
                const [sx, sy] = screen(made.field.start.x, made.field.start.y);
                Object.assign(m.canvas.dataset, { phase, level: String(level), shots: String(shots), aim: String(made.solution.aim), power: String(made.solution.power), start: [sx, sy, longest(), view.upright ? 1 : 0].join(","), toward: String(nearest(made.field.hole.x - made.field.start.x, made.field.hole.y - made.field.start.y)) });
            }
            if (!made) return;
            const field = made.field;
            ctx.save();
            ctx.translate(view.x, view.y);
            if (view.upright) {
                ctx.translate(HIGH * view.scale, 0);
                ctx.rotate(Math.PI / 2);
            }
            ctx.scale(view.scale, view.scale);

            if (phase === "move" && leaving) {
                // the planets of the field before shrink away, the hole's ring closes, and the comet rises out of it to the new start; then the new planets and ring grow
                const t = age / MOVE;
                const gone = 1 - ease(t / 0.55);
                const from = leaving;
                planets(ctx, from, () => gone);
                ring(ctx, from.hole.x, from.hole.y, CATCH * gone);
                const grow = (x: number, y: number) => ease((t - 0.3 - (Math.hypot(x - field.start.x, y - field.start.y) / WIDE) * 0.25) / 0.45);
                planets(ctx, field, grow);
                ring(ctx, field.hole.x, field.hole.y, CATCH * grow(field.hole.x, field.hole.y));
                const glide = ease(t / 0.8);
                head(ctx, from.hole.x + (field.start.x - from.hole.x) * glide, from.hole.y + (field.start.y - from.hole.y) * glide, ease(t / 0.25));
                ctx.restore();
                return;
            }

            planets(ctx, field, () => 1);
            // the ring takes the comet's weight as it goes in: it gives a little and comes back
            const taken = since >= 0 && !reduced ? Math.sin(Math.PI * Math.min(1, since / GIVE_TIME)) : 0;
            ring(ctx, field.hole.x, field.hole.y, CATCH * (1 - GIVE_DEPTH * taken));
            missed.forEach((one, at) => trail(ctx, one, 0, KEPT[at]!, false));
            if (phase === "fly" && flying) {
                trail(ctx, path, 0, 1, true);
                head(ctx, flying.x, flying.y);
            } else if (phase === "caught") {
                trail(ctx, path, tail, 1, true);
                if (!caught.gone) head(ctx, field.hole.x + caught.x, field.hole.y + caught.y, 1 - 0.6 * ease(age / SPIRAL));
            } else if (phase === "aim") {
                head(ctx, field.start.x, field.start.y);
            }
            ctx.restore();
            if (phase === "aim" && !m.preview) line(ctx, field);
        },
    };
}
