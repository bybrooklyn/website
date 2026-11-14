// One document open at a time, whatever its kind: where it lives, saving it as it changes, what to
// do when it changed elsewhere, its version history, renaming it, and moving to another or to
// none. A kind's editor (mdQuire's editor.ts, a note's) holds the document itself and gives the
// session only what it alone knows, as a Body: the document as a store saves it, how to put one in,
// and what it keeps beside it.
//
//   const session = createSession(body, { store, id, name, mark, versions, say });
//   session.changed()            after each edit: saved once typing pauses, and kept in the history
//   session.open(store, entry)   leaves the document (saving what is waiting) and opens another
//   session.ready()              saves what is waiting, asking the writer if it cannot be: may it be left?
//
// Without a store it writes nowhere, as in the tests of a kind's parts.

import { createConflict } from "./conflict";
import { make } from "./ui";
import { openDialog } from "./dialog";
import { createSaver, said, type Entry, type Opened, type Status, type Store, type Writing } from "./store";
import type { Parts } from "./quire-file";
import { changes, createKeeper, memoryStorage, moveVersions, snapshotParts, snapshotText, type VersionStorage } from "./versions";

/** What a kind of document gives the session: the one thing only it knows, the document. */
export interface Body {
    /** The document as a store saves it: its text, and for a `.quire` document its parts. */
    writing(): Writing;
    /** Puts a document in, as opened from its store, in place of the one shown; not an edit. */
    load(found: Opened, entry: Entry): void;
    /** Puts their version in, after a conflict, as one step that can be undone. */
    replace(found: Opened): void;
    /** Shows nothing open: an empty page kept nowhere. */
    empty(): void;
    /** Where the document is now, told before it is loaded and after it moves, so that what the kind keeps by place follows. */
    placed(where: { store?: Store; id?: string; name: string }): void;
    /** The name changed: the trail and the title follow it. */
    named(name: string): void;
    /** How saving stands changed (the margin's facts, what learns from saved words). */
    status?(status: Status): void;
    /** Before the document is let go: what the kind keeps beside it is put away (mdQuire's notes). */
    leaving?(): void;
    /** After a rename gave the document a new id: what the kind keeps by place moves with it. */
    moved?(before: string, after: string): void;
    /** Hands the writer a copy, when it could not be saved. */
    download(): void;
    /** Where the "Not saved" dialog grows from. */
    from(): HTMLElement | undefined;
    /** Where the keyboard goes back after a conflict is settled. */
    focus(): void;
}

/** Where the session starts, and what it is told by the page. */
export interface SessionOptions {
    name: string;
    store?: Store;
    id?: string;
    mark?: string;
    /** Where version history is kept, for every store; in memory if not given. */
    versions?: VersionStorage;
    /** Says something in the status: a few words, and the whole of it. */
    say(short: string, full: string, tone?: "quiet" | "warn", stays?: boolean): void;
    onRename?: (name: string) => void;
    /** Told whenever the session moves to another document, so the page can remember it. */
    onOpen?: (store: Store, entry: Entry) => void;
}

/** A status in a word or two for the top. */
export const short = (status: Status, note?: string) => (status.state === "saved" ? (note ? "Download" : "Saved") : status.state === "saving" ? "Saving" : status.state === "waiting" ? "Not saved" : status.state === "changed" ? "Changed" : "Not saved");

/** Starts the session on the document the kind holds. */
export function createSession(body: Body, options: SessionOptions) {
    let name = options.name;
    let store = options.store;
    let id = options.id;
    const versions = options.versions ?? memoryStorage();
    // true when the document lives only in this tab until it is downloaded (a file opened from the computer) and has changed since
    let undownloaded = false;
    // true while a document is being put in place of another, which is not an edit of the one leaving
    let quiet = false;
    // true while a rename moves the document, and whether anything was typed meanwhile
    let moving = false;
    let typedWhileMoving = false;
    let renaming = Promise.resolve();
    /** What waits before a document is left: a rename typed in the title, not yet sent. */
    const settling = new Set<() => void>();
    const say = options.say;
    const place = () => body.placed({ store, id, name });
    place();

    // ---- version history: a snapshot on opening and after each pause in editing, kept by store and document ----
    const historyKey = () => (store && id ? `${store.label}:${id}` : name);
    const snapshot = () => {
        const { text, quire } = body.writing();
        return snapshotText(text, quire);
    };
    let keeper = createKeeper(versions, historyKey(), snapshot);
    void keeper.opened();

    // ---- saving as you type, and what to do when the document changed elsewhere ----
    let saver = store && id ? createSaver(store, id, options.mark ?? "") : undefined;
    const conflict = createConflict(async (choice) => {
        const asked = saver;
        if (!asked) return;
        if (choice === "mine") return void (await asked.choose("mine"));
        // what was typed here is kept in the version history before theirs takes its place
        const mine = snapshot();
        const key = historyKey();
        const theirs = await asked.choose("theirs");
        if (!theirs) return;
        await versions.save(key, mine, { time: Date.now(), ...changes(theirs.text, snapshotParts(mine).markdown) });
        // their text is shown only if the writer is still in the document it belongs to
        if (saver !== asked) return;
        quiet = true;
        body.replace(theirs);
        quiet = false;
    }, () => body.focus());
    const showStatus = (status: Status) => {
        body.status?.(status);
        say(short(status, store?.note), said(status, store?.note), status.state === "changed" || status.state === "failed" ? "warn" : "quiet", true);
        if (status.state === "changed" && saver) conflict.open(saver.unsaved() ?? body.writing().text, status.theirs?.text);
    };
    let stopListening = saver?.on(showStatus);
    if (saver) showStatus(saver.status());
    else say("", "This document is not being saved anywhere", "quiet", true);

    /** Told of each edit: saved once typing pauses, and kept in the history. */
    function changed() {
        // a document being put in place of another is not an edit of the one leaving
        if (quiet) return;
        if (store?.note) undownloaded = true;
        keeper.edited();
        if (moving) typedWhileMoving = true;
        else saver?.changed(() => body.writing());
    }

    // leaving the page with words not yet saved: they are saved if there is time, and the browser asks
    const leavingPage = (event: BeforeUnloadEvent) => {
        body.leaving?.();
        // a file opened from the computer is kept only in this tab: closing it loses what was not downloaded
        if (undownloaded) return event.preventDefault();
        if (saver?.unsaved() === undefined) return;
        void saver.flush();
        event.preventDefault();
    };
    addEventListener("beforeunload", leavingPage);

    /** Renames the document, one rename at a time. */
    function rename(value: string) {
        const run = renaming.then(() => renameNow(value));
        renaming = run.catch(() => undefined);
        return run;
    }

    /** Renames it to a name typed in the document (a title), unless another document has been opened by the time the rename comes round. */
    function renameTo(next: string) {
        if (next === name) return;
        const meant = { store, id };
        renaming = renaming.then(() => (store === meant.store && id === meant.id ? renameNow(next) : undefined)).catch(() => undefined);
    }

    async function renameNow(value: string) {
        if (!store || !id || !store.can.rename) {
            name = value;
            place();
            body.named(value);
            options.onRename?.(value);
            return;
        }
        if (saver?.status().state === "changed") {
            body.named(name);
            say("Not renamed", "Not renamed: it was changed somewhere else; choose which version to keep first", "warn");
            return;
        }
        await saver?.flush();
        const was = { store, id };
        // what is typed while the file moves is saved once it is in its new place, not into the old one
        moving = true;
        try {
            const moved = await was.store.rename(was.id, value);
            if (store !== was.store || id !== was.id) return;
            if (moved !== was.id) await follow(was.store, was.id, moved);
            name = (await was.store.list().catch(() => [])).find((entry) => entry.id === moved)?.name ?? value;
            place();
            body.named(name);
            options.onRename?.(value);
            options.onOpen?.(was.store, { id: moved, name });
        } catch (error) {
            body.named(name);
            say("Not renamed", `Not renamed: ${error instanceof Error ? error.message : String(error)}`, "warn");
        } finally {
            moving = false;
            if (typedWhileMoving) {
                typedWhileMoving = false;
                saver?.changed(() => body.writing());
            }
        }
    }

    /** After a rename that gave the document a new id (a path in a folder or a repository): saving, its history and what the kind keeps go on from there. */
    async function follow(where: Store, from: string, to: string) {
        const before = `${where.label}:${from}`;
        body.leaving?.();
        const mark = await (where.markOf ? where.markOf(to) : where.open(to).then((found) => found.mark)).catch(() => "");
        if (saver?.unsaved() !== undefined) typedWhileMoving = true;
        saver?.stop();
        stopListening?.();
        await keeper.now().catch(() => undefined);
        keeper.stop();
        id = to;
        place();
        saver = createSaver(where, to, mark);
        stopListening = saver.on(showStatus);
        showStatus(saver.status());
        await moveVersions(versions, before, historyKey()).catch(() => undefined);
        keeper = createKeeper(versions, historyKey(), snapshot);
        body.moved?.(before, historyKey());
    }

    /** Makes a new document there and opens it; given parts, it is made as a `.quire` document. */
    async function create(next: Store, wanted: string, text = "", quire?: Parts) {
        const made = await next.create(wanted, text, quire);
        const entry = (await next.list().catch(() => [])).find((each) => each.id === made.id) ?? { id: made.id, name: wanted };
        return open(next, entry);
    }

    /** Asks the writer what to do with changes that could not be saved: try again, stay, or leave them. A copy can be downloaded meanwhile. */
    const askUnsaved = (why: string) =>
        new Promise<"retry" | "stay" | "discard">((answer) => {
            let chosen: "retry" | "stay" | "discard" = "stay";
            // every way out is in the one row: leaving without saving, which loses the words, stands apart at the far left
            openDialog(body.from(), {
                title: "Not saved",
                className: "quire-unsaved-dialog",
                body: [make("p", "", `The latest changes to this document have not been saved: ${why}. They are still here.`)],
                others: [
                    { label: "Leave without saving", far: true, press: (dialog) => ((chosen = "discard"), void dialog.close()) },
                    { label: "Download a copy", press: () => body.download() },
                ],
                action: { label: "Try again", press: (_, open) => ((chosen = "retry"), void open.close()) },
                dismiss: "Stay",
                onClose: () => answer(chosen),
            });
        });

    /** Saves what is waiting before the document is let go. When it cannot be saved the writer is told and chooses; true when the document may go. */
    async function ready(): Promise<boolean> {
        // a rename on its way finishes first, so that what is saved goes to the document's new place
        await renaming;
        for (;;) {
            const now = saver;
            if (!now || !store?.can.save) return true;
            await now.flush();
            // what was typed while that save was on its way
            if (now.status().state === "waiting") await now.flush();
            if (now.unsaved() === undefined) return true;
            // whatever is chosen, what was typed is kept in the version history
            await keeper.now().catch(() => undefined);
            const status = now.status();
            const why = status.state === "failed" ? status.message : status.state === "changed" ? "it was changed somewhere else meanwhile" : "it is still waiting to be saved";
            const choice = await askUnsaved(why);
            if (choice === "stay") return false;
            if (choice === "discard" && saver === now) {
                now.stop();
                stopListening?.();
                stopListening = undefined;
                saver = undefined;
                return true;
            }
        }
    }

    /** Moves to a document: saves what is waiting in the old one, opens the new, and starts its saver and history. False when the writer stays where she is, or the new one could not be opened. */
    async function open(next: Store, entry: Entry): Promise<boolean> {
        for (const settle of settling) settle();
        if (!(await ready())) return false;
        let found: Opened;
        try {
            found = await next.open(entry.id);
        } catch (error) {
            // the document open stays open, still saving
            say("Not opened", `${entry.name} was not opened: ${error instanceof Error ? error.message : String(error)}`, "warn");
            return false;
        }
        // typed while the new one was being fetched
        if (saver?.unsaved() !== undefined && !(await ready())) return false;
        await keeper.now().catch(() => undefined);
        body.leaving?.();
        saver?.stop();
        stopListening?.();
        keeper.stop();
        store = next;
        id = entry.id;
        name = entry.name;
        place();
        body.named(name);
        quiet = true;
        body.load(found, entry);
        quiet = false;
        undownloaded = false;
        saver = createSaver(next, entry.id, found.mark);
        stopListening = saver.on(showStatus);
        showStatus(saver.status());
        keeper = createKeeper(versions, historyKey(), snapshot);
        void keeper.opened();
        options.onOpen?.(next, entry);
        return true;
    }

    /** Lets the document go: what is waiting is saved, and nothing is open. False when the writer stays. */
    async function leave(): Promise<boolean> {
        for (const settle of settling) settle();
        if (!(await ready())) return false;
        await keeper.now().catch(() => undefined);
        body.leaving?.();
        saver?.stop();
        stopListening?.();
        keeper.stop();
        saver = undefined;
        stopListening = undefined;
        store = undefined;
        id = undefined;
        name = "Untitled";
        place();
        body.named(name);
        quiet = true;
        body.empty();
        quiet = false;
        keeper = createKeeper(memoryStorage(), "", snapshot);
        say("", "Nothing is open", "quiet", true);
        return true;
    }

    return {
        changed,
        open,
        create,
        leave,
        ready,
        rename,
        renameTo,
        /** Something to do first whenever the document is about to be left (a rename typed and not yet sent). */
        settle: (run: () => void) => settling.add(run),
        current: () => ({ store, id, name }),
        flush: async () => {
            await saver?.flush();
        },
        status: () => saver?.status(),
        /** Says the document was downloaded, so leaving the tab no longer warns of words kept only here. */
        downloaded: () => void (undownloaded = false),
        /** Where its version history is kept now, and the keeper taking snapshots, for the history panel. */
        historyKey,
        keeper: {
            opened: () => keeper.opened(),
            edited: () => keeper.edited(),
            now: () => keeper.now(),
            settled: () => keeper.settled(),
            stop: () => keeper.stop(),
        },
        versions,
        conflict,
        destroy() {
            keeper.stop();
            saver?.stop();
            conflict.element.remove();
            removeEventListener("beforeunload", leavingPage);
        },
    };
}

/** A session, as a kind's editor holds it. */
export type Session = ReturnType<typeof createSession>;
