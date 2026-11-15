// The cut-out as a page of its own (/cutout/): drop, paste or choose a picture and its background comes
// off, at its full size, in this browser. An empty page says one line and offers Choose a picture (and,
// on a phone, Paste). A picture arriving is shown at once with a quiet line saying it is being cut out;
// the first time, the quality is asked for and fetched only when she says so. Then the cut-out shows on
// a checkerboard, and under it, never over it: Copy (the main button), Save, what it is laid on (Clear,
// Color with the site's colors, Blur), the brush (Keep, Remove), and the quality. A press on the
// picture keeps the thing pressed when there are several; the backslash or the Original button held
// shows the picture as it came. A right-click opens a menu of the same (Shift leaves the browser's).
// Nothing leaves the browser: the only requests are for the page, ONNX Runtime and the model's files.
//
//   createCutoutPage(host, { colors: [{ name: "White", value: "#ffffff" }, ...] });

import { control, flowMenu, icon, make, RULE, type MenuItem } from "../../core/ui";
import { crc32 } from "../../core/zip";
import { decodeHeic, heicIn } from "../codec-run";
import { profileOf } from "../metadata";
import { deflated, pixelsToSrgb, withProfile } from "../profile";
import { createFinder, type Finder } from "../parts/finder";
import { PART_TIERS } from "../parts/models";
import type { Stroke } from "../masks";
import { createAsking } from "./asking";
import { cutOut, CUT_SIDE, valuesOf, type Cut, type Laid } from "./cut";

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
    bar.append(group("out", copyButton, saveButton), group("brush", keepButton, removeButton), group("laid", ...layButtons), group("more", quality, original, another), swatches);

    function fill() {
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
    async function take(given: Blob & { name?: string }) {
        const head = new Uint8Array(await given.slice(0, 16).arrayBuffer());
        let bitmap: ImageBitmap;
        try {
            bitmap = heicIn(head) ? await createImageBitmap(await decodeHeic(given)) : await createImageBitmap(given, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        } catch {
            say("That is not a picture this browser can read.");
            return;
        }
        picture?.close();
        file = given;
        picture = bitmap;
        cut = undefined;
        result = undefined;
        brush = undefined;
        const colored = await profileOf(new Uint8Array(await given.arrayBuffer()));
        space = colored.space.space;
        profile = colored.icc;
        show();
        say("");
        await cutNow();
    }

    /** Runs the model on the picture and makes the cut-out, asking for the model first if it is not kept. */
    async function cutNow(from?: HTMLElement) {
        if (!picture) return;
        if (!(await asking.ready(from ?? (choose.isConnected ? choose : undefined)))) {
            say(`${CUT_WORDS.notCut}. Choose a quality to cut it out.`);
            return fill();
        }
        busy++;
        // a slow quality says how long it usually takes, so the wait is known
        const wait = asking.tier().wait;
        working.textContent = wait ? `${CUT_WORDS.working}, usually ${wait}` : CUT_WORDS.working;
        fill();
        const started = performance.now();
        try {
            const answer = await finderNow().matte(asking.tier().id, await createImageBitmap(picture), undefined, CUT_SIDE);
            // a mask all kept or all gone is no answer (a card that let the model go can give one): said, and nothing made
            const values = valuesOf(answer.found);
            const share = values ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
            if (share > 0.985 || share < 0.002) throw new Error("the model found nothing to cut out; try again, or another quality");
            cut = { found: answer.found, background: laid, ...(laid === "color" ? { color } : {}) };
            await again();
            say(`Cut out in ${((performance.now() - started) / 1000).toFixed(1)} s, ${picture.width} × ${picture.height}.`);
        } catch (error) {
            say(`${CUT_WORDS.notCut}: ${error instanceof Error ? error.message : String(error)}`);
        }
        busy--;
        fill();
    }

    /** Makes the cut-out again from what it is now (its mask, strokes, subject and background). */
    async function again() {
        if (!picture || !cut) return;
        cut = { ...cut, background: laid, ...(laid === "color" ? { color } : {}) };
        const made = await cutOut(picture, cut);
        if (made) result = made;
        show();
    }

    function setLaid(next: Laid) {
        laid = next;
        void again();
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
        if (asking.tier().id !== was || !cut) await cutNow(button);
    }

    // ---- getting it out ----
    /** The cut-out as a PNG at full size; with its colour profile when it is kept in its own colors, made sRGB for the clipboard. */
    async function pngOf(srgb: boolean): Promise<Blob> {
        if (!result) throw new Error("nothing is cut out yet");
        const convert = srgb && space === "p3";
        const data = convert ? pixelsToSrgb(result.data) : result.data;
        const canvas = new OffscreenCanvas(result.width, result.height);
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), result.width, result.height), 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        if (convert || !profile) return blob;
        return new Blob([withProfile(new Uint8Array(await blob.arrayBuffer()), profile, crc32, result, await deflated(profile)) as BlobPart], { type: "image/png" });
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
        link.download = cutName(file?.name);
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
    const pictureIn = (data: DataTransfer | null) => [...(data?.files ?? [])].find((each) => each.type.startsWith("image/") || /\.(heic|heif)$/i.test(each.name));
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) return;
        const found = pictureIn(event.clipboardData);
        if (!found) return;
        event.preventDefault();
        void take(found);
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
        const found = pictureIn(event.dataTransfer);
        if (!found) return;
        event.preventDefault();
        void take(found);
    });
    choose.addEventListener("click", () => chooser.click());
    pasteButton.addEventListener("click", () => void pasteFromMenu());
    chooser.addEventListener("change", () => {
        const found = chooser.files?.[0];
        chooser.value = "";
        if (found) void take(found);
    });

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
        /** The cut-out shown, for tests. */
        result: () => result,
        cut: () => cut,
        destroy() {
            document.removeEventListener("paste", pasted);
            document.removeEventListener("keydown", keys);
            document.removeEventListener("keyup", keys);
            finder?.destroy();
            root.remove();
            anchor.remove();
        },
    };
}
