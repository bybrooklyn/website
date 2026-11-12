// Plinko: a sloped table of posts that makes a password. Every ball is a character. They are let go
// one after another at the top, roll and knock their way down between the posts, and drop off the
// foot of the table into a bin. The password is the balls in the order they got there. When the last
// has settled the eye goes up over the bin, the table darkens, and each character lifts off its ball
// into a glowing row. What makes the password fair is in board.ts; here the table is drawn, by Mote's
// 3D drawing, with its settings under it.

import { gl, type Color, type Part } from "../mote/gl";
import { ball, block, mix3, rod, type Turn, type V3 } from "../mote/solids";
import { sounds } from "../mote/sound";
import { turn, type Solid } from "../mote/space";
import { el, gently, toward, type Mote, type Scene } from "../mote/stage";
import { BALL, BIN, DEEP, DEFAULTS, LIMITS, POST, TALL, TILT, WIDE, alphabet, drop, strength, type Board, type Settings } from "./board";
import { row } from "./rolls";

export const label = "A sloped table of posts. Balls with a character on each roll down it into a bin, and the order they arrive in is a password.";

/** How long a character takes from its ball to the row, in seconds, and how far in front of the eye the row is. */
const FLIGHT = 0.7;
const FAR = 5;
const mix = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** One turn after another. */
const after = (first: Turn, then: Turn): Turn => then.map((line) => [0, 1, 2].map((column) => line[0]! * first[0]![column]! + line[1]! * first[1]![column]! + line[2]! * first[2]![column]!)) as Turn;
/** The table is drawn tipped up at its far end by TILT, which the physics has as a tipped pull. */
const TIPPED: Turn = [[1, 0, 0], [0, Math.cos(TILT), -Math.sin(TILT)], [0, Math.sin(TILT), Math.cos(TILT)]];
/** Stands a rod, which is made lying along z, on its end. */
const UPRIGHT: Turn = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];

export default function plinko(m: Mote): Scene {
    const kept = m.recall<Partial<Settings>>("plinko", {});
    const within = (name: "rows" | "gravity" | "bounce" | "length", value: number) => Math.max(LIMITS[name][0], Math.min(LIMITS[name][1], value));
    let settings: Settings = { ...DEFAULTS, ...kept };
    for (const name of ["rows", "gravity", "bounce", "length"] as const) settings[name] = within(name, settings[name]);
    // Until the first drop the table stands empty.
    let board: Board = drop({ ...settings, length: 0 });
    /** Standing empty, balls on the table, all in the bin and coming to rest, or the password shown. */
    let phase: "idle" | "dropping" | "settling" | "shown" = "idle";
    let since = 0;
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
    const tint = (name: string, by = 1): Color => view!.color(m.color(name)).map((value) => value * by) as Color;
    /** A place on the table, as the picture has it: the table's middle at the picture's, and its far end tipped up. */
    const place = ([x, y, z]: V3): V3 => {
        const along = z - board.long / 2;
        return [x, y * Math.cos(TILT) - along * Math.sin(TILT), y * Math.sin(TILT) + along * Math.cos(TILT)];
    };

    // ---- the table, drawn ----
    let fixed: Part[] = [];
    /** Each post, how lately it was struck, and the color of the ball that struck it. */
    const posts = new Map<Solid, { part: Part; look: { color: Color }; struck: number; by: Color }>();
    /** Each ball: itself, its character written on an unseen box around it, and its color. */
    let balls: { part: Part; words: Part; color: Color }[] = [];
    /** The characters that have lifted off their balls, in the password's order, and how long ago they set off. */
    let lifted: { part: Part; from: V3 }[] = [];
    let lined = 0;
    /** How far the eye has gone from beside the table to over the bin, from 0 to 1. */
    let over = 0;
    let plain: Color = [0.4, 0.4, 0.4];
    const ballMesh = ball(BALL);
    const wordsMesh = block([BALL * 1.01, BALL * 1.01, BALL * 1.01]);
    const gap = () => Math.min(0.05, FLIGHT / Math.max(1, lifted.length));
    const lastIn = () => FLIGHT + (lifted.length - 1) * gap();

    const build = () => {
        if (!view) return;
        for (const part of [...fixed, ...[...posts.values()].map((post) => post.part), ...balls.flatMap((one) => [one.part, one.words]), ...lifted.map((one) => one.part)]) view.remove(part);
        posts.clear();
        [lifted, lined, over] = [[], 0, 0];
        const { long, line } = board;
        const slab = (at: V3, half: V3, color: Color, more: { alpha?: number; casts?: boolean } = {}) => {
            const part = view.add(block(half), { color, ...more });
            part.at = place(at);
            part.turn = TIPPED;
            return part;
        };
        fixed = [
            // the table, darker than the page so that what is lit shows on it; the bin's floor; the sides; the two ends
            slab([0, -0.2, line / 2 - 0.25], [WIDE / 2, 0.2, line / 2 + 0.25], tint("--surface", 0.75)),
            slab([0, -DEEP - 0.15, line + BIN / 2], [WIDE / 2, 0.15, BIN / 2], tint("--ground", 0.8)),
            slab([0, -DEEP / 2 - 0.2, line - 0.1], [WIDE / 2, DEEP / 2 - 0.2, 0.1], tint("--surface", 0.5), { casts: false }),
            ...[-1, 1].map((side) => slab([side * (WIDE / 2 + 0.2), -DEEP / 2 + 0.25, long / 2], [0.2, DEEP / 2 + 0.55, long / 2 + 0.2], tint("--rule"), { casts: false })),
            slab([0, 0.3, -0.2], [WIDE / 2 + 0.4, 0.5, 0.2], tint("--rule"), { casts: false }),
            slab([0, -DEEP / 2 - 0.1, long + 0.2], [WIDE / 2 + 0.4, DEEP / 2 + 0.1, 0.2], tint("--rule"), { casts: false }),
        ];
        plain = tint("--muted", 0.75);
        const postMesh = rod(POST, TALL);
        for (const post of board.posts) {
            const look = { color: plain };
            const part = view.add(postMesh, look);
            part.at = place([post.x, TALL / 2, post.z]);
            part.turn = after(UPRIGHT, TIPPED);
            posts.set(post.body, { part, look, struck: 0, by: plain });
        }
        balls = board.balls.map((one, index) => {
            const color = view.color(`oklch(0.86 0.11 ${(index * 47) % 360})`);
            const part = view.add(ballMesh, { color });
            const words = view.add(wordsMesh, { color, bare: true, marks: () => one.character, ink: [0.08, 0.05, 0.12] });
            part.hidden = words.hidden = true;
            return { part, words, color };
        });
        view.light([-6, 16, 9], [-WIDE / 2 - 1, -long / 2 - 1, -long / 2 - 1], [WIDE / 2 + 1, long / 2 + 1, long / 2 + 1], 1.5, 0.8, 0.4);
        aim();
    };
    /** The eye: in front of the foot of the table and above it while the balls roll, then up over the bin. */
    const aim = () => {
        if (!view) return;
        view.size(m.width, m.height);
        const shape = m.width / Math.max(1, m.height);
        const reach = Math.tan((15 * Math.PI) / 180);
        // far enough back to see the whole table, from its top end to the bin, however wide the picture is
        const back = Math.max(board.long * 1.55, (WIDE + 2.5) / (2 * reach * shape));
        const beside: [V3, V3] = [[0, back * 0.8, back * 0.6], [0, -1.3, 0.9]];
        const bin = place([0, -DEEP / 2, board.line + BIN / 2]);
        const high = Math.max(BIN * 2.4, (WIDE + 1.5) / (2 * reach * shape));
        const above: [V3, V3] = [[bin[0], bin[1] + high, bin[2] + high * 0.35], bin];
        const t = gently(over);
        view.look(mix3(beside[0], above[0], t), mix3(beside[1], above[1], t), 30);
    };

    // ---- under the table: the password, and the settings ----
    let finish = () => {};
    let ready = () => {};
    const start = (count = settings.length) => {
        board = drop({ ...settings, length: count });
        [phase, since] = ["dropping", 0];
        build();
        // a knock for each post struck, higher the further down the table, and the post lights in the ball's color
        board.space.hit = (a, b, speed) => {
            const [post, other] = posts.has(a) ? [posts.get(a), b] : [posts.get(b), a];
            if (post) {
                post.struck = 1;
                post.by = balls[board.balls.findIndex((one) => one.body === other)]?.color ?? plain;
                sound?.knock(speed / 14, 600 + (other.p[2] / board.long) * 900);
            } else if (a.im && b.im) sound?.knock(speed / 20, 1700);
        };
        board.landed = (one) => sound?.tone(330 * 2 ** ((one.place! % 12) / 12), 0.15, 0.04);
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
            if (phase !== "idle") return;
            word.hidden = copy.disabled = true;
            said.textContent = "Press drop for a password.";
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
            el("h2", { textContent: "the table" }),
            el("div", { class: "plinko-settings" }, slide("rows", "rows of posts", 1), slide("bounce", "bounce", 0.05), slide("gravity", "gravity", 0.1)),
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
            // Shown small in a list, it lets a few balls go by itself now and then.
            if (m.preview && phase !== "dropping" && m.time - auto > 11) {
                auto = m.time;
                start(8);
            }
            if (phase === "dropping" || phase === "settling") board.step(dt);
            if (phase === "dropping" && board.done()) [phase, since] = ["settling", 0];
            since += dt;
            // once they are all in the bin and lying still (or have had long enough), the characters leave their balls
            if (phase === "settling" && !m.preview && (board.space.still() || since > 4)) {
                [phase, since] = ["shown", 0];
                if (view) lifted = board.order.map((one) => {
                    const part = view.sign(one.character, [1, 1, 1]);
                    part.emit = 1;
                    part.hidden = true;
                    return { part, from: place(one.body.p) };
                });
                finish();
                sound?.tone(660, 0.6, 0.06);
                sound?.tone(990, 0.6, 0.04);
            }
            for (const post of posts.values()) post.struck = Math.max(0, post.struck - dt * 2.2);
            const shown = phase === "shown";
            over = toward(over, shown ? 1 : 0, dt, shown ? 0.9 : 0.45);
            if (shown && over > 0.7 && lifted.length > 0) lined = still ? lastIn() : lined + dt;
            if (view) view.shade = toward(view.shade, shown && over > 0.7 ? 0.72 : 0, dt * 0.72, 0.4);
        },
        resize: aim,
        // Clicking the table before anything has been dropped lets the balls go. After that a click does nothing: it would take the password away.
        press() {
            if (phase === "idle" && !m.preview) start();
        },
        resting: () => !m.preview && (phase === "idle" || (phase === "shown" && over === 1 && lined >= lastIn() && (view?.shade ?? 0) === (lifted.length > 0 ? 0.72 : 0))) && [...posts.values()].every((post) => post.struck === 0),
        debug: () => [`${board.balls.filter((one) => !one.waiting && one.place === undefined).length} balls on the table, ${board.order.length} in the bin, ${board.late} out of time`, phase],
        draw() {
            if (!view) return flat();
            aim();
            for (const post of posts.values()) {
                post.look.color = mix(plain, post.by, post.struck);
                post.part.emit = post.struck * 1.2;
            }
            board.balls.forEach((one, index) => {
                const drawn = balls[index];
                if (!drawn) return;
                drawn.part.hidden = drawn.words.hidden = one.waiting;
                drawn.part.at = drawn.words.at = place(one.body.p);
                drawn.words.turn = after(turn(one.body), TIPPED);
                drawn.part.emit = 0.12;
            });
            // the row: each character from its ball to its place in front of the eye, growing as it goes
            const shape = m.width / Math.max(1, m.height);
            const places = row(lifted.length, shape);
            const reach = FAR * Math.tan((15 * Math.PI) / 180);
            lifted.forEach((one, at) => {
                const t = gently(Math.max(0, Math.min(1, (lined - at * gap()) / FLIGHT)));
                const [x, y] = places.at(at);
                one.part.hidden = lined === 0;
                one.part.turn = view.facing();
                one.part.at = mix3(one.from, view.ahead(x / shape, y - 0.2, FAR), t);
                one.part.scale = BALL * 1.6 + (places.size * reach * 1.5 - BALL * 1.6) * t;
            });
            view.draw();
        },
    };

    /** Flat, where the browser cannot draw in 3D: the table seen from straight above, with no light or glow. */
    function flat(): void {
        const { ctx } = m;
        const scale = Math.min(m.width / (WIDE + 1), m.height / (board.long + 1));
        ctx.save();
        ctx.translate(m.width / 2, (m.height - board.long * scale) / 2);
        ctx.scale(scale, scale);
        const dot = (x: number, z: number, r: number, color: string) => {
            ctx.beginPath();
            ctx.arc(x, z, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        };
        ctx.fillStyle = m.color("--surface");
        ctx.fillRect(-WIDE / 2, 0, WIDE, board.long);
        ctx.fillStyle = m.color("--ground");
        ctx.fillRect(-WIDE / 2, board.line, WIDE, BIN);
        for (const post of board.posts) dot(post.x, post.z, POST, m.color("--muted"));
        ctx.font = `700 ${BALL * 1.3}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const one of board.balls) {
            if (one.waiting) continue;
            dot(one.body.p[0], one.body.p[2], BALL, m.color("--accent"));
            ctx.fillStyle = m.color("--ground");
            ctx.fillText(one.character, one.body.p[0], one.body.p[2]);
        }
        ctx.restore();
    }
}
