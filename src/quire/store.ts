// Where documents live. Every place mdQuire can keep a document (the browser, a file opened and
// downloaded, a real file or folder, a GitHub repository, the site's own writing server) is a
// Store with the same few things it can do. Opening a document gives its text and a mark of its
// version; saving hands the mark back, and a store whose document changed elsewhere since then
// refuses, saying so, rather than writing over it.
//
// createSaver saves as you type: a short pause after the last change, a quiet status, and when the
// store refuses because the document changed elsewhere, what was typed is kept and three ways on
// are offered: keep mine, take theirs, or see both. Pure: time and waiting are passed in.

/** A document in a store's list. `id` is the store's own way of finding it again. */
export interface Entry {
    id: string;
    name: string;
    modified?: number;
}

/** A document as opened: its text, and a mark of the version it is, which saving hands back. */
export interface Opened {
    text: string;
    mark: string;
}

/** What saving came to: saved with a new mark, refused because the document changed elsewhere, or failed. */
export type Saved = { ok: true; mark: string } | { ok: false; changed: true; theirs?: Opened } | { ok: false; changed?: false; message: string };

/** One place documents can live. What it cannot do, it says in `can`. */
export interface Store {
    /** A short name for the place, such as "This browser" or "bybrooklyn/website". */
    label: string;
    can: { list: boolean; create: boolean; rename: boolean; remove: boolean; pictures: boolean; save: boolean };
    /** Said beside the status when saving keeps the text only somewhere passing, as a file opened and not yet downloaded is. */
    note?: string;
    /** True where renaming costs next to nothing, so the title renames as it is typed rather than when it is left. */
    renameAsTyped?: boolean;
    list(): Promise<Entry[]>;
    open(id: string): Promise<Opened>;
    save(id: string, text: string, mark: string): Promise<Saved>;
    create(name: string, text: string): Promise<{ id: string; mark: string }>;
    rename(id: string, name: string): Promise<string>;
    /** Takes a document away; where the store can, to somewhere it can be brought back from. */
    remove(id: string): Promise<void>;
    /** Keeps a picture beside a document and gives the address to write in it, relative to the document. */
    savePicture(id: string, picture: Blob, name: string): Promise<string>;
    /** The address a picture written in a document can be shown from, if it is not the address itself. */
    show?(id: string, address: string): Promise<string | undefined>;
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
    const base = plain || "untitled";
    return /\.(md|mdx|markdown|txt)$/i.test(base) ? base : `${base}${ending}`;
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
    let pending: string | (() => string) | undefined;
    const text = (waiting: string | (() => string)) => (typeof waiting === "string" ? waiting : waiting());
    let cancel: (() => void) | undefined;
    let running: Promise<void> = Promise.resolve();
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
            result = await store.save(id, text(taken), over ?? mark);
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
        changed(next: string | (() => string)) {
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
            const theirs = status.theirs ?? (await store.open(id).catch(() => undefined));
            if (choice === "mine") {
                running = running.then(() => save(theirs?.mark));
                await running;
                return undefined;
            }
            if (theirs) mark = theirs.mark;
            pending = undefined;
            set({ state: "saved" });
            return theirs;
        },
        /** What was typed and not yet saved, if anything. */
        unsaved: () => (pending === undefined ? undefined : text(pending)),
        status: () => status,
        mark: () => mark,
        on(listener: (status: Status) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        settled: () => running,
        stop: () => cancel?.(),
    };
}

/** A store kept wholly in memory: for tests, and for a document with nowhere else to go. */
export function memoryStore(label = "Memory"): Store & { files: Map<string, { name: string; text: string; mark: number; gone?: boolean }> } {
    const files = new Map<string, { name: string; text: string; mark: number; gone?: boolean }>();
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
            return [...files.entries()].filter(([, file]) => !file.gone).map(([id, file]) => ({ id, name: file.name }));
        },
        async open(id) {
            const file = find(id);
            return { text: file.text, mark: String(file.mark) };
        },
        async save(id, text, mark) {
            const file = find(id);
            if (String(file.mark) !== mark) return { ok: false, changed: true, theirs: { text: file.text, mark: String(file.mark) } };
            file.text = text;
            file.mark++;
            return { ok: true, mark: String(file.mark) };
        },
        async create(name, text) {
            const id = `doc-${++count}`;
            files.set(id, { name: freeName(name, [...files.values()].filter((file) => !file.gone).map((file) => file.name)), text, mark: 1 });
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
