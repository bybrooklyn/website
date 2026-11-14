// Keeping the text models in the browser: each file fetched once from its pinned address, checked
// against its SHA-256 before it is kept, and kept in the browser's private file storage under a name
// that says its repository, commit and path, with a mark beside it saying its digest. A file is used
// only when its mark is its digest and its size its size, so a file of another commit, or one cut
// short, is fetched again rather than trusted. The storage and the network are passed in, so this
// runs on the private file storage in the worker and on plain objects in the tests.

import { addressOf, HOST, keptName, type ModelFile, type Tier } from "./models";

/** Where the files are kept: written whole, read whole, marked, and their sizes known. */
export interface Shelf {
    write(name: string, bytes: Uint8Array): Promise<void>;
    read(name: string): Promise<Uint8Array | undefined>;
    size(name: string): Promise<number>;
    mark(name: string, said: string): Promise<void>;
    marked(name: string): Promise<string | undefined>;
}

/** The SHA-256 of some bytes, in hex. */
export async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether a file is kept whole: marked with its digest, and its size. */
export async function kept(shelf: Shelf, each: ModelFile): Promise<boolean> {
    const name = keptName(each);
    return (await shelf.marked(name)) === each.sha256 && (await shelf.size(name)) === each.bytes;
}

/** Whether every file of a tier is kept whole. */
export async function keptAll(shelf: Shelf, tier: Tier): Promise<boolean> {
    for (const each of tier.files) if (!(await kept(shelf, each))) return false;
    return true;
}

/** Bytes of a tier already kept, for the progress to start from. */
export async function keptBytes(shelf: Shelf, tier: Tier): Promise<number> {
    let sum = 0;
    for (const each of tier.files) if (await kept(shelf, each)) sum += each.bytes;
    return sum;
}

/**
 * Fetches every file of a tier not yet kept, telling `progress` the bytes of the tier in hand. The
 * host is told which file is wanted and nothing of the page it is wanted from; no request carries
 * anything of the picture. A file whose size or digest is not the table's is refused and not kept.
 */
export async function fetchTier(tier: Tier, shelf: Shelf, how: { progress?(bytes: number): void; signal?: AbortSignal; fetch?: typeof fetch; host?: string }): Promise<void> {
    const get = how.fetch ?? fetch;
    let finished = 0;
    for (const each of tier.files) {
        if (await kept(shelf, each)) {
            finished += each.bytes;
            how.progress?.(finished);
            continue;
        }
        const answer = await get(addressOf(each, how.host ?? HOST), { signal: how.signal, referrerPolicy: "no-referrer", credentials: "omit" });
        if (!answer.ok || !answer.body) throw new Error(`${each.repo}/${each.path}: the server answered ${answer.status}`);
        const bytes = new Uint8Array(each.bytes);
        let have = 0;
        const reader = answer.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (have + value.length > each.bytes) throw new Error(`${each.repo}/${each.path} is longer than ${each.bytes} bytes`);
            bytes.set(value, have);
            have += value.length;
            how.progress?.(finished + have);
        }
        if (have !== each.bytes) throw new Error(`${each.repo}/${each.path} arrived as ${have} bytes, not ${each.bytes}`);
        if ((await sha256(bytes)) !== each.sha256) throw new Error(`${each.repo}/${each.path} is not the file it should be (its digest does not match)`);
        const name = keptName(each);
        await shelf.mark(name, "");
        await shelf.write(name, bytes);
        await shelf.mark(name, each.sha256);
        finished += each.bytes;
    }
}

/** A kept file's bytes, checked again against its digest before a model is made from them. */
export async function bytesOf(shelf: Shelf, each: ModelFile): Promise<Uint8Array> {
    const bytes = await shelf.read(keptName(each));
    if (!bytes || bytes.length !== each.bytes || (await sha256(bytes)) !== each.sha256) throw new Error(`${each.repo}/${each.path} is not kept whole; read the text again to fetch it`);
    return bytes;
}

/** The shelf on the browser's private file storage, in a folder of its own. */
export async function privateShelf(folder = "imgquire-text"): Promise<Shelf> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(folder, { create: true });
    const fileOf = (name: string) => dir.getFileHandle(name).then((handle) => handle.getFile(), () => undefined);
    const put = async (name: string, bytes: Uint8Array) => {
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write(bytes as Uint8Array<ArrayBuffer>);
        await writable.close();
    };
    return {
        write: put,
        read: async (name) => {
            const found = await fileOf(name);
            return found && new Uint8Array(await found.arrayBuffer());
        },
        size: async (name) => (await fileOf(name))?.size ?? -1,
        mark: (name, said) => put(`${name}.whole`, new TextEncoder().encode(said)),
        marked: async (name) => (await fileOf(`${name}.whole`))?.text(),
    };
}
