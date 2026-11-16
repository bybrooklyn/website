// A batch: many pictures worked on in one document, each with its own original, its own steps and its own
// undo, kept in one `.quire` as one steps.json that lists them all, with every original (and a small copy of
// each, for the strip under the picture) beside it in `pictures/`. A document of one picture is written
// exactly as it always was (`writeSteps`); only a document of two or more is a batch.
//
// What can be handed from one picture to the rest ("Give to all"): its grade, its resize, its repair, its
// cut-out and its export's settings. A crop, a mark, a cover and a part of the grade are its own and are
// never handed on. A repair or a cut-out made by a model is made again for each picture (the editor runs
// it); the rest are steps put in place of each picture's own.
//
// Files given out from a batch keep their own names with the format's ending, and a name already taken
// becomes `photo (1).webp`, `photo (2).webp`: nothing is ever written over.
//
//   const text = writeBatch(pictures);         one picture: steps.json as before; more: a batch
//   const read = readBatch(text);              { pictures, dropped, batch }
//   const names = namesFor(["a.jpg", "a.png"], ".webp");   ["a.webp", "a (1).webp"]

import { formatOf, readSettings, weightSaid, type Settings } from "./export";
import { LIMITS, readPicture, setOnly, writeSteps, type Kept, type Picture } from "./steps";

/** One picture of a batch: its document, the name its file came with (its exports keep it), where its small copy is kept, and its own export settings. */
export interface BatchPicture extends Picture {
    given?: string;
    small?: string;
    export?: Settings;
}

/** The most pictures a batch is read with, and the most its steps.json may weigh: past these a file is taken to be damaged. */
export const BATCH_LIMITS = { pictures: 1_000, file: 64 * 1024 * 1024, steps: 40_000 };

/** The kinds of change a picture can give to the others. */
export type Givable = "grade" | "resize" | "repair" | "cutout" | "export";

/** The order the kinds are given and said in. */
export const GIVABLE: Givable[] = ["grade", "resize", "repair", "cutout", "export"];

/** Where a picture's small copy may be kept: one of the document's own pictures, by a plain name. */
const SMALL = /^pictures\/[\w.() -]{1,160}$/;

/** steps.json for the pictures of a document: one picture's as it always was, or a batch's, each picture with its steps one to a line. */
export function writeBatch(pictures: BatchPicture[]): string {
    if (pictures.length === 1) {
        const { given: _given, small: _small, export: _export, ...picture } = pictures[0]!;
        return writeSteps(picture);
    }
    const one = (picture: BatchPicture) => {
        const steps = picture.steps.map((step) => `        ${JSON.stringify(step)}`).join(",\n");
        const edits = picture.edits && Object.values(picture.edits).some((value) => value !== undefined) ? `,\n      "edits": ${JSON.stringify(picture.edits)}` : "";
        const given = picture.given ? `,\n      "given": ${JSON.stringify(picture.given)}` : "";
        const small = picture.small ? `,\n      "small": ${JSON.stringify(picture.small)}` : "";
        const settings = picture.export ? `,\n      "export": ${JSON.stringify(picture.export)}` : "";
        return `    {\n      "original": ${JSON.stringify(picture.original)}${given}${small}${settings},\n      "steps": [${steps ? `\n${steps}\n      ` : ""}]${edits}\n    }`;
    };
    return `{\n  "quire": 1,\n  "pictures": [\n${pictures.map(one).join(",\n")}\n  ]\n}\n`;
}

/**
 * Reads steps.json, of one picture or of a batch. Gives undefined when it holds no picture that can be read;
 * otherwise the pictures that read (a batch's that do not are left out, counted in `dropped` with the steps
 * that were), and whether it was written as a batch.
 */
export function readBatch(text: string): { pictures: BatchPicture[]; dropped: number; batch: boolean } | undefined {
    if (text.length > BATCH_LIMITS.file) return undefined;
    let raw: { quire?: unknown; pictures?: unknown };
    try {
        raw = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!raw || typeof raw !== "object" || raw.quire !== 1) return undefined;
    if (!Array.isArray(raw.pictures)) {
        // one picture's steps.json, held to the bounds it always was
        if (text.length > LIMITS.file) return undefined;
        const read = readPicture(raw);
        if (!read) return undefined;
        const { dropped, ...picture } = read;
        return { pictures: [picture], dropped, batch: false };
    }
    const pictures: BatchPicture[] = [];
    let dropped = 0;
    let steps = 0;
    for (const entry of raw.pictures.slice(0, BATCH_LIMITS.pictures)) {
        const read = steps < BATCH_LIMITS.steps ? readPicture(entry) : undefined;
        if (!read) {
            dropped++;
            continue;
        }
        const { dropped: left, ...picture } = read;
        // the batch as a whole is held to ten times one picture's steps
        const kept = picture.steps.slice(0, BATCH_LIMITS.steps - steps);
        steps += kept.length;
        dropped += left + picture.steps.length - kept.length;
        const fields = entry as { given?: unknown; small?: unknown; export?: unknown };
        const given = typeof fields.given === "string" ? fields.given.slice(0, 300) : undefined;
        const small = typeof fields.small === "string" && SMALL.test(fields.small) ? fields.small : undefined;
        const settings = fields.export && typeof fields.export === "object" ? readSettings(JSON.stringify(fields.export)) : undefined;
        pictures.push({ ...picture, steps: kept, ...(given ? { given } : {}), ...(small ? { small } : {}), ...(settings ? { export: settings } : {}) });
    }
    dropped += Math.max(0, raw.pictures.length - BATCH_LIMITS.pictures);
    return pictures.length ? { pictures, dropped, batch: true } : undefined;
}

// ---- names ----

/** A file's own name without its ending, made safe for any disk: no folder, no character a disk refuses, no name Windows keeps for itself. */
export function ownStem(given: string | undefined): string {
    const stem = (given ?? "")
        .replace(/^.*[\\/]/, "")
        .replace(/\.[a-z0-9]{1,5}$/i, "")
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[ .]+|[ .]+$/g, "")
        .slice(0, 120)
        .trim();
    if (!stem) return "picture";
    return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? `${stem}-file` : stem;
}

/** A name not yet taken: the name itself, else `stem (1).ext`, `stem (2).ext` and on. Names are compared without case, as most disks do. */
export function freeFileName(name: string, taken: (name: string) => boolean): string {
    if (!taken(name)) return name;
    const dot = name.search(/\.[^.]+$/);
    const [stem, ending] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let count = 1; ; count++) {
        const next = `${stem} (${count})${ending}`;
        if (!taken(next)) return next;
    }
}

/** The names a batch's files go out under: each its own name with the ending, the second of one name `photo (1).webp`, in the order given, none of them a name in `taken`. */
export function namesFor(given: (string | undefined)[], ending: string | string[], taken: Iterable<string> = []): string[] {
    const used = new Set([...taken].map((name) => name.toLowerCase()));
    return given.map((name, at) => {
        const free = freeFileName(`${ownStem(name)}${Array.isArray(ending) ? ending[at] : ending}`, (each) => used.has(each.toLowerCase()));
        used.add(free.toLowerCase());
        return free;
    });
}

// ---- giving a change to the others ----

/** The kinds of change a picture has that can be given on: its grade, resize, repair and cut-out where it has them, and its export's settings always. */
export function givables(picture: Picture): Givable[] {
    const has = (type: string) => picture.steps.some((step) => step.type === type && !step.off);
    return GIVABLE.filter((kind) => kind === "export" || has(kind));
}

/**
 * Another picture's steps with this one's grade or resize put in place of its own (added where it has none),
 * every other step left as it was: its crop, covers, marks, parts, turn and perspective are never touched.
 * A resize is given exactly as set (its width, and its height when both were given). A kind this picture does
 * not have leaves the other's alone.
 */
export function giveStep(to: Kept[], from: Kept[], kind: "grade" | "resize"): Kept[] {
    const step = from.find((each) => each.type === kind && !each.off);
    if (!step) return to;
    const { id: _id, off: _off, ...plain } = step;
    return setOnly(to, plain as Extract<Kept, { type: "grade" | "resize" }>);
}

/** The steps with a repair by hand put in, for a picture that can be repaired; a repair a model made is made again for each picture by the editor. */
export const giveRepair = (to: Kept[]): Kept[] => setOnly(to, { type: "repair" });

/** A resize in a few words: "1920 wide", or "1920 × 1080" when both were given. */
export function resizeSaid(steps: Kept[]): string | undefined {
    const step = steps.find((each) => each.type === "resize" && !each.off);
    if (step?.type !== "resize") return undefined;
    return step.height ? `${step.width} × ${step.height}` : `${step.width} wide`;
}

/** Export settings in a few words: "WebP at 85", "JPEG under 200 KB", "PNG". */
export function settingsSaid(settings: Settings): string {
    const format = formatOf(settings.format);
    if (!format.lossy) return format.label;
    return settings.target ? `${format.label} under ${weightSaid(settings.target)}` : `${format.label} at ${Math.round(settings.quality * 100)}`;
}

/** A picture's givable changes in a few plain words, as the strip's menu says what Give to all will do: "the grade, 1920 wide, WebP at 85". */
export function changesSaid(picture: BatchPicture, fallback: Settings): string {
    return givables(picture)
        .map((kind) => (kind === "grade" ? "the grade" : kind === "resize" ? resizeSaid(picture.steps)! : kind === "repair" ? "the repair" : kind === "cutout" ? "the cut-out" : settingsSaid(picture.export ?? fallback)))
        .join(", ");
}

/** A batch's name as it arrives: "Pictures, 15 Nov 2026 14:30". */
export function batchName(now: Date): string {
    const day = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `Pictures, ${day} ${time}`;
}

/** The name a picture's small copy is kept under beside it: `IMG_1.small.webp` for `pictures/IMG_1.jpg`. */
export const smallName = (address: string, type: string) => `${address.replace(/^pictures\//, "").replace(/\.[^.]*$/, "")}.small${type === "image/webp" ? ".webp" : ".png"}`;

/** How many pictures, in words: "1 picture", "24 pictures". */
export const picturesSaid = (count: number) => `${count} ${count === 1 ? "picture" : "pictures"}`;

/** Which of how many, as the line under the picture says it: "3 of 24". */
export const whichSaid = (at: number, count: number) => `${at + 1} of ${count}`;
