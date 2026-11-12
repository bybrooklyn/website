// Plinko: a board that makes a password, seen straight on like an arcade machine. Balls drop one
// after another through the pegs, which light as they are struck. The world is flat; the balls are
// drawn as the solid, shiny spheres they would be, each with its shadow on the board. Each bin shows a character; when
// a ball lands in one, that character flies up to the next empty place in the password along the
// top, and the bin is given another. What makes the password fair is in board.ts; here the board is
// drawn, by Mote's 3D drawing, with its settings under it.

import { gl, type Color, type Part } from "../mote/gl";
import type { Body } from "../mote/flat";
import { ball, block, mix3, type V3 } from "../mote/solids";
import { sounds } from "../mote/sound";
import { el, gently, toward, type Mote, type Scene } from "../mote/stage";
import { ACROSS, BALL, BIN, BINS, DEFAULTS, LIMITS, PEG, WIDTH, alphabet, drop, strength, type Board, type Settings } from "./board";

export const label = "A Plinko board. Balls fall through pegs into bins of characters, and what they land in becomes a password.";

/** One unit of the picture is this many of the board's own. */
const UNIT = 50;
/** How long a character takes from its bin to its place in the password, in seconds. */
const FLIGHT = 0.5;
/** How many places a ball's trail has, and how many steps apart they are. */
const TRAIL = 6;
const EVERY = 3;
const mix = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A ball as it is drawn: itself, the fading copies behind it, where it has lately been, and its color. */
interface Drawn {
    part: Part;
    tail: Part[];
    been: V3[];
    color: Color;
}

/** A character of the password: on its way from a bin to its place, or there. */
interface Letter {
    part: Part;
    from: V3;
    flown: number;
}

export default function plinko(m: Mote): Scene {
    const kept = m.recall<Partial<Settings>>("plinko", {});
    let settings: Settings = { ...DEFAULTS, ...kept, rows: Math.min(LIMITS.rows[1], kept.rows ?? DEFAULTS.rows) };
    // Until the first drop the board stands empty, with its bins already showing characters.
    let board: Board = drop({ ...settings, length: 0 });
    let dropping = false;
    const sound = m.preview ? undefined : sounds(m);
    let auto = -6;
    let steps = 0;

    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const view = gl(under);
    if (view) {
        m.canvas.parentElement!.insertBefore(under, m.canvas);
        // the characters are in the site's code face, where l, 1 and I can be told apart
        const probe = el("span");
        probe.style.fontFamily = "var(--font-code)";
        m.canvas.parentElement!.append(probe);
        view.font = getComputedStyle(probe).fontFamily;
        probe.remove();
    }
    const tint = (name: string, by = 1): Color => view!.color(m.color(name)).map((value) => value * by) as Color;

    // ---- where things are ----
    // The password runs along the top, above the board, on one line or two.
    let places = { perLine: 1, pitch: 30, top: 60 };
    const layout = (length: number) => {
        const perLine = length <= 32 ? Math.max(1, length) : Math.ceil(length / 2);
        const pitch = Math.min(36, (WIDTH + 40) / perLine);
        places = { perLine, pitch, top: Math.ceil(Math.max(1, length) / perLine) * pitch * 1.3 + 30 };
    };
    /** A place on the board, as the picture has it: across, down from the board's top, and out toward the eye. */
    const place = (x: number, y: number, out = 0): V3 => [(x - WIDTH / 2) / UNIT, ((board.height + places.top) / 2 - (y + places.top)) / UNIT, out];
    /** Where a character of the password goes. */
    const slot = (at: number, length: number): V3 => {
        const line = Math.floor(at / places.perLine);
        const inLine = Math.min(places.perLine, length - line * places.perLine);
        return place(WIDTH / 2 + ((at % places.perLine) - (inLine - 1) / 2) * places.pitch, -places.top + 20 + (line + 0.5) * places.pitch * 1.3, 0.3);
    };
    const bin = (at: number): V3 => place((at + 0.5) * ACROSS, board.shelf + BIN * 0.5, 0.3);

    // ---- the board, drawn ----
    let fixed: Part[] = [];
    /** Each peg, how lately it was struck, and the color of the ball that struck it. */
    let pegs: { part: Part; look: { color: Color }; struck: number; by: Color }[] = [];
    const balls = new Map<Body, Drawn>();
    const bins = Array.from({ length: BINS }, () => ({ signs: new Map<string, Part>(), caught: 0 }));
    /** The empty places of the password, and the characters that have left their bins for them. */
    let blanks: Part[] = [];
    let letters: Letter[] = [];
    /** How brightly the finished password flares, falling back from 1. */
    let flare = 0;
    let length = 0;
    const ballMesh = ball(BALL / UNIT);
    const pegMesh = ball(PEG / UNIT);
    let plain: Color = [0.4, 0.4, 0.4];

    const build = (count: number) => {
        if (!view) return;
        for (const part of [...fixed, ...pegs.map((peg) => peg.part), ...blanks, ...letters.map((letter) => letter.part), ...[...balls.values()].flatMap((drawn) => [drawn.part, ...drawn.tail])]) view.remove(part);
        balls.clear();
        [letters, flare, length] = [[], 0, count];
        layout(count);
        const [wide, high] = [WIDTH / UNIT, board.height / UNIT];
        const put = (part: Part, at: V3) => ((part.at = at), part);
        const middle = place(WIDTH / 2, board.height / 2);
        fixed = [
            // a board darker than the page, so that what lights up on it shows
            put(view.add(block([wide / 2 + 0.12, high / 2 + 0.12, 0.1]), { color: tint("--ground", 0.55), casts: false }), [middle[0], middle[1], -0.3]),
            put(view.add(block([wide / 2 + 0.2, 0.06, 0.3]), { color: tint("--rule") }), [middle[0], middle[1] - high / 2 - 0.12, 0]),
            ...[-1, 1].map((side) => put(view.add(block([0.06, high / 2 + 0.18, 0.3]), { color: tint("--rule") }), [side * (wide / 2 + 0.14), middle[1], 0])),
            ...Array.from({ length: BINS - 1 }, (_, wall) => put(view.add(block([3 / UNIT, BIN / 2 / UNIT, 0.2]), { color: tint("--rule") }), place((wall + 1) * ACROSS, board.shelf + BIN / 2))),
        ];
        plain = tint("--muted", 0.6);
        pegs = board.pegs.map((body) => {
            const look = { color: plain };
            return { part: put(view.add(pegMesh, look), place(body.x, body.y)), look, struck: 0, by: plain };
        });
        blanks = Array.from({ length: count }, (_, at) => {
            const blank = put(view.sign("_", tint("--muted", 0.7)), slot(at, count));
            blank.scale = (places.pitch / UNIT) * 1.5;
            blank.emit = 1;
            return blank;
        });
        // the sun high and to one side, so that a ball has a bright side, a dark side, and a shadow beside it on the board
        view.light([-7, 11, 9], [-wide / 2 - 0.5, -high / 2 - 2, -0.5], [wide / 2 + 0.5, high / 2 + 2, 0.5], 1.7, 0.6, 0.3);
        aim();
    };
    /** The eye: straight in front, far enough back to see the board and the password above it. */
    const aim = () => {
        if (!view) return;
        view.size(m.width, m.height);
        const [wide, high] = [WIDTH / UNIT + 1.2, (board.height + places.top) / UNIT + 0.8];
        const reach = Math.tan((6 * Math.PI) / 180);
        const back = Math.max(high / 2 / reach, wide / 2 / (reach * (m.width / Math.max(1, m.height))));
        view.look([0, 0, back], [0, 0, 0], 12);
    };

    // ---- under the board: the password, and the settings ----
    let finish = () => {};
    let ready = () => {};
    const start = (count = settings.length) => {
        board = drop({ ...settings, length: count });
        dropping = true;
        build(m.preview ? 0 : count);
        // a knock for each peg struck, higher the further down the board, and the peg lights in the ball's color
        board.flat.hit = (a, b, speed) => {
            const [peg, other] = a.im ? [b, a] : [a, b];
            const at = board.pegs.indexOf(peg);
            if (at < 0 || !pegs[at]) return;
            pegs[at].struck = 1;
            pegs[at].by = balls.get(other)?.color ?? plain;
            sound?.knock(speed / 500, 500 + (peg.y / board.height) * 900);
        };
        // the character leaves its bin for the next empty place in the password
        board.landed = (landing) => {
            bins[landing.bin]!.caught = 1;
            sound?.tone(330 * 2 ** (landing.bin / 9), 0.2, 0.05);
            if (!view || m.preview) return;
            const part = view.sign(landing.character, [1, 1, 1]);
            part.emit = 1;
            letters.push({ part, from: bin(landing.bin), flown: 0 });
        };
        ready();
        m.wake();
    };

    if (!m.preview) {
        const panel = m.panel();
        const said = el("p", { class: "table-said", textContent: "Press drop for a password." });
        said.setAttribute("aria-live", "polite");
        const word = el("output", { class: "plinko-word" });
        const about = el("p", { class: "note" });
        const go = el("button", { type: "button", class: "dice-go", textContent: "drop", onclick: () => start() });
        const copy = el("button", { type: "button", class: "quiet", textContent: "copy", disabled: true, onclick: () => {
            copy.style.minWidth = `${copy.offsetWidth}px`;
            navigator.clipboard?.writeText(word.textContent ?? "").then(() => (copy.textContent = "copied"), () => (copy.textContent = "select it and copy"));
            setTimeout(() => (copy.textContent = "copy"), 2500);
        } });

        const describe = () => {
            const count = alphabet(settings).length;
            about.textContent = `${settings.length} characters, each one of ${count}: ${Math.round(strength(settings))} bits.`;
        };
        /** A setting changed: it is kept, and the empty board is set up again if nothing is falling. */
        const changed = () => {
            m.keep("plinko", settings);
            describe();
            if (dropping) return;
            word.classList.remove("shown");
            copy.disabled = true;
            said.textContent = "Press drop for a password.";
            board = drop({ ...settings, length: 0 });
            build(settings.length);
            m.wake();
        };
        const slide = (name: "length" | "rows" | "bounce" | "gravity", words: string, step: number) => {
            const value = el("span", { textContent: String(settings[name]) });
            const input = el("input", { type: "range", min: String(LIMITS[name][0]), max: String(LIMITS[name][1]), step: String(step), value: String(settings[name]), oninput: () => {
                settings = { ...settings, [name]: Number(input.value) };
                value.textContent = input.value;
                changed();
            } });
            return el("label", {}, words, input, value);
        };
        const tick = (name: "lower" | "upper" | "digits" | "symbols", words: string) => {
            const input = el("input", { type: "checkbox", checked: settings[name], onchange: () => {
                settings = { ...settings, [name]: input.checked };
                changed();
            } });
            return el("label", {}, input, words);
        };
        panel.append(
            said, word, about,
            el("div", { class: "table-go" }, go, copy, sound!.button),
            el("div", { class: "plinko-settings" }, slide("length", "length", 1), el("div", { class: "plinko-kinds" }, tick("lower", "a to z"), tick("upper", "A to Z"), tick("digits", "0 to 9"), tick("symbols", "symbols"))),
            el("h2", { textContent: "the board" }),
            el("div", { class: "plinko-settings" }, slide("rows", "rows of pegs", 1), slide("bounce", "bounce", 0.05), slide("gravity", "gravity", 0.1)),
        );
        describe();
        ready = () => {
            said.textContent = "Dropping…";
            word.classList.remove("shown");
            copy.disabled = true;
            go.disabled = true;
        };
        finish = () => {
            said.textContent = "Your password:";
            word.textContent = board.password();
            word.classList.add("shown");
            copy.disabled = go.disabled = false;
        };
    }

    build(m.preview ? 0 : settings.length);

    return {
        step(dt) {
            // Shown small in a list, it drops a few balls by itself now and then.
            if (m.preview && !dropping && m.time - auto > 9) {
                auto = m.time;
                start(8);
            }
            if (dropping) {
                board.step(dt);
                // where each ball has lately been, for the trail behind it
                if (++steps % EVERY === 0) for (const [body, drawn] of balls) drawn.been = [place(body.x, body.y, 0.05), ...drawn.been].slice(0, TRAIL);
                if (board.done() && board.balls.size === 0 && letters.every((letter) => letter.flown >= 1)) {
                    dropping = false;
                    flare = 1;
                    finish();
                    sound?.tone(660, 0.6, 0.06);
                    sound?.tone(990, 0.6, 0.04);
                }
            }
            for (const letter of letters) letter.flown = Math.min(1, letter.flown + dt / FLIGHT);
            for (const peg of pegs) peg.struck = Math.max(0, peg.struck - dt * 2.2);
            for (const each of bins) each.caught = Math.max(0, each.caught - dt * 2);
            flare = Math.max(0, flare - dt * 0.8);
            // once the password is whole the board goes a little darker behind it
            if (view) view.shade = toward(view.shade, !dropping && letters.length > 0 ? 0.35 : 0, dt * 0.35, 0.5);
        },
        resize: aim,
        // Clicking the board drops the balls.
        press() {
            if (!dropping && !m.preview) start();
        },
        resting: () => !m.preview && !dropping && flare === 0 && (view?.shade ?? 0) === (letters.length > 0 ? 0.35 : 0) && pegs.every((peg) => peg.struck === 0) && bins.every((each) => each.caught === 0),
        debug: () => [`${board.balls.size} balls on the board, ${board.landings.length} landed, ${board.late} out of time`],
        draw() {
            if (!view) return flat();
            for (const peg of pegs) {
                peg.look.color = mix(plain, peg.by, peg.struck);
                peg.part.emit = peg.struck * 1.3;
            }
            // the balls: each its own color, glowing, with fading copies behind it; one that has landed flares and shrinks away
            for (const [body, drawn] of balls) {
                if (board.balls.has(body)) continue;
                for (const part of [drawn.part, ...drawn.tail]) view.remove(part);
                balls.delete(body);
            }
            for (const [body, since] of board.balls) {
                let drawn = balls.get(body);
                if (!drawn) {
                    const color = view.color(`oklch(0.82 0.15 ${(balls.size * 47 + board.landings.length * 47) % 360})`);
                    drawn = { color, been: [], part: view.add(ballMesh, { color, gloss: 0.7 }), tail: Array.from({ length: TRAIL }, (_, at) => view.add(ballMesh, { color: color.map((value) => value * (0.7 - at * 0.09)) as Color, casts: false })) };
                    balls.set(body, drawn);
                }
                const gone = since === undefined ? 0 : Math.min(1, (board.time - since) / 0.5);
                drawn.part.at = place(body.x, body.y, 0.05);
                // only a little light of its own while it falls, so that the sun and shade on it show it is round
                drawn.part.emit = since === undefined ? 0.12 : 1.5 * (1 - gone);
                drawn.part.scale = 1 - gone * gone;
                drawn.tail.forEach((part, at) => {
                    part.hidden = !drawn.been[at] || since !== undefined;
                    if (drawn.been[at]) part.at = [drawn.been[at][0], drawn.been[at][1], -0.05 - at * 0.01];
                    part.scale = 0.85 - at * 0.11;
                    part.emit = 0.45 - at * 0.06;
                });
            }
            // what each bin shows now, brighter for a moment when it catches a ball
            bins.forEach((each, at) => {
                const now = board.shown[at]!;
                let sign = each.signs.get(now);
                if (!sign) each.signs.set(now, (sign = view.sign(now, tint("--ink"))));
                for (const [character, other] of each.signs) other.hidden = character !== now;
                sign.at = bin(at);
                // a new character grows into the bin as the old one leaves
                sign.scale = 1.05 * (1 - each.caught * 0.6);
                sign.emit = 0.55 + each.caught * 0.6;
            });
            // the password: each character from its bin, up in a curve to its place, where it settles
            letters.forEach((letter, at) => {
                const t = gently(letter.flown);
                const to = slot(at, length);
                const here = mix3(letter.from, to, t);
                letter.part.at = [here[0] + Math.sin(t * Math.PI) * (to[0] > letter.from[0] ? -0.5 : 0.5), here[1], here[2]];
                letter.part.scale = 1.05 + ((places.pitch / UNIT) * 1.5 - 1.05) * t;
                letter.part.emit = 0.75 + (1 - t) * 0.5 + flare * 0.9;
                if (blanks[at]) blanks[at].hidden = letter.flown >= 1;
            });
            view.draw();
        },
    };

    /** Flat, where the browser cannot draw in 3D: the same board with no light or glow. */
    function flat(): void {
        const { ctx } = m;
        const scale = Math.min(m.width / (WIDTH + 20), m.height / (board.height + 60));
        ctx.save();
        ctx.translate((m.width - WIDTH * scale) / 2, (m.height - (board.height - 40) * scale) / 2);
        ctx.scale(scale, scale);
        const dot = (x: number, y: number, r: number, color: string) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        };
        ctx.fillStyle = m.color("--surface");
        ctx.fillRect(0, 0, WIDTH, board.height);
        ctx.fillStyle = m.color("--rule");
        for (let wall = 1; wall < BINS; wall++) ctx.fillRect(wall * ACROSS - 2, board.shelf, 4, BIN);
        for (const peg of board.pegs) dot(peg.x, peg.y, PEG, m.color("--muted"));
        for (const body of board.balls.keys()) dot(body.x, body.y, BALL, m.color("--accent"));
        ctx.fillStyle = m.color("--ink");
        ctx.font = `700 ${BIN * 0.4}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        board.shown.forEach((character, at) => ctx.fillText(character, (at + 0.5) * ACROSS, board.shelf + BIN * 0.5));
        // the password so far, over the board
        ctx.font = "700 20px monospace";
        ctx.fillText(board.password(), WIDTH / 2, -22, WIDTH);
        ctx.restore();
    }
}
