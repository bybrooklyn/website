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
import { lowered } from "../core/bench";
import { control, enterGivesBack, fieldForm, flowMenu, icon, make, ruled, RULE, type MenuItem } from "../core/ui";
import type { Heading } from "../core/menu-row";
import { pressLines } from "./press-menu";
import { copyPicture, exportName, formatOf, FORMATS, readSettings, weightSaid, type Settings } from "./export";
import { heicIn } from "./codec-run";
import { COLORS, exportPanel, factsPanel, factsSaid, kindOf, MARK_TOOLS, nameFor, OUTLINES, resizeBox, SHADES, SHAPES, toolStrip, WEIGHTS, ZOOM_STEPS, type MarkControls } from "./panels";
import { factsOf, profileOf, spaceOf, type Facts, type Keep } from "./metadata";
import { gradingWith } from "./draw";
import { createStage, PEN, setPerspective, setTurn, sizesFor, type Pen, type Tool } from "./stage";
import { alignShare, textWidth } from "./marks";
import { perspectiveMap, rectangleOf, type Corners, type Perspective } from "./perspective";
import { apply, ratioOf } from "./homography";
import { grey, segments, straighten } from "./lines";
import { createRepair } from "./repair";
import { createRestorer } from "./restore/engine";
import { createRestoreAsking } from "./restore/asking";
import { enlargedSize, restoreModelOf } from "./restore/models";
import { jpegFacts, worthRepairing } from "./deblock";
import { createReading } from "./reading";
import { gradePanel } from "./grade-panel";
import { gradeMore } from "./grade-more";
import { gradeLooks, lookStore } from "./looks";
import { brushRadius, gradeParts, partName, type Brush } from "./grade-parts";
import { stackFor, type Found, type Shape } from "./masks";
import { createFinding } from "./finding";
import { createFinder } from "./parts/finder";
import { PART_TIERS } from "./parts/models";
import { createAsking } from "./cutout/asking";
import { blank, cutOut, CUT_SIDE, findCut, FOUND_NOTHING, NOTHING_SAID, type Cut, type Laid } from "./cutout/cut";
import { createMeasure } from "./measure";
import { autoFix, averageAround, balanceFrom } from "./fix";
import { prepared } from "./draw";
import { gradeOne, hueOf, isNeutral, MOST, neutral, space, trimGrade, type Grade } from "./grade";
import { megabytes, sizeOf, TIERS } from "./read/models";
import { add, createHistory, fresh, gradeOf, isMark, look, MARK_KINDS, move, MOST_NUMBER, numbersOf, remove, setOnly, shapeOf, within, writeSteps, type Align, type Filter, type History, type Kept, type Mark, type MarkKind, type Picture, type Rect } from "./steps";
import { batchName, changesSaid, giveRepair, giveStep, givables, namesFor, picturesSaid, readBatch, resizeSaid, settingsSaid, smallName, whichSaid, writeBatch, type BatchPicture, type Givable } from "./batch";
import { atOnce, blobSink, fileSink, folderOut, runEach, zipOut, type Destination } from "./batch-out";
import { batchStrip, type StripItem } from "./batch-strip";
import { displayable, flattenAway, readOriginal, writeOut } from "./picture-out";
import { pixelsOf, smallFrom, smallLook, smallOf } from "./thumbs";
import { backendFor } from "./draw";
import type { FolderHandle } from "../core/store-folder";

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
const TOOL_KEYS: Record<string, Tool | "export" | "facts" | "perspective"> = { KeyC: "crop", KeyR: "hide", KeyA: "arrow", KeyT: "text", KeyB: "box", KeyN: "number", KeyH: "highlight", KeyM: "magnifier", KeyS: "spotlight", KeyE: "export", KeyI: "facts", KeyW: "read", KeyG: "grade", KeyK: "cutout", KeyP: "perspective" };

/** The pen as this browser kept it, each field checked, with what is missing or wrong taken from the start: the first color, a medium line, no outline, left aligned, twice as large, a medium shade, a rectangle; and the mark last used, an arrow to start. */
export function readPen(text: string | null | undefined): Pen & { mark: MarkKind } {
    let kept: Partial<Pen & { mark: string }> | null = null;
    try {
        kept = JSON.parse(text ?? "null");
    } catch {
        kept = null;
    }
    const given = kept && typeof kept === "object" ? kept : {};
    return {
        color: COLORS.some((each) => each.value === given.color) ? given.color! : COLORS[0]!.value,
        weight: WEIGHTS.some((each) => each.value === given.weight) ? given.weight! : WEIGHTS[1]!.value,
        ...(COLORS.some((each) => each.value === given.outline) ? { outline: given.outline } : {}),
        outlineWeight: OUTLINES.some((each) => each.value === given.outlineWeight) ? given.outlineWeight! : PEN.outlineWeight,
        align: given.align === "center" || given.align === "right" ? given.align : "left",
        zoom: ZOOM_STEPS.includes(given.zoom as number) ? given.zoom! : PEN.zoom,
        dim: SHADES.some((each) => each.value === given.dim) ? given.dim! : PEN.dim,
        ...(given.round === true ? { round: true } : {}),
        mark: (MARK_KINDS as string[]).includes(given.mark as string) ? (given.mark as MarkKind) : "arrow",
    };
}

/** Hands the writer a file. */
function give(blob: Blob, name: string) {
    const link = make("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** One picture of the document as the editor holds it: what the file keeps, its own undo, its small copy's pixels once read, and those pixels drawn as it looks (for the steps they were drawn for). */
interface Item extends BatchPicture {
    key: string;
    history: History;
    smallPixels?: ImageData;
    drawn?: StripItem["pixels"];
    drawnFor?: Kept[];
}

let itemCount = 0;
/** A picture of the document made an item, its undo starting at its steps. */
const itemOf = (picture: BatchPicture): Item => ({ ...picture, key: `p${++itemCount}`, history: createHistory(picture.steps) });

/** Mounts imgQuire's editor in the app, on the document it starts with or on nothing. */
export function mountEditor(host: HTMLElement, context: Context) {
    host.classList.add("quire-editor", "quire-img-editor");
    const frame = createFrame(host, { top: context.top, name: context.start?.entry.name ?? "Untitled", onName: context.onName });
    const room = make("div", "quire-img-room");
    const empty = make("div", "quire-img-empty");
    const choose = make("button", "quire-dialog-action", "choose a picture");
    choose.type = "button";
    const chooser = make("input");
    chooser.type = "file";
    chooser.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/jxl,image/heic,image/heif,.heic,.heif,.jxl";
    chooser.hidden = true;
    empty.append(make("p", "", "Paste or drop a picture"), choose, chooser);
    const facts = make("p", "quire-img-facts");
    facts.setAttribute("aria-live", "polite");
    // the line's words for the picture as it is, and the crop's frame while one is being set, when the line says the size it would give instead
    let factsWhole = "";
    let framing: Rect | undefined;
    /**
     * Shows the line under the picture: for the picture as it is, or while a crop's frame is being set, the size the picture will
     * be once the frame is applied (a resize after the crop counted, as Apply makes it); a frame that gives the size the picture
     * has already leaves the line whole, its weight with it.
     */
    function fillFacts() {
        if (!framing || !picture) return void (facts.textContent = factsWhole);
        const size = look({ ...picture, steps: setOnly(history.now(), { type: "crop", rect: within(framing, picture.original) }) });
        const now = look(picture);
        facts.textContent = size.width === now.width && size.height === now.height ? factsWhole : sizeLine(size);
    }
    /** Puts the line under the picture for the picture as it is. */
    const setFacts = (text: string) => {
        factsWhole = text;
        fillFacts();
    };

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
    let history: History = createHistory([]);
    // the document's pictures: one, or a batch's; the one on the stage is `items[at]`, whose steps are `history`'s
    let items: Item[] = [];
    let at = 0;
    // a change given to all is one group of changes across the pictures' histories, with their export settings before and after
    let groups = 0;
    const groupSettings = new Map<number, Map<Item, { before?: Settings; after?: Settings }>>();
    // the pen, and the mark last used, which the bar keeps one press away
    let pen: Pen & { mark: MarkKind } = readPen(local()?.getItem(KEYS.pen));
    const keepPen = (next: Partial<Pen & { mark: MarkKind }>) => {
        pen = { ...pen, ...next };
        keep(KEYS.pen, JSON.stringify(pen));
    };
    let settings: Settings = readSettings(local()?.getItem(KEYS.export));
    // the part models' worker, shared by Find and the cut-out, made when first asked
    const sharedFinder = createFinder();
    /** A restoring model's run going (restore/), for the strip: what it does, how far, and its stop. */
    let running: { said: string; share?: number; stop: AbortController } | undefined;
    // the way of enlarging chosen in this browser: a model's id, or "" for the resize's filter
    let enlargeWay = "";
    let shape = "Free";
    // perspective's dials and corners in the crop's strip, in place of its shapes
    let straightening = false;

    const stage = createStage({
        picture: () => picture,
        change: (steps) => commit(steps),
        pen: () => pen,
        moved: () => refresh(),
        framed: (rect) => {
            framing = rect;
            fillFacts();
        },
        turned: (degrees) => turnTo(degrees),
        cornered: (corners) => cornerTo(corners),
        clear: () => !!picture && look(picture).cutout?.background === "clear",
        cutout: {
            brush: () => (cutBrush && picture ? { size: Math.max(4, Math.round(Math.max(picture.original.width, picture.original.height) / 60)), erase: cutBrush === "remove" } : undefined),
            stroke: (stroke) => changeCut((cut) => ({ ...cut, strokes: [...(cut.strokes ?? []), stroke] })),
            press: (at) => void pickSubject(at),
        },
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
            writing: () => ({ text: documentText(), quire: {} }),
            load: (found) => void open(found.text),
            replace: (found) => {
                const read = readBatch(found.text);
                if (!read || !picture) return;
                // their batch, or theirs in place of a batch, is opened as it is, with nothing to undo
                if (read.batch || items.length > 1) return void open(found.text);
                commit(read.pictures[0]!.steps);
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

    /** steps.json as the document now is: one picture's, or the batch's with every picture's steps. */
    function documentText(): string {
        keepCurrent();
        if (items.length > 1) return writeBatch(items);
        return picture ? writeSteps(picture) : "";
    }
    /** The picture on the stage written back into its item, so that the batch has its steps and what she wrote. */
    function keepCurrent() {
        const item = items[at];
        if (!item || !picture) return;
        item.steps = history.now();
        if (picture.edits) item.edits = picture.edits;
        else delete item.edits;
    }
    /** True when the document is a batch of pictures. */
    const batched = () => items.length > 1;

    /** Puts a document's pictures in, the one last worked on (or the first) on the stage. */
    async function open(text: string | undefined) {
        const read = text === undefined ? undefined : readBatch(text);
        items = read ? read.pictures.map(itemOf) : [];
        groupSettings.clear();
        at = read?.batch ? Math.max(0, Math.min(items.length - 1, keptAt())) : 0;
        // a batch's pictures have their own export settings: one with none takes the browser's
        if (read?.batch) for (const item of items) item.export ??= settings;
        await showItem(at, { dropped: read?.dropped ?? 0, unreadable: text !== undefined && !read });
        if (read?.batch) void readSmalls();
    }

    /** Puts one of the document's pictures on the stage, with its original fetched from where it is kept: its own steps and undo, and in a batch its own export settings. */
    async function showItem(index: number, how: { dropped?: number; unreadable?: boolean; stepping?: boolean } = {}) {
        const token = ++loading;
        estimate.cancel();
        keepCurrent();
        at = index;
        const item = items[at];
        if (batched()) keepAt(at);
        history = item?.history ?? createHistory([]);
        picture = item && { original: item.original, steps: history.now(), ...(item.edits ? { edits: item.edits } : {}) };
        if (item && batched()) settings = item.export ?? settings;
        exportCache.key = undefined;
        enlarged.key = undefined;
        original = undefined;
        said = { rows: [], everything: [], found: {} };
        colors = { space: "srgb", known: true };
        profile = undefined;
        // the new picture's size at once, its weight when it is worked out; never the last document's
        setFacts(picture ? factsLine(look(picture), picture.original.bytes, kindOf(picture.original)) : "");
        reading.clear();
        stage.clear();
        originalBytes = undefined;
        repairable = false;
        repaired = undefined;
        target = undefined;
        making = undefined;
        measuredMasks = undefined;
        // a new picture starts with the crop's own strip, not perspective's
        straightening = false;
        stage.setCornering(false);
        // stepping through a batch keeps the tool in hand where it is one that works the same on every picture; anything else starts with the crop's frame
        const tool = stage.tool();
        stage.setTool(grading.isOpen() ? "grade" : how.stepping && (tool === "hide" || (MARK_KINDS as string[]).includes(tool)) ? tool : "crop");
        measured = false;
        fillStrip();
        refresh();
        if (how.unreadable) return frame.status.say("Not opened", "This picture's steps could not be read", "warn");
        if (!item) return;
        const found = await originalOf(item.original.name).catch(() => undefined);
        if (token !== loading) return;
        if (!found) return frame.status.say("No picture", "This document's original picture is missing from where it is kept", "warn");
        original = found;
        const bytes = new Uint8Array(await found.arrayBuffer());
        said = factsOf(bytes);
        // a JPEG compressed hard enough to be worth repairing, kept upright as stored (the repair follows the file's own grid)
        originalBytes = bytes;
        repairable = worthRepairing(jpegFacts(bytes)) && (!said.orientation || said.orientation === 1);
        const colored = await profileOf(bytes);
        if (token !== loading) return;
        colors = colored.space;
        profile = colored.icc;
        if (showing.isOpen()) showing.fill();
        shownSource = await displayable(found).catch(() => found);
        cutKey = "";
        cutShown = undefined;
        cutOpened = false;
        cutNothing = false;
        await stage.show(shownSource);
        void showCut();
        if (token !== loading) return;
        if (grading.isOpen()) void measureGrade();
        if (how.dropped) frame.status.say("Steps left out", `${how.dropped} of its steps could not be read and were left out`, "warn");
        if (exporting.isOpen()) exporting.fill();
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
        // a new size is said at once, its weight once it is worked out, so that the line never says the size there was
        const size = look(picture);
        if (!factsWhole.includes(`${size.width} × ${size.height} px`)) setFacts(sizeLine(size));
        keepCurrent();
        fillStrip();
        void showCut();
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
    // undo and redo: a change given to all is taken back (or made again) on every picture that still has it at the top of its own undo
    const undo = () => {
        const group = history.undoGroup();
        if (group !== undefined && batched()) return walkGroup(group, "undo");
        if (history.undo()) changed();
    };
    const redo = () => {
        const group = history.redoGroup();
        if (group !== undefined && batched()) return walkGroup(group, "redo");
        if (history.redo()) changed();
    };
    /** A group of changes given to all, undone or redone on each picture whose own undo has it next, with the export settings it set put back or set again. */
    function walkGroup(group: number, way: "undo" | "redo") {
        const kept = groupSettings.get(group);
        let count = 0;
        for (const item of items) {
            const next = way === "undo" ? item.history.undoGroup() : item.history.redoGroup();
            if (next !== group || !(way === "undo" ? item.history.undo() : item.history.redo())) continue;
            item.steps = item.history.now();
            count++;
            const set = kept?.get(item);
            if (set) item.export = way === "undo" ? set.before : set.after;
        }
        const item = items[at];
        if (item && batched()) settings = item.export ?? settings;
        changed();
        if (exporting.isOpen()) void showExport();
        frame.status.say(way === "undo" ? "Undone" : "Redone", `${way === "undo" ? "Undone" : "Done again"} on ${picturesSaid(count)}`);
    }

    // ---- a picture arriving: pasted, dropped or chosen, it becomes a document kept in this browser ----
    async function take(file: Blob & { name?: string }, named?: string): Promise<boolean> {
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
        const name = named ?? nameFor(file.name, new Date());
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
    /** What a picture brings as it arrives, from one decode: its original's record (where it will be kept, its size, type and weight) and its small copy. */
    async function readIn(file: Blob & { name?: string }) {
        const heic = heicIn(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
        const bitmap = await createImageBitmap(await displayable(file));
        const size = { width: bitmap.width, height: bitmap.height };
        const small = await smallFrom(bitmap).finally(() => bitmap.close());
        const type = heic ? "image/heic" : file.type || "image/png";
        const ending = heic ? ".heic" : FORMATS.find((format) => format.type === type)?.ending ?? /\.[a-z0-9]{1,5}$/i.exec(file.name ?? "")?.[0] ?? ".png";
        const stem = (file.name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "picture";
        const wanted = `${stem}${ending}`;
        return { wanted, small, original: { name: `pictures/${wanted}`, width: size.width, height: size.height, type, bytes: file.size } };
    }
    /**
     * Many pictures at once become one batch kept in this browser: the first opened at once as a document of
     * its own, then the rest added to it as each is read, the strip growing in from where they arrived and
     * their small pictures arriving one after another.
     */
    async function takeMany(files: (Blob & { name?: string })[], from?: { x: number; y: number }): Promise<boolean> {
        if (files.length < 2) return files[0] ? take(files[0]) : false;
        if (!(await take(files[0]!, batchName(new Date())))) return false;
        await addPictures(files.slice(1), from, files[0]!);
        return true;
    }
    // how far pictures being brought in have come, for the status
    let adding = 0;
    /**
     * Pictures added to the document, a few read at a time and each kept in the store beside the others with
     * its small copy, in the order given; a document of one picture becomes a batch. Each picture keeps the name
     * its file came with, for its export, and takes the export settings in use.
     */
    async function addPictures(files: (Blob & { name?: string })[], from?: { x: number; y: number }, firstFile?: Blob & { name?: string }) {
        const { store, id } = where;
        const list = files.filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name ?? ""));
        if (!store || !id || !picture || !list.length) return;
        if (stage.tool() === "crop") stage.applyCrop();
        keepCurrent();
        // the picture that was alone is the batch's first: its own name, a small copy and the export settings in use
        const first = items[0];
        if (items.length === 1 && first) {
            first.given ??= firstFile?.name ?? `${where.name}${FORMATS.find((format) => format.type === first.original.type)?.ending ?? ""}`;
            first.export ??= settings;
            const source = firstFile ?? original ?? (await originalOf(first.original.name).catch(() => undefined));
            if (!first.small && source) {
                const small = await smallOf(source).catch(() => undefined);
                if (small) {
                    first.small = await store.savePicture(id, small, smallName(first.original.name, small.type)).catch(() => undefined);
                    first.smallPixels = await pixelsOf(small).catch(() => undefined);
                }
            }
        }
        const base = items.length;
        const placed: number[] = [];
        adding += list.length;
        let came = 0;
        let failed = 0;
        const said = () => frame.status.say("Bringing in", `Bringing in ${came + failed} of ${list.length}`, "quiet", true);
        said();
        const ran = await runEach(
            list.length,
            async (index) => readIn(list[index]!),
            async (index, read) => {
                const address = await store.savePicture(id, list[index]!, read.wanted);
                const small = await store.savePicture(id, read.small, smallName(address, read.small.type)).catch(() => undefined);
                const item = itemOf({ original: { ...read.original, name: address }, steps: [], given: list[index]!.name ?? read.wanted, ...(small ? { small } : {}), export: settings });
                item.smallPixels = await pixelsOf(read.small).catch(() => undefined);
                // in the order the files were given, whichever is read first
                const position = base + placed.filter((each) => each < index).length;
                placed.push(index);
                // always after the pictures already there, so the one on the stage keeps its place
                items.splice(position, 0, item);
                came++;
                said();
                fillStrip(from);
                setFacts(picture ? factsLine(look(picture), picture.original.bytes, kindOf(picture.original)) : "");
                session.changed();
            },
            { atOnce: atOnce() },
        );
        adding -= list.length;
        failed = ran.failed.length;
        const why = ran.failed[0] ? (ran.failed[0].error instanceof Error ? ran.failed[0].error.message : String(ran.failed[0].error)) : "";
        frame.status.say("Brought in", failed ? `${picturesSaid(came)} brought in; ${failed} could not be read (${why})` : `${picturesSaid(came)} brought in; ${picturesSaid(items.length)} in all`, failed ? "warn" : "quiet");
        refresh();
        if (exporting.isOpen()) exporting.fill();
    }
    /** Takes a picture out of the batch, the one beside it shown if it was on the stage. Its original stays kept with the document, so version history can bring it back. */
    async function takeOut(index: number) {
        if (!batched() || !items[index]) return;
        keepCurrent();
        const current = index === at;
        const [gone] = items.splice(index, 1);
        if (index < at) at--;
        else if (current) at = Math.min(at, items.length - 1);
        session.changed();
        if (current) {
            // the picture that was on the stage is gone: nothing is written back into the one put there
            picture = undefined;
            await showItem(at);
        } else if (batched()) keepAt(at);
        setFacts(picture ? factsLine(look(picture), picture.original.bytes, kindOf(picture.original)) : "");
        fillStrip();
        refresh();
        estimate.soon();
        frame.status.say("Taken out", `${gone?.given ?? "The picture"} was taken out of the batch; version history can bring it back`);
    }
    const picturesIn = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name));
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || host.classList.contains("shelved") || (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]"))) return;
        const files = picturesIn(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        void takeMany(files);
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
        const files = picturesIn(event.dataTransfer);
        if (!files.length) return;
        event.preventDefault();
        void takeMany(files, { x: event.clientX, y: event.clientY });
    });
    choose.addEventListener("click", () => chooser.click());
    chooser.multiple = true;
    chooser.addEventListener("change", () => {
        const files = [...(chooser.files ?? [])];
        chooser.value = "";
        void (adder ? addPictures(files) : takeMany(files));
        adder = false;
    });
    // true while the chooser is open to add pictures to this document rather than to make a new one
    let adder = false;
    /** Asks for pictures to add to this document. */
    const choosePictures = () => {
        adder = true;
        chooser.click();
    };

    // ---- getting it out ----
    const exportCache: { key?: string; done?: Promise<{ blob: Blob; quality: number; over: boolean; pixels?: ImageData }> } = {};
    /** Whether the export is made sRGB: when she chose it and the picture is in Display P3. */
    const converting = () => settings.srgb === true && colors.space === "p3";
    /** The picture as it looks, at full size; made sRGB from Display P3 when `srgb`. */
    const flattened = async (srgb = false) => {
        const loaded = stage.loaded();
        if (!loaded || !picture) throw new Error("the picture is not shown yet");
        const shown = look(picture);
        const grading = gradingWith(shown, colors.space, loaded.size, srgb && colors.space === "p3");
        const made = shown.enlarge ? await enlargedFor(shown, srgb) : undefined;
        return loaded.flatten(shown, undefined, grading, colors.space, made);
    };
    /** The export as set, worked out once for each set of steps and settings. */
    function exported() {
        const key = `${picture ? writeSteps(picture) : ""}\n${JSON.stringify(settings)}\n${keeping}\n${colors.space}`;
        if (exportCache.key === key && exportCache.done) return exportCache.done;
        exportCache.key = key;
        const now = picture!;
        const given = settings;
        // the same rules as every picture of a batch exported together (picture-out.ts)
        exportCache.done = (async () => {
            const bytes = originalBytes ?? (original ? new Uint8Array(await original.arrayBuffer()) : undefined);
            if (!bytes) throw new Error("the picture is not shown yet");
            return writeOut({ picture: now, bytes, ...(profile ? { profile } : {}), space: colors.space, settings: given, keeping, flatten: (convert) => flattened(convert) });
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
                        setFacts(factsLine(size, done.blob.size, formatOf(settings.format).label));
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
                others: [{ label: "as the export is set", press: (dialog) => ((chosen = "export"), keep(KEYS.copy, "export"), void dialog.close()) }],
                dismiss: "cancel",
                action: { label: "as it looks", press: (_, dialog) => ((chosen = "looks"), keep(KEYS.copy, "looks"), void dialog.close()) },
                returnTo: stage.element,
                onClose: () => answer(chosen),
            });
        });
    async function save() {
        if (!picture) return;
        if (stage.tool() === "crop") stage.applyCrop();
        const done = await exported().catch((error) => void frame.status.say("Not saved", `The picture was not made: ${error instanceof Error ? error.message : String(error)}`, "warn"));
        if (!done) return;
        // a picture of a batch keeps its own name, as it does when all are exported; one alone is named from the document
        const item = items[at];
        const name = batched() && item ? namesFor([item.given ?? item.original.name.replace(/^pictures\//, "")], formatOf(settings.format).ending)[0]! : exportName(where.name, formatOf(settings.format));
        give(done.blob, name);
        frame.status.say("Saved", `Saved as ${name}, ${weightSaid(done.blob.size)}`);
    }
    async function downloadQuire() {
        if (!picture || !original) return;
        const name = picture.original.name.replace(/^pictures\//, "");
        // a batch carries every picture kept with it that its steps.json names: the originals, their small copies and the repairs made by a model
        const pictures = batched() ? await storePictures() : new Map([[name, original]]);
        const bytes = await packQuire({ text: documentText(), main: MAIN, parts: {}, pictures });
        give(new Blob([bytes as BlobPart], { type: "application/zip" }), exportName(where.name, { ending: ".quire" } as ReturnType<typeof formatOf>));
        session.downloaded();
    }

    // ---- what opens round the picture ----
    const exporting = exportPanel({
        closed: () => (beside(), refresh()),
        keep: () => keeping,
        setKeep: (next) => ((keeping = next), void showExport(), estimate.soon()),
        settings: () => settings,
        set: (next) => setSettings(next),
        copy: () => void copy(),
        save: () => void save(),
        wide: () => colors.space === "p3",
        // a batch's pictures each have their own settings, which can be given to all, and all can be saved together
        batch: () =>
            batched()
                ? {
                      count: items.length,
                      folder: !!pickers.showDirectoryPicker,
                      give: giveSaid("export")!,
                      ...(exportRun ? { running: `Saving ${exportRun.done} of ${exportRun.count}` } : {}),
                  }
                : undefined,
        giveAll: () => void giveAll(["export"]),
        saveAll: (how) => void exportAll(how),
        stopAll: () => exportRun?.stop.abort(),
        // a cut-out laid on nothing has transparency, which a JPEG cannot keep: said, with what can be done
        note: () =>
            picture && look(picture).cutout?.background === "clear" && formatOf(settings.format).key === "jpeg"
                ? { text: "JPEG has no transparency: what is clear comes out white.", actions: [{ label: "Lay it on a color", press: () => setLaid("color", "#ffffff") }, { label: "Use PNG", press: () => setSettings({ ...settings, format: "png" }) }] }
                : undefined,
    });
    /** New export settings: remembered in this browser for what comes next, and in a batch the picture's own. */
    function setSettings(next: Settings) {
        settings = next;
        keep(KEYS.export, JSON.stringify(next));
        const item = items[at];
        if (batched() && item) {
            item.export = next;
            session.changed();
        }
        void showExport();
        estimate.soon();
    }
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
        // the samples are drawn in the same space as the picture's numbers, so that a Display P3 picture's look as bright there as on the stage and in the export
        const sampleSpace = colors.space === "p3" && !converting() ? "display-p3" : "srgb";
        const part = new ImageData(side, side, { colorSpace: sampleSpace });
        for (let row = 0; row < side; row++) part.data.set(pixels.data.subarray(((at.y + row) * shown.width + at.x) * 4, ((at.y + row) * shown.width + at.x + side) * 4), row * side * 4);
        exporting.shows({ width: shown.width, height: shown.height, bytes: done.blob.size, label: formatOf(settings.format).label, over: done.over, quality: done.quality, original: part, exported: await createImageBitmap(done.blob).catch(() => undefined), at, originalBytes: now.original.bytes, space: sampleSpace });
    }
    const resizing = resizeBox({
        size: () => (picture ? look(picture) : { width: 1, height: 1 }),
        apply: (width, height) => {
            if (!picture) return;
            const now = look(picture);
            // made larger than the picture is, it is enlarged the way chosen: a model, or the filter
            const larger = width > now.crop.width || (height ?? 0) > now.crop.height;
            commit(setOnly(history.now(), { type: "resize", width, ...(height ? { height } : {}), filter: now.filter, ...(larger && enlargeWay ? { model: enlargeWay } : {}) }));
        },
        back: () => buttons.resize.focus({ preventScroll: true }),
        done: () => stage.element.focus({ preventScroll: true }),
        enlarge: {
            said: () => `enlarge: ${lowered(restoreModelOf(enlargeWay)?.name ?? "filter")}`,
            choose: (from) => void chooseEnlarge(from),
        },
        // in a batch, this picture's size given to the others
        give: {
            said: () => (batched() ? (giveSaid("resize") ?? "") : undefined),
            label: () => `give to the other ${items.length - 1}`,
            press: () => void giveAll(["resize"]),
        },
    });
    const strip = toolStrip({
        color: () => {
            const mark = pickedMark();
            return mark && "color" in mark ? mark.color : pen.color;
        },
        weight: () => pen.weight,
        setColor: (value) => {
            keepPen({ color: value });
            const mark = pickedMark();
            if (mark && "color" in mark) changeMark(mark.id, { color: value });
            refresh();
        },
        setWeight: (value) => {
            keepPen({ weight: value });
            const mark = pickedMark();
            if (mark && picture) {
                const sizes = sizesFor(pen, picture.original);
                // each kind's own size from the pen: a line's thickness, a text's size (its outline in step), a number's circle, a highlighter's stroke, a lens
                const sized: Partial<Mark> | undefined =
                    mark.type === "arrow" || mark.type === "box"
                        ? { thickness: sizes.line }
                        : mark.type === "text"
                          ? { size: sizes.text, ...(mark.outlineWidth ? { outlineWidth: Math.round(((mark.outlineWidth * sizes.text) / mark.size) * 2) / 2 } : {}) }
                          : mark.type === "number"
                            ? { size: sizes.number }
                            : mark.type === "highlight"
                              ? { thickness: sizes.highlight }
                              : mark.type === "magnifier"
                                ? { radius: sizes.lens }
                                : undefined;
                if (sized) changeMark(mark.id, sized);
            }
            refresh();
        },
        mark: () => markControls(),
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
        perspective: {
            vertical: () => perspectiveStep()?.vertical ?? 0,
            horizontal: () => perspectiveStep()?.horizontal ?? 0,
            live: (dials) => stage.keystone(dials),
            set: (dials) => keystoneTo(dials),
            cornering: () => stage.cornering(),
            setCornering: (on) => (stage.setCornering(on), refresh()),
            hasCorners: () => !!perspectiveStep()?.corners,
            auto: () => void autoStraighten(),
            setOpen: (on) => setStraightening(on),
        },
        read: () => {
            const found = reading.found();
            return { state: reading.state(), progress: reading.progress(), words: found ? found.lines.reduce((sum, line) => sum + line.words.length, 0) : 0, private: stage.findings().length, model: reading.tier().name };
        },
        hideAll: () => void stage.hideFindings(),
        chooseModel: (from) => reading.choose(from),
        readAgain: () => void reading.start(buttons.read),
        cut: () => cutStrip(),
        // a model running: how far, and Stop, which leaves the picture as it was
        busy: () => (running ? { said: running.share === undefined ? running.said : `${running.said} ${Math.round(running.share * 100)}%`, controls: [stripButton("stop", batchRunning ? "Stop: each picture is left done or as it was (Escape)" : "Stop, and leave the picture as it was (Escape)", () => running?.stop.abort())] } : undefined),
        grade: () => (asking ? { said: making === "find" ? findSaid() : asking.said, ...(making === "find" && finding.state() === "ready" ? { controls: [subjectButton, backgroundButton] } : {}), cancel: () => cancelPick() } : undefined),
    });
    /** The mark picked, if what is picked is a mark. */
    const pickedMark = (): (Kept & Mark) | undefined => {
        const step = history.now().find((each) => each.id === stage.picked());
        return step && isMark(step) ? step : undefined;
    };
    /** The numbered step picked, when its number was set by hand. */
    const numberSetByHand = () => {
        const mark = pickedMark();
        return mark?.type === "number" && mark.value !== undefined ? mark : undefined;
    };
    /** The numbered step picked counted in order again, its number set by hand let go. */
    const numberInOrder = () => {
        const mark = numberSetByHand();
        if (mark) changeMark(mark.id, { value: undefined });
    };
    /** Changes one mark, as one undo. */
    const changeMark = (id: string, to: Partial<Mark>) => commit(history.now().map((step) => (step.id === id ? ({ ...step, ...to } as Kept) : step)));
    /** The kind of mark the strip is for: the one picked, else the tool's. */
    const markKind = (): MarkKind | undefined => pickedMark()?.type ?? ((MARK_KINDS as string[]).includes(stage.tool()) ? (stage.tool() as MarkKind) : undefined);
    /** A button of the strip for a mark, pressed when it is what the mark has. */
    const markButton = (label: string, content: string | Node, on: boolean, press: () => void) => {
        const button = control(label, typeof content === "string" ? icon(content) : content, () => (press(), refresh()));
        button.classList.toggle("pressed", on);
        return button;
    };
    /** A word button of the strip for a mark, pressed when it is what the mark has. */
    const markWords = (label: string, tip: string, on: boolean, press: () => void) => {
        const button = stripButton(label, tip, () => (press(), refresh()));
        button.classList.toggle("pressed", on);
        return button;
    };
    // a numbered step's number, typed: kept with Enter or on leaving the field, which gives the keyboard back to the picture
    const numberField = make("input", "quire-img-strip-number");
    numberField.type = "text";
    numberField.inputMode = "numeric";
    numberField.setAttribute("aria-label", "Number");
    numberField.title = "Number";
    enterGivesBack(
        numberField,
        (value) => {
            const mark = pickedMark();
            const typed = Number.parseInt(value, 10);
            if (mark?.type !== "number") return;
            if (!/^\d+$/.test(value)) return refresh();
            changeMark(mark.id, { value: Math.min(MOST_NUMBER, typed) });
        },
        () => {
            stage.element.focus({ preventScroll: true });
            refresh();
        },
    );
    // left by a press elsewhere, the strip is filled again too, as it was not while the field had the keyboard
    numberField.addEventListener("blur", () => queueMicrotask(refresh));
    // a text's outline: none, or a color and a width, from a small menu grown from its button
    const outlineMenu = flowMenu("Outline", { className: "quire-img-outline-menu" });
    const outlineLines = (): MenuItem[] => {
        const mark = pickedMark();
        const color = mark?.type === "text" ? mark.outline : pen.outline;
        const share = mark?.type === "text" && mark.outlineWidth ? mark.outlineWidth / mark.size : (pen.outlineWeight ?? PEN.outlineWeight);
        const set = (next: { outline?: string; outlineWeight?: number }) => {
            keepPen(next);
            const now = pickedMark();
            if (now?.type === "text" && picture) {
                const outline = "outline" in next ? next.outline : now.outline;
                const width = Math.max(1, Math.round(now.size * (next.outlineWeight ?? (now.outlineWidth ? now.outlineWidth / now.size : (pen.outlineWeight ?? PEN.outlineWeight))) * 2) / 2);
                commit(history.now().map((step) => (step.id !== now.id ? step : ({ ...step, outline: undefined, outlineWidth: undefined, ...(outline ? { outline, outlineWidth: width } : {}) } as Kept))));
            }
            refresh();
        };
        const swatchOf = (value: string) => {
            const mark = make("span", "quire-img-swatch");
            mark.style.background = value;
            return mark;
        };
        return ruled(
            [{ label: "No outline", icon: "close", group: "outline", pressed: !color, run: () => set({ outline: undefined }) }, ...COLORS.map((each): MenuItem => ({ label: each.name, icon: swatchOf(each.value), group: "outline", pressed: color === each.value, run: () => set({ outline: each.value }) }))],
            OUTLINES.map((each, at): MenuItem => {
                const line = icon("line");
                line.style.strokeWidth = String(1.2 + at * 1.4);
                return { label: each.name, icon: line, group: "outline-width", pressed: Math.abs(share - each.value) < 0.015, run: () => set({ outlineWeight: each.value }) };
            }),
        );
    };
    // made once, so that its menu keeps its place while the strip is filled again behind it
    const outlineButton: HTMLButtonElement = control("Outline", icon("outlined"), () => (outlineMenu.isOpen() ? outlineMenu.close() : openHolding(outlineMenu, outlineButton, outlineLines())));
    /** Moves a text's place so that its block stays where it is when its lines are aligned another way. */
    const realigned = (mark: Extract<Mark, { type: "text" }>, align: Align): Partial<Mark> => {
        const by = (alignShare(align) - alignShare(mark.align)) * textWidth(mark);
        const radians = ((mark.angle ?? 0) * Math.PI) / 180;
        return { at: { x: mark.at.x + by * Math.cos(radians), y: mark.at.y + by * Math.sin(radians) }, align: align === "left" ? undefined : align };
    };
    /** What the strip shows for the mark picked, or the mark tool in hand. */
    function markControls(): MarkControls {
        const kind = markKind();
        const mark = pickedMark();
        const lines = WEIGHTS.map((each) => `${each.name} line`);
        if (kind === "spotlight") {
            const round = mark?.type === "spotlight" ? !!mark.round : !!pen.round;
            const shade = (mark?.type === "spotlight" ? mark.dim : undefined) ?? pen.dim ?? PEN.dim;
            const setRound = (on: boolean) => {
                keepPen({ round: on || undefined });
                if (mark?.type === "spotlight") changeMark(mark.id, { round: on ? true : undefined });
            };
            // every spotlight shades alike, so the shade is changed for all of them at once
            const setShade = (value: number) => {
                keepPen({ dim: value });
                if (history.now().some((step) => step.type === "spotlight")) commit(history.now().map((step) => (step.type === "spotlight" ? ({ ...step, dim: value } as Kept) : step)));
            };
            const shadeSwatch = (value: number) => {
                const swatch = make("span", "quire-img-swatch quire-img-shade");
                swatch.style.setProperty("--shade", String(value));
                return swatch;
            };
            return {
                colors: false,
                extra: [
                    [markButton("Rectangle", "box", !round, () => setRound(false)), markButton("Ellipse", "ellipse", round, () => setRound(true))],
                    SHADES.map((each) => markButton(each.name, shadeSwatch(each.value), Math.abs(shade - each.value) < 0.01, () => setShade(each.value))),
                ],
            };
        }
        if (kind === "text") {
            const align = (mark?.type === "text" ? mark.align : pen.align) ?? "left";
            const outline = mark?.type === "text" ? mark.outline : pen.outline;
            const setAlign = (next: Align) => {
                keepPen({ align: next });
                if (mark?.type === "text") changeMark(mark.id, realigned(mark, next));
            };
            outlineButton.classList.toggle("pressed", !!outline);
            return {
                colors: true,
                weights: lines,
                extra: [[markButton("Align left", "left", align === "left", () => setAlign("left")), markButton("Align center", "center", align === "center", () => setAlign("center")), markButton("Align right", "right", align === "right", () => setAlign("right"))], [outlineButton]],
            };
        }
        if (kind === "number") {
            if (mark?.type !== "number") return { colors: true, weights: lines, extra: [] };
            numberField.value = String(numbersOf(history.now()).get(mark.id) ?? 1);
            return { colors: true, weights: lines, extra: [[numberField, ...(mark.value !== undefined ? [markWords("in order", "Number it in order again", false, () => numberInOrder())] : [])]] };
        }
        if (kind === "magnifier") {
            const zoom = (mark?.type === "magnifier" ? mark.zoom : pen.zoom) ?? PEN.zoom;
            const setZoom = (value: number) => {
                keepPen({ zoom: value });
                if (mark?.type === "magnifier") changeMark(mark.id, { zoom: value });
            };
            return { colors: true, weights: WEIGHTS.map((each) => `${each.name === "Thin" ? "Small" : each.name === "Thick" ? "Large" : each.name} lens`), extra: [ZOOM_STEPS.map((each) => markWords(`${each}×`, `Enlarge ${each} times`, zoom === each, () => setZoom(each)))] };
        }
        return { colors: true, weights: lines, extra: [] };
    }
    room.append(strip.strip);
    document.body.append(exporting.panel, resizing.box);
    const historyPanel = createHistoryPanel(
        {
            show(text, _older, into) {
                const version = readBatch(snapshotParts(text).markdown);
                // in a batch, the version of the picture on the stage
                const read = version && (version.pictures.find((each) => each.original.name === picture?.original.name) ?? (version.batch ? undefined : version.pictures[0]));
                const loaded = stage.loaded();
                if (!version || !read || !loaded) return void into.append(make("p", "quire-history-none", version ? "This picture is not in this version." : "This version cannot be shown."));
                // the version's steps drawn over the original, small enough for the panel
                const shown = look({ original: read.original, steps: read.steps });
                const width = Math.min(360, shown.width);
                const small = look({ original: read.original, steps: [...read.steps, { id: "s0", type: "resize", width, filter: "bilinear" }] });
                const canvas = make("canvas", "quire-img-version");
                into.append(canvas, make("p", "quire-history-when", `${version.batch ? `${picturesSaid(version.pictures.length)} · ` : ""}${shown.width} × ${shown.height} px · ${read.steps.length} ${read.steps.length === 1 ? "step" : "steps"}`));
                void loaded.flatten(small, undefined, gradingWith(small, colors.space, loaded.size), colors.space).then((pixels) => {
                    canvas.width = pixels.width;
                    canvas.height = pixels.height;
                    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
                });
            },
            restore(text) {
                const version = readBatch(snapshotParts(text).markdown);
                if (!version) return;
                // one picture's version is one step, as it always was; a batch's is put back whole, its pictures as they were then
                if (!version.batch && !batched()) return commit(version.pictures[0]!.steps);
                void open(snapshotParts(text).markdown).then(() => session.changed());
            },
            focus: () => stage.element.focus({ preventScroll: true }),
        },
        session.versions,
        session.historyKey,
        session.keeper as Parameters<typeof createHistoryPanel>[3],
    );

    // ---- a batch: its strip of small pictures under the picture, stepping through them, giving a change to all, and exporting all ----
    const thumbs = batchStrip({
        pick: (index, keyboard) => void stepTo(index, keyboard),
        menu: (index, x, y, keyboard) => openThumbMenu(index, x, y, keyboard),
        drop: (files, place) => void addPictures(files, place),
    });
    room.append(thumbs.element);
    /** The line under the picture with its size alone, while its weight is not known yet. */
    const sizeLine = (size: { width: number; height: number }) => `${batched() ? `${whichSaid(at, items.length)} · ` : ""}${size.width} × ${size.height} px`;
    /** The line under the picture: which of how many in a batch, then its size and the weight it will be given out at. */
    const factsLine = (size: { width: number; height: number }, bytes: number, format: string) => `${batched() ? `${whichSaid(at, items.length)} · ` : ""}${factsSaid(size, bytes, format)}`;
    /** A picture's small copy drawn as it looks, made again only when its steps changed. */
    function drawnOf(item: Item): StripItem["pixels"] {
        if (!item.smallPixels) return undefined;
        if (!item.drawn || item.drawnFor !== item.steps) {
            item.drawn = smallLook(item.smallPixels, item, "srgb");
            item.drawnFor = item.steps;
        }
        return item.drawn;
    }
    /** The strip shows the batch as it is, the picture on the stage marked; with one picture it shrinks away. */
    function fillStrip(from?: { x: number; y: number }) {
        room.classList.toggle("batched", batched());
        if (!batched()) return thumbs.fill([], 0);
        thumbs.fill(
            items.map((item, index) => ({ key: item.key, label: `${whichSaid(index, items.length)}, ${item.given ?? item.original.name.replace(/^pictures\//, "")}`, pixels: drawnOf(item) })),
            at,
            from,
        );
    }
    /** Every picture the store keeps with the document, read once for a run over the batch. */
    const storePictures = async (): Promise<Map<string, Blob>> => (where.store?.pictures && where.id ? where.store.pictures(where.id).catch(() => new Map<string, Blob>()) : new Map<string, Blob>());
    /** One of the document's pictures by its address, from the store's pictures read once, or asked for alone. */
    const pictureFrom = async (all: Map<string, Blob>, address: string) => all.get(address.replace(/^(\.\/)?pictures\//, "")) ?? (await originalOf(address).catch(() => undefined));
    /** Reads the batch's small copies, in turn, so the strip fills in; one with none is made from its original once and kept with the document. */
    async function readSmalls() {
        const token = loading;
        const all = await storePictures();
        for (const item of [...items]) {
            if (!items.includes(item) || item.smallPixels) continue;
            let small = item.small ? await pictureFrom(all, item.small) : undefined;
            if (!small) {
                const kept = await pictureFrom(all, item.original.name);
                small = kept && (await smallOf(kept).catch(() => undefined));
                if (small && where.store && where.id) {
                    item.small = await where.store.savePicture(where.id, small, smallName(item.original.name, small.type)).catch(() => undefined);
                    if (item.small) session.changed();
                }
            }
            item.smallPixels = small && (await pixelsOf(small).catch(() => undefined));
            if (token !== loading && !items.includes(item)) return;
            fillStrip();
        }
    }
    // which picture of each batch was on the stage, kept in this browser, so a batch opens again where it was left
    const AT_KEY = "quire-img-batch-at";
    const keptAt = (): number => {
        try {
            return Number((JSON.parse(local()?.getItem(AT_KEY) ?? "{}") as Record<string, number>)[where.id ?? ""] ?? 0) || 0;
        } catch {
            return 0;
        }
    };
    const keepAt = (index: number) => {
        if (!where.id) return;
        let kept: Record<string, number> = {};
        try {
            kept = JSON.parse(local()?.getItem(AT_KEY) ?? "{}");
        } catch {
            kept = {};
        }
        delete kept[where.id];
        // the fifty batches last opened
        const entries = [...Object.entries(kept), [where.id, index] as [string, number]].slice(-50);
        keep(AT_KEY, JSON.stringify(Object.fromEntries(entries)));
    };
    /** True while a model runs over the batch's pictures one after another, which stepping does not stop. */
    let batchRunning = false;
    /** Steps to another picture of the batch: the crop being dragged is applied first, so no change is lost, and the picture keeps its own undo. */
    async function stepTo(index: number, keyboard = false) {
        if (!batched() || index < 0 || index >= items.length || index === at) return;
        if ((running && !batchRunning) || cutBusy) return frame.status.say("Busy", "The model is still working on this picture: wait for it, or stop it, before stepping to another");
        if (stage.tool() === "crop") stage.applyCrop();
        const shown = showItem(index, { stepping: true });
        if (!keyboard) stage.element.focus({ preventScroll: true });
        await shown;
    }
    // the menu a right-click on a small picture opens
    const thumbMenu = flowMenu("Picture", { className: "quire-img-press-menu" });
    const thumbAnchor = make("span", "quire-anchor");
    thumbAnchor.setAttribute("aria-hidden", "true");
    function openThumbMenu(index: number, x: number, y: number, keyboard: boolean) {
        const item = items[index];
        Object.assign(thumbAnchor.style, { left: `${x}px`, top: `${y}px`, height: "0px" });
        if (!thumbAnchor.isConnected) document.body.append(thumbAnchor);
        const others = items.length - 1;
        const adding: MenuItem[] = [
            { label: "Add pictures", icon: "plus", key: "add-pictures", run: () => choosePictures() },
            { label: "Paste", icon: "paste", hint: "Ctrl+V", key: "paste-into", run: () => void pasteInto() },
        ];
        // pressed between the small pictures: only what adds to the batch
        const lines: MenuItem[] = !item ? adding : ruled(
            [
                { label: "Save this one", icon: "download", key: "save-one", run: () => void outOne(index, "save") },
                { label: "Copy this one", icon: "copy", key: "copy-one", run: () => void outOne(index, "copy") },
            ],
            [
                { label: `Give its changes to the other ${others}`, icon: "export", key: "give-all", disabled: !!running || !!exportRun, run: () => void giveAll(givables(item), index) },
                { label: changesSaid(item, settings), note: true, quiet: true, run: () => {} },
            ],
            adding,
            [{ label: "Take out of the batch", icon: "trash", key: "take-out", disabled: !!exportRun || batchRunning, run: () => void takeOut(index) }],
        );
        thumbMenu.open(thumbAnchor, lines, keyboard);
        if (!keyboard) thumbMenu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }
    /** Saves or copies one picture of the batch alone: it is stepped to first, so the press does what it does for the picture on the stage. */
    async function outOne(index: number, how: "save" | "copy") {
        if (index !== at) await stepTo(index);
        if (index !== at) return;
        await (how === "save" ? save() : copy());
    }
    /** Paste from the strip's menu: the clipboard's picture added to the batch. */
    async function pasteInto() {
        try {
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => each.startsWith("image/"));
                if (type) return void (await addPictures([new File([await item.getType(type)], "image.png", { type })]));
            }
            frame.status.say("Nothing to paste", "There is no picture on the clipboard");
        } catch {
            frame.status.say("Press Ctrl+V", "The browser lets a page paste only from the keys: press Ctrl+V");
        }
    }
    /** What Give to all will do, in a few plain words, for a kind of change the picture on the stage has: nothing when it has none, or the document is no batch. */
    function giveSaid(kind: Givable): string | undefined {
        if (!batched() || !picture) return undefined;
        const others = picturesSaid(items.length - 1);
        if (kind === "export") return `Give these settings, ${settingsSaid(settings)}, to the other ${others}`;
        if (!givables(picture).includes(kind)) return undefined;
        if (kind === "grade") return `Give this grade to the other ${others}; their crops, marks and hidden areas stay their own`;
        if (kind === "resize") return `Make the other ${others} ${resizeSaid(picture.steps)} too`;
        if (kind === "repair") return `Repair the other ${others} the same way, where each is a JPEG worth repairing`;
        return `Cut out the other ${others} the same way, one after another`;
    }
    /** Which of these pictures are JPEGs worth repairing, kept upright, read from the first part of each original. */
    async function whichRepairable(list: Item[], all: Map<string, Blob>): Promise<Set<Item>> {
        const found = new Set<Item>();
        for (const item of list) {
            if (item.original.type !== "image/jpeg") continue;
            const blob = await pictureFrom(all, item.original.name);
            const bytes = blob && new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
            const facts = bytes && factsOf(bytes);
            if (bytes && worthRepairing(jpegFacts(bytes)) && (!facts?.orientation || facts.orientation === 1)) found.add(item);
        }
        return found;
    }
    /**
     * A picture's changes of these kinds given to every other picture of the batch, as one undo step: its grade
     * and its resize put in place of theirs, its export settings given, its repair by hand put in where a picture
     * can be repaired; a repair by a model or a cut-out made for each picture in turn, with how far it has come and
     * Stop, which leaves each picture done or as it was. Crops, marks, covers and parts are never touched.
     */
    async function giveAll(kinds: Givable[], from = at) {
        const source = items[from];
        if (!batched() || !source || running || exportRun) return;
        if (stage.tool() === "crop") stage.applyCrop();
        keepCurrent();
        const group = ++groups;
        const others = items.filter((each) => each !== source);
        const shown = look(source);
        const quick = kinds.filter((kind) => kind === "grade" || kind === "resize" || kind === "export" || (kind === "repair" && !shown.repairModel));
        const slow = kinds.filter((kind) => kind === "cutout" || (kind === "repair" && !!shown.repairModel));
        // the originals are read only for what needs them: a repair (which must know which are JPEGs worth repairing) or a model
        const all = kinds.includes("repair") || slow.length ? await storePictures() : new Map<string, Blob>();
        const repairable = kinds.includes("repair") ? await whichRepairable(others, all) : new Set<Item>();
        const settingsSet = new Map<Item, { before?: Settings; after?: Settings }>();
        groupSettings.set(group, settingsSet);
        // the picture it came from holds the group too, so that undo there takes back what was given
        source.history.set([...source.history.now()], group);
        source.steps = source.history.now();
        for (const item of others) {
            let next = item.history.now();
            for (const kind of quick) {
                if (kind === "grade" || kind === "resize") next = giveStep(next, source.steps, kind);
                if (kind === "repair" && repairable.has(item)) next = giveRepair(next);
            }
            if (quick.includes("export")) {
                settingsSet.set(item, { before: item.export, after: source.export ?? settings });
                item.export = source.export ?? settings;
            }
            item.history.set(next === item.history.now() ? [...next] : next, group);
            item.steps = item.history.now();
        }
        changed();
        if (exporting.isOpen()) void showExport();
        const words = kinds.map((kind) => (kind === "grade" ? "the grade" : kind === "resize" ? resizeSaid(source.steps) : kind === "repair" ? "the repair" : kind === "cutout" ? "the cut-out" : "the export settings")).join(", ");
        if (!slow.length) return frame.status.say("Given to all", `Given to the other ${picturesSaid(others.length)}: ${words}`);
        await giveByModel(slow, source, others, group, repairable, all);
    }
    /** A repair by a model, or a cut-out, made for each of the other pictures in turn: each done joins the group as it is done, and Stop leaves the rest as they were. */
    async function giveByModel(kinds: Givable[], source: Item, others: Item[], group: number, repairable: Set<Item>, all: Map<string, Blob>) {
        const shown = look(source);
        const cutting = kinds.includes("cutout") && shown.cutout;
        const repairing = kinds.includes("repair") && shown.repairModel ? restoreModelOf(shown.repairModel) : undefined;
        if (cutting && !(await cutAsking.ready(buttons.cutout))) return refresh();
        if (repairing && !(await repairAsking.have(repairing.id))) return frame.status.say("Not repaired", `The ${repairing.name} model is not on this device: repair this picture with it first`, "warn");
        const stop = new AbortController();
        const doing = cutting ? "Cutting out" : "Repairing";
        running = { said: doing, stop };
        batchRunning = true;
        let done = 0;
        const failed: string[] = [];
        const raw = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
        try {
            for (const [index, item] of others.entries()) {
                if (stop.signal.aborted) break;
                // a repair says how far through this picture it is; a cut-out, which says nothing as it runs, only which of how many
                running.said = `${doing} ${index + 1} of ${others.length}${repairing ? "," : ""}`;
                running.share = repairing ? 0 : undefined;
                refresh();
                try {
                    const blob = await pictureFrom(all, item.original.name);
                    if (!blob) throw new Error("its original is missing");
                    const source = await displayable(blob);
                    let next = item.history.now();
                    if (repairing && repairable.has(item)) {
                        const first = await createImageBitmap(source, raw);
                        const size = { width: first.width, height: first.height };
                        const bytes = new Uint8Array(await blob.arrayBuffer());
                        const result = new ImageData(size.width * repairing.scale, size.height * repairing.scale);
                        let given: ImageBitmap | undefined = first;
                        await restorer.run(repairing.id, async () => given ?? createImageBitmap(source, raw), {
                            signal: stop.signal,
                            ...(jpegFacts(bytes)?.quality ? { quality: jpegFacts(bytes)!.quality } : {}),
                            progress: (share) => {
                                if (running) running.share = share;
                                refresh();
                            },
                            keep: (out, part) => {
                                given = undefined;
                                for (let row = 0; row < out.height; row++) result.data.set(part.data.subarray(row * out.width * 4, (row + 1) * out.width * 4), ((out.y + row) * result.width + out.x) * 4);
                            },
                        });
                        const lossless = await formatOf("webp-lossless").encode(result, 1).catch(() => undefined);
                        const kept = lossless ?? (await (() => {
                            const canvas = new OffscreenCanvas(result.width, result.height);
                            canvas.getContext("2d")!.putImageData(result, 0, 0);
                            return canvas.convertToBlob({ type: "image/png" });
                        })());
                        const stem = item.original.name.replace(/^pictures\//, "").replace(/\.[^.]*$/, "").replace(/[^\w.-]+/g, "-") || "picture";
                        const made = where.store && where.id ? await where.store.savePicture(where.id, kept, `${stem}-repaired-${repairing.id}${lossless ? ".webp" : ".png"}`).catch(() => undefined) : undefined;
                        if (made) madeKept.set(made, kept);
                        next = setOnly(next, { type: "repair", model: repairing.id, ...(made ? { made } : {}) });
                    }
                    if (cutting) {
                        const answer = await findCut(sharedFinder, cutAsking.tier().id, () => createImageBitmap(source, raw), CUT_SIDE);
                        next = setOnly(next, { type: "cutout", found: answer.found, background: cutting.background, ...(cutting.color ? { color: cutting.color } : {}) });
                    }
                    // stopped while it worked: this picture is left as it was
                    if (stop.signal.aborted) break;
                    if (next !== item.history.now()) {
                        item.history.set(next, group);
                        item.steps = item.history.now();
                        if (item === items[at]) changed();
                        else fillStrip();
                    }
                    done++;
                } catch (error) {
                    if (stop.signal.aborted) break;
                    failed.push(`${item.given ?? item.original.name}: ${error instanceof Error ? error.message : String(error)}`);
                }
                session.changed();
            }
        } finally {
            running = undefined;
            batchRunning = false;
            refresh();
        }
        const did = cutting ? "Cut out" : "Repaired";
        if (stop.signal.aborted) frame.status.say("Stopped", `Stopped: ${did.toLowerCase()} ${done} of ${picturesSaid(others.length)}; the rest are as they were`, "quiet");
        else if (failed.length) frame.status.say(`${did} ${done}`, `${did} ${done} of ${picturesSaid(others.length)}; not done: ${failed.join("; ")}`, "warn");
        else frame.status.say(did, `${did} the other ${picturesSaid(others.length)} the same way`);
    }
    /** A run of Export all: how many are done of how many, and its stop. */
    let exportRun: { done: number; count: number; stop: AbortController; where: string } | undefined;
    const pickers = globalThis as unknown as { showDirectoryPicker?: (options: object) => Promise<FolderHandle>; showSaveFilePicker?: (options: object) => Promise<{ name: string; createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }> }> };
    /**
     * Every picture of the batch written out, each with its own export settings and under its own name with the
     * format's ending: into one zip written as it goes (into a file chosen with the save picker where the browser
     * has one, else handed over when done), or straight into a folder chosen, never over a file there. A few at a
     * time, each decoded only while it is made; Stop keeps what was written.
     */
    async function exportAll(how: "zip" | "folder") {
        if (!batched() || exportRun || batchRunning) return;
        if (stage.tool() === "crop") stage.applyCrop();
        keepCurrent();
        const zipName = `${exportName(where.name, { ending: ".zip" } as ReturnType<typeof formatOf>)}`;
        let out: Destination;
        let place: string;
        try {
            if (how === "folder") {
                const handle = await pickers.showDirectoryPicker?.({ mode: "readwrite", id: "quire-img-export" });
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
            // the picker closed with nothing chosen
            return;
        }
        const list = [...items];
        const names = namesFor(
            list.map((item) => item.given ?? item.original.name.replace(/^pictures\//, "")),
            list.map((item) => formatOf((item.export ?? settings).format).ending),
            await out.taken().catch(() => []),
        );
        const stop = new AbortController();
        exportRun = { done: 0, count: list.length, stop, where: place };
        if (exporting.isOpen()) exporting.fill();
        refresh();
        const started = performance.now();
        const all = await storePictures();
        const backend = await backendFor(new OffscreenCanvas(1, 1)).catch(() => undefined);
        // one picture on the card at a time; the encoding, which takes longest, runs a few at once in workers of its own
        let card: Promise<unknown> = Promise.resolve();
        const ran = await runEach(
            list.length,
            async (index) => {
                const item = list[index]!;
                if (!backend) throw new Error("this browser cannot draw the pictures");
                const blob = await pictureFrom(all, item.original.name);
                if (!blob) throw new Error("its original is missing");
                const read = await readOriginal(blob);
                const itemSettings = item.export ?? settings;
                const made = await writeOut({
                    picture: item,
                    bytes: read.bytes,
                    ...(read.profile ? { profile: read.profile } : {}),
                    space: read.space.space,
                    settings: itemSettings,
                    keeping,
                    flatten: async (convert) => {
                        const source = await displayable(blob);
                        const shown = look(item);
                        const kept = shown.repairModel && shown.repairMade ? (madeKept.get(shown.repairMade) ?? (await pictureFrom(all, shown.repairMade))) : undefined;
                        const job = card.then(() => flattenAway({ backend, picture: item, source, bytes: read.bytes, repairable: read.repairable, space: read.space.space, convert, ...(kept ? { made: kept } : {}), repair: (bytes, pixels) => repairer.run(bytes, pixels), enlarge: (each, flat) => enlargeAway(each, flat, stop.signal) }));
                        card = job.catch(() => undefined);
                        return job;
                    },
                });
                return made.blob;
            },
            async (index, blob) => void (await out.write(names[index]!, blob)),
            {
                atOnce: atOnce(),
                signal: stop.signal,
                progress: (done) => {
                    if (!exportRun) return;
                    exportRun.done = done;
                    if (exporting.isOpen()) exporting.fill();
                    frame.status.say("Saving", `Saving ${done} of ${list.length}`, "quiet", true);
                },
            },
        );
        let zip: Blob | undefined;
        try {
            zip = await out.finish();
        } catch (error) {
            await out.abort();
            frame.status.say("Not saved", `The pictures could not be written: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
        exportRun = undefined;
        if (zip) give(zip, zipName);
        if (exporting.isOpen()) exporting.fill();
        refresh();
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        const failed = ran.failed.map(({ at: index, error }) => `${names[index]}: ${error instanceof Error ? error.message : String(error)}`);
        if (ran.stopped) frame.status.say("Stopped", `Stopped: ${picturesSaid(ran.done)} of ${list.length} written to ${place}`, "quiet");
        else if (failed.length) frame.status.say(`Saved ${ran.done}`, `${picturesSaid(ran.done)} of ${list.length} written to ${place}; not made: ${failed.join("; ")}`, "warn");
        else frame.status.say("Saved", `${picturesSaid(ran.done)} written to ${place} in ${seconds} s`);
    }
    /** A picture of the batch enlarged by its resize's model away from the stage, as the stage's own picture is: the model's answer at the asked size, or nothing to use the filter. */
    async function enlargeAway(shown: ReturnType<typeof look>, flat: (each: ReturnType<typeof look>) => Promise<ImageData>, signal: AbortSignal): Promise<ImageData | undefined> {
        const model = restoreModelOf(shown.enlarge);
        if (!model) return undefined;
        const { enlarge: _enlarge, ...rest } = shown;
        const base = { ...rest, width: shown.crop.width, height: shown.crop.height, marks: [] };
        const passes = Math.max(shown.width / base.width, shown.height / base.height) > model.scale ? 2 : 1;
        if (!enlargedSize(base, { scale: model.scale ** passes })) return undefined;
        let pixels = await flat(base);
        for (let pass = 0; pass < passes; pass++) {
            const from = pixels;
            const result = new ImageData(from.width * model.scale, from.height * model.scale);
            await restorer.run(model.id, () => createImageBitmap(from, { colorSpaceConversion: "none", premultiplyAlpha: "none" }), {
                signal,
                progress: () => {},
                keep: (out, part) => {
                    for (let row = 0; row < out.height; row++) result.data.set(part.data.subarray(row * out.width * 4, (row + 1) * out.width * 4), ((out.y + row) * result.width + out.x) * 4);
                },
            });
            pixels = result;
        }
        return sizedTo(pixels, shown.width, shown.height);
    }

    // ---- the cut-out, as a tool: the same piece as the page at /cutout/, its result a step ----
    // the picture as it came (shown through a PNG for a HEIC), and the cut-out's pixels put on the stage in its place
    let shownSource: Blob | undefined;
    let cutKey = "";
    // the cut-out as it was last put on the stage, and whether this picture has had its first look yet (a document that opens with a
    // cut-out shows it at once; only a change made while it is open fades)
    let cutShown: ReturnType<typeof look>["cutout"];
    let cutOpened = false;
    let cutBrush: "keep" | "remove" | undefined;
    let cutBusy = false;
    // true when the model found nothing in the picture shown: a press on the thing wanted is then the way to cut it out
    let cutNothing = false;
    const cutAsking = createAsking({ finder: () => sharedFinder, returnTo: () => buttons.cutout, moved: () => refresh() });
    /** The original as a bitmap, its numbers as they are (repaired, when that step is on), for the models and for cutting out. */
    const sourceBitmap = async () => {
        const base = await baseSource();
        return base ? createImageBitmap(base, { colorSpaceConversion: "none", premultiplyAlpha: "none" }) : undefined;
    };
    // ---- repairing a JPEG: the original's pixels with its blocks and ringing taken out (deblock.ts), in a worker ----
    const repairer = createRepair();
    let originalBytes: Uint8Array | undefined;
    let repairable = false;
    let repaired: Promise<ImageBitmap | undefined> | undefined;
    /** The pixels the steps start from: the picture as it came, or with its JPEG repaired when that step is on, worked out once for each picture. */
    async function baseSource(): Promise<Blob | ImageBitmap | undefined> {
        if (!shownSource || !picture || !look(picture).repair || !repairable || !originalBytes) return shownSource;
        const shown = look(picture);
        if (shown.repairModel) {
            // a model's repair, kept in the document beside the original: read, never made again
            const made = shown.repairMade ? (madeKept.get(shown.repairMade) ?? (await originalOf(shown.repairMade).catch(() => undefined))) : undefined;
            if (made) {
                madeKept.set(shown.repairMade!, made);
                return made;
            }
            frame.status.say("Repaired by hand", "The model's repair was not found with the document, so the instant repair is shown", "warn");
        }
        repaired ??= repairNow(shownSource, originalBytes);
        return (await repaired) ?? shownSource;
    }
    async function repairNow(source: Blob, bytes: Uint8Array): Promise<ImageBitmap | undefined> {
        const token = loading;
        const bitmap = await createImageBitmap(source, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const drawing = canvas.getContext("2d")!;
        drawing.drawImage(bitmap, 0, 0);
        bitmap.close();
        frame.status.say("Repairing", "Taking the JPEG's blocks and ringing out");
        const started = performance.now();
        const made = await repairer.run(bytes, drawing.getImageData(0, 0, canvas.width, canvas.height)).catch(() => undefined);
        if (token !== loading) return undefined;
        if (!made) {
            frame.status.say("Not repaired", "This JPEG could not be repaired", "warn");
            return undefined;
        }
        frame.status.say("Repaired", `The JPEG's blocks and ringing taken out in ${((performance.now() - started) / 1000).toFixed(1)} s`);
        return createImageBitmap(made, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    }
    /** Repairs the JPEG the way last chosen (the instant way unless a model was), or stops repairing it, as one step. */
    async function toggleRepair() {
        if (!picture || !repairable || running) return;
        if (look(picture).repair) return commit(history.now().filter((step) => step.type !== "repair"));
        const way = await repairAsking.way();
        if (way && (await repairAsking.have(way))) return void repairWith(way);
        commit(setOnly(history.now(), { type: "repair" }));
    }
    /** The ways of repairing as cards, the model chosen fetched when told, and the picture repaired that way. */
    async function chooseRepair(from?: HTMLElement) {
        if (!picture || !repairable || running) return;
        const way = await repairAsking.choose(from, look(picture).repairModel ?? undefined);
        if (way === undefined || !picture) return;
        if (way === "") return commit(setOnly(history.now(), { type: "repair" }));
        if (look(picture).repairModel === way && look(picture).repairMade) return;
        void repairWith(way);
    }

    // ---- restoring with a model: a JPEG repaired, a picture enlarged (restore/), in a worker of their own ----
    const restorer = createRestorer();
    const repairAsking = createRestoreAsking({ restorer: () => restorer, returnTo: () => stage.element, job: "repair", moved: () => refresh(), quality: () => (originalBytes ? jpegFacts(originalBytes)?.quality : undefined) });
    const enlargeAsking = createRestoreAsking({ restorer: () => restorer, returnTo: () => buttons.resize, job: "enlarge", moved: () => refresh() });
    void enlargeAsking.way().then((way) => (enlargeWay = way ?? ""));
    // one run at a time, since the worker holds one model
    let queue: Promise<unknown> = Promise.resolve();
    /** A model run over a picture tile by tile, the strip saying how far with Stop; each finished tile laid into pixels of the result's size, the only whole copy of it. */
    function runModel(id: string, said: string, bitmap: () => Promise<ImageBitmap>, size: { width: number; height: number }, quality?: number): Promise<ImageData> {
        const job = queue.then(async () => {
            const model = restoreModelOf(id);
            if (!model) throw new Error("that model is not offered");
            const result = new ImageData(size.width * model.scale, size.height * model.scale);
            const stop = new AbortController();
            running = { said, share: 0, stop };
            refresh();
            let told = 0;
            try {
                await restorer.run(id, bitmap, {
                    signal: stop.signal,
                    ...(quality ? { quality } : {}),
                    progress: (share) => {
                        if (!running) return;
                        running.share = share;
                        // the strip is filled again at most once a hundredth
                        if (share - told >= 0.01 || share === 1) ((told = share), refresh());
                    },
                    keep: (out, part) => {
                        for (let row = 0; row < out.height; row++) result.data.set(part.data.subarray(row * out.width * 4, (row + 1) * out.width * 4), ((out.y + row) * result.width + out.x) * 4);
                    },
                });
                return result;
            } finally {
                running = undefined;
                refresh();
            }
        });
        queue = job.catch(() => undefined);
        return job;
    }
    /** What a run that did not finish says: stopped by her, or why it failed, and that the picture is as it was. */
    const notFinished = (error: unknown, what: string) => {
        const stopped = error instanceof Error && error.name === "AbortError";
        frame.status.say(stopped ? "Stopped" : `Not ${what}`, stopped ? `Stopped; the picture is as it was` : `The model did not finish: ${error instanceof Error ? error.message : String(error)}. The picture is as it was`, stopped ? "quiet" : "warn");
    };
    // the model's repairs made while the document is open, by where each is kept in it
    const madeKept = new Map<string, Blob>();
    /** The JPEG repaired by a model: run over the original tile by tile, its result kept in the document beside the original (a PNG, lossless) and the repair step pointing at it. */
    async function repairWith(id: string) {
        const model = restoreModelOf(id);
        if (!model || !picture || !repairable || !shownSource || !originalBytes || running) return;
        const token = loading;
        const now = picture;
        const source = shownSource;
        const started = performance.now();
        try {
            const first = await createImageBitmap(source, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
            const size = { width: first.width, height: first.height };
            let given: ImageBitmap | undefined = first;
            const bitmap = async () => {
                const made = given ?? (await createImageBitmap(source, { colorSpaceConversion: "none", premultiplyAlpha: "none" }));
                given = undefined;
                return made;
            };
            const result = await runModel(id, "Repairing", bitmap, size, jpegFacts(originalBytes)?.quality);
            if (token !== loading) return;
            // kept losslessly, so the document holds exactly what the model made: as WebP lossless, under half a PNG's weight
            // on photographs, or as a PNG where that encoder cannot be had
            frame.status.say("Keeping", "Keeping the repair with the document");
            const lossless = await formatOf("webp-lossless").encode(result, 1).catch(() => undefined);
            const blob = lossless ?? (await (() => {
                const canvas = new OffscreenCanvas(result.width, result.height);
                canvas.getContext("2d")!.putImageData(result, 0, 0);
                return canvas.convertToBlob({ type: "image/png" });
            })());
            const stem = now.original.name.replace(/^pictures\//, "").replace(/\.[^.]*$/, "").replace(/[^\w.-]+/g, "-") || "picture";
            const made = where.store && where.id ? await where.store.savePicture(where.id, blob, `${stem}-repaired-${id}${lossless ? ".webp" : ".png"}`).catch(() => undefined) : undefined;
            if (token !== loading) return;
            if (made) madeKept.set(made, blob);
            commit(setOnly(history.now(), { type: "repair", model: id, ...(made ? { made } : {}) }));
            frame.status.say("Repaired", `Repaired with the ${model.name} model in ${((performance.now() - started) / 1000).toFixed(1)} s${made ? "" : "; it could not be kept with the document"}`);
        } catch (error) {
            if (token === loading) notFinished(error, "repaired");
        }
    }
    const enlarged: { key?: string; done?: Promise<ImageData | undefined> } = {};
    /**
     * The picture enlarged by the resize's model, at the look's size: the picture as it looks before the resize
     * flattened at its own size with no marks, run through the model, and made the asked size if that is not the
     * model's own. Worked out once for each look before it and kept while the document is open (never in it). With
     * no such model, a result past what may be made, or a run stopped or failed, undefined: the filter is used.
     */
    function enlargedFor(shown: ReturnType<typeof look>, srgb: boolean): Promise<ImageData | undefined> {
        const loaded = stage.loaded();
        const model = restoreModelOf(shown.enlarge);
        if (!loaded || !model) return Promise.resolve(undefined);
        const { enlarge: _enlarge, ...rest } = shown;
        const base = { ...rest, width: shown.crop.width, height: shown.crop.height, marks: [] };
        // a model of twice as large is run a second time over its own result for more than twice
        const passes = Math.max(shown.width / base.width, shown.height / base.height) > model.scale ? 2 : 1;
        const scale = model.scale ** passes;
        if (!enlargedSize(base, { scale })) {
            frame.status.say("Not enlarged", `Too large to enlarge with a model: it would be ${base.width * scale} by ${base.height * scale}. The resize filter is used`, "warn");
            return Promise.resolve(undefined);
        }
        const key = `${JSON.stringify(base)} ${model.id} ${passes} ${srgb} ${colors.space}`;
        if (enlarged.key !== key || !enlarged.done) {
            enlarged.key = key;
            enlarged.done = (async () => {
                const started = performance.now();
                const pixels = await loaded.flatten(base, undefined, gradingWith(base, colors.space, loaded.size, srgb && colors.space === "p3"), colors.space);
                try {
                    let big = await runModel(model.id, passes === 2 ? "Enlarging, twice as large first," : "Enlarging", () => createImageBitmap(pixels, { colorSpaceConversion: "none", premultiplyAlpha: "none" }), pixels);
                    if (passes === 2) {
                        const half = big;
                        big = await runModel(model.id, "Enlarging, then twice again,", () => createImageBitmap(half, { colorSpaceConversion: "none", premultiplyAlpha: "none" }), half);
                    }
                    frame.status.say("Enlarged", `Enlarged with the ${model.name} model in ${((performance.now() - started) / 1000).toFixed(1)} s`);
                    return big;
                } catch (error) {
                    notFinished(error, "enlarged");
                    // not kept: the next export tries again
                    enlarged.key = undefined;
                    queueMicrotask(() => (exportCache.key = undefined));
                    return undefined;
                }
            })();
        }
        return enlarged.done.then((big) => big && sizedTo(big, shown.width, shown.height));
    }
    /** Pixels made another size by the browser's best resampling, or as they are when already that size. */
    async function sizedTo(pixels: ImageData, width: number, height: number): Promise<ImageData> {
        if (pixels.width === width && pixels.height === height) return pixels;
        const made = await createImageBitmap(pixels, { resizeWidth: width, resizeHeight: height, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d")!;
        context.drawImage(made, 0, 0);
        made.close();
        return context.getImageData(0, 0, width, height);
    }
    /** The resize's way of enlarging chosen in the dialog, and the resize there is changed to it. */
    async function chooseEnlarge(from: HTMLElement) {
        const way = await enlargeAsking.choose(from, enlargeWay);
        if (way === undefined) return;
        enlargeWay = way;
        resizing.sayWay();
        const step = history.now().find((each) => each.type === "resize");
        if (step?.type === "resize" && picture) {
            const { model: _model, ...plain } = step;
            commit(history.now().map((each) => (each === step ? { ...plain, ...(way ? { model: way } : {}) } : each)));
        }
    }
    /** After the steps change: the cut-out made again when it changed (or the repair), and put on the stage in place of the original (or the original back). */
    async function showCut() {
        const cut = picture ? look(picture).cutout : undefined;
        const key = (cut ? JSON.stringify(cut) : "") + (picture && look(picture).repair && repairable ? ` repaired ${look(picture).repairModel ?? ""} ${look(picture).repairMade ?? ""}` : "");
        const first = !cutOpened;
        cutOpened = true;
        if (key === cutKey || !shownSource) return;
        // what was shown fades out over what now is when a cut-out comes, goes, is cut again or laid on another ground, so a background
        // is seen to go; a stroke of the brush alone is drawn at once, as it is painted
        const apart = (each: typeof cut) => (each ? JSON.stringify({ ...each, strokes: undefined }) : "");
        const fade = !first && apart(cut) !== apart(cutShown);
        cutKey = key;
        cutShown = cut;
        if (!cut) {
            const base = await baseSource();
            if (base && key === cutKey) await stage.swap(base, fade);
            estimate.soon();
            return;
        }
        const source = await sourceBitmap();
        if (!source) return;
        const made = await cutOut(source, cut);
        source.close();
        if (!made || key !== cutKey) return;
        await stage.swap(await createImageBitmap(made, { premultiplyAlpha: "none", colorSpaceConversion: "none" }), fade);
        estimate.soon();
    }
    /** The model run on the picture, its mask the cut-out step, laid on nothing to start. */
    async function startCut() {
        if (!picture || cutBusy || !(await cutAsking.ready(buttons.cutout))) return refresh();
        cutBusy = true;
        refresh();
        try {
            const started = performance.now();
            const answer = await findCut(sharedFinder, cutAsking.tier().id, async () => (await sourceBitmap())!, CUT_SIDE);
            commit(setOnly(history.now(), { type: "cutout", found: answer.found, background: "clear" }));
            frame.status.say("Cut out", `Cut out in ${((performance.now() - started) / 1000).toFixed(1)} s with ${cutAsking.tier().name}`);
        } catch (error) {
            const said = error instanceof Error ? error.message : String(error);
            // a model that found nothing leaves the picture as it was, and says so with the next step: a press on the thing wanted
            cutNothing = said === FOUND_NOTHING;
            if (cutNothing) frame.status.say("Nothing found", NOTHING_SAID.replace(/\.$/, ""), "warn");
            else frame.status.say("Not cut out", `The picture was not cut out: ${said}`, "warn");
        } finally {
            cutBusy = false;
            refresh();
        }
    }
    /** Changes the cut-out step, as one undo. */
    function changeCut(to: (cut: Cut) => Cut) {
        const step = history.now().find((each) => each.type === "cutout");
        if (!step || step.type !== "cutout") return;
        const { id: _id, off: _off, type: _type, ...cut } = step;
        commit(history.now().map((each) => (each === step ? ({ ...to(cut as Cut), type: "cutout", id: step.id } as Kept) : each)));
    }
    /**
     * A press on the picture with the cut-out tool. With a cut-out the model found, it keeps the thing pressed: the press model outlines
     * it, and only what the cut-out found inside it stays. Where the model found nothing, what is pressed is the cut-out itself, and each
     * press after adds to it (the page at /cutout/ does the same).
     */
    async function pickSubject(at: { x: number; y: number }) {
        const cut = picture ? look(picture).cutout : undefined;
        if (!picture || (!cut && !cutNothing) || cutBusy || !(await cutAsking.picking(stage.element))) return;
        cutBusy = true;
        refresh();
        try {
            const press = { x: Math.round(at.x), y: Math.round(at.y), add: true };
            const key = `cut ${where.id ?? ""} ${picture.original.name}`;
            if (!cut || cut.presses) {
                const presses = [...(cut?.presses ?? []), press];
                const answer = await sharedFinder.select(PART_TIERS[0]!.id, key, await sourceBitmap(), presses);
                if (blank(answer.found)) frame.status.say("Nothing found", NOTHING_SAID.replace(/\.$/, ""), "warn");
                else if (cut) changeCut((was) => ({ ...was, found: answer.found, presses }));
                else {
                    cutNothing = false;
                    commit(setOnly(history.now(), { type: "cutout", found: answer.found, presses, background: "clear" }));
                }
            } else {
                const answer = await sharedFinder.select(PART_TIERS[0]!.id, key, await sourceBitmap(), [press]);
                changeCut((was) => ({ ...was, pick: answer.found }));
            }
        } catch (error) {
            frame.status.say("Not chosen", `The thing pressed was not found: ${error instanceof Error ? error.message : String(error)}`, "warn");
        } finally {
            cutBusy = false;
            refresh();
        }
    }
    const setLaid = (laid: Laid, color?: string) => changeCut((cut) => ({ ...cut, background: laid, ...(laid === "color" ? { color: color ?? cut.color ?? "#ffffff" } : { color: undefined }) }));
    /** The strip while cutting out: what it is laid on, the brush, the quality, and taking the cut-out away. */
    function cutStrip(): { said: string; controls: HTMLElement[] } {
        const cut = picture ? look(picture).cutout : undefined;
        if (cutBusy) return { said: cutAsking.tier().wait ? `Cutting out, usually ${cutAsking.tier().wait}` : "Cutting out", controls: [] };
        // where the model found nothing, the strip says the next step in the status's own words
        if (!cut) return { said: cutNothing ? NOTHING_SAID.slice(NOTHING_SAID.indexOf("Press")).replace(/\.$/, "") : "Not cut out", controls: [stripButton("cut out", "Run the model again", () => void startCut())] };
        const pressed = (button: HTMLElement, on: boolean) => (button.classList.toggle("pressed", on), button);
        const swatches = COLORS.map((each) => {
            const mark = make("span", "quire-img-swatch");
            mark.style.background = each.value;
            return pressed(control(each.name, mark, () => setLaid("color", each.value)), cut.background === "color" && cut.color === each.value);
        });
        return {
            said: cutBrush === "keep" ? "Paint what should stay" : cutBrush === "remove" ? "Paint what should go" : "Press a thing to keep it",
            controls: [
                pressed(stripButton("clear", "Nothing behind it, exported with transparency", () => setLaid("clear")), cut.background === "clear"),
                ...swatches,
                pressed(stripButton("blur", "The old background behind it, blurred", () => setLaid("blur")), cut.background === "blur"),
                make("span", "quire-img-strip-rule"),
                pressed(stripButton("keep", "Paint what should stay", () => ((cutBrush = cutBrush === "keep" ? undefined : "keep"), refresh())), cutBrush === "keep"),
                pressed(stripButton("remove", "Paint what should go", () => ((cutBrush = cutBrush === "remove" ? undefined : "remove"), refresh())), cutBrush === "remove"),
                make("span", "quire-img-strip-rule"),
                stripButton(lowered(cutAsking.tier().name), "Quality", () => void cutAsking.choose(buttons.cutout).then((chosen) => void (chosen && startCut()))),
                stripButton("take away", "Bring the background back", () => commit(history.now().filter((each) => each.type !== "cutout"))),
                // in a batch, the others cut out the same way, one after another
                ...(batched() ? [make("span", "quire-img-strip-rule"), stripButton(`give to the other ${items.length - 1}`, giveSaid("cutout") ?? "", () => void giveAll(["cutout"]))] : []),
            ],
        };
    }

    // ---- the bar ----
    const tool = (label: string, name: string, run: () => void) => control(label, icon(name), run);
    const buttons = {
        undo: tool("Undo (Ctrl+Z)", "undo", undo),
        redo: tool("Redo (Ctrl+Shift+Z)", "redo", redo),
        crop: tool("Crop (C)", "crop", () => pickTool("crop")),
        resize: tool("Resize", "resize", () => (resizing.isOpen() ? resizing.close() : resizing.open(buttons.resize))),
        hide: tool("Hide (R)", "hide", () => pickTool("hide")),
        read: tool("Read text (W)", "find", () => pickTool("read")),
        cutout: tool("Cut out (K)", "cut", () => pickTool("cutout")),
        // the mark last used, one press away, and beside it every mark, in a menu grown from where it was pressed
        mark: tool(`${MARK_TOOLS[pen.mark].label} (${MARK_TOOLS[pen.mark].key})`, MARK_TOOLS[pen.mark].icon, () => pickTool(pen.mark)),
        marks: tool("Marks", "chevron", () => toggleMarks()),
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
    // on the narrowest screens Facts is left to View, Facts and the I key, so that the other tools fit
    buttons.facts.classList.add("quire-img-bar-facts");
    const end = group(buttons.grade, buttons.facts, buttons.export);
    end.classList.add("quire-bar-end");
    buttons.marks.classList.add("quire-img-bar-more");
    buttons.marks.setAttribute("aria-haspopup", "menu");
    strip0.append(group(buttons.undo, buttons.redo), group(buttons.crop, buttons.resize, buttons.hide, buttons.read, buttons.cutout), group(buttons.mark, buttons.marks), end);
    bar.append(strip0);
    frame.place("bar").append(bar);
    const marksMenu = flowMenu("Marks", { className: "quire-img-marks-menu" });
    /** Every mark, as lines of a menu: its icon, its name and its key, the one in hand ticked. */
    const markLines = (): MenuItem[] => MARK_KINDS.map((kind) => ({ label: MARK_TOOLS[kind].label, icon: tick(stage.tool() === kind, MARK_TOOLS[kind].icon), hint: MARK_TOOLS[kind].key, key: kind, pressed: stage.tool() === kind, disabled: !picture, run: () => pickTool(kind) }));
    /** Opens the marks' menu under its button, or closes it. */
    function toggleMarks() {
        if (marksMenu.isOpen()) return marksMenu.close();
        openHolding(marksMenu, buttons.marks, markLines());
    }
    /** Opens a menu from a button, the keyboard in it even when opened by the pointer (no line of it yet), so that Escape closes it and not the tool under it; the first line too when opened from the keyboard. */
    function openHolding(menu: ReturnType<typeof flowMenu>, from: HTMLElement, lines: MenuItem[]) {
        const keyboard = from.matches(":focus-visible");
        menu.open(from, lines, keyboard);
        if (!keyboard) menu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }
    /** The bar's mark button shows the mark last used. */
    let shownMark: MarkKind | undefined;
    function showLastMark() {
        if (shownMark === pen.mark) return;
        shownMark = pen.mark;
        const { label, icon: name, key } = MARK_TOOLS[pen.mark];
        buttons.mark.setAttribute("aria-label", `${label} (${key})`);
        buttons.mark.title = `${label} (${key})`;
        buttons.mark.replaceChildren(icon(name));
    }

    function pickTool(next: Tool) {
        if (!picture) return;
        if (next === "grade") return showGrade();
        if (grading.isOpen()) grading.close();
        if (stage.tool() === "crop" && next !== "crop") stage.applyCrop();
        if ((MARK_KINDS as string[]).includes(next)) keepPen({ mark: next as MarkKind });
        stage.setTool(stage.tool() === next && next !== "crop" ? "none" : next);
        stage.element.focus({ preventScroll: true });
        if (stage.tool() === "read") void reading.start(buttons.read);
        if (stage.tool() === "cutout" && !look(picture).cutout) void startCut();
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
    /** The picture's perspective step, if it has one. */
    const perspectiveStep = (): Perspective | undefined => history.now().find((step) => step.type === "perspective") as Perspective | undefined;
    /** Perspective's part of the crop's strip, open or shut; shut, the corners are no longer being set. */
    function setStraightening(on: boolean) {
        if (!picture) return;
        if (on && stage.tool() !== "crop") pickTool("crop");
        straightening = on;
        if (!on) stage.setCornering(false);
        refresh();
    }
    /** The keystone dials made a step, the corners set by hand kept; both at zero with no corners takes the step away. A straightening that cannot be seen whole is refused. */
    function keystoneTo(dials: { vertical: number; horizontal: number }) {
        if (!picture) return;
        const next = setPerspective(history.now(), { ...perspectiveStep(), ...dials });
        if ((dials.vertical || dials.horizontal) && !look({ ...picture, steps: next }).perspective) return frame.status.say("Too far", "The picture cannot be straightened that far: part of it would be thrown past where it can be seen", "warn");
        if (next !== history.now()) commit(next);
        refresh();
    }
    /**
     * Corners set by hand made a step: they become a rectangle of the proportions guessed from them
     * (homography.ts, `ratioOf`), the dials and the horizon's turn put back to none since the corners now
     * say how the picture stands, and the crop set to that rectangle, so that a page or a screen comes out
     * alone. False when they cannot make a rectangle that can be seen whole.
     */
    function cornerTo(corners: Corners): boolean {
        if (!picture) return false;
        const size = picture.original;
        const ratio = Math.round(ratioOf(corners, size) * 1000) / 1000;
        if (!perspectiveMap({ corners, ratio }, size)) return false;
        const rect = rectangleOf(corners, ratio);
        const crop = { x: Math.ceil(rect.x), y: Math.ceil(rect.y), width: Math.floor(rect.x + rect.width) - Math.ceil(rect.x), height: Math.floor(rect.y + rect.height) - Math.ceil(rect.y) };
        const next = setOnly(setTurn(setPerspective(history.now(), { corners, ratio }), 0), { type: "crop", rect: crop });
        commit(next);
        refresh();
        return true;
    }
    /** Perspective's one press: the picture's lines found and its upright ones stood straight (the level ones made level too where they are clear), as the two dials and the horizon's turn, one change; with no clear lines it says so and changes nothing. */
    async function autoStraighten() {
        const loaded = stage.loaded();
        if (!picture || !loaded) return;
        const small = await loaded.small(1024);
        let lines = segments(grey(small.data, small.width, small.height), small.width, small.height);
        const step = perspectiveStep();
        const scale = loaded.size.width / small.width;
        // with corners set by hand, the lines are first put where the corners' map puts them, so the dials straighten what the corners made
        const cornersMap = step?.corners && step.ratio ? perspectiveMap({ corners: step.corners, ratio: step.ratio }, loaded.size) : undefined;
        if (cornersMap)
            lines = lines.map((line) => {
                const a = apply(cornersMap, { x: line.x1 * scale, y: line.y1 * scale });
                const b = apply(cornersMap, { x: line.x2 * scale, y: line.y2 * scale });
                return { x1: a.x / scale, y1: a.y / scale, x2: b.x / scale, y2: b.y / scale, length: Math.hypot(b.x - a.x, b.y - a.y) / scale };
            });
        const fix = straighten(lines, small, loaded.size);
        if (!fix) return frame.status.say("No clear lines", "No clear upright lines were found to straighten the picture by, so nothing was changed");
        const next = setTurn(setPerspective(history.now(), { ...(step?.corners ? { corners: step.corners, ratio: step.ratio } : {}), vertical: fix.vertical, horizontal: fix.horizontal }), fix.turn);
        if ((fix.vertical || fix.horizontal) && !look({ ...picture, steps: next }).perspective) return frame.status.say("No clear lines", "The lines found would straighten the picture too far, so nothing was changed");
        if (next !== history.now()) commit(next);
        frame.status.say("Straightened", `${fix.upright} upright ${fix.upright === 1 ? "line" : "lines"} stood straight${fix.level ? `, ${fix.level} made level` : ""}`);
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
            keepCurrent();
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
        give: {
            said: () => (batched() ? (giveSaid("grade") ?? "") : undefined),
            label: () => `give to the other ${items.length - 1}`,
            press: () => void giveAll(["grade"]),
        },
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
        finder: sharedFinder,
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
    const subjectButton = stripButton("subject", "The picture's subject, found by a model", () => void finding.subject(false));
    const backgroundButton = stripButton("background", "Everything but the picture's subject", () => void finding.subject(true));
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
        showLastMark();
        const marking = (MARK_KINDS as string[]).includes(stage.tool());
        for (const [name, button] of Object.entries(buttons)) {
            button.disabled = !has;
            button.classList.toggle("pressed", (stage.tool() === name && name !== "grade") || (name === "mark" && marking) || (name === "export" && exporting.isOpen()) || (name === "facts" && showing.isOpen()) || (name === "grade" && grading.isOpen()));
        }
        buttons.undo.disabled = !history.canUndo();
        buttons.redo.disabled = !history.canRedo();
        if (stage.tool() !== "crop") straightening = false;
        const kind = !has ? "none" : running ? "busy" : stage.tool() === "crop" ? (straightening ? "perspective" : "crop") : stage.tool() === "read" ? "read" : stage.tool() === "grade" ? "grade" : stage.tool() === "cutout" ? "cut" : marking || pickedMark() ? "mark" : "none";
        strip.fill(kind);
        if (picture && !factsWhole) setFacts(factsLine(look(picture), picture.original.bytes, kindOf(picture.original)));
        if (!picture) setFacts("");
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
                                // a batch's pictures together, each under its own name
                                ...(batched()
                                    ? [
                                          { label: "All pictures as a zip", icon: "download", hint: ".zip", key: "export-all-zip", disabled: !!exportRun, run: () => void exportAll("zip") },
                                          ...(pickers.showDirectoryPicker ? [{ label: "All pictures into a folder", icon: "folder", key: "export-all-folder", disabled: !!exportRun, run: () => void exportAll("folder") }] : []),
                                      ]
                                    : []),
                            ],
                            run: () => {},
                        },
                        { label: "Export", icon: "export", hint: "E", key: "export", disabled: !picture, run: () => showExportPanel() },
                        { label: "Add pictures", icon: "plus", key: "add-pictures", words: ["batch", "many pictures"], disabled: !picture, run: () => choosePictures() },
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
                        // a numbered step whose number was set by hand, counted in order again
                        { label: "Number in order", icon: "step", key: "renumber", disabled: !numberSetByHand(), run: () => numberInOrder() },
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
                        { label: "Perspective", icon: tick(straightening, "perspective"), hint: "P", key: "perspective", pressed: straightening, disabled: !picture, run: () => setStraightening(!straightening) },
                        { label: "Straighten lines", icon: "perspective", key: "straighten", disabled: !picture, run: () => void autoStraighten() },
                        { label: "Remove the perspective", icon: "trash", disabled: !history.now().some((step) => step.type === "perspective"), run: () => commit(history.now().filter((step) => step.type !== "perspective")) },
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
                    // a JPEG's repair is a step of its own, on or off, and no part of the grade
                    [
                        { label: "Repair JPEG", icon: tick(!!picture && !!look(picture).repair, "paint"), key: "repair", pressed: !!picture && !!look(picture).repair, disabled: !picture || !repairable || !!running, run: () => void toggleRepair() },
                        { label: "Repair JPEG with…", icon: "paint", key: "repair-with", disabled: !picture || !repairable || !!running, run: () => void chooseRepair(stage.element) },
                    ],
                    // in a batch: one of this picture's changes, or all of them, given to the others as one undo step
                    batched()
                        ? [
                              {
                                  label: "Give to all",
                                  icon: "export",
                                  words: ["batch", "give to all", "apply to all"],
                                  items: () => [
                                      ...(["grade", "resize", "repair", "cutout", "export"] as Givable[]).map((kind): MenuItem => ({ label: kind === "grade" ? "The grade" : kind === "resize" ? "The size" : kind === "repair" ? "The repair" : kind === "cutout" ? "The cut-out" : "The export settings", icon: kind === "grade" ? "paper" : kind === "resize" ? "resize" : kind === "repair" ? "paint" : kind === "cutout" ? "cut" : "export", key: `give-${kind}`, disabled: !giveSaid(kind) || !!running || !!exportRun, run: () => void giveAll([kind]) })),
                                      RULE,
                                      { label: "All of its changes", icon: "tick", key: "give-changes", disabled: !!running || !!exportRun || !picture, run: () => picture && void giveAll(givables(picture)) },
                                  ],
                                  run: () => {},
                              },
                          ]
                        : [],
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
                        ] as const
                    ).map(([label, name, key]): MenuItem => ({ label, icon: tick(stage.tool() === name, name), hint: key, key: name, pressed: stage.tool() === name, disabled: !picture, run: () => pickTool(name) })),
                    markLines(),
                    [
                        { label: "Read text", icon: tick(stage.tool() === "read", "find"), hint: "W", key: "read", pressed: stage.tool() === "read", disabled: !picture, run: () => pickTool("read") },
                        { label: "Cut out", icon: tick(stage.tool() === "cutout", "cut"), hint: "K", key: "cutout", pressed: stage.tool() === "cutout", disabled: !picture, run: () => pickTool("cutout") },
                        {
                            label: "Text model",
                            icon: "settings",
                            items: () => TIERS.map((each) => ({ label: each.name, icon: tick(reading.tier().id === each.id, "find"), hint: reading.kept(each.id) ? "On this device" : megabytes(sizeOf(each)), pressed: reading.tier().id === each.id, run: () => useModel(each.id) })),
                            run: () => {},
                        },
                        { label: "Hide what looks private", icon: "hide", key: "hide-private", disabled: !stage.findings().length, run: () => void stage.hideFindings() },
                    ],
                    [
                        { label: "Mark color", icon: "color", items: () => COLORS.map((each) => ({ label: each.name, icon: tick(pen.color === each.value, "color"), pressed: pen.color === each.value, run: () => (keepPen({ color: each.value }), refresh()) })), run: () => {} },
                        { label: "Thickness", icon: "line", items: () => WEIGHTS.map((each) => ({ label: each.name, icon: tick(pen.weight === each.value, "line"), pressed: pen.weight === each.value, run: () => (keepPen({ weight: each.value }), refresh()) })), run: () => {} },
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
    const firstMarked = () => history.now().find((step) => step.type !== "crop" && step.type !== "resize" && step.type !== "grade" && step.type !== "turn" && step.type !== "perspective")?.id;
    /** Moves what is picked one place forward (over the next thing drawn) or back (under the one before), skipping the crop and the resize, which are drawn under everything. */
    function restack(by: 1 | -1) {
        const id = stage.picked();
        const steps = history.now();
        const at = steps.findIndex((step) => step.id === id);
        if (!id || at < 0) return;
        let to = at + by;
        while (steps[to] && (steps[to]!.type === "crop" || steps[to]!.type === "resize" || steps[to]!.type === "grade" || steps[to]!.type === "turn" || steps[to]!.type === "perspective")) to += by;
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
            ["P", "Perspective: two dials, corners to drag, and Auto"],
            ["R", "Hide"],
            ["W", "Read text: press a word to hide it, drag to hide a run"],
            ["A", "Arrow"],
            ["B", "Box"],
            ["T", "Text: Enter keeps it, Shift and Enter starts another line"],
            ["N", "Numbered step: each press puts down the next number"],
            ["H", "Highlighter: level as dragged (Shift: at any angle), along the words read"],
            ["M", "Magnifier: drag from what to enlarge to where the lens goes"],
            ["S", "Spotlight: drag a shape to leave bright"],
            ["G", "Grade: sliders, curves, wheels, looks, and parts of the picture"],
            ["\\", "Hold to see the original"],
            ["E", "Export"],
            ["Enter", "Apply the crop"],
            ["Escape", "Leave the tool"],
            ["Arrows", "Nudge the frame, a corner or what is picked (Shift: 10 pixels)"],
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
            ["Page Down", "In a batch, the next picture"],
            ["Page Up", "In a batch, the picture before"],
            ["Home, End", "In a batch, the first and the last picture"],
            ["Arrows on the strip", "Step through the batch while its small pictures have the keyboard"],
        ];
        const list = make("dl", "quire-img-keys");
        for (const [key, said] of rows) list.append(make("dt", "", key), make("dd", "", said));
        openDialog(stage.element, { title: "Keyboard shortcuts", body: [list], dismiss: "close", returnTo: stage.element });
    }

    /** What Escape does now, one level at a time: stops what runs, lets a press asked for go, the part or what is picked or selected, the corners, perspective, and last the tool. */
    function escapeFor(): (() => void) | undefined {
        if (running) return () => running?.stop.abort();
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
        // setting the corners, Escape stops; with perspective open, it goes back to the crop's strip
        if (stage.cornering()) return () => (stage.setCornering(false), refresh());
        if (straightening && stage.tool() === "crop") return () => setStraightening(false);
        if (stage.tool() !== "none") return () => stage.setTool("none");
        return undefined;
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
        // Escape is answered from the tool's own controls too (the dial, a shape, a color), as from the picture, and the keyboard then goes back to the picture
        if (!onPicture && event.key === "Escape" && !event.altKey && !control && event.target instanceof Element && event.target.closest(".quire-img-strip")) {
            const run = escapeFor();
            return (
                run &&
                (() => {
                    run();
                    stage.element.focus({ preventScroll: true });
                })
            );
        }
        // single keys only while the picture, not a field, has the keyboard
        if (!onPicture || event.altKey || control) return undefined;
        const picked = TOOL_KEYS[event.code];
        if (picked && !event.shiftKey) return () => (picked === "export" ? showExportPanel() : picked === "facts" ? showFacts() : picked === "grade" ? showGrade() : picked === "perspective" ? setStraightening(!(straightening && stage.tool() === "crop")) : pickTool(picked));
        if (event.key === "Enter" && stage.tool() === "crop") return applyCrop;
        if (event.key === "Escape") return escapeFor();
        if ((event.key === "Delete" || event.key === "Backspace") && stage.picked()) return removePicked;
        if ((event.key === "Delete" || event.key === "Backspace") && grading.isOpen() && target) return removePart;
        // in a batch: the next picture and the one before, and the first and the last, keys the crop's frame, a mark and a corner never use
        if (batched() && !event.shiftKey) {
            const to = event.key === "PageDown" ? at + 1 : event.key === "PageUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined;
            if (to !== undefined) return () => void stepTo(Math.max(0, Math.min(items.length - 1, to)));
        }
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
        takeMany: (files: File[]) => takeMany(files),
        // for a page or a test that reaches further in than the app does
        stage,
        batch: () => ({ count: items.length, at, names: items.map((item) => item.given ?? item.original.name) }),
        stepTo,
        addPictures: (files: File[]) => addPictures(files),
        takeOut,
        giveAll: (kinds: Givable[]) => giveAll(kinds),
        exportAll,
        undo,
        redo,
        reading,
        steps: () => history.now(),
        changeStep: (id: string, to: Partial<Kept>) => commit(history.now().map((step) => (step.id === id ? ({ ...step, ...to } as Kept) : step))),
        downloadQuire,
        flatten: () => flattened(),
        /** Opens the document again from its steps.json, as if it were opened anew. */
        reopen: () => picture && open(documentText()),
        grading,
        destroy() {
            estimate.cancel();
            reading.destroy();
            measure.destroy();
            repairer.destroy();
            running?.stop.abort();
            restorer.destroy();
            finding.destroy();
            grading.panel.remove();
            document.removeEventListener("paste", pasted);
            pressMenu.close(false);
            marksMenu.close(false);
            outlineMenu.close(false);
            pressAnchor.remove();
            thumbMenu.close(false);
            thumbAnchor.remove();
            exportRun?.stop.abort();
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
