// Where documents live. Every place mdQuire can keep a document (the browser, a file opened and
// downloaded, a real file or folder, a GitHub repository, the site's own writing server) is a
// Store with the same few things it can do. Opening a document gives its text and a mark of its
// version; saving hands the mark back, and a store whose document changed elsewhere since then
// refuses, saying so, rather than writing over it.
//
// createSaver saves as you type: a short pause after the last change, a quiet status, and when the
// store refuses because the document changed elsewhere, what was typed is kept and three ways on
// are offered: keep mine, take theirs, or see both. Pure: time and waiting are passed in.

import type { Parts } from "./quire-file";

/** A document in a store's list. `id` is the store's own way of finding it again. */
export interface Entry {
    id: string;
    name: string;
    modified?: number;
    /** For a `.quire` document whose main text is not document.md, that file's name ("steps.json"), where the store knows it without opening the document: it says which kind the document is (kind.ts). */
    main?: string;
}

/** A document as opened: its text, and a mark of the version it is, which saving hands back. */
export interface Opened {
    text: string;
    mark: string;
    /** For a `.quire` document, what it carries beside its main text. */
    quire?: Parts;
    /** For a `.quire` document whose main text is not document.md, that file's name. */
    main?: string;
}

/** What a document is saved as: its text, and for a `.quire` document its parts too. */
export type Writing = { text: string; quire?: Parts };

/** What saving came to: saved with a new mark, refused because the document changed elsewhere, or failed. */
export type Saved = { ok: true; mark: string } | { ok: false; changed: true; theirs?: Opened } | { ok: false; changed?: false; message: string };

/** One place documents can live. What it cannot do, it says in `can`. */
export interface Store {
    /** A short name for the place, such as "This browser" or "bybrooklyn/website". */
    label: string;
    can: { list: boolean; create: boolean; rename: boolean; remove: boolean; pictures: boolean; save: boolean };
    /** Said beside the status when saving keeps the text only somewhere passing, as a file opened and not yet downloaded is. */
    note?: string;
    /** True where `.quire` documents can be made and kept, beside or instead of Markdown files. */
    quire?: boolean;
    /** True where renaming costs next to nothing, so the title renames as it is typed rather than when it is left. */
    renameAsTyped?: boolean;
    list(): Promise<Entry[]>;
    open(id: string): Promise<Opened>;
    save(id: string, text: string, mark: string, quire?: Parts): Promise<Saved>;
    /** Makes a document; given parts, it is made as a `.quire` document, with its main text in `main` when that is not document.md. */
    create(name: string, text: string, quire?: Parts, main?: string): Promise<{ id: string; mark: string }>;
    /** Renames a document and gives its id afterwards, which is a new one where the id is a path. */
    rename(id: string, name: string): Promise<string>;
    /** The mark of the version kept now, where a rename changes the id and so the saver needs it afresh. */
    markOf?(id: string): Promise<string>;
    /** Takes a document away; where the store can, to somewhere it can be brought back from. */
    remove(id: string): Promise<void>;
    /** Keeps a picture beside a document and gives the address to write in it, relative to the document. */
    savePicture(id: string, picture: Blob, name: string): Promise<string>;
    /** The address a picture written in a document can be shown from, if it is not the address itself. */
    show?(id: string, address: string): Promise<string | undefined>;
    /** The pictures a `.quire` document holds, by name, for writing it out as a file. */
    pictures?(id: string): Promise<Map<string, Blob>>;
    /** Whether an address written in a document leads to a file beside it (or, for the site's own server, to one of its pages); undefined when the store cannot tell. Checking asks it, and never about addresses elsewhere on the web. */
    exists?(id: string, address: string): Promise<boolean | undefined>;
}

/** The path inside a store of an address written in the document at `id`, or undefined if it leaves the store or is not relative. */
export function besideDocument(id: string, address: string): string | undefined {
    if (/^[a-z][\w+.-]*:|^\/|^#/i.test(address) || !address) return undefined;
    const steps = id.split("/").slice(0, -1);
    for (const step of address.split("/")) {
        if (step === "..") {
            if (!steps.length) return undefined;
            steps.pop();
        } else if (step && step !== ".") steps.push(step);
    }
    return steps.join("/");
}

/** A store's own failure, said in plain words for the status. */
export class StoreError extends Error {}

/** How saving stands, as the status shows it. */
export type Status = { state: "saved" } | { state: "saving" } | { state: "waiting" } | { state: "failed"; message: string } | { state: "changed"; theirs?: Opened };

/** The status in a few quiet words. */
export function said(status: Status, note?: string): string {
    if (status.state === "saved") return note ? `Kept here. ${note}` : "Saved";
    if (status.state === "saving") return "Saving";
    if (status.state === "waiting") return "Not saved yet";
    if (status.state === "changed") return "Changed elsewhere";
    return `Not saved: ${status.message}`;
}

/** A plain file name for a document's name: the characters a file can have, and the ending kept or given. */
export function fileName(name: string, ending = ".md"): string {
    const plain = name
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .toLowerCase();
    const known = /\.(md|mdx|markdown|txt|quire)$/i.exec(plain)?.[0] ?? "";
    // a name a disk can hold: not too long for it, and not one Windows keeps for itself (con, nul, com1)
    let stem = plain.slice(0, plain.length - known.length).slice(0, 100).replace(/[-.]+$/, "") || "untitled";
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) stem = `${stem}-file`;
    return `${stem}${known || ending}`;
}

/** A name not yet in use among others, with a number added if it is. */
export function freeName(name: string, taken: string[]): string {
    if (!taken.includes(name)) return name;
    const dot = name.search(/\.[^.]+$/);
    const [stem, ending] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let count = 2; ; count++) if (!taken.includes(`${stem}-${count}${ending}`)) return `${stem}-${count}${ending}`;
}

/** The way from one file's folder to another file, as written in Markdown: `../pictures/a.png`. */
export function relative(from: string, to: string): string {
    const there = from.split("/").slice(0, -1).filter(Boolean);
    const target = to.split("/").filter(Boolean);
    let shared = 0;
    while (shared < there.length && shared < target.length - 1 && there[shared] === target[shared]) shared++;
    const up = there.length - shared;
    const path = [...Array<string>(up).fill(".."), ...target.slice(shared)].join("/");
    return up === 0 ? `./${path}` : path;
}

/** Makes a copy of a document in the same store under a new name: its text, its parts and, for a `.quire` document, its pictures, which keep their names so that the copy's text still finds them. */
export async function copyDocument(store: Store, id: string, name: string): Promise<{ id: string; mark: string }> {
    const found = await store.open(id);
    const made = await store.create(name, found.text, found.quire, found.main);
    const pictures = found.quire && store.pictures ? await store.pictures(id) : new Map<string, Blob>();
    if (pictures.size === 0) return made;
    for (const [each, picture] of pictures) await store.savePicture(made.id, picture, each);
    // a store that writes a `.quire` file whole (a folder) holds the pictures only until the next save, so the copy is saved once more with them
    const saved = await store.save(made.id, found.text, made.mark, found.quire);
    if (!saved.ok) throw new StoreError(saved.changed ? "the copy changed while it was being made" : saved.message);
    return { id: made.id, mark: saved.mark };
}

/** What is waiting to be saved: the text or the writing, or a way to make it once it is needed. */
type Waiting = string | Writing | (() => string | Writing);

/** Saves a document as it is typed, once typing pauses, and keeps what was typed when the store refuses. */
export function createSaver(
    store: Store,
    id: string,
    mark: string,
    options: { pause?: number; wait?: (run: () => void, ms: number) => () => void } = {},
) {
    const pause = options.pause ?? 900;
    const wait =
        options.wait ??
        ((run: () => void, ms: number) => {
            const timer = setTimeout(run, ms);
            return () => clearTimeout(timer);
        });
    let status: Status = { state: "saved" };
    // what is waiting to be saved: the text, or a way to write it, so that a long document is
    // written out once when it is saved rather than on every key
    let pending: Waiting | undefined;
    const text = (waiting: Waiting): Writing => {
        const value = typeof waiting === "function" ? waiting() : waiting;
        return typeof value === "string" ? { text: value } : value;
    };
    let cancel: (() => void) | undefined;
    let running: Promise<void> = Promise.resolve();
    // once stopped, for a document that was left, nothing more is taken to be saved
    let stopped = false;
    const listeners = new Set<(status: Status) => void>();
    const set = (next: Status) => {
        status = next;
        for (const listener of listeners) listener(next);
    };

    async function save(over?: string) {
        if (pending === undefined || !store.can.save) return;
        const taken = pending;
        set({ state: "saving" });
        let result: Saved;
        try {
            const writing = text(taken);
            result = await store.save(id, writing.text, over ?? mark, writing.quire);
        } catch (error) {
            result = { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
        if (result.ok) {
            mark = result.mark;
            // what was typed while this save was on its way is still to be saved
            if (pending === taken) {
                pending = undefined;
                set({ state: "saved" });
            } else {
                set({ state: "waiting" });
                schedule();
            }
        } else if (result.changed) set({ state: "changed", theirs: result.theirs });
        else set({ state: "failed", message: result.message });
    }

    function schedule() {
        cancel?.();
        cancel = wait(() => {
            cancel = undefined;
            running = running.then(() => save());
        }, pause);
    }

    return {
        /** Says the text changed: it is saved once typing pauses, unless the store has refused and is waiting for a choice. */
        changed(next: Waiting) {
            if (stopped) return;
            pending = next;
            if (status.state === "changed") return;
            if (status.state !== "saving") set({ state: "waiting" });
            schedule();
        },
        /** Saves now what is waiting. */
        flush() {
            cancel?.();
            cancel = undefined;
            running = running.then(() => save());
            return running;
        },
        /** After a refusal: keep mine writes it over theirs; take theirs gives their text to show, mine having been kept by the caller. */
        async choose(choice: "mine" | "theirs"): Promise<Opened | undefined> {
            if (status.state !== "changed") return undefined;
            const refused = status.theirs;
            if (choice === "mine") {
                const theirs = refused ?? (await store.open(id).catch(() => undefined));
                running = running.then(() => save(theirs?.mark));
                await running;
                return undefined;
            }
            // their version is read afresh where it can be, so that a store keeping pictures beside it takes theirs too
            const theirs = (await store.open(id).catch(() => undefined)) ?? refused;
            if (!theirs) {
                // nothing to put in its place: what was typed stays, waiting, and the writer is told
                set({ state: "failed", message: "their version could not be read, so yours is kept here and is still to be saved" });
                return undefined;
            }
            mark = theirs.mark;
            pending = undefined;
            set({ state: "saved" });
            return theirs;
        },
        /** What was typed and not yet saved, if anything. */
        unsaved: () => (pending === undefined ? undefined : text(pending).text),
        status: () => status,
        mark: () => mark,
        on(listener: (status: Status) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        settled: () => running,
        stop() {
            stopped = true;
            cancel?.();
            cancel = undefined;
        },
    };
}

/** A store kept wholly in memory: for tests, and for a document with nowhere else to go. */
export function memoryStore(label = "Memory"): Store & { files: Map<string, { name: string; text: string; mark: number; gone?: boolean; quire?: Parts; main?: string }> } {
    const files = new Map<string, { name: string; text: string; mark: number; gone?: boolean; quire?: Parts; main?: string }>();
    let count = 0;
    const find = (id: string) => {
        const file = files.get(id);
        if (!file || file.gone) throw new StoreError("There is no such document.");
        return file;
    };
    return {
        label,
        files,
        can: { list: true, create: true, rename: true, remove: true, pictures: true, save: true },
        renameAsTyped: true,
        async list() {
            return [...files.entries()].filter(([, file]) => !file.gone).map(([id, file]) => ({ id, name: file.name, ...(file.main ? { main: file.main } : {}) }));
        },
        async open(id) {
            const file = find(id);
            return { text: file.text, mark: String(file.mark), quire: file.quire, ...(file.main ? { main: file.main } : {}) };
        },
        async save(id, text, mark, quire) {
            const file = find(id);
            if (String(file.mark) !== mark) return { ok: false, changed: true, theirs: { text: file.text, mark: String(file.mark), quire: file.quire } };
            file.text = text;
            if (quire) file.quire = quire;
            file.mark++;
            return { ok: true, mark: String(file.mark) };
        },
        async create(name, text, quire, main) {
            const id = `doc-${++count}`;
            files.set(id, { name: freeName(name, [...files.values()].filter((file) => !file.gone).map((file) => file.name)), text, mark: 1, quire, ...(main ? { main } : {}) });
            return { id, mark: "1" };
        },
        async rename(id, name) {
            find(id).name = name;
            return id;
        },
        async remove(id) {
            find(id).gone = true;
        },
        async savePicture(_id, _picture, name) {
            return `./${name}`;
        },
    };
}
