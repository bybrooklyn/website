// Prints the resume to a one-page PDF with the Chromium installed on this
// machine. Run with `bun run resume:pdf`.
//
// A published resume is written to public/resume/, which is committed and
// served. A draft is written to resume-preview/, which is ignored by git, so
// an unfinished resume can be read as a PDF without being put on the site.

import { $ } from "bun";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { at, isDraft, root } from "./lib";

const built = at(".resume-build");
/** The same name the site links to (resumePdf in src/lib/resume.ts). */
const NAME = "charlotte-resume.pdf";

const chromium = Bun.which("chromium") ?? Bun.which("chromium-browser") ?? Bun.which("google-chrome-stable");
if (!chromium) throw new Error("No Chromium or Chrome found on PATH.");

// Build once into a folder of its own, with drafts included.
await $`bunx astro build --outDir ${built}`.cwd(root).env({ ...process.env, SHOW_DRAFTS: "1" }).quiet();

const server = Bun.serve({
    port: 0,
    async fetch(request) {
        const path = decodeURIComponent(new URL(request.url).pathname);
        const file = Bun.file(join(built, path.endsWith("/") ? `${path}index.html` : path));
        return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
    },
});

const draft = await isDraft("src/content/resume/resume.mdx");
try {
    const folder = at(draft ? "resume-preview" : "public/resume");
    await mkdir(folder, { recursive: true });
    const output = join(folder, NAME);

    await $`${chromium} --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=${output} ${server.url.origin}/resume/`.quiet();

    const pages = ((await Bun.file(output).text()).match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
    console.log(`${draft ? "draft    " : "published"} ${output.replace(root, "")}  ${pages} page${pages === 1 ? "" : "s"}`);
    if (pages !== 1) throw new Error(`The resume is ${pages} pages; it has to fit on one.`);
} finally {
    server.stop(true);
    await rm(built, { recursive: true, force: true });
}

// A published PDF must not outlive a resume that went back to draft.
if (draft) await rm(at("public/resume", NAME), { force: true });
if ((await readdir(at("public/resume")).catch(() => ["x"])).length === 0) await rm(at("public/resume"), { recursive: true });
