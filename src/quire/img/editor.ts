// imgQuire's editor: the picture document (steps.ts) on the stage (stage.ts), in the core's frame and
// held by the core's session, so that saving, version history and moving between documents are the
// Quires' own. It gives the frame its bar, its menus as one table, its single-key tools and the
// palette; it makes a new document of any picture pasted, dropped or opened; and it gets the picture
// out: Ctrl+C copies (asking the first time whether as it looks or as the export is set, and then
// remembering), and the export panel saves.

import { createFrame } from "../core/frame";
import type { Context, Editing } from "../core/kind";
import { createSession } from "../core/session";
import { copyDocument, type Store } from "../core/store";
import { packQuire, type Parts } from "../core/quire-file";
import { openDialog } from "../core/dialog";
import { createHistoryPanel, snapshotParts } from "../core/versions";
import { control, fieldForm, icon, make, ruled, type MenuItem } from "../core/ui";
import { copyPicture, encodeAs, exportName, formatOf, FORMATS, readSettings, untouched, weightSaid, type Settings } from "./export";
import { decodeHeic, heicIn } from "./codec-run";
import { COLORS, exportPanel, factsSaid, kindOf, nameFor, resizeBox, SHAPES, toolStrip, WEIGHTS } from "./panels";
import { createStage, type Pen, type Tool } from "./stage";
import { createHistory, edited, fresh, look, move, readSteps, remove, setOnly, writeSteps, type Filter, type Kept, type Picture } from "./steps";

/** The file a picture document keeps its steps in, inside its `.quire`. */
export const MAIN = "steps.json";

/** Choices kept in this browser: how Ctrl+C copies, the export's settings, the pen. */
const KEYS = { copy: "quire-img-copy", export: "quire-img-export", pen: "quire-img-pen" };
const local = () => {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
};
const keep = (key: string, value: string) => {
    try {
        local()?.setItem(key, value);
    } catch {
        // a browser that keeps nothing asks again next time
    }
};

/** The single keys that pick a tool, while the picture has the keyboard. */
const TOOL_KEYS: Record<string, Tool | "export"> = { KeyC: "crop", KeyR: "hide", KeyA: "arrow", KeyT: "text", KeyB: "box", KeyE: "export" };

/** Hands the writer a file. */
function give(blob: Blob, name: string) {
    const link = make("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Mounts imgQuire's editor in the app, on the document it starts with or on nothing. */
export function mountEditor(host: HTMLElement, context: Context) {
    host.classList.add("quire-editor", "quire-img-editor");
    const frame = createFrame(host, { top: context.top, name: context.start?.entry.name ?? "Untitled", onName: context.onName });
    const room = make("div", "quire-img-room");
    const empty = make("div", "quire-img-empty");
    const choose = make("button", "quire-dialog-action", "Choose a picture");
    choose.type = "button";
    const chooser = make("input");
    chooser.type = "file";
    chooser.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/jxl,image/heic,image/heif,.heic,.heif,.jxl";
    chooser.hidden = true;
    empty.append(make("p", "", "Paste or drop a picture"), choose, chooser);
    const facts = make("p", "quire-img-facts");
    facts.setAttribute("aria-live", "polite");

    let picture: Picture | undefined;
    let original: Blob | undefined;
    let where: { store?: Store; id?: string; name: string } = { name: "Untitled" };
    const history = createHistory([]);
    let pen: Pen = (() => {
        try {
            const kept = JSON.parse(local()?.getItem(KEYS.pen) ?? "null") as Partial<Pen> | null;
            return { color: COLORS.some((each) => each.value === kept?.color) ? kept!.color! : COLORS[0]!.value, weight: WEIGHTS.some((each) => each.value === kept?.weight) ? kept!.weight! : WEIGHTS[1]!.value };
        } catch {
            return { color: COLORS[0]!.value, weight: WEIGHTS[1]!.value };
        }
    })();
    let settings: Settings = readSettings(local()?.getItem(KEYS.export));
    let shape = "Free";

    const stage = createStage({
        picture: () => picture,
        change: (steps) => commit(steps),
        pen: () => pen,
        moved: () => refresh(),
        say: (short, full) => frame.status.say(short, full, "warn"),
    });
    room.append(stage.element, empty, facts);
    host.append(room);

    // ---- the document as a store keeps it, through the core's session ----
    let loading = 0;
    const session = createSession(
        {
            writing: () => ({ text: picture ? writeSteps(picture) : "", quire: {} }),
            load: (found) => void open(found.text),
            replace: (found) => {
                const read = readSteps(found.text);
                if (read && picture) commit(read.steps);
            },
            empty: () => void open(undefined),
            placed: (now) => (where = now),
            named: (name) => frame.name.set(name),
            download: () => void downloadQuire(),
            from: () => frame.status.element,
            focus: () => stage.element.focus({ preventScroll: true }),
        },
        { name: context.start?.entry.name ?? "Untitled", store: context.start?.store, id: context.start?.entry.id, mark: context.start?.found.mark, versions: context.versions, say: frame.status.say, onOpen: context.onOpen },
    );

    /** Puts a document's steps on the stage, with its original fetched from where it is kept. */
    async function open(text: string | undefined) {
        const token = ++loading;
        estimate.cancel();
        const read = text === undefined ? undefined : readSteps(text);
        picture = read && { original: read.original, steps: read.steps };
        history.reset(read?.steps ?? []);
        original = undefined;
        // the new picture's size at once, its weight when it is worked out; never the last document's
        facts.textContent = picture ? factsSaid(look(picture), picture.original.bytes, kindOf(picture.original)) : "";
        stage.clear();
        stage.setTool("crop");
        refresh();
        if (text !== undefined && !read) return frame.status.say("Not opened", "This picture's steps could not be read", "warn");
        if (!read) return;
        const found = await originalOf(read.original.name).catch(() => undefined);
        if (token !== loading) return;
        if (!found) return frame.status.say("No picture", "This document's original picture is missing from where it is kept", "warn");
        original = found;
        await stage.show(await displayable(found).catch(() => found));
        if (token !== loading) return;
        if (read.dropped) frame.status.say("Steps left out", `${read.dropped} of its steps could not be read and were left out`, "warn");
        refresh();
        estimate.soon();
    }

    /** The original's bytes, from the store that keeps the document. */
    async function originalOf(address: string): Promise<Blob | undefined> {
        const { store, id } = where;
        if (!store || !id) return undefined;
        const name = address.replace(/^(\.\/)?pictures\//, "");
        const kept = store.pictures ? (await store.pictures(id)).get(name) : undefined;
        if (kept) return kept;
        const url = await store.show?.(id, address);
        return url ? (await fetch(url)).blob() : undefined;
    }

    /** A change to the steps: one undo, saved, drawn again. */
    function commit(steps: Kept[]) {
        if (!picture) return;
        history.set(steps);
        picture = { ...picture, steps };
        changed();
    }
    function changed() {
        if (!picture) return;
        picture = { ...picture, steps: history.now() };
        stage.changed();
        session.changed();
        refresh();
        estimate.soon();
    }
    const undo = () => history.undo() && changed();
    const redo = () => history.redo() && changed();

    /** A picture the browser can draw: a HEIC photograph (which browsers do not read) read by the HEIC module, made a PNG kept only in memory; any other as it is. The original stays as it came. */
    async function displayable(file: Blob): Promise<Blob> {
        if (!heicIn(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) return file;
        const pixels = await decodeHeic(file);
        const canvas = new OffscreenCanvas(pixels.width, pixels.height);
        canvas.getContext("2d")!.putImageData(pixels, 0, 0);
        return canvas.convertToBlob({ type: "image/png" });
    }

    // ---- a picture arriving: pasted, dropped or chosen, it becomes a document kept in this browser ----
    async function take(file: Blob & { name?: string }): Promise<boolean> {
        const home = context.richHome;
        if (!home) return false;
        let size: { width: number; height: number };
        const heic = heicIn(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
        try {
            const bitmap = await createImageBitmap(await displayable(file));
            size = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
        } catch {
            frame.status.say("Not opened", "That is not a picture this browser can read", "warn");
            return false;
        }
        const name = nameFor(file.name, new Date());
        const type = heic ? "image/heic" : file.type || "image/png";
        const ending = heic ? ".heic" : FORMATS.find((format) => format.type === type)?.ending ?? /\.[a-z0-9]{1,5}$/i.exec(file.name ?? "")?.[0] ?? ".png";
        const stem = (file.name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "screenshot";
        const wanted = `${stem}${ending}`;
        const made: Picture = fresh({ name: `pictures/${wanted}`, width: size.width, height: size.height, type, bytes: file.size });
        try {
            const created = await home.create(name, writeSteps(made), {}, MAIN);
            const address = await home.savePicture(created.id, file, wanted);
            if (address !== made.original.name) await home.save(created.id, writeSteps({ ...made, original: { ...made.original, name: address } }), created.mark);
            const entry = (await home.list()).find((each) => each.id === created.id) ?? { id: created.id, name, main: MAIN };
            const opened = await session.open(home, entry);
            if (opened) stage.element.focus({ preventScroll: true });
            return opened;
        } catch (error) {
            frame.status.say("Not kept", `The picture could not be kept: ${error instanceof Error ? error.message : String(error)}`, "warn");
            return false;
        }
    }
    const pictureIn = (data: DataTransfer | null) => [...(data?.files ?? [])].find((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name));
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || host.classList.contains("shelved") || (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]"))) return;
        const file = pictureIn(event.clipboardData);
        if (!file) return;
        event.preventDefault();
        void take(file);
    };
    document.addEventListener("paste", pasted);
    room.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
        event.preventDefault();
        room.classList.add("dropping");
    });
    room.addEventListener("dragleave", () => room.classList.remove("dropping"));
    room.addEventListener("drop", (event) => {
        room.classList.remove("dropping");
        const file = pictureIn(event.dataTransfer);
        if (!file) return;
        event.preventDefault();
        void take(file);
    });
    choose.addEventListener("click", () => chooser.click());
    chooser.addEventListener("change", () => {
        const file = chooser.files?.[0];
        chooser.value = "";
        if (file) void take(file);
    });

    // ---- getting it out ----
    const exportCache: { key?: string; done?: Promise<{ blob: Blob; quality: number; over: boolean; pixels?: ImageData }> } = {};
    /** The picture as it looks, at full size. */
    const flattened = async () => {
        const loaded = stage.loaded();
        if (!loaded || !picture) throw new Error("the picture is not shown yet");
        return loaded.flatten(look(picture));
    };
    /** The export as set, worked out once for each set of steps and settings. */
    function exported() {
        const key = `${picture ? writeSteps(picture) : ""}\n${JSON.stringify(settings)}`;
        if (exportCache.key === key && exportCache.done) return exportCache.done;
        exportCache.key = key;
        const now = picture!;
        const format = formatOf(settings.format);
        exportCache.done = (async () => {
            // a picture with no steps given in its own format is its original, with where and when it was taken cut out
            if (!edited(now) && !settings.target && format.type === now.original.type && original) {
                try {
                    return { blob: new Blob([untouched(new Uint8Array(await original.arrayBuffer())) as BlobPart], { type: format.type }), quality: settings.quality, over: false };
                } catch {
                    // one that cannot be read through is written again, which leaves everything out
                }
            }
            const pixels = await flattened();
            return { ...(await encodeAs(pixels, settings)), pixels };
        })();
        exportCache.done.catch(() => (exportCache.key = undefined));
        return exportCache.done;
    }
    /** The weight under the picture, worked out a moment after the steps stop changing. */
    const estimate = (() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return {
            cancel: () => clearTimeout(timer),
            soon() {
                clearTimeout(timer);
                timer = setTimeout(async () => {
                    if (!picture || !stage.loaded()) return;
                    const now = picture;
                    const done = await exported().catch(() => undefined);
                    if (done && now === picture) {
                        const size = look(now);
                        facts.textContent = factsSaid(size, done.blob.size, formatOf(settings.format).label);
                        if (exporting.isOpen()) void showExport();
                    }
                }, 700);
            },
        };
    })();

    /** Copies the picture, as it looks or as the export is set; the first time, asks which and remembers. */
    async function copy() {
        if (!picture || !stage.loaded()) return;
        if (stage.tool() === "crop") stage.applyCrop();
        const asked = local()?.getItem(KEYS.copy);
        const way = asked === "looks" || asked === "export" ? asked : await askCopy();
        if (!way) return;
        const shown = look(picture);
        // the clipboard is handed a promise of the picture at once, so the browser counts the press that asked for it
        // the browser's own PNG, which is quick; the clipboard keeps it only until the next copy
        const pngOf = (source: ImageData | ImageBitmap) => {
            const canvas = new OffscreenCanvas(source.width, source.height);
            const context = canvas.getContext("2d")!;
            if (source instanceof ImageData) context.putImageData(source, 0, 0);
            else context.drawImage(source, 0, 0);
            return canvas.convertToBlob({ type: "image/png" });
        };
        const png = (async () => {
            if (way === "looks") return pngOf(await flattened());
            const done = await exported();
            if (done.blob.type === "image/png") return done.blob;
            // a format this browser cannot show (JPEG XL in some) is copied as it looks
            const bitmap = await createImageBitmap(done.blob).catch(() => undefined);
            return pngOf(bitmap ?? (await flattened()));
        })();
        try {
            await copyPicture(png);
            frame.status.say("Copied", `Copied, ${shown.width} × ${shown.height} px${way === "export" ? `, as the export is set (${formatOf(settings.format).label})` : ""}`);
        } catch (error) {
            frame.status.say("Not copied", `The picture was not copied: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
    }
    /** The first Ctrl+C asks how to copy, in a dialog; the answer is remembered and Edit, Copy as changes it. */
    const askCopy = () =>
        new Promise<"looks" | "export" | undefined>((answer) => {
            let chosen: "looks" | "export" | undefined;
            openDialog(stage.element, {
                title: "Copy the picture",
                body: [make("p", "", "Copy it as it looks, or as the export is set? This is asked once; Edit, Copy as changes it.")],
                others: [{ label: "As the export is set", press: (dialog) => ((chosen = "export"), keep(KEYS.copy, "export"), void dialog.close()) }],
                dismiss: "Cancel",
                action: { label: "As it looks", press: (_, dialog) => ((chosen = "looks"), keep(KEYS.copy, "looks"), void dialog.close()) },
                returnTo: stage.element,
                onClose: () => answer(chosen),
            });
        });
    async function save() {
        if (!picture) return;
        if (stage.tool() === "crop") stage.applyCrop();
        const done = await exported().catch((error) => void frame.status.say("Not saved", `The picture was not made: ${error instanceof Error ? error.message : String(error)}`, "warn"));
        if (!done) return;
        give(done.blob, exportName(where.name, formatOf(settings.format)));
        frame.status.say("Saved", `Saved as ${exportName(where.name, formatOf(settings.format))}, ${weightSaid(done.blob.size)}`);
    }
    async function downloadQuire() {
        if (!picture || !original) return;
        const name = picture.original.name.replace(/^pictures\//, "");
        const bytes = await packQuire({ text: writeSteps(picture), main: MAIN, parts: {}, pictures: new Map([[name, original]]) });
        give(new Blob([bytes as BlobPart], { type: "application/zip" }), exportName(where.name, { ending: ".quire" } as ReturnType<typeof formatOf>));
        session.downloaded();
    }

    // ---- what opens round the picture ----
    const exporting = exportPanel({
        closed: () => (room.classList.remove("beside"), refresh()),
        settings: () => settings,
        set: (next) => ((settings = next), keep(KEYS.export, JSON.stringify(next)), void showExport(), estimate.soon()),
        copy: () => void copy(),
        save: () => void save(),
    });
    async function showExport() {
        exporting.fill();
        if (!picture || !stage.loaded()) return;
        const now = picture;
        const done = await exported().catch(() => undefined);
        if (!done || now !== picture) return;
        const shown = look(now);
        // the same part of both, from the middle, at their own pixels
        const side = Math.min(180, shown.width, shown.height);
        const at = { x: Math.floor((shown.width - side) / 2), y: Math.floor((shown.height - side) / 2), width: side, height: side };
        const pixels = done.pixels ?? (await flattened());
        const part = new ImageData(side, side);
        for (let row = 0; row < side; row++) part.data.set(pixels.data.subarray(((at.y + row) * shown.width + at.x) * 4, ((at.y + row) * shown.width + at.x + side) * 4), row * side * 4);
        exporting.shows({ width: shown.width, height: shown.height, bytes: done.blob.size, label: formatOf(settings.format).label, over: done.over, quality: done.quality, original: part, exported: await createImageBitmap(done.blob).catch(() => undefined), at, originalBytes: now.original.bytes });
    }
    const resizing = resizeBox({
        size: () => (picture ? look(picture) : { width: 1, height: 1 }),
        apply: (width, height) => picture && commit(setOnly(history.now(), { type: "resize", width, ...(height ? { height } : {}), filter: look(picture).filter })),
        back: () => buttons.resize.focus({ preventScroll: true }),
        done: () => stage.element.focus({ preventScroll: true }),
    });
    const strip = toolStrip({
        color: () => pickedMark()?.color ?? pen.color,
        weight: () => pen.weight,
        setColor: (value) => {
            pen = { ...pen, color: value };
            keep(KEYS.pen, JSON.stringify(pen));
            const mark = pickedMark();
            if (mark) commit(history.now().map((step) => (step.id === mark.id ? ({ ...step, color: value } as Kept) : step)));
            refresh();
        },
        setWeight: (value) => {
            pen = { ...pen, weight: value };
            keep(KEYS.pen, JSON.stringify(pen));
            const mark = pickedMark();
            if (mark && picture) {
                const line = Math.max(2, Math.round(Math.max(picture.original.width, picture.original.height) * value));
                commit(history.now().map((step) => (step.id !== mark.id ? step : step.type === "text" ? { ...step, size: line * 6 } : step.type === "arrow" || step.type === "box" ? { ...step, thickness: line } : step)));
            }
            refresh();
        },
        shape: () => shape,
        setShape: (name) => {
            shape = name;
            const chosen = SHAPES.find((each) => each.name === name)?.value;
            stage.setAspect(chosen === "original" && picture ? picture.original.width / picture.original.height : (chosen as number | undefined));
        },
        apply: () => applyCrop(),
    });
    const pickedMark = () => {
        const step = history.now().find((each) => each.id === stage.picked());
        return step && (step.type === "arrow" || step.type === "box" || step.type === "text") ? step : undefined;
    };
    room.append(strip.strip);
    document.body.append(exporting.panel, resizing.box);
    const historyPanel = createHistoryPanel(
        {
            show(text, _older, into) {
                const read = readSteps(snapshotParts(text).markdown);
                const loaded = stage.loaded();
                if (!read || !loaded) return void into.append(make("p", "quire-history-none", "This version cannot be shown."));
                // the version's steps drawn over the original, small enough for the panel
                const shown = look({ original: read.original, steps: read.steps });
                const width = Math.min(360, shown.width);
                const small = look({ original: read.original, steps: [...read.steps, { id: "s0", type: "resize", width, filter: "bilinear" }] });
                const canvas = make("canvas", "quire-img-version");
                into.append(canvas, make("p", "quire-history-when", `${shown.width} × ${shown.height} px · ${read.steps.length} ${read.steps.length === 1 ? "step" : "steps"}`));
                void loaded.flatten(small).then((pixels) => {
                    canvas.width = pixels.width;
                    canvas.height = pixels.height;
                    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
                });
            },
            restore(text) {
                const read = readSteps(snapshotParts(text).markdown);
                if (read) commit(read.steps);
            },
            focus: () => stage.element.focus({ preventScroll: true }),
        },
        session.versions,
        session.historyKey,
        session.keeper as Parameters<typeof createHistoryPanel>[3],
    );

    // ---- the bar ----
    const tool = (label: string, name: string, run: () => void) => control(label, icon(name), run);
    const buttons = {
        undo: tool("Undo (Ctrl+Z)", "undo", undo),
        redo: tool("Redo (Ctrl+Shift+Z)", "redo", redo),
        crop: tool("Crop (C)", "crop", () => pickTool("crop")),
        resize: tool("Resize", "resize", () => (resizing.isOpen() ? resizing.close() : resizing.open(buttons.resize))),
        hide: tool("Hide (R)", "hide", () => pickTool("hide")),
        arrow: tool("Arrow (A)", "arrow", () => pickTool("arrow")),
        box: tool("Box (B)", "box", () => pickTool("box")),
        text: tool("Text (T)", "text", () => pickTool("text")),
        export: tool("Export (E)", "export", () => showExportPanel()),
    };
    const bar = make("div", "quire-bar quire-img-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Picture");
    const strip0 = make("div", "quire-bar-strip");
    const group = (...items: HTMLElement[]) => {
        const made = make("div", "quire-bar-group");
        made.append(...items);
        return made;
    };
    const end = group(buttons.export);
    end.classList.add("quire-bar-end");
    strip0.append(group(buttons.undo, buttons.redo), group(buttons.crop, buttons.resize, buttons.hide), group(buttons.arrow, buttons.box, buttons.text), end);
    bar.append(strip0);
    frame.place("bar").append(bar);

    function pickTool(next: Tool) {
        if (!picture) return;
        if (stage.tool() === "crop" && next !== "crop") stage.applyCrop();
        stage.setTool(stage.tool() === next && next !== "crop" ? "none" : next);
        stage.element.focus({ preventScroll: true });
    }
    function applyCrop() {
        stage.applyCrop();
        stage.setTool("none");
        stage.element.focus({ preventScroll: true });
    }
    function showExportPanel(from: HTMLElement = buttons.export) {
        if (exporting.isOpen()) return exporting.close();
        if (stage.tool() === "crop") stage.applyCrop();
        // the picture makes room for the panel, gliding into what is left, rather than lying under it
        room.classList.add("beside");
        exporting.open(from);
        void showExport();
        exporting.copyButton.focus({ preventScroll: true });
    }

    /** The bar, the strip and the facts follow the document and the tool. */
    function refresh() {
        const has = !!picture;
        room.classList.toggle("blank", !has);
        empty.inert = has;
        for (const [name, button] of Object.entries(buttons)) {
            button.disabled = !has;
            button.classList.toggle("pressed", stage.tool() === name || (name === "export" && exporting.isOpen()));
        }
        buttons.undo.disabled = !history.canUndo();
        buttons.redo.disabled = !history.canRedo();
        const kind = !has ? "none" : stage.tool() === "crop" ? "crop" : stage.tool() === "arrow" || stage.tool() === "box" || stage.tool() === "text" || pickedMark() ? "mark" : "none";
        strip.fill(kind);
        if (picture && !facts.textContent) facts.textContent = factsSaid(look(picture), picture.original.bytes, kindOf(picture.original));
        if (!picture) facts.textContent = "";
    }

    // ---- the menus, as one table, and the keys ----
    const tick = (on: boolean, name: string) => (on ? "tick" : name);
    const copyWay = () => local()?.getItem(KEYS.copy);
    const filterOf = (): Filter => (picture ? look(picture).filter : "lanczos");
    frame.menus(() => [
        {
            label: "File",
            items: () =>
                ruled(
                    context.fileItems(),
                    [
                        { label: "Make a copy", icon: "copy", disabled: !where.store?.can.create || !where.id, run: () => void makeCopy() },
                        {
                            label: "Download",
                            icon: "download",
                            items: () => [
                                { label: "Picture", icon: "image", hint: formatOf(settings.format).ending, disabled: !picture, run: () => void save() },
                                { label: "imgQuire document", icon: "file", hint: ".quire", disabled: !picture, run: () => void downloadQuire() },
                            ],
                            run: () => {},
                        },
                        { label: "Export", icon: "export", hint: "E", key: "export", disabled: !picture, run: () => showExportPanel() },
                    ],
                    [
                        { label: "Rename", icon: "rename", form: () => fieldForm({ value: where.name, label: "Name", button: "Rename" }, { set: (value) => void session.rename(value) }), run: () => {} },
                        { label: "Version history", icon: "history", disabled: !picture, run: () => void historyPanel.open() },
                    ],
                ),
        },
        {
            label: "Edit",
            items: () =>
                ruled(
                    [
                        { label: "Undo", icon: "undo", hint: "Ctrl+Z", key: "undo", disabled: !history.canUndo(), run: undo },
                        { label: "Redo", icon: "redo", hint: "Ctrl+Shift+Z", key: "redo", disabled: !history.canRedo(), run: redo },
                    ],
                    [
                        { label: "Copy", icon: "copy", hint: "Ctrl+C", key: "copy", disabled: !picture, run: () => void copy() },
                        {
                            label: "Copy as",
                            icon: "copy",
                            items: () => [
                                { label: "As it looks", icon: tick(copyWay() === "looks", "image"), pressed: copyWay() === "looks", run: () => keep(KEYS.copy, "looks") },
                                { label: "As the export is set", icon: tick(copyWay() === "export", "export"), pressed: copyWay() === "export", run: () => keep(KEYS.copy, "export") },
                            ],
                            run: () => {},
                        },
                        { label: "Paste", icon: "paste", hint: "Ctrl+V", key: "paste", run: () => void pasteFromMenu() },
                    ],
                    [
                        { label: "Remove", icon: "trash", hint: "Delete", key: "remove", disabled: !stage.picked(), run: () => removePicked() },
                        { label: "Bring forward", icon: "front", key: "forward", disabled: !stage.picked() || history.now().at(-1)?.id === stage.picked(), run: () => restack(1) },
                        { label: "Send back", icon: "behind", key: "back", disabled: !stage.picked() || firstMarked() === stage.picked(), run: () => restack(-1) },
                    ],
                ),
        },
        {
            label: "View",
            items: () =>
                ruled(
                    [
                        {
                            label: "Zoom",
                            icon: "zoom",
                            items: () => [
                                { label: "Zoom in", icon: "plus", hint: "Ctrl+=", key: "zoom-in", run: () => stage.zoom(1.25) },
                                { label: "Zoom out", icon: "minus", hint: "Ctrl+-", key: "zoom-out", run: () => stage.zoom(0.8) },
                                { label: "Fit", icon: "fit", hint: "Ctrl+0", key: "fit", run: () => stage.fit() },
                                { label: "100%", icon: "square", hint: "Ctrl+1", key: "one-to-one", run: () => stage.oneToOne() },
                            ],
                            run: () => {},
                        },
                    ],
                    [{ label: "Full screen", icon: "full", hint: "Ctrl+Shift+F", key: "full-screen", run: () => frame.fullScreen(!frame.isFull()) }],
                ),
        },
        {
            label: "Image",
            items: () =>
                ruled(
                    [
                        { label: "Crop", icon: tick(stage.tool() === "crop", "crop"), hint: "C", key: "crop", pressed: stage.tool() === "crop", disabled: !picture, run: () => pickTool("crop") },
                        { label: "Crop shape", icon: "free", items: () => SHAPES.map((each) => ({ label: each.name, icon: tick(shape === each.name, each.icon), pressed: shape === each.name, run: () => (pickTool("crop"), strip.fill("crop"), (shape = each.name), stage.setAspect(each.value === "original" && picture ? picture.original.width / picture.original.height : (each.value as number | undefined))) })), run: () => {} },
                        { label: "Remove the crop", icon: "trash", disabled: !history.now().some((step) => step.type === "crop"), run: () => commit(history.now().filter((step) => step.type !== "crop")) },
                    ],
                    [
                        { label: "Resize", icon: "resize", key: "resize", disabled: !picture, run: () => resizing.open(buttons.resize) },
                        {
                            label: "Resize filter",
                            icon: "settings",
                            items: () =>
                                (["lanczos", "bilinear", "nearest"] as Filter[]).map((filter) => ({
                                    label: filter === "lanczos" ? "Lanczos" : filter === "bilinear" ? "Bilinear" : "Nearest",
                                    icon: tick(filterOf() === filter, "resize"),
                                    pressed: filterOf() === filter,
                                    disabled: !history.now().some((step) => step.type === "resize"),
                                    run: () => commit(history.now().map((step) => (step.type === "resize" ? { ...step, filter } : step))),
                                })),
                            run: () => {},
                        },
                        { label: "Remove the resize", icon: "trash", disabled: !history.now().some((step) => step.type === "resize"), run: () => commit(history.now().filter((step) => step.type !== "resize")) },
                    ],
                ),
        },
        {
            label: "Tools",
            items: () =>
                ruled(
                    (
                        [
                            ["Crop", "crop", "C"],
                            ["Hide", "hide", "R"],
                            ["Arrow", "arrow", "A"],
                            ["Box", "box", "B"],
                            ["Text", "text", "T"],
                        ] as const
                    ).map(([label, name, key]): MenuItem => ({ label, icon: tick(stage.tool() === name, name), hint: key, key: name, pressed: stage.tool() === name, disabled: !picture, run: () => pickTool(name) })),
                    [
                        { label: "Mark color", icon: "color", items: () => COLORS.map((each) => ({ label: each.name, icon: tick(pen.color === each.value, "color"), pressed: pen.color === each.value, run: () => strip && ((pen = { ...pen, color: each.value }), keep(KEYS.pen, JSON.stringify(pen)), refresh()) })), run: () => {} },
                        { label: "Thickness", icon: "line", items: () => WEIGHTS.map((each) => ({ label: each.name, icon: tick(pen.weight === each.value, "line"), pressed: pen.weight === each.value, run: () => ((pen = { ...pen, weight: each.value }), keep(KEYS.pen, JSON.stringify(pen)), refresh()) })), run: () => {} },
                    ],
                    [{ label: "Export", icon: "export", hint: "E", key: "export-tool", disabled: !picture, run: () => showExportPanel() }],
                ),
        },
        {
            label: "Help",
            items: () => [
                { label: "Keyboard shortcuts", icon: "keyboard", hint: "Ctrl+/", key: "shortcuts", run: () => showKeys() },
                // the copyright and license texts of the encoders built into the page, beside them
                { label: "Open-source notices", icon: "file", key: "notices", run: () => void window.open("/quire/codecs/NOTICES.txt", "_blank", "noopener") },
            ],
        },
    ]);

    /** Edit, Paste: the browser's clipboard if it lets the page read it, else the keys to press. */
    async function pasteFromMenu() {
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => each.startsWith("image/"));
                if (type) return void (await take(new File([await item.getType(type)], "image.png", { type })));
            }
            frame.status.say("Nothing to paste", "There is no picture on the clipboard");
        } catch {
            frame.status.say("Press Ctrl+V", "The browser lets a page paste only from the keys: press Ctrl+V");
        }
    }
    /** The first step drawn over the picture (a cover or a mark), which nothing picked can go behind. */
    const firstMarked = () => history.now().find((step) => step.type !== "crop" && step.type !== "resize")?.id;
    /** Moves what is picked one place forward (over the next thing drawn) or back (under the one before), skipping the crop and the resize, which are drawn under everything. */
    function restack(by: 1 | -1) {
        const id = stage.picked();
        const steps = history.now();
        const at = steps.findIndex((step) => step.id === id);
        if (!id || at < 0) return;
        let to = at + by;
        while (steps[to] && (steps[to]!.type === "crop" || steps[to]!.type === "resize")) to += by;
        if (to < 0 || to >= steps.length) return;
        commit(move(steps, id, to));
    }
    function removePicked() {
        const id = stage.picked();
        if (id) commit(remove(history.now(), id));
    }
    async function makeCopy() {
        const { store, id, name } = where;
        if (!store || !id) return;
        const made = await copyDocument(store, id, `${name} copy`).catch((error) => void frame.status.say("Not copied", `No copy was made: ${error instanceof Error ? error.message : String(error)}`, "warn"));
        if (!made) return;
        const entry = (await store.list()).find((each) => each.id === made.id);
        if (entry) await session.open(store, entry);
    }
    function showKeys() {
        const rows: [string, string][] = [
            ["C", "Crop"],
            ["R", "Hide"],
            ["A", "Arrow"],
            ["B", "Box"],
            ["T", "Text"],
            ["E", "Export"],
            ["Enter", "Apply the crop"],
            ["Escape", "Leave the tool"],
            ["Arrows", "Nudge the frame or what is picked (Shift: 10 pixels)"],
            ["Delete", "Remove what is picked"],
            ["Ctrl+C", "Copy"],
            ["Ctrl+V", "Paste a picture"],
            ["Ctrl+Z", "Undo"],
            ["Ctrl+Shift+Z", "Redo"],
            ["Ctrl+0", "Fit"],
            ["Ctrl+1", "100%"],
            ["Space and drag", "Move the picture"],
        ];
        const list = make("dl", "quire-img-keys");
        for (const [key, said] of rows) list.append(make("dt", "", key), make("dd", "", said));
        openDialog(stage.element, { title: "Keyboard shortcuts", body: [list], dismiss: "Close", returnTo: stage.element });
    }

    frame.keys((event) => {
        const control = event.ctrlKey || event.metaKey;
        const onPicture = event.target === stage.element;
        if (control && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey) return undo;
            if ((key === "z" && event.shiftKey) || key === "y") return redo;
            if (event.shiftKey && event.code === "KeyF") return () => frame.fullScreen(!frame.isFull());
            if (event.key === "/") return showKeys;
            if (!onPicture) return undefined;
            if (key === "c" && !event.shiftKey) return () => void copy();
            if (key === "0") return () => stage.fit();
            if (key === "1") return () => stage.oneToOne();
            if (key === "=" || key === "+") return () => stage.zoom(1.25);
            if (key === "-") return () => stage.zoom(0.8);
            return undefined;
        }
        // single keys only while the picture, not a field, has the keyboard
        if (!onPicture || event.altKey || control) return undefined;
        const picked = TOOL_KEYS[event.code];
        if (picked && !event.shiftKey) return () => (picked === "export" ? showExportPanel() : pickTool(picked));
        if (event.key === "Enter" && stage.tool() === "crop") return applyCrop;
        if (event.key === "Escape") {
            if (stage.picked()) return () => stage.pick(undefined);
            if (stage.tool() !== "none") return () => (stage.tool() === "crop" ? stage.setTool("none") : stage.setTool("none"));
            return undefined;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && stage.picked()) return removePicked;
        return undefined;
    });
    frame.palette({ writing: () => stage.element, back: () => stage.element.focus({ preventScroll: true }) });
    frame.onFull(() => stage.element.focus({ preventScroll: true }));

    if (context.start) void open(context.start.found.text);
    else refresh();

    return {
        paper: room,
        open: session.open,
        // a new picture document starts from a picture: with none given, the editor waits for one to be pasted, dropped or chosen
        async create(store: Store, name: string, text?: string, quire?: Parts, main?: string) {
            if (main === MAIN && text) return session.create(store, name, text, quire, main);
            await session.leave();
            return true;
        },
        ready: session.ready,
        leave: session.leave,
        flush: session.flush,
        rename: session.rename,
        current: session.current,
        status: session.status,
        nameElement: () => frame.name,
        say: (short: string, full: string) => frame.status.say(short, full, "warn"),
        focus: () => (picture ? stage.element : choose).focus({ preventScroll: true }),
        take,
        // for a page or a test that reaches further in than the app does
        stage,
        steps: () => history.now(),
        changeStep: (id: string, to: Partial<Kept>) => commit(history.now().map((step) => (step.id === id ? ({ ...step, ...to } as Kept) : step))),
        downloadQuire,
        destroy() {
            estimate.cancel();
            document.removeEventListener("paste", pasted);
            session.destroy();
            frame.destroy();
            stage.destroy();
            exporting.panel.remove();
            resizing.box.remove();
            historyPanel.close();
            historyPanel.element.remove();
            host.classList.remove("quire-img-editor");
            host.replaceChildren();
        },
    };
}
