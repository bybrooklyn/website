// `bun run edit`, used for real: the site is copied to a scratch folder, the server is started
// there (so nothing is written into this repository), its page is opened in headless Chromium, and
// a post is edited and a new one made through the server's own new-post endpoint. The files are
// then read from the scratch folder's disk and held to be byte for byte what the editor should
// have written, the blocks that were not touched keeping their bytes. Publishing is never run.
// Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { browser, chromium, type Browser } from "../browser";

const repo = resolve(import.meta.dir, "../..");
const live = !!chromium();

// a post whose blocks are written in ways a fresh writer would not, so that untouched bytes show
const POST = [
    "---",
    "title: Blocks",
    "date: 2026-11-01T10:00Z",
    'summary: "A post for the test."',
    "draft: true",
    "---",
    "",
    "A first paragraph with __strong__ and _soft_ words.",
    "",
    "* one",
    "* two",
    "",
    "The paragraph that is edited.",
    "",
    "Last,   with   spaces.",
    "",
].join("\n");

let copy = "";
let tab: Browser;
let server: ReturnType<typeof Bun.spawn> | undefined;
let address = "";
let key = "";

beforeAll(async () => {
    if (!live) return;
    copy = await mkdtemp(join(tmpdir(), "edit-site-"));
    await $`cp -r scripts src public package.json tsconfig.json ${copy}/`.cwd(repo).quiet();
    await symlink(join(repo, "node_modules"), join(copy, "node_modules"));
    await Bun.write(join(copy, "src/content/blog/blocks.mdx"), POST);
    const port = 4500 + Math.floor(Math.random() * 400);
    server = Bun.spawn(["bun", "scripts/write.ts", "--no-open", "--no-preview", "--port", String(port)], { cwd: copy, stdout: "pipe", stderr: "pipe" });
    // the address the terminal prints, with its key
    const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
    let printed = "";
    while (!/\?k=\w+/.test(printed)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`The server stopped: ${printed}`);
        printed += new TextDecoder().decode(value);
    }
    address = /(http:\/\/127\.0\.0\.1:\d+\/\?k=(\w+))/.exec(printed)![1]!;
    key = /\?k=(\w+)/.exec(printed)![1]!;
    tab = await browser({ width: 1300, height: 900 });
    await tab.open(address, 300);
    for (let tries = 0; tries < 100 && !(await tab.run("!!document.querySelector('.quire p')")); tries++) await tab.wait(50);
}, 60_000);

afterAll(async () => {
    if (!live) return;
    await tab?.close();
    server?.kill("SIGINT");
    await server?.exited;
    await rm(copy, { recursive: true, force: true });
});

const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 40_000);
const onDisk = (path: string) => Bun.file(join(copy, path)).text();

async function press(selector: string, words = "") {
    const point = await tab.run<{ x: number; y: number } | null>(`(() => {
        const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => !${JSON.stringify(words)} || each.textContent.includes(${JSON.stringify(words)}));
        if (!found) return null;
        const box = found.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words}`);
    await tab.click(point.x, point.y);
    await tab.wait(60);
}

/** Opens a file from the list that grows out of the name. */
async function open(words: string) {
    await press(".quire-bar .quire-name");
    await tab.wait(700);
    await press(".quire-documents-list .quire-menu-line", words);
    for (let tries = 0; tries < 60 && !(await tab.run(`document.querySelector('.quire-name-text').textContent.includes(${JSON.stringify(words)})`)); tries++) await tab.wait(50);
    await tab.wait(200);
}

/** Puts the cursor at the end of the paragraph whose text starts with the words. */
async function endOf(words: string) {
    await tab.run(`(() => {
        const paragraph = [...document.querySelectorAll('.quire p')].find((each) => each.textContent.startsWith(${JSON.stringify(words)}));
        const selection = getSelection();
        selection.selectAllChildren(paragraph);
        selection.collapseToEnd();
    })()`);
    await tab.wait(50);
}

used("a paragraph edited in a post is saved to its file, every other byte of the file as it was", async () => {
    await open("Blocks");
    expect(await tab.run("document.querySelector('#preview').getAttribute('src')")).toBe("http://localhost:4321/blog/blocks/");
    await endOf("The paragraph that is edited.");
    await tab.type(" Edited here.");
    await tab.wait(1500);
    expect(await onDisk("src/content/blog/blocks.mdx")).toBe(POST.replace("The paragraph that is edited.", "The paragraph that is edited. Edited here."));
    expect(await tab.run("document.querySelector('.quire-status').getAttribute('aria-label')")).toBe("Saved");
});

used("a new post is made by the server's own endpoint, its frontmatter edited as fields, and its text written", async () => {
    const made = await fetch(new URL("/api/new", address), { method: "POST", headers: { "x-edit-key": key, "content-type": "application/json" }, body: JSON.stringify({ title: "Scratch post" }) });
    expect(((await made.json()) as { path: string }).path).toBe("src/content/blog/scratch-post.mdx");
    const before = await onDisk("src/content/blog/scratch-post.mdx");
    await open("Scratch post");
    // the frontmatter is a form of its fields
    expect(await tab.run("[...document.querySelectorAll('.edit-front-name')].map((name) => name.textContent)")).toEqual(["title", "date", "summary", "draft"]);
    await tab.run("(() => { const row = [...document.querySelectorAll('.edit-front-row')].find((each) => each.textContent.startsWith('summary')); const input = row.querySelector('input'); input.focus(); input.select(); })()");
    await tab.type("A scratch post: made by the test.");
    // and the text below it
    await tab.run("(() => { const text = document.querySelector('.quire'); text.focus(); const selection = getSelection(); selection.selectAllChildren(text); selection.collapseToEnd(); })()");
    await tab.wait(50);
    await tab.type("Words of the post.");
    await tab.wait(1500);
    const expected = before.replace('summary: "TODO: one sentence about this post."', 'summary: "A scratch post: made by the test."').replace(/\n\n$/, "\n\nWords of the post.\n");
    expect(await onDisk("src/content/blog/scratch-post.mdx")).toBe(expected);
    // the date and the commented lines are as the server wrote them
    expect(expected.split("\n").filter((line) => line.startsWith("date:") || line.startsWith("#"))).toEqual(before.split("\n").filter((line) => line.startsWith("date:") || line.startsWith("#")));
});

used("the raw frontmatter is behind a switch, and the real page beside the text can be hidden and shown", async () => {
    await press(".edit-front-swap");
    await tab.wait(400);
    expect(await tab.run("getComputedStyle(document.querySelector('.edit-front-raw')).visibility")).toBe("visible");
    expect(await tab.run("document.querySelector('.edit-front-raw').value")).toContain("summary: \"A scratch post: made by the test.\"");
    await press(".edit-front-swap");
    await press(".quire-dots");
    await tab.wait(700);
    await press(".quire-menu.open .quire-menu-line", "Hide the page");
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('#preview')).visibility")).toBe("hidden");
    await press(".quire-dots");
    await tab.wait(700);
    await press(".quire-menu.open .quire-menu-line", "Show the page");
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('#preview')).visibility")).toBe("visible");
});

used("the notes on photographs open in the text's place, a picture at a time", async () => {
    await press(".quire-bar .quire-name");
    await tab.wait(700);
    await press(".quire-documents-list .quire-menu-line", "photo notes");
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('.edit-notes')).visibility")).toBe("visible");
    expect(await tab.run("document.querySelector('.edit-notes-count').textContent")).toMatch(/^1 of \d+$/);
    await press(".edit-notes button", "Back to writing");
    await tab.wait(500);
    expect(await tab.run("getComputedStyle(document.querySelector('.edit-notes')).visibility")).toBe("hidden");
    expect(tab.errors.filter((error) => !error.includes("localhost:4321"))).toEqual([]);
});

if (!live) console.warn("edit.test.ts: no Chromium on this machine, so the editor was not used.");
