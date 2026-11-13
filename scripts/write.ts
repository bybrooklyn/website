// Write for the site in the browser.
//
//   bun run edit
//
// Starts a small server on this computer only and opens an editor in the
// browser: every post, page and project, the resume, and the homepage's
// intro. The editor is mdQuire (src/quire/), with the real page beside the
// text. It saves as you type, and a publish button builds, commits and pushes
// what changed, and deploys to Cloudflare Pages, after showing what is about
// to go live and asking. Press Ctrl+C here to stop.
//
//   --dry-run     go through publishing without committing or deploying
//   --no-open     do not open the browser
//   --no-preview  do not start the site's dev server for the page beside the text
//   --port N      listen on port N (default 4400)
//
// The page itself is scripts/editor/main.ts, its styles scripts/editor/editor.css.

import { $ } from "bun";
import { mkdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { themeStyle } from "../src/lib/color";
import { forEditor } from "./dictation-stubs";
import { preview } from "./editor/preview";
import { at, frontmatter, isDraft, listMdx, root, slug, stem, writeJson } from "./lib";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const port = Number(args[args.indexOf("--port") + 1]) || 4400;
const key = crypto.randomUUID().replace(/-/g, "");
const DEV = "http://localhost:4321";

const exists = (path: string) => Bun.file(at(path)).exists();
const hash = (content: string) => Bun.hash(content).toString(36);

/** The only files the editor may read or write. */
const editable = (path: string) => path === "src/data/site.ts" || /^src\/content\/(blog|pages|projects|resume)\/[\w.-]+\.mdx?$/.test(path);

// ---- what there is to edit ----

async function files() {
    const entry = async (folder: string, name: string) => {
        const path = `${folder}/${name}`;
        const source = await Bun.file(at(path)).text();
        return {
            path,
            label: frontmatter(source, "title") ?? frontmatter(source, "name") ?? stem(name),
            draft: frontmatter(source, "draft") === "true",
            // A project that opens a page of its own is shown there, not at /projects/<name>/.
            route: frontmatter(source, "opens") ?? route(path),
        };
    };
    const folder = async (label: string, where: string) => ({
        label,
        files: await Promise.all((await listMdx(where)).map((name) => entry(where, name))),
    });
    return [
        { label: "photos", files: [{ path: PHOTOS, label: "photo notes", draft: false, route: "/photos/" }] },
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

// ---- notes on photographs ----

const PHOTOS = "src/data/photos.json";

interface PhotoNote {
    file: string;
    title?: string;
    note?: string;
    caption?: string;
    kind?: string;
    taken?: string;
}

const readPhotos = async () => ((await Bun.file(at(PHOTOS)).json()) as { photos: PhotoNote[] }).photos;

/** Keep a picture's heading and the rough notes written about it. Nothing else about it changes. */
async function notePhoto(file: string, title: string, note: string): Promise<void> {
    const photos = await readPhotos();
    const photo = photos.find((candidate) => candidate.file === file);
    if (!photo) throw new Error("That picture is not on the site.");
    photo.title = title.trim() || undefined;
    photo.note = note.trim() || undefined;
    await writeJson(at(PHOTOS), { photos });
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
            // The time as the clock here shows it, written as if it were UTC: it only orders posts
            // within a day, and this keeps the date shown the same as the date it was written.
            `date: ${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}Z`,
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

/** Every page the site makes, as addresses ending in a slash: its pages, posts, projects and minis, and the pages Astro makes from src/pages. */
async function routes(): Promise<Set<string>> {
    const made = new Set(["/", "/blog/", "/projects/", "/minis/", "/photos/", "/resume/"]);
    for (const group of await files()) for (const file of group.files) made.add(file.route.replace(/\/?$/, "/"));
    for (const name of await listMdx("src/content/minis")) made.add(`/minis/${stem(name)}/`);
    for (const page of await Array.fromAsync(new Bun.Glob("**/*.astro").scan({ cwd: at("src/pages") }))) {
        if (page.includes("[")) continue;
        made.add(`/${page.replace(/(^|\/)index\.astro$/, "").replace(/\.astro$/, "/")}`.replace(/\/+$/, "/"));
    }
    return made;
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

/** Why publishing must not go ahead from here, or undefined if it may. */
async function refusal(): Promise<string | undefined> {
    const branch = (await $`git branch --show-current`.cwd(root).nothrow().quiet()).text().trim();
    // Publishing deploys to production, which is main; from any other branch the live site would show what main does not have.
    if (branch !== "main") return `Publishing goes from main only, and this checkout is on ${branch ? `the branch ${branch}` : "no branch"}. Switch to main first.`;
    // Only what is in src/ and public/ is committed, so a file anywhere else would be built without being kept.
    const strays = (await $`git status --porcelain --untracked-files=all`.cwd(root).text())
        .split("\n")
        .filter((line) => line.startsWith("?? "))
        .map((line) => line.slice(3).replace(/^"|"$/g, ""))
        .filter((path) => !path.startsWith("src/") && !path.startsWith("public/"));
    if (strays.length > 0) return `Not publishing: there are new files outside src/ and public/, which the editor does not commit:\n${strays.map((path) => `  ${path}`).join("\n")}\nCommit them, delete them or add them to .gitignore first.`;
    return undefined;
}

async function publish(message: string): Promise<{ ok: boolean; log: string }> {
    const refused = await refusal();
    if (refused) return { ok: false, log: refused };
    if (dryRun) return { ok: true, log: "Dry run: stopped here, before the commit and the deploy." };
    const log: string[] = [];
    const run = async (label: string, command: ReturnType<typeof $>) => {
        const result = await command.cwd(root).nothrow().quiet();
        log.push(`$ ${label}`, (result.stdout.toString() + result.stderr.toString()).trim());
        if (result.exitCode !== 0) throw new Error(log.join("\n"));
    };
    try {
        // Only the folders the editor writes to are staged, never everything in the checkout.
        await run("git add src public", $`git add -A -- src public`);
        if ((await $`git diff --cached --quiet`.cwd(root).nothrow().quiet()).exitCode !== 0) {
            const text = message.trim() || "Edit the site";
            await run("git commit", $`git commit -m ${text}`);
            await run("git push", $`git push`);
        }
        // Built again now, from what was just committed: the build from the plan may be older than the last save.
        await run("bun run build", $`bun run build`);
        const after = (await $`git status --porcelain -- src public`.cwd(root).text()).trim();
        if (after) throw new Error(`${log.join("\n")}\n\nThese files changed while publishing, so the build is not what was committed:\n${after}\nOpen Publish again.`);
        // Named, so that it goes to production whatever git says the branch is.
        await run("wrangler pages deploy", $`bunx wrangler pages deploy --branch main`);
        return { ok: true, log: `${log.join("\n")}\n\nDeployed.` };
    } catch (error) {
        return { ok: false, log: `${error instanceof Error ? error.message : String(error)}\n\nStopped: this step failed.` };
    }
}

// ---- the page ----

// The editor page, the speech engine's worker and the microphone's worklet are built together; the
// page asks for the last two by the names below. ONNX Runtime's files are served from node_modules.
const bundle = await Bun.build({ entrypoints: [at("scripts/editor/main.ts"), at("src/quire/dictation/engine-worker.ts"), at("src/quire/dictation/capture-worklet.ts")], target: "browser", naming: "[name].js", plugins: [forEditor] });
if (!bundle.success) throw new AggregateError(bundle.logs, "The editor's script did not build.");
const built = async (name: string) => bundle.outputs.find((output) => output.path.endsWith(`/${name}.js`))!.text();
const script = await built("main");
const worker = await built("engine-worker");
const worklet = await built("capture-worklet");
const ORT = at("node_modules/onnxruntime-web/dist");

async function styles(): Promise<string> {
    const sheet = (name: string) => Bun.file(at(`src/styles/${name}`)).text();
    // The site gets its @font-face rules from Astro; the editor is not built by Astro, so it has its own.
    const face = (family: string, file: string, style = "normal") =>
        `@font-face{font-family:"${family}";src:url("/fonts/${file}") format("woff2");font-weight:100 900;font-style:${style};font-display:swap}`;
    const fonts = [
        face("Torrens Serif", "torrens-serif.woff2"),
        face("Torrens Serif", "torrens-serif-italic.woff2", "italic"),
        face("Drafting Mono", "drafting-mono.woff2"),
        ':root{--font-torrens:"Torrens Serif",Georgia,serif;--font-mono:"Drafting Mono",ui-monospace,monospace}',
        await sheet("fonts.css"),
    ].join("\n");
    return [`:root{${themeStyle()}}`, fonts, await sheet("tokens.css"), await sheet("base.css"), await sheet("prose.css"), await sheet("quire.css"), await sheet("quire-markdown.css"), await sheet("quire-extras.css"), await Bun.file(at("src/quire/dictation/dictation.css")).text(), await Bun.file(at("scripts/editor/editor.css")).text()].join("\n");
}

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
<body class="quire-app edit-app">
<header class="quire-top"><div class="quire-top-in"><div class="quire-top-line"><div class="quire-trail"><div class="site-id"><p class="site-name">charlotte</p><span class="edit-where">editing on this computer</span></div><span class="quire-stroke quire-name-stroke" aria-hidden="true">/</span><span class="quire-name-home"></span></div><div class="quire-menus-home"></div><div class="quire-status-home"></div></div><div class="quire-bar-home"></div></div></header>
<main id="main">
    <div class="edit-panes">
        <div id="quire" class="quire-host"></div>
        <iframe id="preview" title="The page as it will look"></iframe>
    </div>
</main>
<script type="module" src="/app.js"></script>
</body>
</html>`;

// ---- the server ----

/** Whether a path on the disk is within one of the repo's folders named, and not reached out of one by `..`. */
const inside = (file: string, ...folders: string[]) => folders.some((folder) => !relative(at(folder), file).startsWith(".."));
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
    if (url.pathname === "/engine-worker.ts") return new Response(worker, { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/capture-worklet.js") return new Response(worklet, { headers: { "content-type": "text/javascript" } });
    if (/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url.pathname)) {
        const file = Bun.file(`${ORT}/${url.pathname.slice(5)}`);
        return (await file.exists()) ? new Response(file, { headers: { "content-type": url.pathname.endsWith(".wasm") ? "application/wasm" : "text/javascript" } }) : json({ error: "No such file." }, 404);
    }
    // the spelling check's dictionary, which the site serves from public/
    if (url.pathname === "/quire/words-en.dat") return new Response(Bun.file(at("public/quire/words-en.dat")), { headers: { "content-type": "application/octet-stream" } });
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
        const type = TYPES[extname(file).toLowerCase()];
        // An SVG can hold a script. Opened in a tab of its own it would run on this origin and could
        // ask the server for anything, so it is served sandboxed, with no script and nothing fetched.
        const guarded = { "content-type": type ?? "", "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", "x-content-type-options": "nosniff" };
        return inside(file, "src", "public") && type && (await Bun.file(file).exists()) ? new Response(Bun.file(file), { headers: guarded }) : json({ error: "No such picture." }, 404);
    }
    if (url.pathname === "/api/files") return json(await files());
    if (url.pathname === "/api/exists") {
        // For checking in the editor: a page of the site if the address starts with a slash, else a file beside the document.
        const src = decodeURI(query("src").replace(/[?#].*$/, ""));
        if (src.startsWith("/")) {
            const file = resolve(at("public"), `.${src}`);
            return json({ there: (await routes()).has(src.replace(/\/?$/, "/")) || (inside(file, "public") && (await Bun.file(file).exists())) });
        }
        const file = resolve(dirname(at(query("file"))), src);
        return json({ there: inside(file, "src", "public") && ((await Bun.file(file).exists()) || (await stat(file).then((found) => found.isDirectory(), () => false))) });
    }
    if (url.pathname === "/api/photos" && request.method === "GET") return json({ photos: await readPhotos() });
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
    if (url.pathname === "/api/photos/note") {
        await notePhoto(body.file ?? "", body.title ?? "", body.note ?? "");
        return json({ ok: true });
    }
    if (url.pathname === "/api/plan") return json(await plan(body.path ?? ""));
    if (url.pathname === "/api/publish") return json(await publish(body.message ?? ""));
    return json({ error: "Nothing here." }, 404);
}

const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 255,
    fetch: async (request) => {
        const answer = await handle(request).catch((error: unknown) => json({ error: error instanceof Error ? error.message : String(error) }, 500));
        // No address with the key in it is passed on to another site, and no other page may frame the editor.
        answer.headers.set("referrer-policy", "no-referrer");
        answer.headers.set("x-frame-options", "DENY");
        return answer;
    },
});

// The preview beside the text is the site's own dev server. However the editor ends (Ctrl+C, the
// terminal closed, killed), the server is stopped if this is what started it, and never otherwise.
const stopPreview = args.includes("--no-preview") ? () => {} : await preview(root, DEV);
process.on("exit", stopPreview);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
        stopPreview();
        process.exit(0);
    });
}

const address = `http://127.0.0.1:${server.port}/?k=${key}`;
console.log(`\nThe editor is at:\n\n  ${address}\n\n${dryRun ? "Dry run: publishing will stop before the commit and the deploy.\n" : ""}Press Ctrl+C to stop.`);

if (!args.includes("--no-open")) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    if (Bun.which(opener)) Bun.spawn([opener, address], { stdio: ["ignore", "ignore", "ignore"] });
}
