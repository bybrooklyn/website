// What opens round the picture, each the kind of surface the Quires give a job of its kind
// (core/dialog.ts says the rule): the export, a side panel that starts below the bar, since it is
// looked at while choosing, the picture making room beside it rather than lying under it;
// resizing, a small box of fields grown from its button; and a strip for the tool in hand, its few choices as icons.
// Each grows from what opened it and gives the keyboard back there when it closes.

import { control, icon, make, still, tipAway } from "../core/ui";
import { switchButton } from "../core/dialog";
import { FORMATS, readWeight, weightSaid, type Settings } from "./export";
import type { Original, Rect } from "./steps";
import type { Edits, Facts, Keep } from "./metadata";

/** What of the metadata an export keeps, as its three buttons say it, each with its tooltip. */
export const KEEPS: { key: Keep; label: string; tip: string }[] = [
    { key: "none", label: "None", tip: "Nothing about the picture goes with it" },
    { key: "noplace", label: "No place", tip: "Camera, date and the rest, but not where it was taken" },
    { key: "all", label: "All", tip: "Everything the picture says about itself, where it was taken too" },
];

/** How a Display P3 picture's colors go out, as its two buttons say it: kept with its profile, or made sRGB. */
export const COLOR_CHOICES: { srgb: boolean; label: string; tip: string }[] = [
    { srgb: false, label: "Display P3", tip: "Its own colors, with its color profile" },
    { srgb: true, label: "sRGB", tip: "Converted to sRGB, for places that ignore color profiles" },
];

/** The fields she may change, in the order the facts show them. */
export const FIELDS: { key: keyof Edits; label: string }[] = [
    { key: "caption", label: "Caption" },
    { key: "alt", label: "Alt text" },
    { key: "author", label: "Author" },
    { key: "copyright", label: "Copyright" },
    { key: "date", label: "Date taken" },
];

/**
 * The facts: a side panel, as the export is, the picture making room beside it. Quiet rows of a label
 * and a value, the five fields she may change, and everything else the picture says under
 * "Everything", folded until she opens it.
 */
export function factsPanel(hooks: { closed?(): void; facts(): Facts & { size: string }; edits(): Edits; setEdit(key: keyof Edits, value: string): void }) {
    const side = sidePanel("Facts", "quire-img-export quire-img-facts-panel", () => hooks.closed?.());
    const rows = make("dl", "quire-img-fact-rows");
    const fields = make("div", "quire-img-fields");
    const more = make("details", "quire-img-everything");
    const summary = make("summary", "", "Everything");
    const all = make("dl", "quire-img-fact-rows");
    more.append(summary, all);
    side.body.append(rows, fields, more);
    function fill() {
        const facts = hooks.facts();
        const pairs = [["Size", facts.size], ...facts.rows] as [string, string][];
        rows.replaceChildren(...pairs.flatMap(([label, value]) => [make("dt", "", label), make("dd", "", value)]));
        const edits = hooks.edits();
        fields.replaceChildren(
            ...FIELDS.map((field) => {
                const row = make("label", "quire-img-row");
                const input = make("input", "quire-field");
                input.value = edits[field.key] ?? facts.found[field.key] ?? "";
                input.addEventListener("change", () => hooks.setEdit(field.key, input.value));
                input.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    hooks.setEdit(field.key, input.value);
                });
                row.append(make("span", "", field.label), input);
                return row;
            }),
        );
        all.replaceChildren(...facts.everything.flatMap(([label, value]) => [make("dt", "", label), make("dd", "", value)]));
        more.classList.toggle("away", !facts.everything.length);
    }
    return { ...side, fill };
}

/** The colors a mark can be drawn in, named in their tooltips. */
export const COLORS = [
    { name: "Red", value: "#ff3b30" },
    { name: "Yellow", value: "#ffd60a" },
    { name: "Green", value: "#30d158" },
    { name: "Blue", value: "#0a84ff" },
    { name: "Black", value: "#000000" },
    { name: "White", value: "#ffffff" },
];

/** How thick a mark is drawn, as a share of the picture's longer side. */
export const WEIGHTS = [
    { name: "Thin", value: 0.003 },
    { name: "Medium", value: 0.005 },
    { name: "Thick", value: 0.009 },
];

/** The shapes the crop's frame can be held to, width over height; the original's own is worked out when chosen. */
export const SHAPES: { name: string; icon: string; value?: number | "original" }[] = [
    { name: "Free", icon: "free" },
    { name: "Original", icon: "photo", value: "original" },
    { name: "Square", icon: "square", value: 1 },
    { name: "4:3", icon: "box", value: 4 / 3 },
    { name: "16:9", icon: "wide", value: 16 / 9 },
];

/** A document's name for a picture that arrived: the file's own name without its ending, or for a pasted screenshot (which comes named `image.png`) the day and time. */
export function nameFor(file: string | undefined, now: Date): string {
    const stem = (file ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
    if (stem && !/^(image|blob|unknown|clipboard|pasted)$/i.test(stem)) return stem;
    const day = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `Screenshot, ${day} ${time}`;
}

/** The picture's size in pixels and the weight it will be given out at, as the line under it says them. */
export const factsSaid = (size: { width: number; height: number }, bytes: number, format: string) => `${size.width} × ${size.height} px · ${weightSaid(bytes)} ${format}`;

/** A panel at the side that starts below the bar, with its title and a way to close it; it slides in, and closing gives the keyboard back to what opened it. */
export function sidePanel(title: string, className: string, closed?: () => void) {
    const panel = make("aside", `quire-img-panel ${className}`);
    panel.setAttribute("aria-label", title);
    panel.inert = true;
    const head = make("div", "quire-img-panel-head");
    const body = make("div", "quire-img-panel-body");
    let back: HTMLElement | undefined;
    const close = () => {
        if (!panel.classList.contains("open")) return;
        // the keyboard goes back to what opened it before the panel stops taking it
        const had = panel.contains(document.activeElement);
        panel.classList.remove("open");
        panel.inert = true;
        if (had) back?.focus({ preventScroll: true });
        closed?.();
    };
    head.append(make("span", "quire-outline-title", title), control("Close", icon("close"), close));
    panel.append(head, body);
    panel.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
    });
    return {
        panel,
        body,
        isOpen: () => panel.classList.contains("open"),
        open(from: HTMLElement) {
            back = from;
            tipAway();
            panel.inert = false;
            panel.classList.add("open");
        },
        close,
    };
}

/** The export panel: the format, its quality or a weight to come in under, the result's size, the original and the result side by side at their own pixels, and Copy and Save. */
export function exportPanel(hooks: { closed?(): void; settings(): Settings; set(settings: Settings): void; keep(): Keep; setKeep(keep: Keep): void; copy(): void; save(): void; wide?(): boolean }) {
    const side = sidePanel("Export", "quire-img-export", () => hooks.closed?.());
    const formats = make("div", "quire-img-formats");
    formats.setAttribute("role", "radiogroup");
    formats.setAttribute("aria-label", "Format");
    const quality = make("input", "quire-img-quality");
    quality.type = "range";
    quality.min = "5";
    quality.max = "100";
    quality.setAttribute("aria-label", "Quality");
    const qualityShown = make("span", "quire-img-quality-number");
    const under = make("input", "quire-field quire-img-under");
    under.placeholder = "No limit";
    under.setAttribute("aria-label", "Under");
    const lossy = make("div", "quire-img-lossy");
    const qualityRow = make("label", "quire-img-row");
    qualityRow.append(make("span", "", "Quality"), quality, qualityShown);
    const underRow = make("label", "quire-img-row");
    underRow.append(make("span", "", "Under"), under);
    lossy.append(qualityRow, underRow);
    const pair = make("div", "quire-img-pair");
    const before = make("figure", "quire-img-sample");
    const after = make("figure", "quire-img-sample");
    let beforeCanvas = make("canvas");
    let afterCanvas = make("canvas");
    const beforeSaid = make("figcaption");
    const afterSaid = make("figcaption");
    before.append(beforeCanvas, beforeSaid);
    after.append(afterCanvas, afterSaid);
    pair.append(before, after);
    const result = make("p", "quire-img-result");
    const actions = make("div", "quire-img-actions");
    const save = make("button", "quire-dialog-dismiss", "Save");
    save.type = "button";
    save.addEventListener("click", () => hooks.save());
    const copy = make("button", "quire-dialog-action", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => hooks.copy());
    actions.append(save, copy);
    // what of the picture's metadata goes with it: none unless she chooses, for this export
    const keeping = make("div", "quire-img-keep");
    keeping.setAttribute("role", "radiogroup");
    keeping.setAttribute("aria-label", "Metadata");
    // a Display P3 picture's colors: kept with its profile, or made sRGB for places that read no profile
    const colors = make("div", "quire-img-keep quire-img-colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", "Colors");
    side.body.append(formats, lossy, keeping, colors, result, pair, actions);

    const changed = (to: Partial<Settings>) => {
        const next = { ...hooks.settings(), ...to };
        if (!next.target) delete next.target;
        hooks.set(next);
        fill();
    };
    quality.addEventListener("input", () => ((qualityShown.textContent = quality.value), changed({ quality: Number(quality.value) / 100 })));
    under.addEventListener("change", () => changed({ target: readWeight(under.value) }));
    under.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        changed({ target: readWeight(under.value) });
    });

    function fill() {
        const settings = hooks.settings();
        keeping.replaceChildren(
            make("span", "quire-img-format-row", "Metadata"),
            ...KEEPS.map((each) => {
                const button = control(each.tip, each.label, () => (hooks.setKeep(each.key), fill()), "quire-button quire-img-format");
                button.setAttribute("role", "radio");
                button.setAttribute("aria-checked", String(hooks.keep() === each.key));
                button.classList.toggle("pressed", hooks.keep() === each.key);
                return button;
            }),
        );
        colors.classList.toggle("away", !hooks.wide?.());
        colors.replaceChildren(
            make("span", "quire-img-format-row", "Colors"),
            ...COLOR_CHOICES.map((each) => {
                const on = (settings.srgb === true) === each.srgb;
                const button = control(each.tip, each.label, () => changed({ srgb: each.srgb }), "quire-button quire-img-format");
                button.setAttribute("role", "radio");
                button.setAttribute("aria-checked", String(on));
                button.classList.toggle("pressed", on);
                return button;
            }),
        );
        // two rows of one set: the lossy formats, then those that keep every pixel, each row under its word
        formats.replaceChildren(
            ...[true, false].flatMap((lossy) => [
                make("span", "quire-img-format-row", lossy ? "Lossy" : "Lossless"),
                ...FORMATS.filter((format) => format.lossy === lossy).map((format) => {
                    const button = control(`${format.label}: ${format.tip}`, format.short, () => changed({ format: format.key }), "quire-button quire-img-format");
                    button.setAttribute("role", "radio");
                    button.setAttribute("aria-checked", String(format.key === settings.format));
                    button.classList.toggle("pressed", format.key === settings.format);
                    return button;
                }),
            ]),
        );
        const format = FORMATS.find((each) => each.key === settings.format)!;
        lossy.classList.toggle("away", !format.lossy);
        quality.value = String(Math.round(settings.quality * 100));
        qualityShown.textContent = quality.value;
        quality.disabled = !!settings.target;
        if (document.activeElement !== under) under.value = settings.target ? weightSaid(settings.target) : "";
    }

    /** Shows what the export came to: its size and weight, and the same part of the original and the result at their own pixels. */
    function shows(found: { width: number; height: number; bytes: number; label: string; over: boolean; quality: number; original: ImageData; exported?: ImageBitmap; at: Rect; originalBytes: number; space?: PredefinedColorSpace }) {
        result.textContent = `${found.width} × ${found.height} px · ${weightSaid(found.bytes)} ${found.label}${found.over ? " · over the weight even at the lowest quality" : ""}`;
        // fresh canvases each time, in the picture's own space (a canvas keeps the space it was first drawn in)
        const space = found.space ?? "srgb";
        const fresh = (old: HTMLCanvasElement) => {
            const made = make("canvas");
            old.replaceWith(made);
            return made;
        };
        beforeCanvas = fresh(beforeCanvas);
        afterCanvas = fresh(afterCanvas);
        for (const [canvas, draw] of [
            [beforeCanvas, (context: CanvasRenderingContext2D) => context.putImageData(found.original, 0, 0)],
            [afterCanvas, (context: CanvasRenderingContext2D) => found.exported && context.drawImage(found.exported, found.at.x, found.at.y, found.at.width, found.at.height, 0, 0, found.at.width, found.at.height)],
        ] as const) {
            canvas.width = found.at.width;
            canvas.height = found.at.height;
            canvas.dataset.space = space;
            draw(canvas.getContext("2d", { colorSpace: space })!);
        }
        beforeSaid.textContent = `Original · ${weightSaid(found.originalBytes)}`;
        afterSaid.textContent = `Export · ${weightSaid(found.bytes)}${found.exported ? "" : " · this browser cannot show it"}`;
    }
    return { ...side, fill, shows, copyButton: copy };
}

/** The resize box: width and height, linked, in pixels or as a percentage, and the common sizes; Enter applies and Escape closes it. */
export function resizeBox(hooks: { size(): { width: number; height: number }; apply(width: number, height?: number): void; back(): void; done(): void }) {
    const box = make("div", "quire-img-resize");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Resize");
    const width = make("input", "quire-field");
    const height = make("input", "quire-field");
    width.inputMode = height.inputMode = "numeric";
    width.setAttribute("aria-label", "Width");
    height.setAttribute("aria-label", "Height");
    let linked = true;
    let percent = false;
    const link = control("Keep the shape", icon("link"), () => ((linked = !linked), link.classList.toggle("pressed", linked), follow(width)));
    link.classList.add("pressed");
    const unit = switchButton("Percent", false, (on) => {
        const size = hooks.size();
        percent = on;
        width.value = String(on ? 100 : size.width);
        height.value = String(on ? 100 : size.height);
    });
    const sizes = make("div", "quire-img-sizes");
    for (const [label, wide] of [["50%", 0.5], ["1920", 1920], ["1280", 1280], ["1080", 1080], ["800", 800]] as const) {
        const button = make("button", "quire-dialog-dismiss", label);
        button.type = "button";
        button.addEventListener("click", () => {
            const size = hooks.size();
            hooks.apply(wide < 1 ? Math.round(size.width * wide) : wide);
            close(true);
        });
        sizes.append(button);
    }
    const fields = make("div", "quire-img-row");
    fields.append(width, make("span", "quire-img-by", "×"), height, link);
    box.append(fields, unit, sizes);
    const shape = () => hooks.size().height / hooks.size().width;
    function follow(changed: HTMLInputElement) {
        if (!linked) return;
        const value = Number(changed.value);
        if (!Number.isFinite(value) || value <= 0) return;
        if (percent) (changed === width ? height : width).value = changed.value;
        else if (changed === width) height.value = String(Math.max(1, Math.round(value * shape())));
        else width.value = String(Math.max(1, Math.round(value / shape())));
    }
    width.addEventListener("input", () => follow(width));
    height.addEventListener("input", () => follow(height));
    box.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === "Enter" && (event.target === width || event.target === height)) {
            event.preventDefault();
            const size = hooks.size();
            const asked = { width: Number(width.value), height: Number(height.value) };
            if (!(asked.width > 0 && asked.height > 0)) return;
            const wide = Math.round(percent ? (size.width * asked.width) / 100 : asked.width);
            const high = Math.round(percent ? (size.height * asked.height) / 100 : asked.height);
            hooks.apply(wide, linked ? undefined : high);
            close(true);
        }
    });
    /** Closes the box: back to its button, or to the picture once a size was applied. */
    let opener: HTMLElement | undefined;
    function close(applied = false) {
        if (!box.classList.contains("open")) return;
        box.classList.remove("open");
        box.inert = true;
        opener?.classList.remove("open");
        if (applied) hooks.done();
        else hooks.back();
    }
    box.inert = true;
    return {
        box,
        isOpen: () => box.classList.contains("open"),
        open(from: HTMLElement) {
            // its button is lit while the box is open, and so shows no tooltip under it, as the bar's buttons do in mdQuire
            opener = from;
            from.classList.add("open");
            tipAway();
            const size = hooks.size();
            percent = false;
            unit.set(false);
            width.value = String(size.width);
            height.value = String(size.height);
            const button = from.getBoundingClientRect();
            box.style.left = `${Math.max(8, Math.min(innerWidth - 300, button.left))}px`;
            box.style.top = `${button.bottom + 6}px`;
            box.style.transformOrigin = `${Math.max(0, button.left + button.width / 2 - Math.max(8, Math.min(innerWidth - 300, button.left)))}px 0`;
            box.inert = false;
            box.classList.add("open");
            width.focus();
            width.select();
        },
        close,
    };
}

/** What the strip shows while reading text: where the reading is, how far, what was found, and the size of model. */
export interface ReadSaid {
    state: "idle" | "asking" | "fetching" | "reading" | "read" | "failed";
    progress: number;
    words: number;
    private: number;
    model: string;
}

/** What the strip says of the reading, in a few quiet words. */
export function readSaid(read: ReadSaid): string {
    if (read.state === "reading") return `Reading text ${Math.round(read.progress * 100)}%`;
    if (read.state === "fetching") return "Downloading the model";
    if (read.state === "asking") return "Choosing a model";
    if (read.state === "failed") return "Not read";
    if (read.state === "idle") return "Read text";
    if (!read.words) return "No text found";
    const count = `${read.words} ${read.words === 1 ? "word" : "words"}`;
    return read.private ? `${count}, ${read.private} ${read.private === 1 ? "looks" : "look"} private` : count;
}

/** The strip for the tool in hand: the crop's shapes and Apply, a mark's colors and thickness, or the reading's few words and buttons. Icons only where it can be, each named in its tooltip. */
export function toolStrip(hooks: { color(): string; weight(): number; setColor(value: string): void; setWeight(value: number): void; shape(): string; setShape(name: string): void; apply(): void; turn?: TurnHooks; read?(): ReadSaid; hideAll?(): void; chooseModel?(from: HTMLElement): void; readAgain?(): void; grade?(): { said: string; controls?: HTMLElement[]; cancel?(): void } | undefined }) {
    const strip = make("div", "quire-img-strip");
    strip.setAttribute("role", "toolbar");
    strip.setAttribute("aria-label", "Tool");
    const swatch = (color: { name: string; value: string }) => {
        const mark = make("span", "quire-img-swatch");
        mark.style.background = color.value;
        return control(color.name, mark, () => hooks.setColor(color.value));
    };
    const weight = (each: { name: string; value: number }, at: number) => {
        const line = icon("line");
        line.style.strokeWidth = String(1.2 + at * 1.4);
        return control(`${each.name} line`, line, () => hooks.setWeight(each.value));
    };
    const words = (label: string, press: (button: HTMLButtonElement) => void, tip: string, filled = false) => {
        const button = make("button", filled ? "quire-img-strip-words filled" : "quire-img-strip-words", label);
        button.type = "button";
        button.title = tip;
        button.addEventListener("click", () => press(button));
        return button;
    };
    // the horizon's dial and the button that draws a line along it, made once so that a drag on the dial is never cut short by the strip filling again
    const dial = hooks.turn ? turnDial(hooks.turn) : undefined;
    const level = hooks.turn ? control("Draw along the horizon to level it", icon("line"), () => hooks.turn?.setLevelling(!hooks.turn.levelling())) : undefined;
    // the dial and its line button as one group, which a narrow screen puts on a row of its own under the shapes and Apply
    const horizon = make("div", "quire-img-strip-horizon");
    if (dial && level) horizon.append(make("span", "quire-img-strip-rule"), dial.element, level);
    function fill(kind: "crop" | "mark" | "read" | "grade" | "none") {
        const grading = kind === "grade" ? hooks.grade?.() : undefined;
        if (kind === "grade" && !grading) kind = "none";
        strip.classList.toggle("open", kind !== "none");
        strip.dataset.kind = kind;
        strip.inert = kind === "none";
        if (kind === "crop") {
            // the dial keeps the keyboard when the strip is filled again after each turn it makes
            const had = !!dial && document.activeElement === dial.element;
            queueMicrotask(() => had && dial?.element.focus({ preventScroll: true }));
            strip.replaceChildren(
                ...SHAPES.map((shape) => {
                    const button = control(shape.name === "Free" ? "Free shape" : `${shape.name} shape`, icon(shape.icon), () => hooks.setShape(shape.name));
                    button.classList.toggle("pressed", hooks.shape() === shape.name);
                    return button;
                }),
                ...(dial && level ? [horizon] : []),
                make("span", "quire-img-strip-rule"),
                control("Apply (Enter)", icon("tick"), () => hooks.apply()),
            );
            dial?.show();
            level?.classList.toggle("pressed", !!hooks.turn?.levelling());
        } else if (kind === "mark") {
            strip.replaceChildren(
                ...COLORS.map((color) => {
                    const button = swatch(color);
                    button.classList.toggle("pressed", hooks.color() === color.value);
                    return button;
                }),
                make("span", "quire-img-strip-rule"),
                ...WEIGHTS.map((each, at) => {
                    const button = weight(each, at);
                    button.classList.toggle("pressed", hooks.weight() === each.value);
                    return button;
                }),
            );
        } else if (grading) {
            // what a press on the picture will do now, in a few words, and a way not to
            const said = make("span", "quire-img-strip-said", grading.said);
            said.setAttribute("role", "status");
            const parts: HTMLElement[] = [said, ...(grading.controls ?? [])];
            if (grading.cancel) parts.push(make("span", "quire-img-strip-rule"), words("Cancel", () => grading.cancel?.(), "Do not, after all (Escape)"));
            const before = new Set([...strip.children].map((each) => each.textContent));
            strip.replaceChildren(...parts);
            if (!still()) for (const part of parts) if (part.textContent && !before.has(part.textContent) && part !== said) part.classList.add("grows");
        } else if (kind === "read" && hooks.read) {
            const read = hooks.read();
            const said = make("span", "quire-img-strip-said", readSaid(read));
            said.setAttribute("role", "status");
            const parts: HTMLElement[] = [said];
            if (read.state === "failed" && hooks.readAgain) parts.push(words("Try again", () => hooks.readAgain?.(), "Read the text again"));
            if (read.state === "read" && read.private && hooks.hideAll) parts.push(words("Hide all", () => hooks.hideAll?.(), "Cover everything that looks private, as one step", true));
            parts.push(make("span", "quire-img-strip-rule"), words(read.model, (button) => hooks.chooseModel?.(button), "Model"));
            // what is new in the strip grows in, rather than appearing
            const before = new Set([...strip.children].map((each) => each.textContent));
            strip.replaceChildren(...parts);
            if (!still()) for (const part of parts) if (part.textContent && !before.has(part.textContent) && part !== said) part.classList.add("grows");
        }
        if (still()) strip.style.transition = "none";
    }
    return { strip, fill };
}

/** What the horizon's dial is given: the picture's turn, the turn drawn while dragging (none to stop), the turn made a step, and whether a drag on the picture draws a line along the horizon. */
export interface TurnHooks {
    turn(): number;
    turning(degrees: number | undefined): void;
    turned(degrees: number): void;
    levelling(): boolean;
    setLevelling(on: boolean): void;
}

/** The degrees a dial's drag across its whole width turns the picture: the whole range, 15 each way. */
export const DIAL_RANGE = 30;

/** A turn as the dial says it, in tenths of a degree: "0°", "2.4°", "−3.1°". */
export const turnSaid = (degrees: number): string => (degrees ? `${degrees < 0 ? "−" : ""}${Math.abs(degrees).toFixed(1)}°` : "0°");

/** The turn a dial's drag gives: from where it started, by how far the pointer moved over the dial's width (a tenth as far with Shift), in tenths, snapping to level within two tenths, held within 15 each way. */
export function dialTurn(start: number, moved: number, width: number, fine: boolean): number {
    const raw = start + (moved / Math.max(1, width)) * DIAL_RANGE * (fine ? 0.1 : 1);
    const kept = Math.max(-DIAL_RANGE / 2, Math.min(DIAL_RANGE / 2, Math.round(raw * 10) / 10));
    return Math.abs(kept) < 0.25 ? 0 : kept;
}

/**
 * The horizon's dial: a ruler of degrees under a fixed middle line, which moves as it is dragged from
 * wherever it was pressed, so nothing jumps to the pointer; the number above says the turn. Letting go
 * makes the turn one step. The arrow keys turn it by a tenth (Shift, a degree), 0 or a double press
 * levels it again.
 */
function turnDial(hooks: TurnHooks) {
    const element = make("div", "quire-img-dial");
    element.tabIndex = 0;
    element.setAttribute("role", "slider");
    element.setAttribute("aria-label", "Straighten");
    element.setAttribute("aria-valuemin", String(-DIAL_RANGE / 2));
    element.setAttribute("aria-valuemax", String(DIAL_RANGE / 2));
    element.title = "Straighten: drag, or use the arrow keys";
    const ruler = make("div", "quire-img-dial-ruler");
    const said = make("span", "quire-img-dial-said");
    element.append(ruler, make("span", "quire-img-dial-middle"), said);
    let now = 0;
    const show = (degrees = hooks.turn()) => {
        now = degrees;
        said.textContent = turnSaid(degrees);
        element.setAttribute("aria-valuenow", String(degrees));
        element.setAttribute("aria-valuetext", turnSaid(degrees));
        element.classList.toggle("moved", degrees !== 0);
        // the ruler slides under the middle line: a degree is a fixed share of the dial's width
        ruler.style.setProperty("--turn", String(degrees));
    };
    let dragging: { id: number; x: number; start: number } | undefined;
    element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        element.focus({ preventScroll: true });
        element.setPointerCapture(event.pointerId);
        dragging = { id: event.pointerId, x: event.clientX, start: now };
        element.classList.add("dragging");
    });
    element.addEventListener("pointermove", (event) => {
        if (!dragging || dragging.id !== event.pointerId) return;
        // dragging right turns the picture back: the ruler is moved the way the pointer goes
        const next = dialTurn(dragging.start, dragging.x - event.clientX, element.clientWidth, event.shiftKey);
        if (next === now) return;
        show(next);
        hooks.turning(next);
    });
    const letGo = (event: PointerEvent) => {
        if (!dragging || dragging.id !== event.pointerId) return;
        const started = dragging.start;
        dragging = undefined;
        element.classList.remove("dragging");
        hooks.turning(undefined);
        if (now !== started) hooks.turned(now);
    };
    element.addEventListener("pointerup", letGo);
    element.addEventListener("pointercancel", (event) => {
        if (!dragging || dragging.id !== event.pointerId) return;
        const started = dragging.start;
        dragging = undefined;
        element.classList.remove("dragging");
        hooks.turning(undefined);
        show(started);
    });
    element.addEventListener("dblclick", () => {
        if (!now) return;
        show(0);
        hooks.turned(0);
    });
    element.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 1 : 0.1;
        const by: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
        let next: number | undefined;
        if (event.key in by) next = Math.round(Math.max(-DIAL_RANGE / 2, Math.min(DIAL_RANGE / 2, now + by[event.key]!)) * 10) / 10;
        else if (event.key === "0" || event.key === "Home") next = 0;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (next === now) return;
        show(next);
        hooks.turned(next);
    });
    return { element, show: () => show() };
}

/** Says an original's kind as a writer reads it: "PNG", "JPEG". */
export const kindOf = (original: Pick<Original, "type">) => FORMATS.find((format) => format.type === original.type)?.label ?? (original.type.replace(/^image\//, "").toUpperCase() || "picture");
