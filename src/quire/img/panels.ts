// What opens round the picture, each the kind of surface the Quires give a job of its kind
// (core/dialog.ts says the rule): the export, a side panel that starts below the bar, since it is
// looked at while choosing, the picture making room beside it rather than lying under it;
// resizing, a small box of fields grown from its button; and a strip for the tool in hand, its few choices as icons.
// Each grows from what opened it and gives the keyboard back there when it closes.

import { control, icon, make, still, tipAway } from "../core/ui";
import { switchButton } from "../core/dialog";
import { FORMATS, readWeight, weightSaid, type Settings } from "./export";
import type { Original, Rect } from "./steps";

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
function sidePanel(title: string, className: string, closed?: () => void) {
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
export function exportPanel(hooks: { closed?(): void; settings(): Settings; set(settings: Settings): void; copy(): void; save(): void }) {
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
    const beforeCanvas = make("canvas");
    const afterCanvas = make("canvas");
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
    side.body.append(formats, lossy, result, pair, actions);

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
        formats.replaceChildren(
            ...FORMATS.map((format) => {
                const button = make("button", "quire-button quire-img-format", format.label);
                button.type = "button";
                button.setAttribute("role", "radio");
                button.setAttribute("aria-checked", String(format.key === settings.format));
                button.classList.toggle("pressed", format.key === settings.format);
                button.addEventListener("click", () => changed({ format: format.key }));
                return button;
            }),
        );
        const format = FORMATS.find((each) => each.key === settings.format)!;
        lossy.classList.toggle("away", !format.lossy);
        quality.value = String(Math.round(settings.quality * 100));
        qualityShown.textContent = quality.value;
        quality.disabled = !!settings.target;
        if (document.activeElement !== under) under.value = settings.target ? weightSaid(settings.target) : "";
    }

    /** Shows what the export came to: its size and weight, and the same part of the original and the result at their own pixels. */
    function shows(found: { width: number; height: number; bytes: number; label: string; over: boolean; quality: number; original: ImageData; exported: ImageBitmap; at: Rect; originalBytes: number }) {
        result.textContent = `${found.width} × ${found.height} px · ${weightSaid(found.bytes)} ${found.label}${found.over ? " · over the weight even at the lowest quality" : ""}`;
        for (const [canvas, draw] of [
            [beforeCanvas, (context: CanvasRenderingContext2D) => context.putImageData(found.original, 0, 0)],
            [afterCanvas, (context: CanvasRenderingContext2D) => context.drawImage(found.exported, found.at.x, found.at.y, found.at.width, found.at.height, 0, 0, found.at.width, found.at.height)],
        ] as const) {
            canvas.width = found.at.width;
            canvas.height = found.at.height;
            draw(canvas.getContext("2d")!);
        }
        beforeSaid.textContent = `Original · ${weightSaid(found.originalBytes)}`;
        afterSaid.textContent = `Export · ${weightSaid(found.bytes)}`;
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

/** The strip for the tool in hand: the crop's shapes and Apply, or a mark's colors and thickness. Icons only, each named in its tooltip. */
export function toolStrip(hooks: { color(): string; weight(): number; setColor(value: string): void; setWeight(value: number): void; shape(): string; setShape(name: string): void; apply(): void }) {
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
    function fill(kind: "crop" | "mark" | "none") {
        strip.classList.toggle("open", kind !== "none");
        strip.inert = kind === "none";
        if (kind === "crop") {
            strip.replaceChildren(
                ...SHAPES.map((shape) => {
                    const button = control(shape.name === "Free" ? "Free shape" : `${shape.name} shape`, icon(shape.icon), () => hooks.setShape(shape.name));
                    button.classList.toggle("pressed", hooks.shape() === shape.name);
                    return button;
                }),
                make("span", "quire-img-strip-rule"),
                control("Apply (Enter)", icon("tick"), () => hooks.apply()),
            );
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
        }
        if (still()) strip.style.transition = "none";
    }
    return { strip, fill };
}

/** Says an original's kind as a writer reads it: "PNG", "JPEG". */
export const kindOf = (original: Pick<Original, "type">) => FORMATS.find((format) => format.type === original.type)?.label ?? (original.type.replace(/^image\//, "").toUpperCase() || "picture");
