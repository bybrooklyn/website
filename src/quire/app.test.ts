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
import { withoutSpeech } from "../../scripts/dictation-stubs";
import { browser, chromium, type Browser } from "../../scripts/browser";
import { packQuire, unpackQuire } from "./quire-file";
import { hash } from "./styling";

/** The smallest PNG: one pixel. */
const DOT = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const here = import.meta.dir;
const styles = `${here}/../styles`;

const page = (database: string) => `
import { startApp } from "${here}/app.ts";
import { write } from "${here}/write.ts";
import { folderStore, oneFileStore } from "${here}/store-folder.ts";
import { setStyle } from "${here}/document.ts";
import { packQuire, unpackQuire } from "${here}/quire-file.ts";

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
const bytes = {};
HTMLAnchorElement.prototype.click = function () {
    if (!this.download) return;
    const name = this.download;
    fetch(this.href).then((answer) => answer.arrayBuffer()).then((buffer) => {
        bytes[name] = new Uint8Array(buffer);
        downloads.push({ name, text: new TextDecoder().decode(buffer) });
    });
};

window.q = { repo, calls, downloads, bytes, write, folderStore, oneFileStore, setStyle, packQuire, unpackQuire };
// a browser that keeps nothing, as some private windows are
if (location.search.includes("no-storage")) indexedDB.open = () => { throw new DOMException("The user denied permission to access the database.", "SecurityError"); };
startApp(document.querySelector("#host"), { database: ${JSON.stringify(database)}, fetcher, sample: "# A sample\\n", top: document.querySelector(".quire-top") }).then((app) => {
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
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser", plugins: [withoutSpeech] });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css", "quire-markdown.css", "quire-extras.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><body class="quire-app"><header class="quire-top"><div class="quire-top-in"><div class="quire-top-line"><nav class="quire-trail"><div class="site-id"><a class="site-name" href="/">site</a></div><span class="quire-stroke">/</span><a class="quire-word" href="/mdquire/">mdQuire</a><span class="quire-stroke quire-name-stroke">/</span><span class="quire-name-home"></span></nav><div class="quire-menus-home"></div><div class="quire-status-home"></div></div><div class="quire-bar-home"></div></div></header><main id="main"><div id="host"></div></main><script type="module">${await built.outputs[0]!.text()}</script></body>`);
    await Bun.write(`${folder}/post.md`, "# A post\n\nFrom a file.\n");
    // a .quire file with a styled word, its style addressed as styling.ts says
    const style = { quire: 1, page: { size: "A5", orientation: "portrait", margins: 20 }, count: 2, blocks: [{ block: 0, hash: hash("A letter"), align: "center" }], runs: [{ block: 1, hash: hash("Dear Sam, hello."), from: 10, to: 15, quote: "hello", before: "Dear Sam, ", color: "#d52d00", font: "serif" }] };
    await Bun.write(`${folder}/letter.quire`, await packQuire({ markdown: "# A letter\n\nDear Sam, hello.\n\n![A dot](pictures/dot.png)\n", parts: { style: JSON.stringify(style), notes: "{}" }, pictures: new Map([["dot.png", new Blob([DOT])]]) }));
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

used("a browser that keeps nothing still opens mdQuire, and says a document is kept in this tab only", async () => {
    await tab.open(`http://localhost:${server().port}/page.html?no-storage`, 100);
    for (let tries = 0; tries < 100 && !(await tab.run("!!window.q?.md")); tries++) await tab.wait(50);
    expect(await tab.run("!!window.q.app")).toBe(true);
    await tab.run(`q.app.editor.create(q.app.browser, "Kept here", "Words.\\n").then(() => q.app.editor.surface.focus())`);
    await tab.run(`q.app.editor.surface.pasteText("More words")`);
    await tab.wait(1400);
    expect(await tab.run<string>("document.querySelector('.quire-status').getAttribute('aria-label')")).toContain("kept in this tab only");
    expect(await tab.run(`(() => { const event = new Event("beforeunload", { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; })()`)).toBe(true);
    // back to the page as the other tests have it, with nothing waiting to be downloaded
    await tab.run("q.app.editor.commands.download()");
    await load();
});
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
    await press(".quire-name");
    await tab.wait(700);
}

/** The sheet's width on each frame for a while, as something is pressed: to see it travel. */
const paperWidths = (ms: number) => tab.run<number[]>(`new Promise((done) => { const seen = []; const start = performance.now(); const step = () => { seen.push(Math.round(document.querySelector('.quire-paper').getBoundingClientRect().width)); if (performance.now() - start < ${ms}) requestAnimationFrame(step); else done(seen); }; requestAnimationFrame(step); })`);
/** How much of the sheet is seen on each frame for a while, its height on screen less what is cut from its foot: to see it shrink into a row. */
const paperHeights = (ms: number) => tab.run<number[]>(`new Promise((done) => { const seen = []; const start = performance.now(); const step = () => { const paper = document.querySelector('.quire-paper'); const box = paper.getBoundingClientRect(); const cut = /inset\\(0px 0px ([\\d.]+)px/.exec(getComputedStyle(paper).clipPath); seen.push(Math.round(box.height - (cut ? Number(cut[1]) * (box.width / paper.offsetWidth) : 0))); if (performance.now() - start < ${ms}) requestAnimationFrame(step); else done(seen); }; requestAnimationFrame(step); })`);
const shelfShown = () => tab.run<boolean>("document.querySelector('.quire-shelf').classList.contains('shown') && getComputedStyle(document.querySelector('.quire-shelf')).visibility === 'visible'");

used("with nothing open the home screen shows ways to start; blank grows into a page, leaving shrinks it back onto its row, and a reload comes back to what was open", async () => {
    await tab.wait(700);
    expect(await shelfShown()).toBe(true);
    expect(await tab.run("[...document.querySelectorAll('.quire-shelf-kinds .quire-shelf-word')].map((word) => word.textContent)")).toEqual(["blank", "blog post", "notes"]);
    expect(await tab.run("!!document.querySelector('.quire-shelf-none')")).toBe(true);
    // the bar has nothing to act on, and is away
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-bar')).visibility")).toBe("hidden");
    const word = await tab.run<number>("document.querySelector('.quire-shelf-kinds .quire-shelf-word').getBoundingClientRect().width");
    const growing = paperWidths(600);
    await press(".quire-shelf-kinds .quire-shelf-word", "blank");
    const grown = await growing;
    expect(grown.filter((width) => width < word * 2).length).toBeGreaterThan(0);
    expect(new Set(grown).size).toBeGreaterThan(5);
    expect(await shelfShown()).toBe(false);
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("Untitled");
    await tab.type("First words.");
    await tab.wait(1500);
    expect(await status()).toBe("Saved");
    // leaving: the page shrinks back onto its row, which says where it is kept and when
    const shrinking = paperHeights(600);
    await press(".quire-word");
    const shrunk = await shrinking;
    await tab.wait(300);
    const row = await tab.run<number>("document.querySelector('.quire-shelf-doc').getBoundingClientRect().height");
    expect(shrunk.some((height) => height < row * 1.5)).toBe(true);
    expect(await shelfShown()).toBe(true);
    expect(await tab.run("[...document.querySelector('.quire-shelf-list .quire-shelf-open').children].map((part) => part.textContent)")).toEqual(["Untitled", "this browser", expect.stringMatching(/^today \d\d:\d\d$/)]);
    // the keyboard is back on the row of the document left, and Enter opens it again
    expect(await tab.run("document.activeElement.matches('.quire-shelf-list .quire-shelf-open')")).toBe(true);
    await tab.press("Enter");
    await tab.wait(700);
    expect(await shelfShown()).toBe(false);
    expect(await md()).toBe("First words.\n");
    await press(".quire-word");
    await tab.wait(900);
    // with nothing open a reload is the home screen again, and a document opened is what a reload comes back to
    await load();
    await tab.wait(300);
    expect(await shelfShown()).toBe(true);
    await press(".quire-shelf-list .quire-shelf-open");
    await tab.wait(600);
    expect(await md()).toBe("First words.\n");
    await load();
    expect(await shelfShown()).toBe(false);
    expect(await md()).toBe("First words.\n");
});

used("the documents list flows out of the name: a new document, a rename that Enter finishes, one deleted after asking and restored", async () => {
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
    // Enter renamed it, closed the list, and gave the text back
    expect(await tab.run("!!document.querySelector('.quire-documents-menu:popover-open')")).toBe(false);
    expect(await tab.run("document.activeElement === q.app.editor.surface.element")).toBe(true);
    await documents();
    // the place shown heads the documents and is not offered again under Open from, and Drive, not set up, is not there at all
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-menu [data-place]')].map((line) => line.dataset.place).includes('browser')")).toBe(false);
    expect(await tab.run("document.querySelector('.quire-documents-menu').textContent.includes('Google Drive')")).toBe(false);
    // the other one deleted, asked once more in its place as the home list asks, and restored from the trash
    await press(".quire-documents-away");
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-item.asking button')].map((line) => line.textContent)")).toEqual(["Delete Untitled", "Keep it"]);
    await press(".quire-documents-sure");
    await tab.wait(300);
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-list .quire-menu-line')].map((line) => line.textContent)")).toEqual(["Plans"]);
    await press(".quire-documents-trash");
    await tab.wait(300);
    expect(await tab.run("[...document.querySelectorAll('.quire-documents-list .quire-menu-line')].map((line) => line.textContent).sort()")).toEqual(["Plans", "Untitled"]);
    await tab.press("Escape");
});

used("a damaged .quire chosen from the computer is not opened, and the status says why", async () => {
    const before = await md();
    // the file chooser gives a file that is not a zip, though it is named as a .quire
    await tab.run(`(() => { const chooser = [...document.querySelectorAll("input.quire-file")].find((input) => input.accept.includes(".quire")); const files = new DataTransfer(); files.items.add(new File(["this is not a zip at all"], "damaged.quire")); chooser.files = files.files; chooser.dispatchEvent(new Event("change")); })()`);
    await tab.wait(300);
    expect(await status()).toContain("damaged.quire was not opened: this is not a zip file");
    expect(await md()).toBe(before);
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
    await press(".quire-menu-row .quire-row-word", "File");
    await tab.wait(700);
    await press(".quire-menu.open .quire-menu-line", "Download");
    await tab.wait(300);
    expect(await tab.run("q.downloads.at(-1)")).toEqual({ name: "post.md", text: "# A post\n\nFrom a file. Edited.\n" });
});

used("in a Markdown file the tools it cannot keep are not offered, and turning it into a .quire document makes a copy that has them", async () => {
    // post.md is open from the test before
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("post.md");
    // the tools a Markdown file cannot keep are away from the bar for one
    const away = () => tab.run<string[]>("[...document.querySelectorAll('.quire-tool.away')].map((tool) => tool.firstElementChild.getAttribute('aria-label'))");
    expect(await away()).toEqual(["Typeface", "Highlight", "Line spacing"]);
    await press(".quire-menu-row .quire-row-word", "File");
    await tab.wait(700);
    const lines = await tab.run<string[]>("[...document.querySelectorAll('.quire-menu.open .quire-menu-line')].map((line) => line.textContent)");
    expect(lines).toContain("Turn into a .quire document");
    expect(lines.some((line) => line.startsWith("Typeface") || line.startsWith("Highlight"))).toBe(false);
    await press(".quire-menu.open .quire-menu-line", "Turn into a .quire document");
    await tab.wait(900);
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("post.quire");
    expect(await md()).toBe("# A post\n\nFrom a file. Edited.\n");
    await tab.wait(500);
    expect(await away()).toEqual([]);
    // a typeface chosen from its button goes on the selection
    await tab.run("q.app.editor.surface.setSelection({ anchor: { path: [1], offset: 0 }, focus: { path: [1], offset: 4 } })");
    await press(".quire-font");
    await tab.wait(600);
    await press(".quire-menu.open .quire-menu-line", "System mono");
    await tab.wait(200);
    expect(await tab.run("document.querySelector('.quire [data-font=mono]')?.textContent")).toBe("From");
    expect(await md()).toBe("# A post\n\nFrom a file. Edited.\n");
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
    // a dialog, whose buttons are in every dialog's order and which says nothing of a Forget it does not have yet
    expect(await tab.run("document.querySelector('dialog.quire-dialog[open] .quire-dialog-title').textContent")).toBe("Write in a GitHub repository");
    expect(await tab.run<string[]>("[...document.querySelectorAll('dialog.quire-dialog[open] .quire-dialog-actions button')].map((b) => b.textContent)")).toEqual(["Cancel", "Connect"]);
    expect(await tab.run("document.querySelector('.quire-repository-about').textContent.includes('Forget')")).toBe(false);
    await press("dialog.quire-dialog[open] .quire-dialog-action", "Connect");
    await tab.wait(300);
    expect(await tab.run("document.querySelector('.quire-repository-said').textContent")).toContain("GitHub refused the token");
    await fill("Access token", "pretend-token");
    // Enter in a field connects, as the filled button does
    await tab.press("Enter");
    await tab.wait(900);
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
    expect(await tab.run<string[]>("[...document.querySelectorAll('dialog.quire-dialog[open] .quire-dialog-actions button')].map((b) => b.textContent)")).toEqual(["Forget", "Cancel", "Save and open"]);
    await press("dialog.quire-dialog[open] button", "Forget");
    await tab.wait(700);
    expect(await tab.run("localStorage.getItem('quire-github')")).toBeNull();
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).not.toBe("hello.md");
    await tab.press("Escape");
});

used("a .quire file opens with its look, is written in, and downloads as a .quire that holds the change, its style and its picture", async () => {
    await tab.files([`${folder}/letter.quire`]);
    await documents();
    await press(".quire-documents-menu button[data-place='file']");
    await tab.wait(400);
    expect(await tab.run("document.querySelector('.quire-name-text').textContent")).toBe("letter.quire");
    const seen = await tab.run<{ align: string; font: string; color: string }>(`(() => {
        const word = document.querySelector('.quire [data-font]');
        return { align: getComputedStyle(document.querySelector('.quire h1')).textAlign, font: word.textContent, color: getComputedStyle(word).color };
    })()`);
    expect(seen).toEqual({ align: "center", font: "hello", color: "rgb(213, 45, 0)" });
    await tab.run("q.app.editor.surface.setSelection({ anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 0 } })");
    await tab.type("Old. ");
    await tab.wait(1300);
    await press(".quire-menu-row .quire-row-word", "File");
    await tab.wait(700);
    expect(await tab.run("[...document.querySelectorAll('.quire-menu.open .quire-menu-line')].map((line) => line.textContent).filter((text) => text.startsWith('Download') && !text.endsWith('›'))")).toEqual(["Download.quire", "Download as Markdown.md"]);
    await press(".quire-menu.open .quire-menu-line", "Download.quire");
    await tab.wait(400);
    const bundle = await unpackQuire(new Uint8Array(Object.values(await tab.run<Record<string, number>>("q.bytes['letter.quire']"))));
    expect(bundle.markdown).toBe("# Old. A letter\n\nDear Sam, hello.\n\n![A dot](pictures/dot.png)\n");
    const style = JSON.parse(bundle.parts.style);
    expect(style.page).toEqual({ size: "A5", orientation: "portrait", margins: 20 });
    expect(style.runs[0]).toMatchObject({ quote: "hello", color: "#d52d00", font: "serif" });
    expect(style.blocks[0]).toMatchObject({ align: "center", hash: hash("Old. A letter") });
    expect([...bundle.pictures.keys()]).toEqual(["dot.png"]);
});

used("a document kept in the browser is a .quire one: its look is kept through a reload", async () => {
    await documents();
    await press(".quire-documents-menu button[data-place='browser']");
    await tab.wait(400);
    await press(".quire-documents-new");
    await tab.wait(400);
    await tab.type("Styled words.");
    await tab.run("q.app.editor.surface.run((doc) => q.setStyle(doc, { start: { path: [0], offset: 0 }, end: { path: [0], offset: 6 } }, { font: 'mono', highlight: '#ff9a56' }))");
    await tab.wait(1300);
    await load();
    expect(await tab.run("document.querySelector('.quire [data-font=mono]')?.textContent")).toBe("Styled");
    expect(await md()).toBe("Styled words.\n");
});

used("a .quire file written in place through file handles keeps its look and pictures inside it", async () => {
    const result = await tab.run<{ markdown: string; style: string; pictures: string[] }>(`(async () => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle("in-place.quire", { create: true });
        const writable = await handle.createWritable();
        await writable.write(new Blob([await q.packQuire({ markdown: "Hi.\\n", parts: { style: "", notes: "" }, pictures: new Map() })]));
        await writable.close();
        const store = q.oneFileStore(handle);
        const opened = await store.open("in-place.quire");
        await store.savePicture("in-place.quire", new Blob(["x"], { type: "image/png" }), "x.png");
        await store.save("in-place.quire", "Hi there.\\n\\n![x](pictures/x.png)\\n", opened.mark, { style: '{"quire":1}', notes: "{}" });
        const back = await q.unpackQuire(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
        await root.removeEntry("in-place.quire");
        return { markdown: back.markdown, style: back.parts.style, pictures: [...back.pictures.keys()] };
    })()`);
    expect(result).toEqual({ markdown: "Hi there.\n\n![x](pictures/x.png)\n", style: '{"quire":1}', pictures: ["x.png"] });
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

used("the menu row: a menu flows from its word, slides to the next as the pointer moves along, and is worked with the keys", async () => {
    await load();
    const open = () => tab.run<{ word: string | null; lines: string[]; sliding: boolean; left: number }>(`(() => {
        const box = document.querySelector('.quire-row-menu');
        return { word: document.querySelector('.quire-row-word.open')?.textContent ?? null, lines: box.classList.contains('open') ? [...box.querySelectorAll('.quire-menu-line')].map((line) => line.textContent) : [], sliding: box.classList.contains('sliding'), left: Math.round(box.getBoundingClientRect().left) };
    })()`);
    await press(".quire-row-word", "Format");
    await tab.wait(600);
    const format = await open();
    expect(format.word).toBe("Format");
    expect(format.lines).toContain("Bold⌃B");
    expect(format.lines).toContain("Heading 2⌃⌥2");
    // the pointer moving onto Insert takes the open menu there, sliding
    await tab.run("document.querySelectorAll('.quire-row-word')[3].dispatchEvent(new PointerEvent('pointerenter'))");
    await tab.wait(500);
    const insert = await open();
    expect(insert.word).toBe("Insert");
    expect(insert.sliding).toBe(true);
    expect(insert.left).toBeLessThan(format.left);
    expect(insert.lines).toContain("Table");
    expect(await tab.run("document.querySelectorAll('.quire-row-word.open').length")).toBe(1);
    await tab.press("Escape");
    await tab.wait(300);
    expect((await open()).lines).toEqual([]);
    // with the keys: File opened from its word, the right arrow to Edit, a letter to its line, Enter to do it
    await tab.run("document.querySelector('.quire-row-word').focus()");
    await tab.press("Enter");
    await tab.wait(400);
    expect((await open()).word).toBe("File");
    await tab.press("ArrowRight");
    await tab.wait(400);
    expect((await open()).word).toBe("Edit");
    await tab.press("s");
    expect(await tab.run("document.activeElement.textContent")).toBe("Select all⌃A");
    await tab.press("Enter");
    await tab.wait(200);
    expect(await tab.run("String(getSelection())")).toBe(await tab.run("document.querySelector('.quire').innerText.trim()"));
});

used("on a narrow window the menu words have a line of their own under the trail, and each opens its menu", async () => {
    await tab.resize(390, 800);
    try {
        await tab.wait(600);
        const row = await tab.run<{ words: number; under: boolean; inside: boolean }>("(() => { const row = document.querySelector('.quire-menu-row').getBoundingClientRect(); const trail = document.querySelector('.quire-trail').getBoundingClientRect(); return { words: [...document.querySelectorAll('.quire-row-word')].filter((word) => word.getBoundingClientRect().width > 0).length, under: row.top >= trail.bottom - 1, inside: row.left >= 0 && document.documentElement.scrollWidth <= innerWidth }; })()");
        expect(row).toEqual({ words: 7, under: true, inside: true });
        await press(".quire-row-word", "Format");
        await tab.wait(600);
        expect(await tab.run("[...document.querySelectorAll('.quire-row-menu.open .quire-menu-line')].map((line) => line.textContent)[0]")).toBe("Bold⌃B");
        await tab.press("Escape");
    } finally {
        await tab.resize(1300, 900);
    }
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

used("on the home screen each document's three dots rename it, duplicate it and delete it, asking once more; with less motion nothing travels", async () => {
    await press(".quire-word");
    await tab.wait(900);
    const names = () => tab.run<string[]>("[...document.querySelectorAll('.quire-shelf-list .quire-shelf-name')].map((name) => name.textContent)");
    const first = (await names())[0]!;
    await press(".quire-shelf-list .quire-dots");
    await tab.wait(500);
    expect(await tab.run("[...document.querySelectorAll('.quire-menu.open .quire-menu-line')].map((line) => line.textContent)")).toEqual(["Open", "Rename", "Duplicate", "Delete"]);
    await press(".quire-menu.open .quire-menu-line", "Duplicate");
    await tab.wait(600);
    expect(await names()).toContain(`${first} copy`);
    // renamed in place on its row
    const copy = (await names()).indexOf(`${first} copy`);
    await press(`.quire-shelf-list .quire-shelf-doc:nth-child(${copy + 1}) .quire-dots`);
    await tab.wait(500);
    await press(".quire-menu.open .quire-menu-line", "Rename");
    await tab.run("document.querySelector('.quire-shelf-field').select()");
    await tab.type("Kept twice");
    await tab.press("Enter");
    await tab.wait(600);
    expect(await names()).toContain("Kept twice");
    // deleting asks once more in the same menu
    const kept = (await names()).indexOf("Kept twice");
    await press(`.quire-shelf-list .quire-shelf-doc:nth-child(${kept + 1}) .quire-dots`);
    await tab.wait(500);
    await press(".quire-menu.open .quire-menu-line", "Delete");
    await tab.wait(500);
    expect(await tab.run("[...document.querySelectorAll('.quire-menu.open .quire-menu-line')].map((line) => line.textContent)")).toEqual(["Delete Kept twice", "Keep it"]);
    await press(".quire-menu.open .quire-menu-line", "Delete Kept twice");
    await tab.wait(600);
    expect(await names()).not.toContain("Kept twice");
    await tab.media({ "prefers-reduced-motion": "reduce" });
    try {
        const widths = paperWidths(400);
        await press(".quire-shelf-list .quire-shelf-open");
        expect(new Set(await widths).size).toBeLessThanOrEqual(2);
    } finally {
        await tab.media({});
    }
    expect(tab.errors).toEqual([]);
});

used("the Blog post on the home screen is made as plain Markdown, and a duplicated .quire document keeps its pictures", async () => {
    await press(".quire-word");
    await tab.wait(900);
    await press(".quire-shelf-kinds .quire-shelf-word", "blog post");
    await tab.wait(900);
    expect(await tab.run("[q.app.editor.surface.getDocument().quire === undefined, document.querySelector('.quire-editor').classList.contains('rich')]")).toEqual([true, false]);
    const made = await tab.run<string>(`(async () => {
        const store = q.app.browser;
        const made = await store.create("With a picture", "![A dot](pictures/dot.png)\\n", { style: "", notes: "" });
        await store.savePicture(made.id, new Blob(["png"]), "dot.png");
        return made.id;
    })()`);
    await press(".quire-word");
    await tab.wait(900);
    const index = await tab.run<number>("[...document.querySelectorAll('.quire-shelf-list .quire-shelf-name')].findIndex((name) => name.textContent === 'With a picture')");
    await press(`.quire-shelf-list .quire-shelf-doc:nth-child(${index + 1}) .quire-dots`);
    await tab.wait(500);
    await press(".quire-menu.open .quire-menu-line", "Duplicate");
    await tab.wait(600);
    const copied = await tab.run<string[]>(`(async () => {
        const store = q.app.browser;
        const copy = (await store.list()).find((entry) => entry.name === "With a picture copy");
        return copy && copy.id !== ${JSON.stringify(made)} ? [...(await store.pictures(copy.id)).keys()] : [];
    })()`);
    expect(copied).toEqual(["dot.png"]);
    expect(tab.errors).toEqual([]);
});

used("in light paper the home screen's list is on a light sheet with dark words, and the round button for the commands is not there", async () => {
    await tab.run("localStorage.setItem('quire-look', 'paper'); localStorage.removeItem('quire-place')");
    await load();
    await tab.wait(600);
    try {
        expect(await shelfShown()).toBe(true);
        // lightness read from the computed colors: the sheet light, its words dark, as the page is in that look
        const seen = await tab.run<{ sheet: number; words: number; button: string }>(`(() => {
            const light = (color) => { const canvas = document.createElement("canvas").getContext("2d"); canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1); const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
            const inner = document.querySelector(".quire-shelf-inner");
            return { sheet: light(getComputedStyle(inner).backgroundColor), words: light(getComputedStyle(inner.querySelector(".quire-shelf-name, .quire-shelf-none")).color), button: getComputedStyle(document.querySelector(".quire-palette-button")).visibility };
        })()`);
        expect(seen.sheet).toBeGreaterThan(0.85);
        expect(seen.words).toBeLessThan(0.35);
        expect(seen.button).toBe("hidden");
    } finally {
        await tab.run("localStorage.removeItem('quire-look')");
    }
});

if (!live) console.warn("app.test.ts: no Chromium on this machine, so the app was not used.");
