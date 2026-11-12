// The store `bun run edit` writes through: the files of this site, on this computer, by way of the
// small server in scripts/write.ts. A file's hash is its version mark, so a file changed on disk
// since it was opened (by another editor, or git) is refused rather than written over. New posts
// are made by the server's own new-post endpoint, with its frontmatter. Files are not renamed or
// taken away from here: that is done in the repository.

import { StoreError, type Entry, type Store } from "../../src/quire/store";

/** One file the server offers, in a group of the list. */
export interface Offered {
    path: string;
    label: string;
    draft: boolean;
    route: string;
}

/** The photo notes, which are not a document but a page of their own. */
export const PHOTOS = "src/data/photos.json";

/** Asks the server, with the key it printed. */
export function server(key: string) {
    return async function ask<T>(path: string, body?: unknown, raw?: Blob): Promise<T> {
        const answer = await fetch(path, {
            method: body === undefined && raw === undefined ? "GET" : "POST",
            headers: { "x-edit-key": key, ...(raw ? {} : body === undefined ? {} : { "content-type": "application/json" }) },
            body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        });
        const said = (await answer.json().catch(() => ({}))) as T & { error?: string };
        if (!answer.ok) throw Object.assign(new StoreError(said.error ?? `the server answered ${answer.status}`), { status: answer.status });
        return said;
    };
}

/** The store over the server. `files` is told the list each time it is read, with each file's group and page. */
export function editStore(key: string, files: (groups: { label: string; files: Offered[] }[]) => void = () => {}): Store {
    const ask = server(key);
    return {
        label: "This site",
        can: { list: true, create: true, rename: false, remove: false, pictures: true, save: true },
        async list(): Promise<Entry[]> {
            const groups = await ask<{ label: string; files: Offered[] }[]>("/api/files");
            files(groups);
            return groups.flatMap((group) => group.files.map((file) => ({ id: file.path, name: group.label ? `${group.label}: ${file.label}${file.draft ? " (draft)" : ""}` : file.label })));
        },
        async open(id) {
            const opened = await ask<{ content: string; hash: string }>(`/api/file?path=${encodeURIComponent(id)}`);
            return { text: opened.content, mark: opened.hash };
        },
        async save(id, text, mark) {
            try {
                const saved = await ask<{ hash: string }>("/api/save", { path: id, content: text, hash: mark });
                return { ok: true, mark: saved.hash };
            } catch (error) {
                if ((error as { status?: number }).status === 409) {
                    const theirs = await ask<{ content: string; hash: string }>(`/api/file?path=${encodeURIComponent(id)}`).catch(() => undefined);
                    return { ok: false, changed: true, theirs: theirs && { text: theirs.content, mark: theirs.hash } };
                }
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        async create(name, _text) {
            const { path } = await ask<{ path: string }>("/api/new", { title: name });
            const opened = await ask<{ content: string; hash: string }>(`/api/file?path=${encodeURIComponent(path)}`);
            return { id: path, mark: opened.hash };
        },
        async rename() {
            throw new StoreError("a file is renamed in the repository, not here");
        },
        async remove() {
            throw new StoreError("a file is taken away in the repository, not here");
        },
        async savePicture(id, picture, name) {
            const { url } = await ask<{ url: string }>(`/api/upload?file=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, undefined, picture);
            return url;
        },
        async show(id, address) {
            if (/^[a-z]+:/i.test(address)) return undefined;
            return `/api/asset?file=${encodeURIComponent(id)}&src=${encodeURIComponent(address)}&k=${key}`;
        },
    };
}
