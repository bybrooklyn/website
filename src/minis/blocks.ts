// Blocks: a small pile with real physics. Pick one up and throw it. To drop a
// new piece (a block, now and then a ball or a wedge), double-click an empty
// spot or press Space: a single click on nothing does nothing, so reaching
// for a block and missing does not add one. Backspace or Delete takes one
// away: the one held, else the one under the pointer, else the newest.
//
// Beside the pile, a column to choose with (under it on a phone): the kind of
// piece dropped (any, a block, a ball, a wedge), its color on two bars as a
// game's color sliders are (every hue in a row, and that hue from light to
// dark), a word for a hue by chance as it has always been, and a word that
// takes a piece away, for a hand with no keyboard. What is chosen is kept
// between visits. The arithmetic of all of it is in tints.ts.

import { Flat, radius, send, trace, wake, type Body, type Mote, type P, type Scene, type Wall } from "../mote";
import { el } from "../mote/stage";
import { choices, deep, grey, HUES, hues, KINDS, kindFor, ramp, tint, tones, toRemove, type Kind } from "./tints";

const MOST = 60;
const FLOOR = 6;
/** Every piece is this big, wherever the pile is shown. */
const SIZE = 40;

export const label = "A pile of blocks. Drag one to throw it. Double-click an empty spot, or press Space, to drop another. Backspace takes one away.";

/** The pile, with what a test or the panel asks of it beside what the stage does. */
export type Blocks = Scene & {
    /** Takes a piece away, as Backspace does; says whether there was one to take. */
    remove(): boolean;
    /** Sets what is dropped next: its kind, its hue (none for a hue by chance) and how dark. */
    choose(to: { kind?: Kind; hue?: number | undefined; dark?: number }): void;
    /** The pieces now in the pile, oldest first: each one's kind and color. */
    pieces(): { kind: Exclude<Kind, "any">; color: string }[];
};

export default function blocks(m: Mote): Blocks {
    const flat = new Flat(2600);
    const pile: Body[] = [];
    /** Each piece's color, whether it is dark enough to want a light line, and its kind. */
    const looks = new Map<Body, { color: string; deep: boolean; kind: Exclude<Kind, "any"> }>();
    let hue = Math.random() * 360;
    /** What is dropped next, as it was left on the last visit. */
    let chosen = choices(m.recall?.("choices", undefined, 1));
    let walls: Wall | undefined;
    const most = m.preview ? 14 : MOST;
    let dropped = 0;
    // The box's corners are rounded, and its walls follow them: how round is read from the page.
    const round = Number.parseFloat(getComputedStyle(m.canvas.parentElement ?? m.canvas).borderTopLeftRadius) || 0;

    const add = (block: Body, kind: Exclude<Kind, "any"> = "block") => {
        // A hue by chance, but never close to the one before it; or the hue chosen. How dark is chosen either way.
        hue += 70 + Math.random() * 220;
        looks.set(block, { color: tint(chosen.hue ?? hue, chosen.dark), deep: deep(chosen.dark), kind });
        pile.push(block);
    };

    const drop = (x: number, y: number) => {
        const kind = kindFor(chosen.kind, Math.random());
        const half = SIZE / 2;
        const block =
            kind === "block" ? flat.box(x, y, SIZE, SIZE)
            : kind === "ball" ? flat.ball(x, y, half, { bounce: 0.35 })
            : flat.shape(x, y, [[0, -half], [half * 1.15, half], [-half * 1.15, half]]);
        send(block, 0, 0, (Math.random() - 0.5) * 1.2);
        add(block, kind);
        if (pile.length > most) {
            const oldest = pile.shift()!;
            flat.remove(oldest);
            looks.delete(oldest);
        }
    };

    /** Takes a piece away: the one held, else the one under the pointer, else the newest. What rested on it wakes and falls. */
    const remove = () => {
        const gone = toRemove(pile, flat.hand.held, m.pointer.inside ? flat.at(m.pointer.x, m.pointer.y) : undefined);
        if (!gone) return false;
        pile.splice(pile.indexOf(gone), 1);
        looks.delete(gone);
        flat.remove(gone);
        for (const block of pile) wake(block);
        m.wake?.();
        return true;
    };

    /** The inside of the box as one closed wall: the top and sides with the box's two upper corners as the curves they are, and the floor, which is flat from side to side. */
    const enclose = () => {
        if (walls) flat.remove(walls);
        const [w, h] = [m.width, m.height - FLOOR];
        const r = Math.min(round, w / 4, h / 4);
        const arc = (cx: number, cy: number, from: number): P[] => Array.from({ length: 7 }, (_, step): P => {
            const angle = from + (step / 6) * (Math.PI / 2);
            return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
        });
        // clockwise from the top left: each upper corner's curve, a quarter turn at a time, then the floor's square ones
        walls = flat.wall(r < 2 ? [[0, 0], [w, 0], [w, h], [0, h]] : [...arc(r, r, Math.PI), ...arc(w - r, r, -Math.PI / 2), [w, h], [0, h]], true);
        for (const block of pile) {
            // a box made narrower or lower would leave the blocks beyond it with no wall around them, falling for ever: they are brought inside
            block.x = Math.min(Math.max(block.x, block.far), Math.max(block.far, w - block.far));
            block.y = Math.min(Math.max(block.y, block.far), Math.max(block.far, h - block.far));
            wake(block);
        }
    };
    /** Anything that has got out of the box all the same is taken away, so the pile can come to rest. */
    const lost = () => {
        for (const block of pile.filter((one) => one.y > m.height + SIZE * 4 || one.x < -SIZE * 4 || one.x > m.width + SIZE * 4)) {
            pile.splice(pile.indexOf(block), 1);
            looks.delete(block);
            flat.remove(block);
        }
    };

    enclose();
    const middle = m.width / 2;
    const floor = m.height - FLOOR;
    // the pile it opens on is the soft one it has always been, whatever was chosen last time
    const first = chosen;
    chosen = { kind: "any", hue: undefined, dark: 0 };
    for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) add(flat.box(middle + column * SIZE, floor - SIZE / 2 - row * SIZE, SIZE, SIZE));
    chosen = first;

    /** The column beside the pile follows what is chosen; set once the column is made. */
    let shown = () => {};
    const choose: Blocks["choose"] = (to) => {
        chosen = choices({ ...chosen, ...to });
        m.keep?.("choices", chosen, 1);
        shown();
    };
    /** A new piece under the pointer, or at the top if the pointer is elsewhere: what Space does. */
    const another = () => drop(m.pointer.inside ? m.pointer.x : m.width / 2, m.pointer.inside ? m.pointer.y : SIZE);

    // Backspace and Delete take a piece away wherever the keyboard is in the mini, the column too; and
    // Space pressed in the column drops a piece as it does on the pile, where it would press again what was pressed last
    (m.canvas.parentElement ?? m.canvas).addEventListener?.("keydown", (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || m.preview) return;
        if (event.key === "Backspace" || event.key === "Delete") remove();
        else if (event.key === " " && event.target !== m.canvas) another();
        else return;
        event.preventDefault();
        // a pile at rest is not being stepped or drawn: it is started again for the piece that came
        m.wake?.();
    });

    // ---- the column to choose with, on a page (the list's small pile has none) ----
    if (typeof document !== "undefined" && !m.preview) {
        /** A group's heading. */
        const group = (words: string) => el("h3", { class: "blocks-group", textContent: words });
        const shapes = el("div", { class: "blocks-choices" });
        shapes.setAttribute("role", "radiogroup");
        shapes.setAttribute("aria-label", "Shape");
        const kinds = KINDS.map((kind) => {
            const input = el("input", { type: "radio", name: "blocks-kind", value: kind, onchange: () => input.checked && choose({ kind }) });
            shapes.append(el("label", {}, input, kind));
            return input;
        });
        /** A bar to slide along: its colors from end to end, and a handle of the color picked. */
        const bar = (name: string, most: number, change: (value: number) => void) => {
            const input = el("input", { type: "range", class: "blocks-bar", min: "0", max: String(most), step: "1", title: name, ariaLabel: name, oninput: () => change(Number(input.value)) });
            return input;
        };
        const hueBar = bar("Hue", HUES, (value) => choose({ hue: value }));
        const darkBar = bar("Darkness", 100, (value) => choose({ dark: value / 100 }));
        const chance = el("button", { type: "button", class: "blocks-chance", textContent: "random", title: "A different color for every piece", onclick: () => choose({ hue: undefined }) });
        const taken = el("button", { type: "button", class: "quiet", textContent: "remove", title: "Take a piece away (Backspace)", onclick: () => void remove() });
        const column = m.panel();
        column.classList.add("blocks-side");
        column.append(group("shape"), shapes, group("color"), hueBar, darkBar, chance, el("div", { class: "blocks-end" }, taken));
        shown = () => {
            kinds.forEach((input, index) => (input.checked = KINDS[index] === chosen.kind));
            chance.setAttribute("aria-pressed", String(chosen.hue === undefined));
            // with a hue by chance the bar of hues has no handle, and keeps the place of the last hue picked for when it has one again
            if (chosen.hue !== undefined) hueBar.value = String(chosen.hue);
            hueBar.classList.toggle("unset", chosen.hue === undefined);
            hueBar.setAttribute("aria-valuetext", chosen.hue === undefined ? "a different color for every piece" : `${chosen.hue} degrees`);
            hueBar.style.setProperty("--bar", ramp(hues(chosen.dark)));
            hueBar.style.setProperty("--handle", tint(chosen.hue ?? 0, chosen.dark));
            darkBar.value = String(Math.round(chosen.dark * 100));
            darkBar.style.setProperty("--bar", ramp(tones(chosen.hue)));
            darkBar.style.setProperty("--handle", chosen.hue === undefined ? grey(chosen.dark) : tint(chosen.hue, chosen.dark));
        };
        shown();
    }

    return {
        remove,
        choose,
        pieces: () => pile.map((block) => ({ kind: looks.get(block)!.kind, color: looks.get(block)!.color })),
        step(dt) {
            flat.step(dt);
            lost();
            // Shown small in a list, it drops a piece by itself every couple of seconds.
            if (m.preview && m.time - dropped > 2.2) {
                dropped = m.time;
                drop(m.width * (0.25 + Math.random() * 0.5), SIZE);
            }
        },
        // the pile brought inside the new walls falls into place, the stage started for it even with no pointer over it
        resize() {
            enclose();
            m.wake?.();
        },
        // Whatever is under the pointer is picked up.
        press: (x, y) => void flat.hand.take(x, y),
        // Pressed twice on an empty spot: a new piece there.
        double(x, y) {
            if (!flat.hand.held && !flat.at(x, y)) drop(x, y);
        },
        // Space: a new piece under the pointer, or at the top if the pointer is elsewhere.
        keydown(name) {
            if (name === "action") another();
        },
        move: (x, y) => flat.hand.move(x, y),
        release: () => flat.hand.drop(),
        // Once every block has come to rest there is nothing left to animate.
        resting: () => !m.preview && flat.still && !flat.hand.held && !m.pointer.inside,
        draw() {
            const { ctx } = m;
            ctx.fillStyle = m.color("--rule");
            ctx.fillRect(0, m.height - FLOOR, m.width, FLOOR);
            for (const block of pile) {
                const look = looks.get(block);
                trace(ctx, block);
                ctx.fillStyle = look?.color ?? tint(0);
                ctx.fill();
                const r = radius(block);
                if (r) {
                    // a spoke, so a rolling ball can be seen to roll
                    const { x, y, a } = block;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
                    // dark on a light piece and light on a dark one
                    ctx.strokeStyle = m.color(look?.deep ? "--ink" : "--ground");
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        },
    };
}
