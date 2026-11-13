// Fetching a model's files into storage, so that a download which is interrupted (the tab closed,
// the connection lost, the visitor pressing cancel) carries on from the bytes already kept instead
// of starting again. A file is written as it arrives and is marked whole only when every byte of it
// is there, and its digest matches when the table gives one. The mark says which revision, size and
// digest the file was fetched for, so a file kept from an older table is fetched again rather than
// trusted for ever. The storage is passed in, so this runs on the browser's private file storage in
// the engine worker and on a plain object in the tests.

import { addressOf, type ModelFile, type Tier } from "./models";

/** A file being written. */
export interface Writing {
    size(): number;
    /** Writes bytes at a place and gives back how many were written. */
    write(data: Uint8Array, at: number): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
}

/** The folder a tier's files are kept in. */
export interface Folder {
    /** Opens a file for writing, making it if it is not there. */
    open(name: string): Promise<Writing>;
    /** What a file's mark says, or undefined when it has none. */
    marked(name: string): Promise<string | undefined>;
    /** Marks a file with what it holds: `signatureOf` once it is whole, or `partial` and that while it is arriving. */
    mark(name: string, signature: string): Promise<void>;
    /** The size of a kept file, or -1 if there is none. */
    size(name: string): Promise<number>;
    /** Reads a kept file whole, to check its digest. */
    read(name: string): Promise<Uint8Array>;
}

/** The name a file of a tier has in storage. */
export const nameOf = (path: string): string => path.replaceAll("/", "__");

/** What a whole file's mark says: the revision it was fetched at, its size, and its digest if the table gives one. */
export const signatureOf = (tier: Pick<Tier, "revision">, file: ModelFile): string => `${tier.revision} ${file.bytes} ${file.sha256 ?? ""}`.trim();

/** What a mark says while the file is arriving. */
const partial = (signature: string) => `partial ${signature}`;

/**
 * Whether a kept file can be trusted as whole for the table as it is now: its mark is the file's
 * signature and its size is the table's. A mark written before marks said anything (an empty file)
 * stands for the branch "main" with no digest, so a table still on that branch keeps such a file and
 * a table pinned to a commit fetches it again.
 */
export function whole(tier: Pick<Tier, "revision">, file: ModelFile, mark: string | undefined, size: number): boolean {
    if (mark === undefined || size !== file.bytes) return false;
    return (mark === "" ? signatureOf({ revision: "main" }, { ...file, sha256: undefined }) : mark) === signatureOf(tier, file);
}

/** The SHA-256 of some bytes, in hex. */
export async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Fetches every file of the tier that is not whole in the folder yet, telling `progress` the bytes of the tier that are in storage. */
export async function download(tier: Tier, folder: Folder, how: { signal?: AbortSignal; progress: (bytes: number) => void; fetch?: typeof fetch }): Promise<void> {
    const get = how.fetch ?? fetch;
    const ask = (file: ModelFile, from: number) => get(addressOf(tier, file), { signal: how.signal, headers: from > 0 ? { Range: `bytes=${from}-` } : {} });
    let finished = 0;
    for (const file of tier.files) {
        const name = nameOf(file.path);
        const signature = signatureOf(tier, file);
        const mark = await folder.marked(name);
        if (whole(tier, file, mark, await folder.size(name))) {
            finished += file.bytes;
            how.progress(finished);
            continue;
        }
        // Bytes kept for this same signature, or from before marks said anything, are carried on from;
        // bytes of any other revision, size or digest are dropped, so two versions are never joined.
        const resume = mark === undefined || mark === partial(signature);
        await folder.mark(name, partial(signature));
        const writing = await folder.open(name);
        try {
            let have = writing.size();
            if (!resume || have > file.bytes) {
                writing.truncate(0);
                have = 0;
            }
            if (have < file.bytes) {
                let answer = await ask(file, have);
                if (!answer.ok || !answer.body) throw new Error(`${file.path}: the server answered ${answer.status}`);
                // a server that ignores the range sends the whole file again, and one that answers from another place is asked again from the start
                const from = /^bytes (\d+)-/.exec(answer.headers.get("content-range") ?? "")?.[1];
                if (have > 0 && (answer.status !== 206 || (from !== undefined && Number(from) !== have))) {
                    writing.truncate(0);
                    if (answer.status === 206) {
                        await answer.body.cancel();
                        answer = await ask(file, 0);
                        if (!answer.ok || !answer.body) throw new Error(`${file.path}: the server answered ${answer.status}`);
                    }
                    have = 0;
                }
                const reader = answer.body.getReader();
                let since = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (have + value.length > file.bytes) throw new Error(`${file.path} is longer than ${file.bytes} bytes`);
                        const wrote = writing.write(value, have);
                        if (wrote !== value.length) throw new Error(`${file.path}: only ${wrote} of ${value.length} bytes could be kept`);
                        have += value.length;
                        since += value.length;
                        if (since > 32e6) {
                            writing.flush();
                            since = 0;
                        }
                        how.progress(finished + have);
                    }
                } finally {
                    writing.flush();
                }
            }
            const size = writing.size();
            if (size !== file.bytes) throw new Error(`${file.path} arrived as ${size} bytes, not ${file.bytes}`);
        } finally {
            writing.close();
        }
        if (file.sha256 && (await sha256(await folder.read(name))) !== file.sha256) {
            // the bytes are not the ones the table names: they are dropped, so that the next try starts clean
            const drop = await folder.open(name);
            drop.truncate(0);
            drop.close();
            throw new Error(`${file.path} is not the file it should be (its digest does not match)`);
        }
        await folder.mark(name, signature);
        finished += file.bytes;
    }
}
