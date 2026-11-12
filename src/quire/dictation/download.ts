// Fetching a model's files into storage, so that a download which is interrupted (the tab closed,
// the connection lost, the visitor pressing cancel) carries on from the bytes already kept instead
// of starting again. A file is written as it arrives and is marked whole only when every byte of it
// is there. The storage is passed in, so this runs on the browser's private file storage in the
// engine worker and on a plain object in the tests.

import { addressOf, type Tier } from "./models";

/** A file being written. */
export interface Writing {
    size(): number;
    write(data: Uint8Array, at: number): void;
    truncate(size: number): void;
    flush(): void;
    close(): void;
}

/** The folder a tier's files are kept in. */
export interface Folder {
    /** Opens a file for writing, making it if it is not there. */
    open(name: string): Promise<Writing>;
    /** Whether a file is marked whole. */
    whole(name: string): Promise<boolean>;
    /** Marks a file whole. */
    mark(name: string): Promise<void>;
}

/** The name a file of a tier has in storage. */
export const nameOf = (path: string): string => path.replaceAll("/", "__");

/** Fetches every file of the tier that is not whole in the folder yet, telling `progress` the bytes of the tier that are in storage. */
export async function download(tier: Tier, folder: Folder, how: { signal?: AbortSignal; progress: (bytes: number) => void; fetch?: typeof fetch }): Promise<void> {
    const get = how.fetch ?? fetch;
    let finished = 0;
    for (const file of tier.files) {
        const name = nameOf(file.path);
        if (await folder.whole(name)) {
            finished += file.bytes;
            how.progress(finished);
            continue;
        }
        const writing = await folder.open(name);
        try {
            let have = writing.size();
            if (have > file.bytes) {
                writing.truncate(0);
                have = 0;
            }
            if (have < file.bytes) {
                const answer = await get(addressOf(tier, file), { signal: how.signal, headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
                if (!answer.ok || !answer.body) throw new Error(`${file.path}: the server answered ${answer.status}`);
                // a server that ignores the range sends the whole file again
                if (have > 0 && answer.status !== 206) {
                    writing.truncate(0);
                    have = 0;
                }
                const reader = answer.body.getReader();
                let since = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        writing.write(value, have);
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
            if (have !== file.bytes) throw new Error(`${file.path} arrived as ${have} bytes, not ${file.bytes}`);
        } finally {
            writing.close();
        }
        await folder.mark(name);
        finished += file.bytes;
    }
}
