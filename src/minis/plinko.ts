// Plinko: a board that makes a password. Balls fall through the pegs into bins, each bin shows a
// character, and each ball that lands adds its bin's character. When the last has landed the board
// darkens and the characters lift out of the bins into a row, in the order they landed. What makes
// the password fair is in board.ts; here the board is drawn, by Mote's 3D drawing, with its settings
// under it.

import { gl, type Color, type Part } from "../mote/gl";
import { ball, block, mix3, rod, type V3 } from "../mote/solids";
import { sounds } from "../mote/sound";
import { el, gently, toward, type Mote, type Scene } from "../mote/stage";
import { ACROSS, BALL, BIN, BINS, DEFAULTS, DOWN, LIMITS, PEG, WIDTH, alphabet, drop, strength, type Board, type Settings } from "./board";
import { row } from "./rolls";

export const label = "A Plinko board. Balls fall through pegs into bins of characters, and what they land in becomes a password.";

/** One unit of the picture is this many of the board's own. */
const UNIT = 50;
const FLIGHT = 0.7;
const FAR = 5;
const WHITE: Color = [1, 1, 1];

export default function plinko(m: Mote): Scene {
    let settings: Settings = { ...DEFAULTS, ...m.recall<Partial<Settings>>("plinko", {}) };
    // Until the first drop the board stands empty, with its bins already showing characters.
    let board: Board = drop({ ...settings, length: 0 });
    let dropping = false;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sound = m.preview ? undefined : sounds(m);
    let auto = -6;

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
    const tint = (name: string): Color => view!.color(m.color(name));
    /** A place on the board, as the picture has it: across, down, and out toward the eye. */
    const place = (x: number, y: number, out = 0): V3 => [(x - WIDTH / 2) / UNIT, (board.height / 2 - y) / UNIT, out];

    // ---- the board, drawn ----
    /** What stands still, each peg with how lately it was struck, the balls, and the character each bin shows. */
    let fixed: Part[] = [];
    let pegs: { part: Part; struck: number }[] = [];
    const balls = new Map<object, Part>();
    const bins = Array.from({ length: BINS }, () => ({ signs: new Map<string, Part>(), caught: 0 }));
    const build = () => {
        if (!view) return;
        for (const part of [...fixed, ...pegs.map((peg) => peg.part), ...balls.values()]) view.remove(part);
        balls.clear();
        const [wide, high] = [WIDTH / UNIT, board.height / UNIT];
        const put = (part: Part, at: V3) => ((part.at = at), part);
        fixed = [
            put(view.add(block([wide / 2 + 0.2, high / 2 + 0.2, 0.1]), { color: tint("--surface"), casts: false }), [0, 0, -0.4]),
            put(view.add(block([wide / 2 + 0.2, 0.08, 0.3]), { color: tint("--rule") }), [0, -high / 2 - 0.08, -0.05]),
            ...[-1, 1].map((side) => put(view.add(block([0.08, high / 2 + 0.2, 0.3]), { color: tint("--rule") }), [side * (wide / 2 + 0.12), 0, -0.05])),
            ...Array.from({ length: BINS - 1 }, (_, wall) => put(view.add(block([2.5 / UNIT, BIN / 2 / UNIT, 0.25]), { color: tint("--rule") }), place((wall + 1) * ACROSS, board.shelf + BIN / 2))),
        ];
        const peg = rod(PEG / UNIT, 0.5);
        pegs = board.pegs.map((body) => ({ part: put(view.add(peg, { color: tint("--muted") }), place(body.x, body.y)), struck: 0 }));
        view.light([-5, 9, 12], [-wide / 2 - 0.5, -high / 2 - 0.5, -0.6], [wide / 2 + 0.5, high / 2 + 0.5, 0.6], 1.5, 0.8, 0.45);
        aim();
    };
    /** The eye: far enough back to see the whole board, a little to one side and above. */
    const aim = () => {
        if (!view) return;
        view.size(m.width, m.height);
        const [wide, high] = [WIDTH / UNIT + 1, board.height / UNIT + 1];
        const reach = Math.tan((15 * Math.PI) / 180);
        const back = Math.max(high / 2 / reach, wide / 2 / (reach * (m.width / Math.max(1, m.height)))) * 1.04;
        view.look([back * 0.17, back * 0.06, back], [0, 0, 0], 30);
    };
    const ballMesh = ball(BALL / UNIT);

    // ---- the password, lifted out of the bins ----
    let lifted: { part: Part; from: V3 }[] = [];
    let lined = 0;
    const gap = () => Math.min(0.05, FLIGHT / Math.max(1, lifted.length));
    const lastIn = () => FLIGHT + (lifted.length - 1) * gap();
    const clear = () => {
        for (const one of lifted) view?.remove(one.part);
        [lifted, lined] = [[], 0];
    };

    // ---- under the board: the password, and the settings ----
    let finish = () => {};
    let ready = () => {};
    const start = (length = settings.length) => {
        clear();
        board = drop({ ...settings, length });
        dropping = true;
        // a knock for each peg struck, higher the further down the board, and the peg lights
        board.flat.hit = (a, b, speed) => {
            const at = board.pegs.indexOf(a.im ? b : a);
            if (at < 0) return;
            pegs[at]!.struck = 1;
            sound?.knock(speed / 900, 500 + ((a.im ? b : a).y / board.height) * 900);
        };
        board.landed = (landing) => {
            bins[landing.bin]!.caught = 1;
            sound?.tone(330 * 2 ** ((landing.bin % 12) / 12), 0.18, 0.04);
        };
        build();
        ready();
        m.wake();
    };

    if (!m.preview) {
        const panel = m.panel();
        const said = el("p", { class: "table-said", textContent: "Press drop for a password." });
        said.setAttribute("aria-live", "polite");
        const word = el("output", { class: "plinko-word", hidden: true });
        const about = el("p", { class: "note" });
        const go = el("button", { type: "button", class: "dice-go", textContent: "drop", onclick: () => start() });
        const copy = el("button", { type: "button", class: "quiet", textContent: "copy", disabled: true, onclick: () => {
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
            clear();
            word.hidden = copy.disabled = true;
            board = drop({ ...settings, length: 0 });
            build();
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
            word.hidden = copy.disabled = true;
            go.disabled = true;
        };
        finish = () => {
            said.textContent = "Your password:";
            word.textContent = board.password();
            word.hidden = copy.disabled = go.disabled = false;
        };
    }

    build();

    return {
        step(dt) {
            // Shown small in a list, it drops a few balls by itself now and then.
            if (m.preview && !dropping && m.time - auto > 7) {
                auto = m.time;
                start(10);
            }
            if (dropping) {
                board.step(dt);
                if (board.done() && board.balls.size === 0) {
                    dropping = false;
                    if (m.preview) return;
                    // a copy of each character, where its ball landed, to lift into the row
                    if (view) lifted = board.landings.map((landing) => {
                        const part = view.sign(landing.character, WHITE);
                        part.emit = 1;
                        part.hidden = true;
                        return { part, from: place(landing.x, board.shelf + BIN * 0.45, 0.35) };
                    });
                    finish();
                }
            }
            for (const peg of pegs) peg.struck = Math.max(0, peg.struck - dt * 3);
            for (const bin of bins) bin.caught = Math.max(0, bin.caught - dt * 2.5);
            const leaving = lifted.length > 0;
            if (leaving) lined = still ? lastIn() : lined + dt;
            if (view) view.shade = toward(view.shade, leaving ? 0.72 : 0, dt * 0.72, 0.4);
        },
        resize: aim,
        // Clicking the board drops the balls.
        press() {
            if (!dropping && !m.preview) start();
        },
        resting: () => !m.preview && !dropping && lined >= (lifted.length > 0 ? lastIn() : 0) && (view?.shade ?? 0) === (lifted.length > 0 ? 0.72 : 0) && pegs.every((peg) => peg.struck === 0),
        debug: () => [`${board.balls.size} balls on the board, ${board.landings.length} landed, ${board.late} out of time`],
        draw() {
            if (!view) return flat();
            const accent = tint("--accent");
            pegs.forEach((peg) => (peg.part.emit = peg.struck * 1.2));
            // the balls: each glows a little as it falls, flares when it lands, and shrinks away into its bin
            for (const [body, part] of balls) {
                if (!board.balls.has(body as never)) {
                    view.remove(part);
                    balls.delete(body);
                }
            }
            for (const [body, since] of board.balls) {
                let part = balls.get(body);
                if (!part) balls.set(body, (part = view.add(ballMesh, { color: accent })));
                const gone = since === undefined ? 0 : Math.min(1, (board.time - since) / 0.5);
                part.at = place(body.x, body.y, 0.05);
                part.emit = since === undefined ? 0.4 : 1.4 * (1 - gone);
                part.scale = 1 - gone * gone;
            }
            // what each bin shows now, brighter for a moment when it catches a ball
            bins.forEach((bin, at) => {
                const now = board.shown[at]!;
                let sign = bin.signs.get(now);
                if (!sign) {
                    bin.signs.set(now, (sign = view.sign(now, tint("--ink"))));
                    sign.scale = 0.78;
                }
                for (const [character, other] of bin.signs) other.hidden = character !== now || lifted.length > 0;
                sign.at = place((at + 0.5) * ACROSS, board.shelf + BIN * 0.45, 0.35);
                sign.emit = 0.45 + bin.caught;
            });
            // the row: each character from its bin to its place in front of the eye, growing as it goes
            const shape = m.width / Math.max(1, m.height);
            const places = row(lifted.length, shape);
            const reach = FAR * Math.tan((15 * Math.PI) / 180);
            lifted.forEach((one, at) => {
                const t = gently(Math.max(0, Math.min(1, (lined - at * gap()) / FLIGHT)));
                const [x, y] = places.at(at);
                one.part.hidden = lined === 0;
                one.part.turn = view.facing();
                one.part.at = mix3(one.from, view.ahead(x / shape, y - 0.2, FAR), t);
                one.part.scale = 0.78 + (places.size * reach * 1.5 - 0.78) * t;
            });
            view.draw();
        },
    };

    /** Flat, where the browser cannot draw in 3D: the board straight on. The password is in the words under it. */
    function flat(): void {
        const { ctx } = m;
        const scale = Math.min(m.width / (WIDTH + 20), m.height / (board.height + 20));
        ctx.save();
        ctx.translate((m.width - WIDTH * scale) / 2, (m.height - board.height * scale) / 2);
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
        ctx.font = `700 ${DOWN * 0.5}px ${getComputedStyle(m.canvas).fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        board.shown.forEach((character, at) => ctx.fillText(character, (at + 0.5) * ACROSS, board.shelf + BIN * 0.55));
        ctx.restore();
    }
}
