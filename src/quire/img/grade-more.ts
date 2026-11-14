// The Grade surface's deeper controls, under More: the tint, the curve (all three channels or each
// on its own; a point added by pressing the curve's square, moved by dragging, taken away by dragging
// it off the square), three color wheels for the shadows, midtones and highlights (the puck under the
// finger, back to the middle with a double press), and colors picked in the picture and shifted on
// their own. Each previews while it moves and is one change when let go, as the sliders are.
//
//   const more = gradeMore({ grade, preview, set, pickColor });
//   panel.deeper.append(more.element); more.fill();

import { control, icon, make } from "../core/ui";
import { curveAt, MOST, SLIDERS, STRAIGHT, type Curves, type Grade, type OwnColor, type Wheel } from "./grade";
import { slider } from "./grade-panel";
import type { Point } from "./steps";

/** What the deeper controls need of the editor. */
export interface MoreHooks {
    grade(): Grade;
    preview(grade: Grade): void;
    set(grade: Grade): void;
    /** Picking a color: the next press on the picture adds it; pressed again, picking is let go. */
    pickColor(): void;
    picking(): boolean;
}

/** The curves' channels, as their buttons say them. */
export const CHANNELS: { key: keyof Curves; label: string; color: string }[] = [
    { key: "all", label: "All", color: "" },
    { key: "red", label: "Red", color: "#ff5a52" },
    { key: "green", label: "Green", color: "#4cd36b" },
    { key: "blue", label: "Blue", color: "#4c9dff" },
];

/** The three wheels, in the order they are shown. */
export const WHEELS: { key: keyof Grade["wheels"]; label: string }[] = [
    { key: "shadows", label: "Shadows" },
    { key: "mids", label: "Midtones" },
    { key: "highs", label: "Highlights" },
];

/** How far off its square (as a share of the square) a point must be dragged to be taken away. */
export const OFF = 0.12;

/** The curve's points with one moved to a place, kept between its neighbours (an end stays an end), or taken away when dragged far enough off the square; the curve's ends are never taken away. */
export function movePoint(points: Point[], index: number, to: Point): { points: Point[]; removed: boolean } {
    const off = to.x < -OFF || to.x > 1 + OFF || to.y < -OFF || to.y > 1 + OFF;
    const end = index === 0 || index === points.length - 1;
    if (off && !end && points.length > 2) return { points: points.filter((_, at) => at !== index), removed: true };
    const low = index === 0 ? 0 : points[index - 1]!.x + 0.01;
    const high = index === points.length - 1 ? 1 : points[index + 1]!.x - 0.01;
    const x = Math.round(Math.min(high, Math.max(low, to.x)) * 1000) / 1000;
    const y = Math.round(Math.min(1, Math.max(0, to.y)) * 1000) / 1000;
    return { points: points.map((each, at) => (at === index ? { x, y } : each)), removed: false };
}

/** The curve's points with a new one at a place, in order, unless one is within a hundredth of it along x or the curve has its most; gives the new point's index too. */
export function addPoint(points: Point[], at: Point): { points: Point[]; index: number } | undefined {
    if (points.length >= MOST.points || points.some((each) => Math.abs(each.x - at.x) < 0.01)) return undefined;
    const point = { x: Math.round(Math.min(1, Math.max(0, at.x)) * 1000) / 1000, y: Math.round(Math.min(1, Math.max(0, at.y)) * 1000) / 1000 };
    const next = [...points, point].sort((a, b) => a.x - b.x);
    return { points: next, index: next.indexOf(point) };
}

/** A wheel's puck from a place in its circle (from -1 to 1 each way, up positive), kept inside it and snapping to the middle within a twenty-fifth. */
export function puckAt(x: number, y: number): Wheel {
    const far = Math.hypot(x, y);
    if (far < 0.04) return { x: 0, y: 0 };
    const scale = far > 1 ? 1 / far : 1;
    return { x: Math.round(x * scale * 1000) / 1000, y: Math.round(y * scale * 1000) / 1000 };
}

/** A hue picked, as a swatch shows it: a color of that hue, moderately strong. */
export const swatchOf = (hue: number): string => `hsl(${Math.round(hue)} 65% 55%)`;

/** The curve: a square, its channel's points and line, the others' faint, and the four channel buttons. */
function curveEditor(hooks: MoreHooks) {
    const element = make("div", "quire-img-curve");
    const channels = make("div", "quire-img-curve-channels");
    channels.setAttribute("role", "radiogroup");
    channels.setAttribute("aria-label", "Curve");
    let channel: keyof Curves = "all";
    const buttons = CHANNELS.map((each) => {
        const button = make("button", "quire-img-curve-channel", each.label);
        button.type = "button";
        button.setAttribute("role", "radio");
        button.title = each.key === "all" ? "The curve of all three channels together" : `The ${each.label.toLowerCase()} channel's own curve`;
        button.addEventListener("click", () => {
            channel = each.key;
            draw();
            fillButtons();
        });
        return button;
    });
    channels.append(...buttons);
    const canvas = make("canvas", "quire-img-curve-square");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Curve: press to add a point, drag a point to move it, drag it off the square to take it away; a double press makes it straight");
    canvas.title = "Press to add a point, drag it off to take it away; a double press makes it straight";
    element.append(channels, canvas);
    const fillButtons = () => {
        for (const [at, button] of buttons.entries()) {
            const on = CHANNELS[at]!.key === channel;
            button.setAttribute("aria-checked", String(on));
            button.classList.toggle("pressed", on);
            const straight = hooks.grade().curves[CHANNELS[at]!.key].length === 2 && JSON.stringify(hooks.grade().curves[CHANNELS[at]!.key]) === JSON.stringify(STRAIGHT);
            button.classList.toggle("moved", !straight);
        }
    };
    // what is drawn while a point is dragged, before letting go makes it a change
    let live: { points: Point[]; index: number; removed: boolean } | undefined;
    const pad = 8;
    const toSquare = (event: PointerEvent): Point => {
        const box = canvas.getBoundingClientRect();
        const size = box.width - pad * 2;
        return { x: (event.clientX - box.left - pad) / size, y: 1 - (event.clientY - box.top - pad) / size };
    };
    function draw() {
        const ratio = devicePixelRatio || 1;
        const side = Math.max(1, Math.round(canvas.clientWidth * ratio));
        if (canvas.width !== side) canvas.width = canvas.height = side;
        const context = canvas.getContext("2d")!;
        context.clearRect(0, 0, side, side);
        const p = pad * ratio;
        const size = side - p * 2;
        const at = (point: Point) => [p + point.x * size, p + (1 - point.y) * size] as const;
        const style = getComputedStyle(canvas);
        const rule = style.getPropertyValue("--rule").trim() || "#444";
        const ink = style.color || "#ddd";
        context.strokeStyle = rule;
        context.lineWidth = ratio;
        for (let line = 0; line <= 4; line++) {
            context.beginPath();
            context.moveTo(p + (line / 4) * size, p);
            context.lineTo(p + (line / 4) * size, p + size);
            context.moveTo(p, p + (line / 4) * size);
            context.lineTo(p + size, p + (line / 4) * size);
            context.stroke();
        }
        const grade = hooks.grade();
        const pointsOf = (key: keyof Curves) => (key === channel && live ? live.points : grade.curves[key]);
        const line = (points: Point[], color: string, width: number, alpha: number) => {
            context.beginPath();
            for (let step = 0; step <= 128; step++) {
                const x = step / 128;
                const [left, top] = at({ x, y: curveAt(points, x) });
                if (step) context.lineTo(left, top);
                else context.moveTo(left, top);
            }
            context.strokeStyle = color;
            context.globalAlpha = alpha;
            context.lineWidth = width * ratio;
            context.stroke();
            context.globalAlpha = 1;
        };
        // the other channels' curves faint, this one's in full
        for (const each of CHANNELS) if (each.key !== channel) line(pointsOf(each.key), each.color || ink, 1, 0.3);
        const mine = CHANNELS.find((each) => each.key === channel)!;
        line(pointsOf(channel), mine.color || ink, 1.5, 1);
        pointsOf(channel).forEach((point, index) => {
            const [left, top] = at(point);
            context.beginPath();
            context.arc(left, top, 4.5 * ratio, 0, Math.PI * 2);
            context.fillStyle = live && live.index === index && live.removed ? rule : mine.color || ink;
            context.fill();
        });
        if (live?.removed) {
            context.fillStyle = ink;
            context.globalAlpha = 0.7;
            context.font = `${12 * ratio}px system-ui, sans-serif`;
            context.fillText("Let go to take it away", p + 6 * ratio, p + 16 * ratio);
            context.globalAlpha = 1;
        }
    }
    let drag: { id: number; index: number; points: Point[] } | undefined;
    canvas.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        const there = toSquare(event);
        const points = hooks.grade().curves[channel];
        const box = canvas.getBoundingClientRect();
        const reach = 12 / (box.width - pad * 2);
        let index = points.findIndex((each) => Math.hypot(each.x - there.x, each.y - there.y) < reach);
        let start = points;
        // pressed where there is no point: a point is added there, and dragged from there
        if (index < 0) {
            const added = addPoint(points, there);
            if (!added) return;
            start = added.points;
            index = added.index;
        }
        canvas.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, index, points: start };
        live = { points: start, index, removed: false };
        hooks.preview({ ...hooks.grade(), curves: { ...hooks.grade().curves, [channel]: start } });
        draw();
    });
    canvas.addEventListener("pointermove", (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        const moved = movePoint(drag.points, drag.index, toSquare(event));
        live = { points: moved.removed ? drag.points : moved.points, index: drag.index, removed: moved.removed };
        hooks.preview({ ...hooks.grade(), curves: { ...hooks.grade().curves, [channel]: moved.points } });
        draw();
    });
    const letGo = (event: PointerEvent) => {
        if (!drag || drag.id !== event.pointerId) return;
        const now = live!;
        drag = undefined;
        live = undefined;
        const points = now.removed ? now.points.filter((_, at) => at !== now.index) : now.points;
        hooks.set({ ...hooks.grade(), curves: { ...hooks.grade().curves, [channel]: points } });
        draw();
        fillButtons();
    };
    canvas.addEventListener("pointerup", letGo);
    canvas.addEventListener("pointercancel", letGo);
    canvas.addEventListener("dblclick", () => {
        hooks.set({ ...hooks.grade(), curves: { ...hooks.grade().curves, [channel]: STRAIGHT } });
        draw();
        fillButtons();
    });
    return {
        element,
        fill: () => {
            draw();
            fillButtons();
        },
        canvas,
        channel: () => channel,
    };
}

/** One color wheel: a faint ring of hues, the puck under the finger, its word under it. */
function wheelControl(spec: { key: keyof Grade["wheels"]; label: string }, hooks: MoreHooks) {
    const element = make("div", "quire-img-wheel");
    element.dataset.key = spec.key;
    const canvas = make("canvas", "quire-img-wheel-disc");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "slider");
    canvas.setAttribute("aria-label", `${spec.label} wheel`);
    canvas.title = `${spec.label}: drag toward a color to push these tones toward it; a double press puts it back`;
    element.append(canvas, make("span", "quire-img-wheel-label", spec.label));
    let live: Wheel | undefined;
    const now = () => live ?? hooks.grade().wheels[spec.key];
    function draw() {
        const ratio = devicePixelRatio || 1;
        const side = Math.max(1, Math.round(canvas.clientWidth * ratio));
        if (canvas.width !== side) canvas.width = canvas.height = side;
        const context = canvas.getContext("2d")!;
        context.clearRect(0, 0, side, side);
        const middle = side / 2;
        const radius = middle - 3 * ratio;
        // the hues round the edge, red to the right and turning the other way to the screen's, as the arithmetic turns
        const ring = context.createConicGradient(0, middle, middle);
        for (let at = 0; at <= 12; at++) ring.addColorStop(at / 12, `hsl(${(360 - at * 30) % 360} 60% 55%)`);
        context.beginPath();
        context.arc(middle, middle, radius, 0, Math.PI * 2);
        context.strokeStyle = ring;
        context.lineWidth = 3 * ratio;
        context.globalAlpha = 0.85;
        context.stroke();
        context.globalAlpha = 1;
        const style = getComputedStyle(canvas);
        context.strokeStyle = style.getPropertyValue("--rule").trim() || "#444";
        context.lineWidth = ratio;
        context.beginPath();
        context.moveTo(middle - 5 * ratio, middle);
        context.lineTo(middle + 5 * ratio, middle);
        context.moveTo(middle, middle - 5 * ratio);
        context.lineTo(middle, middle + 5 * ratio);
        context.stroke();
        const puck = now();
        const left = middle + puck.x * (radius - 6 * ratio);
        const top = middle - puck.y * (radius - 6 * ratio);
        context.beginPath();
        context.arc(left, top, 6 * ratio, 0, Math.PI * 2);
        const far = Math.hypot(puck.x, puck.y);
        context.fillStyle = far ? `hsl(${((Math.atan2(puck.y, puck.x) * 180) / Math.PI + 360) % 360} ${Math.round(far * 70)}% ${70 - far * 15}%)` : style.color || "#ddd";
        context.fill();
        context.strokeStyle = "rgba(0, 0, 0, 0.45)";
        context.stroke();
        canvas.setAttribute("aria-valuetext", far ? `${Math.round(far * 100)} toward hue ${Math.round(((Math.atan2(puck.y, puck.x) * 180) / Math.PI + 360) % 360)}` : "none");
        element.classList.toggle("moved", far > 0);
    }
    const place = (event: PointerEvent): Wheel => {
        const box = canvas.getBoundingClientRect();
        const radius = box.width / 2 - 9;
        return puckAt((event.clientX - box.left - box.width / 2) / radius, -(event.clientY - box.top - box.height / 2) / radius);
    };
    let drag: number | undefined;
    canvas.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        drag = event.pointerId;
        live = place(event);
        hooks.preview({ ...hooks.grade(), wheels: { ...hooks.grade().wheels, [spec.key]: live } });
        draw();
    });
    canvas.addEventListener("pointermove", (event) => {
        if (drag !== event.pointerId) return;
        live = place(event);
        hooks.preview({ ...hooks.grade(), wheels: { ...hooks.grade().wheels, [spec.key]: live } });
        draw();
    });
    const letGo = (event: PointerEvent) => {
        if (drag !== event.pointerId) return;
        drag = undefined;
        const puck = live!;
        live = undefined;
        hooks.set({ ...hooks.grade(), wheels: { ...hooks.grade().wheels, [spec.key]: puck } });
        draw();
    };
    canvas.addEventListener("pointerup", letGo);
    canvas.addEventListener("pointercancel", letGo);
    canvas.addEventListener("dblclick", () => {
        hooks.set({ ...hooks.grade(), wheels: { ...hooks.grade().wheels, [spec.key]: { x: 0, y: 0 } } });
        draw();
    });
    // the arrows nudge the puck, Shift ten times as far, one change when let go
    let keyed = false;
    canvas.addEventListener("keydown", (event) => {
        const by = event.shiftKey ? 0.1 : 0.01;
        const step: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, by], ArrowDown: [0, -by] };
        const move = step[event.key];
        if (!move) return;
        event.preventDefault();
        event.stopPropagation();
        const puck = now();
        const x = puck.x + move[0];
        const y = puck.y + move[1];
        const far = Math.hypot(x, y);
        live = far < 0.005 ? { x: 0, y: 0 } : far > 1 ? { x: x / far, y: y / far } : { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
        keyed = true;
        hooks.preview({ ...hooks.grade(), wheels: { ...hooks.grade().wheels, [spec.key]: live } });
        draw();
    });
    canvas.addEventListener("keyup", () => {
        if (!keyed || !live) return;
        keyed = false;
        const puck = live;
        live = undefined;
        hooks.set({ ...hooks.grade(), wheels: { ...hooks.grade().wheels, [spec.key]: puck } });
    });
    return { element, fill: draw, canvas };
}

/** Builds the deeper controls. */
export function gradeMore(hooks: MoreHooks) {
    const element = make("div", "quire-img-grade-more-body");
    const tintSpec = SLIDERS.find((each) => each.key === "tint")!;
    const tint = slider(tintSpec, {
        value: () => hooks.grade().tint,
        preview: (value) => hooks.preview({ ...hooks.grade(), tint: value }),
        set: (value) => hooks.set({ ...hooks.grade(), tint: value }),
    });
    const curve = curveEditor(hooks);
    const wheels = WHEELS.map((spec) => wheelControl(spec, hooks));
    const wheelRow = make("div", "quire-img-wheels");
    wheelRow.append(...wheels.map((each) => each.element));
    // colors picked in the picture, each with its own three sliders
    const colors = make("div", "quire-img-own-colors");
    const pick = make("button", "quire-dialog-dismiss quire-img-grade-fix quire-img-pick-color", "Pick a color");
    pick.type = "button";
    pick.title = "Then press a color in the picture, to shift it on its own";
    pick.addEventListener("click", () => hooks.pickColor());
    const heading = (words: string) => make("p", "quire-img-grade-heading", words);
    element.append(tint.row, heading("Curve"), curve.element, heading("Wheels"), wheelRow, heading("Colors"), colors, pick);

    const setColor = (index: number, change: Partial<OwnColor> | undefined, live = false) => {
        const grade = hooks.grade();
        const next = change === undefined ? grade.colors.filter((_, at) => at !== index) : grade.colors.map((each, at) => (at === index ? { ...each, ...change } : each));
        (live ? hooks.preview : hooks.set)({ ...grade, colors: next });
    };
    function fillColors() {
        const list = hooks.grade().colors;
        // rebuilt only when the number of colors changes, so a slider being dragged is never replaced under the pointer
        if (colors.childElementCount !== list.length) {
            colors.replaceChildren(
                ...list.map((each, index) => {
                    const row = make("div", "quire-img-own-color");
                    const swatch = make("span", "quire-img-own-swatch");
                    swatch.style.background = swatchOf(each.hue);
                    const remove = control("Take this color away", icon("trash"), () => setColor(index, undefined));
                    const head = make("div", "quire-img-own-head");
                    head.append(swatch, make("span", "", `Color ${index + 1}`), remove);
                    const sliders = (
                        [
                            ["shift", "Hue", "Turns this color's hue"],
                            ["saturation", "Saturation", "This color stronger or weaker"],
                            ["lightness", "Lightness", "This color lighter or darker"],
                        ] as const
                    ).map(([key, label, tip]) =>
                        slider(
                            { key: `${key}-${index}`, label, tip },
                            {
                                value: () => hooks.grade().colors[index]?.[key] ?? 0,
                                preview: (value) => setColor(index, { [key]: value }, true),
                                set: (value) => setColor(index, { [key]: value }),
                            },
                        ),
                    );
                    row.append(head, ...sliders.map((each) => each.row));
                    (row as HTMLElement & { show?: () => void }).show = () => {
                        swatch.style.background = swatchOf(hooks.grade().colors[index]?.hue ?? 0);
                        for (const each of sliders) each.show();
                    };
                    return row;
                }),
            );
        }
        for (const row of colors.children) (row as HTMLElement & { show?: () => void }).show?.();
        pick.disabled = list.length >= MOST.colors;
        pick.classList.toggle("pressed", hooks.picking());
        pick.textContent = hooks.picking() ? "Press a color in the picture" : "Pick a color";
    }
    return {
        element,
        fill() {
            tint.show();
            curve.fill();
            for (const each of wheels) each.fill();
            fillColors();
        },
        curve,
        wheels,
    };
}
