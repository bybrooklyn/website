// Dice: a dice tower. Pick dice, or type a roll, and they go in at the top,
// tumble down the ramps as real solids and roll out into the tray. When they
// have come to rest the eye goes up over the tray and the number each one
// landed on lights up, lifts off its die and joins a row, sorted by kind of
// die and then by number, over the darkened tray. The tumbling is in tower.ts;
// here it is drawn, by Mote's own 3D drawing (gl.ts), with the dice to pick
// from and a history under it. A roll can be sent as a link: ?roll=2d6+3.

import { fortune, tally, type Luck } from "./luck";
import { gl, seat, type Color, type Mark, type Part } from "../mote/gl";
import { apply, block, cross, mix3, mixTurn, nearness, normals, paint, plus, scaled, spun, turned, upright, type Mesh, type Turn, type V3 } from "../mote/solids";
import { sounds } from "../mote/sound";
import { turn } from "../mote/space";
import { el, gently, toward, type Mote, type Scene } from "../mote/stage";
import { MOST, lineUp, numbers, read, row, total, type Roll } from "./rolls";
import { SHAPES, TOWER, slabs, throwDice, trayFor, type Sides, type Slab, type Throw, type Tray } from "./tower";

export const label = "A dice tower. Dice dropped in at the top tumble down its ramps into a tray.";

const HUES: Record<Sides, number> = { 4: 25, 6: 300, 8: 205, 10: 145, 12: 85, 20: 340 };
/**
 * The color of a die: its kind's hue, and for the second, third and later dice of that kind in a roll a
 * shade of its own (lighter or darker, a little to one side of the hue), so that dice of a kind are told apart.
 */
const hue = (sides: Sides, nth = 0) => {
    const part = (by: number) => (nth * by) % 1;
    const light = nth === 0 ? 0.8 : 0.6 + 0.3 * part(0.618);
    const strong = nth === 0 ? 0.12 : 0.08 + 0.08 * part(0.382);
    return `oklch(${light.toFixed(3)} ${strong.toFixed(3)} ${HUES[sides] + (nth === 0 ? 0 : Math.round(36 * part(0.755) - 18))})`;
};
const INK = "#1a1024";

/** A fair number from 0 to 1, from the browser's own source of chance. */
const chance = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/** What is written on a die. A four-sided one has the number of each corner beside that corner, on every face. */
const written = (sides: Sides) => (face: number): string | Mark[] =>
    sides === 4 ? SHAPES[4].faces[face]!.map((corner, at): Mark => ({ word: String(corner + 1), group: corner + 1, corner: at })) : String(face + 1);
/** The group of marks that says what a die shows. */
const group = (sides: Sides, value: number) => (sides === 4 ? value : value - 1);

/** A die seen from straight above with its highest number on top, drawn small: what the buttons that pick dice show. */
function picture(sides: Sides, word: string, font: string): HTMLCanvasElement {
    const SIZE = 54;
    const canvas = el("canvas", { class: "dice-picture" });
    const scale = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = canvas.height = SIZE * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    const mesh: Mesh = SHAPES[sides];
    const top = mesh.faces.length - 1;
    // turned so that its last face, the highest number, faces the eye
    const out = normals(mesh)[top]!;
    const axis: V3 = Math.abs(out[2]) > 0.999 ? [1, 0, 0] : [out[1], -out[0], 0];
    const long = Math.hypot(...axis);
    const angle = Math.acos(Math.max(-1, Math.min(1, out[2])));
    let facing = spun(upright(), [(axis[0] / long) * angle, (axis[1] / long) * angle, (axis[2] / long) * angle]);
    // and round, so that one corner of that face points up (or, for a square, one side is level)
    const corners = mesh.faces[top]!.map((corner) => mesh.points[corner]!);
    const middle = corners.reduce((sum, corner) => [sum[0] + corner[0] / corners.length, sum[1] + corner[1] / corners.length, sum[2] + corner[2] / corners.length], [0, 0, 0]);
    const first = [0, 1].map((row) => facing[row]![0] * (corners[0]![0] - middle[0]!) + facing[row]![1] * (corners[0]![1] - middle[1]!) + facing[row]![2] * (corners[0]![2] - middle[2]!));
    facing = spun(facing, [0, 0, (corners.length === 4 && sides === 6 ? (Math.PI * 3) / 4 : Math.PI / 2) - Math.atan2(first[1]!, first[0]!)]);
    paint(ctx, mesh, facing, {
        x: SIZE / 2,
        y: SIZE / 2,
        size: (SIZE / 2 - 3) / Math.max(...mesh.points.map((point) => Math.hypot(...point))),
        distance: 30,
        fill: (light) => `oklch(${(0.5 + light * 0.36).toFixed(3)} 0.12 ${HUES[sides]})`,
        edge: `oklch(0.42 0.1 ${HUES[sides]})`,
    });
    ctx.fillStyle = INK;
    ctx.font = `700 ${word.length > 2 ? 13 : word.length > 1 ? 17 : 20}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(word, SIZE / 2, SIZE / 2 + 1);
    return canvas;
}

/** How long a number takes to go from its die to the row, in seconds, and how far in front of the eye the row is. */
const FLIGHT = 0.8;
const FAR = 5;

/** A number on its way from a die to the row: where it left from, and its place in the row. */
interface Lifted {
    /** How wide its words are, in figures: neighbours in the row are spaced for the widest. */
    figures: number;
    dice: number[];
    number: Part;
    kind: Part;
    /** Where it left its die. A number that came from no die (what is added on) has none, and grows in its place. */
    from?: { at: V3; turn: Turn; size: number };
    arrived: boolean;
}

export default function dice(m: Mote): Scene {
    let thrown: Throw | undefined;
    let waiting: { roll: Roll; what: string } | undefined;
    let auto = 0;
    const font = getComputedStyle(m.canvas).fontFamily;

    // ---- the tower, drawn ----
    // Mote's own 3D drawing, on a second canvas under the one that takes the mouse. Where the browser
    // cannot do that, the same things are drawn flat on the first canvas, back to front.
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const view = gl(under);
    if (view) m.canvas.parentElement!.insertBefore(under, m.canvas);
    const tipped = (tip: number): Turn => [[Math.cos(tip), -Math.sin(tip), 0], [Math.sin(tip), Math.cos(tip), 0], [0, 0, 1]];
    const SEEN = { tray: "--surface", wall: "--rule", ramp: "--muted", glass: "--ink" } as const;
    /** The tower and tray as they are drawn: set up again when a throw needs a larger tray. */
    let tray: Tray | undefined;
    let pieces: Slab[] = [];
    let standing: Part[] = [];
    const stand = (next: Tray) => {
        if (tray && tray.right === next.right && tray.deep === next.deep) return;
        tray = next;
        const ground: Slab = { at: [(next.left + next.right) / 2, -0.1, 0], half: [(next.right - next.left) / 2, 0.1, next.deep], tip: 0, kind: "tray" };
        pieces = [ground, ...slabs(next)].filter((slab) => slab.kind !== "unseen");
        if (!view) return;
        for (const part of standing) view.remove(part);
        standing = pieces.map((slab) => {
            const kind = slab.kind as keyof typeof SEEN;
            const piece = view.add(block(slab.half), { color: view.color(m.color(SEEN[kind])), alpha: kind === "glass" ? 0.035 : 1, casts: kind === "ramp" || kind === "tray" });
            piece.at = slab.at;
            piece.turn = tipped(slab.tip);
            return piece;
        });
        view.light([7, 17, 10], [next.left - 0.5, -0.5, -next.deep - 0.5], [next.right + 0.5, TOWER.top + 3, next.deep + 0.5]);
    };
    let models: { part: Part; color: Color; look: { color: Color } }[] = [];
    if (view) view.font = font;
    stand(trayFor(0));

    // ---- the eye: beside the tower while the dice fall, then up over them once they have landed ----
    const BESIDE: [V3, V3] = [[9.5, 12, 22.5], [0.3, 4.9, 0]];
    let above: [V3, V3] = BESIDE;
    /** How far the eye has gone from beside to above, and how far the numbers are lit, each from 0 to 1. */
    let over = 0;
    let shine = 0;
    const landed = () => Boolean(thrown?.done());
    /** The numbers that have left their dice for the row, the sum under them, and how long ago they set off. */
    let lifted: Lifted[] = [];
    let sum: Part | undefined;
    let lined = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sound = m.preview ? undefined : sounds(m);
    /** How far along its flight the number in this place of the row is, from 0 to 1. Each sets off a moment after the one before. */
    const flown = (place: number) => Math.max(0, Math.min(1, (lined - place * Math.min(0.12, FLIGHT / lifted.length)) / FLIGHT));
    const lastIn = () => FLIGHT + (lifted.length - 1) * Math.min(0.12, FLIGHT / Math.max(1, lifted.length));
    const wide = () => (m.width / Math.max(1, m.height) < 1.1 ? 30 / Math.max(0.55, m.width / Math.max(1, m.height) / 1.1) : 30);
    const aim = () => {
        if (!view) return;
        // eased, so that it sets off and arrives gently
        const t = over * over * (3 - 2 * over);
        const mix = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        view.look(mix(BESIDE[0], above[0]), mix(BESIDE[1], above[1]), wide() + (30 - wide()) * t);
    };

    const show = (next: Throw) => {
        for (const old of models) view?.remove(old.part);
        for (const old of lifted) {
            view?.remove(old.number);
            view?.remove(old.kind);
        }
        if (sum) view?.remove(sum);
        [lifted, sum, lined] = [[], undefined, 0];
        thrown = next;
        stand(next.tray);
        // a knock for every hard meeting, higher for die on die than for die on wood
        next.space.hit = (a, b, speed) => sound?.knock(speed / 16, a.im && b.im ? 1500 : 700);
        const seen: Partial<Record<Sides, number>> = {};
        models = view
            ? next.dice.map((die) => {
                  const nth = (seen[die.sides] = (seen[die.sides] ?? -1) + 1);
                  const color = view.color(hue(die.sides, nth));
                  const look = { color: [...color] as Color, marks: written(die.sides), ink: [0.1, 0.06, 0.14] as Color };
                  return { part: view.add(SHAPES[die.sides], look), color, look };
              })
            : [];
    };
    const fit = () => {
        view?.size(m.width, m.height);
        aim();
    };
    fit();

    // ---- what is kept between visits: the last rolls ----
    let history = m.recall<{ what: string; said: string; total: number }[]>("dice", []);
    /** Every number each kind of die has shown here, kept between visits: what "luck" is worked out from. */
    let luck = m.recall<Luck>("dice-luck", {});
    /** The roll last sent down the tower, as it is written: what a link to it carries. */
    let last = "";

    // ---- rolling ----
    let said: HTMLElement | undefined;
    const say = (text: string) => {
        if (said) said.textContent = text;
    };
    let render = () => {};
    const send = (text: string, what = text) => {
        const roll = read(text);
        if (typeof roll === "string") return say(roll);
        show(throwDice(roll.dice, chance));
        // a roll opened from a link is no longer the one in the address once another is made
        if (m.link.get("roll") && m.link.get("roll") !== what) m.link.set("roll", null);
        waiting = { roll, what };
        last = what;
        say("Rolling…");
        m.wake();
    };
    const land = () => {
        if (!thrown) return;
        const values = thrown.values();
        // where the eye goes: over the middle of the dice, high enough to see them all with room around
        const xs = thrown.dice.map((die) => die.body.p[0]);
        const zs = thrown.dice.map((die) => die.body.p[2]);
        const [cx, cz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
        const [halfX, halfZ] = [(Math.max(...xs) - Math.min(...xs)) / 2 + 0.9, (Math.max(...zs) - Math.min(...zs)) / 2 + 0.9];
        const reach = Math.tan((15 * Math.PI) / 180);
        const high = Math.max(4.4, halfZ / reach, halfX / (reach * (m.width / Math.max(1, m.height))));
        // not quite straight above: a touch toward the front, so that the tray keeps its way up
        above = [[cx, high, cz + high * 0.1], [cx, 0.3, cz]];
        models.forEach((model, index) => {
            model.part.lit = group(thrown!.dice[index]!.sides, values[index]!);
        });
        // a copy of each number, to lift off its die: it starts where the number is written, the same size and the same way up
        if (view && !m.preview && waiting) {
            const rolled = numbers(waiting.roll, values);
            lifted = lineUp(rolled).map((place) => {
                const { sides, value, dropped, sign, dice: [index = 0] } = rolled[place]!;
                const die = thrown!.dice[index]!;
                const turned = turn(die.body);
                let from: Lifted["from"];
                if (die.sides === 4) {
                    // a four-sided die is read from its top corner, which has no face: its number rises from just above it
                    from = { at: plus(die.body.p, [0, 0.9, 0]), turn: view.facing(), size: 0.3 };
                } else {
                    const { middle, out, up, room } = seat(SHAPES[die.sides], values[index]! - 1);
                    const [x, y, z] = [apply(turned, cross(up, out)), apply(turned, up), apply(turned, out)];
                    from = { at: plus(die.body.p, apply(turned, plus(middle, scaled(out, 0.01)))), turn: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]], size: room * 2 };
                }
                // one taken away has its minus; one left out of the sum is dim, so the bright ones are what add up
                const words = `${sign < 0 ? "-" : ""}${value}`;
                const number = view.sign(words, dropped ? view.color(m.color("--muted")) : [1, 1, 1]);
                const kind = view.sign(dropped ? "dropped" : `d${sides}`, view.color(m.color("--muted")));
                number.hidden = kind.hidden = true;
                number.emit = dropped ? 0.35 : 1;
                kind.emit = 0.55;
                return { figures: words.length, dice: rolled[place]!.dice, number, kind, from, arrived: false };
            });
            // what is added on or taken off has a place at the end of the row, so the row adds up to the sum under it
            if (waiting.roll.plus) {
                const words = `${waiting.roll.plus < 0 ? "-" : "+"}${Math.abs(waiting.roll.plus)}`;
                const number = view.sign(words, [1, 1, 1]);
                const kind = view.sign(waiting.roll.plus < 0 ? "less" : "added", view.color(m.color("--muted")));
                number.hidden = kind.hidden = true;
                number.emit = 1;
                kind.emit = 0.55;
                lifted.push({ figures: words.length, dice: [], number, kind, arrived: false });
            }
        }
        if (!waiting) return;
        const { roll, what } = waiting;
        waiting = undefined;
        const result = total(roll, values);
        // the sum under the row, unless one die with nothing added says it already
        if (lifted.length > 0 && (lifted.length > 1 || roll.plus)) {
            sum = view!.sign(`= ${result.total}`, view!.color(m.color("--accent")));
            sum.hidden = true;
            sum.emit = 1;
        }
        history = [{ what, said: result.said, total: result.total }, ...history].slice(0, 30);
        m.keep("dice", history);
        for (const one of numbers(roll, values)) tally(luck, one.sides, one.value);
        m.keep("dice-luck", luck);
        render();
        say(`${what}: ${result.total}`);
    };

    // ---- under the tower: the dice to pick from, a typed roll, and what was rolled ----
    if (!m.preview) {
        const panel = m.panel();
        // The roll is made by pressing: a die adds one of itself, the small controls under it take one
        // away and say which to keep, and a number can be added to the total. Nothing is typed.
        const KINDS = [4, 6, 8, 10, 12, 20, 100] as const;
        type Kind = (typeof KINDS)[number];
        const KEEPS = { all: "", highest: " kh1", lowest: " kl1", "drop lowest": " dl", "drop highest": " dh" } as const;
        type Keep = keyof typeof KEEPS;
        const hand: Partial<Record<Kind, number>> = {};
        const keeps: Partial<Record<Kind, Keep>> = {};
        let added = 0;
        /** How many dice go down the tower for what is in the hand: a d100 is two. */
        const held = () => KINDS.reduce((sum, kind) => sum + (hand[kind] ?? 0) * (kind === 100 ? 2 : 1), 0);
        /** The hand as a roll is written, which is also what a link to it carries. */
        const handText = () =>
            KINDS.filter((kind) => hand[kind]).map((kind) => `${hand[kind]}d${kind}${hand[kind]! > 1 ? KEEPS[keeps[kind] ?? "all"] : ""}`).join(" + ") + (added ? ` ${added > 0 ? "+" : "-"} ${Math.abs(added)}` : "");

        said = el("p", { class: "table-said", textContent: "Pick dice and send them down the tower." });
        said.setAttribute("aria-live", "polite");
        const parts = new Map<Kind, { kind: HTMLElement; badge: HTMLElement; more: HTMLElement; keep: HTMLButtonElement }>();
        const addedText = el("span", { class: "dice-added", textContent: "0" });
        const refresh = () => {
            for (const [sides, part] of parts) {
                const count = hand[sides] ?? 0;
                // (an emptied one keeps its number while it shrinks away)
                if (count) part.badge.textContent = String(count);
                part.kind.classList.toggle("on", count > 0);
                part.more.inert = count === 0;
                part.keep.disabled = count < 2;
                part.keep.textContent = count < 2 ? "all" : (keeps[sides] ?? "all");
            }
            addedText.textContent = added > 0 ? `+${added}` : added < 0 ? `\u2212${-added}` : "0";
        };
        const empty = () => {
            for (const kind of KINDS) {
                delete hand[kind];
                delete keeps[kind];
            }
            added = 0;
            refresh();
        };
        // each die as it looks from above, with its highest number on top
        const picks = KINDS.map((sides) => {
            const badge = el("span", { class: "dice-count" });
            const add = () => {
                if (held() + (sides === 100 ? 2 : 1) > MOST) return say(`${MOST} dice is the most the tower takes.`);
                hand[sides] = (hand[sides] ?? 0) + 1;
                refresh();
            };
            const pick = el("button", { type: "button", class: "dice-pick", onclick: add }, picture(sides === 100 ? 10 : sides, String(sides), font), el("span", { class: "dice-name", textContent: `d${sides}` }), badge);
            pick.setAttribute("aria-label", `Add a d${sides}`);
            const less = el("button", { type: "button", class: "quiet", textContent: "one less", onclick: () => { hand[sides] = Math.max(0, (hand[sides] ?? 0) - 1); refresh(); } });
            less.setAttribute("aria-label", `One d${sides} less`);
            // which of several to count: pressing it goes round the choices
            const keep = el("button", { type: "button", class: "quiet", textContent: "all", onclick: () => {
                const order = Object.keys(KEEPS) as Keep[];
                keeps[sides] = order[(order.indexOf(keeps[sides] ?? "all") + 1) % order.length]!;
                refresh();
            } });
            keep.setAttribute("aria-label", `Which d${sides} to count`);
            const more = el("div", { class: "dice-more" }, el("div", {}, less, keep));
            more.inert = true;
            const kind = el("div", { class: "dice-kind" }, pick, more);
            parts.set(sides, { kind, badge, more, keep });
            return kind;
        });
        const nudge = (by: number, label: string, word: string) => {
            const button = el("button", { type: "button", class: "quiet", textContent: word, onclick: () => { added = Math.max(-99, Math.min(99, added + by)); refresh(); } });
            button.setAttribute("aria-label", label);
            return button;
        };
        const clear = el("button", { type: "button", class: "quiet", textContent: "clear", onclick: empty });
        const go = el("button", { type: "button", class: "dice-go", textContent: "roll", onclick: () => (held() ? send(handText()) : say("Pick some dice first.")) });
        const rollRow = el("div", { class: "table-typed" }, el("span", { class: "dice-add" }, el("span", { class: "dice-add-name", textContent: "add" }), nudge(-1, "Add one less to the total", "\u2212"), addedText, nudge(1, "Add one more to the total", "+")), clear, go);
        // the roll just made, as a link that makes it again for whoever opens it
        const share = el("button", { type: "button", class: "quiet", textContent: "copy link to this roll", onclick: () => {
            if (!last) return;
            const address = m.link.set("roll", last);
            // the button keeps its width while its words change, so nothing beside it jumps
            share.style.minWidth = `${share.offsetWidth}px`;
            navigator.clipboard?.writeText(address).then(() => (share.textContent = "link copied"), () => (share.textContent = "the link is in the address bar"));
            setTimeout(() => (share.textContent = "copy link to this roll"), 2500);
        } });
        const list = el("ol", { class: "table-history" });
        /** Gives an element a number for its stylesheet to draw with. */
        const styled = <T extends HTMLElement>(node: T, name: string, value: number): T => (node.style.setProperty(name, String(value)), node);
        const fortunes = el("ul", { class: "dice-luck" });
        const forget = el("button", { type: "button", class: "quiet", textContent: "forget these", onclick: () => { luck = {}; m.keep("dice-luck", luck); render(); } });
        panel.append(said, el("div", { class: "dice-picks" }, ...picks), rollRow, el("div", { class: "table-go" }, share, sound!.button), el("h2", { textContent: "rolls" }), list, el("h2", { textContent: "luck" }), fortunes, el("div", { class: "table-go" }, forget));
        render = () => {
            list.replaceChildren(...history.map((entry) => el("li", {}, el("strong", { textContent: String(entry.total) }), ` ${entry.what}`, el("span", { textContent: ` ${entry.said}` }))));
            // each kind of die rolled here: how many, their average beside what chance says, and how often each number came up
            const told = fortune(luck);
            fortunes.replaceChildren(...(told.length ? told : [{ sides: 0, line: "Nothing rolled yet.", bars: [] as number[], even: 0 }]).map((one) =>
                el("li", {}, el("span", { class: "dice-luck-line", textContent: one.line }), styled(el("span", { class: "dice-luck-bars" }, ...one.bars.map((tall) => styled(el("i"), "--tall", tall))), "--even", one.even)),
            ));
            forget.disabled = told.length === 0;
        };
        render();
        // opened from a link to a roll: that roll goes down the tower
        const asked = m.link.get("roll");
        if (asked) send(asked);
        refresh();
    }

    return {
        step(dt) {
            // Shown small in a list, it rolls a few dice by itself now and then.
            if (m.preview && m.time - auto > 8) {
                auto = m.time;
                show(throwDice([20, 6, 8], chance));
            }
            if (thrown && !thrown.done()) {
                thrown.step(dt);
                if (thrown.done()) land();
            }
            // the eye goes up over the dice in a little under a second, and comes back faster; the numbers light as it arrives
            over = landed() ? Math.min(1, over + dt / 0.9) : Math.max(0, over - dt / 0.45);
            shine = landed() && over > 0.6 ? Math.min(1, shine + dt / 0.35) : landed() ? shine : 0;
            // once the numbers are lit they leave for the row, and the tray darkens behind them
            const leaving = lifted.length > 0 && shine === 1;
            if (leaving) lined = still ? lastIn() : lined + dt;
            if (view) view.shade = toward(view.shade, leaving ? 0.72 : 0, dt * 0.72, 0.4);
        },
        resize: fit,
        // Clicking the tower before anything has been rolled sends a d20 down it. After that a click does nothing: it would take the row of numbers away.
        press() {
            if (!thrown) send("d20");
        },
        resting: () => !m.preview && (!thrown || (landed() && over === 1 && shine === 1 && lined >= lastIn())) && (view?.shade ?? 0) === (lifted.length > 0 && thrown ? 0.72 : 0),
        debug: () => (thrown ? [`${thrown.space.solids.filter((solid) => solid.im && solid.quiet < 0.4).length} of ${thrown.dice.length} dice moving`] : []),
        draw() {
            if (view) {
                aim();
                // the row: each number from its die to its place in front of the eye, turning to face it and growing
                const figures = Math.max(1, ...lifted.map((one) => one.figures));
                const places = row(lifted.length, m.width / Math.max(1, m.height), figures >= 3 ? 1.95 : figures === 2 ? 1.55 : 1.2);
                const reach = FAR * Math.tan((15 * Math.PI) / 180);
                const shape = m.width / Math.max(1, m.height);
                const gone = new Map<number, number>();
                lifted.forEach((one, place) => {
                    const t = gently(flown(place));
                    for (const die of one.dice) gone.set(die, t);
                    const [x, y] = places.at(place);
                    one.number.hidden = one.kind.hidden = lined === 0;
                    const [there, full] = [view.ahead(x / shape, y, FAR), places.size * reach * 1.5];
                    one.number.at = one.from ? mix3(one.from.at, there, t) : there;
                    one.number.turn = one.from ? mixTurn(one.from.turn, view.facing(), t) : view.facing();
                    one.number.scale = one.from ? one.from.size + (full - one.from.size) * t : full * t;
                    // what kind of die it was, under it, once it is nearly there
                    one.kind.at = view.ahead(x / shape, y - places.size * 0.6, FAR);
                    one.kind.turn = view.facing();
                    one.kind.scale = places.size * reach * 0.62 * gently(Math.max(0, flown(place) * 3 - 2));
                    if (t === 1 && !one.arrived) {
                        one.arrived = true;
                        sound?.tone(440 * 2 ** (place / 12), 0.25, 0.05);
                    }
                });
                if (sum) {
                    const [, lowest] = places.at(lifted.length - 1);
                    sum.hidden = lined === 0;
                    sum.at = view.ahead(0, lowest - places.size * 1.45, FAR);
                    sum.turn = view.facing();
                    sum.scale = places.size * reach * 1.9 * gently(Math.max(0, Math.min(1, (lined - lastIn() + 0.3) / 0.3)));
                }
                thrown?.dice.forEach((die, index) => {
                    const { part, color, look } = models[index]!;
                    part.hidden = die.waiting;
                    part.at = die.body.p;
                    part.turn = turn(die.body);
                    // the number on the die goes back to ink as its copy leaves
                    part.shine = shine * (1 - (gone.get(index) ?? 0));
                    // the die itself goes dimmer as its number lights, so that the number is what is bright
                    look.color = [color[0] * (1 - 0.4 * shine), color[1] * (1 - 0.4 * shine), color[2] * (1 - 0.4 * shine)];
                });
                view.draw();
                return;
            }
            // Flat, without the graphics card: everything back to front, each shaded by how it faces the light.
            const eye = turned(upright(), -0.42, 0.38);
            const flat = { x: m.width * 0.5, y: m.height * 0.78, size: Math.min(m.width / 14, m.height / 12), distance: 40, view: eye };
            const things = [
                ...pieces.filter((slab) => slab.kind !== "glass").map((slab) => ({ mesh: block(slab.half), at: slab.at, turn: tipped(slab.tip), sides: 0 as Sides | 0, css: m.color(SEEN[slab.kind as keyof typeof SEEN]) })),
                ...(thrown?.dice ?? []).filter((die) => !die.waiting).map((die) => ({ mesh: SHAPES[die.sides], at: die.body.p, turn: turn(die.body), sides: die.sides as Sides | 0, css: "" })),
            ].sort((a, b) => nearness(a.at, eye) - nearness(b.at, eye));
            for (const thing of things) {
                paint(m.ctx, thing.mesh, thing.turn, {
                    ...flat,
                    at: thing.at,
                    fill: (light) => (thing.sides ? `oklch(${(0.45 + light * 0.4).toFixed(3)} 0.12 ${HUES[thing.sides]})` : `color-mix(in oklab, ${thing.css}, black ${Math.round((1 - light) * 45)}%)`),
                    label: thing.sides && thing.sides !== 4 ? (face) => String(face + 1) : undefined,
                    ink: INK,
                    font,
                });
            }
        },
    };
}
