// The cut-out as a page of its own (/cutout/): drop, paste or choose a picture and its background comes
// off, at its full size, in this browser. It is one box, as a mini's is: the picture on the left and a
// column of controls on the right, written the way the site's own controls are (the Walker's column):
// a small heading for each group, round dots for a choice of one, words in the accent to press, thin
// rules between, everything in lowercase. The groups are background (clear, color with the site's
// colors, blur), touch up (keep, remove: a brush, pressed again to put it down), quality (quick, best)
// and, at the foot, copy (the main one), save, hold to see the original and choose another picture.
// An empty box says one line and offers choose a picture (and, on a phone, paste); the column is there
// from the start, faint until it has something to act on, so nothing appears from nowhere. A picture
// arriving is shown at once with a line under it saying it is being cut out; the first time, the
// quality is asked for and fetched only when she says so. A press on the picture keeps the thing
// pressed when there are several; the backslash held shows the picture as it came. A right-click opens
// a menu of the same (Shift leaves the browser's). Many pictures at once sit in a strip of small
// pictures under the one shown (batch-strip.ts), each cut out in turn behind it, and are saved together
// as one zip or into a folder under their own names, by the same code as imgQuire's Export all
// (batch-out.ts). Nothing leaves the browser: the only requests are for the page, ONNX Runtime and the
// model's files.
//
//   createCutoutPage(host, { colors: [{ name: "White", value: "#ffffff" }, ...] });

import { bench, dots, group, stack, swatches, word, type Swatch } from "../../core/bench";
import { flowMenu, make, ruled, RULE, still, type MenuItem } from "../../core/ui";
import { crc32 } from "../../core/zip";
import type { FolderHandle } from "../../core/store-folder";
import { decodeHeic, heicIn } from "../codec-run";
import { profileOf } from "../metadata";
import { deflated, pixelsToSrgb, withProfile } from "../profile";
import { createFinder, type Finder } from "../parts/finder";
import { CUT_TIERS, PART_TIERS } from "../parts/models";
import type { Stroke } from "../masks";
import { namesFor, picturesSaid, whichSaid } from "../batch";
import { atOnce, blobSink, fileSink, folderOut, runEach, zipOut, type Destination } from "../batch-out";
import { batchStrip, type StripItem } from "../batch-strip";
import { pixelsOf, smallLook, smallOf } from "../thumbs";
import { createAsking } from "./asking";
import { blank, cutOut, CUT_SIDE, findCut, FOUND_NOTHING, type Cut, type Laid } from "./cut";
import type { Press } from "../parts/segment";

/** The words of the page that a visitor reads first. */
export const CUT_WORDS = {
    empty: "Drop, paste or choose a picture, and its background comes off. It never leaves your browser.",
    choose: "choose a picture",
    paste: "paste",
    working: "Cutting out",
    notCut: "Not cut out",
    /** When the model finds nothing: what is said, and the next step, which is a press on the thing wanted. */
    nothing: "Nothing was found to cut out. Press the thing you want to keep.",
};

/** A cut-out as the page holds it: with the presses that made it, when the model found nothing and it was pressed out by hand. */
interface PressedCut extends Cut {
    presses?: Press[];
}

/** A color offered to lay the cut-out on, named in its tooltip (the kit's). */
export type { Swatch };

/** What the page is given: the colors offered (the site's), and a finder for tests. */
export interface PageOptions {
    colors?: Swatch[];
    finder?: () => Finder;
}

/** The words of the page when many pictures are cut out together. */
export const ALL_WORDS = {
    zip: (count: number) => `save all ${count} as a zip`,
    folder: "save all into a folder",
    stop: "stop",
};

/** A file's name made the cut-out's: its stem and "cut out", as a PNG. */
export function cutName(name: string | undefined): string {
    const stem = (name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "picture";
    return `${stem}-cut-out.png`;
}

/** The lines of the right-click menu, in lowercase as the page's own controls are: paste and choose a picture with nothing shown; copy, save and paste, then keep and remove, with a cut-out. */
export function cutMenuLines(state: { cut: boolean; brush?: "keep" | "remove" }, run: { copy(): void; save(): void; paste(): void; choose(): void; brush(which: "keep" | "remove"): void }): MenuItem[] {
    const paste: MenuItem = { label: "paste", icon: "paste", hint: "Ctrl+V", key: "paste", run: run.paste };
    if (!state.cut) return [paste, { label: "choose a picture", icon: "image", key: "choose", run: run.choose }];
    return [
        { label: "copy", icon: "copy", hint: "Ctrl+C", key: "copy", run: run.copy },
        { label: "save", icon: "download", hint: "Ctrl+S", key: "save", run: run.save },
        paste,
        RULE,
        { label: "keep", icon: "pen", key: "keep", pressed: state.brush === "keep", run: () => run.brush("keep") },
        { label: "remove", icon: "clear", key: "remove", pressed: state.brush === "remove", run: () => run.brush("remove") },
    ];
}

/** Builds the page on its host. */
export function createCutoutPage(host: HTMLElement, options: PageOptions = {}) {
    let finder: Finder | undefined;
    const finderNow = () => (finder ??= options.finder?.() ?? createFinder());
    // the box every small tool is built from (core/bench.ts): the picture's side, one line under it, and the column of controls
    const box = bench("Cut-out", "quire-cut");
    const { root, work: left, side } = box;
    const room = make("div", "quire-cut-room");
    const empty = make("div", "quire-cut-empty");
    const chooser = make("input");
    chooser.type = "file";
    chooser.accept = "image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif,.heic,.heif";
    chooser.multiple = true;
    chooser.hidden = true;
    const choose = word(CUT_WORDS.choose, () => chooser.click());
    const pasteButton = word(CUT_WORDS.paste, () => void pasteFromMenu(), true);
    pasteButton.classList.add("quire-cut-paste");
    const emptyActions = make("div", "quire-cut-empty-actions");
    emptyActions.append(choose, pasteButton);
    empty.append(make("p", "quire-cut-line", CUT_WORDS.empty), emptyActions, chooser);
    const view = make("div", "quire-cut-view");
    let canvas = make("canvas", "quire-cut-canvas");
    const over = make("canvas", "quire-cut-over");
    view.append(canvas, over);
    room.append(empty, view);
    box.hold(room);
    host.append(root);

    const asking = createAsking({ finder: finderNow, returnTo: () => (picture ? copyButton : choose) });
    let file: (Blob & { name?: string }) | undefined;
    let picture: ImageBitmap | undefined;
    let space: "srgb" | "p3" = "srgb";
    let profile: Uint8Array | undefined;
    let cut: PressedCut | undefined;
    // true when the model found nothing in the picture shown: a press on the thing wanted is then the way to cut it out
    let nothing = false;
    let result: ImageData | undefined;
    let laid: Laid = "clear";
    let color = options.colors?.[0]?.value ?? "#ffffff";
    let brush: "keep" | "remove" | undefined;
    let holding = false;
    let busy = 0;
    const say = box.say;

    // ---- the column beside the picture ----
    const lays = dots<Laid>(
        "background",
        [
            { value: "clear", text: "clear", tip: "Nothing behind it, saved with transparency" },
            { value: "color", text: "color", tip: "A color behind it" },
            { value: "blur", text: "blur", tip: "The old background behind it, blurred" },
        ],
        (value) => laid !== value && setLaid(value),
    );
    const colors = swatches("color", options.colors ?? [{ name: "White", value: "#ffffff" }], (value) => ((color = value), (laid = "color"), void again(), fill()));
    colors.set.classList.add("quire-cut-swatches");
    lays.group.append(colors.set);
    const brushes = dots<"keep" | "remove">(
        "touch up",
        [
            { value: "keep", text: "keep", tip: "Paint what should stay; press again to put the brush down" },
            { value: "remove", text: "remove", tip: "Paint what should go; press again to put the brush down" },
        ],
        (value) => setBrush(brush === value ? undefined : value),
    );
    const qualities = dots<string>(
        "quality",
        CUT_TIERS.map((tier) => ({ value: tier.id, text: tier.name.toLowerCase(), tip: tier.who })),
        (value, input) => void chooseQuality(value, input),
    );
    const copyButton = word("copy", () => void copy());
    copyButton.classList.add("quire-cut-copy");
    const saveButton = word("save", () => void save(), true);
    const out = group(undefined, copyButton, saveButton);
    out.classList.add("quire-cut-out");
    const original = word("hold to see the original", () => {}, true);
    original.classList.add("quire-cut-hold");
    original.title = "Hold to see the original (\\)";
    const another = word("choose another picture", () => chooser.click(), true);
    const more = stack(undefined, original, another);
    // with many pictures: every cut-out saved together, as one zip or into a folder, with how far it has come and its stop
    const zipAll = word(ALL_WORDS.zip(0), () => void saveAll("zip"));
    const folderAll = word(ALL_WORDS.folder, () => void saveAll("folder"));
    const stopAll = word(ALL_WORDS.stop, () => saving?.stop.abort(), true);
    const all = stack(undefined, zipAll, folderAll, stopAll);
    all.classList.add("quire-cut-all");
    side.append(lays.group, brushes.group, qualities.group, out, more, all);
    const pickers = globalThis as unknown as { showDirectoryPicker?: (options: object) => Promise<FolderHandle>; showSaveFilePicker?: (options: object) => Promise<{ name: string; createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }> }> };

    function fill() {
        const many = entries.length > 1;
        root.classList.toggle("batched", many);
        all.classList.toggle("away", !many);
        all.inert = !many;
        zipAll.textContent = ALL_WORDS.zip(entries.length);
        folderAll.classList.toggle("away", !pickers.showDirectoryPicker);
        stopAll.classList.toggle("away", !saving);
        zipAll.disabled = folderAll.disabled = !!saving;
        root.classList.toggle("shown", !!picture);
        root.classList.toggle("cut", !!result);
        root.classList.toggle("clear", laid === "clear" && !!result && !holding);
        root.classList.toggle("pressable", nothing && !result);
        box.busy(busy > 0);
        // what acts on a cut-out waits for one; the quality and another picture need only a picture, so a quality that found nothing can be changed
        for (const each of [lays.group, brushes.group, out, original]) each.inert = !result;
        qualities.group.inert = another.inert = !picture;
        lays.show(laid);
        colors.set.classList.toggle("open", laid === "color");
        colors.set.inert = laid !== "color";
        colors.show(color);
        brushes.show(brush);
        qualities.show(asking.tier().id);
        view.dataset.brush = brush ?? "";
    }

    // ---- the picture on the screen: the cut-out, or the original while held ----
    function show() {
        const source: ImageData | ImageBitmap | undefined = holding || !result ? picture : result;
        if (!source) return;
        // a canvas in the picture's own space, made anew when that changes, so a Display P3 photograph shows its own colors
        if (canvas.dataset.space !== space) {
            const fresh = make("canvas", "quire-cut-canvas");
            fresh.dataset.space = space;
            canvas.replaceWith(fresh);
            canvas = fresh;
        }
        canvas.width = source.width;
        canvas.height = source.height;
        over.width = source.width;
        over.height = source.height;
        const context = canvas.getContext("2d", { colorSpace: space === "p3" ? "display-p3" : "srgb" })!;
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (source instanceof ImageData) context.putImageData(new ImageData(source.data, source.width, source.height, { colorSpace: space === "p3" ? "display-p3" : "srgb" }), 0, 0);
        else context.drawImage(source, 0, 0);
        fill();
    }

    // ---- a picture arriving ----
    /** A picture decoded as the browser draws it, its numbers as they are (a HEIC by the HEIC module). */
    async function decode(given: Blob): Promise<ImageBitmap> {
        const head = new Uint8Array(await given.slice(0, 16).arrayBuffer());
        return heicIn(head) ? createImageBitmap(await decodeHeic(given)) : createImageBitmap(given, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    }
    /** Shows a picture and cuts it out; given the cut it already has (a picture of many, stepped to again), that is laid as it was. */
    async function take(given: Blob & { name?: string }, kept?: Cut) {
        let bitmap: ImageBitmap;
        try {
            bitmap = await decode(given);
        } catch {
            say("That is not a picture this browser can read.");
            return;
        }
        picture?.close();
        // another picture has no fading copy of the last one lying over it
        view.querySelector(".quire-cut-leaving")?.remove();
        file = given;
        picture = bitmap;
        cut = kept && { ...kept, background: laid, ...(laid === "color" ? { color } : {}) };
        result = undefined;
        nothing = false;
        brush = undefined;
        const colored = await profileOf(new Uint8Array(await given.arrayBuffer()));
        if (file !== given) return;
        space = colored.space.space;
        profile = colored.icc;
        show();
        say(entries.length > 1 ? `${whichSaid(at, entries.length)} · ${entries[at]?.file.name ?? ""}` : "");
        if (cut) await again();
        else await cutNow();
    }

    /** Runs the model on the picture and makes the cut-out, asking for the model first if it is not kept. */
    async function cutNow(from?: HTMLElement) {
        if (!picture) return;
        if (!(await asking.ready(from ?? (choose.isConnected ? choose : undefined)))) {
            say(`${CUT_WORDS.notCut}. Choose a quality to cut it out.`);
            return fill();
        }
        // one of many that could not be cut out is said again, not run again: the same model gives the same answer
        const failedBefore = entries.length > 1 ? entries[at]?.failed : undefined;
        if (failedBefore) {
            nothing = failedBefore === FOUND_NOTHING;
            say(`${whichSaid(at, entries.length)} · ${nothing ? CUT_WORDS.nothing : `${CUT_WORDS.notCut}: ${failedBefore}`}`);
            return fill();
        }
        busy++;
        // a slow quality says how long it usually takes, so the wait is known
        const wait = asking.tier().wait;
        box.busy(true, wait ? `${CUT_WORDS.working}, usually ${wait}` : CUT_WORDS.working);
        fill();
        const started = performance.now();
        try {
            const shown = picture;
            const entry = entries[at];
            if (entries.length > 1 && entry) {
                // one of many: cut by the same run as the rest, never twice
                const made = await cutEntry(entry);
                if (!made) throw new Error(entry.failed ?? "the model found nothing to cut out");
                if (entries[at] !== entry) return;
                cut = { ...made, background: laid, ...(laid === "color" ? { color } : {}) };
            } else {
                const answer = await findCut(finderNow(), asking.tier().id, () => createImageBitmap(shown), CUT_SIDE);
                cut = { found: answer.found, background: laid, ...(laid === "color" ? { color } : {}) };
            }
            await again(true);
            say(`${entries.length > 1 ? `${whichSaid(at, entries.length)} · ` : ""}Cut out in ${((performance.now() - started) / 1000).toFixed(1)} s, ${picture.width} × ${picture.height}.`);
        } catch (error) {
            const said = error instanceof Error ? error.message : String(error);
            // a model that found nothing leaves the picture as it was, and says so with the next step: a press on the thing wanted
            nothing = said === FOUND_NOTHING;
            say(nothing ? `${entries.length > 1 ? `${whichSaid(at, entries.length)} · ` : ""}${CUT_WORDS.nothing}` : `${CUT_WORDS.notCut}: ${said}`);
        } finally {
            busy--;
            fill();
        }
    }

    /**
     * What is on the screen now, laid over the picture's own canvas, to fade away once the cut-out has been drawn under it: a background
     * cut away is seen to go and does not vanish between two frames. Gives what starts the fade, or nothing where less motion is asked for.
     */
    function leaving(): (() => void) | undefined {
        if (still() || !canvas.width || !canvas.height) return undefined;
        view.querySelector(".quire-cut-leaving")?.remove();
        const copy = make("canvas", "quire-cut-leaving");
        [copy.width, copy.height] = [canvas.width, canvas.height];
        copy.getContext("2d", { colorSpace: space === "p3" ? "display-p3" : "srgb" })!.drawImage(canvas, 0, 0);
        canvas.after(copy);
        return () => {
            const fading = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: "ease" });
            const gone = () => copy.remove();
            fading.finished.then(gone, gone);
        };
    }

    /** Makes the cut-out again from what it is now (its mask, strokes, subject and background); with `fade`, what was shown fades out over it. */
    async function again(fade = false) {
        if (!picture || !cut) return;
        cut = { ...cut, background: laid, ...(laid === "color" ? { color } : {}) };
        // one of many keeps its own mask, strokes and subject
        const entry = entries[at];
        if (entries.length > 1 && entry) {
            entry.cut = cut;
            fillStrip();
        }
        const shown = picture;
        const made = await cutOut(picture, cut);
        if (made && shown === picture) result = made;
        const leave = fade ? leaving() : undefined;
        show();
        leave?.();
    }

    function setLaid(next: Laid) {
        laid = next;
        void again(true);
        fill();
    }
    function setBrush(next: "keep" | "remove" | undefined) {
        brush = next;
        fill();
    }
    /** Takes the quality whose dot was pressed (its model asked for first if it is not kept) and cuts the picture out again with it. */
    async function chooseQuality(id: string, button: HTMLElement) {
        const was = asking.tier().id;
        if (id === was && cut) return fill();
        if (!(await asking.use(id, button))) return fill();
        fill();
        // with many, every picture is cut again with the quality chosen, the one shown first
        if (entries.length > 1) {
            for (const entry of entries) {
                entry.cut = undefined;
                entry.cutting = undefined;
                entry.failed = undefined;
            }
            cut = undefined;
        }
        await cutNow(button);
        if (entries.length > 1) void cutRest();
    }

    // ---- getting it out ----
    /** The cut-out as a PNG at full size; with its colour profile when it is kept in its own colors, made sRGB for the clipboard. */
    async function pngOf(srgb: boolean): Promise<Blob> {
        if (!result) throw new Error("nothing is cut out yet");
        return pngFrom(result, srgb && space === "p3", profile);
    }
    /** Pixels as a PNG through the browser's own encoder, made sRGB from Display P3 when `convert`, else with their colour profile when they have one. */
    async function pngFrom(pixels: ImageData, convert: boolean, icc: Uint8Array | undefined): Promise<Blob> {
        const data = convert ? pixelsToSrgb(pixels.data) : pixels.data;
        const canvas = new OffscreenCanvas(pixels.width, pixels.height);
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), pixels.width, pixels.height), 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        if (convert || !icc) return blob;
        return new Blob([withProfile(new Uint8Array(await blob.arrayBuffer()), icc, crc32, pixels, await deflated(icc)) as BlobPart], { type: "image/png" });
    }
    async function copy() {
        if (!result) return;
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(true) })]);
            say(`Copied, ${result.width} × ${result.height}.`);
        } catch (error) {
            say(`Not copied: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async function save() {
        if (!result) return;
        const link = make("a");
        link.href = URL.createObjectURL(await pngOf(false));
        // one of many keeps its own name, as it does when all are saved; one alone is named as it always was
        link.download = entries.length > 1 ? namesFor([file?.name], ".png")[0]! : cutName(file?.name);
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        say(`Saved as ${link.download}.`);
    }
    async function pasteFromMenu() {
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => each.startsWith("image/"));
                if (type) return void (await take(new File([await item.getType(type)], "image.png", { type })));
            }
            say("There is no picture on the clipboard.");
        } catch {
            say("Press Ctrl+V to paste.");
        }
    }

    // ---- the four ways in: paste, drop, choose, and Paste from the menu or the phone's button ----
    const picturesIn = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((each) => each.type.startsWith("image/") || /\.(heic|heif)$/i.test(each.name));
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) return;
        const found = picturesIn(event.clipboardData);
        if (!found.length) return;
        event.preventDefault();
        void takeAll(found);
    };
    document.addEventListener("paste", pasted);
    room.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
        event.preventDefault();
        root.classList.add("dropping");
    });
    room.addEventListener("dragleave", () => root.classList.remove("dropping"));
    room.addEventListener("drop", (event) => {
        root.classList.remove("dropping");
        const found = picturesIn(event.dataTransfer);
        if (!found.length) return;
        event.preventDefault();
        void takeAll(found, { x: event.clientX, y: event.clientY });
    });
    // true while the chooser is open to add pictures to the many shown rather than to start again
    let addingByChooser = false;
    chooser.addEventListener("change", () => {
        const found = [...(chooser.files ?? [])];
        chooser.value = "";
        if (found.length) void (addingByChooser ? addAll(found) : takeAll(found));
        addingByChooser = false;
    });

    // ---- many pictures: a strip of small pictures under the one shown, each cut out in turn, and all saved together ----
    /** One picture of many: its file, its cut once made (its own mask, strokes and subject), the run making it, why it could not be, and its small copy. */
    interface Entry {
        key: string;
        file: Blob & { name?: string };
        cut?: PressedCut;
        cutting?: Promise<Cut | undefined>;
        failed?: string;
        small?: ImageData;
        drawn?: StripItem["pixels"];
        drawnFor?: string;
    }
    let entries: Entry[] = [];
    let at = 0;
    let made = 0;
    const strip = batchStrip({
        pick: (index) => void showEntry(index),
        menu: (index, x, y, keyboard) => openEntryMenu(index, x, y, keyboard),
        drop: (files, place) => void addAll(files, place),
    });
    box.hold(strip.element);
    /** A small picture drawn as its cut-out is laid, or as it came until it is cut. */
    function drawnOf(entry: Entry): StripItem["pixels"] {
        if (!entry.small) return undefined;
        const key = entry.cut ? `${entry.cut.found.runs.length} ${entry.cut.strokes?.length ?? 0} ${!!entry.cut.pick} ${laid} ${color}` : "";
        if (entry.drawn && entry.drawnFor === key) return entry.drawn;
        const size = { width: entry.small.width, height: entry.small.height };
        entry.drawn = entry.cut ? smallLook(entry.small, { original: { name: "", ...size, type: "", bytes: 0 }, steps: [{ id: "s1", type: "cutout", ...entry.cut, background: laid, ...(laid === "color" ? { color } : {}) }] }, "srgb") : entry.small;
        entry.drawnFor = key;
        return entry.drawn;
    }
    function fillStrip(from?: { x: number; y: number }) {
        if (entries.length < 2) strip.fill([], 0);
        else strip.fill(entries.map((entry, index) => ({ key: entry.key, label: `${whichSaid(index, entries.length)}, ${entry.file.name ?? "picture"}${entry.failed ? ", not cut out" : ""}`, pixels: drawnOf(entry) })), at, from);
        fill();
    }
    /** Many pictures at once: the first shown and cut out, the rest cut out one after another behind it; one picture is shown as it always was. */
    async function takeAll(files: (Blob & { name?: string })[], from?: { x: number; y: number }) {
        saving?.stop.abort();
        rest++;
        if (files.length < 2) {
            entries = [];
            fillStrip();
            return take(files[0]!);
        }
        entries = files.map((file) => ({ key: `c${++made}`, file }));
        at = -1;
        fillStrip(from);
        void readSmalls();
        await showEntry(0);
        void cutRest();
    }
    /** Pictures added to the many shown (a picture shown alone becomes the first of them). */
    async function addAll(files: (Blob & { name?: string })[], from?: { x: number; y: number }) {
        const found = files.filter((each) => each.type.startsWith("image/") || /\.(heic|heif)$/i.test(each.name ?? ""));
        if (!found.length) return;
        if (!entries.length && file) entries = [{ key: `c${++made}`, file, ...(cut ? { cut } : {}) }];
        if (!entries.length) return takeAll(found, from);
        entries.push(...found.map((each) => ({ key: `c${++made}`, file: each })));
        if (at < 0) at = 0;
        fillStrip(from);
        void readSmalls();
        void cutRest();
    }
    /** Each picture's small copy, made in turn as the strip fills in. */
    async function readSmalls() {
        for (const entry of [...entries]) {
            if (entry.small || !entries.includes(entry)) continue;
            entry.small = await smallOf(entry.file)
                .then(pixelsOf)
                .catch(() => undefined);
            fillStrip();
        }
    }
    /** Shows another of the many: the one shown keeps its cut, and the one stepped to is laid as it was, or cut out now. */
    async function showEntry(index: number) {
        if (index < 0 || index >= entries.length || index === at) return;
        const before = entries[at];
        if (before && cut) before.cut = cut;
        at = index;
        fillStrip();
        const entry = entries[at]!;
        await take(entry.file, entry.cut);
    }
    // one model run at a time, whether for the picture shown or the rest behind it
    let line: Promise<unknown> = Promise.resolve();
    /** A picture of many cut out, once: decoded, run through the model, and let go, its mask kept. */
    function cutEntry(entry: Entry): Promise<Cut | undefined> {
        if (entry.cut) return Promise.resolve(entry.cut);
        entry.cutting ??= (async () => {
            const job = line.then(async () => {
                if (entry.cut) return entry.cut;
                const bitmap = await decode(entry.file);
                try {
                    const answer = await findCut(finderNow(), asking.tier().id, () => createImageBitmap(bitmap), CUT_SIDE);
                    entry.cut = { found: answer.found, background: laid, ...(laid === "color" ? { color } : {}) };
                    return entry.cut;
                } finally {
                    bitmap.close();
                }
            });
            line = job.catch(() => undefined);
            try {
                return await job;
            } catch (error) {
                entry.failed = error instanceof Error ? error.message : String(error);
                return undefined;
            } finally {
                entry.cutting = undefined;
            }
        })();
        return entry.cutting;
    }
    // a number for each run over the rest, so a new set of pictures stops the old run
    let rest = 0;
    /** The pictures not cut out yet, one after another behind the one shown, the line under the bar saying how far. */
    async function cutRest() {
        const run = ++rest;
        if (!(await asking.ready())) return;
        for (const entry of [...entries]) {
            if (run !== rest) return;
            if (entry.cut || entry.failed || !entries.includes(entry)) continue;
            const done = entries.filter((each) => each.cut).length;
            if (entries[at] !== entry) say(`Cutting out ${done + 1} of ${entries.length}`);
            await cutEntry(entry);
            if (run !== rest) return;
            fillStrip();
        }
        if (run !== rest) return;
        const failed = entries.filter((each) => each.failed).length;
        say(failed ? `${picturesSaid(entries.length - failed)} cut out; ${failed} could not be` : `All ${entries.length} cut out.`);
    }
    /** Takes one picture out of the many; the one beside it is shown if it was the one shown. */
    async function takeOut(index: number) {
        const current = index === at;
        entries.splice(index, 1);
        if (index < at) at--;
        if (current) {
            at = -1;
            await showEntry(Math.min(index, entries.length - 1));
        }
        fillStrip();
    }
    // the menu a right-click on a small picture opens
    const entryMenu = flowMenu("Picture", { className: "quire-img-press-menu" });
    const entryAnchor = make("span", "quire-anchor");
    entryAnchor.setAttribute("aria-hidden", "true");
    function openEntryMenu(index: number, x: number, y: number, keyboard: boolean) {
        Object.assign(entryAnchor.style, { left: `${x}px`, top: `${y}px`, height: "0px" });
        if (!entryAnchor.isConnected) document.body.append(entryAnchor);
        const adding: MenuItem[] = [
            { label: "add pictures", icon: "plus", key: "add-pictures", run: () => ((addingByChooser = true), chooser.click()) },
            { label: "paste", icon: "paste", hint: "Ctrl+V", key: "paste-into", run: () => void pasteInto() },
        ];
        const lines = index < 0 ? adding : ruled([{ label: "save this one", icon: "download", key: "save-one", run: () => void showEntry(index).then(() => save()) }, { label: "copy this one", icon: "copy", key: "copy-one", run: () => void showEntry(index).then(() => copy()) }], adding, [{ label: "take out", icon: "trash", key: "take-out", disabled: !!saving, run: () => void takeOut(index) }]);
        entryMenu.open(entryAnchor, lines, keyboard);
        if (!keyboard) entryMenu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }
    /** Paste from the strip's menu: the clipboard's picture added to the many. */
    async function pasteInto() {
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => each.startsWith("image/"));
                if (type) return void (await addAll([new File([await item.getType(type)], "image.png", { type })]));
            }
            say("There is no picture on the clipboard.");
        } catch {
            say("Press Ctrl+V to paste.");
        }
    }
    /** A run of Save all: how far it has come, and its stop. */
    let saving: { done: number; count: number; stop: AbortController } | undefined;
    /**
     * Every cut-out saved together, each laid as the page lays them, as a PNG under its picture's own name with
     * the ending `.png` (the second of one name `photo (1).png`): into one zip written as it goes, or straight
     * into a folder chosen, never over a file there. Each picture is decoded only while it is made; Stop keeps
     * what was written.
     */
    async function saveAll(how: "zip" | "folder") {
        if (entries.length < 2 || saving) return;
        const before = entries[at];
        if (before && cut) before.cut = cut;
        const zipName = "cut-outs.zip";
        let out: Destination;
        let place: string;
        try {
            if (how === "folder") {
                const handle = await pickers.showDirectoryPicker?.({ mode: "readwrite", id: "quire-cutout" });
                if (!handle) return;
                out = folderOut(handle);
                place = handle.name;
            } else if (pickers.showSaveFilePicker) {
                const handle = await pickers.showSaveFilePicker({ suggestedName: zipName, types: [{ description: "Zip", accept: { "application/zip": [".zip"] } }] });
                out = zipOut(await fileSink(handle));
                place = handle.name;
            } else {
                out = zipOut(blobSink());
                place = zipName;
            }
        } catch {
            return;
        }
        const list = [...entries];
        const names = namesFor(
            list.map((entry) => entry.file.name),
            ".png",
            await out.taken().catch(() => []),
        );
        const stop = new AbortController();
        saving = { done: 0, count: list.length, stop };
        fill();
        const ran = await runEach(
            list.length,
            async (index) => {
                const entry = list[index]!;
                const kept = entry.cut ?? (await cutEntry(entry));
                if (!kept) throw new Error(entry.failed ?? "not cut out");
                const bitmap = await decode(entry.file);
                try {
                    const pixels = await cutOut(bitmap, { ...kept, background: laid, ...(laid === "color" ? { color } : {}) });
                    if (!pixels) throw new Error("not cut out");
                    const colored = await profileOf(new Uint8Array(await entry.file.arrayBuffer()));
                    return await pngFrom(pixels, false, colored.icc);
                } finally {
                    bitmap.close();
                }
            },
            async (index, blob) => void (await out.write(names[index]!, blob)),
            {
                atOnce: Math.min(2, atOnce()),
                signal: stop.signal,
                progress: (done) => {
                    if (saving) saving.done = done;
                    say(`Saving ${done} of ${list.length}`);
                },
            },
        );
        let zip: Blob | undefined;
        try {
            zip = await out.finish();
        } catch (error) {
            await out.abort();
            say(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
        }
        saving = undefined;
        fill();
        if (zip) {
            const link = make("a");
            link.href = URL.createObjectURL(zip);
            link.download = zipName;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        }
        if (ran.stopped) say(`Stopped: ${picturesSaid(ran.done)} of ${list.length} saved to ${place}.`);
        else if (ran.failed.length) say(`${picturesSaid(ran.done)} of ${list.length} saved to ${place}; ${ran.failed.length} could not be cut out.`);
        else say(`${picturesSaid(ran.done)} saved to ${place}.`);
    }

    // ---- the right-click menu ----
    const menu = flowMenu("Cut-out", { className: "quire-img-press-menu" });
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    root.addEventListener("contextmenu", (event) => {
        // Shift leaves the browser's own menu; a field and a button keep theirs
        if (event.shiftKey || (event.target instanceof Element && event.target.closest("input, textarea, button"))) return;
        event.preventDefault();
        Object.assign(anchor.style, { left: `${event.clientX}px`, top: `${event.clientY}px`, height: "0px" });
        if (!anchor.isConnected) document.body.append(anchor);
        const lines = cutMenuLines({ cut: !!result, brush }, { copy: () => void copy(), save: () => void save(), paste: () => void pasteFromMenu(), choose: () => chooser.click(), brush: (which) => setBrush(brush === which ? undefined : which) });
        menu.open(anchor, lines, false);
        menu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    });

    // ---- the keys: Ctrl+C, Ctrl+S, the backslash held ----
    const keys = (event: KeyboardEvent) => {
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea")) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && result) {
            event.preventDefault();
            void copy();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && result) {
            event.preventDefault();
            void save();
        } else if (event.key === "\\" && result) hold(event.type === "keydown");
        else if (event.key === "Escape" && brush) setBrush(undefined);
        else if (event.type === "keydown" && entries.length > 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !(event.target instanceof Element && event.target.closest(".quire-img-thumbs, .quire-menu"))) {
            // the next and the one before, the first and the last, as in imgQuire
            const to = event.key === "PageDown" ? at + 1 : event.key === "PageUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : undefined;
            if (to === undefined) return;
            event.preventDefault();
            void showEntry(Math.max(0, Math.min(entries.length - 1, to)));
        }
    };
    document.addEventListener("keydown", keys);
    document.addEventListener("keyup", keys);
    function hold(on: boolean) {
        if (holding === on) return;
        holding = on;
        show();
    }
    original.addEventListener("pointerdown", () => hold(true));
    for (const name of ["pointerup", "pointerleave", "pointercancel"]) original.addEventListener(name, () => hold(false));

    // ---- on the picture: the brush, or a press that keeps the thing pressed ----
    let stroke: Stroke | undefined;
    let pressedAt: { x: number; y: number } | undefined;
    const placeOf = (event: PointerEvent) => {
        const box = canvas.getBoundingClientRect();
        return { x: ((event.clientX - box.left) / box.width) * canvas.width, y: ((event.clientY - box.top) / box.height) * canvas.height };
    };
    const brushSize = () => Math.max(4, Math.round(Math.max(canvas.width, canvas.height) / 60));
    view.addEventListener("pointerdown", (event) => {
        // with a cut-out, or where the model found nothing and a press is what makes one
        if ((!result && !nothing) || event.button !== 0) return;
        event.preventDefault();
        view.setPointerCapture(event.pointerId);
        const at = placeOf(event);
        if (brush && result) stroke = { size: brushSize(), soft: 0.5, ...(brush === "remove" ? { erase: true } : {}), points: [Math.round(at.x), Math.round(at.y)] };
        else pressedAt = at;
    });
    view.addEventListener("pointermove", (event) => {
        if (!stroke) return;
        const at = placeOf(event);
        const points = stroke.points;
        if (Math.hypot(at.x - points[points.length - 2]!, at.y - points[points.length - 1]!) < stroke.size / 4) return;
        points.push(Math.round(at.x), Math.round(at.y));
        // the stroke shown as it is painted, lightly, until letting go makes the cut-out again
        const context = over.getContext("2d")!;
        context.strokeStyle = brush === "remove" ? "rgba(255, 80, 80, 0.45)" : "rgba(120, 220, 140, 0.45)";
        context.lineWidth = stroke.size * 2;
        context.lineCap = context.lineJoin = "round";
        context.beginPath();
        context.moveTo(points[points.length - 4]!, points[points.length - 3]!);
        context.lineTo(points[points.length - 2]!, points[points.length - 1]!);
        context.stroke();
    });
    view.addEventListener("pointerup", (event) => {
        const done = stroke;
        stroke = undefined;
        over.getContext("2d")!.clearRect(0, 0, over.width, over.height);
        if (done && cut) {
            cut = { ...cut, strokes: [...(cut.strokes ?? []), done] };
            void again();
            return;
        }
        const at = pressedAt;
        pressedAt = undefined;
        if (at && Math.hypot(placeOf(event).x - at.x, placeOf(event).y - at.y) < brushSize()) void pick(at);
    });

    /**
     * A press on the picture. With a cut-out the model found, it keeps the thing pressed: the press model outlines it, and only what the
     * cut-out found inside it stays. Where the model found nothing, what is pressed is the cut-out itself, and each press after adds to
     * it, so a thing the press model takes in parts (a cat's face, its chest, its back) is kept whole by pressing each.
     */
    async function pick(place: { x: number; y: number }) {
        if (!picture || (!cut && !nothing) || !(await asking.picking(view))) return;
        busy++;
        fill();
        try {
            const press: Press = { x: Math.round(place.x), y: Math.round(place.y), add: true };
            const key = `cut ${picture.width} ${picture.height} ${file?.size}`;
            if (!cut || cut.presses) {
                const presses = [...(cut?.presses ?? []), press];
                const answer = await finderNow().select(PART_TIERS[0]!.id, key, await createImageBitmap(picture), presses);
                if (blank(answer.found)) say(CUT_WORDS.nothing);
                else {
                    const first = !cut;
                    cut = { ...cut, found: answer.found, presses, background: laid, ...(laid === "color" ? { color } : {}) };
                    nothing = false;
                    // one of many is no longer one that could not be cut out
                    const entry = entries[at];
                    if (entries.length > 1 && entry) entry.failed = undefined;
                    await again(first);
                    say("Kept the thing pressed.");
                }
            } else {
                const answer = await finderNow().select(PART_TIERS[0]!.id, key, await createImageBitmap(picture), [press]);
                cut = { ...cut, pick: answer.found };
                await again();
                say("Kept the thing pressed.");
            }
        } catch (error) {
            say(`Not chosen: ${error instanceof Error ? error.message : String(error)}`);
        }
        busy--;
        fill();
    }

    fill();
    return {
        element: root,
        take,
        takeAll,
        /** The cut-out shown, for tests. */
        result: () => result,
        cut: () => cut,
        /** How many pictures there are, which is shown, and how many are cut out, for tests. */
        many: () => ({ count: entries.length, at, cut: entries.filter((entry) => entry.cut).length }),
        showEntry,
        saveAll,
        destroy() {
            rest++;
            saving?.stop.abort();
            document.removeEventListener("paste", pasted);
            document.removeEventListener("keydown", keys);
            document.removeEventListener("keyup", keys);
            finder?.destroy();
            root.remove();
            anchor.remove();
            entryMenu.close(false);
            entryAnchor.remove();
        },
    };
}
