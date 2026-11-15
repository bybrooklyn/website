// Blocks: a small pile with real physics. Pick one up and throw it. To drop a
// new piece (a block, now and then a ball or a wedge), double-click an empty
// spot or press Space: a single click on nothing does nothing, so reaching
// for a block and missing does not add one. Backspace or Delete takes one
// away: the one held, else the one under the pointer, else the newest.
//
// Under the pile, a row to choose with: the kind of piece dropped (any, a
// block, a ball, a wedge), its color (a wheel of hues and how dark, or a
// hue by chance as it has always been), and a word that takes a piece away,
// for a hand with no keyboard. What is chosen is kept between visits. The
// arithmetic of all of it is in tints.ts.

import { Flat, radius, send, trace, wake, type Body, type Mote, type P, type Scene, type Wall } from "../mote";
import { el } from "../mote/stage";
import { choices, deep, hueAt, KINDS, kindFor, placeOf, tint, toRemove, type Kind } from "./tints";

const MOST = 60;
const FLOOR = 6;
/** Every piece is this big, wherever the pile is shown. */
const SIZE = 40;
/** How far an arrow key turns the wheel, in degrees. */
const TURN = 5;

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

    /** The row under the pile follows what is chosen; set once the row is made. */
    let shown = () => {};
    const choose: Blocks["choose"] = (to) => {
        chosen = choices({ ...chosen, ...to });
        m.keep?.("choices", chosen, 1);
        shown();
    };

    // Backspace and Delete, only while the pile has the keyboard, as Mote's own keys are
    m.canvas.addEventListener?.("keydown", (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || m.preview || (event.key !== "Backspace" && event.key !== "Delete")) return;
        event.preventDefault();
        remove();
    });

    // ---- the row to choose with, on a page (the list's small pile has none) ----
    if (typeof document !== "undefined" && !m.preview) {
        const shape = (kind: Kind) => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("aria-hidden", "true");
            const part = (tag: string, set: Record<string, string>) => {
                const made = document.createElementNS("http://www.w3.org/2000/svg", tag);
                for (const [name, value] of Object.entries(set)) made.setAttribute(name, value);
                svg.append(made);
            };
            const block = (x: number, y: number, size: number) => part("rect", { x: `${x}`, y: `${y}`, width: `${size}`, height: `${size}`, rx: "1.5" });
            const ball = (x: number, y: number, r: number) => part("circle", { cx: `${x}`, cy: `${y}`, r: `${r}` });
            const wedge = (x: number, y: number, size: number) => part("path", { d: `M${x} ${y - size * 0.55}L${x + size * 0.65} ${y + size * 0.5}H${x - size * 0.65}Z` });
            // any: one of each, small, as the pile is made of
            if (kind === "any") (block(2.5, 12.5, 9), ball(17, 17, 4.5), wedge(12, 6, 8));
            else if (kind === "block") block(4.5, 4.5, 15);
            else if (kind === "ball") ball(12, 12, 8);
            else wedge(12, 12.5, 14);
            return svg;
        };
        const kinds = KINDS.map(({ kind, name }) => el("button", { type: "button", class: "blocks-kind", title: name, ariaLabel: name, onclick: () => choose({ kind }) }, shape(kind)));

        // the wheel: a ring of every hue at the darkness chosen, a mark on the hue picked, and in its middle the color the next piece will be
        const wheel = el("canvas", { class: "blocks-wheel", tabIndex: 0, title: "Color: drag round the wheel, or use the arrow keys" });
        wheel.setAttribute("role", "slider");
        wheel.setAttribute("aria-label", "Hue");
        wheel.setAttribute("aria-valuemin", "0");
        wheel.setAttribute("aria-valuemax", "359");
        const paint = () => {
            const box = wheel.getBoundingClientRect();
            const scale = Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100);
            const side = Math.round(box.width * scale) || 144;
            if (wheel.width !== side) wheel.width = wheel.height = side;
            const ctx = wheel.getContext("2d");
            if (!ctx) return;
            const [half, thick] = [side / 2, side * 0.17];
            const reach = half - thick / 2 - scale;
            ctx.clearRect(0, 0, side, side);
            ctx.lineWidth = thick;
            if (typeof ctx.createConicGradient === "function") {
                // one sweep of every hue from the top, clockwise, with no seam between two
                const sweep = ctx.createConicGradient(-Math.PI / 2, half, half);
                for (let at = 0; at <= 360; at += 10) sweep.addColorStop(at / 360, tint(at, chosen.dark));
                ctx.beginPath();
                ctx.arc(half, half, reach, 0, Math.PI * 2);
                ctx.strokeStyle = sweep;
                ctx.stroke();
            } else {
                // a browser without the sweep: short arcs, each drawn a little past the next so that no hairline shows
                for (let at = 0; at < 360; at += 3) {
                    ctx.beginPath();
                    ctx.arc(half, half, reach, ((at - 90 - 0.6) * Math.PI) / 180, ((at - 90 + 3.6) * Math.PI) / 180);
                    ctx.strokeStyle = tint(at + 1.5, chosen.dark);
                    ctx.stroke();
                }
            }
            // the middle: the color chosen, or with a hue by chance three of them, as the pile comes out
            const inner = reach - thick / 2 - scale * 3;
            const slices = chosen.hue === undefined ? [20, 140, 260] : [chosen.hue];
            slices.forEach((each, index) => {
                ctx.beginPath();
                ctx.moveTo(half, half);
                ctx.arc(half, half, inner, ((index / slices.length) * 2 - 0.5) * Math.PI, (((index + 1) / slices.length) * 2 - 0.5) * Math.PI);
                ctx.closePath();
                ctx.fillStyle = tint(each, chosen.dark);
                ctx.fill();
            });
            if (chosen.hue !== undefined) {
                const [x, y] = placeOf(chosen.hue);
                ctx.beginPath();
                ctx.arc(half + x * reach, half + y * reach, thick * 0.42, 0, Math.PI * 2);
                ctx.fillStyle = tint(chosen.hue, chosen.dark);
                ctx.fill();
                ctx.lineWidth = scale * 2;
                ctx.strokeStyle = m.color("--ink");
                ctx.stroke();
            }
        };
        const turnTo = (event: PointerEvent) => {
            const box = wheel.getBoundingClientRect();
            choose({ hue: hueAt(event.clientX, event.clientY, box.left + box.width / 2, box.top + box.height / 2) });
        };
        wheel.addEventListener("pointerdown", (event) => {
            wheel.setPointerCapture(event.pointerId);
            turnTo(event);
        });
        wheel.addEventListener("pointermove", (event) => {
            if (wheel.hasPointerCapture(event.pointerId)) turnTo(event);
        });
        wheel.addEventListener("keydown", (event) => {
            const by = event.key === "ArrowRight" || event.key === "ArrowUp" ? TURN : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -TURN : 0;
            if (!by) return;
            event.preventDefault();
            choose({ hue: (chosen.hue ?? 0) + by });
        });

        const chance = el("button", { type: "button", class: "blocks-chance", textContent: "random", title: "A different color for every piece", onclick: () => choose({ hue: undefined }) });
        const dark = el("input", { type: "range", min: "0", max: "100", step: "1", ariaLabel: "Darkness", oninput: () => choose({ dark: Number(dark.value) / 100 }) });
        const taken = el("button", { type: "button", class: "quiet", textContent: "remove", title: "Take a piece away (Backspace)", onclick: () => void remove() });
        m.panel().append(
            el("div", { class: "blocks-row" }, el("span", { class: "blocks-kinds" }, ...kinds), el("span", { class: "blocks-color" }, wheel, el("span", { class: "blocks-tones" }, chance, el("label", { class: "blocks-dark" }, "darkness ", dark))), taken),
        );
        shown = () => {
            kinds.forEach((button, index) => button.setAttribute("aria-pressed", String(KINDS[index]!.kind === chosen.kind)));
            chance.setAttribute("aria-pressed", String(chosen.hue === undefined));
            dark.value = String(Math.round(chosen.dark * 100));
            wheel.setAttribute("aria-valuenow", String(chosen.hue ?? 0));
            wheel.setAttribute("aria-valuetext", chosen.hue === undefined ? "a different color for every piece" : `${chosen.hue} degrees`);
            paint();
        };
        shown();
        // drawn again once it has its size on the page, and when the page's look changes
        requestAnimationFrame(shown);
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
        resize: enclose,
        // Whatever is under the pointer is picked up.
        press: (x, y) => void flat.hand.take(x, y),
        // Pressed twice on an empty spot: a new piece there.
        double(x, y) {
            if (!flat.hand.held && !flat.at(x, y)) drop(x, y);
        },
        // Space: a new piece under the pointer, or at the top if the pointer is elsewhere.
        keydown(name) {
            if (name === "action") drop(m.pointer.inside ? m.pointer.x : m.width / 2, m.pointer.inside ? m.pointer.y : SIZE);
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
