// Comet: pull back, let go, and the comet flies through a field of stars into a black hole. Stars
// pull it and pushers push it; wormholes carry it across. Every launch is a shot; a comet that leaves
// the field, hits a star or flies too long comes back to the start, the scene shakes and the count
// has gone up. Swallowed, it opens the next field, a little harder. The flying is in flight.ts and
// the fields, each proven winnable, in fields.ts; here they are drawn, with glow, and played.
//
// A field is a link: ?seed=…&field=…. The fewest shots for each field of each seed are kept.

import { sounds } from "../mote/sound";
import { el, type Mote, type Scene } from "../mote/stage";
import { copyText } from "../scripts/copy";
import { wholeText } from "./checked";
import { LONGEST_SEED, MOST_LEVEL, begin, bestFor, keptBests, keptRun, make, making, numbers, hash, shoot, win, type Bests, type Made, type Run } from "./fields";
import { AIMS, FASTEST, HIGH, NOTCH, STEP, WEAKEST, WIDE, advance, launch, nearest, velocity, type Comet, type Field } from "./flight";

export const label = "Comet, a game: pull back and let go to send a comet through a field of stars into a black hole.";

/** How much of the flight the dotted line shows while aiming, in steps: about a second. */
const AHEAD = 120;
/** How long the comet's trail is, in steps. */
const TRAIL = 300;
/** A pull shorter than this, in pixels, is a press and not a pull: letting go does nothing. */
const DEAD = 10;
/** How long the capture is watched, the scene shakes, and a new field takes to grow in, in seconds. */
const SWALLOW = 1.5;
const SHAKE = 0.38;
const GROW = 0.9;

const PULLER = "oklch(0.86 0.13 80)";
const PUSHER = "oklch(0.82 0.12 210)";
const PAIRS = ["oklch(0.8 0.15 350)", "oklch(0.86 0.13 160)"];
const MISS = "oklch(0.72 0.17 25)";
const HOT = "oklch(0.97 0.03 300)";

/** Quick to start and slow to settle, as the site's --ease. */
const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 4;

/** A name for a new sky: syllables of the browser's own chance. */
function christen(): string {
    const [hard, soft] = ["bdfgklmnprstvz", "aeiou"];
    const pick = crypto.getRandomValues(new Uint32Array(6));
    return Array.from({ length: 3 }, (_, i) => hard[pick[i * 2]! % hard.length]! + soft[pick[i * 2 + 1]! % soft.length]!).join("");
}

/** A soft round light of one color, drawn once and laid over the scene wherever something glows. */
function halo(color: string): HTMLCanvasElement {
    const canvas = el("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const light = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    light.addColorStop(0, color);
    light.addColorStop(0.12, color.replace(")", " / 0.55)"));
    light.addColorStop(0.35, color.replace(")", " / 0.16)"));
    light.addColorStop(0.7, color.replace(")", " / 0.04)"));
    light.addColorStop(1, color.replace(")", " / 0)"));
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 128, 128);
    return canvas;
}

/** A point of the trail; `gap` breaks the line, where the comet went through a wormhole. */
interface Point {
    x: number;
    y: number;
    gap?: boolean;
}

/** A small flash where something happened: a miss, a wormhole, a capture. */
interface Flash {
    x: number;
    y: number;
    age: number;
    color: string;
    size: number;
}

type Phase = "aim" | "fly" | "swallow" | "between";

export default function comet(m: Mote): Scene {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sound = m.preview ? undefined : sounds(m);
    // what was kept is read back only as sane numbers, so that a damaged store cannot stop the game
    let bests: Bests = keptBests(m.recall<unknown>("comet-bests", {}));

    // ---- which field: the address, or where this visitor left off, or a new sky ----
    const kept = keptRun(m.recall<unknown>("comet-run", null));
    const linked = m.link.get("seed");
    let run: Run = m.preview ? begin("lumen", 6) : linked ? begin(linked.slice(0, LONGEST_SEED), wholeText(m.link.get("field"), 1, MOST_LEVEL, 1)) : kept ?? begin(christen());
    let made: Made = make(run.seed, run.level);
    let field: Field = made.field;
    /** The field before this one, shrinking into its hole while this one grows. */
    let leaving: Field | undefined;
    let grown = still ? GROW : 0;
    /** The next field, being made a little at a time while the loop runs. */
    let next: { level: number; work: Generator<undefined, Made>; done?: Made } | undefined;
    const prepare = () => {
        next = { level: run.level + 1, work: making(run.seed, run.level + 1) };
    };
    prepare();

    let phase: Phase = "aim";
    let flying: Comet | undefined;
    let trail: Point[] = [];
    /** The last miss's path, faint, to aim the next shot by; and how far the trail of a finished flight has faded. */
    let ghost: Point[] = [];
    let fading = 0;
    let flashes: Flash[] = [];
    let shaking = 0;
    let owed = 0;
    let swallowed = 0;
    let bump = 0;
    let born = 1;
    /** The capture: where the comet was taken, and which way round it spirals. */
    let capture = { r: 0, angle: 0, turn: 1, spin: 0 };
    /** How close the comet is to each star, to hear it pass. */
    let closest: number[] = [];

    // ---- aiming ----
    /** A pull with the pointer: where it was pressed and where it is now, in pixels. */
    let pulling: { fromX: number; fromY: number; x: number; y: number } | undefined;
    /** Aiming with the keyboard: a direction from AIMS and a strength in notches. */
    let keyed = false;
    let aim = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
    let notches = 20;

    // ---- the view: the whole field fitted to the canvas, turned upright on a tall screen ----
    let view = { scale: 1, x: 0, y: 0, upright: false, top: 30 };
    const fit = () => {
        const upright = m.height > m.width * 1.05;
        const top = 30;
        const [wide, high] = upright ? [HIGH, WIDE] : [WIDE, HIGH];
        const scale = Math.min((m.width - 24) / wide, (m.height - top - 14) / high);
        view = { scale, upright, top, x: (m.width - wide * scale) / 2, y: top + (m.height - top - 14 - high * scale) / 2 };
        paint();
    };
    /** A place in the field, on the screen. */
    const screen = (x: number, y: number): [number, number] =>
        view.upright ? [view.x + (HIGH - y) * view.scale, view.y + x * view.scale] : [view.x + x * view.scale, view.y + y * view.scale];
    /** A move on the screen, as a move in the field. */
    const inField = (dx: number, dy: number): [number, number] => (view.upright ? [dy / view.scale, -dx / view.scale] : [dx / view.scale, dy / view.scale]);
    const longest = () => Math.max(100, Math.min(170, 0.3 * Math.min(m.width, m.height)));

    /** The launch the current pull or the keyboard would make, as a velocity in the field. */
    const launching = (): [number, number] | undefined => {
        if (pulling) {
            const [dx, dy] = [pulling.fromX - pulling.x, pulling.fromY - pulling.y];
            const long = Math.hypot(dx, dy);
            if (long < DEAD) return undefined;
            const strength = WEAKEST + (1 - WEAKEST) * Math.min(1, (long - DEAD) / (longest() - DEAD));
            const [fx, fy] = inField(dx, dy);
            const unit = Math.hypot(fx, fy);
            return [(fx / unit) * strength * FASTEST, (fy / unit) * strength * FASTEST];
        }
        return keyed ? velocity(aim, notches) : undefined;
    };

    // ---- the sky behind the field: drawn once for each field and size, with the hole's bending of it ----
    const sky = el("canvas");
    let oldSky = el("canvas");
    function paint(): void {
        const scale = window.devicePixelRatio || 1;
        sky.width = Math.max(1, Math.round(m.width * scale));
        sky.height = Math.max(1, Math.round(m.height * scale));
        const ctx = sky.getContext("2d")!;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = m.color("--ground");
        ctx.fillRect(0, 0, m.width, m.height);
        // the stars of the sky follow from the field's seed, so a field always has the same sky
        const random = numbers(hash(`${field.seed}:${field.level}:sky`));
        const [wide, high] = view.upright ? [HIGH, WIDE] : [WIDE, HIGH];
        const [left, top, w, h] = [view.x, view.y, wide * view.scale, high * view.scale];
        ctx.globalCompositeOperation = "lighter";
        for (const [hue, size] of [[300, 0.55], [340, 0.4], [250, 0.45]] as const) {
            const [cx, cy] = [left + random() * w, top + random() * h];
            const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * size);
            cloud.addColorStop(0, `oklch(0.5 0.12 ${hue} / 0.17)`);
            cloud.addColorStop(1, `oklch(0.5 0.12 ${hue} / 0)`);
            ctx.fillStyle = cloud;
            ctx.fillRect(0, 0, m.width, m.height);
        }
        for (let i = 0; i < 220; i++) {
            const [x, y] = [random() * m.width, random() * m.height];
            const inside = x > left && x < left + w && y > top && y < top + h;
            ctx.fillStyle = `oklch(0.92 ${(random() * 0.08).toFixed(3)} ${Math.floor(200 + random() * 160)} / ${((inside ? 0.25 : 0.12) + random() * (inside ? 0.6 : 0.25)).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(x, y, 0.35 + random() ** 3 * 1.3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        // outside the field is a little darker, so its edge, which a comet must not cross, reads
        ctx.fillStyle = "rgb(0 0 0 / 0.28)";
        ctx.beginPath();
        ctx.rect(0, 0, m.width, m.height);
        ctx.roundRect(left, top, w, h, 10);
        ctx.fill("evenodd");
        // the hole bends the light behind it: the sky around it is drawn again, enlarged, so its stars stand back from it
        const [hx, hy] = screen(field.hole.x, field.hole.y);
        const reach = field.hole.radius * view.scale * 4.2;
        const lens = el("canvas");
        lens.width = lens.height = Math.ceil(reach * 2 * scale);
        const bent = lens.getContext("2d")!;
        const take = reach / 2;
        bent.drawImage(sky, (hx - take) * scale, (hy - take) * scale, take * 2 * scale, take * 2 * scale, 0, 0, lens.width, lens.height);
        bent.globalCompositeOperation = "destination-in";
        const fade = bent.createRadialGradient(lens.width / 2, lens.height / 2, 0, lens.width / 2, lens.height / 2, lens.width / 2);
        fade.addColorStop(0.55, "rgb(0 0 0 / 1)");
        fade.addColorStop(1, "rgb(0 0 0 / 0)");
        bent.fillStyle = fade;
        bent.fillRect(0, 0, lens.width, lens.height);
        ctx.drawImage(lens, hx - reach, hy - reach, reach * 2, reach * 2);
        ctx.strokeStyle = m.color("--rule");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(left + 0.5, top + 0.5, w - 1, h - 1, 10);
        ctx.stroke();
    }

    const halos = new Map<string, HTMLCanvasElement>();
    const glow = (color: string) => halos.get(color) ?? (halos.set(color, halo(color)), halos.get(color)!);
    /** A glow of `color` at a place in the field, `size` field units across its brightest part. */
    const shine = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1) => {
        if (alpha <= 0.002 || size <= 0) return;
        ctx.globalAlpha = Math.min(1, alpha);
        const r = size * 4;
        ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
    };

    // ---- the panel under the field ----
    let say = (_words: string) => {};
    let tell = () => {};
    if (!m.preview) {
        const panel = m.panel();
        const said = el("p", { class: "table-said" });
        said.setAttribute("aria-live", "polite");
        const counts = el("p", { class: "comet-counts" });
        const again = el("button", { type: "button", textContent: "try again", onclick: () => retry() });
        const link = el("button", { type: "button", class: "quiet", textContent: "copy link to this field", onclick: () => copyText(link, location.href, { rest: "copy link to this field", done: "copied", failed: "copy it from the address bar" }) });
        const fresh = el("button", { type: "button", class: "quiet", textContent: "new sky", onclick: () => restart(christen(), 1) });
        const first = el("button", { type: "button", class: "quiet", textContent: "back to field 1", onclick: () => restart(run.seed, 1) });
        panel.append(said, counts, el("div", { class: "table-go" }, again, link, fresh, first, sound!.button));
        say = (words) => (said.textContent = words);
        tell = () => {
            const best = bestFor(bests, run.seed, run.level);
            counts.textContent = `${run.shots} ${run.shots === 1 ? "shot" : "shots"} on field ${run.level}${best === undefined ? "" : `, fewest yet ${best}`}. ${run.total} in all over ${run.won + 1} ${run.won === 0 ? "field" : "fields"} of the sky “${run.seed}”.`;
            first.disabled = run.level === 1 && run.shots === 0;
            m.canvas.dataset.level = String(run.level);
            m.canvas.dataset.shots = String(run.shots);
            m.canvas.dataset.total = String(run.total);
            m.canvas.dataset.phase = phase;
        };
    }
    const remember = () => {
        if (m.preview) return;
        m.keep("comet-run", run);
        m.link.set("seed", run.seed);
        m.link.set("field", String(run.level));
    };

    /** A field to play: the one asked for, growing in while the last shrinks into its hole. */
    const arrive = (fresh: Made, from?: Field) => {
        made = fresh;
        leaving = from;
        field = fresh.field;
        grown = still ? GROW : 0;
        [phase, flying, trail, ghost, flashes, swallowed] = ["aim", undefined, [], [], [], 0];
        aim = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
        if (!still) oldSky = copy(sky);
        paint();
        prepare();
        remember();
        tell();
        say(`Field ${run.level}. Pull back and let go.`);
        m.wake();
    };
    const copy = (from: HTMLCanvasElement) => {
        const into = el("canvas");
        into.width = from.width;
        into.height = from.height;
        into.getContext("2d")!.drawImage(from, 0, 0);
        return into;
    };
    const restart = (seed: string, level: number) => {
        run = begin(seed, level);
        arrive(make(seed, level), field);
    };

    /** The comet back at the start, ready for another shot. */
    const home = () => {
        phase = "aim";
        flying = undefined;
        born = 0;
        m.canvas.dataset.phase = phase;
    };
    /** A shot that did not reach the hole. */
    const miss = (how: string) => {
        const end = trail[trail.length - 1] ?? field.start;
        flashes.push({ x: end.x, y: end.y, age: 0, color: MISS, size: 14 });
        ghost = trail.filter((_, at) => at % 3 === 0);
        fading = 1;
        if (!still) shaking = SHAKE;
        sound?.knock(0.9, 160);
        sound?.tone(62, 0.3, 0.16);
        home();
        say(how);
        tell();
    };
    const retry = () => {
        if (phase === "fly") miss("Back to the start.");
        else if (phase === "aim") {
            pulling = undefined;
            m.wake();
        }
    };
    const shot = (vx: number, vy: number) => {
        if (phase !== "aim") return;
        run = shoot(run);
        flying = launch(field, vx, vy);
        trail = [{ x: field.start.x, y: field.start.y }];
        closest = field.stars.map(() => Infinity);
        [phase, owed, fading, bump] = ["fly", 0, 0, 1];
        remember();
        tell();
        say(`Shot ${run.shots}.`);
        m.wake();
    };

    /** One step of the flight, and what it meets. */
    const onward = () => {
        const comet = flying!;
        const [px, py] = [comet.x, comet.y];
        advance(field, comet);
        if (comet.through !== undefined) {
            const gate = field.gates[comet.through]!;
            const other = field.gates[gate.to]!;
            trail.push({ x: px, y: py }, { x: other.x, y: other.y, gap: true }, { x: comet.x, y: comet.y, gap: true });
            flashes.push({ x: other.x, y: other.y, age: 0, color: PAIRS[gate.pair % 2]!, size: 20 }, { x: gate.x, y: gate.y, age: 0, color: PAIRS[gate.pair % 2]!, size: 20 });
            sound?.glide(420, 900, 0.25, 0.06);
        } else trail.push({ x: comet.x, y: comet.y });
        if (trail.length > TRAIL) trail.splice(0, trail.length - TRAIL);
        // a tone that rises as the comet swings past a star, higher the faster it goes
        field.stars.forEach((star, at) => {
            const near = Math.hypot(comet.x - star.x, comet.y - star.y);
            if (near > closest[at]! && closest[at]! < star.radius * 3.2 && closest[at]! > 0) {
                const speed = Math.hypot(comet.vx, comet.vy);
                const pitch = 260 + speed * 0.7;
                sound?.glide(pitch, pitch * 1.35, 0.35, star.mass > 0 ? 0.05 : 0.04);
                closest[at] = -1;
            } else if (closest[at]! >= 0) closest[at] = Math.min(closest[at]!, near);
        });
        if (!comet.ended) return;
        if (comet.ended === "won") {
            phase = "swallow";
            const [dx, dy] = [comet.x - field.hole.x, comet.y - field.hole.y];
            const r = Math.hypot(dx, dy);
            const across = (dx * comet.vy - dy * comet.vx) / (r || 1);
            capture = { r, angle: Math.atan2(dy, dx), turn: Math.sign(across) || 1, spin: Math.min(14, Math.abs(across) / Math.max(1, r)) };
            swallowed = 0;
            sound?.glide(190, 38, 1.1, 0.2);
            sound?.tone(55, 1.2, 0.08);
            const best = bestFor(bests, run.seed, run.level);
            say(`Swallowed in ${run.shots} ${run.shots === 1 ? "shot" : "shots"}${best !== undefined && run.shots < best ? ", fewer than before" : ""}.`);
            m.canvas.dataset.phase = phase;
            return;
        }
        if (comet.ended === "struck") {
            const star = field.stars[comet.star!]!;
            miss(star.mass > 0 ? "Into a star. Again." : "Into a pusher. Again.");
        } else miss(comet.ended === "out" ? "Out of the field. Again." : "Lost in orbit. Again.");
    };

    // ---- the keyboard: arrows aim and set strength, Enter or Space launches, R tries again, Escape lets go ----
    if (!m.preview) {
        m.canvas.addEventListener("keydown", (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const by = (event.shiftKey ? 10 : 1) * (event.repeat ? 2 : 1);
            const key = event.key;
            if (key === "Escape" && pulling) pulling = undefined;
            else if (key === "r" || key === "R") retry();
            else if (key === "ArrowLeft" || key === "ArrowRight") {
                keyed = true;
                aim += key === "ArrowLeft" ? -by : by;
            } else if (key === "ArrowUp" || key === "ArrowDown") {
                keyed = true;
                notches = Math.max(WEAKEST / NOTCH, Math.min(1 / NOTCH, notches + (key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 4 : 1)));
            } else if ((key === "Enter" || key === " ") && !event.repeat) {
                if (!keyed) keyed = true;
                else shot(...velocity(aim, notches));
            } else return;
            m.wake();
        });
    }

    paint();
    fit();
    tell();
    say(`Field ${run.level}. Pull back and let go.`);
    if (!m.preview) remember();

    /** Shown small in the list, it plays its own winning shot now and then. */
    let auto = 0;

    // ---- drawing ----
    const drawStar = (ctx: CanvasRenderingContext2D, star: Field["stars"][number], size: number, time: number) => {
        const pushes = star.mass < 0;
        const color = pushes ? PUSHER : PULLER;
        const r = star.radius * size;
        if (r <= 0.1) return;
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, star.x, star.y, r * 1.1, color, 0.75);
        // which way it moves things: rings and marks that flow in toward a star and out from a pusher
        const flow = still ? 0.5 : (time * 0.45 + star.x * 0.001) % 1;
        ctx.strokeStyle = color;
        for (let ring = 0; ring < 3; ring++) {
            const t = (flow + ring / 3) % 1;
            const along = pushes ? t : 1 - t;
            const rr = r * (1.35 + along * 1.5);
            ctx.globalAlpha = Math.sin(t * Math.PI) * 0.22 * size;
            ctx.lineWidth = 1.2 / view.scale;
            ctx.beginPath();
            ctx.arc(star.x, star.y, rr, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 0.75 * size;
        ctx.lineWidth = 1.6 / view.scale;
        ctx.lineCap = "round";
        const marks = 6;
        const mark = Math.max(3.2 / view.scale, r * 0.22);
        for (let i = 0; i < marks; i++) {
            const angle = (i / marks) * Math.PI * 2 + star.y * 0.01;
            const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
            const at = r * 1.75;
            // a chevron whose point is toward the way it moves things
            const tip = pushes ? at + mark * 0.5 : at - mark * 0.5;
            const back = pushes ? at - mark * 0.5 : at + mark * 0.5;
            ctx.beginPath();
            ctx.moveTo(star.x + ux * back - uy * mark * 0.6, star.y + uy * back + ux * mark * 0.6);
            ctx.lineTo(star.x + ux * tip, star.y + uy * tip);
            ctx.lineTo(star.x + ux * back + uy * mark * 0.6, star.y + uy * back - ux * mark * 0.6);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        // the body: a star is a bright full ball; a pusher a hard bright rim around a dark middle
        const body = ctx.createRadialGradient(star.x - r * 0.25, star.y - r * 0.25, 0, star.x, star.y, r);
        if (pushes) {
            body.addColorStop(0, "oklch(0.25 0.05 220)");
            body.addColorStop(0.62, "oklch(0.32 0.07 215)");
            body.addColorStop(0.86, color);
            body.addColorStop(1, HOT);
        } else {
            body.addColorStop(0, HOT);
            body.addColorStop(0.45, "oklch(0.93 0.09 85)");
            body.addColorStop(1, color);
        }
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(star.x, star.y, r, 0, Math.PI * 2);
        ctx.fill();
    };

    const drawGate = (ctx: CanvasRenderingContext2D, gate: Field["gates"][number], size: number, time: number) => {
        const color = PAIRS[gate.pair % 2]!;
        const r = gate.radius * size;
        if (r <= 0.1) return;
        ctx.fillStyle = "oklch(0.1 0.03 300)";
        ctx.beginPath();
        ctx.arc(gate.x, gate.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, gate.x, gate.y, r * 1.1, color, 0.55);
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        // the two mouths of a pair turn opposite ways, one drawing in and one letting out
        const turn = still ? 0 : time * 1.6 * (gate.to % 2 ? 1 : -1);
        for (let arm = 0; arm < 3; arm++) {
            const start = turn + (arm / 3) * Math.PI * 2;
            for (let piece = 0; piece < 6; piece++) {
                // each arm a spiral drawn in pieces, brighter toward the rim
                const a = start + piece * 0.32;
                const rr = r * (0.35 + piece * 0.13);
                ctx.globalAlpha = 0.25 + piece * 0.12;
                ctx.lineWidth = (0.8 + piece * 0.35) / view.scale;
                ctx.beginPath();
                ctx.arc(gate.x, gate.y, rr, a, a + 0.5);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 1.6 / view.scale;
        ctx.beginPath();
        ctx.arc(gate.x, gate.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    };

    const drawHole = (ctx: CanvasRenderingContext2D, of: Field, size: number, time: number, flare: number) => {
        const hole = of.hole;
        const r = hole.radius * size;
        if (r <= 0.1) return;
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, hole.x, hole.y, r * 2.2, "oklch(0.77 0.16 300)", 0.55 + flare * 0.8);
        // the disc of matter going round it: arcs that circle, the inner ones faster and hotter
        const turn = still ? 0.6 : time;
        ctx.lineCap = "round";
        for (let i = 0; i < 22; i++) {
            const out = (i * 0.618) % 1;
            const a = turn * (1.6 - out) + i * 2.399;
            const rr = r * (1.2 + out * 1.9);
            ctx.strokeStyle = out < 0.3 ? HOT : out < 0.65 ? "oklch(0.8 0.15 315)" : "oklch(0.7 0.16 290)";
            ctx.globalAlpha = (0.5 - out * 0.35) * size * (1 + flare);
            ctx.lineWidth = (1.1 + (1 - out) * 1.4) / view.scale;
            ctx.beginPath();
            ctx.arc(hole.x, hole.y, rr, a, a + 0.5 + ((i * 0.37) % 1) * 1.2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        // where it takes a comet: a faint dotted line at its reach
        ctx.strokeStyle = "oklch(0.77 0.16 300 / 0.35)";
        ctx.setLineDash([2 / view.scale, 5 / view.scale]);
        ctx.lineWidth = 1 / view.scale;
        ctx.beginPath();
        ctx.arc(hole.x, hole.y, hole.reach * size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // the dark disc, and the thin bright ring of light bent round its edge
        ctx.fillStyle = "oklch(0.06 0.02 300)";
        ctx.beginPath();
        ctx.arc(hole.x, hole.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = HOT;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = (1.6 + flare * 2) / view.scale;
        ctx.beginPath();
        ctx.arc(hole.x, hole.y, r * 1.06, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    };

    /** A trail of points as a line that fades and thins toward its tail. */
    const drawTrail = (ctx: CanvasRenderingContext2D, points: Point[], alpha: number) => {
        if (points.length < 2 || alpha <= 0) return;
        ctx.globalCompositeOperation = "lighter";
        // pieces meet end to end with square ends: round ends would overlap and, added together, show as beads
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        const pieces = 48;
        const each = Math.max(1, Math.ceil(points.length / pieces));
        for (const pass of [0, 1]) {
            for (let from = 0; from < points.length - 1; from += each) {
                const t = (from + each / 2) / points.length;
                const fade = t ** 1.6 * alpha;
                ctx.strokeStyle = pass === 0 ? "oklch(0.75 0.16 320)" : t > 0.8 ? HOT : "oklch(0.85 0.1 300)";
                ctx.globalAlpha = pass === 0 ? fade * 0.3 : fade;
                ctx.lineWidth = ((pass === 0 ? 12 : 3) * (0.2 + t * 0.8)) / view.scale;
                ctx.beginPath();
                ctx.moveTo(points[from]!.x, points[from]!.y);
                for (let i = from + 1; i <= Math.min(points.length - 1, from + each); i++) {
                    if (points[i]!.gap) ctx.moveTo(points[i]!.x, points[i]!.y);
                    else ctx.lineTo(points[i]!.x, points[i]!.y);
                }
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    };

    const drawHead = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, x, y, (8 / view.scale) * size, "oklch(0.85 0.12 320)", 0.9);
        shine(ctx, x, y, (3 / view.scale) * size, HOT, 1);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(x, y, (3 / view.scale) * size, 0, Math.PI * 2);
        ctx.fill();
    };

    /** The pull: a band from the comet that stretches with the pull, and a dotted line along the first second of the flight. */
    const drawAim = (ctx: CanvasRenderingContext2D) => {
        const sent = launching();
        if (!sent) return;
        const strength = Math.hypot(...sent) / FASTEST;
        // the dotted line, worked out with the flight's own steps
        const ahead = launch(field, sent[0], sent[1]);
        ctx.globalCompositeOperation = "lighter";
        for (let i = 1; i <= AHEAD && !ahead.ended; i++) {
            advance(field, ahead);
            if (ahead.through !== undefined) break;
            if (i % 6) continue;
            const t = i / AHEAD;
            ctx.globalAlpha = 0.95 * (1 - t) ** 1.3;
            ctx.fillStyle = HOT;
            ctx.beginPath();
            ctx.arc(ahead.x, ahead.y, (2.3 - t * 1.3) / view.scale, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        // the band, on the screen: from the comet back the way it is pulled
        const [cx, cy] = screen(field.start.x, field.start.y);
        let [bx, by] = pulling ? [pulling.x - pulling.fromX, pulling.y - pulling.fromY] : [0, 0];
        if (!pulling) {
            const [ax, ay] = AIMS[((aim % 720) + 720) % 720]!;
            // the band points away from where the comet will go, on the screen as it is turned
            [bx, by] = view.upright ? [ay, -ax] : [-ax, -ay];
        }
        const unit = Math.hypot(bx, by) || 1;
        const reach = DEAD + (strength - WEAKEST) / (1 - WEAKEST) * (longest() - DEAD) + 14;
        const [ex, ey] = [cx + (bx / unit) * reach, cy + (by / unit) * reach];
        const [nx, ny] = [-by / unit, bx / unit];
        // thinner the further it is stretched, and hotter
        const thick = 7 - strength * 4;
        ctx.save();
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        ctx.translate(offset.x, offset.y);
        ctx.strokeStyle = m.color("--rule");
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.arc(cx, cy, longest() + 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const band = ctx.createLinearGradient(cx, cy, ex, ey);
        band.addColorStop(0, m.color("--accent"));
        band.addColorStop(1, strength > 0.85 ? HOT : "oklch(0.85 0.12 330)");
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "oklch(0.75 0.16 320 / 0.25)";
        ctx.lineWidth = thick * 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = band;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx + nx * thick, cy + ny * thick);
        ctx.lineTo(ex + nx * 1.2, ey + ny * 1.2);
        ctx.lineTo(ex - nx * 1.2, ey - ny * 1.2);
        ctx.lineTo(cx - nx * thick, cy - ny * thick);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = HOT;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };

    let offset = { x: 0, y: 0 };
    let clock = 0;

    return {
        resize: fit,
        press(x, y) {
            if (m.preview || phase !== "aim") return;
            keyed = false;
            pulling = { fromX: x, fromY: y, x, y };
        },
        move(x, y) {
            if (!pulling) return;
            pulling.x = x;
            pulling.y = y;
        },
        release(x, y) {
            if (!pulling) return;
            pulling.x = x;
            pulling.y = y;
            const sent = launching();
            pulling = undefined;
            if (sent) shot(...sent);
        },
        step(dt) {
            clock += dt;
            grown = Math.min(GROW, grown + dt);
            born = Math.min(1, born + dt / 0.3);
            bump = Math.max(0, bump - dt * 2.5);
            shaking = Math.max(0, shaking - dt);
            fading = Math.max(0, fading - dt / 1.2);
            flashes = flashes.filter((flash) => (flash.age += dt) < 0.7);
            if (grown >= GROW) leaving = undefined;
            // the next field is made a little at a time, in what is left of each frame's time
            if (next && !next.done) {
                const until = performance.now() + (phase === "between" ? 10 : 3);
                while (performance.now() < until) {
                    const piece = next.work.next();
                    if (piece.done) {
                        next.done = piece.value;
                        break;
                    }
                }
            }
            if (m.preview && phase === "aim" && grown >= GROW && (auto += dt) > 1.2) {
                auto = 0;
                const sent = velocity(made.solution.aim, made.solution.notches);
                run = shoot(run);
                flying = launch(field, sent[0], sent[1]);
                trail = [{ x: field.start.x, y: field.start.y }];
                closest = field.stars.map(() => Infinity);
                phase = "fly";
            }
            if (phase === "fly" && flying) {
                // time runs slower as the comet nears the hole, so the capture can be watched
                const near = Math.hypot(flying.x - field.hole.x, flying.y - field.hole.y);
                const slow = still ? 1 : 1 - 0.62 * Math.max(0, 1 - (near - field.hole.reach) / (field.hole.reach * 5));
                owed += dt * slow;
                while (owed >= STEP && phase === "fly") {
                    owed -= STEP;
                    onward();
                }
            } else if (phase === "swallow") {
                swallowed += dt / (still ? 0.4 : SWALLOW);
                // the comet spirals in, faster and faster, and the trail follows it round
                const t = Math.min(1, swallowed);
                const r = capture.r * (1 - ease(t * 1.05)) ;
                const angle = capture.angle + capture.turn * (capture.spin * t * 0.9 + t * t * 9);
                trail.push({ x: field.hole.x + Math.cos(angle) * Math.max(0, r), y: field.hole.y + Math.sin(angle) * Math.max(0, r) });
                if (trail.length > TRAIL) trail.splice(0, trail.length - TRAIL);
                if (swallowed >= 1) {
                    const result = win(run, bests);
                    run = result.run;
                    bests = result.bests;
                    if (!m.preview) m.keep("comet-bests", bests);
                    flashes.push({ x: field.hole.x, y: field.hole.y, age: 0, color: HOT, size: field.hole.radius * 2 });
                    ghost = [];
                    fading = 1;
                    phase = "between";
                    swallowed = 0;
                }
            } else if (phase === "between") {
                swallowed += dt;
                if (m.preview && swallowed > 0.8) {
                    // shown small, the same field plays again
                    run = begin(run.seed, run.level - 1);
                    [phase, trail, swallowed] = ["aim", [], 0];
                    born = 0;
                } else if (next?.done && swallowed > 0.6) arrive(next.done, field);
            }
            offset = shaking > 0 ? { x: Math.sin(shaking * 90) * 7 * (shaking / SHAKE) ** 2, y: Math.cos(shaking * 73) * 5 * (shaking / SHAKE) ** 2 } : { x: 0, y: 0 };
        },
        resting() {
            const busy = phase !== "aim" || pulling !== undefined || shaking > 0 || flashes.length > 0 || grown < GROW || born < 1 || bump > 0 || fading > 0;
            // the rings and spirals turn only while someone is here to see them
            return !busy && !m.preview && (still || !m.pointer.inside) && (!next || next.done !== undefined);
        },
        debug: () => [`field ${run.seed} ${run.level}: ${field.stars.length} stars, ${field.gates.length / 2} pairs, made in ${made.tries} tries`, `a way in: aim ${made.solution.aim}, ${made.solution.notches} notches, ${made.solution.window} degrees`, `${phase}${flying ? ` ${flying.time.toFixed(2)} s` : ""}, next ${next?.done ? "ready" : "being made"}`],
        draw() {
            const { ctx } = m;
            const scale = window.devicePixelRatio || 1;
            if (m.debug) {
                m.canvas.dataset.aim = String(made.solution.aim);
                m.canvas.dataset.notches = String(made.solution.notches);
            }
            ctx.save();
            ctx.translate(offset.x, offset.y);
            const appear = ease(grown / GROW);
            if (oldSky.width > 1 && appear < 1) {
                ctx.drawImage(oldSky, 0, 0, m.width, m.height);
                ctx.globalAlpha = appear;
            }
            ctx.drawImage(sky, 0, 0, m.width, m.height);
            ctx.globalAlpha = 1;
            // into the field's own units
            ctx.translate(view.x, view.y);
            if (view.upright) {
                ctx.translate(HIGH * view.scale, 0);
                ctx.rotate(Math.PI / 2);
            }
            ctx.scale(view.scale, view.scale);
            // the field before, drawn into its hole as it goes
            if (leaving) {
                const gone = ease(grown / (GROW * 0.8));
                const toward = (x: number, y: number): [number, number] => [x + (leaving!.hole.x - x) * gone, y + (leaving!.hole.y - y) * gone];
                for (const star of leaving.stars) drawStar(ctx, { ...star, ...xy(toward(star.x, star.y)) }, 1 - gone, clock);
                for (const gate of leaving.gates) drawGate(ctx, { ...gate, ...xy(toward(gate.x, gate.y)) }, 1 - gone, clock);
                drawHole(ctx, leaving, 1 - gone, clock, 0);
            }
            // each thing grows in, the nearer the start the sooner
            const size = (x: number, y: number) => (still ? 1 : ease((grown - 0.15 - (Math.hypot(x - field.start.x, y - field.start.y) / WIDE) * 0.35) / 0.45));
            const flare = phase === "swallow" ? swallowed : phase === "between" ? Math.max(0, 1 - swallowed * 2) : 0;
            drawHole(ctx, field, size(field.hole.x, field.hole.y), clock, flare);
            for (const gate of field.gates) drawGate(ctx, gate, size(gate.x, gate.y), clock);
            for (const star of field.stars) drawStar(ctx, star, size(star.x, star.y), clock);
            // the last miss, faint, and the trail of the flight
            if (ghost.length > 1) {
                ctx.fillStyle = "oklch(0.8 0.08 300 / 0.28)";
                for (const point of ghost) {
                    ctx.beginPath();
                    ctx.arc(point.x, point.y, 1.1 / view.scale, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            drawTrail(ctx, trail, phase === "aim" ? fading : phase === "between" ? fading : 1);
            // the start, where the comet waits
            ctx.strokeStyle = "oklch(0.77 0.16 300 / 0.4)";
            ctx.lineWidth = 1 / view.scale;
            ctx.beginPath();
            ctx.arc(field.start.x, field.start.y, 9 / view.scale, 0, Math.PI * 2);
            ctx.stroke();
            if (phase === "fly" && flying) drawHead(ctx, flying.x, flying.y, 1);
            else if (phase === "swallow") {
                const last = trail[trail.length - 1]!;
                drawHead(ctx, last.x, last.y, 1 - ease(swallowed) * 0.8);
            } else if (phase === "aim") drawHead(ctx, field.start.x, field.start.y, ease(born) * size(field.start.x, field.start.y) * (1 + (still ? 0 : Math.sin(clock * 3) * 0.06)));
            for (const flash of flashes) {
                const t = flash.age / 0.7;
                ctx.globalCompositeOperation = "lighter";
                shine(ctx, flash.x, flash.y, flash.size * (0.6 + t), flash.color, (1 - t) * 0.9);
                ctx.strokeStyle = flash.color;
                ctx.globalAlpha = 1 - t;
                ctx.lineWidth = 2 / view.scale;
                ctx.beginPath();
                ctx.arc(flash.x, flash.y, flash.size * (0.4 + ease(t) * 1.6), 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = "source-over";
            }
            if (phase === "aim" && !m.preview && grown >= GROW * 0.6) drawAim(ctx);
            ctx.restore();
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            if (m.preview) return;
            // above the field: which field, and the shots on it
            ctx.font = `600 15px ${font}`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = m.color("--muted");
            ctx.textAlign = "left";
            ctx.fillText(`field ${run.level}`, view.x + 2, view.top / 2 + 2);
            ctx.textAlign = "right";
            const best = bestFor(bests, run.seed, run.level);
            const words = best === undefined ? "" : `   fewest ${best}`;
            ctx.fillText(words, m.width - view.x - 2, view.top / 2 + 2);
            const shotsAt = m.width - view.x - 2 - ctx.measureText(words).width;
            ctx.save();
            ctx.translate(shotsAt, view.top / 2 + 2);
            ctx.scale(1 + bump * 0.35, 1 + bump * 0.35);
            ctx.fillStyle = bump > 0 ? m.color("--accent") : m.color("--ink");
            ctx.fillText(`${run.shots} ${run.shots === 1 ? "shot" : "shots"}`, 0, 0);
            ctx.restore();
        },
    };
}

const xy = ([x, y]: [number, number]) => ({ x, y });
/** The site's heading face, for the words over the field. */
const font = typeof document === "undefined" ? "serif" : getComputedStyle(document.documentElement).getPropertyValue("--font-head").trim() || "serif";
