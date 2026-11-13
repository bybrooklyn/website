// Google Drive, as far as the Drive store uses it: a few calls of the Drive API v3, behind a small
// interface so that the store can be tested against a Drive kept in memory (memoryDrive) and never
// against Google. Everything sent here is already locked (vault.ts) and named at random; this file
// moves bytes and knows nothing of what they hold.
//
// The calls, with the scope drive.file (the app sees only the files it made):
//   files.list      find the app's folder and what is in it, with the times and sizes Drive keeps
//   files.create    make the folder (metadata only) and each file (multipart: name, folder, bytes)
//   files.get       a file's head revision id, and with alt=media its bytes
//   files.update    new bytes for a file (uploadType=media), and putting a file in the bin
//   revisions.list / get / update   the conflict check after a write (store-drive.ts says why)
//
// Every write keeps its revision ("keep forever"), because Drive lets only such revisions of a file
// be downloaded, and the conflict check may need to read one back; the store lets the older one go
// once a newer save is safely in place.
//
// The access token is asked for on each call and goes only to www.googleapis.com, in the
// Authorization header. A refused token (401) is SignInNeeded, so that the writer can be asked to
// sign in again while her text stays where it is.

import { StoreError } from "./store";

/** A file the app made, as Drive lists it. */
export interface DriveFile {
    id: string;
    name: string;
    /** When Drive last saw it change, in milliseconds. */
    modified?: number;
    size?: number;
}

/** Drive, as the store uses it. Every id is Drive's own; every revision is Drive's head revision id. */
export interface Drive {
    /** The app's folders of this name, oldest first. */
    folders(name: string): Promise<DriveFile[]>;
    /** Makes a folder and gives its id. */
    folder(name: string): Promise<string>;
    /** What is in a folder and not in the bin, oldest first. */
    children(folder: string): Promise<DriveFile[]>;
    /** Makes a file in a folder, its first revision kept. */
    create(name: string, bytes: Uint8Array, folder: string): Promise<{ id: string; revision: string }>;
    /** A file's bytes and the revision they are. */
    read(id: string): Promise<{ bytes: Uint8Array; revision: string }>;
    /** A file's head revision now. */
    revision(id: string): Promise<string>;
    /** Gives a file new bytes, the new revision kept, and gives the new revision. */
    write(id: string, bytes: Uint8Array): Promise<string>;
    /** A file's revisions, oldest first. */
    revisions(id: string): Promise<string[]>;
    /** The bytes of one kept revision. */
    readRevision(id: string, revision: string): Promise<Uint8Array>;
    /** Lets a kept revision go, so that Drive may clear it away in time. */
    release(id: string, revision: string): Promise<void>;
    /** Puts a file in Drive's bin. */
    trash(id: string): Promise<void>;
}

/** Google would not take the token: it has run out (after about an hour) or was taken back. */
export class SignInNeeded extends StoreError {
    constructor() {
        super("Google needs you to sign in again; your writing is kept here");
    }
}

/** The largest file sent in one request, as Google's guide to uploads gives it for multipart and simple uploads. */
export const LARGEST = 5 * 1024 * 1024;

/** The network, as Drive is reached: one request, one answer. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://www.googleapis.com";
const FOLDER = "application/vnd.google-apps.folder";
const LISTED = "nextPageToken,files(id,name,modifiedTime,size)";

/** A Drive search term in quotes, with its quotes and backslashes escaped as the query language wants. */
export function quoted(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** The parts of a multipart upload: the metadata, then the bytes, between boundaries. */
export function multipart(metadata: object, bytes: Uint8Array, boundary: string): Blob {
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    return new Blob([head, bytes as Uint8Array<ArrayBuffer>, `\r\n--${boundary}--`]);
}

/** Drive over the network. `token` gives the access token now, or undefined when there is none. */
export function googleDrive(token: () => string | undefined, fetcher: Fetcher = (url, init) => fetch(url, init)): Drive {
    async function ask(method: string, path: string, init: { query?: Record<string, string>; json?: object; body?: BodyInit; type?: string } = {}): Promise<Response> {
        const now = token();
        if (!now) throw new SignInNeeded();
        const address = `${API}${path}${init.query ? `?${new URLSearchParams(init.query)}` : ""}`;
        const headers: Record<string, string> = { Authorization: `Bearer ${now}` };
        if (init.json) headers["Content-Type"] = "application/json; charset=UTF-8";
        if (init.type) headers["Content-Type"] = init.type;
        let answer: Response;
        try {
            answer = await fetcher(address, { method, headers, body: init.json ? JSON.stringify(init.json) : init.body, cache: "no-store" });
        } catch {
            throw new StoreError("Google Drive could not be reached");
        }
        if (answer.ok) return answer;
        if (answer.status === 401) throw new SignInNeeded();
        // Drive gives its reason in the body: too many requests and a full Drive are both 403
        const reason = await answer.json().then((body: { error?: { errors?: { reason?: string }[] } }) => body?.error?.errors?.[0]?.reason ?? "", () => "");
        if (answer.status === 429 || /rateLimitExceeded/i.test(reason)) throw new StoreError("Google Drive has had too many requests for now; try again in a minute");
        if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) throw new StoreError("your Google Drive is full");
        if (answer.status === 404) throw new StoreError("this file is no longer in Google Drive");
        throw new StoreError(`Google Drive answered ${answer.status}`);
    }
    const json = async <T>(answer: Response) => (await answer.json()) as T;
    const bytesOf = async (answer: Response) => new Uint8Array(await answer.arrayBuffer());
    const listed = (files: { id: string; name: string; modifiedTime?: string; size?: string }[]): DriveFile[] =>
        files.map((file) => ({ id: file.id, name: file.name, modified: file.modifiedTime ? Date.parse(file.modifiedTime) : undefined, size: file.size === undefined ? undefined : Number(file.size) }));
    async function search(q: string): Promise<DriveFile[]> {
        const found: DriveFile[] = [];
        let page: string | undefined;
        do {
            const query: Record<string, string> = { q, fields: LISTED, orderBy: "createdTime", spaces: "drive", pageSize: "1000" };
            if (page) query.pageToken = page;
            const answer = await json<{ files?: { id: string; name: string; modifiedTime?: string; size?: string }[]; nextPageToken?: string }>(await ask("GET", "/drive/v3/files", { query }));
            found.push(...listed(answer.files ?? []));
            page = answer.nextPageToken;
        } while (page);
        return found;
    }
    const revision = async (id: string) => (await json<{ headRevisionId: string }>(await ask("GET", `/drive/v3/files/${encodeURIComponent(id)}`, { query: { fields: "headRevisionId" } }))).headRevisionId;
    const tooLarge = (bytes: Uint8Array) => {
        if (bytes.length > LARGEST) throw new StoreError("files over 5 MB cannot go to Google Drive yet");
    };

    return {
        folders: (name) => search(`name = ${quoted(name)} and mimeType = ${quoted(FOLDER)} and trashed = false`),
        async folder(name) {
            return (await json<{ id: string }>(await ask("POST", "/drive/v3/files", { query: { fields: "id" }, json: { name, mimeType: FOLDER } }))).id;
        },
        children: (folder) => search(`${quoted(folder)} in parents and trashed = false`),
        async create(name, bytes, folder) {
            tooLarge(bytes);
            const boundary = `quire${crypto.getRandomValues(new Uint32Array(2)).join("")}`;
            const body = multipart({ name, parents: [folder], mimeType: "application/octet-stream" }, bytes, boundary);
            const made = await json<{ id: string; headRevisionId: string }>(await ask("POST", "/upload/drive/v3/files", { query: { uploadType: "multipart", keepRevisionForever: "true", fields: "id,headRevisionId" }, body, type: `multipart/related; boundary=${boundary}` }));
            return { id: made.id, revision: made.headRevisionId };
        },
        async read(id) {
            // the revision is read on both sides of the bytes, so that the bytes are surely that revision
            for (let tries = 0; tries < 3; tries++) {
                const before = await revision(id);
                const bytes = await bytesOf(await ask("GET", `/drive/v3/files/${encodeURIComponent(id)}`, { query: { alt: "media" } }));
                if ((await revision(id)) === before) return { bytes, revision: before };
            }
            throw new StoreError("this file kept changing in Google Drive while it was read; try again");
        },
        revision,
        async write(id, bytes) {
            tooLarge(bytes);
            const answer = await ask("PATCH", `/upload/drive/v3/files/${encodeURIComponent(id)}`, { query: { uploadType: "media", keepRevisionForever: "true", fields: "headRevisionId" }, body: bytes as Uint8Array<ArrayBuffer>, type: "application/octet-stream" });
            return (await json<{ headRevisionId: string }>(answer)).headRevisionId;
        },
        async revisions(id) {
            const found: string[] = [];
            let page: string | undefined;
            do {
                const query: Record<string, string> = { fields: "nextPageToken,revisions(id)", pageSize: "200" };
                if (page) query.pageToken = page;
                const answer = await json<{ revisions?: { id: string }[]; nextPageToken?: string }>(await ask("GET", `/drive/v3/files/${encodeURIComponent(id)}/revisions`, { query }));
                found.push(...(answer.revisions ?? []).map((each) => each.id));
                page = answer.nextPageToken;
            } while (page);
            return found;
        },
        async readRevision(id, revision) {
            return bytesOf(await ask("GET", `/drive/v3/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}`, { query: { alt: "media" } }));
        },
        async release(id, revision) {
            await ask("PATCH", `/drive/v3/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}`, { query: { fields: "id" }, json: { keepForever: false } });
        },
        async trash(id) {
            await ask("PATCH", `/drive/v3/files/${encodeURIComponent(id)}`, { query: { fields: "id" }, json: { trashed: true } });
        },
    };
}

/** One file in the Drive kept in memory. */
interface MemoryFile {
    name: string;
    parent?: string;
    folder?: boolean;
    revisions: { id: string; bytes: Uint8Array; kept: boolean }[];
    trashed?: boolean;
    modified: number;
}

/**
 * A Drive kept in memory, for tests and for the page that tries the Drive store without Google. It
 * behaves as Drive does where the store depends on it: a write is a new head revision, only kept
 * revisions can be read back, and a refused token is SignInNeeded. It keeps everything it was sent,
 * names and bytes, in `received`, so that a test can look for anything readable in it; `between`
 * runs once before the next write, as another device saving at that moment would.
 */
export function memoryDrive(now: () => number = Date.now) {
    const files = new Map<string, MemoryFile>();
    const received: (string | Uint8Array)[] = [];
    let count = 0;
    let signedIn = true;
    let calls = 0;
    const between: (() => Promise<void> | void)[] = [];
    const next = (kind: string) => `${kind}${++count}`;
    const check = () => {
        calls++;
        if (!signedIn) throw new SignInNeeded();
    };
    const find = (id: string) => {
        const file = files.get(id);
        if (!file) throw new StoreError("this file is no longer in Google Drive");
        return file;
    };
    const head = (file: MemoryFile) => file.revisions.at(-1)!;
    const listed = (id: string, file: MemoryFile): DriveFile => ({ id, name: file.name, modified: file.modified, size: file.folder ? undefined : head(file).bytes.length });
    const drive: Drive = {
        async folders(name) {
            check();
            return [...files].filter(([, file]) => file.folder && file.name === name && !file.trashed).map(([id, file]) => listed(id, file));
        },
        async folder(name) {
            check();
            received.push(name);
            const id = next("folder");
            files.set(id, { name, folder: true, revisions: [{ id: next("r"), bytes: new Uint8Array(0), kept: false }], modified: now() });
            return id;
        },
        async children(folder) {
            check();
            return [...files].filter(([, file]) => file.parent === folder && !file.trashed).map(([id, file]) => listed(id, file));
        },
        async create(name, bytes, parent) {
            check();
            received.push(name, bytes.slice());
            const id = next("file");
            const revision = next("r");
            files.set(id, { name, parent, revisions: [{ id: revision, bytes: bytes.slice(), kept: true }], modified: now() });
            return { id, revision };
        },
        async read(id) {
            check();
            const file = find(id);
            return { bytes: head(file).bytes.slice(), revision: head(file).id };
        },
        async revision(id) {
            check();
            return head(find(id)).id;
        },
        async write(id, bytes) {
            check();
            await between.shift()?.();
            received.push(bytes.slice());
            const file = find(id);
            const revision = next("r");
            file.revisions.push({ id: revision, bytes: bytes.slice(), kept: true });
            file.modified = now();
            return revision;
        },
        async revisions(id) {
            check();
            return find(id).revisions.map((each) => each.id);
        },
        async readRevision(id, revision) {
            check();
            const found = find(id).revisions.find((each) => each.id === revision);
            // as Drive: a revision that was not kept cannot be downloaded
            if (!found || (!found.kept && found !== head(find(id)))) throw new StoreError("this file is no longer in Google Drive");
            return found.bytes.slice();
        },
        async release(id, revision) {
            check();
            const found = find(id).revisions.find((each) => each.id === revision);
            if (found) found.kept = false;
        },
        async trash(id) {
            check();
            find(id).trashed = true;
        },
    };
    return {
        drive,
        files,
        received,
        /** Runs `work` once, just before the next write lands, as another device saving at that moment. */
        between: (work: () => Promise<void> | void) => void between.push(work),
        /** The token runs out: every call is refused until `signIn`. */
        expire: () => void (signedIn = false),
        signIn: () => void (signedIn = true),
        /** How many calls have been made, to see that a step asked nothing more of Drive. */
        calls: () => calls,
    };
}
