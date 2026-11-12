// mdQuire as its public page runs it, used in headless Chromium: the first run and being
// remembered after a reload, the documents list, a file opened and downloaded, the browser's own
// database, real file handles in the browser's private file system, a GitHub repository (against
// a mock of the API inside the page: the real API is never called, and no real token is used), and
// printing. A folder chosen in a dialog cannot be chosen by a headless browser; the folder store is
// run over the private file system's handles instead, which are the same kind of handle.
// Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "../../scripts/browser";

const here = import.meta.dir;
const styles = `${here}/../styles`;

const page = (database: string) => `
import { startApp } from "${here}/app.ts";
import { write } from "${here}/write.ts";
import { folderStore } from "${here}/store-folder.ts";

// GitHub's contents API, as far as the store uses it, over files kept in the page
const repo = new Map([["posts/hello.md", { text: "# Hello\\n\\nFrom the repository.\\n", sha: "sha1" }]]);
let shas = 1;
const calls = [];
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
async function fetcher(url, init = {}) {
    const address = new URL(url);
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: address.href, method: init.method ?? "GET", auth: headers.get("Authorization"), message: body?.message });
    if (address.host !== "api.github.com") return json(500, {});
    if (headers.get("Authorization") !== "Bearer pretend-token") return json(401, {});
    const path = decodeURIComponent(address.pathname.replace(/^\\/repos\\/someone\\/site\\/contents\\/?/, ""));
    const file = repo.get(path);
    if ((init.method ?? "GET") === "GET") {
        if (file) return json(200, { type: "file", name: path.split("/").pop(), path, sha: file.sha, size: file.text.length, encoding: "base64", content: encode(file.text) });
        const inside = [...repo.keys()].filter((key) => key.startsWith(path + "/"));
        if (!inside.length) return json(404, {});
        return json(200, inside.map((key) => ({ type: "file", name: key.split("/").pop(), path: key })));
    }
    if (init.method === "PUT") {
        if (file && body.sha !== file.sha) return json(409, {});
        const made = { text: decode(body.content), sha: "sha" + ++shas };
        repo.set(path, made);
        return json(file ? 200 : 201, { content: { sha: made.sha, path } });
    }
    return json(405, {});
}

// a download is caught rather than saved, so that its name and text can be read
const downloads = [];
HTMLAnchorElement.prototype.click = function () {
    if (this.download) fetch(this.href).then((answer) => answer.text()).then((text) => downloads.push({ name: this.download, text }));
};

window.q = { repo, calls, downloads, write, folderStore };
startApp(document.querySelector("#host"), { database: ${JSON.stringify(database)}, fetcher, sample: "# A sample\\n" }).then((app) => {
    window.q.app = app;
    window.q.md = () => write(app.editor.surface.getDocument());
});
`;

let folder = "";
let tab: Browser;
const live = !!chromium();

beforeAll(async () => {
    if (!live) return;
    folder = await mkdtemp(join(tmpdir(), "quire-app-"));
    await Bun.write(`${folder}/page.ts`, page(`quire-app-test-${Date.now()}`));
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><body class="quire-app"><header class="quire-top"><a class="site-name" href="/">site</a></header><main id="main"><div id="host"></div></main><script type="module">${await built.outputs[0]!.text()}</script></body>`);
    await Bun.write(`${folder}/post.md`, "# A post\n\nFrom a file.\n");
    tab = await browser({ width: 1300, height: 900 });
    // the page is served over http, as the site is, so that its database and storage are its own
    await load();
}, 60_000);

let serving: ReturnType<typeof Bun.serve> | undefined;
function server() {
    serving ??= Bun.serve({
        port: 0,
        fetch: async (request) => {
            const file = Bun.file(folder + new URL(request.url).pathname);
            return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
        },
    });
    return serving;
}

afterAll(async () => {
    if (!live) return;
    await tab?.close();
    serving?.stop();
    await rm(folder, { recursive: true, force: true });
});

const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 40_000);

/** Opens the page and waits until the app has opened its document. */
async function load() {
    await tab.open(`http://localhost:${server().port}/page.html`, 100);
    for (let tries = 0; tries < 100 && !(await tab.run("!!window.q?.md")); tries++) await tab.wait(50);
}
const md = () => tab.run<string>("q.md()");
const status = () => tab.run<string>("document.querySelector('.quire-status').getAttribute('aria-label')");

async function press(selector: string, words = "") {
    const point = await tab.run<{ x: number; y: number } | null>(`(() => {
        const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => !${JSON.stringify(words)} || each.textContent.includes(${JSON.stringify(words)}) || (each.getAttribute("aria-label") ?? "").startsWith(${JSON.stringify(words)}));
        if (!found) return null;
        const box = found.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words}`);
    await tab.click(point.x, point.y);
    await tab.wait(60);
}

/** Opens the documents list from the name in the bar, once it has grown far enough to be pressed. */
async function documents() {
    await press(".quire-bar .quire-name");
    await tab.wait(700);
}

used("the first run writes at once in a new browser document, the welcome going as writing starts, and a reload comes back to it", async () => {
    await tab.wait(700);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-welcome')).opacity")).toBe("1");
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("Untitled");
    await tab.type("First words.");
    await tab.wait(700);
    expect(await tab.run("!!document.querySelector('.quire-welcome')")).toBe(false);
    await tab.wait(800);
    expect(await status()).toBe("Saved");
    await load();
    expect(await md()).toBe("First words.\n");
    expect(await tab.run("!!document.querySelector('.quire-welcome')")).toBe(false);
});

used("the documents list flows out of the name: a new document, a rename, one taken away and brought back", async () => {
    await documents();
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-list .quire-menu-line')].map((line) => line.textContent)")).toEqual(["Untitled"]);
    await press(".quire-documents-new");
    await tab.wait(300);
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("Untitled-2");
    await tab.type("Second.");
    await tab.wait(1200);
    // renamed from the list's name field
    await documents();
    await tab.run("(() => { const field = document.querySelector('.quire-documents-rename input'); field.focus(); field.select(); })()");
    await tab.type("Plans");
    await tab.press("Enter");
    await tab.wait(400);
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("Plans");
    // the other one taken away, asked twice on the same button, and brought back from the trash
    await press(".quire-documents-away");
    await press(".quire-documents-away");
    await tab.wait(300);
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-list .quire-menu-line')].map((line) => line.textContent)")).toEqual(["Plans"]);
    await press(".quire-documents-trash");
    await tab.wait(300);
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-list .quire-menu-line')].map((line) => line.textContent).sort()")).toEqual(["Plans", "Untitled"]);
    await tab.press("Escape");
});

used("a file is opened from the computer, and downloaded again with its own name and what was written", async () => {
    await tab.files([`${folder}/post.md`]);
    await documents();
    await press(".quire-documents-menu button[data-place='file']");
    await tab.wait(400);
    expect(await md()).toBe("# A post\n\nFrom a file.\n");
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("post.md");
    await tab.run("q.app.editor.surface.setSelection({ anchor: { path: [1], offset: 12 }, focus: { path: [1], offset: 12 } })");
    await tab.type(" Edited.");
    await tab.wait(1300);
    expect(await status()).toBe("Kept here. Download it to keep it.");
    await press(".quire-dots");
    await tab.wait(700);
    await press(".quire-menu.open .quire-menu-line", "Download");
    await tab.wait(300);
    expect(await tab.run("q.downloads.at(-1)")).toEqual({ name: "post.md", text: "# A post\n\nFrom a file. Edited.\n" });
});

used("a repository is connected once, its documents listed, opened and saved as commits, and it can be forgotten", async () => {
    await documents();
    await press(".quire-documents-menu button[data-place='github']");
    await tab.wait(600);
    const fill = async (label: string, value: string) => {
        await tab.run(`(() => { const row = [...document.querySelectorAll('.quire-repository-row')].find((each) => each.textContent.startsWith(${JSON.stringify(label)})); const input = row.querySelector('input'); input.focus(); input.select(); })()`);
        await tab.type(value);
    };
    await fill("Repository", "someone/site");
    await fill("Folder of documents", "posts");
    await fill("Access token", "wrong-token");
    await press(".quire-repository button[type=submit]");
    await tab.wait(300);
    expect(await tab.run("document.querySelector('.quire-repository-said').textContent")).toContain("GitHub refused the token");
    await fill("Access token", "pretend-token");
    await press(".quire-repository button[type=submit]");
    await tab.wait(800);
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-list .quire-menu-line')].map((line) => line.textContent)")).toEqual(["hello.md"]);
    expect(await tab.run("JSON.parse(localStorage.getItem('quire-github')).token")).toBe("pretend-token");
    await press(".quire-documents-list .quire-menu-line", "hello.md");
    await tab.wait(300);
    expect(await md()).toBe("# Hello\n\nFrom the repository.\n");
    await tab.run("q.app.editor.surface.setSelection({ anchor: { path: [1], offset: 20 }, focus: { path: [1], offset: 20 } })");
    await tab.type(" Again.");
    await tab.wait(1400);
    expect(await status()).toBe("Saved");
    expect(await tab.run("q.repo.get('posts/hello.md').text")).toBe("# Hello\n\nFrom the repository. Again.\n");
    expect(await tab.run("q.calls.filter((call) => call.method === 'PUT').map((call) => call.message)")).toEqual(["Edit hello.md"]);
    // nothing but api.github.com was asked
    expect(await tab.run("q.calls.every((call) => call.url.startsWith('https://api.github.com/'))")).toBe(true);
    // forgotten: the token is gone from this browser, and the editor goes back to the browser's documents
    await documents();
    await press(".quire-documents-menu button[data-place='github-settings']");
    await tab.wait(600);
    await press(".quire-repository button", "Forget");
    await tab.wait(500);
    expect(await tab.run("localStorage.getItem('quire-github')")).toBeNull();
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).not.toBe("hello.md");
    await tab.press("Escape");
});

used("the folder store writes real file handles, here the browser's private file system", async () => {
    const result = await tab.run<{ listed: string[]; text: string; refused: boolean; trash: boolean }>(`(async () => {
        const root = await navigator.storage.getDirectory();
        const store = q.folderStore(root);
        const made = await store.create("A note", "one");
        const opened = await store.open(made.id);
        const saved = await store.save(made.id, "two", opened.mark);
        const refused = await store.save(made.id, "three", opened.mark);
        const listed = (await store.list()).map((entry) => entry.id);
        const text = (await store.open(made.id)).text;
        await store.remove(made.id);
        const trash = !!(await root.getDirectoryHandle(".quire-trash").then((folder) => folder.getFileHandle("a-note.md")).catch(() => undefined));
        return { listed, text, refused: !refused.ok && refused.changed === true && saved.ok, trash };
    })()`);
    expect(result).toEqual({ listed: ["a-note.md"], text: "two", refused: true, trash: true });
});

used("printed, the page is the document alone, dark on white, with none of the editor around it", async () => {
    await tab.media({}, "print");
    try {
        const seen = await tab.run<Record<string, string>>(`(() => {
            const shown = (selector) => { const element = document.querySelector(selector); return element ? getComputedStyle(element).display : "none"; };
            return { bar: shown(".quire-bar"), outline: shown(".quire-outline"), top: shown(".quire-top"), paper: getComputedStyle(document.querySelector(".quire-paper")).borderTopStyle, body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.querySelector(".quire")).color };
        })()`);
        expect(seen).toEqual({ bar: "none", outline: "none", top: "none", paper: "none", body: "rgb(255, 255, 255)", text: "rgb(0, 0, 0)" });
    } finally {
        await tab.media({});
    }
    expect(tab.errors).toEqual([]);
});

if (!live) console.warn("app.test.ts: no Chromium on this machine, so the app was not used.");
