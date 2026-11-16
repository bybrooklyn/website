// The cut-out as a page of its own (/cutout/): drop, paste or choose a picture and its background comes
// off, at its full size, in this browser. An empty page says one line and offers Choose a picture (and,
// on a phone, Paste). A picture arriving is shown at once with a quiet line saying it is being cut out;
// the first time, the quality is asked for and fetched only when she says so. Then the cut-out shows on
// a checkerboard, and under it, never over it: Copy (the main button), Save, what it is laid on (Clear,
// Color with the site's colors, Blur), the brush (Keep, Remove), and the quality. A press on the
// picture keeps the thing pressed when there are several; the backslash or the Original button held
// shows the picture as it came. A right-click opens a menu of the same (Shift leaves the browser's).
// Many pictures at once sit in a strip of small pictures under the one shown (batch-strip.ts), each cut out
// in turn behind it, and are saved together as one zip or into a folder under their own names, by the
// same code as imgQuire's Export all (batch-out.ts); one picture works as it always has.
// Nothing leaves the browser: the only requests are for the page, ONNX Runtime and the model's files.
//
//   createCutoutPage(host, { colors: [{ name: "White", value: "#ffffff" }, ...] });

import { control, flowMenu, icon, make, ruled, RULE, still, type MenuItem } from "../../core/ui";
import { crc32 } from "../../core/zip";
import type { FolderHandle } from "../../core/store-folder";
import { decodeHeic, heicIn } from "../codec-run";
import { profileOf } from "../metadata";
import { deflated, pixelsToSrgb, withProfile } from "../profile";
import { createFinder, type Finder } from "../parts/finder";
import { PART_TIERS } from "../parts/models";
import type { Stroke } from "../masks";
import { namesFor, picturesSaid, whichSaid } from "../batch";
import { atOnce, blobSink, fileSink, folderOut, runEach, zipOut, type Destination } from "../batch-out";
import { batchStrip, type StripItem } from "../batch-strip";
import { pixelsOf, smallLook, smallOf } from "../thumbs";
import { createAsking } from "./asking";
import { cutOut, CUT_SIDE, findCut, FOUND_NOTHING, type Cut, type Laid } from "./cut";

/** The words of the page that a visitor reads first. */
export const CUT_WORDS = {
    empty: "Drop, paste or choose a picture, and its background comes off. It never leaves your browser.",
    choose: "Choose a picture",
    paste: "Paste",
    working: "Cutting out",
    notCut: "Not cut out",
};

/** A color offered to lay the cut-out on, named in its tooltip. */
export interface Swatch {
    name: string;
    value: string;
}

/** What the page is given: the colors offered (the site's), and a finder for tests. */
export interface PageOptions {
    colors?: Swatch[];
    finder?: () => Finder;
}

/** The words of the page when many pictures are cut out together. */
export const ALL_WORDS = {
    zip: (count: number) => `Save all ${count} as a zip`,
    folder: "Save all into a folder",
    stop: "Stop",
};

/** A file's name made the cut-out's: its stem and "cut out", as a PNG. */
export function cutName(name: string | undefined): string {
    const stem = (name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "picture";
    return `${stem}-cut-out.png`;
}

/** The lines of the right-click menu: Paste and Choose a picture with nothing shown; Copy, Save and Paste, then Keep and Remove, with a cut-out. */
export function cutMenuLines(state: { cut: boolean; brush?: "keep" | "remove" }, run: { copy(): void; save(): void; paste(): void; choose(): void; brush(which: "keep" | "remove"): void }): MenuItem[] {
    const paste: MenuItem = { label: "Paste", icon: "paste", hint: "Ctrl+V", key: "paste", run: run.paste };
    if (!state.cut) return [paste, { label: "Choose a picture", icon: "image", key: "choose", run: run.choose }];
    return [
        { label: "Copy", icon: "copy", hint: "Ctrl+C", key: "copy", run: run.copy },
        { label: "Save", icon: "download", hint: "Ctrl+S", key: "save", run: run.save },
        paste,
        RULE,
        { label: "Keep", icon: "pen", key: "keep", pressed: state.brush === "keep", run: () => run.brush("keep") },
        { label: "Remove", icon: "clear", key: "remove", pressed: state.brush === "remove", run: () => run.brush("remove") },
    ];
}

/** Builds the page on its host. */
export function createCutoutPage(host: HTMLElement, options: PageOptions = {}) {
    let finder: Finder | undefined;
    const finderNow = () => (finder ??= options.finder?.() ?? createFinder());
    const root = make("div", "quire-cut");
    const room = make("div", "quire-cut-room");
    const empty = make("div", "quire-cut-empty");
    const chooser = make("input");
    chooser.type = "file";
    chooser.accept = "image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif,.heic,.heif";
    chooser.multiple = true;
    chooser.hidden = true;
    const choose = make("button", "quire-dialog-action", CUT_WORDS.choose);
    choose.type = "button";
    const pasteButton = make("button", "quire-dialog-dismiss quire-cut-paste", CUT_WORDS.paste);
    pasteButton.type = "button";
    const emptyActions = make("div", "quire-cut-empty-actions");
    emptyActions.append(choose, pasteButton);
    empty.append(make("p", "quire-cut-line", CUT_WORDS.empty), emptyActions, chooser);
    const view = make("div", "quire-cut-view");
    let canvas = make("canvas", "quire-cut-canvas");
    const over = make("canvas", "quire-cut-over");
    view.append(canvas, over);
    const working = make("p", "quire-cut-working", CUT_WORDS.working);
    working.setAttribute("role", "status");
    room.append(empty, view, working);
    const bar = make("div", "quire-cut-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Cut-out");
    const said = make("p", "quire-cut-said");
    said.setAttribute("aria-live", "polite");
    root.append(room, bar, said);
    host.append(root);

    const asking = createAsking({ finder: finderNow, returnTo: () => (picture ? copyButton : choose) });
    let file: (Blob & { name?: string }) | undefined;
    let picture: ImageBitmap | undefined;
    let space: "srgb" | "p3" = "srgb";
    let profile: Uint8Array | undefined;
    let cut: Cut | undefined;
    let result: ImageData | undefined;
    let laid: Laid = "clear";
    let color = options.colors?.[0]?.value ?? "#ffffff";
    let brush: "keep" | "remove" | undefined;
    let holding = false;
    let busy = 0;
    const say = (text: string) => (said.textContent = text);

    // ---- the bar under the picture ----
    const copyButton = make("button", "quire-dialog-action quire-cut-copy", "Copy");
    copyButton.type = "button";
    copyButton.addEventListener("click", () => void copy());
    const saveButton = make("button", "quire-dialog-dismiss", "Save");
    saveButton.type = "button";
    saveButton.addEventListener("click", () => void save());
    const lays: [Laid, string, string][] = [
        ["clear", "Clear", "Nothing behind it, saved with transparency"],
        ["color", "Color", "A color behind it"],
        ["blur", "Blur", "The old background behind it, blurred"],
    ];
    const layButtons = lays.map(([key, label, tip]) => {
        const button = control(tip, label, () => setLaid(key), "quire-button quire-cut-word");
        button.dataset.laid = key;
        return button;
    });
    const swatches = make("div", "quire-cut-swatches");
    for (const each of options.colors ?? [{ name: "White", value: "#ffffff" }]) {
        const mark = make("span", "quire-img-swatch");
        mark.style.background = each.value;
        const button = control(each.name, mark, () => ((color = each.value), (laid = "color"), void again(), fill()));
        button.dataset.color = each.value;
        swatches.append(button);
    }
    const keepButton = control("Keep: paint what should stay", "Keep", () => setBrush(brush === "keep" ? undefined : "keep"), "quire-button quire-cut-word");
    const removeButton = control("Remove: paint what should go", "Remove", () => setBrush(brush === "remove" ? undefined : "remove"), "quire-button quire-cut-word");
    const quality = control("Quality", asking.tier().name, (button) => void chooseQuality(button), "quire-button quire-cut-word");
    const original = control("Hold to see the original (\\)", icon("paper"), () => {}, "quire-button quire-cut-hold");
    const another = control("Choose another picture", icon("image"), () => chooser.click());
    // the bar in groups that wrap whole: getting it out, what it is laid on, the brush, and the rest; the colors grow out as a row of their own
    const group = (name: string, ...items: HTMLElement[]) => {
        const made = make("div", `quire-cut-group quire-cut-group-${name}`);
        made.append(...items);
        return made;
    };
    // with many pictures: every cut-out saved together, as one zip or into a folder, with how far it has come and Stop
    const zipAll = make("button", "quire-dialog-dismiss", ALL_WORDS.zip(0));
    zipAll.type = "button";
    zipAll.addEventListener("click", () => void saveAll("zip"));
    const folderAll = make("button", "quire-dialog-dismiss", ALL_WORDS.folder);
    folderAll.type = "button";
    folderAll.addEventListener("click", () => void saveAll("folder"));
    const stopAll = make("button", "quire-dialog-dismiss", ALL_WORDS.stop);
    stopAll.type = "button";
    stopAll.addEventListener("click", () => saving?.stop.abort());
    const all = group("all", zipAll, folderAll, stopAll);
    bar.append(group("out", copyButton, saveButton), group("brush", keepButton, removeButton), group("laid", ...layButtons), group("more", quality, original, another), all, swatches);
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
        bar.inert = !result;
        for (const button of layButtons) button.classList.toggle("pressed", button.dataset.laid === laid);
        swatches.classList.toggle("open", laid === "color");
        for (const button of swatches.querySelectorAll<HTMLElement>("button")) button.classList.toggle("pressed", button.dataset.color === color);
        keepButton.classList.toggle("pressed", brush === "keep");
        removeButton.classList.toggle("pressed", brush === "remove");
        quality.textContent = asking.tier().name;
        working.classList.toggle("shown", busy > 0);
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
            say(`${whichSaid(at, entries.length)} · ${failedBefore === FOUND_NOTHING ? "Nothing was found to cut out, so the picture is left as it was." : `${CUT_WORDS.notCut}: ${failedBefore}`}`);
            return fill();
        }
        busy++;
        // a slow quality says how long it usually takes, so the wait is known
        const wait = asking.tier().wait;
        working.textContent = wait ? `${CUT_WORDS.working}, usually ${wait}` : CUT_WORDS.working;
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
            // a model that found nothing leaves the picture as it was, and says so plainly
            say(said === FOUND_NOTHING ? "Nothing was found to cut out, so the picture is left as it was." : `${CUT_WORDS.notCut}: ${said}`);
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
    async function chooseQuality(button: HTMLElement) {
        const was = asking.tier().id;
        if (!(await asking.choose(button))) return fill();
        fill();
        if (asking.tier().id === was && cut) return;
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
    choose.addEventListener("click", () => chooser.click());
    pasteButton.addEventListener("click", () => void pasteFromMenu());
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
        cut?: Cut;
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
    root.insertBefore(strip.element, bar);
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
            { label: "Add pictures", icon: "plus", key: "add-pictures", run: () => ((addingByChooser = true), chooser.click()) },
            { label: "Paste", icon: "paste", hint: "Ctrl+V", key: "paste-into", run: () => void pasteInto() },
        ];
        const lines = index < 0 ? adding : ruled([{ label: "Save this one", icon: "download", key: "save-one", run: () => void showEntry(index).then(() => save()) }, { label: "Copy this one", icon: "copy", key: "copy-one", run: () => void showEntry(index).then(() => copy()) }], adding, [{ label: "Take out", icon: "trash", key: "take-out", disabled: !!saving, run: () => void takeOut(index) }]);
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
        if (!result || event.button !== 0) return;
        event.preventDefault();
        view.setPointerCapture(event.pointerId);
        const at = placeOf(event);
        if (brush) stroke = { size: brushSize(), soft: 0.5, ...(brush === "remove" ? { erase: true } : {}), points: [Math.round(at.x), Math.round(at.y)] };
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

    /** Keeps the thing pressed: the press-to-select model outlines it, and only what the cut-out found inside it stays. */
    async function pick(at: { x: number; y: number }) {
        if (!picture || !cut || !(await asking.picking(view))) return;
        busy++;
        fill();
        try {
            const answer = await finderNow().select(PART_TIERS[0]!.id, `cut ${picture.width} ${picture.height} ${file?.size}`, await createImageBitmap(picture), [{ x: Math.round(at.x), y: Math.round(at.y), add: true }]);
            cut = { ...cut, pick: answer.found };
            await again();
            say("Kept the thing pressed.");
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
