// Google Drive as a place for documents, locked in the browser with a passphrase before anything is
// sent (vault.ts), so that Drive holds only scrambled files. Google cannot open them, and neither can
// Google Docs.
//
// In the writer's Drive, in a folder named "mdQuire" that the app makes:
//
//   lock     a known sentence, locked: opening it proves the passphrase (vault.ts)
//   index    the documents' real names, which file holds each, and their pictures' names, locked
//   <random> one file per document and per picture, named with 32 random hex digits, locked under
//            that random key, so that a file put in another's place does not open
//
// So Drive learns no name, no word and no picture. What it does see is said in docs/mdQuire.md: that
// the app is used, how many files there are, their sizes, and when each changes.
//
// The version mark is Drive's head revision id. Drive v3 documents no conditional write (no If-Match
// on files.update), so a save is checked twice: before writing, the head must still be the mark; and
// after writing, the revision just before the new one must be the mark. If another device saved in
// the moment between, the second check finds its revision there, puts its bytes back on top, and
// reports the document as changed elsewhere: nothing is written over without the writer knowing.
// Every write keeps its revision so that it can be read back for this (drive.ts); the one before is
// let go once the next save is safely in place. A head that is a byte for byte copy of the mark
// (what such a putting back leaves) is not a change.
//
// The index is changed the same way. When it changed elsewhere, the change is made again on the
// newer index, so that two devices making documents at once both keep theirs.

import type { Drive, DriveFile } from "./drive";
import { SignInNeeded } from "./drive";
import { pictureType } from "./md/pictures";
import type { Parts } from "./quire-file";
import { freeName, StoreError, type Entry, type Opened, type Saved, type Store } from "./store";
import { Damaged, makeLock, openLock, randomBytes, sealText, seal, unseal, unsealText, type VaultKey } from "./vault";

/** The folder the app makes in the writer's Drive. */
export const FOLDER_NAME = "mdQuire";
const LOCK = "lock";
const INDEX = "index";

/** One document in the index. `file` is the Drive id of the file holding it. */
interface Kept {
    name: string;
    file: string;
    quire?: boolean;
    /** Its pictures by the name written in the document: the random key each is locked under, and its Drive file. */
    pictures?: Record<string, { key: string; file: string }>;
}

/** The index, as it is locked: documents by their random key. */
interface Index {
    version: 1;
    documents: Record<string, Kept>;
}

const DAMAGED = "this document's file in Google Drive is damaged or was changed outside mdQuire, so it is not opened";
const INDEX_DAMAGED = "the list of documents in Google Drive is damaged or was changed outside mdQuire";
const GONE = "this document is no longer in Google Drive";

/** A random key, 32 hex digits: a file's name in Drive and the label it is locked under. */
export function randomKey(): string {
    return [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const same = (one: Uint8Array, two: Uint8Array) => one.length === two.length && one.every((byte, at) => byte === two[at]);

/** What the vault in a Drive is, before the passphrase is given: whether there is one yet. */
export async function findVault(drive: Drive): Promise<{ folder?: string; lock?: DriveFile; index?: DriveFile; files: number }> {
    const folder = (await drive.folders(FOLDER_NAME))[0];
    if (!folder) return { files: 0 };
    const inside = await drive.children(folder.id);
    return { folder: folder.id, lock: inside.find((file) => file.name === LOCK), index: inside.find((file) => file.name === INDEX), files: inside.length };
}

/** The Drive store with the vault opened, and a way to take its key out of memory. */
export type DriveStore = Store & { lockAway(): void };

/**
 * Opens the vault in a Drive with a passphrase, making it (folder, lock and an empty index) if there
 * is none yet. A wrong passphrase throws WrongPassphrase (vault.ts). `iterations` is for tests alone.
 */
export async function openVault(drive: Drive, passphrase: string, options: { iterations?: number; onSignInNeeded?: () => void } = {}): Promise<DriveStore> {
    const found = await findVault(drive);
    const folder = found.folder ?? (await drive.folder(FOLDER_NAME));
    let vault: VaultKey;
    if (found.lock) vault = await openLock(passphrase, (await drive.read(found.lock.id)).bytes);
    else {
        const made = await makeLock(passphrase, options.iterations);
        vault = made.vault;
        await drive.create(LOCK, made.lock, folder);
    }
    const index = found.index?.id ?? (await drive.create(INDEX, await sealText(vault, INDEX, JSON.stringify({ version: 1, documents: {} } satisfies Index)), folder)).id;
    return driveStore(drive, vault, { folder, index }, options.onSignInNeeded);
}

/** The result of a checked write: written, or refused with what is there now. */
type Written = { ok: true; revision: string } | { ok: false; theirs: { bytes: Uint8Array; revision: string } };

/** Writes a file only if it is still the revision `mark`, checked before and after, as the opening comment says. */
export async function writeChecked(drive: Drive, id: string, bytes: Uint8Array, mark: string): Promise<Written> {
    const head = await drive.revision(id);
    const letGo = [mark];
    if (head !== mark) {
        // a head that is a copy of the mark put back after a moment's clash is not a change
        const now = await drive.read(id);
        const was = await drive.readRevision(id, mark).catch(() => undefined);
        if (!was || !same(was, now.bytes)) return { ok: false, theirs: now };
        letGo.push(now.revision);
        mark = now.revision;
    }
    const mine = await drive.write(id, bytes);
    const order = await drive.revisions(id);
    const at = order.indexOf(mine);
    const before = at > 0 ? order[at - 1] : undefined;
    if (at < 0 || before === mark) {
        // safely in place: the revisions before it may be cleared away by Drive in time
        for (const each of letGo) await drive.release(id, each).catch(() => undefined);
        return { ok: true, revision: mine };
    }
    // another save landed between the check and this write: theirs goes back on top, and mine is refused
    const theirs = await drive.readRevision(id, before!);
    const restored = await drive.write(id, theirs);
    await drive.release(id, mine).catch(() => undefined);
    return { ok: false, theirs: { bytes: theirs, revision: restored } };
}

/** The store over an opened vault. `place` is the folder and the index file in Drive. */
export function driveStore(drive: Drive, vault: VaultKey | undefined, place: { folder: string; index: string }, onSignInNeeded?: () => void): DriveStore {
    let key = vault;
    let known: { index: Index; revision: string } | undefined;
    const urls = new Map<string, string>();

    /** Every call to Drive, so that a refused token asks the writer to sign in again. */
    async function call<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } catch (error) {
            if (error instanceof SignInNeeded) onSignInNeeded?.();
            throw error;
        }
    }
    const opened = () => {
        if (!key) throw new StoreError("Google Drive is locked; open it again with your passphrase");
        return key;
    };
    const decode = async (bytes: Uint8Array): Promise<Index> => {
        try {
            const index = JSON.parse(await unsealText(opened(), INDEX, bytes)) as Index;
            if (!index || typeof index.documents !== "object") throw new Damaged("no documents");
            return index;
        } catch (error) {
            if (error instanceof StoreError) throw error;
            throw new StoreError(INDEX_DAMAGED);
        }
    };
    async function index(): Promise<Index> {
        const read = await call(() => drive.read(place.index));
        known = { index: await decode(read.bytes), revision: read.revision };
        return known.index;
    }
    /** Changes the index, made again on a newer one as many times as it changed elsewhere meanwhile. */
    async function change<T>(update: (index: Index) => T): Promise<T> {
        if (!known) await index();
        let now = known!;
        for (let tries = 0; tries < 6; tries++) {
            const next = structuredClone(now.index);
            const result = update(next);
            const sealed = await sealText(opened(), INDEX, JSON.stringify(next));
            const written = await call(() => writeChecked(drive, place.index, sealed, now.revision));
            if (written.ok) {
                known = { index: next, revision: written.revision };
                return result;
            }
            now = { index: await decode(written.theirs.bytes), revision: written.theirs.revision };
            known = now;
        }
        throw new StoreError("the list of documents kept changing in Google Drive; try again");
    }
    /** A document's entry, from the index as last read unless `fresh`, and read afresh when it is not there. */
    const entry = async (id: string, fresh = false): Promise<Kept> => {
        const found = (!fresh && known?.index.documents[id]) || (await index()).documents[id];
        if (!found) throw new StoreError(GONE);
        return found;
    };
    const writing = (text: string, quire?: Parts) => JSON.stringify(quire ? { text, quire } : { text });
    const reading = async (id: string, bytes: Uint8Array, revision: string): Promise<Opened> => {
        let value: { text?: unknown; quire?: Parts };
        try {
            value = JSON.parse(await unsealText(opened(), id, bytes));
        } catch (error) {
            if (error instanceof StoreError) throw error;
            throw new StoreError(DAMAGED);
        }
        if (typeof value.text !== "string") throw new StoreError(DAMAGED);
        return { text: value.text, mark: revision, ...(value.quire ? { quire: value.quire } : {}) };
    };
    const names = (index: Index, except?: string) => Object.entries(index.documents).filter(([id]) => id !== except).map(([, kept]) => kept.name);

    return {
        label: "Google Drive",
        quire: true,
        can: { list: true, create: true, rename: true, remove: true, pictures: true, save: true },
        async list(): Promise<Entry[]> {
            const [now, inside] = await Promise.all([index(), call(() => drive.children(place.folder))]);
            const times = new Map(inside.map((file) => [file.id, file.modified]));
            return Object.entries(now.documents)
                .map(([id, kept]) => ({ id, name: kept.name, modified: times.get(kept.file) }))
                .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
        },
        async open(id) {
            const kept = await entry(id, true);
            const read = await call(() => drive.read(kept.file));
            return reading(id, read.bytes, read.revision);
        },
        async save(id, text, mark, quire): Promise<Saved> {
            const kept = await entry(id);
            const sealed = await sealText(opened(), id, writing(text, quire));
            const written = await call(() => writeChecked(drive, kept.file, sealed, mark));
            if (written.ok) return { ok: true, mark: written.revision };
            const theirs = await reading(id, written.theirs.bytes, written.theirs.revision).catch(() => undefined);
            return { ok: false, changed: true, theirs };
        },
        async create(name, text, quire) {
            const id = randomKey();
            const made = await call(async () => drive.create(id, await sealText(opened(), id, writing(text, quire)), place.folder));
            try {
                await change((index) => {
                    index.documents[id] = { name: freeName(name.trim() || "Untitled", names(index)), file: made.id, ...(quire ? { quire: true } : {}) };
                });
            } catch (error) {
                // a file the index does not name is of no use to anyone: it goes to the bin
                await drive.trash(made.id).catch(() => undefined);
                throw error;
            }
            return { id, mark: made.revision };
        },
        async rename(id, name) {
            await entry(id);
            await change((index) => {
                const kept = index.documents[id];
                if (!kept) throw new StoreError(GONE);
                kept.name = freeName(name.trim() || kept.name, names(index, id));
            });
            return id;
        },
        async remove(id) {
            const kept = await change((index) => {
                const found = index.documents[id];
                if (!found) throw new StoreError(GONE);
                delete index.documents[id];
                return found;
            });
            // the files go to Drive's bin; without the index's name for them they hold nothing anyone can read
            for (const file of [kept.file, ...Object.values(kept.pictures ?? {}).map((each) => each.file)]) await call(() => drive.trash(file)).catch(() => undefined);
        },
        async savePicture(id, picture, name) {
            await entry(id);
            const pictureKey = randomKey();
            const sealed = await seal(opened(), pictureKey, new Uint8Array(await picture.arrayBuffer()));
            const made = await call(() => drive.create(pictureKey, sealed, place.folder));
            const free = await change((index) => {
                const kept = index.documents[id];
                if (!kept) throw new StoreError(GONE);
                kept.pictures ??= {};
                const free = freeName(name.replace(/[^\w.-]+/g, "-") || "picture.png", Object.keys(kept.pictures));
                kept.pictures[free] = { key: pictureKey, file: made.id };
                return free;
            });
            return `pictures/${free}`;
        },
        async pictures(id) {
            const kept = await entry(id);
            const found = new Map<string, Blob>();
            for (const [name, each] of Object.entries(kept.pictures ?? {})) {
                const bytes = await unseal(opened(), each.key, (await call(() => drive.read(each.file))).bytes).catch(() => undefined);
                if (bytes) found.set(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: pictureType(bytes, name) }));
            }
            return found;
        },
        async show(id, address) {
            const match = /^(?:\.\/)?pictures\/([^/]+)$/.exec(address);
            if (!match) return undefined;
            const name = decodeURIComponent(match[1]!);
            const where = `${id}/${name}`;
            if (urls.has(where)) return urls.get(where);
            const each = (await entry(id)).pictures?.[name];
            if (!each || typeof URL.createObjectURL !== "function") return undefined;
            const bytes = await unseal(opened(), each.key, (await call(() => drive.read(each.file))).bytes).catch(() => undefined);
            if (!bytes) return undefined;
            const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: pictureType(bytes, name) }));
            urls.set(where, url);
            return url;
        },
        lockAway() {
            key = undefined;
            known = undefined;
            for (const url of urls.values()) URL.revokeObjectURL?.(url);
            urls.clear();
        },
    };
}
