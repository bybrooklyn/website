// The pages of imgQuire's side panel (side.ts) that are not a tool's own logic: the export, which shows
// with no tool on; the facts; resize; the crop with its level dial and perspective; and reading text.
// Each is built of the small tools' kit (core/bench.ts): a choice of one is dots, an action is a word, a
// number is a slider or a line to type on, a color a swatch. Besides them, the words and tables the
// pages and the menus share: the marks, their colors and sizes, the crop's shapes, and the line under
// the picture.

import { dots, fold, group, lowered, row, slide, stack, tick, typed, word } from "../core/bench";
import { make } from "../core/ui";
import { FORMATS, readWeight, weightSaid, type Settings } from "./export";
import type { MarkKind, Original, Rect } from "./steps";
import type { Edits, Facts, Keep } from "./metadata";
import type { Page, sideColumn } from "./side";

/** The side column the pages are made in. */
type Side = ReturnType<typeof sideColumn>;

/** What of the metadata an export keeps, as its three dots say it, each with its tooltip. */
export const KEEPS: { key: Keep; label: string; tip: string }[] = [
    { key: "none", label: "none", tip: "Nothing about the picture goes with it" },
    { key: "noplace", label: "no place", tip: "Camera, date and the rest, but not where it was taken" },
    { key: "all", label: "all", tip: "Everything the picture says about itself, where it was taken too" },
];

/** How a Display P3 picture's colors go out, as its two dots say it: kept with its profile, or made sRGB. */
export const COLOR_CHOICES: { srgb: boolean; label: string; tip: string }[] = [
    { srgb: false, label: "Display P3", tip: "Its own colors, with its color profile" },
    { srgb: true, label: "sRGB", tip: "Converted to sRGB, for places that ignore color profiles" },
];

/** The fields she may change, in the order the facts show them. */
export const FIELDS: { key: keyof Edits; label: string }[] = [
    { key: "caption", label: "caption" },
    { key: "alt", label: "alt text" },
    { key: "author", label: "author" },
    { key: "copyright", label: "copyright" },
    { key: "date", label: "date taken" },
];

/**
 * The facts, a page of the side panel: quiet rows of a label and a value, the five fields she may change,
 * and everything else the picture says under "everything", folded until she opens it.
 */
export function factsPanel(side: Side, hooks: { facts(): Facts & { size: string }; edits(): Edits; setEdit(key: keyof Edits, value: string): void }) {
    const page = side.page("facts", "quire-img-facts-panel");
    const rows = make("dl", "quire-img-fact-rows");
    const fields = group(undefined);
    fields.classList.add("quire-img-fields");
    const more = make("details", "quire-img-everything");
    const summary = make("summary", "", "everything");
    const all = make("dl", "quire-img-fact-rows");
    more.append(summary, all);
    const everything = group(undefined, more);
    page.body.append(group(undefined, rows), fields, everything);
    function fill() {
        const facts = hooks.facts();
        const pairs = [["size", facts.size], ...facts.rows] as [string, string][];
        rows.replaceChildren(...pairs.flatMap(([label, value]) => [make("dt", "", lowered(label)), make("dd", "", value)]));
        const edits = hooks.edits();
        fields.querySelectorAll(".quire-bench-row").forEach((each) => each.remove());
        fields.append(
            ...FIELDS.map((field) => {
                // kept when it is left or Enter is pressed, as a field of the facts always was
                const line = typed(field.label, () => {});
                const input = line.input as HTMLInputElement;
                line.set(edits[field.key] ?? facts.found[field.key] ?? "");
                input.addEventListener("change", () => hooks.setEdit(field.key, input.value));
                input.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    hooks.setEdit(field.key, input.value);
                });
                return line.row;
            }),
        );
        // an XMP name (dc:creator, aux:Lens) is written as the file has it; the other names are labels like the rows above
        all.replaceChildren(...facts.everything.flatMap(([label, value]) => [make("dt", "", label.includes(":") ? label : lowered(label)), make("dd", "", value)]));
        fold(everything, !!facts.everything.length);
    }
    return { ...page, fill };
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

/** The marks as the panel, the menus and the keys offer them: each one's name, icon and key. */
export const MARK_TOOLS: Record<MarkKind, { label: string; icon: string; key: string }> = {
    arrow: { label: "Arrow", icon: "arrow", key: "A" },
    box: { label: "Box", icon: "box", key: "B" },
    text: { label: "Text", icon: "text", key: "T" },
    number: { label: "Numbered step", icon: "step", key: "N" },
    highlight: { label: "Highlighter", icon: "highlight", key: "H" },
    magnifier: { label: "Magnifier", icon: "lens", key: "M" },
    spotlight: { label: "Spotlight", icon: "spotlight", key: "S" },
};

/** How far a magnifier enlarges. */
export const ZOOM_STEPS = [2, 3, 4];

/** How dark the spotlight shades everything round its shapes. */
export const SHADES = [
    { name: "Light shade", value: 0.35 },
    { name: "Medium shade", value: 0.55 },
    { name: "Dark shade", value: 0.75 },
];

/** How wide a text's outline is drawn, as a share of the text's size. */
export const OUTLINES = [
    { name: "Thin outline", value: 0.05 },
    { name: "Medium outline", value: 0.08 },
    { name: "Thick outline", value: 0.13 },
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

/** What a Give to all control is given: what it will do in plain words (nothing outside a batch; empty when this picture has nothing of the kind to give), its word, and what a press does. */
export interface GiveHooks {
    said(): string | undefined;
    label(): string;
    press(): void;
}

/** A Give to all word with a plain line under it saying what it will do before it is pressed; the two grow in only in a batch, and fold away outside one. */
export function giveRow(hooks: GiveHooks) {
    const button = word("", () => hooks.press());
    button.classList.add("quire-img-give-button");
    const said = make("p", "quire-img-give-said");
    const made = fold(group("batch", button, said), false);
    made.classList.add("quire-img-give");
    function fill() {
        const words = hooks.said();
        fold(made, words !== undefined);
        button.textContent = hooks.label();
        button.disabled = !words;
        said.textContent = words || "This picture has none of this to give";
    }
    return { row: made, fill };
}

/** What the export page shows in a batch: how many pictures, whether a folder can be chosen, what giving the settings to all will do, and how far saving all has come. */
export interface BatchOut {
    count: number;
    folder: boolean;
    give: string;
    running?: string;
}

/**
 * The export, the page the side panel shows with no tool on: the format, its quality or a weight to come in under, what of the metadata
 * goes with it, the result's size, the original and the result side by side at their own pixels, and copy and save; in a batch, the
 * settings given to all and every picture saved together.
 */
export function exportPanel(side: Side, hooks: { settings(): Settings; set(settings: Settings): void; keep(): Keep; setKeep(keep: Keep): void; copy(): void; save(): void; wide?(): boolean; note?(): { text: string; actions: { label: string; press(): void }[] } | undefined; batch?(): BatchOut | undefined; giveAll?(): void; saveAll?(how: "zip" | "folder"): void; stopAll?(): void }) {
    const page = side.page("export", "quire-img-export");
    const changed = (to: Partial<Settings>) => {
        const next = { ...hooks.settings(), ...to };
        if (!next.target) delete next.target;
        hooks.set(next);
        fill();
    };
    // two rows of one choice: the lossy formats, then those that keep every pixel, each row after its word
    const formatDots = (lossy: boolean) =>
        dots(
            lossy ? "lossy" : "lossless",
            FORMATS.filter((format) => format.lossy === lossy).map((format) => ({ value: format.key, text: format.short, tip: `${format.label}: ${format.tip}` })),
            (key) => changed({ format: key }),
        );
    const lossyFormats = formatDots(true);
    const losslessFormats = formatDots(false);
    const formats = group("format", row("lossy", lossyFormats.set), row("lossless", losslessFormats.set));
    formats.classList.add("quire-img-formats");
    const quality = slide("quality", { min: 5, max: 100 }, (value) => changed({ quality: value / 100 }));
    quality.input.classList.add("quire-img-quality");
    const under = typed("under", () => {}, { hint: "No limit" }) as { row: HTMLElement; input: HTMLInputElement; set(value: string): void };
    under.input.classList.add("quire-img-under");
    under.input.addEventListener("change", () => changed({ target: readWeight(under.input.value) }));
    under.input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        changed({ target: readWeight(under.input.value) });
    });
    const lossy = group(undefined, quality.row, under.row);
    lossy.classList.add("quire-img-lossy");
    // what of the picture's metadata goes with it: none unless she chooses, for this export
    const keeping = dots<Keep>(
        "metadata",
        KEEPS.map((each) => ({ value: each.key, text: each.label, tip: each.tip })),
        (key) => (hooks.setKeep(key), fill()),
    );
    keeping.group.classList.add("quire-img-keep");
    // a Display P3 picture's colors: kept with its profile, or made sRGB for places that read no profile
    const colors = dots<"p3" | "srgb">(
        "colors",
        COLOR_CHOICES.map((each) => ({ value: each.srgb ? "srgb" : "p3", text: each.label, tip: each.tip })),
        (value) => changed({ srgb: value === "srgb" }),
    );
    colors.group.classList.add("quire-img-colors");
    // a plain word when the format chosen cannot keep what the picture has (a cut-out's transparency in a JPEG), with what can be done
    const note = group(undefined);
    note.classList.add("quire-img-note");
    note.setAttribute("role", "status");
    // in a batch: whose settings these are, giving them to all, and every picture saved together, with how far it has come and stop
    const own = make("p", "quire-img-all-said");
    const give = word("give to all", () => hooks.giveAll?.());
    give.classList.add("quire-img-give-button");
    const giveSaid = make("p", "quire-img-give-said");
    const zip = word("save all as a zip", () => hooks.saveAll?.("zip"));
    const folder = word("save all into a folder", () => hooks.saveAll?.("folder"));
    const ways = stack(undefined, zip, folder);
    ways.classList.add("quire-img-all-ways");
    const goingSaid = make("span", "quire-img-all-said");
    const stop = word("stop", () => hooks.stopAll?.(), true);
    const going = group(undefined, goingSaid, stop);
    going.classList.add("quire-img-all-going");
    going.setAttribute("role", "status");
    const all = group("all pictures", own, give, giveSaid, ways, going);
    all.classList.add("quire-img-all");
    all.setAttribute("aria-label", "All pictures");
    const result = make("p", "quire-img-result");
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
    const copy = word("copy", () => hooks.copy());
    copy.classList.add("quire-img-copy");
    const save = word("save", () => hooks.save(), true);
    save.classList.add("quire-img-save");
    const actions = group(undefined, copy, save);
    actions.classList.add("quire-img-actions");
    page.body.append(formats, lossy, keeping.group, colors.group, note, all, group("it will be", result, pair), actions);
    // each word of a choice of the export is a label of its dot, the way tests and assistive tools find a format by its name
    for (const set of [lossyFormats.set, losslessFormats.set, keeping.set, colors.set]) set.querySelectorAll("label").forEach((label) => label.classList.add("quire-img-format"));

    function fill() {
        const settings = hooks.settings();
        keeping.show(hooks.keep());
        const said = hooks.note?.();
        fold(note, !!said);
        note.replaceChildren(...(said ? [make("p", "", said.text), ...said.actions.map((each) => word(lowered(each.label), () => (each.press(), fill())))] : []));
        fold(colors.group, !!hooks.wide?.());
        colors.show(settings.srgb === true ? "srgb" : "p3");
        lossyFormats.show(settings.format);
        losslessFormats.show(settings.format);
        const format = FORMATS.find((each) => each.key === settings.format)!;
        fold(lossy, format.lossy);
        quality.set(Math.round(settings.quality * 100));
        quality.input.disabled = !!settings.target;
        if (document.activeElement !== under.input) under.set(settings.target ? weightSaid(settings.target) : "");
        const batch = hooks.batch?.();
        fold(all, !!batch);
        if (batch) {
            own.textContent = `These settings are this picture's own. Each of the ${batch.count} pictures is saved with its own.`;
            give.textContent = `give to the other ${batch.count - 1}`;
            giveSaid.textContent = batch.give;
            zip.textContent = `save all ${batch.count} as a zip`;
            fold(folder, batch.folder);
            fold(going, !!batch.running);
            goingSaid.textContent = batch.running ?? "";
            for (const button of [give, zip, folder]) button.disabled = !!batch.running;
        }
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
        beforeSaid.textContent = `original · ${weightSaid(found.originalBytes)}`;
        afterSaid.textContent = `export · ${weightSaid(found.bytes)}${found.exported ? "" : " · this browser cannot show it"}`;
    }
    return { ...page, fill, shows, copyButton: copy };
}

/** The sizes resize offers with one press: a share of the picture's width (twice and four times as large among them), or a width in pixels. */
export const SIZES: [string, number][] = [["50%", 0.5], ["200%", 2], ["400%", 4], ["1920", 1920], ["1280", 1280], ["1080", 1080], ["800", 800]];

/**
 * Resize, a page of the side panel: width and height, linked, in pixels or as a percentage, applied with Enter or apply; and the
 * common sizes, among them twice and four times as large, each applied with one press. In a batch, the size given to the others.
 */
export function resizePage(side: Side, hooks: { size(): { width: number; height: number }; apply(width: number, height?: number): void; done(): void; give?: GiveHooks }) {
    const page = side.page("resize", "quire-img-resize");
    let linked = true;
    let percent = false;
    const width = typed("width", () => follow(width.input as HTMLInputElement));
    const height = typed("height", () => follow(height.input as HTMLInputElement));
    for (const each of [width, height]) {
        (each.input as HTMLInputElement).inputMode = "numeric";
        each.input.setAttribute("aria-label", each === width ? "Width" : "Height");
    }
    const link = tick("keep the shape", (on) => ((linked = on), follow(width.input as HTMLInputElement)), "Keep the shape");
    link.set(true);
    const unit = tick("percent", (on) => {
        const size = hooks.size();
        percent = on;
        width.set(String(on ? 100 : size.width));
        height.set(String(on ? 100 : size.height));
    });
    const apply = word("apply", () => applyTyped());
    const fields = group("size", width.row, height.row, row("", link.row), row("", unit.row), row("", apply));
    const sizes = group(
        "sizes",
        ...SIZES.map(([label, wide]) =>
            word(label, () => {
                const size = hooks.size();
                hooks.apply(wide <= 4 ? Math.round(size.width * wide) : wide);
                hooks.done();
            }),
        ),
    );
    sizes.classList.add("quire-img-sizes");
    // in a batch, this picture's size given to the others, said in plain words before it is pressed
    const giving = hooks.give && giveRow({ ...hooks.give, press: () => (hooks.give!.press(), hooks.done()) });
    page.body.append(fields, sizes, ...(giving ? [giving.row] : []));
    const shape = () => hooks.size().height / hooks.size().width;
    function follow(changed: HTMLInputElement) {
        if (!linked) return;
        const value = Number(changed.value);
        if (!Number.isFinite(value) || value <= 0) return;
        const other = (changed === width.input ? height : width).input as HTMLInputElement;
        if (percent) other.value = changed.value;
        else if (changed === width.input) other.value = String(Math.max(1, Math.round(value * shape())));
        else other.value = String(Math.max(1, Math.round(value / shape())));
    }
    function applyTyped() {
        const size = hooks.size();
        const asked = { width: Number(width.input.value), height: Number(height.input.value) };
        if (!(asked.width > 0 && asked.height > 0)) return;
        const wide = Math.round(percent ? (size.width * asked.width) / 100 : asked.width);
        const high = Math.round(percent ? (size.height * asked.height) / 100 : asked.height);
        hooks.apply(wide, linked ? undefined : high);
        hooks.done();
    }
    page.body.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || (event.target !== width.input && event.target !== height.input)) return;
        event.preventDefault();
        applyTyped();
    });
    /** Fills the fields with the picture's size as it now is. */
    function fill() {
        const size = hooks.size();
        percent = false;
        unit.set(false);
        width.set(String(size.width));
        height.set(String(size.height));
        giving?.fill();
    }
    return { ...page, fill, width: width.input as HTMLInputElement };
}

/** What the crop's page is given: the shape chosen and a shape chosen, the apply, the horizon's dial, and perspective's dials and corners. */
export interface CropHooks {
    shape(): string;
    setShape(name: string): void;
    apply(): void;
    turn: TurnHooks;
    perspective: PerspectiveHooks;
    /** Whether perspective's part is open. */
    straightening(): boolean;
}

/**
 * The crop, a page of the side panel: the shape its frame is held to, the horizon's dial with drawing along the horizon to level it,
 * perspective (its part grows open under its box: two dials, corners to drag, and auto), and apply.
 */
export function cropPage(side: Side, hooks: CropHooks) {
    const page = side.page("crop", "quire-img-crop-page");
    const shapes = dots(
        "shape",
        SHAPES.map((shape) => ({ value: shape.name, text: lowered(shape.name), tip: shape.name === "Free" ? "Free shape" : `${shape.name} shape` })),
        (name) => (hooks.setShape(name), fill()),
    );
    const dial = turnDial(hooks.turn);
    const level = tick("draw along the horizon", (on) => hooks.turn.setLevelling(on), "Draw along the horizon to level it");
    const keystone = hooks.perspective;
    const upright = keystoneDial(keystone, "vertical");
    const across = keystoneDial(keystone, "horizontal");
    const straighten = tick("perspective", (on) => keystone.setOpen(on), "Perspective (P)");
    const corners = tick("corners", (on) => keystone.setCornering(on), "Corners: drag them to the corners of something that should be a rectangle");
    const auto = word("auto", () => keystone.auto());
    auto.title = "Straighten the upright lines, and the level ones where they are clear";
    const dials = fold(group(undefined, row("vertical", upright.element), row("horizontal", across.element), row("", corners.row), row("", auto)), false);
    dials.classList.add("quire-img-keystones");
    const apply = word("apply", () => hooks.apply());
    apply.title = "Apply (Enter)";
    page.body.append(shapes.group, group("level", dial.element, level.row), group(undefined, straighten.row, dials), group(undefined, apply));
    function fill() {
        shapes.show(hooks.shape());
        dial.show();
        upright.show();
        across.show();
        level.set(hooks.turn.levelling());
        const open = hooks.straightening();
        straighten.set(open);
        fold(dials, open);
        corners.set(keystone.cornering());
    }
    return { ...page, fill, dial: dial.element, vertical: upright.element };
}

/** What the reading of a picture's text says: where the reading is, how far, what was found, and the size of model. */
export interface ReadSaid {
    state: "idle" | "asking" | "fetching" | "reading" | "read" | "failed";
    progress: number;
    words: number;
    private: number;
    model: string;
}

/** What the reading's page says of it, in a few quiet words. */
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

/** Reading text, a page of the side panel: where the reading is, trying again when it failed, hiding all that looks private, and the size of model. */
export function readPage(side: Side, hooks: { read(): ReadSaid; hideAll(): void; chooseModel(from: HTMLElement): void; readAgain(): void }) {
    const page = side.page("read text", "quire-img-read-page");
    const said = make("p", "quire-img-read-said");
    said.setAttribute("role", "status");
    const again = word("try again", () => hooks.readAgain());
    again.title = "Read the text again";
    const hide = word("hide all", () => hooks.hideAll());
    hide.title = "Cover everything that looks private, as one step";
    const model = word("", (button) => hooks.chooseModel(button));
    model.title = "Model";
    page.body.append(group(undefined, said, fold(again, false), fold(hide, false)), group(undefined, row("model", model)));
    function fill() {
        const read = hooks.read();
        said.textContent = readSaid(read);
        fold(again, read.state === "failed");
        fold(hide, read.state === "read" && !!read.private);
        model.textContent = lowered(read.model);
    }
    return { ...page, fill };
}

/** Says an original's kind as a writer reads it: "PNG", "JPEG". */
export const kindOf = (original: Pick<Original, "type">) => FORMATS.find((format) => format.type === original.type)?.label ?? (original.type.replace(/^image\//, "").toUpperCase() || "picture");

/** A page of the side panel, as the editor holds the ones it makes itself. */
export type { Page };

/** What the horizon's dial is given: the picture's turn, the turn drawn while dragging (none to stop), the turn made a step, and whether a drag on the picture draws a line along the horizon. */
export interface TurnHooks {
    turn(): number;
    turning(degrees: number | undefined): void;
    turned(degrees: number): void;
    levelling(): boolean;
    setLevelling(on: boolean): void;
}

/** What perspective's part of the strip is given: the dials' degrees, the degrees drawn while one is dragged (none to stop), the dials made a step, the corners set by hand on or off and whether there are any, the one press, and the strip opened or closed. */
export interface PerspectiveHooks {
    vertical(): number;
    horizontal(): number;
    live(dials: { vertical: number; horizontal: number } | undefined): void;
    set(dials: { vertical: number; horizontal: number }): void;
    cornering(): boolean;
    setCornering(on: boolean): void;
    hasCorners(): boolean;
    auto(): void;
    setOpen(on: boolean): void;
}

/** The degrees a dial's drag across its whole width turns the picture: the whole range, 15 each way. */
export const DIAL_RANGE = 30;

/** A turn as the dial says it, in tenths of a degree: "0°", "2.4°", "−3.1°". */
export const turnSaid = (degrees: number): string => (degrees ? `${degrees < 0 ? "−" : ""}${Math.abs(degrees).toFixed(1)}°` : "0°");

/** The turn a dial's drag gives: from where it started, by how far the pointer moved over the dial's width (a tenth as far with Shift), in tenths, snapping to level within two tenths, held within 15 each way. */
export function dialTurn(start: number, moved: number, width: number, fine: boolean, most = DIAL_RANGE / 2): number {
    const raw = start + (moved / Math.max(1, width)) * DIAL_RANGE * (fine ? 0.1 : 1);
    const kept = Math.max(-most, Math.min(most, Math.round(raw * 10) / 10));
    return Math.abs(kept) < 0.25 ? 0 : kept;
}

/**
 * The horizon's dial: a ruler of degrees under a fixed middle line, which moves as it is dragged from
 * wherever it was pressed, so nothing jumps to the pointer; the number above says the turn. Letting go
 * makes the turn one step. The arrow keys turn it by a tenth (Shift, a degree), 0 or a double press
 * levels it again.
 */
function turnDial(hooks: TurnHooks) {
    return dial({ name: "Straighten", tip: "Straighten: drag, or use the arrow keys", most: DIAL_RANGE / 2, value: hooks.turn, live: hooks.turning, set: hooks.turned });
}

/** One of perspective's two keystone dials: the camera tilted up or down (vertical), or turned left or right (horizontal), in degrees, 30 at most either way; the same dial as the horizon's, its ruler longer. */
function keystoneDial(hooks: PerspectiveHooks, which: "vertical" | "horizontal") {
    const other = which === "vertical" ? "horizontal" : "vertical";
    const both = (value: number) => ({ [which]: value, [other]: hooks[other]() }) as { vertical: number; horizontal: number };
    const made = dial({
        name: which === "vertical" ? "Vertical" : "Horizontal",
        tip: which === "vertical" ? "Vertical: stands leaning upright lines straight; drag, or use the arrow keys" : "Horizontal: makes lines that run away to one side level; drag, or use the arrow keys",
        most: 30,
        value: hooks[which],
        live: (value) => hooks.live(value === undefined ? undefined : both(value)),
        set: (value) => hooks.set(both(value)),
    });
    made.element.classList.add("long");
    return made;
}

/** What a dial is given: its name and tooltip, how far it goes either way, its value, the value drawn while it is dragged (none to stop), and the value made a step. */
interface DialHooks {
    name: string;
    tip: string;
    most: number;
    value(): number;
    live(value: number | undefined): void;
    set(value: number): void;
}

/** A dial: a ruler of degrees under a fixed middle line, dragged from wherever it is pressed (the whole width 30 degrees, a tenth as far with Shift), snapping to zero within a quarter of a degree; the arrow keys move it by a tenth (Shift, a degree), 0 or a double press puts it back to zero; letting go is one step. */
function dial(hooks: DialHooks) {
    const element = make("div", "quire-img-dial");
    element.tabIndex = 0;
    element.setAttribute("role", "slider");
    element.setAttribute("aria-label", hooks.name);
    element.setAttribute("aria-valuemin", String(-hooks.most));
    element.setAttribute("aria-valuemax", String(hooks.most));
    element.title = hooks.tip;
    const ruler = make("div", "quire-img-dial-ruler");
    const said = make("span", "quire-img-dial-said");
    element.append(ruler, make("span", "quire-img-dial-middle"), said);
    let now = 0;
    const show = (degrees = hooks.value()) => {
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
        const next = dialTurn(dragging.start, dragging.x - event.clientX, element.clientWidth, event.shiftKey, hooks.most);
        if (next === now) return;
        show(next);
        hooks.live(next);
    });
    const letGo = (event: PointerEvent) => {
        if (!dragging || dragging.id !== event.pointerId) return;
        const started = dragging.start;
        dragging = undefined;
        element.classList.remove("dragging");
        hooks.live(undefined);
        if (now !== started) hooks.set(now);
    };
    element.addEventListener("pointerup", letGo);
    element.addEventListener("pointercancel", (event) => {
        if (!dragging || dragging.id !== event.pointerId) return;
        const started = dragging.start;
        dragging = undefined;
        element.classList.remove("dragging");
        hooks.live(undefined);
        show(started);
    });
    element.addEventListener("dblclick", () => {
        if (!now) return;
        show(0);
        hooks.set(0);
    });
    element.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 1 : 0.1;
        const by: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
        let next: number | undefined;
        if (event.key in by) next = Math.round(Math.max(-hooks.most, Math.min(hooks.most, now + by[event.key]!)) * 10) / 10;
        else if (event.key === "0" || event.key === "Home") next = 0;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (next === now) return;
        show(next);
        hooks.set(next);
    });
    return { element, show: () => show() };
}
