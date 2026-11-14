// The Grade surface: a side panel where Export and Facts open (a sheet at the foot on a phone, which
// can be dragged shorter), the picture refitting beside it. From the top: what is being graded, a
// small histogram that follows the grade (pressed, a waveform), the one-press fixes, the six sliders,
// and More, folded, for the deeper controls. Every slider has its zero in the middle and snaps to it,
// is dragged from wherever it is pressed without jumping, is put back to zero by a double press, takes
// a typed number, and moves by the arrow keys (Shift for ten). While a slider moves, the grade is
// previewed; letting go makes it a change, one undo.
//
//   const panel = gradePanel({ grade, set, preview, ... });
//   panel.open(button); panel.fill(); panel.counts(counts);

import { control, icon, make } from "../core/ui";
import { sidePanel } from "./panels";
import { SLIDERS, type Grade } from "./grade";
import { WAVE, type Counts } from "./measure";

/** What the surface needs of the editor. */
export interface GradeHooks {
    closed?(): void;
    /** The grade of what is picked: the whole picture's, or a part's. */
    grade(): Grade;
    /** What is picked, in a word or two: "Whole picture", "Gradient". */
    target(): string;
    /** The space it is graded in, as the surface says it, with a note when it is a guess. */
    space(): string;
    preview(grade: Grade): void;
    /** A change to the grade, as one undo. */
    set(grade: Grade): void;
    auto(): void;
    /** Balance: the next press on the picture reads what should be gray. */
    balance(): void;
    balancing(): boolean;
    /** Shows the original while held. */
    hold(on: boolean): void;
    split(): boolean;
    setSplit(on: boolean): void;
}

/** The six sliders the surface shows first; Tint is under More. */
export const FIRST = SLIDERS.filter((slider) => slider.key !== "tint");

/** A slider's value as its field says it: a whole number, or one place after the point. */
export const said = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** A typed number as a slider's value: held to -100 to 100, to a tenth; nothing for what is not a number. */
export function typed(text: string): number | undefined {
    const value = Number(text.trim().replace(",", ".").replace(/^\+/, ""));
    if (!text.trim() || !Number.isFinite(value)) return undefined;
    return Math.round(Math.max(-100, Math.min(100, value)) * 10) / 10 || 0;
}

/** Where a drag takes a slider: the value it started from moved by how far the pointer went (the whole track is the whole range, a tenth of it with Shift), in whole steps (tenths with Shift), snapping to zero within two. */
export function dragged(start: number, moved: number, track: number, fine = false): number {
    const raw = start + (moved / Math.max(1, track)) * 200 * (fine ? 0.1 : 1);
    const value = Math.round(Math.max(-100, Math.min(100, raw)) * (fine ? 10 : 1)) / (fine ? 10 : 1);
    return !fine && Math.abs(value) <= 2 ? 0 : value || 0;
}

/** One slider: its word, the track with the zero marked, and its number. Previews while moving, sets when let go. */
export function slider(spec: { key: string; label: string; tip: string }, hooks: { value(): number; preview(value: number): void; set(value: number): void }) {
    const row = make("div", "quire-img-slider");
    row.dataset.key = spec.key;
    const label = make("span", "quire-img-slider-label", spec.label);
    label.title = spec.tip;
    const track = make("span", "quire-img-slider-track");
    track.tabIndex = 0;
    track.setAttribute("role", "slider");
    track.setAttribute("aria-label", spec.label);
    track.setAttribute("aria-valuemin", "-100");
    track.setAttribute("aria-valuemax", "100");
    track.title = `${spec.tip}. Drag, or the arrow keys; a double press puts it back to zero`;
    const zero = make("i", "quire-img-slider-zero");
    const fill = make("i", "quire-img-slider-fill");
    const thumb = make("i", "quire-img-slider-thumb");
    track.append(zero, fill, thumb);
    const number = make("input", "quire-img-slider-number");
    number.inputMode = "decimal";
    number.setAttribute("aria-label", `${spec.label}, as a number`);
    row.append(label, track, number);

    let shown = 0;
    const show = (value: number) => {
        shown = value;
        const at = (value + 100) / 2;
        thumb.style.left = `${at}%`;
        fill.style.left = `${Math.min(50, at)}%`;
        fill.style.width = `${Math.abs(at - 50)}%`;
        row.classList.toggle("moved", value !== 0);
        track.setAttribute("aria-valuenow", String(value));
        track.setAttribute("aria-valuetext", said(value));
        if (document.activeElement !== number) number.value = said(value);
    };
    // a drag from wherever the track is pressed: the thumb never jumps to the pointer
    let drag: { start: number; x: number; id: number; moved: boolean } | undefined;
    track.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        track.focus({ preventScroll: true });
        track.setPointerCapture(event.pointerId);
        drag = { start: hooks.value(), x: event.clientX, id: event.pointerId, moved: false };
        row.classList.add("held");
    });
    track.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const value = dragged(drag.start, event.clientX - drag.x, track.clientWidth, event.shiftKey);
        if (Math.abs(event.clientX - drag.x) > 2) drag.moved = true;
        if (value === shown) return;
        show(value);
        hooks.preview(value);
    });
    const letGo = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.id) return;
        const was = drag;
        drag = undefined;
        row.classList.remove("held");
        if (was.moved && shown !== was.start) hooks.set(shown);
        else show(hooks.value());
    };
    track.addEventListener("pointerup", letGo);
    track.addEventListener("pointercancel", letGo);
    track.addEventListener("dblclick", () => {
        show(0);
        hooks.set(0);
    });
    // the arrow keys preview while held and set once let go, so a key held down is one undo
    let keyed = false;
    track.addEventListener("keydown", (event) => {
        const by = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "PageUp" ? 10 : event.key === "PageDown" ? -10 : 0;
        if (event.key === "Home" || event.key === "End" || event.key === "0") {
            event.preventDefault();
            const value = event.key === "Home" ? -100 : event.key === "End" ? 100 : 0;
            show(value);
            hooks.set(value);
            return;
        }
        if (!by) return;
        event.preventDefault();
        event.stopPropagation();
        const value = Math.round(Math.max(-100, Math.min(100, shown + by * (event.shiftKey ? 10 : 1))) * 10) / 10;
        keyed = true;
        show(value);
        hooks.preview(value);
    });
    track.addEventListener("keyup", () => {
        if (!keyed) return;
        keyed = false;
        if (shown !== hooks.value()) hooks.set(shown);
    });
    track.addEventListener("blur", () => {
        if (keyed && shown !== hooks.value()) hooks.set(shown);
        keyed = false;
    });
    const typedIn = () => {
        const value = typed(number.value);
        if (value === undefined) return show(hooks.value());
        show(value);
        if (value !== hooks.value()) hooks.set(value);
    };
    number.addEventListener("change", typedIn);
    number.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            typedIn();
            number.select();
        } else if (event.key === "Escape") {
            event.preventDefault();
            number.value = said(hooks.value());
            track.focus({ preventScroll: true });
        }
    });
    number.addEventListener("focus", () => number.select());
    show(hooks.value());
    return { row, show: () => show(hooks.value()), track, number };
}

/** Draws the counts in a canvas: the histogram's luminance as a quiet area and red, green and blue as fine lines; or the waveform, each column's levels as points. */
export function drawCounts(canvas: HTMLCanvasElement, counts: Counts | undefined, wave: boolean) {
    const ratio = devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, width, height);
    if (!counts) return;
    const ink = getComputedStyle(canvas).color || "#ccc";
    if (wave) {
        let most = 1;
        for (const value of counts.wave) most = Math.max(most, value);
        const cell = { width: width / WAVE.columns, height: height / WAVE.rows };
        context.fillStyle = ink;
        for (let row = 0; row < WAVE.rows; row++)
            for (let column = 0; column < WAVE.columns; column++) {
                const value = counts.wave[row * WAVE.columns + column]!;
                if (!value) continue;
                context.globalAlpha = Math.min(0.9, 0.15 + Math.sqrt(value / most) * 0.8);
                context.fillRect(column * cell.width, height - (row + 1) * cell.height, Math.ceil(cell.width), Math.ceil(cell.height));
            }
        context.globalAlpha = 1;
        return;
    }
    // the tallest bar fills the height, the ends left out of it so that a clipped black or white does not flatten the rest
    let most = 1;
    for (const list of [counts.luma, counts.red, counts.green, counts.blue]) for (let at = 1; at < 255; at++) most = Math.max(most, list[at]!);
    const path = (list: Uint32Array) => {
        context.beginPath();
        context.moveTo(0, height);
        for (let at = 0; at < 256; at++) context.lineTo((at / 255) * width, height - Math.min(1, list[at]! / most) * (height - 1));
        context.lineTo(width, height);
    };
    path(counts.luma);
    context.fillStyle = ink;
    context.globalAlpha = 0.28;
    context.fill();
    context.globalAlpha = 0.75;
    context.lineWidth = ratio;
    for (const [list, color] of [[counts.red, "#ff5a52"], [counts.green, "#4cd36b"], [counts.blue, "#4c9dff"]] as const) {
        path(list);
        context.strokeStyle = color;
        context.stroke();
    }
    context.globalAlpha = 1;
}

/** Builds the Grade surface. `more` is filled by the deeper controls, `parts` by the parts' own. */
export function gradePanel(hooks: GradeHooks) {
    const side = sidePanel("Grade", "quire-img-export quire-img-grade-panel", () => hooks.closed?.());
    const target = make("p", "quire-img-grade-target");
    // the histogram, small, and the two ways to see the original beside it
    const top = make("div", "quire-img-grade-top");
    const scope = make("canvas", "quire-img-grade-scope");
    scope.setAttribute("role", "button");
    scope.tabIndex = 0;
    let wave = false;
    let last: Counts | undefined;
    const scopeTip = () => (scope.title = wave ? "Waveform: the picture's light from left to right. Press for the histogram" : "Histogram: how much of the picture is at each level. Press for the waveform");
    const flipScope = () => {
        wave = !wave;
        scopeTip();
        drawCounts(scope, last, wave);
    };
    scope.addEventListener("click", flipScope);
    scope.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        flipScope();
    });
    scopeTip();
    const original = control("Hold to see the original (\\)", icon("spoiler"), () => {});
    original.classList.add("quire-img-grade-hold");
    const holdEnd = () => {
        original.classList.remove("pressed");
        hooks.hold(false);
    };
    original.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        original.setPointerCapture(event.pointerId);
        original.classList.add("pressed");
        hooks.hold(true);
    });
    original.addEventListener("pointerup", holdEnd);
    original.addEventListener("pointercancel", holdEnd);
    original.addEventListener("keydown", (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) {
            original.classList.add("pressed");
            hooks.hold(true);
        }
    });
    original.addEventListener("keyup", holdEnd);
    original.addEventListener("blur", holdEnd);
    const split = control("Split: the original on the left, the grade on the right", icon("column"), () => {
        hooks.setSplit(!hooks.split());
        fill();
    });
    const ways = make("div", "quire-img-grade-ways");
    ways.append(original, split);
    top.append(scope, ways);
    // the one-press fixes
    const fixes = make("div", "quire-img-grade-fixes");
    const button = (label: string, tip: string, press: () => void) => {
        const made = make("button", "quire-dialog-dismiss quire-img-grade-fix", label);
        made.type = "button";
        made.title = tip;
        made.addEventListener("click", press);
        return made;
    };
    const auto = button("Auto", "Sets the levels and takes out a color cast, as slider and curve values to tune", () => hooks.auto());
    const balance = button("Balance", "Then press something in the picture that should be gray", () => hooks.balance());
    const reset = button("Reset", "Puts every control of this grade back to zero", () => {
        const now = hooks.grade();
        hooks.set({ ...now, light: 0, contrast: 0, shadows: 0, highs: 0, warmth: 0, tint: 0, color: 0, curves: { all: [{ x: 0, y: 0 }, { x: 1, y: 1 }], red: [{ x: 0, y: 0 }, { x: 1, y: 1 }], green: [{ x: 0, y: 0 }, { x: 1, y: 1 }], blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, wheels: { shadows: { x: 0, y: 0 }, mids: { x: 0, y: 0 }, highs: { x: 0, y: 0 } }, colors: [], lut: undefined });
    });
    fixes.append(auto, balance, reset);
    // the six sliders
    const sliders = FIRST.map((spec) =>
        slider(spec, {
            value: () => hooks.grade()[spec.key],
            preview: (value) => hooks.preview({ ...hooks.grade(), [spec.key]: value }),
            set: (value) => hooks.set({ ...hooks.grade(), [spec.key]: value }),
        }),
    );
    const list = make("div", "quire-img-sliders");
    list.append(...sliders.map((each) => each.row));
    // More, folded: the deeper controls
    const more = make("details", "quire-img-everything quire-img-grade-more");
    const summary = make("summary", "", "More");
    const deeper = make("div", "quire-img-grade-deeper");
    more.append(summary, deeper);
    const parts = make("div", "quire-img-grade-parts");
    const space = make("p", "quire-img-grade-space");
    side.body.append(target, top, fixes, list, more, parts, space);
    // on a phone the sheet's head drags it shorter or taller, the picture above refitting as it goes
    const head = side.panel.querySelector<HTMLElement>(".quire-img-panel-head")!;
    let sheet: { y: number; height: number; id: number } | undefined;
    head.addEventListener("pointerdown", (event) => {
        if (!matchMedia("(max-width: 40rem)").matches || (event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        head.setPointerCapture(event.pointerId);
        sheet = { y: event.clientY, height: side.panel.getBoundingClientRect().height, id: event.pointerId };
    });
    head.addEventListener("pointermove", (event) => {
        if (!sheet || sheet.id !== event.pointerId) return;
        const height = Math.round(Math.max(150, Math.min(innerHeight * 0.8, sheet.height - (event.clientY - sheet.y))));
        document.documentElement.style.setProperty("--quire-img-sheet", `${height}px`);
    });
    const sheetDone = (event: PointerEvent) => {
        if (sheet?.id === event.pointerId) sheet = undefined;
    };
    head.addEventListener("pointerup", sheetDone);
    head.addEventListener("pointercancel", sheetDone);

    function fill() {
        target.textContent = hooks.target();
        for (const each of sliders) each.show();
        balance.classList.toggle("pressed", hooks.balancing());
        split.classList.toggle("pressed", hooks.split());
        space.textContent = hooks.space();
    }
    return {
        ...side,
        fill,
        /** Where the deeper controls go, under More. */
        deeper,
        more,
        /** Where the parts' own controls go. */
        parts,
        /** Shows the counts of the grade as it now is. */
        counts(counts: Counts | undefined) {
            last = counts;
            drawCounts(scope, counts, wave);
        },
        sliders,
        scope,
    };
}
