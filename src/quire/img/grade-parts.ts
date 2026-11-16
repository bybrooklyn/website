// The Grade surface's parts: the buttons that make a part (a gradient dragged across the picture, an
// area painted with the brush, a thing a model finds), and, with a part picked on the picture, its own
// few controls: its edge's feather, turning it inside out, the brush to add to it or erase from it
// (its size and softness), going back to the whole picture, and taking the part away. Parts are never
// listed: each is picked by pressing its handle on the picture.
//
//   const parts = gradeParts({ ... });
//   panel.parts.append(parts.element); parts.fill();

import { switchButton } from "../core/dialog";
import { make } from "../core/ui";
import { slider } from "./grade-panel";
import type { Shape } from "./masks";

/** The brush as it is set: its size and softness (0 to 100), whether it erases, and whether it is on. */
export interface Brush {
    size: number;
    soft: number;
    erase: boolean;
    on: boolean;
}

/** A brush's size from 0 to 100 as a radius in the original's pixels: from a two hundredth to a sixth of its longer side, more finely at the small end. */
export const brushRadius = (size: number, long: number): number => Math.max(1, Math.round(long * (0.005 + 0.16 * (size / 100) ** 2)));
/** A feather from 0 to 100 as a blur in the original's pixels: none to a tenth of the longer side, more finely at the small end. */
export const featherPixels = (feather: number, long: number): number => Math.round(long * 0.1 * (feather / 100) ** 2 * 10) / 10;
/** A blur in the original's pixels back as the feather slider's value. */
export const featherValue = (pixels: number, long: number): number => Math.round(Math.sqrt(Math.max(0, pixels) / (long * 0.1)) * 1000) / 10;

/** What a part is called on the surface: its kind, and its number among the parts of that kind. */
export function partName(kind: Shape["kind"], number: number): string {
    return `${kind === "gradient" ? "gradient" : kind === "paint" ? "painted area" : "found"} ${number}`;
}

/** What the parts need of the editor. */
export interface PartsHooks {
    /** The part picked, its name and shape, or none for the whole picture. */
    target(): { id: string; name: string; shape: Shape } | undefined;
    /** Goes back to grading the whole picture. */
    whole(): void;
    /** The original's longer side, which the feather and the brush are measured against. */
    long(): number;
    setShape(change: Partial<Shape>, live?: boolean): void;
    remove(): void;
    /** A gradient: the next drag on the picture makes one. */
    gradient(): void;
    making(): "gradient" | "find" | undefined;
    /** A painted area: a new part, the brush on. */
    paint(): void;
    /** A thing a model finds, if the models are there to offer. */
    find?(): void;
    brush(): Brush;
    setBrush(brush: Brush): void;
}

/** Builds the parts' section. */
export function gradeParts(hooks: PartsHooks) {
    const element = make("div", "quire-img-parts");
    const heading = make("p", "quire-img-grade-heading", "parts");
    const makers = make("div", "quire-img-grade-fixes");
    const button = (label: string, tip: string, press: () => void, className = "") => {
        const made = make("button", `quire-dialog-dismiss quire-img-grade-fix ${className}`, label);
        made.type = "button";
        made.title = tip;
        made.addEventListener("click", press);
        return made;
    };
    const gradient = button("gradient", "Then drag across the picture, from where the grade is whole to where it is gone, as for a sky", () => hooks.gradient(), "quire-img-make-gradient");
    const paint = button("paint", "A new part painted with a soft brush", () => hooks.paint(), "quire-img-make-paint");
    const find = button("find", "Press a thing in the picture and a model outlines it; or Subject or Background", () => hooks.find?.(), "quire-img-make-find");
    makers.append(gradient, paint, find);
    // the picked part's own controls
    const own = make("div", "quire-img-part");
    const head = make("div", "quire-img-part-head");
    const name = make("span", "quire-img-part-name");
    const back = button("whole picture", "Grade the whole picture again (Escape)", () => hooks.whole(), "quire-img-part-back");
    head.append(name, back);
    const featherSlider = slider(
        { key: "feather", label: "Feather", tip: "How soft the part's edge is", low: 0 },
        {
            value: () => featherValue(hooks.target()?.shape.feather ?? 0, hooks.long()),
            preview: (value) => hooks.setShape({ feather: featherPixels(value, hooks.long()) }, true),
            set: (value) => hooks.setShape({ feather: featherPixels(value, hooks.long()) }),
        },
    );
    const invert = switchButton("inside out", false, (on) => hooks.setShape({ invert: on || undefined }));
    invert.title = "Grade everything but the part";
    const brushOn = switchButton("brush", false, (on) => hooks.setBrush({ ...hooks.brush(), on }));
    brushOn.title = "Paint on the picture to add to this part";
    const erase = switchButton("erase", false, (on) => hooks.setBrush({ ...hooks.brush(), erase: on }));
    erase.title = "The brush takes away from the part";
    const switches = make("div", "quire-img-part-switches");
    switches.append(invert, brushOn, erase);
    const size = slider(
        { key: "brush-size", label: "Size", tip: "The brush's size", low: 0 },
        { value: () => hooks.brush().size, preview: (value) => hooks.setBrush({ ...hooks.brush(), size: value }), set: (value) => hooks.setBrush({ ...hooks.brush(), size: value }) },
    );
    const soft = slider(
        { key: "brush-soft", label: "Softness", tip: "How soft the brush's edge is", low: 0 },
        { value: () => hooks.brush().soft, preview: (value) => hooks.setBrush({ ...hooks.brush(), soft: value }), set: (value) => hooks.setBrush({ ...hooks.brush(), soft: value }) },
    );
    const brushRows = make("div", "quire-img-part-brush");
    brushRows.append(size.row, soft.row);
    const remove = button("remove part", "Takes this part and its grade away (Delete)", () => hooks.remove(), "quire-img-part-remove");
    own.append(head, featherSlider.row, switches, brushRows, remove);
    element.append(heading, makers, own);

    function fill() {
        const target = hooks.target();
        own.classList.toggle("away", !target);
        own.inert = !target;
        gradient.classList.toggle("pressed", hooks.making() === "gradient");
        find.classList.toggle("pressed", hooks.making() === "find");
        find.classList.toggle("away", !hooks.find);
        if (!target) return;
        name.textContent = target.name;
        featherSlider.show();
        invert.set(!!target.shape.invert);
        const brush = hooks.brush();
        brushOn.set(brush.on);
        erase.set(brush.erase);
        erase.disabled = !brush.on;
        brushRows.classList.toggle("away", !brush.on);
        size.show();
        soft.show();
    }
    return { element, fill };
}
