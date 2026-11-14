// Comet: pull back, let go, and the comet flies through a field into a black hole. Stars pull it and
// pushers push it, each only within the glow drawn round it; the hole pulls hardest, close in, and
// grips what comes near so that it spirals in. Clouds slow the comet, rings speed it up, walls bounce
// it, wormholes carry it across, and sparks can be picked up on the way. Planets, moons and rocks
// move by the flight's clock, which starts at the launch, so each try is the same puzzle: while
// aiming, each moving thing is drawn where it is at the launch, with its way marked at every second.
// Every launch is a shot; a comet that leaves the field, hits something solid or flies too long is
// back at the start at once, the scene shakes and the count has gone up. Swallowed, it opens the next
// field. The flying is in flight.ts and the fields, each proven winnable, in fields.ts; here they are
// drawn, with glow, and played.
//
// The field is one shape, wider than high, fitted whole to the canvas, and turned on its side on a
// tall screen, so a seed is the same puzzle on a phone and a desktop. A field is a link:
// ?seed=…&field=…. The fewest shots for each field of each seed are kept.

import { sounds } from "../mote/sound";
import { el, type Mote, type Scene } from "../mote/stage";
import { copyText } from "../scripts/copy";
import { wholeText } from "./checked";
import { LONGEST_SEED, MOST_LEVEL, begin, bestFor, keptBests, keptRun, kindOf, kindsIn, making, numbers, hash, plan, shoot, win, type Bests, type Kind, type Made, type Run } from "./fields";
import { AIMS, FASTEST, HIGH, NOTCH, STEP, WEAKEST, WIDE, advance, launch, nearest, velocity, where, type Body, type Comet, type Field, type Gate, type Path, type Round, type Wall } from "./flight";

export const label = "Comet, a game: pull back and let go to send a comet through a field of stars into a black hole.";

/** How much of the flight the dotted line shows while aiming, in steps: under a second, enough to aim by and not to solve by. */
const AHEAD = 96;
/** How long the comet's trail is, in steps. */
const TRAIL = 420;
/** A pull shorter than this, in pixels, is a press and not a pull: letting go does nothing. */
const DEAD = 10;
/** How long the capture is watched, the scene shakes, and a new field takes to grow in, in seconds. */
const SWALLOW = 1.1;
const SHAKE = 0.3;
const GROW = 0.9;
/** How many seconds of a moving thing's way are marked while aiming. */
const MARKED = 8;

const PULLER = "oklch(0.86 0.13 80)";
const PUSHER = "oklch(0.82 0.12 210)";
const ROCK = "oklch(0.72 0.03 60)";
const CLOUD = "oklch(0.8 0.06 185)";
const RING = "oklch(0.87 0.16 145)";
const WALL = "oklch(0.93 0.04 260)";
const SPARK = "oklch(0.96 0.09 100)";
const PAIRS = ["oklch(0.8 0.15 350)", "oklch(0.86 0.13 160)"];
const MISS = "oklch(0.72 0.17 25)";
const HOT = "oklch(0.97 0.03 300)";
const HOLE = "oklch(0.77 0.16 300)";

/** What each kind of thing does, said once, on the field where it is first met. */
const RULES: Record<Kind, string> = {
    star: "a star pulls, within its glow",
    spark: "sparks to pick up on the way",
    pusher: "a pusher pushes, within its glow",
    cloud: "a cloud slows the comet",
    ring: "a ring speeds it up",
    wall: "a wall bounces it",
    wormhole: "in one mouth, out of the other",
    planet: "a planet goes round as you fly",
    rock: "rocks drift as you fly",
    moon: "a moon goes round its star",
    "wandering hole": "the hole wanders as you fly",
};

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

/**
 * A light that is as bright, at each distance, as the pull is felt there: brightest at the thing and
 * gone exactly at its reach, following the same fading as the pull in flight.ts. Drawn once for each
 * color, at a size of 1, and stretched to each thing's reach.
 */
function reachLight(color: string): HTMLCanvasElement {
    const canvas = el("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const light = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (let i = 0; i <= 10; i++) {
        const out = i / 10;
        const fade = (1 - out * out) ** 2;
        light.addColorStop(out, color.replace(")", ` / ${(fade * 0.3).toFixed(3)})`));
    }
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 256, 256);
    return canvas;
}

/** A point of the trail; `gap` breaks the line, where the comet went through a wormhole. */
interface Point {
    x: number;
    y: number;
    gap?: boolean;
    /** The step of the flight it was at, to mark each second on a missed shot's ghost. */
    step?: number;
}

/** A small flash where something happened: a miss, a wormhole, a ring, a spark, a capture. */
interface Flash {
    x: number;
    y: number;
    age: number;
    color: string;
    size: number;
}

type Phase = "making" | "aim" | "fly" | "swallow" | "between";

export default function comet(m: Mote): Scene {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sound = m.preview ? undefined : sounds(m);
    // What was kept is read back only as sane numbers, so that a damaged store cannot stop the game.
    // The bests are kept under a second version: those from before fields were made round ideas were
    // for other fields of the same name.
    let bests: Bests = keptBests(m.recall<unknown>("comet-bests", {}, 2));

    // ---- which field: the address, or where this visitor left off, or a new sky ----
    const kept = keptRun(m.recall<unknown>("comet-run", null));
    const linked = m.link.get("seed");
    let run: Run = m.preview ? begin("lumen", 8) : linked ? begin(linked.slice(0, LONGEST_SEED), wholeText(m.link.get("field"), 1, MOST_LEVEL, 1)) : kept ?? begin(christen());
    let made: Made | undefined;
    let field: Field | undefined;
    /** The field asked for now (the first, or another sky), being made a little at a time while the page waits. */
    let asked: Generator<undefined, Made> | undefined = making(run.seed, run.level);
    /** The field before this one, shrinking into its hole while this one grows. */
    let leaving: Field | undefined;
    let grown = still ? GROW : 0;
    /** The next field, being made a little at a time while this one is played. */
    let next: { level: number; work: Generator<undefined, Made>; done?: Made } | undefined;
    const prepare = () => {
        next = { level: run.level + 1, work: making(run.seed, run.level + 1) };
    };

    let phase: Phase = "making";
    let flying: Comet | undefined;
    /** The step the moving things are drawn at: the flight's, or 0 while aiming. */
    let shown = 0;
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
    /** Sparks picked up on this shot, one bit each, and when each was. */
    let picked = 0;
    /** The capture: where the comet was taken, and which way round it spirals. */
    let capture = { r: 0, angle: 0, turn: 1, spin: 0 };
    /** How close the comet is to each body, to hear it pass. */
    let closest: number[] = [];
    /** Whether the rule of the kind this field brings is shown: until the first shot on it. */
    let teaching = true;

    // ---- aiming ----
    /** A pull with the pointer: where it was pressed and where it is now, in pixels. */
    let pulling: { fromX: number; fromY: number; x: number; y: number } | undefined;
    /** Aiming with the keyboard: a direction from AIMS and a strength in notches. */
    let keyed = false;
    let aim = 0;
    let notches = 20;

    // ---- the view: the whole field fitted to the canvas, turned upright on a tall screen ----
    let view = { scale: 1, x: 0, y: 0, upright: false, top: 30 };
    const fit = () => {
        const upright = m.height > m.width * 1.05;
        const top = m.preview ? 4 : 30;
        const [wide, high] = upright ? [HIGH, WIDE] : [WIDE, HIGH];
        const scale = Math.min((m.width - 16) / wide, (m.height - top - 8) / high);
        view = { scale, upright, top, x: (m.width - wide * scale) / 2, y: top + (m.height - top - 8 - high * scale) / 2 };
        paint();
    };
    /** A place in the field, on the screen. */
    const screen = (x: number, y: number): [number, number] =>
        view.upright ? [view.x + (HIGH - y) * view.scale, view.y + x * view.scale] : [view.x + x * view.scale, view.y + y * view.scale];
    /** A move on the screen, as a move in the field. */
    const inField = (dx: number, dy: number): [number, number] => (view.upright ? [dy / view.scale, -dx / view.scale] : [dx / view.scale, dy / view.scale]);
    /** How long a full pull is, in pixels: long enough to aim finely by hand. */
    const longest = () => Math.max(110, Math.min(240, 0.32 * Math.min(m.width, m.height)));

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
        const random = numbers(hash(`${run.seed}:${field?.level ?? run.level}:sky`));
        const [wide, high] = view.upright ? [HIGH, WIDE] : [WIDE, HIGH];
        const [left, top, w, h] = [view.x, view.y, wide * view.scale, high * view.scale];
        ctx.globalCompositeOperation = "lighter";
        for (const [hue, size] of [[300, 0.55], [340, 0.4], [250, 0.45]] as const) {
            const [cx, cy] = [left + random() * w, top + random() * h];
            const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * size);
            cloud.addColorStop(0, `oklch(0.5 0.12 ${hue} / 0.14)`);
            cloud.addColorStop(1, `oklch(0.5 0.12 ${hue} / 0)`);
            ctx.fillStyle = cloud;
            ctx.fillRect(0, 0, m.width, m.height);
        }
        for (let i = 0; i < 320; i++) {
            const [x, y] = [random() * m.width, random() * m.height];
            const inside = x > left && x < left + w && y > top && y < top + h;
            ctx.fillStyle = `oklch(0.92 ${(random() * 0.08).toFixed(3)} ${Math.floor(200 + random() * 160)} / ${((inside ? 0.2 : 0.1) + random() * (inside ? 0.5 : 0.2)).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(x, y, 0.35 + random() ** 3 * 1.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        // outside the field is a little darker, so its edge, which a comet must not cross, reads
        ctx.fillStyle = "rgb(0 0 0 / 0.28)";
        ctx.beginPath();
        ctx.rect(0, 0, m.width, m.height);
        ctx.roundRect(left, top, w, h, 10);
        ctx.fill("evenodd");
        // a hole that stays put bends the light behind it: the sky within its reach is drawn again, enlarged, so its stars stand back from it
        if (field && !field.hole.path) {
            const [hx, hy] = screen(field.hole.x, field.hole.y);
            const reach = field.hole.reach * view.scale;
            const lens = el("canvas");
            lens.width = lens.height = Math.max(1, Math.ceil(reach * 2 * scale));
            const bent = lens.getContext("2d")!;
            const take = reach / 2;
            bent.drawImage(sky, (hx - take) * scale, (hy - take) * scale, take * 2 * scale, take * 2 * scale, 0, 0, lens.width, lens.height);
            bent.globalCompositeOperation = "destination-in";
            const fade = bent.createRadialGradient(lens.width / 2, lens.height / 2, 0, lens.width / 2, lens.height / 2, lens.width / 2);
            fade.addColorStop(0.5, "rgb(0 0 0 / 1)");
            fade.addColorStop(1, "rgb(0 0 0 / 0)");
            bent.fillStyle = fade;
            bent.fillRect(0, 0, lens.width, lens.height);
            ctx.drawImage(lens, hx - reach, hy - reach, reach * 2, reach * 2);
        }
        ctx.strokeStyle = m.color("--rule");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(left + 0.5, top + 0.5, w - 1, h - 1, 10);
        ctx.stroke();
    }

    const halos = new Map<string, HTMLCanvasElement>();
    const glow = (color: string) => halos.get(color) ?? (halos.set(color, halo(color)), halos.get(color)!);
    const reaches = new Map<string, HTMLCanvasElement>();
    const reachOf = (color: string) => reaches.get(color) ?? (reaches.set(color, reachLight(color)), reaches.get(color)!);
    /** A glow of `color` at a place in the field, `size` field units across its brightest part. */
    const shine = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1) => {
        if (alpha <= 0.002 || size <= 0) return;
        ctx.globalAlpha = Math.min(1, alpha);
        const r = size * 4;
        ctx.drawImage(glow(color), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
    };
    /** Where a thing's pull is felt: a light that fades as the pull does, and a faint dotted ring at its very edge. */
    const drawReach = (ctx: CanvasRenderingContext2D, x: number, y: number, reach: number, color: string, alpha: number) => {
        if (reach <= 0 || alpha <= 0.01) return;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = alpha;
        ctx.drawImage(reachOf(color), x - reach, y - reach, reach * 2, reach * 2);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.32 * alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([2 / view.scale, 6 / view.scale]);
        ctx.beginPath();
        ctx.arc(x, y, reach, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    };

    // ---- the whole window: the stage lifted out of the page to fill it, growing from where it was ----
    // It is moved to the end of the page, since a stage inside the opened panel, which slides, would be
    // placed against the panel and not the window; an empty box holds its place meanwhile.
    const host = m.canvas.parentElement;
    const holder = el("div");
    let whole = false;
    let wholeButton: HTMLButtonElement | undefined;
    const fill = (on: boolean) => {
        if (on === whole || m.preview || !host) return;
        const before = host.getBoundingClientRect();
        if (on) {
            holder.style.height = `${before.height}px`;
            host.before(holder);
            document.body.append(host);
        } else holder.replaceWith(host);
        host.classList.toggle("comet-whole", on);
        document.documentElement.classList.toggle("comet-holding", on);
        whole = on;
        const after = host.getBoundingClientRect();
        if (!still && after.width > 0 && after.height > 0) {
            const from = `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})`;
            host.animate([{ transformOrigin: "0 0", transform: from }, { transformOrigin: "0 0", transform: "none" }], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        }
        if (wholeButton) wholeButton.textContent = whole ? "back to the page" : "whole window";
        m.canvas.focus({ preventScroll: true });
        m.wake();
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
        wholeButton = el("button", { type: "button", class: "quiet", textContent: "whole window", onclick: () => fill(!whole) });
        panel.append(said, counts, el("div", { class: "table-go" }, again, wholeButton, link, fresh, first, sound!.button));
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
    /** What is said as a field opens: its number, and the rule of the kind it brings, if any. */
    const opening = () => {
        const fresh = plan(run.level, run.seed).fresh;
        return `Field ${run.level}.${fresh && field && kindsIn(field).has(fresh) ? ` New: ${RULES[fresh]}.` : ""} Pull back and let go.`;
    };

    /** A field to play: the one asked for, growing in while the last shrinks into its hole. */
    const arrive = (fresh: Made, from?: Field) => {
        made = fresh;
        leaving = from;
        field = fresh.field;
        grown = still ? GROW : 0;
        [phase, flying, trail, ghost, flashes, swallowed, shown, picked, teaching] = ["aim", undefined, [], [], [], 0, 0, 0, true];
        aim = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
        if (!still && from) oldSky = copy(sky);
        paint();
        prepare();
        remember();
        tell();
        say(opening());
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
        asked = making(seed, level);
        next = undefined;
        [phase, flying, pulling] = ["making", undefined, undefined];
        tell();
        say(`Finding a way through field ${level}.`);
        m.wake();
    };

    /** The comet back at the start, ready for another shot. */
    const home = () => {
        phase = "aim";
        flying = undefined;
        shown = 0;
        born = 0;
        m.canvas.dataset.phase = phase;
    };
    /** A shot that did not reach the hole. */
    const miss = (how: string) => {
        const end = trail[trail.length - 1] ?? field!.start;
        flashes.push({ x: end.x, y: end.y, age: 0, color: MISS, size: 16 });
        ghost = trail.filter((point, at) => at % 3 === 0 || point.gap);
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
        if (phase !== "aim" || !field) return;
        run = shoot(run);
        flying = launch(field, vx, vy);
        trail = [{ x: field.start.x, y: field.start.y, step: 0 }];
        closest = field.bodies.map(() => Infinity);
        [phase, owed, fading, bump, picked, teaching] = ["fly", 0, 0, 1, 0, false];
        remember();
        tell();
        say(`Shot ${run.shots}.`);
        m.wake();
    };

    /** One step of the flight, and what it meets. */
    const onward = () => {
        const comet = flying!;
        const of = field!;
        const [px, py] = [comet.x, comet.y];
        advance(of, comet);
        shown = comet.step;
        if (comet.through !== undefined) {
            const gate = of.gates[comet.through]!;
            const other = of.gates[gate.to]!;
            trail.push({ x: px, y: py, step: comet.step }, { x: other.x, y: other.y, gap: true, step: comet.step }, { x: comet.x, y: comet.y, gap: true, step: comet.step });
            flashes.push({ x: other.x, y: other.y, age: 0, color: PAIRS[gate.pair % 2]!, size: 22 }, { x: gate.x, y: gate.y, age: 0, color: PAIRS[gate.pair % 2]!, size: 22 });
            sound?.glide(420, 900, 0.25, 0.06);
        } else trail.push({ x: comet.x, y: comet.y, step: comet.step });
        if (trail.length > TRAIL) trail.splice(0, trail.length - TRAIL);
        if (comet.bounced !== undefined) {
            flashes.push({ x: comet.x, y: comet.y, age: 0, color: WALL, size: 10 });
            sound?.knock(0.5, 520);
        }
        if (comet.boosted !== undefined) {
            const ring = of.rings[comet.boosted]!;
            flashes.push({ x: ring.x, y: ring.y, age: 0, color: RING, size: ring.radius });
            sound?.glide(500, 1100, 0.2, 0.05);
        }
        const fresh = comet.sparks & ~picked;
        if (fresh) {
            of.sparks.forEach((spark, at) => {
                if (fresh & (1 << at)) flashes.push({ x: spark.x, y: spark.y, age: 0, color: SPARK, size: 14 });
            });
            picked = comet.sparks;
            sound?.tone(1320, 0.18, 0.05);
        }
        // a tone that rises as the comet swings past a body, higher the faster it goes
        of.bodies.forEach((body, at) => {
            const there = where(body, comet.step, place);
            const near = Math.hypot(comet.x - there.x, comet.y - there.y);
            if (near > closest[at]! && closest[at]! < body.radius * 3.2 && closest[at]! > 0) {
                const speed = Math.hypot(comet.vx, comet.vy);
                const pitch = 260 + speed * 0.7;
                sound?.glide(pitch, pitch * 1.35, 0.35, body.mass > 0 ? 0.05 : 0.04);
                closest[at] = -1;
            } else if (closest[at]! >= 0) closest[at] = Math.min(closest[at]!, near);
        });
        if (!comet.ended) return;
        if (comet.ended === "won") {
            phase = "swallow";
            const hole = where(of.hole, comet.step, place);
            const [dx, dy] = [comet.x - hole.x, comet.y - hole.y];
            const r = Math.hypot(dx, dy);
            const across = (dx * comet.vy - dy * comet.vx) / (r || 1);
            capture = { r, angle: Math.atan2(dy, dx), turn: Math.sign(across) || 1, spin: Math.min(14, Math.abs(across) / Math.max(1, r)) };
            swallowed = 0;
            sound?.glide(190, 38, 1.1, 0.2);
            sound?.tone(55, 1.2, 0.08);
            const best = bestFor(bests, run.seed, run.level);
            const sparks = of.sparks.length ? `, ${count(picked)} of ${of.sparks.length} sparks` : "";
            say(`Swallowed in ${run.shots} ${run.shots === 1 ? "shot" : "shots"}${sparks}${best !== undefined && run.shots < best ? ", fewer shots than before" : ""}.`);
            m.canvas.dataset.phase = phase;
            m.canvas.dataset.sparks = String(count(picked));
            return;
        }
        if (comet.ended === "struck") {
            const kind = kindOf(of.bodies[comet.body!]!);
            miss(kind === "pusher" ? "Into a pusher. Again." : kind === "star" || kind === "planet" ? "Into a star. Again." : "Into a rock. Again.");
        } else miss(comet.ended === "out" ? "Out of the field. Again." : "Lost in orbit. Again.");
    };
    /** Where `where` puts its answers for the picture, apart from the flight's own. */
    const place = { x: 0, y: 0 };

    // ---- the keyboard: arrows aim and set strength, Enter or Space launches, R tries again, Escape lets go ----
    if (!m.preview) {
        // A touch the system takes away (a gesture, an alert) is not a letting go, though the stage hands it on as one:
        // heard first, on the way down to the canvas, it drops the pull, so no shot is fired and counted.
        m.canvas.parentElement?.addEventListener("pointercancel", () => (pulling = undefined), { capture: true });
        m.canvas.addEventListener("keydown", (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const by = (event.shiftKey ? 10 : 1) * (event.repeat ? 2 : 1);
            const key = event.key;
            if (key === "Escape" && pulling) pulling = undefined;
            else if (key === "Escape" && whole) fill(false);
            else if (key === "f" || key === "F") fill(!whole);
            else if (key === "r" || key === "R") retry();
            else if (key === "ArrowLeft" || key === "ArrowRight") {
                keyed = true;
                aim += key === "ArrowLeft" ? -by : by;
            } else if (key === "ArrowUp" || key === "ArrowDown") {
                keyed = true;
                notches = Math.max(WEAKEST / NOTCH, Math.min(1 / NOTCH, notches + (key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 4 : 1)));
            } else if ((key === "Enter" || key === " ") && !event.repeat) {
                if (phase === "fly") retry();
                else if (!keyed) keyed = true;
                else shot(...velocity(aim, notches));
            } else return;
            m.wake();
        });
    }

    fit();
    tell();
    say(`Finding a way through field ${run.level}.`);
    if (!m.preview) remember();

    /** Shown small in the list, it plays its own winning shot now and then. */
    let auto = 0;

    // ---- drawing ----
    /** A body where it is at the step shown: a star, a planet, a pusher, a rock or a moon. */
    const drawBody = (ctx: CanvasRenderingContext2D, body: Body, x: number, y: number, size: number, time: number, index: number) => {
        const kind = kindOf(body);
        const r = body.radius * size;
        if (r <= 0.1) return;
        if (kind === "rock" || kind === "moon") {
            // a lump of rock: a ring of points pushed in and out, the same for the same rock
            const random = numbers(index * 7919 + 13);
            const corners = 9;
            ctx.fillStyle = "oklch(0.42 0.02 60)";
            ctx.strokeStyle = ROCK;
            ctx.lineWidth = 1.6 / view.scale;
            ctx.beginPath();
            for (let i = 0; i < corners; i++) {
                const a = (i / corners) * Math.PI * 2 + (still ? 0 : time * 0.4);
                const rr = r * (0.82 + random() * 0.3);
                if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
                else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }
        const pushes = kind === "pusher";
        const color = pushes ? PUSHER : PULLER;
        drawReach(ctx, x, y, body.reach * size, color, 1);
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, x, y, r * 1.1, color, 0.7);
        // which way it moves things: chevrons pointing in toward a star and out from a pusher, drifting that way
        ctx.globalAlpha = 0.7 * size;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 / view.scale;
        ctx.lineCap = "round";
        const marks = 6;
        const mark = Math.max(3.2 / view.scale, r * 0.22);
        const flow = still ? 0.5 : (time * 0.5 + index * 0.37) % 1;
        for (let i = 0; i < marks; i++) {
            const angle = (i / marks) * Math.PI * 2 + index;
            const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
            const travel = pushes ? flow : 1 - flow;
            const at = r * 1.35 + (body.reach - r * 1.35) * 0.45 * travel;
            ctx.globalAlpha = 0.75 * size * Math.sin(flow * Math.PI);
            const tip = pushes ? at + mark * 0.5 : at - mark * 0.5;
            const back = pushes ? at - mark * 0.5 : at + mark * 0.5;
            ctx.beginPath();
            ctx.moveTo(x + ux * back - uy * mark * 0.6, y + uy * back + ux * mark * 0.6);
            ctx.lineTo(x + ux * tip, y + uy * tip);
            ctx.lineTo(x + ux * back + uy * mark * 0.6, y + uy * back - ux * mark * 0.6);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        // the body: a star is a bright full ball; a pusher a hard bright rim around a dark middle; a planet a ball with a band
        const body2 = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
        if (pushes) {
            body2.addColorStop(0, "oklch(0.25 0.05 220)");
            body2.addColorStop(0.62, "oklch(0.32 0.07 215)");
            body2.addColorStop(0.86, color);
            body2.addColorStop(1, HOT);
        } else {
            body2.addColorStop(0, HOT);
            body2.addColorStop(0.45, "oklch(0.93 0.09 85)");
            body2.addColorStop(1, color);
        }
        ctx.fillStyle = body2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (kind === "planet") {
            ctx.strokeStyle = "oklch(0.6 0.1 60 / 0.7)";
            ctx.lineWidth = r * 0.28;
            ctx.beginPath();
            ctx.ellipse(x, y, r * 1.6, r * 0.45, -0.4, 0, Math.PI * 2);
            ctx.stroke();
        }
    };

    /** The way a moving thing goes, marked at each second of the flight from the launch, nearer seconds brighter. */
    const drawWay = (ctx: CanvasRenderingContext2D, thing: { x: number; y: number; path?: Path }, color: string, alpha: number) => {
        const path = thing.path;
        if (!path || alpha <= 0.01) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / view.scale;
        ctx.globalAlpha = 0.22 * alpha;
        ctx.setLineDash([4 / view.scale, 5 / view.scale]);
        ctx.beginPath();
        if (path.kind === "circle") ctx.arc(path.x, path.y, path.r, 0, Math.PI * 2);
        else {
            ctx.moveTo(path.ax, path.ay);
            ctx.lineTo(path.bx, path.by);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        for (let second = 1; second <= MARKED; second++) {
            const at = where(thing, second / STEP, place);
            ctx.globalAlpha = alpha * 0.75 * (1 - (second - 1) / MARKED);
            ctx.beginPath();
            ctx.arc(at.x, at.y, (second === 1 ? 3.2 : 2.2) / view.scale, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    };

    const drawGate = (ctx: CanvasRenderingContext2D, gate: Gate, size: number, time: number) => {
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

    /** A cloud: soft light within a clear dotted edge, which is exactly where it slows the comet; brighter while the comet is in it. */
    const drawCloud = (ctx: CanvasRenderingContext2D, cloud: Round, size: number, time: number, index: number, inside: boolean) => {
        const r = cloud.radius * size;
        if (r <= 0.1) return;
        ctx.globalCompositeOperation = "lighter";
        const random = numbers(index * 104729 + 7);
        for (let i = 0; i < 7; i++) {
            const [a, out] = [random() * Math.PI * 2 + (still ? 0 : time * 0.05 * (i % 2 ? 1 : -1)), random() * 0.45];
            const [x, y] = [cloud.x + Math.cos(a) * r * out, cloud.y + Math.sin(a) * r * out];
            const rr = r * (0.5 + random() * 0.3);
            const puff = ctx.createRadialGradient(x, y, 0, x, y, rr);
            puff.addColorStop(0, CLOUD.replace(")", ` / ${inside ? 0.2 : 0.11})`));
            puff.addColorStop(1, CLOUD.replace(")", " / 0)"));
            ctx.fillStyle = puff;
            ctx.beginPath();
            ctx.arc(x, y, rr, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = CLOUD;
        ctx.globalAlpha = inside ? 0.7 : 0.45;
        ctx.lineWidth = 1.2 / view.scale;
        ctx.setLineDash([1.5 / view.scale, 4 / view.scale]);
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    };

    /** A ring: a bright hoop with light running round it, the way it speeds things on. */
    const drawRing = (ctx: CanvasRenderingContext2D, ring: Round, size: number, time: number) => {
        const r = ring.radius * size;
        if (r <= 0.1) return;
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, ring.x, ring.y, r * 0.7, RING, 0.35);
        ctx.strokeStyle = RING;
        ctx.lineWidth = 3 / view.scale;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
        ctx.stroke();
        const turn = still ? 0 : time * 3;
        ctx.lineWidth = 5 / view.scale;
        ctx.lineCap = "round";
        for (let i = 0; i < 3; i++) {
            const a = turn + (i / 3) * Math.PI * 2;
            ctx.globalAlpha = 0.8;
            ctx.strokeStyle = HOT;
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, r, a, a + 0.35);
            ctx.stroke();
        }
        // a pulse going out from it, now and then
        const pulse = still ? 0.5 : (time * 0.8) % 1;
        ctx.strokeStyle = RING;
        ctx.lineWidth = 1.2 / view.scale;
        ctx.globalAlpha = 0.5 * (1 - pulse);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, r * (1 + pulse * 0.8), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    };

    const drawWall = (ctx: CanvasRenderingContext2D, wall: Wall, size: number) => {
        if (size <= 0.01) return;
        const [mx, my] = [(wall.ax + wall.bx) / 2, (wall.ay + wall.by) / 2];
        const [ax, ay] = [mx + (wall.ax - mx) * size, my + (wall.ay - my) * size];
        const [bx, by] = [mx + (wall.bx - mx) * size, my + (wall.by - my) * size];
        ctx.lineCap = "round";
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = WALL.replace(")", " / 0.18)");
        ctx.lineWidth = 14 / view.scale;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = WALL;
        ctx.lineWidth = 4 / view.scale;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
    };

    /** A spark: a small four-pointed light that twinkles until it is picked up. */
    const drawSpark = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, time: number, index: number) => {
        if (size <= 0.01) return;
        const twinkle = still ? 1 : 0.85 + Math.sin(time * 4 + index * 1.7) * 0.15;
        const r = 13 * size * twinkle;
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, x, y, r * 0.6, SPARK, 0.6);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = SPARK;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + (still ? 0 : time * 0.6);
            const rr = i % 2 ? r * 0.3 : r;
            if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
    };

    /** The hole: its pull's reach as a fading light and a dotted ring, its grip as the disc of matter going round it, and its mouth. */
    const drawHole = (ctx: CanvasRenderingContext2D, of: Field, x: number, y: number, size: number, time: number, flare: number) => {
        const hole = of.hole;
        const r = hole.radius * size;
        if (r <= 0.1) return;
        drawReach(ctx, x, y, hole.reach * size, HOLE, 1.3);
        ctx.globalCompositeOperation = "lighter";
        shine(ctx, x, y, r * 2.2, HOLE, 0.5 + flare * 0.8);
        // the disc of matter going round it, out to its grip: arcs that circle, the inner ones faster and hotter
        const turn = still ? 0.6 : time;
        ctx.lineCap = "round";
        const grip = hole.grip * size;
        for (let i = 0; i < 26; i++) {
            const out = (i * 0.618) % 1;
            const a = turn * (2.2 - out * 1.6) + i * 2.399;
            const rr = hole.mouth * size + (grip - hole.mouth * size) * out;
            ctx.strokeStyle = out < 0.3 ? HOT : out < 0.65 ? "oklch(0.8 0.15 315)" : "oklch(0.7 0.16 290)";
            ctx.globalAlpha = (0.55 - out * 0.4) * size * (1 + flare);
            ctx.lineWidth = (1.1 + (1 - out) * 1.4) / view.scale;
            ctx.beginPath();
            ctx.arc(x, y, rr, a, a + 0.5 + ((i * 0.37) % 1) * 1.2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        // the dark disc, and the thin bright ring of light at its mouth, where a comet is taken
        ctx.fillStyle = "oklch(0.06 0.02 300)";
        ctx.beginPath();
        ctx.arc(x, y, hole.mouth * size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = HOT;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = (1.6 + flare * 2) / view.scale;
        ctx.beginPath();
        ctx.arc(x, y, hole.mouth * size, 0, Math.PI * 2);
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
                const fade = t ** 1.4 * alpha;
                ctx.strokeStyle = pass === 0 ? "oklch(0.75 0.16 320)" : t > 0.8 ? HOT : "oklch(0.85 0.1 300)";
                ctx.globalAlpha = pass === 0 ? fade * 0.3 : fade;
                ctx.lineWidth = ((pass === 0 ? 12 : 3) * (0.25 + t * 0.75)) / view.scale;
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
        ctx.arc(x, y, (3.2 / view.scale) * size, 0, Math.PI * 2);
        ctx.fill();
    };

    /** The pull: a band from the comet that stretches with the pull, and a dotted line along the first part of the flight, with a larger dot at each half second. */
    const drawAim = (ctx: CanvasRenderingContext2D) => {
        const sent = launching();
        if (!sent || !field) return;
        const strength = Math.hypot(...sent) / FASTEST;
        // the dotted line, worked out with the flight's own steps; it stops where the comet first goes into or off something
        const ahead = launch(field, sent[0], sent[1]);
        ctx.globalCompositeOperation = "lighter";
        for (let i = 1; i <= AHEAD && !ahead.ended; i++) {
            advance(field, ahead);
            if (ahead.through !== undefined || ahead.bounced !== undefined || ahead.boosted !== undefined) break;
            if (i % 6) continue;
            const t = i / AHEAD;
            ctx.globalAlpha = 0.95 * (1 - t) ** 1.2;
            ctx.fillStyle = HOT;
            ctx.beginPath();
            ctx.arc(ahead.x, ahead.y, ((i % 60 ? 2.3 : 3.6) - t * 1.1) / view.scale, 0, Math.PI * 2);
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
        const reach = DEAD + ((strength - WEAKEST) / (1 - WEAKEST)) * (longest() - DEAD) + 14;
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

    /** The rule of the kind a field brings, written beside the first thing of that kind, on the screen the right way up. */
    const drawRule = (ctx: CanvasRenderingContext2D, of: Field, alpha: number) => {
        const fresh = plan(of.level, of.seed).fresh;
        if (!fresh || alpha <= 0.01) return;
        const at = thingOf(of, fresh);
        if (!at) return;
        const [x, y] = screen(at.x, at.y);
        const below = at.r * view.scale + 14;
        ctx.save();
        ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
        ctx.font = `500 13px ${font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const words = RULES[fresh];
        const wide = ctx.measureText(words).width;
        const left = Math.max(view.x + 6, Math.min(x - wide / 2, m.width - view.x - wide - 6));
        const top = y + below + 18 > m.height - 6 ? y - below - 16 : y + below;
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = "rgb(0 0 0 / 0.5)";
        ctx.beginPath();
        ctx.roundRect(left - 7, top - 4, wide + 14, 21, 10);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = m.color("--ink");
        ctx.fillText(words, left + wide / 2, top);
        ctx.restore();
    };

    let offset = { x: 0, y: 0 };
    let clock = 0;
    /** How long the rule has been shown and how far it has faded. */
    let ruled = 0;

    return {
        resize: fit,
        destroy: () => fill(false),
        press(x, y) {
            if (m.preview || !field) return;
            // a press while the comet flies gives up that shot at once and starts the next pull
            if (phase === "fly") miss("Back to the start.");
            if (phase !== "aim") return;
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
            born = Math.min(1, born + dt / 0.25);
            bump = Math.max(0, bump - dt * 2.5);
            shaking = Math.max(0, shaking - dt);
            fading = Math.max(0, fading - dt / 1.5);
            ruled = teaching && phase === "aim" ? Math.min(1, ruled + dt * 2) : Math.max(0, ruled - dt * 3);
            flashes = flashes.filter((flash) => (flash.age += dt) < 0.7);
            if (grown >= GROW) leaving = undefined;
            // a field asked for now is made with most of each frame; the next one with what is left of each
            if (asked) {
                const until = performance.now() + 10;
                while (performance.now() < until) {
                    const piece = asked.next();
                    if (piece.done) {
                        asked = undefined;
                        arrive(piece.value, field);
                        break;
                    }
                }
            } else if (next && !next.done) {
                const until = performance.now() + (phase === "between" ? 10 : 3);
                while (performance.now() < until) {
                    const piece = next.work.next();
                    if (piece.done) {
                        next.done = piece.value;
                        break;
                    }
                }
            }
            if (!field || !made) return;
            if (m.preview && phase === "aim" && grown >= GROW && (auto += dt) > 1.2) {
                auto = 0;
                const sent = velocity(made.solution.aim, made.solution.notches);
                run = shoot(run);
                flying = launch(field, sent[0], sent[1]);
                trail = [{ x: field.start.x, y: field.start.y }];
                closest = field.bodies.map(() => Infinity);
                picked = 0;
                phase = "fly";
            }
            if (phase === "fly" && flying) {
                // time runs slower as the comet nears the hole, so the capture can be watched
                const hole = where(field.hole, flying.step, place);
                const near = Math.hypot(flying.x - hole.x, flying.y - hole.y);
                const slow = still ? 1 : 1 - 0.45 * Math.max(0, 1 - (near - field.hole.mouth) / field.hole.reach);
                owed += dt * slow;
                while (owed >= STEP && phase === "fly") {
                    owed -= STEP;
                    onward();
                }
            } else if (phase === "swallow") {
                swallowed += dt / (still ? 0.4 : SWALLOW);
                // the comet spirals the last of the way in, faster and faster, and the trail follows it round
                const t = Math.min(1, swallowed);
                const hole = where(field.hole, shown, place);
                const r = capture.r * (1 - ease(t * 1.05));
                const angle = capture.angle + capture.turn * (capture.spin * t * 0.9 + t * t * 9);
                trail.push({ x: hole.x + Math.cos(angle) * Math.max(0, r), y: hole.y + Math.sin(angle) * Math.max(0, r) });
                if (trail.length > TRAIL) trail.splice(0, trail.length - TRAIL);
                if (swallowed >= 1) {
                    const result = win(run, bests);
                    run = result.run;
                    bests = result.bests;
                    if (!m.preview) m.keep("comet-bests", bests, 2);
                    flashes.push({ x: hole.x, y: hole.y, age: 0, color: HOT, size: field.hole.mouth * 2 });
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
                    [phase, trail, swallowed, shown] = ["aim", [], 0, 0];
                    born = 0;
                } else if (next?.done && swallowed > 0.6) arrive(next.done, field);
            }
            offset = shaking > 0 ? { x: Math.sin(shaking * 90) * 6 * (shaking / SHAKE) ** 2, y: Math.cos(shaking * 73) * 4 * (shaking / SHAKE) ** 2 } : { x: 0, y: 0 };
        },
        resting() {
            const busy = phase !== "aim" || asked !== undefined || pulling !== undefined || shaking > 0 || flashes.length > 0 || grown < GROW || born < 1 || bump > 0 || fading > 0 || (ruled > 0 && ruled < 1);
            // the rings and spirals turn only while someone is here to see them
            return !busy && !m.preview && (still || !m.pointer.inside) && (!next || next.done !== undefined);
        },
        debug: () =>
            made && field
                ? [`field ${run.seed} ${run.level}, ${field.idea}: ${field.bodies.length} bodies, made in ${made.tries} tries`, `a way in: aim ${made.solution.aim}, ${made.solution.notches} notches, ${made.solution.window} degrees; sparks by aim ${made.route.aim}, ${made.route.notches}`, `${phase}${flying ? ` ${flying.time.toFixed(2)} s` : ""}, next ${next?.done ? "ready" : "being made"}`]
                : ["making"],
        draw() {
            const { ctx } = m;
            const scale = window.devicePixelRatio || 1;
            if (m.debug && made) {
                m.canvas.dataset.aim = String(made.solution.aim);
                m.canvas.dataset.notches = String(made.solution.notches);
                m.canvas.dataset.routeAim = String(made.route.aim);
                m.canvas.dataset.routeNotches = String(made.route.notches);
                m.canvas.dataset.time = flying ? flying.time.toFixed(3) : "";
                m.canvas.dataset.idea = field?.idea ?? "";
                if (field) m.canvas.dataset.toward = String(nearest(field.hole.x - field.start.x, field.hole.y - field.start.y));
                if (field) m.canvas.dataset.start = [...screen(field.start.x, field.start.y), longest(), view.upright ? 1 : 0].join(",");
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
            if (!field) {
                ctx.restore();
                ctx.setTransform(scale, 0, 0, scale, 0, 0);
                ctx.font = `500 15px ${font}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = m.color("--muted");
                ctx.globalAlpha = still ? 1 : 0.6 + Math.sin(clock * 3) * 0.3;
                if (!m.preview) ctx.fillText(`finding a way through field ${run.level}`, m.width / 2, m.height / 2);
                ctx.globalAlpha = 1;
                return;
            }
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
                const from = leaving;
                const toward = (x: number, y: number): [number, number] => [x + (from.hole.x - x) * gone, y + (from.hole.y - y) * gone];
                from.bodies.forEach((body, i) => drawBody(ctx, body, ...toward(body.x, body.y), 1 - gone, clock, i));
                for (const wall of from.walls) drawWall(ctx, { ...wall, ...ends(toward(wall.ax, wall.ay), toward(wall.bx, wall.by)) }, 1 - gone);
                for (const gate of from.gates) drawGate(ctx, { ...gate, ...xy(toward(gate.x, gate.y)) }, 1 - gone, clock);
                drawHole(ctx, from, from.hole.x, from.hole.y, 1 - gone, clock, 0);
            }
            // each thing grows in, the nearer the start the sooner
            const start = field.start;
            const size = (x: number, y: number) => (still ? 1 : ease((grown - 0.15 - (Math.hypot(x - start.x, y - start.y) / WIDE) * 0.35) / 0.45));
            const flare = phase === "swallow" ? swallowed : phase === "between" ? Math.max(0, 1 - swallowed * 2) : 0;
            const aiming = phase === "aim";
            // while aiming, the way each moving thing will go
            if (aiming) {
                for (const body of field.bodies) drawWay(ctx, body, kindOf(body) === "planet" ? PULLER : ROCK, size(body.x, body.y));
                drawWay(ctx, field.hole, HOLE, size(field.hole.x, field.hole.y));
            }
            field.clouds.forEach((cloud, i) => drawCloud(ctx, cloud, size(cloud.x, cloud.y), clock, i, !!flying?.braked && Math.hypot(flying.x - cloud.x, flying.y - cloud.y) < cloud.radius));
            const hole = { ...where(field.hole, shown, place) };
            drawHole(ctx, field, hole.x, hole.y, size(field.hole.x, field.hole.y), clock, flare);
            for (const wall of field.walls) drawWall(ctx, wall, size((wall.ax + wall.bx) / 2, (wall.ay + wall.by) / 2));
            for (const ring of field.rings) drawRing(ctx, ring, size(ring.x, ring.y), clock);
            for (const gate of field.gates) drawGate(ctx, gate, size(gate.x, gate.y), clock);
            field.bodies.forEach((body, i) => {
                const at = where(body, shown, place);
                drawBody(ctx, body, at.x, at.y, size(body.x, body.y), clock, i);
            });
            field.sparks.forEach((spark, i) => {
                if (!(picked & (1 << i)) || aiming) drawSpark(ctx, spark.x, spark.y, size(spark.x, spark.y), clock, i);
            });
            // the last miss, faint, with a brighter dot at each second, and the trail of the flight
            if (ghost.length > 1 && aiming) {
                for (const point of ghost) {
                    const second = point.step !== undefined && point.step % 120 < 3 && point.step > 0;
                    ctx.fillStyle = second ? "oklch(0.9 0.08 300 / 0.6)" : "oklch(0.8 0.08 300 / 0.28)";
                    ctx.beginPath();
                    ctx.arc(point.x, point.y, (second ? 2.4 : 1.1) / view.scale, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            drawTrail(ctx, trail, aiming || phase === "between" ? fading : 1);
            // the start, where the comet waits
            ctx.strokeStyle = "oklch(0.77 0.16 300 / 0.4)";
            ctx.lineWidth = 1 / view.scale;
            ctx.beginPath();
            ctx.arc(field.start.x, field.start.y, 10 / view.scale, 0, Math.PI * 2);
            ctx.stroke();
            if (phase === "fly" && flying) drawHead(ctx, flying.x, flying.y, 1);
            else if (phase === "swallow") {
                const last = trail[trail.length - 1]!;
                drawHead(ctx, last.x, last.y, 1 - ease(swallowed) * 0.8);
            } else if (aiming) drawHead(ctx, field.start.x, field.start.y, ease(born) * size(field.start.x, field.start.y) * (1 + (still ? 0 : Math.sin(clock * 3) * 0.06)));
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
            if (aiming && !m.preview && grown >= GROW * 0.6) drawAim(ctx);
            ctx.restore();
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            if (m.preview) return;
            drawRule(ctx, field, ruled * ease(grown / GROW));
            // above the field: which field, the sparks, and the shots on it
            ctx.font = `600 15px ${font}`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = m.color("--muted");
            ctx.textAlign = "left";
            const line = view.top / 2 + 2;
            ctx.fillText(`field ${run.level}`, view.x + 2, line);
            if (field.sparks.length) {
                const left = view.x + 2 + ctx.measureText(`field ${run.level}`).width + 22;
                drawSpark(ctx, left, line, 0.85, still ? 0 : clock, 0);
                ctx.fillStyle = count(picked) === field.sparks.length ? SPARK : m.color("--muted");
                ctx.fillText(`${count(picked)} of ${field.sparks.length}`, left + 12, line);
            }
            ctx.textAlign = "right";
            ctx.fillStyle = m.color("--muted");
            const best = bestFor(bests, run.seed, run.level);
            const words = best === undefined ? "" : `   fewest ${best}`;
            ctx.fillText(words, m.width - view.x - 2, line);
            const shotsAt = m.width - view.x - 2 - ctx.measureText(words).width;
            ctx.save();
            ctx.translate(shotsAt, line);
            ctx.scale(1 + bump * 0.35, 1 + bump * 0.35);
            ctx.fillStyle = bump > 0 ? m.color("--accent") : m.color("--ink");
            ctx.fillText(`${run.shots} ${run.shots === 1 ? "shot" : "shots"}`, 0, 0);
            ctx.restore();
        },
    };
}

/** How many bits are set: sparks picked up. */
const count = (bits: number) => {
    let n = 0;
    for (let b = bits; b; b &= b - 1) n++;
    return n;
};
/** The first thing of a kind in a field, where it is at the launch, and how big. */
function thingOf(field: Field, kind: Kind): { x: number; y: number; r: number } | undefined {
    const body = field.bodies.find((one) => kindOf(one) === kind);
    if (body) return { x: body.x, y: body.y, r: body.radius };
    if (kind === "spark" && field.sparks[0]) return { ...field.sparks[0], r: 10 };
    if (kind === "cloud" && field.clouds[0]) return { x: field.clouds[0].x, y: field.clouds[0].y, r: field.clouds[0].radius * 0.2 };
    if (kind === "ring" && field.rings[0]) return { ...field.rings[0], r: field.rings[0].radius };
    if (kind === "wall" && field.walls[0]) return { x: (field.walls[0].ax + field.walls[0].bx) / 2, y: (field.walls[0].ay + field.walls[0].by) / 2, r: 6 };
    if (kind === "wormhole" && field.gates[0]) return { ...field.gates[0], r: field.gates[0].radius };
    if (kind === "wandering hole") return { x: field.hole.x, y: field.hole.y, r: field.hole.mouth };
    return undefined;
}
const xy = ([x, y]: [number, number]) => ({ x, y });
const ends = ([ax, ay]: [number, number], [bx, by]: [number, number]) => ({ ax, ay, bx, by });
/** The site's heading face, for the words over the field. */
const font = typeof document === "undefined" ? "serif" : getComputedStyle(document.documentElement).getPropertyValue("--font-head").trim() || "serif";
