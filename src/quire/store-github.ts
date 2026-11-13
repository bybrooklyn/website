// A GitHub repository as a place for documents, for writing the site's own posts. It is given once
// a repository (owner/name), a branch, a folder of documents, a folder for pictures and a
// fine-grained personal access token that may only touch that repository's contents. The settings
// and the token are kept only in this browser's localStorage and are sent only to api.github.com;
// forgetSettings takes them away.
//
// The Markdown files in the folder are listed, opened and saved through GitHub's REST contents
// API, the blob SHA serving as the version mark: a save whose SHA no longer matches is refused as
// changed elsewhere. Each save is a commit with a plain message. Pictures are uploaded the same way
// into their folder, and written in the document by a path relative to it. Nothing else is asked
// of the network. Tested against a mock of the API.

import { besideDocument, fileName, freeName, relative, type Saved, type Store, StoreError } from "./store";
import { markdownFile } from "./store-files";

/** What the repository store is told once, and keeps in this browser. */
export interface GithubSettings {
    owner: string;
    repo: string;
    branch: string;
    folder: string;
    pictures: string;
    token: string;
}

/** Where in localStorage the settings are kept, so that they can be found and taken away. */
export const SETTINGS_KEY = "quire-github";
const API = "https://api.github.com";

/** The settings kept in this browser, if there are any. */
export function readSettings(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): GithubSettings | undefined {
    try {
        const kept = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? "null") as GithubSettings | null;
        return kept && kept.owner && kept.repo && kept.token ? kept : undefined;
    } catch {
        return undefined;
    }
}

/** Keeps the settings in this browser. */
export function keepSettings(settings: GithubSettings, storage: Pick<Storage, "setItem"> = globalThis.localStorage) {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Takes the settings, token and all, out of this browser. */
export function forgetSettings(storage: Pick<Storage, "removeItem"> = globalThis.localStorage) {
    storage.removeItem(SETTINGS_KEY);
}

/** Reads `owner/name` (or a github.com address) into its two parts, or undefined if it is not one. */
export function repository(text: string): { owner: string; repo: string } | undefined {
    const match = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(text.trim());
    return match ? { owner: match[1]!, repo: match[2]! } : undefined;
}

/** A folder path as GitHub wants it: no slashes at either end, no `.` or `..` steps. */
export function folderPath(text: string): string {
    return text
        .split("/")
        .filter((step) => step && step !== "." && step !== "..")
        .join("/");
}

/** The network, as the store uses it: one request, one answer. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const encode = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
    return Uint8Array.from(atob(text.replace(/\s+/g, "")), (char) => char.charCodeAt(0));
}

/** The store over a repository. `fetcher` is the network, given so that tests can stand in for GitHub. */
export function githubStore(settings: GithubSettings, fetcher: Fetcher = (url, init) => fetch(url, init)): Store {
    const folder = folderPath(settings.folder);
    const pictures = folderPath(settings.pictures);
    const branch = settings.branch || "main";
    const contents = (path: string) => `/repos/${encode(settings.owner)}/${encode(settings.repo)}/contents/${encode(path)}`;

    async function ask(method: string, path: string, body?: object, accept = "application/vnd.github+json"): Promise<Response> {
        let answer: Response;
        try {
            answer = await fetcher(`${API}${path}`, {
                method,
                headers: { Accept: accept, Authorization: `Bearer ${settings.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
                body: body ? JSON.stringify(body) : undefined,
                cache: "no-store",
            });
        } catch {
            throw new StoreError("GitHub could not be reached");
        }
        if (answer.status === 401) throw new StoreError("GitHub refused the token; it may have run out or been taken back");
        // GitHub answers 403 (or 429) both for a token that may not do this and for too many requests; its headers tell them apart
        const limited = answer.status === 429 || (answer.status === 403 && (answer.headers.get("x-ratelimit-remaining") === "0" || answer.headers.has("retry-after")));
        if (limited) throw new StoreError("GitHub has had too many requests for now; it will be tried again after the next change, or try again in a few minutes");
        if (answer.status === 403) throw new StoreError("the token may not do this; it needs read and write access to this repository's contents");
        return answer;
    }

    /** A file's text and SHA, read in full even when it is too large for the contents API to send whole. */
    async function read(path: string): Promise<{ text: string; sha: string }> {
        const answer = await ask("GET", `${contents(path)}?ref=${encodeURIComponent(branch)}`);
        if (answer.status === 404) throw new StoreError(`${path} is not in ${settings.owner}/${settings.repo} on ${branch}`);
        if (!answer.ok) throw new StoreError(`GitHub answered ${answer.status}`);
        const file = (await answer.json()) as { content?: string; encoding?: string; sha: string; size?: number };
        let bytes: Uint8Array;
        if (file.encoding === "base64" && (file.content || !file.size)) bytes = fromBase64(file.content ?? "");
        else {
            const blob = await ask("GET", `/repos/${encode(settings.owner)}/${encode(settings.repo)}/git/blobs/${file.sha}`);
            if (!blob.ok) throw new StoreError(`GitHub answered ${blob.status}`);
            bytes = fromBase64(((await blob.json()) as { content: string }).content);
        }
        return { text: new TextDecoder().decode(bytes), sha: file.sha };
    }

    async function put(path: string, bytes: Uint8Array, message: string, sha?: string): Promise<{ status: number; sha?: string; message?: string }> {
        const answer = await ask("PUT", contents(path), { message, content: toBase64(bytes), branch, ...(sha ? { sha } : {}) });
        if (answer.ok) return { status: answer.status, sha: ((await answer.json()) as { content: { sha: string } }).content.sha };
        const said = await answer.json().then((body: { message?: string }) => body?.message, () => undefined);
        return { status: answer.status, message: typeof said === "string" ? said : undefined };
    }

    async function names(path: string): Promise<string[]> {
        const answer = await ask("GET", `${contents(path)}?ref=${encodeURIComponent(branch)}`);
        if (answer.status === 404) return [];
        if (!answer.ok) throw new StoreError(`GitHub answered ${answer.status}`);
        const listed = (await answer.json()) as { name: string }[] | object;
        return Array.isArray(listed) ? listed.map((entry) => entry.name) : [];
    }

    const nameOf = (path: string) => path.split("/").at(-1)!;
    const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);

    return {
        label: `${settings.owner}/${settings.repo}`,
        can: { list: true, create: true, rename: true, remove: true, pictures: true, save: true },
        async list() {
            const answer = await ask("GET", `${contents(folder)}?ref=${encodeURIComponent(branch)}`);
            if (answer.status === 404) throw new StoreError(`there is no folder ${folder || "at the top"} on ${branch}`);
            if (!answer.ok) throw new StoreError(`GitHub answered ${answer.status}`);
            const listed = (await answer.json()) as { type: string; name: string; path: string }[];
            return listed.filter((entry) => entry.type === "file" && markdownFile(entry.name)).map((entry) => ({ id: entry.path, name: entry.name }));
        },
        async open(id) {
            const file = await read(id);
            return { text: file.text, mark: file.sha };
        },
        async save(id, text, mark): Promise<Saved> {
            const done = await put(id, new TextEncoder().encode(text), `Edit ${nameOf(id)}`, mark);
            if (done.sha) return { ok: true, mark: done.sha };
            // a SHA that no longer matches: someone saved it elsewhere. GitHub also answers 422 for a path or a file it will not take, which is a failure, not a conflict
            if (done.status === 409 || (done.status === 422 && /sha/i.test(done.message ?? ""))) {
                const theirs = await read(id).catch(() => undefined);
                return { ok: false, changed: true, theirs: theirs && { text: theirs.text, mark: theirs.sha } };
            }
            return { ok: false, message: done.status === 404 ? `${id} or its branch is not there` : done.status === 422 ? "GitHub would not take this file (it may be too large)" : `GitHub answered ${done.status}` };
        },
        async create(name, text) {
            // a plain file name, as the folder store makes: a title with a slash in it must not become a folder
            const path = inFolder(freeName(fileName(name), await names(folder)));
            const done = await put(path, new TextEncoder().encode(text), `Add ${nameOf(path)}`);
            if (!done.sha) throw new StoreError(`GitHub answered ${done.status}`);
            return { id: path, mark: done.sha };
        },
        async markOf(id) {
            const answer = await ask("GET", `${contents(id)}?ref=${encodeURIComponent(branch)}`);
            if (!answer.ok) throw new StoreError(answer.status === 404 ? `${id} is not in ${settings.owner}/${settings.repo} on ${branch}` : `GitHub answered ${answer.status}`);
            return ((await answer.json()) as { sha: string }).sha;
        },
        async rename(id, name) {
            const file = await read(id);
            const path = inFolder(freeName(fileName(name, /\.mdx$/i.test(id) ? ".mdx" : ".md"), (await names(folder)).filter((each) => each !== nameOf(id))));
            if (path === id) return id;
            const made = await put(path, new TextEncoder().encode(file.text), `Rename ${nameOf(id)} to ${nameOf(path)}`);
            if (!made.sha) throw new StoreError(`GitHub answered ${made.status}`);
            const gone = await ask("DELETE", contents(id), { message: `Rename ${nameOf(id)} to ${nameOf(path)}`, sha: file.sha, branch });
            if (!gone.ok) throw new StoreError(`the new file was made, but GitHub answered ${gone.status} when the old one was taken away`);
            return path;
        },
        async remove(id) {
            // the file stays in the repository's history, from where it can be brought back
            const file = await read(id);
            const gone = await ask("DELETE", contents(id), { message: `Remove ${nameOf(id)}`, sha: file.sha, branch });
            if (!gone.ok) throw new StoreError(`GitHub answered ${gone.status}`);
        },
        async savePicture(id, picture, name) {
            const free = freeName(name.replace(/[^\w.-]+/g, "-") || "picture.png", await names(pictures));
            const path = pictures ? `${pictures}/${free}` : free;
            const done = await put(path, new Uint8Array(await picture.arrayBuffer()), `Add picture ${free}`);
            if (!done.sha) throw new StoreError(`GitHub answered ${done.status}`);
            return relative(id, path);
        },
        async exists(id, address) {
            const path = besideDocument(id, address);
            if (path === undefined) return undefined;
            const answer = await ask("GET", `${contents(path)}?ref=${encodeURIComponent(branch)}`).catch(() => undefined);
            return answer?.ok ? true : answer?.status === 404 ? false : undefined;
        },
        async show(id, address) {
            if (/^[a-z]+:|^\//i.test(address)) return undefined;
            // the picture's place in the repository, from the document's folder and the address in it
            const steps = id.split("/").slice(0, -1);
            for (const step of address.split("/")) {
                if (step === "..") steps.pop();
                else if (step && step !== ".") steps.push(step);
            }
            const answer = await ask("GET", `${contents(steps.join("/"))}?ref=${encodeURIComponent(branch)}`, undefined, "application/vnd.github.raw");
            if (!answer.ok || typeof URL.createObjectURL !== "function") return undefined;
            return URL.createObjectURL(await answer.blob());
        },
    };
}
