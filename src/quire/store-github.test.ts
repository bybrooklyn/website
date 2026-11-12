// What the repository store is held to, against a mock of GitHub's contents API kept in memory
// (the real API is never called, and no real token is used): it lists the folder's Markdown files,
// opens and saves them with the blob SHA as the mark, each save a commit with a plain message,
// refuses a save whose SHA no longer matches, uploads pictures into their folder, and asks nothing
// of any address but api.github.com, always with the token. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { folderPath, forgetSettings, githubStore, keepSettings, readSettings, repository, SETTINGS_KEY, type GithubSettings } from "./store-github";

const SETTINGS: GithubSettings = { owner: "someone", repo: "site", branch: "main", folder: "src/content/blog", pictures: "src/assets/blog", token: "test-token-not-real" };

/** GitHub's contents API, as far as the store uses it, over files kept in memory. */
function mockGithub(start: Record<string, string>) {
    const files = new Map<string, { bytes: Uint8Array; sha: string }>();
    let shas = 0;
    const sha = () => `sha${++shas}`;
    for (const [path, text] of Object.entries(start)) files.set(path, { bytes: new TextEncoder().encode(text), sha: sha() });
    const calls: { url: string; method: string; auth: string | null; body?: { message?: string; content?: string; sha?: string; branch?: string } }[] = [];
    const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/(.{60})/g, "$1\n");
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    const fetcher = async (input: string, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: url.href, method, auth: headers.get("Authorization"), body });
        if (url.host !== "api.github.com") return json(500, { message: "not GitHub" });
        if (headers.get("Authorization") !== `Bearer ${SETTINGS.token}`) return json(401, { message: "Bad credentials" });
        const blob = /^\/repos\/someone\/site\/git\/blobs\/(.+)$/.exec(url.pathname);
        if (blob) {
            const found = [...files.values()].find((file) => file.sha === blob[1]);
            return found ? json(200, { content: base64(found.bytes), encoding: "base64" }) : json(404, {});
        }
        const match = /^\/repos\/someone\/site\/contents\/?(.*)$/.exec(url.pathname);
        if (!match) return json(404, { message: "Not Found" });
        const path = decodeURIComponent(match[1]!);
        const file = files.get(path);
        if (method === "GET") {
            if (file && headers.get("Accept") === "application/vnd.github.raw") return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]));
            // a large file comes without its content, which must then be read as a blob
            if (file) return json(200, { type: "file", name: path.split("/").at(-1), path, sha: file.sha, size: file.bytes.length, encoding: file.bytes.length > 50 ? "none" : "base64", content: file.bytes.length > 50 ? "" : base64(file.bytes) });
            const inside = [...files.keys()].filter((each) => each.startsWith(`${path}/`));
            if (!inside.length) return json(404, { message: "Not Found" });
            const names = new Set(inside.map((each) => each.slice(path.length + 1).split("/")[0]!));
            return json(200, [...names].map((name) => ({ name, path: `${path}/${name}`, type: files.has(`${path}/${name}`) ? "file" : "dir" })));
        }
        if (method === "PUT") {
            if (file && body.sha !== file.sha) return json(409, { message: "does not match" });
            if (!file && body.sha) return json(422, { message: "sha given for a new file" });
            if (file === undefined && files.has(path)) return json(422, {});
            const made = { bytes: Uint8Array.from(atob(body.content), (char) => char.charCodeAt(0)), sha: sha() };
            files.set(path, made);
            return json(file ? 200 : 201, { content: { path, sha: made.sha }, commit: { message: body.message } });
        }
        if (method === "DELETE") {
            if (!file || body.sha !== file.sha) return json(409, { message: "does not match" });
            files.delete(path);
            return json(200, { commit: { message: body.message } });
        }
        return json(405, {});
    };
    return { files, calls, fetcher, text: (path: string) => new TextDecoder().decode(files.get(path)!.bytes) };
}

const POSTS = { "src/content/blog/first.mdx": "# First\n", "src/content/blog/second.md": "Café \u{1F600}\n", "src/content/blog/notes.json": "{}", "src/content/blog/drafts/third.md": "x", "src/assets/blog/old.png": "png" };

test("the folder's Markdown files are listed, and open with their text and SHA, letters of every kind intact", async () => {
    const github = mockGithub(POSTS);
    const store = githubStore(SETTINGS, github.fetcher);
    expect(store.label).toBe("someone/site");
    expect((await store.list()).map((entry) => entry.id)).toEqual(["src/content/blog/first.mdx", "src/content/blog/second.md"]);
    const opened = await store.open("src/content/blog/second.md");
    expect(opened).toEqual({ text: "Café \u{1F600}\n", mark: github.files.get("src/content/blog/second.md")!.sha });
});

test("each save is a commit with a plain message on the branch, the new SHA the next mark", async () => {
    const github = mockGithub(POSTS);
    const store = githubStore(SETTINGS, github.fetcher);
    const opened = await store.open("src/content/blog/first.mdx");
    const saved = await store.save("src/content/blog/first.mdx", "# First, edited é\n", opened.mark);
    expect(saved).toEqual({ ok: true, mark: github.files.get("src/content/blog/first.mdx")!.sha });
    expect(github.text("src/content/blog/first.mdx")).toBe("# First, edited é\n");
    const put = github.calls.find((call) => call.method === "PUT")!;
    expect(put.body).toMatchObject({ message: "Edit first.mdx", branch: "main", sha: opened.mark });
});

test("a save whose SHA no longer matches is refused as changed elsewhere, with their text", async () => {
    const github = mockGithub(POSTS);
    const store = githubStore(SETTINGS, github.fetcher);
    const opened = await store.open("src/content/blog/first.mdx");
    await store.save("src/content/blog/first.mdx", "theirs\n", opened.mark);
    const refused = await store.save("src/content/blog/first.mdx", "mine\n", opened.mark);
    expect(refused).toMatchObject({ ok: false, changed: true, theirs: { text: "theirs\n" } });
    expect(github.text("src/content/blog/first.mdx")).toBe("theirs\n");
});

test("documents are made with free names, renamed and removed, each a commit saying so", async () => {
    const github = mockGithub(POSTS);
    const store = githubStore(SETTINGS, github.fetcher);
    const made = await store.create("first.mdx", "new");
    expect(made.id).toBe("src/content/blog/first-2.mdx");
    const moved = await store.rename(made.id, "better.mdx");
    expect(moved).toBe("src/content/blog/better.mdx");
    expect(github.files.has("src/content/blog/first-2.mdx")).toBe(false);
    expect(github.text("src/content/blog/better.mdx")).toBe("new");
    await store.remove(moved);
    expect(github.files.has("src/content/blog/better.mdx")).toBe(false);
    expect(github.calls.filter((call) => call.method !== "GET").map((call) => call.body?.message)).toEqual(["Add first-2.mdx", "Rename first-2.mdx to better.mdx", "Rename first-2.mdx to better.mdx", "Remove better.mdx"]);
});

test("a picture is uploaded into its folder and written by a path relative to the document", async () => {
    const github = mockGithub(POSTS);
    const store = githubStore(SETTINGS, github.fetcher);
    const address = await store.savePicture("src/content/blog/first.mdx", new Blob([new Uint8Array([137, 80, 78, 71])]), "my cat.png");
    expect(address).toBe("../../assets/blog/my-cat.png");
    expect([...github.files.get("src/assets/blog/my-cat.png")!.bytes]).toEqual([137, 80, 78, 71]);
    expect(await store.savePicture("src/content/blog/first.mdx", new Blob(["x"]), "old.png")).toBe("../../assets/blog/old-2.png");
});

test("a file too large for the contents API to send whole is read as a blob", async () => {
    const long = "A long line of text. ".repeat(10);
    const github = mockGithub({ "src/content/blog/long.md": long });
    const store = githubStore(SETTINGS, github.fetcher);
    expect((await store.open("src/content/blog/long.md")).text).toBe(long);
    expect(github.calls.some((call) => call.url.includes("/git/blobs/"))).toBe(true);
});

test("a refused token is said plainly, and nothing is asked of any address but api.github.com, always with the token", async () => {
    const github = mockGithub(POSTS);
    const refused = githubStore({ ...SETTINGS, token: "wrong" }, github.fetcher);
    await expect(refused.list()).rejects.toThrow("GitHub refused the token");
    const store = githubStore(SETTINGS, github.fetcher);
    await store.list();
    await store.open("src/content/blog/first.mdx");
    await store.savePicture("src/content/blog/first.mdx", new Blob(["x"]), "a.png");
    for (const call of github.calls) expect(call.url.startsWith("https://api.github.com/repos/someone/site/")).toBe(true);
    expect(github.calls.filter((call) => call.auth !== "Bearer wrong").every((call) => call.auth === `Bearer ${SETTINGS.token}`)).toBe(true);
});

test("the settings are kept in, read from and taken out of this browser's storage", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
    expect(readSettings(storage)).toBeUndefined();
    keepSettings(SETTINGS, storage);
    expect(kept.has(SETTINGS_KEY)).toBe(true);
    expect(readSettings(storage)).toEqual(SETTINGS);
    forgetSettings(storage);
    expect(readSettings(storage)).toBeUndefined();
});

test("a repository is read from owner/name or its address, and folders are made plain", () => {
    expect(repository("someone/site")).toEqual({ owner: "someone", repo: "site" });
    expect(repository("https://github.com/someone/site.git")).toEqual({ owner: "someone", repo: "site" });
    expect(repository("not a repository")).toBeUndefined();
    expect(folderPath("/src/content/blog/")).toBe("src/content/blog");
    expect(folderPath("../a/./b")).toBe("a/b");
});
