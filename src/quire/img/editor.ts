// imgQuire's editor: the picture document (steps.ts) on the stage (stage.ts), in the core's frame and
// held by the core's session, so that saving, version history and moving between documents are the
// Quires' own. It gives the frame its bar, its menus as one table, its single-key tools and the
// palette; it makes a new document of any picture pasted, dropped or opened; and it gets the picture
// out: Ctrl+C copies (asking the first time whether as it looks or as the export is set, and then
// remembering), and the export panel saves. It reads the picture's text when asked (reading.ts): W,
// the bar's Read text or Tools, Read text; with words selected on the picture, Ctrl+C copies them as
// text instead of the picture.

import { createFrame } from "../core/frame";
import type { Context, Editing } from "../core/kind";
import { createSession } from "../core/session";
import { copyDocument, type Store } from "../core/store";
import { packQuire, type Parts } from "../core/quire-file";
import { openDialog } from "../core/dialog";
import { createHistoryPanel, snapshotParts } from "../core/versions";
import { control, fieldForm, flowMenu, icon, make, ruled, type MenuItem } from "../core/ui";
import type { Heading } from "../core/menu-row";
import { pressLines } from "./press-menu";
import { copyPicture, encodeAs, exportName, formatOf, FORMATS, readSettings, untouched, weightSaid, type Settings } from "./export";
import { decodeHeic, heicIn } from "./codec-run";
import { COLORS, exportPanel, factsPanel, factsSaid, kindOf, nameFor, resizeBox, SHAPES, toolStrip, WEIGHTS } from "./panels";
import { blocksOut, factsOf, profileOf, spaceOf, type Facts, type Keep } from "./metadata";
import { gradingWith } from "./draw";
import { createStage, setTurn, type Pen, type Tool } from "./stage";
import { createReading } from "./reading";
import { gradePanel } from "./grade-panel";
import { gradeMore } from "./grade-more";
import { gradeLooks, lookStore } from "./looks";
import { brushRadius, gradeParts, partName, type Brush } from "./grade-parts";
import { stackFor, type Found, type Shape } from "./masks";
import { createFinding } from "./finding";
import { createMeasure } from "./measure";
import { autoFix, averageAround, balanceFrom } from "./fix";
import { prepared } from "./draw";
import { gradeOne, hueOf, isNeutral, MOST, neutral, space, trimGrade, type Grade } from "./grade";
import { megabytes, sizeOf, TIERS } from "./read/models";
import { add, createHistory, edited, fresh, gradeOf, look, move, readSteps, remove, setOnly, shapeOf, writeSteps, type Filter, type Kept, type Picture } from "./steps";

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
const TOOL_KEYS: Record<string, Tool | "export" | "facts"> = { KeyC: "crop", KeyR: "hide", KeyA: "arrow", KeyT: "text", KeyB: "box", KeyE: "export", KeyI: "facts", KeyW: "read", KeyG: "grade" };

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
    // what the original says about itself, read once when it is opened; looking never changes it
    let said: Facts = { rows: [], everything: [], found: {} };
    // what of it goes out with an export: none, unless she chooses, for as long as the document is open
    let keeping: Keep = "none";
    // the space it is graded in, from its colour profile, and whether that was known or guessed
    let colors: ReturnType<typeof spaceOf> = { space: "srgb", known: true };
    // the colour profile its numbers are in, checked, which an export carries unless it is made sRGB
    let profile: Uint8Array | undefined;
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
        turned: (degrees) => turnTo(degrees),
        say: (short, full) => frame.status.say(short, full, "warn"),
        space: () => colors.space,
        parts: {
            target: () => (grading.isOpen() ? target : undefined),
            pick: (id) => {
                target = id;
                fillGrade();
                refresh();
                void measureGrade();
            },
            brush: () => (target && brush.on && picture ? { size: brushRadius(brush.size, Math.max(picture.original.width, picture.original.height)), soft: brush.soft / 100, erase: brush.erase } : undefined),
            gradient: () => making === "gradient",
            addGradient: (from, to) => {
                making = undefined;
                asking = undefined;
                addPart({ kind: "gradient", from, to, feather: 0 });
            },
        },
    });
    room.append(stage.element, empty, facts);
    // the part being graded (none for the whole picture), what a drag on the picture makes, and the brush
    let target: string | undefined;
    let making: "gradient" | "find" | undefined;
    let brush: Brush = { size: 30, soft: 60, erase: false, on: false };
    host.append(room);
    // the picture's text, read when asked, kept for the picture while it is open
    const reading = createReading({
        stage,
        key: () => (picture && original && stage.loaded() ? `${where.id ?? ""} ${picture.original.name}` : ""),
        say: (short, full, tone) => frame.status.say(short, full, tone),
        moved: () => refresh(),
    });

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
        said = { rows: [], everything: [], found: {} };
        colors = { space: "srgb", known: true };
        profile = undefined;
        // the new picture's size at once, its weight when it is worked out; never the last document's
        facts.textContent = picture ? factsSaid(look(picture), picture.original.bytes, kindOf(picture.original)) : "";
        reading.clear();
        stage.clear();
        target = undefined;
        making = undefined;
        measuredMasks = undefined;
        stage.setTool(grading.isOpen() ? "grade" : "crop");
        measured = false;
        refresh();
        if (text !== undefined && !read) return frame.status.say("Not opened", "This picture's steps could not be read", "warn");
        if (!read) return;
        const found = await originalOf(read.original.name).catch(() => undefined);
        if (token !== loading) return;
        if (!found) return frame.status.say("No picture", "This document's original picture is missing from where it is kept", "warn");
        original = found;
        const bytes = new Uint8Array(await found.arrayBuffer());
        said = factsOf(bytes);
        const colored = await profileOf(bytes);
        if (token !== loading) return;
        colors = colored.space;
        profile = colored.icc;
        if (showing.isOpen()) showing.fill();
        await stage.show(await displayable(found).catch(() => found));
        if (token !== loading) return;
        if (grading.isOpen()) void measureGrade();
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
        if (target && !history.now().some((step) => step.id === target)) target = undefined;
        if (grading.isOpen()) {
            fillGrade();
            void measureGrade();
        }
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
    /** Whether the export is made sRGB: when she chose it and the picture is in Display P3. */
    const converting = () => settings.srgb === true && colors.space === "p3";
    /** The picture as it looks, at full size; made sRGB from Display P3 when `srgb`. */
    const flattened = async (srgb = false) => {
        const loaded = stage.loaded();
        if (!loaded || !picture) throw new Error("the picture is not shown yet");
        const shown = look(picture);
        return loaded.flatten(shown, undefined, gradingWith(shown, colors.space, loaded.size, srgb && colors.space === "p3"));
    };
    /** The export as set, worked out once for each set of steps and settings. */
    function exported() {
        const key = `${picture ? writeSteps(picture) : ""}\n${JSON.stringify(settings)}\n${keeping}\n${colors.space}`;
        if (exportCache.key === key && exportCache.done) return exportCache.done;
        exportCache.key = key;
        const now = picture!;
        const format = formatOf(settings.format);
        exportCache.done = (async () => {
            // a picture with no steps given in its own format is its original, with where and when it was taken cut out
            // a picture with no steps given in its own format keeping all it says, and nothing changed in it, is its original byte for byte
            const changedNothing = !now.edits || Object.values(now.edits).every((value) => value === undefined);
            if (!edited(now) && !settings.target && !converting() && format.type === now.original.type && original && (keeping === "none" || (keeping === "all" && changedNothing))) {
                try {
                    const bytes = new Uint8Array(await original.arrayBuffer());
                    return { blob: new Blob([(keeping === "all" ? bytes : untouched(bytes)) as BlobPart], { type: format.type }), quality: settings.quality, over: false };
                } catch {
                    // one that cannot be read through is written again, which leaves everything out
                }
            }
            const pixels = await flattened(converting());
            const meta = keeping === "none" || !original ? {} : blocksOut(new Uint8Array(await original.arrayBuffer()), keeping, now.edits ?? {});
            // the colour profile goes out with the numbers it describes, unless they were made sRGB
            const icc = converting() ? undefined : profile;
            return { ...(await encodeAs(pixels, settings, { ...meta, ...(icc ? { icc } : {}) })), pixels };
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
        // words selected on the picture are copied as text, and the picture is not
        if (stage.selected()) return copyText();
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
        // the clipboard's picture is sRGB, since most places a picture is pasted into read no profile
        const png = (async () => {
            if (way === "looks") return pngOf(await flattened(true));
            const done = await exported();
            if (done.blob.type === "image/png" && (!profile || converting())) return done.blob;
            // a format this browser cannot show (JPEG XL in some) is copied as it looks
            const bitmap = await createImageBitmap(done.blob).catch(() => undefined);
            return pngOf(bitmap ?? (await flattened(true)));
        })();
        try {
            await copyPicture(png);
            frame.status.say("Copied", `Copied, ${shown.width} × ${shown.height} px${way === "export" ? `, as the export is set (${formatOf(settings.format).label})` : ""}`);
        } catch (error) {
            frame.status.say("Not copied", `The picture was not copied: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
    }
    /** Copies the words selected, or every word read when none are, as text. */
    async function copyText() {
        const text = stage.selected() || stage.words().length && (stage.selectAll(true), stage.selected());
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            const count = text.split(/\s+/).filter(Boolean).length;
            frame.status.say("Copied", `Copied ${count} ${count === 1 ? "word" : "words"} as text`);
        } catch (error) {
            frame.status.say("Not copied", `The text was not copied: ${error instanceof Error ? error.message : String(error)}`, "warn");
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
        closed: () => (beside(), refresh()),
        keep: () => keeping,
        setKeep: (next) => ((keeping = next), void showExport(), estimate.soon()),
        settings: () => settings,
        set: (next) => ((settings = next), keep(KEYS.export, JSON.stringify(next)), void showExport(), estimate.soon()),
        copy: () => void copy(),
        save: () => void save(),
        wide: () => colors.space === "p3",
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
        turn: {
            turn: () => (picture ? (look(picture).turn ?? 0) : 0),
            turning: (degrees) => stage.turning(degrees),
            turned: (degrees) => turnTo(degrees),
            levelling: () => stage.levelling(),
            setLevelling: (on) => stage.setLevelling(on),
        },
        read: () => {
            const found = reading.found();
            return { state: reading.state(), progress: reading.progress(), words: found ? found.lines.reduce((sum, line) => sum + line.words.length, 0) : 0, private: stage.findings().length, model: reading.tier().name };
        },
        hideAll: () => void stage.hideFindings(),
        chooseModel: (from) => reading.choose(from),
        readAgain: () => void reading.start(buttons.read),
        grade: () => (asking ? { said: making === "find" ? findSaid() : asking.said, ...(making === "find" && finding.state() === "ready" ? { controls: [subjectButton, backgroundButton] } : {}), cancel: () => cancelPick() } : undefined),
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
                void loaded.flatten(small, undefined, gradingWith(small, colors.space, loaded.size)).then((pixels) => {
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
        read: tool("Read text (W)", "find", () => pickTool("read")),
        arrow: tool("Arrow (A)", "arrow", () => pickTool("arrow")),
        box: tool("Box (B)", "box", () => pickTool("box")),
        text: tool("Text (T)", "text", () => pickTool("text")),
        grade: tool("Grade (G)", "paper", () => showGrade()),
        facts: tool("Facts (I)", "info", () => showFacts()),
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
    buttons.facts.classList.add("quire-img-bar-facts");
    const end = group(buttons.grade, buttons.facts, buttons.export);
    end.classList.add("quire-bar-end");
    strip0.append(group(buttons.undo, buttons.redo), group(buttons.crop, buttons.resize, buttons.hide, buttons.read), group(buttons.arrow, buttons.box, buttons.text), end);
    bar.append(strip0);
    frame.place("bar").append(bar);

    function pickTool(next: Tool) {
        if (!picture) return;
        if (next === "grade") return showGrade();
        if (grading.isOpen()) grading.close();
        if (stage.tool() === "crop" && next !== "crop") stage.applyCrop();
        stage.setTool(stage.tool() === next && next !== "crop" ? "none" : next);
        stage.element.focus({ preventScroll: true });
        if (stage.tool() === "read") void reading.start(buttons.read);
    }
    /** Reads with another size of model, the tool for reading on: at once if it is kept, else asked for. */
    function useModel(id: string) {
        if (!picture) return;
        if (stage.tool() === "crop") stage.applyCrop();
        if (stage.tool() !== "read") stage.setTool("read");
        stage.element.focus({ preventScroll: true });
        void reading.use(id, buttons.read);
    }
    /** Turns the picture to level it, as one step; level again takes the step away. The crop's frame follows, and a line being drawn is done. */
    function turnTo(degrees: number) {
        if (!picture) return;
        stage.setLevelling(false);
        const next = setTurn(history.now(), degrees);
        if (next !== history.now()) commit(next);
        refresh();
    }
    function applyCrop() {
        stage.applyCrop();
        stage.setTool("none");
        stage.element.focus({ preventScroll: true });
    }
    /** The picture keeps its room narrowed while one of the panels is open, and has it back when none is. */
    const beside = () => {
        room.classList.toggle("beside", exporting.isOpen() || showing.isOpen() || grading.isOpen());
        room.classList.toggle("grading", grading.isOpen());
    };
    const showing = factsPanel({
        closed: () => (beside(), refresh()),
        facts: () => ({ ...said, size: picture ? `${picture.original.width} × ${picture.original.height} px, ${weightSaid(picture.original.bytes)} ${kindOf(picture.original)}` : "" }),
        edits: () => picture?.edits ?? {},
        setEdit: (key, value) => {
            if (!picture) return;
            // a field put back to what the picture says is no change at all
            const edits = { ...picture.edits, [key]: value === (said.found[key] ?? "") ? undefined : value };
            picture = { ...picture, edits };
            session.changed();
            estimate.soon();
        },
    });
    document.body.append(showing.panel);

    // ---- grading: the whole picture's grade, on the Grade surface ----
    const measure = createMeasure();
    let measured = false;
    let measuredMasks: ReturnType<typeof stackFor>["stack"];
    // what a press on the picture will do, when a fix asked for one
    let asking: { said: string } | undefined;
    /** The grade of what is picked: the whole picture's. */
    const currentGrade = (steps = history.now()): Grade => {
        const step = target ? steps.find((each) => each.id === target) : steps.find((each) => each.type === "grade");
        return step && (step.type === "grade" || step.type === "part") ? gradeOf(step) : neutral();
    };
    /** The steps with the grade of what is picked set to this one: a part's, or the whole picture's (taken away when it changes nothing). */
    const withGrade = (grade: Grade): Kept[] => {
        const steps = history.now();
        if (target) return steps.map((step) => (step.id === target && step.type === "part" ? { ...step, grade: trimGrade(grade) } : step));
        return isNeutral(grade) ? steps.filter((step) => step.type !== "grade") : setOnly(steps, { type: "grade", grade: trimGrade(grade) });
    };
    /** The part picked: its step, its name on the surface (its kind and its number among those of its kind) and its shape. */
    const targetPart = () => {
        const steps = history.now();
        const step = steps.find((each) => each.id === target);
        if (!step || step.type !== "part") return undefined;
        const number = steps.filter((each) => each.type === "part" && each.kind === step.kind).indexOf(step) + 1;
        return { id: step.id, name: partName(step.kind, number), shape: shapeOf(step) };
    };
    /** A new part, picked, with a grade of its own that changes nothing yet. */
    function addPart(shape: Shape) {
        const steps = add(history.now(), { type: "part", ...shape, grade: {} });
        target = steps.at(-1)!.id;
        commit(steps);
        fillGrade();
        refresh();
    }
    /** The part picked taken away, and the whole picture graded again. */
    function removePart() {
        if (!target) return;
        const id = target;
        target = undefined;
        commit(remove(history.now(), id));
    }
    /** Counts the grade on the small copy, in the worker, and draws the counts when they come. */
    async function measureGrade(steps = history.now()) {
        const loaded = stage.loaded();
        if (!loaded || !picture) return;
        if (!measured) {
            measured = true;
            measure.picture(await loaded.small(200), loaded.size);
        }
        const shown = look({ ...picture, steps });
        const stacked = stackFor(shown.grades, loaded.size);
        if (stacked.stack !== measuredMasks) measure.masks((measuredMasks = stacked.stack));
        measure.grade(shown.grades.filter((each) => !isNeutral(each.grade)).map((each) => ({ ready: prepared(each.grade, colors.space), ...stacked.layers(each.id) })), shown.crop, colors.space, (counts) => grading.counts(counts));
    }
    const grading = gradePanel({
        closed: () => {
            cancelPick();
            stage.hold(false);
            stage.setSplit(undefined);
            if (stage.tool() === "grade") stage.setTool("none");
            beside();
            refresh();
        },
        grade: () => currentGrade(),
        target: () => targetPart()?.name ?? "Whole picture",
        space: () => (colors.space === "p3" ? "Graded in Display P3, as the picture's profile says" : colors.known ? "Graded in sRGB" : `Graded as sRGB: the picture's profile (${colors.profile ?? "unnamed"}) is not one this knows`),
        preview: (grade) => {
            const steps = withGrade(grade);
            stage.preview(steps);
            void measureGrade(steps);
        },
        set: (grade) => {
            stage.preview(undefined);
            commit(withGrade(grade));
        },
        auto: () => void autoGrade(),
        balance: () => {
            if (asking) return cancelPick();
            asking = { said: "Press something that should be gray" };
            stage.arm((at) => void balanceAt(at));
            grading.fill();
            refresh();
        },
        balancing: () => !!asking,
        hold: (on) => stage.hold(on),
        split: () => stage.split() !== undefined,
        setSplit: (on) => stage.setSplit(on ? stage.element.clientWidth / 2 : undefined),
    });
    document.body.append(grading.panel);
    // More: the tint, the curve, the wheels and colors on their own
    const deeper = gradeMore({
        grade: () => currentGrade(),
        preview: (grade) => {
            const steps = withGrade(grade);
            stage.preview(steps);
            void measureGrade(steps);
        },
        set: (grade) => {
            stage.preview(undefined);
            commit(withGrade(grade));
        },
        pickColor: () => {
            if (asking) return cancelPick();
            if (currentGrade().colors.length >= MOST.colors) return;
            asking = { said: "Press a color in the picture" };
            stage.arm((at) => void colorAt(at));
            fillGrade();
            refresh();
        },
        picking: () => asking?.said === "Press a color in the picture",
    });
    grading.deeper.append(deeper.element);
    grading.more.addEventListener("toggle", () => grading.more.open && deeper.fill());
    // Looks: kept in this browser, given to this grade, and read and written as .cube files
    const looked = gradeLooks({
        store: lookStore(),
        grade: () => currentGrade(),
        set: (grade) => commit(withGrade(grade)),
        say: (short, full, warn) => frame.status.say(short, full, warn ? "warn" : undefined),
        name: () => where.name,
        space: () => colors.space,
        give,
    });
    grading.looksBody.append(looked.element);
    // parts: made from the surface, picked on the picture, each with its own few controls
    const parted = gradeParts({
        target: () => targetPart(),
        whole: () => {
            target = undefined;
            fillGrade();
            refresh();
            void measureGrade();
            stage.changed();
        },
        long: () => (picture ? Math.max(picture.original.width, picture.original.height) : 1000),
        setShape: (change, live) => {
            if (!target) return;
            const id = target;
            const steps = history.now().map((step) => (step.id === id && step.type === "part" ? ({ ...step, ...change } as Kept) : step));
            if (live) {
                stage.preview(steps);
                void measureGrade(steps);
            } else {
                stage.preview(undefined);
                commit(steps);
            }
        },
        remove: () => removePart(),
        gradient: () => {
            if (making === "gradient") return cancelPick();
            making = "gradient";
            asking = { said: "Drag across the picture, from where the grade is whole to where it is gone" };
            fillGrade();
            refresh();
        },
        making: () => making,
        find: () => {
            if (making === "find") return cancelPick();
            making = "find";
            asking = { said: "" };
            findTarget = undefined;
            void finding.start(grading.panel.querySelector<HTMLElement>(".quire-img-make-find") ?? undefined);
            fillGrade();
            refresh();
        },
        paint: () => {
            brush = { ...brush, on: true, erase: false };
            addPart({ kind: "paint", feather: 0 });
            asking = undefined;
        },
        brush: () => brush,
        setBrush: (next) => {
            brush = next;
            fillGrade();
            stage.changed();
        },
    });
    grading.parts.append(parted.element);
    // a thing a model finds: presses outline it, each press one change to the same part; Subject and Background find the picture's subject
    let findTarget: string | undefined;
    const finding = createFinding({
        bitmap: async () => stage.loaded()?.bitmap(),
        key: () => `${where.id ?? ""} ${picture?.original.name ?? ""}`,
        found: (found: Found, presses) => {
            const step = findTarget && presses.length > 1 ? history.now().find((each) => each.id === findTarget && each.type === "part") : undefined;
            if (step) commit(history.now().map((each) => (each.id === findTarget ? ({ ...each, found } as Kept) : each)));
            else {
                addPart({ kind: "found", found, feather: 2 });
                findTarget = target;
            }
        },
        subject: (found, background) => {
            addPart({ kind: "found", found, feather: 0, ...(background ? { invert: true } : {}) });
            findTarget = undefined;
            finding.fresh();
        },
        say: (short, full, tone) => frame.status.say(short, full, tone),
        moved: () => {
            // while finding, each press on the picture goes to the model
            if (making === "find" && finding.state() === "ready" && !stage.armed()) stage.arm((at, how) => void finding.press(at, !how.alt));
            if (making === "find" && finding.state() === "idle") {
                making = undefined;
                asking = undefined;
                stage.arm(undefined);
            }
            fillGrade();
            refresh();
        },
        returnTo: () => stage.element,
    });
    const stripButton = (label: string, tip: string, press: () => void) => {
        const button = make("button", "quire-img-strip-words", label);
        button.type = "button";
        button.title = tip;
        button.addEventListener("click", press);
        return button;
    };
    /** What the strip says while finding. */
    const findSaid = () => ({ idle: "Find", asking: "Choosing a model", fetching: "Downloading the model", finding: "Finding", ready: "Press a thing to outline it; Alt and press to take away" })[finding.state()];
    const subjectButton = stripButton("Subject", "The picture's subject, found by a model", () => void finding.subject(false));
    const backgroundButton = stripButton("Background", "Everything but the picture's subject", () => void finding.subject(true));
    grading.looks.addEventListener("toggle", () => grading.looks.open && void looked.fill());
    /** The surface and its deeper controls, as the grade now is. */
    const fillGrade = () => {
        grading.fill();
        parted.fill();
        if (grading.more.open) deeper.fill();
        if (grading.looks.open) void looked.fill();
    };
    /** A color picked: its hue as the shift will see it (the original's pixels round the place, graded up to the shift), added with nothing moved yet. */
    async function colorAt(at: { x: number; y: number }) {
        asking = undefined;
        const loaded = stage.loaded();
        if (!loaded) return;
        const x = Math.round(Math.max(0, Math.min(loaded.size.width - 1, at.x)));
        const y = Math.round(Math.max(0, Math.min(loaded.size.height - 1, at.y)));
        const area = { x: Math.max(0, x - 2), y: Math.max(0, y - 2), width: Math.min(5, loaded.size.width - Math.max(0, x - 2)), height: Math.min(5, loaded.size.height - Math.max(0, y - 2)) };
        const color = averageAround(await loaded.pixels(area), area.width, area.height, x - area.x, y - area.y);
        const grade = currentGrade();
        const seen = hueOf(gradeOne(color, prepared(grade, colors.space), space(colors.space), "colors"));
        if (seen.chroma < 0.03) {
            frame.status.say("Too gray", "That place is too near gray to pick a color from; press a stronger color");
            fillGrade();
            return refresh();
        }
        const hue = Math.round((((seen.hue * 180) / Math.PI) % 360 + 360) % 360);
        commit(withGrade({ ...grade, colors: [...grade.colors, { hue, shift: 0, saturation: 0, lightness: 0 }] }));
        frame.status.say("Color picked", `Hue ${hue}: its sliders are under Colors`);
        fillGrade();
        refresh();
    }
    /** Lets a press asked for go, as Escape or Cancel does. */
    function cancelPick() {
        if (!asking) return;
        asking = undefined;
        if (making === "find") finding.stop();
        making = undefined;
        stage.arm(undefined);
        fillGrade();
        refresh();
    }
    /** Balance: the warmth and tint that make the place pressed neutral, from the original's own pixels round it. */
    async function balanceAt(at: { x: number; y: number }) {
        asking = undefined;
        const loaded = stage.loaded();
        if (!loaded) return;
        const x = Math.round(Math.max(0, Math.min(loaded.size.width - 1, at.x)));
        const y = Math.round(Math.max(0, Math.min(loaded.size.height - 1, at.y)));
        const area = { x: Math.max(0, x - 2), y: Math.max(0, y - 2), width: Math.min(5, loaded.size.width - Math.max(0, x - 2)), height: Math.min(5, loaded.size.height - Math.max(0, y - 2)) };
        const pixels = await loaded.pixels(area);
        const { warmth, tint } = balanceFrom(averageAround(pixels, area.width, area.height, x - area.x, y - area.y));
        commit(withGrade({ ...currentGrade(), warmth, tint }));
        frame.status.say("Balanced", `Warmth ${warmth}, tint ${tint}: the place pressed is now neutral`);
        grading.fill();
        refresh();
    }
    /** Auto: the cast taken out and the levels set, as the warmth and tint sliders and the curve's ends. */
    async function autoGrade() {
        const loaded = stage.loaded();
        if (!loaded) return;
        const small = await loaded.small(256);
        const fixed = autoFix(small.data, colors.space);
        const now = currentGrade();
        commit(withGrade({ ...now, warmth: fixed.warmth, tint: fixed.tint, curves: { ...now.curves, all: fixed.curve } }));
        frame.status.say("Auto", `Warmth ${fixed.warmth}, tint ${fixed.tint}, and the curve's ends at ${fixed.curve[0]!.x} and ${fixed.curve.at(-1)!.x}`);
    }
    /** Opens the Grade surface in the export's place, or closes it. */
    function showGrade(from: HTMLElement = buttons.grade) {
        if (grading.isOpen()) return grading.close();
        if (!picture) return;
        if (stage.tool() === "crop") stage.applyCrop();
        exporting.close();
        showing.close();
        stage.setTool("grade");
        grading.fill();
        grading.open(from);
        beside();
        refresh();
        void measureGrade();
        grading.sliders[0]?.track.focus({ preventScroll: true });
    }
    // the original seen while the backslash is held, wherever the keyboard is in the picture or the surface
    const holdKey = (event: KeyboardEvent) => {
        if (event.key !== "\\" || (event.target instanceof HTMLInputElement && event.target.type !== "range")) return;
        event.preventDefault();
        stage.hold(event.type === "keydown");
    };
    for (const each of [stage.element, grading.panel]) {
        each.addEventListener("keydown", holdKey);
        each.addEventListener("keyup", holdKey);
    }
    stage.element.addEventListener("blur", () => stage.hold(false));
    // undo and redo reach the surface too, which lies outside the frame's keys; its number fields keep their own
    grading.panel.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target instanceof HTMLInputElement) return;
        const key = event.key.toLowerCase();
        const run = key === "z" && !event.shiftKey ? undo : (key === "z" && event.shiftKey) || key === "y" ? redo : undefined;
        if (!run) return;
        event.preventDefault();
        run();
    });
    /** Opens the facts in the export's place, or closes them. */
    function showFacts(from: HTMLElement = buttons.facts) {
        if (showing.isOpen()) return showing.close();
        if (!picture) return;
        exporting.close();
        grading.close();
        showing.fill();
        showing.open(from);
        beside();
        refresh();
        showing.panel.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
    }
    function showExportPanel(from: HTMLElement = buttons.export) {
        if (exporting.isOpen()) return exporting.close();
        if (stage.tool() === "crop") stage.applyCrop();
        // the picture makes room for the panel, gliding into what is left, rather than lying under it
        showing.close();
        grading.close();
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
            button.classList.toggle("pressed", (stage.tool() === name && name !== "grade") || (name === "export" && exporting.isOpen()) || (name === "facts" && showing.isOpen()) || (name === "grade" && grading.isOpen()));
        }
        buttons.undo.disabled = !history.canUndo();
        buttons.redo.disabled = !history.canRedo();
        const kind = !has ? "none" : stage.tool() === "crop" ? "crop" : stage.tool() === "read" ? "read" : stage.tool() === "grade" ? "grade" : stage.tool() === "arrow" || stage.tool() === "box" || stage.tool() === "text" || pickedMark() ? "mark" : "none";
        strip.fill(kind);
        if (picture && !facts.textContent) facts.textContent = factsSaid(look(picture), picture.original.bytes, kindOf(picture.original));
        if (!picture) facts.textContent = "";
    }

    // ---- the menus, as one table, and the keys ----
    const tick = (on: boolean, name: string) => (on ? "tick" : name);
    const copyWay = () => local()?.getItem(KEYS.copy);
    const filterOf = (): Filter => (picture ? look(picture).filter : "lanczos");
    const headings = (): Heading[] => [
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
                        { label: "Copy text", icon: "copy", key: "copy-text", disabled: !stage.words().length, run: () => void copyText() },
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
                    [
                        { label: "Facts", icon: tick(showing.isOpen(), "info"), hint: "I", key: "facts", pressed: showing.isOpen(), disabled: !picture, run: () => showFacts(frame.name) },
                        { label: "Split", icon: tick(stage.split() !== undefined, "column"), key: "split", pressed: stage.split() !== undefined, disabled: !picture, run: () => stage.setSplit(stage.split() === undefined ? stage.element.clientWidth / 2 : undefined) },
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
                    [
                        { label: "Grade", icon: tick(grading.isOpen(), "paper"), hint: "G", key: "grade", pressed: grading.isOpen(), disabled: !picture, run: () => showGrade() },
                        { label: "Auto", icon: "paper", key: "grade-auto", disabled: !picture, run: () => void autoGrade() },
                        { label: "Remove the grade", icon: "trash", disabled: !history.now().some((step) => step.type === "grade"), run: () => commit(history.now().filter((step) => step.type !== "grade")) },
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
                        { label: "Read text", icon: tick(stage.tool() === "read", "find"), hint: "W", key: "read", pressed: stage.tool() === "read", disabled: !picture, run: () => pickTool("read") },
                        {
                            label: "Text model",
                            icon: "settings",
                            items: () => TIERS.map((each) => ({ label: each.name, icon: tick(reading.tier().id === each.id, "find"), hint: reading.kept(each.id) ? "On this device" : megabytes(sizeOf(each)), pressed: reading.tier().id === each.id, run: () => useModel(each.id) })),
                            run: () => {},
                        },
                        { label: "Hide what looks private", icon: "hide", key: "hide-private", disabled: !stage.findings().length, run: () => void stage.hideFindings() },
                    ],
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
    ];
    frame.menus(headings);

    // ---- a right-click's menu: what is under the pointer first, then copy and paste, then export ----
    const pressMenu = flowMenu("Picture", { className: "quire-img-press-menu" });
    const pressAnchor = make("span", "quire-anchor");
    pressAnchor.setAttribute("aria-hidden", "true");
    function openPressMenu(x: number, y: number, keyboard: boolean) {
        Object.assign(pressAnchor.style, { left: `${x}px`, top: `${y}px`, height: "0px" });
        if (!pressAnchor.isConnected) document.body.append(pressAnchor);
        const lines = pressLines(headings(), { picture: !!picture, picked: !!stage.picked() }, { label: "Choose a picture", icon: "image", key: "choose", run: () => chooser.click() });
        pressMenu.open(pressAnchor, lines, keyboard);
        // opened by the pointer, the menu still takes the keyboard (no line of it yet), so that Escape closes it and the
        // arrows go through it, and not to the picture under it; closing gives the keyboard back to where it was
        if (!keyboard) pressMenu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }
    /** When the menu was last opened from the keyboard, whose own menu event may follow. */
    let pressKeyedAt = -Infinity;
    const onPressMenu = (event: MouseEvent) => {
        // Shift leaves the browser's own menu; a field, a button, the strip and a panel keep theirs
        if (event.shiftKey || event.defaultPrevented || host.classList.contains("shelved")) return;
        if (event.target instanceof Element && event.target.closest("input, textarea, button, [contenteditable=true], .quire-img-strip, .quire-img-panel, .quire-img-resize")) return;
        event.preventDefault();
        if (performance.now() - pressKeyedAt < 500) return;
        stage.pickAt(event.clientX, event.clientY);
        openPressMenu(event.clientX, event.clientY, false);
    };
    const onPressKey = (event: KeyboardEvent) => {
        if (!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) || event.defaultPrevented) return;
        if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]")) return;
        event.preventDefault();
        pressKeyedAt = performance.now();
        const place = room.getBoundingClientRect();
        openPressMenu(place.left + place.width / 2, place.top + place.height / 2, true);
    };
    room.addEventListener("contextmenu", onPressMenu);
    room.addEventListener("keydown", onPressKey);

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
    const firstMarked = () => history.now().find((step) => step.type !== "crop" && step.type !== "resize" && step.type !== "grade")?.id;
    /** Moves what is picked one place forward (over the next thing drawn) or back (under the one before), skipping the crop and the resize, which are drawn under everything. */
    function restack(by: 1 | -1) {
        const id = stage.picked();
        const steps = history.now();
        const at = steps.findIndex((step) => step.id === id);
        if (!id || at < 0) return;
        let to = at + by;
        while (steps[to] && (steps[to]!.type === "crop" || steps[to]!.type === "resize" || steps[to]!.type === "grade")) to += by;
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
            ["W", "Read text: press a word to hide it, drag to hide a run"],
            ["A", "Arrow"],
            ["B", "Box"],
            ["T", "Text"],
            ["G", "Grade: sliders, curves, wheels, looks, and parts of the picture"],
            ["\\", "Hold to see the original"],
            ["E", "Export"],
            ["Enter", "Apply the crop"],
            ["Escape", "Leave the tool"],
            ["Arrows", "Nudge the frame or what is picked (Shift: 10 pixels)"],
            ["Delete", "Remove what is picked"],
            ["Ctrl+C", "Copy"],
            ["Ctrl+V", "Paste a picture"],
            ["Right-click", "A menu for what is under the pointer, with Copy and Paste (Shift: the browser's own)"],
            ["Ctrl+Z", "Undo"],
            ["Ctrl+Shift+Z", "Redo"],
            ["Ctrl+0", "Fit"],
            ["Ctrl+1", "100%"],
            ["Space and drag", "Move the picture"],
            ["Drag across words", "Select text, with no tool on; Ctrl+C copies it"],
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
        if (picked && !event.shiftKey) return () => (picked === "export" ? showExportPanel() : picked === "facts" ? showFacts() : picked === "grade" ? showGrade() : pickTool(picked));
        if (event.key === "Enter" && stage.tool() === "crop") return applyCrop;
        if (event.key === "Escape") {
            if (asking) return () => cancelPick();
            if (grading.isOpen() && target)
                return () => {
                    target = undefined;
                    fillGrade();
                    refresh();
                    stage.changed();
                    void measureGrade();
                };
            if (stage.picked()) return () => stage.pick(undefined);
            if (stage.selected()) return () => stage.selectAll(false);
            if (stage.tool() !== "none") return () => (stage.tool() === "crop" ? stage.setTool("none") : stage.setTool("none"));
            return undefined;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && stage.picked()) return removePicked;
        if ((event.key === "Delete" || event.key === "Backspace") && grading.isOpen() && target) return removePart;
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
        reading,
        steps: () => history.now(),
        changeStep: (id: string, to: Partial<Kept>) => commit(history.now().map((step) => (step.id === id ? ({ ...step, ...to } as Kept) : step))),
        downloadQuire,
        flatten: () => flattened(),
        /** Opens the document again from its steps.json, as if it were opened anew. */
        reopen: () => picture && open(writeSteps(picture)),
        grading,
        destroy() {
            estimate.cancel();
            reading.destroy();
            measure.destroy();
            finding.destroy();
            grading.panel.remove();
            document.removeEventListener("paste", pasted);
            pressMenu.close(false);
            pressAnchor.remove();
            session.destroy();
            frame.destroy();
            stage.destroy();
            exporting.panel.remove();
            showing.panel.remove();
            resizing.box.remove();
            historyPanel.close();
            historyPanel.element.remove();
            host.classList.remove("quire-img-editor");
            host.replaceChildren();
        },
    };
}
