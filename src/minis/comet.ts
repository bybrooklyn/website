// Comet: pull back from anywhere and let go, and the comet curves round the planets toward the hole.
// The flight is in flight.ts and the fields, each proven winnable, in fields.ts; here they are drawn
// and played.
//
// On screen there is a sky of faint stars that drift a hair as the comet moves; the planets, each its
// own color, lit from one side, with a soft glow as wide as their pull reaches; the hole as a ring that
// draws light inward in a slow swirl; and the comet, glowing, its tail streaming away from the planets,
// with its trail. While aiming, a line pulled back from the comet shows the pull, and dots show the
// first second of the flight it would give. A missed shot leaves its trail, faint, to aim the next one
// against, and the comet is back at once. Reaching the ring, it is caught, spirals in, and its trail is
// drawn in after it; after a moment's stillness the comet rises out of the hole and moves to where the
// next field starts, while the planets of the one shrink away and the next one's grow. The stars'
// drift and the swirl move only while the stage runs for the game, and not at all when less motion is
// asked for.
//
// The field is one shape, fitted whole to the canvas and turned on its side on a tall screen, so a
// field is the same puzzle on a phone and a desktop. A field is a link: ?seed=…&field=….

import { sounds } from "../mote/sound";
import { el, type Mote, type Scene } from "../mote/stage";
import { wholeText } from "./checked";
import { LONGEST_SEED, MOST_LEVEL, kept, making, type Made } from "./fields";
import { CATCH, FASTEST, HIGH, HOLE_REACH, REACH, STEP, WEAKEST, WIDE, advance, launch, velocity, nearest, type Comet, type Field } from "./flight";
import { ahead, along, css, stars, tailward, tints, type Tint } from "./sky";

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

/** How far apart the dots of the path ahead are, on the screen, in pixels. */
const DOTS = 11;
/** How far the nearest stars drift for each pixel the comet is from the middle of the canvas, and how quickly they follow it, a second. */
const DRIFT = 0.012;
const FOLLOW = 4;
/** How long light takes to fall from the edge of the hole's pull to its ring, in seconds, and how many streaks fall along each of its arms. */
const FALL = 7;
const STREAKS = 14;
const ARMS = 3;

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
    /** The stars of this sky, from its seed; and how far they have drifted and are drifting to, in pixels, for the nearest of them. */
    const sky = stars(place.seed, 900);
    let drift = { x: 0, y: 0 };
    let want = { x: 0, y: 0 };
    let drifted = false;
    /** Each field's planet colors, worked out once. */
    const colored = new WeakMap<Field, Tint[]>();
    const tinted = (field: Field) => {
        let found = colored.get(field);
        if (!found) colored.set(field, (found = tints(field.seed, field.level, field.planets.length)));
        return found;
    };

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

    // ---- colors: the page's own, read as numbers once, so that they can be given any opacity ----
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const channels = new Map<string, [number, number, number]>();
    /** One of the page's colors, such as "--ink", at an opacity. */
    const page = (property: string, alpha: number) => {
        let found = channels.get(property);
        if (!found) {
            found = [235, 235, 245];
            if (probe) {
                probe.clearRect(0, 0, 1, 1);
                probe.fillStyle = m.color(property);
                probe.fillRect(0, 0, 1, 1);
                const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
                found = [r!, g!, b!];
            }
            channels.set(property, found);
        }
        return `rgb(${found[0]} ${found[1]} ${found[2]} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
    };
    /** Whether the ground is dark, so that glows add light to it; on a light ground they are laid over it instead. */
    const dark = () => {
        page("--ground", 1);
        const [r, g, b] = channels.get("--ground")!;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    };
    const glowing = (ctx: CanvasRenderingContext2D) => (ctx.globalCompositeOperation = dark() ? "lighter" : "source-over");

    // ---- drawing, in the field's own units ----
    const ink = (field: number) => field / view.scale;
    /** Where the comet is now, in the field, for the stars to drift by. */
    const cometAt = (): [number, number] | undefined => {
        if (!made) return undefined;
        const field = made.field;
        if (phase === "fly" && flying) return [flying.x, flying.y];
        if (phase === "caught") return [field.hole.x + caught.x, field.hole.y + caught.y];
        if (phase === "still") return [field.hole.x, field.hole.y];
        if (phase === "move" && leaving) {
            const glide = ease(age / MOVE / 0.8);
            return [leaving.hole.x + (field.start.x - leaving.hole.x) * glide, leaving.hole.y + (field.start.y - leaving.hole.y) * glide];
        }
        return [field.start.x, field.start.y];
    };
    /** The stars, on the screen and not in the field, so that they fill the canvas: as many as its size asks, the nearer ones drifted against the comet. */
    const starry = (ctx: CanvasRenderingContext2D) => {
        const pad = 16;
        const [wide, high] = [m.width + pad * 2, m.height + pad * 2];
        const count = Math.min(sky.length, Math.round((m.width * m.height) / 1500));
        for (let i = 0; i < count; i++) {
            const star = sky[i]!;
            const x = ((((star.x * wide - drift.x * star.near) % wide) + wide) % wide) - pad;
            const y = ((((star.y * high - drift.y * star.near) % high) + high) % high) - pad;
            if (star.bright > 0.5) {
                const halo = ctx.createRadialGradient(x, y, 0, x, y, 3.2);
                halo.addColorStop(0, page("--ink", 0.55 * star.bright));
                halo.addColorStop(1, page("--ink", 0));
                ctx.fillStyle = halo;
                ctx.fillRect(x - 3.2, y - 3.2, 6.4, 6.4);
                ctx.fillStyle = page("--ink", 0.9 * star.bright);
                ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
            } else {
                ctx.fillStyle = page("--ink", star.bright * 0.55);
                ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
            }
        }
    };
    /** The glow round each planet, as wide as its pull reaches and fading as the pull does. */
    const glows = (ctx: CanvasRenderingContext2D, field: Field, size: (x: number, y: number) => number) => {
        const colors = tinted(field);
        ctx.save();
        glowing(ctx);
        field.planets.forEach((planet, at) => {
            const grown = size(planet.x, planet.y);
            const r = planet.r * grown;
            if (r <= 0.2) return;
            const reach = REACH * r;
            const glow = ctx.createRadialGradient(planet.x, planet.y, r * 0.8, planet.x, planet.y, reach);
            for (let i = 0; i <= 8; i++) {
                const part = i / 8;
                const out = (0.8 * r + part * (reach - 0.8 * r)) / reach;
                // faint out to the very edge of the pull, so its reach is seen, and stronger close in
                const fade = 1 - out * out;
                glow.addColorStop(part, css(colors[at]!, 0.08, (0.07 * fade + 0.16 * fade ** 10) * grown));
            }
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(planet.x, planet.y, reach, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    };
    /** The planets themselves, each its own color, lit from the top left of the screen. */
    const planets = (ctx: CanvasRenderingContext2D, field: Field, size: (x: number, y: number) => number) => {
        const colors = tinted(field);
        const [fx, fy] = inField(-1, -1.2);
        const [lx, ly] = [fx / Math.hypot(fx, fy), fy / Math.hypot(fx, fy)];
        field.planets.forEach((planet, at) => {
            const r = planet.r * size(planet.x, planet.y);
            if (r <= 0.2) return;
            const tint = colors[at]!;
            const body = ctx.createRadialGradient(planet.x + lx * r * 0.42, planet.y + ly * r * 0.42, r * 0.05, planet.x + lx * r * 0.15, planet.y + ly * r * 0.15, r * 1.08);
            body.addColorStop(0, css(tint, 0.17));
            body.addColorStop(0.45, css(tint, 0.02));
            body.addColorStop(0.8, css(tint, -0.2));
            body.addColorStop(1, css(tint, -0.34));
            ctx.fillStyle = body;
            ctx.beginPath();
            ctx.arc(planet.x, planet.y, r, 0, Math.PI * 2);
            ctx.fill();
        });
    };
    /** The hole: the reach of its pull, faint in the accent; light falling inward along it in a slow swirl; dark at its heart; and the ring, which is where a comet counts as arrived. */
    const hole = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, size: number) => {
        if (size <= 0.01) return;
        const reach = HOLE_REACH * size;
        ctx.save();
        glowing(ctx);
        const glow = ctx.createRadialGradient(x, y, r, x, y, reach);
        glow.addColorStop(0, page("--accent", 0.13));
        glow.addColorStop(0.4, page("--accent", 0.045));
        glow.addColorStop(1, page("--accent", 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, reach, 0, Math.PI * 2);
        ctx.fill();
        // streaks of light on a few arms, each falling from the edge of the pull to the ring, quicker as it nears, and turning as it falls;
        // each streak a little apart from the arm, its own length, brightness and pace, so that they do not fall in step
        const time = reduced ? 0 : m.time;
        const spot = (part: number, turn: number): [number, number] => {
            const out = r + (reach - r) * (1 - part) ** 1.6;
            const angle = turn + 2.4 * Math.log(reach / out) + time * 0.18;
            return [x + Math.cos(angle) * out, y + Math.sin(angle) * out];
        };
        const scatter = (n: number) => {
            const v = Math.sin(n * 12.9898) * 43758.5453;
            return v - Math.floor(v);
        };
        ctx.lineCap = "round";
        ctx.lineWidth = ink(1.2);
        for (let arm = 0; arm < ARMS; arm++) {
            for (let k = 0; k < STREAKS; k++) {
                const n = arm * STREAKS + k + 1;
                const turn = (arm * Math.PI * 2) / ARMS + (scatter(n) - 0.5) * 0.6;
                const part = (k / STREAKS + (time / FALL) * (0.8 + 0.4 * scatter(n + 0.3)) + arm * 0.37) % 1;
                const tail = Math.max(0, part - 0.06 - 0.1 * scatter(n + 0.6));
                const bright = (0.3 + 0.35 * scatter(n + 0.9)) * Math.sin(Math.PI * part) ** 1.5 * size;
                // brightest at its head, the end nearest the hole, and fading back along it
                let [px, py] = spot(tail, turn);
                for (let i = 1; i <= 5; i++) {
                    const [sx, sy] = spot(tail + ((part - tail) * i) / 5, turn);
                    ctx.strokeStyle = page("--accent", bright * (i / 5) ** 1.5);
                    ctx.beginPath();
                    ctx.moveTo(px, py);
                    ctx.lineTo(sx, sy);
                    ctx.stroke();
                    [px, py] = [sx, sy];
                }
            }
        }
        ctx.restore();
        const heart = ctx.createRadialGradient(x, y, 0, x, y, r);
        heart.addColorStop(0, "rgb(0 0 0 / 0.45)");
        heart.addColorStop(1, "rgb(0 0 0 / 0)");
        ctx.fillStyle = heart;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ring(ctx, x, y, r);
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
        ctx.strokeStyle = m.color("--ink");
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
    /** The comet: a glowing point, and its tail streaming away from the planets, longer the nearer they are. `otherwise` is the way the tail lies with no planet near. */
    const head = (ctx: CanvasRenderingContext2D, field: Field, x: number, y: number, otherwise: readonly [number, number], size = 1) => {
        if (size <= 0.02) return;
        const [tx, ty, near] = tailward(field, x, y, otherwise);
        ctx.save();
        glowing(ctx);
        // the tail: soft puffs along it, wider and fainter going out
        const long = ink(16 + 38 * near) * size;
        const puffs = 14;
        for (let i = puffs; i >= 1; i--) {
            const part = i / puffs;
            const [px, py] = [x + tx * long * part, y + ty * long * part];
            const wide = ink(2 + 5.5 * part) * size;
            const puff = ctx.createRadialGradient(px, py, 0, px, py, wide);
            puff.addColorStop(0, page("--ink", 0.3 * (1 - part) ** 1.4 * (0.6 + 0.4 * near)));
            puff.addColorStop(1, page("--ink", 0));
            ctx.fillStyle = puff;
            ctx.fillRect(px - wide, py - wide, wide * 2, wide * 2);
        }
        // the glow round it
        const wide = ink(12) * size;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, wide);
        glow.addColorStop(0, page("--ink", 0.5));
        glow.addColorStop(0.3, page("--ink", 0.14));
        glow.addColorStop(1, page("--ink", 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - wide, y - wide, wide * 2, wide * 2);
        ctx.restore();
        ctx.fillStyle = m.color("--ink");
        ctx.beginPath();
        ctx.arc(x, y, ink(2.6) * size, 0, Math.PI * 2);
        ctx.fill();
    };
    /** The path ahead while aiming: dots along the first second of the flight the pull would give, fading toward its end. */
    const dots = (ctx: CanvasRenderingContext2D, field: Field) => {
        const sent = launching();
        if (!sent) return;
        const placed = along(ahead(field, sent.vx, sent.vy), ink(DOTS));
        for (let i = 0; i < placed.length; i += 3) {
            const part = placed[i + 2]!;
            ctx.fillStyle = page("--ink", 0.85 * (1 - part) ** 1.2);
            ctx.beginPath();
            ctx.arc(placed[i]!, placed[i + 1]!, ink(1.7 - 0.6 * part), 0, Math.PI * 2);
            ctx.fill();
        }
    };
    /** The pull: a line from the comet back the way it is pulled, as long as the pull. On the screen, not in the field. */
    const line = (ctx: CanvasRenderingContext2D, field: Field) => {
        const sent = launching();
        if (!sent) return;
        const [cx, cy] = screen(field.start.x, field.start.y);
        const long = DEAD + ((sent.power - WEAKEST) / (1 - WEAKEST)) * (longest() - DEAD);
        ctx.save();
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        ctx.strokeStyle = m.color("--ink");
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
            // the stars follow the comet a little, against its way, and settle where it stops; with less motion asked for they stay put
            const at = cometAt();
            if (at && !reduced) {
                const [sx, sy] = screen(...at);
                want = { x: (sx - m.width / 2) * DRIFT, y: (sy - m.height / 2) * DRIFT };
                // the first field opens with them already in place
                const follow = drifted ? 1 - Math.exp(-FOLLOW * dt) : 1;
                drifted = true;
                drift = { x: drift.x + (want.x - drift.x) * follow, y: drift.y + (want.y - drift.y) * follow };
                if (Math.abs(want.x - drift.x) < 0.02 && Math.abs(want.y - drift.y) < 0.02) drift = { ...want };
            }
        },
        resting: () => !m.preview && phase === "aim" && !pulling && !asked && (!next || next.done !== undefined) && drift.x === want.x && drift.y === want.y,
        debug: () => (made ? [`field ${place.seed} ${level}: ${made.field.planets.length} planets, ${made.wins} winning launches, ${made.tries} tries`, `a way in: aim ${made.solution.aim}, power ${made.solution.power.toFixed(2)}, ${made.solution.window} degrees, ${(made.solution.steps * STEP).toFixed(2)} s`, `${phase} ${age.toFixed(2)}`] : ["making"]),
        draw() {
            const { ctx } = m;
            if (m.debug && made) {
                const [sx, sy] = screen(made.field.start.x, made.field.start.y);
                Object.assign(m.canvas.dataset, { phase, level: String(level), shots: String(shots), aim: String(made.solution.aim), power: String(made.solution.power), start: [sx, sy, longest(), view.upright ? 1 : 0].join(","), toward: String(nearest(made.field.hole.x - made.field.start.x, made.field.hole.y - made.field.start.y)) });
            }
            starry(ctx);
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
                const grow = (x: number, y: number) => ease((t - 0.3 - (Math.hypot(x - field.start.x, y - field.start.y) / WIDE) * 0.25) / 0.45);
                glows(ctx, from, () => gone);
                glows(ctx, field, grow);
                hole(ctx, from.hole.x, from.hole.y, CATCH * gone, gone);
                const opened = grow(field.hole.x, field.hole.y);
                hole(ctx, field.hole.x, field.hole.y, CATCH * opened, opened);
                planets(ctx, from, () => gone);
                planets(ctx, field, grow);
                const [x, y] = cometAt()!;
                head(ctx, field, x, y, [from.hole.x - field.start.x, from.hole.y - field.start.y], ease(t / 0.25));
                ctx.restore();
                return;
            }

            glows(ctx, field, () => 1);
            // the ring takes the comet's weight as it goes in: it gives a little and comes back
            const taken = since >= 0 && !reduced ? Math.sin(Math.PI * Math.min(1, since / GIVE_TIME)) : 0;
            hole(ctx, field.hole.x, field.hole.y, CATCH * (1 - GIVE_DEPTH * taken), 1);
            planets(ctx, field, () => 1);
            missed.forEach((one, at) => trail(ctx, one, 0, KEPT[at]!, false));
            if (phase === "fly" && flying) {
                trail(ctx, path, 0, 1, true);
                head(ctx, field, flying.x, flying.y, [-flying.vx, -flying.vy]);
            } else if (phase === "caught") {
                trail(ctx, path, tail, 1, true);
                if (!caught.gone) head(ctx, field, field.hole.x + caught.x, field.hole.y + caught.y, [caught.x, caught.y], 1 - 0.6 * ease(age / SPIRAL));
            } else if (phase === "aim") {
                if (!m.preview) dots(ctx, field);
                head(ctx, field, field.start.x, field.start.y, [field.start.x - field.hole.x, field.start.y - field.hole.y]);
            }
            ctx.restore();
            if (phase === "aim" && !m.preview) line(ctx, field);
        },
    };
}
