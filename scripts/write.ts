// Write for the site in the browser.
//
//   bun run edit
//
// Starts a small server on this computer only and opens an editor in the
// browser: every post, page and project, the resume, and the homepage's
// intro. A file is edited as its Markdown, with the real page beside it;
// rich text is a switch. It saves as you type, and a publish button builds,
// commits and pushes what changed, and deploys to Cloudflare Pages, after
// showing what is about to go live and asking. Press Ctrl+C here to stop.
//
//   --dry-run    go through publishing without committing or deploying
//   --no-open    do not open the browser
//   --port N     listen on port N (default 4400)
//
// The page itself is scripts/editor/.

import { $ } from "bun";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { themeStyle } from "../src/lib/color";

const root = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const port = Number(args[args.indexOf("--port") + 1]) || 4400;
const key = crypto.randomUUID().replace(/-/g, "");
const DEV = "http://localhost:4321";

const at = (path: string) => join(root, path);
const exists = (path: string) => Bun.file(at(path)).exists();
const hash = (content: string) => Bun.hash(content).toString(36);

/** The only files the editor may read or write. */
const editable = (path: string) => path === "src/data/site.ts" || /^src\/content\/(blog|pages|projects|resume)\/[\w.-]+\.mdx?$/.test(path);

function frontmatter(source: string, name: string): string | undefined {
    return new RegExp(`^${name}:\\s*(.*)$`, "m").exec(source)?.[1]?.trim().replace(/^"|"$/g, "");
}

async function listMdx(folder: string): Promise<string[]> {
    const names = await readdir(at(folder)).catch(() => []);
    return names.filter((name) => /\.mdx?$/.test(name)).sort();
}

async function isDraft(path: string): Promise<boolean> {
    return frontmatter(await Bun.file(at(path)).text(), "draft") === "true";
}

function slug(title: string): string {
    return title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

// ---- what there is to edit ----

async function files() {
    const entry = async (folder: string, name: string) => {
        const path = `${folder}/${name}`;
        const source = await Bun.file(at(path)).text();
        return {
            path,
            label: frontmatter(source, "title") ?? frontmatter(source, "name") ?? name.replace(/\.mdx?$/, ""),
            draft: frontmatter(source, "draft") === "true",
            route: route(path),
        };
    };
    const folder = async (label: string, where: string) => ({
        label,
        files: await Promise.all((await listMdx(where)).map((name) => entry(where, name))),
    });
    return [
        await folder("posts", "src/content/blog"),
        {
            label: "pages",
            files: [
                { path: "src/data/site.ts", label: "intro, contact, nav", draft: false, route: "/" },
                ...(await folder("", "src/content/pages")).files,
                ...(await folder("", "src/content/resume")).files.map((file) => ({ ...file, label: "resume" })),
            ],
        },
        await folder("projects", "src/content/projects"),
    ];
}

async function newPost(title: string): Promise<string> {
    const path = `src/content/blog/${slug(title)}.mdx`;
    if (!slug(title)) throw new Error("That title has no letters or numbers in it.");
    if (await exists(path)) return path;
    await Bun.write(
        at(path),
        [
            "---",
            `title: ${JSON.stringify(title)}`,
            `date: ${new Date().toISOString().slice(0, 10)}`,
            'summary: "TODO: one sentence about this post."',
            "# accent: pink          # violet (default), pink, blue, mint or amber",
            "# cover: ../../assets/covers/picture.png",
            "# coverAlt: What the picture shows.",
            "draft: true",
            "---",
            "",
            "",
        ].join("\n"),
    );
    return path;
}

/** Where a file's page is on the site. */
function route(path: string): string {
    const name = path.split("/").pop()!.replace(/\.mdx?$/, "");
    if (path.includes("/blog/")) return `/blog/${name}/`;
    if (path.includes("/projects/")) return `/projects/${name}/`;
    if (path.includes("/pages/")) return `/${name}/`;
    if (path.includes("/resume/")) return "/resume/";
    return "/";
}

async function devServer(): Promise<void> {
    const up = () => fetch(DEV).then(() => true, () => false);
    if (await up()) return;
    // Astro's dev server carries on in the background by itself.
    await $`bunx astro dev`.cwd(root).nothrow().quiet();
    for (let tries = 0; tries < 40 && !(await up()); tries++) await Bun.sleep(250);
}

// ---- publishing ----

async function drafts(): Promise<string[]> {
    const found: string[] = [];
    for (const folder of ["src/content/blog", "src/content/pages", "src/content/resume", "src/content/projects"]) {
        for (const name of await listMdx(folder)) {
            if (await isDraft(`${folder}/${name}`)) found.push(`${folder.replace("src/content/", "")}/${name}`);
        }
    }
    return found;
}

/** Check and build, and say plainly what a deploy would put on the live site. */
async function plan(path: string) {
    const failed = (log: string) => ({ ok: false, log: log.split("\n").slice(-30).join("\n"), pages: 0, drafts: [], changed: "", message: "", dryRun });
    const check = await $`bun run check`.cwd(root).nothrow().quiet();
    if (check.exitCode !== 0) return failed(check.stdout.toString() + check.stderr.toString());
    if (path.includes("content/resume/") && !(await isDraft(path))) {
        const pdf = await $`bun run resume:pdf`.cwd(root).nothrow().quiet();
        if (pdf.exitCode !== 0) return failed(pdf.stdout.toString() + pdf.stderr.toString());
    }
    const build = await $`bun run build`.cwd(root).nothrow().quiet();
    if (build.exitCode !== 0) return failed(build.stdout.toString() + build.stderr.toString());
    const name = path.split("/").pop()?.replace(/\.mdx?$/, "") ?? "the site";
    return {
        ok: true,
        log: "",
        pages: (await $`find dist -name index.html`.cwd(root).text()).trim().split("\n").length,
        drafts: await drafts(),
        changed: (await $`git status --short`.cwd(root).text()).trimEnd(),
        message: path.includes("/blog/") ? `Publish ${name}` : `Edit ${name}`,
        dryRun,
    };
}

async function publish(message: string): Promise<{ ok: boolean; log: string }> {
    if (dryRun) return { ok: true, log: "Dry run: stopped here, before the commit and the deploy." };
    const log: string[] = [];
    const run = async (label: string, command: ReturnType<typeof $>) => {
        const result = await command.cwd(root).nothrow().quiet();
        log.push(`$ ${label}`, (result.stdout.toString() + result.stderr.toString()).trim());
        if (result.exitCode !== 0) throw new Error(log.join("\n"));
    };
    try {
        if ((await $`git status --short`.cwd(root).text()).trim()) {
            const text = message.trim() || "Edit the site";
            if (await exists(".jj/repo")) {
                // The repo is managed with jujutsu alongside git: commit the working
                // copy, move main onto it, and push that.
                await run("jj commit", $`jj commit -m ${text}`);
                await run("jj bookmark set main", $`jj bookmark set main -r @-`);
                await run("jj git push", $`jj git push --bookmark main`);
            } else {
                await run("git add", $`git add -A`);
                await run("git commit", $`git commit -m ${text}`);
                await run("git push", $`git push`);
            }
        }
        await run("wrangler pages deploy", $`bunx wrangler pages deploy`);
        return { ok: true, log: `${log.join("\n")}\n\nDeployed.` };
    } catch (error) {
        return { ok: false, log: `${error instanceof Error ? error.message : String(error)}\n\nStopped: this step failed.` };
    }
}

// ---- the page ----

const bundle = await Bun.build({ entrypoints: [at("scripts/editor/app.ts")], target: "browser" });
if (!bundle.success) throw new AggregateError(bundle.logs, "The editor's script did not build.");
const script = await bundle.outputs[0]!.text();

async function styles(): Promise<string> {
    const sheet = (name: string) => Bun.file(at(`src/styles/${name}`)).text();
    const fonts = (await sheet("fonts.css")).replace(/url\("\.\.\/assets\/fonts\//g, 'url("/fonts/');
    return [`:root{${themeStyle()}}`, fonts, await sheet("tokens.css"), await sheet("prose.css"), await Bun.file(at("scripts/editor/editor.css")).text()].join("\n");
}

const tool = (name: string, label: string, title: string) => `<button type="button" data-tool="${name}" title="${title}">${label}</button>`;
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="edit-key" content="${key}">
<meta name="edit-site" content="${DEV}">
<title>editing bybrooklyn.dev</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<aside id="files">
    <p class="name">charlotte</p>
    <button type="button" id="new">new post</button>
    <input id="new-title" hidden placeholder="title, then Enter" aria-label="Title of the new post">
    <nav id="list" aria-label="Files"></nav>
</aside>
<main>
    <div id="bar">
        <div id="tools">
            ${tool("bold", "bold", "bold (Ctrl+B)")}
            ${tool("italic", "italic", "italic (Ctrl+I)")}
            ${tool("strike", "strike", "strike through")}
            ${tool("code", "code", "code")}
            ${tool("link", "link", "link (Ctrl+K)")}
            ${tool("h2", "h2", "heading")}
            ${tool("h3", "h3", "smaller heading")}
            ${tool("ul", "list", "bulleted list")}
            ${tool("ol", "1. list", "numbered list")}
            ${tool("quote", "quote", "quote")}
            ${tool("codeblock", "code block", "a block of code")}
            ${tool("image", "picture", "add a picture")}
            ${tool("rule", "line", "a dividing line")}
        </div>
        <input id="link" hidden placeholder="https://… then Enter (empty removes the link)" aria-label="Link address">
        <input id="picture" type="file" accept="image/*" hidden>
        <span id="status" class="push" role="status"></span>
        <span id="mode">
            <button type="button" id="mode-markdown" aria-pressed="true">markdown</button>
            <button type="button" id="mode-rich" aria-pressed="false">rich text</button>
        </span>
        <button type="button" id="toggle-preview" aria-pressed="true">preview</button>
        <a id="view" target="_blank" rel="noopener" title="open the page in its own tab">open</a>
        <button type="button" id="publish">publish</button>
    </div>
    <div id="panes">
        <div id="write">
            <textarea id="text" spellcheck="true" aria-label="The file"></textarea>
            <div id="rich" hidden>
                <textarea id="front" spellcheck="false" rows="1" aria-label="Frontmatter"></textarea>
                <div id="body" class="prose" contenteditable="true" spellcheck="true" aria-label="The page's text"></div>
            </div>
        </div>
        <iframe id="preview" title="The page as it will look"></iframe>
    </div>
</main>
<dialog id="dialog">
    <h2>publish</h2>
    <pre id="report"></pre>
    <input id="message" hidden aria-label="Commit message">
    <div class="dialog-buttons">
        <button type="button" id="close">close</button>
        <button type="button" id="deploy" hidden>deploy to bybrooklyn.dev</button>
    </div>
</dialog>
<script type="module" src="/app.js"></script>
</body>
</html>`;

// ---- the server ----

const json = (data: unknown, status = 200) => Response.json(data, { status });
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const query = (name: string) => url.searchParams.get(name) ?? "";

    // Only this computer's own browser, on this address, may talk to the editor.
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return json({ error: "Not here." }, 403);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Not from there." }, 403);

    if (url.pathname === "/style.css") return new Response(await styles(), { headers: { "content-type": "text/css" } });
    if (url.pathname === "/app.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (url.pathname.startsWith("/fonts/")) {
        const file = Bun.file(resolve(at("src/assets/fonts"), `.${url.pathname.slice(6)}`));
        return /^\/fonts\/(full\/)?[\w-]+\.woff2$/.test(url.pathname) && (await file.exists()) ? new Response(file) : json({ error: "No such font." }, 404);
    }

    const allowed = request.headers.get("x-edit-key") === key || query("k") === key;
    if (!allowed) return json({ error: "This link is missing its key. Use the address the terminal printed." }, 403);

    if (url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

    if (url.pathname === "/api/asset") {
        // A picture named in a file: from public/ if it starts with a slash, else beside the file.
        const src = query("src");
        const file = src.startsWith("/") ? resolve(at("public"), `.${src}`) : resolve(dirname(at(query("file"))), src);
        const inside = [at("src"), at("public")].some((folder) => !relative(folder, file).startsWith(".."));
        const type = TYPES[extname(file).toLowerCase()];
        return inside && type && (await Bun.file(file).exists()) ? new Response(Bun.file(file), { headers: { "content-type": type } }) : json({ error: "No such picture." }, 404);
    }
    if (url.pathname === "/api/files") return json(await files());
    if (url.pathname === "/api/file") {
        const path = query("path");
        if (!editable(path) || !(await exists(path))) return json({ error: "That file is not one the editor opens." }, 404);
        const content = await Bun.file(at(path)).text();
        return json({ content, hash: hash(content) });
    }
    if (request.method !== "POST") return json({ error: "Nothing here." }, 404);

    if (url.pathname === "/api/upload") {
        const path = query("file");
        const name = query("name").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+/, "");
        if (!editable(path) || !TYPES[extname(name)] || extname(name) === ".woff2") return json({ error: "That is not a picture the site can use." }, 400);
        const folder = path.includes("/projects/") ? "src/assets/projects" : "src/assets/posts";
        await mkdir(at(folder), { recursive: true });
        let target = `${folder}/${name}`;
        for (let copy = 2; await exists(target); copy++) target = `${folder}/${name.replace(/(\.\w+)$/, `-${copy}$1`)}`;
        await Bun.write(at(target), await request.arrayBuffer());
        return json({ url: relative(dirname(at(path)), at(target)) });
    }

    const body = (await request.json()) as Record<string, string>;
    if (url.pathname === "/api/save") {
        const { path = "", content = "" } = body;
        if (!editable(path) || !(await exists(path))) return json({ error: "That file is not one the editor opens." }, 404);
        if (hash(await Bun.file(at(path)).text()) !== body.hash) {
            return json({ error: "This file changed on disk since it was opened. Open it again from the list to carry on (your last change was not saved)." }, 409);
        }
        await Bun.write(at(path), content);
        return json({ hash: hash(content) });
    }
    if (url.pathname === "/api/new") return json({ path: await newPost(body.title ?? "") });
    if (url.pathname === "/api/plan") return json(await plan(body.path ?? ""));
    if (url.pathname === "/api/publish") return json(await publish(body.message ?? ""));
    return json({ error: "Nothing here." }, 404);
}

const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 255,
    fetch: (request) => handle(request).catch((error: unknown) => json({ error: error instanceof Error ? error.message : String(error) }, 500)),
});

// The preview beside the text is the site's own dev server.
await devServer();

const address = `http://127.0.0.1:${server.port}/?k=${key}`;
console.log(`\nThe editor is at:\n\n  ${address}\n\n${dryRun ? "Dry run: publishing will stop before the commit and the deploy.\n" : ""}Press Ctrl+C to stop.`);
if (!args.includes("--no-open")) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    if (Bun.which(opener)) Bun.spawn([opener, address], { stdio: ["ignore", "ignore", "ignore"] });
}
