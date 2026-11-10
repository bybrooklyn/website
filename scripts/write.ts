// Write for the site from the terminal.
//
//   bun run blog    start a new post, or carry on with a draft, then publish
//   bun run edit    change any text on the site: the intro, the about page,
//                   the setup page, the resume, a project, a post
//
// Either one opens the file in your editor ($VISUAL, then $EDITOR, then
// Neovim, VS Code or nano, whichever exists). When you close the editor it
// checks the site still builds and offers to publish.
//
// Publishing means: build, commit and push what changed, and deploy to
// Cloudflare Pages. It always shows what is about to go live and asks first.
// Add --dry-run to go through everything without committing or deploying.

import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dryRun = process.argv.includes("--dry-run");
const mode = process.argv[2] === "edit" ? "edit" : "blog";

const at = (path: string) => join(root, path);
const exists = (path: string) => Bun.file(at(path)).exists();

function ask(question: string, fallback = ""): string {
    const answer = prompt(fallback ? `${question} [${fallback}]` : question);
    return (answer ?? "").trim() || fallback;
}

function yes(question: string): boolean {
    return /^y(es)?$/i.test(ask(`${question} (y/n)`, "n"));
}

/** Show a numbered list and return the one picked, or nothing. */
function pick<T>(title: string, choices: { label: string; value: T }[]): T | undefined {
    console.log(`\n${title}`);
    choices.forEach((choice, index) => console.log(`  ${String(index + 1).padStart(2)}. ${choice.label}`));
    const index = Number(ask("\nNumber, or Enter to quit:")) - 1;
    return choices[index]?.value;
}

async function openInEditor(path: string): Promise<void> {
    const candidates = [process.env.VISUAL, process.env.EDITOR, "nvim", "code --wait", "nano"];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const [command, ...args] = candidate.split(" ");
        if (!command || !Bun.which(command)) continue;
        const editor = Bun.spawn([command, ...args, at(path)], { stdio: ["inherit", "inherit", "inherit"] });
        await editor.exited;
        return;
    }
    throw new Error("No editor found. Set $EDITOR to the one you use.");
}

function frontmatter(source: string, key: string): string | undefined {
    return new RegExp(`^${key}:\\s*(.*)$`, "m").exec(source)?.[1]?.trim();
}

async function isDraft(path: string): Promise<boolean> {
    return frontmatter(await Bun.file(at(path)).text(), "draft") === "true";
}

async function setDraft(path: string, draft: boolean): Promise<void> {
    const source = await Bun.file(at(path)).text();
    const line = /^draft:\s*(true|false)\s*$/m;
    const next = line.test(source)
        ? source.replace(line, `draft: ${draft}`)
        : source.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\ndraft: ${draft}\n---`);
    await Bun.write(at(path), next);
}

function slug(title: string): string {
    return title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

async function listMdx(folder: string): Promise<string[]> {
    const names = await readdir(at(folder)).catch(() => []);
    return names.filter((name) => /\.mdx?$/.test(name)).sort();
}

// ---- writing a post ----

async function newPost(): Promise<string | undefined> {
    const title = ask("\nTitle:");
    if (!title) return undefined;
    const path = `src/content/blog/${slug(title)}.mdx`;
    if (await exists(path)) {
        console.log(`There is already a post at ${path}; opening that one.`);
        return path;
    }
    const summary = ask("One sentence for the blog list (you can change it later):", "TODO: one sentence about this post.");
    const tags = ask("Tags, separated by commas (optional):")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);

    await Bun.write(
        at(path),
        [
            "---",
            `title: ${JSON.stringify(title)}`,
            `date: ${today}`,
            `summary: ${JSON.stringify(summary)}`,
            ...(tags.length > 0 ? [`tags: [${tags.join(", ")}]`] : []),
            "# accent: pink          # violet (default), pink, blue, mint or amber",
            "# cover: ../../assets/covers/picture.png",
            "# coverAlt: What the picture shows.",
            "draft: true",
            "---",
            "",
            "Start writing here. Use ## for section headings; they become the contents on the right.",
            "",
        ].join("\n"),
    );
    return path;
}

async function choosePost(): Promise<string | undefined> {
    const posts = await listMdx("src/content/blog");
    const choices: { label: string; value: string }[] = [{ label: "Write a new post", value: "" }];
    for (const name of posts) {
        const path = `src/content/blog/${name}`;
        const source = await Bun.file(at(path)).text();
        const title = frontmatter(source, "title")?.replace(/^"|"$/g, "") ?? name;
        choices.push({ label: `${title}${(await isDraft(path)) ? "  (draft)" : ""}`, value: path });
    }
    const picked = pick("What do you want to write?", choices);
    if (picked === undefined) return undefined;
    return picked === "" ? newPost() : picked;
}

// ---- editing anything else ----

async function chooseAnything(): Promise<string | undefined> {
    const choices: { label: string; value: string }[] = [
        { label: "The homepage intro, contact details and nav  (src/data/site.ts)", value: "src/data/site.ts" },
    ];
    const add = async (label: string, path: string) => {
        if (await exists(path)) {
            const draft = /\.mdx?$/.test(path) && (await isDraft(path));
            choices.push({ label: `${label}${draft ? "  (draft)" : ""}`, value: path });
        }
    };
    await add("About page", "src/content/pages/about.mdx");
    await add("Setup page", "src/content/pages/setup.mdx");
    await add("Resume", "src/content/resume/resume.mdx");
    for (const name of await listMdx("src/content/projects")) {
        await add(`Project: ${name.replace(/\.mdx?$/, "")}`, `src/content/projects/${name}`);
    }
    for (const name of await listMdx("src/content/blog")) {
        await add(`Post: ${name.replace(/\.mdx?$/, "")}`, `src/content/blog/${name}`);
    }
    return pick("What do you want to edit?", choices);
}

// ---- publishing ----

async function publish(path: string): Promise<void> {
    if (/\.mdx?$/.test(path) && (await isDraft(path))) {
        if (yes("\nThis is still marked as a draft, so it will not appear on the site. Publish it?")) {
            await setDraft(path, false);
        }
    }

    console.log("\nChecking the site still builds...");
    const check = await $`bun run check`.cwd(root).nothrow().quiet();
    if (check.exitCode !== 0) {
        console.log(check.stdout.toString().split("\n").slice(-25).join("\n"));
        console.log("\nThe check failed, so nothing was published. Fix the problem above and run this again.");
        return;
    }
    if (path.includes("content/resume/") && !(await isDraft(path))) {
        console.log("Printing the resume PDF...");
        await $`bun run resume:pdf`.cwd(root);
    }
    await $`bun run build`.cwd(root).quiet();

    // Say plainly what a deploy would put on the live site.
    const drafts: string[] = [];
    for (const folder of ["src/content/blog", "src/content/pages", "src/content/resume", "src/content/projects"]) {
        for (const name of await listMdx(folder)) {
            if (await isDraft(`${folder}/${name}`)) drafts.push(`${folder.replace("src/content/", "")}/${name}`);
        }
    }
    const pages = (await $`find dist -name index.html`.cwd(root).text()).trim().split("\n").length;
    console.log(`\nBuilt ${pages} pages.`);
    console.log(drafts.length > 0 ? `Still drafts, so NOT going live: ${drafts.join(", ")}` : "Nothing is marked as a draft.");
    const changed = (await $`git status --short`.cwd(root).text()).trim();
    console.log(changed ? `\nChanged files that will be committed:\n${changed}` : "\nNo tracked files changed (private files are never committed).");

    if (!yes("\nDeploy this to bybrooklyn.dev now?")) {
        console.log("Not deployed. Your changes are saved; run this again when you are ready.");
        return;
    }
    if (dryRun) {
        console.log("Dry run: stopping here, before the commit and the deploy.");
        return;
    }

    if (changed) {
        const message = ask("Commit message:", mode === "blog" ? `Publish ${path.split("/").pop()?.replace(/\.mdx?$/, "")}` : `Edit ${path.split("/").pop()}`);
        if (await exists(".jj/repo")) {
            // The repo is managed with jujutsu alongside git: commit the working
            // copy, move main onto it, and push that.
            await $`jj commit -m ${message}`.cwd(root);
            await $`jj bookmark set main -r @-`.cwd(root);
            await $`jj git push --bookmark main`.cwd(root);
        } else {
            await $`git add -A`.cwd(root);
            await $`git commit -m ${message}`.cwd(root);
            await $`git push`.cwd(root);
        }
    }
    await $`bunx wrangler pages deploy`.cwd(root);
    console.log("\nDeployed.");
}

// ---- main ----

const path = mode === "edit" ? await chooseAnything() : await choosePost();
if (!path) {
    console.log("Nothing chosen.");
    process.exit(0);
}

console.log(`\nOpening ${path} ...`);
await openInEditor(path);
console.log("Saved.");

if (yes("\nSee it in the browser first? (drafts included)")) {
    // The dev server runs in the background and says where it is listening.
    await $`bunx astro dev`.cwd(root).nothrow();
    ask("\nHave a look, then press Enter here to carry on.");
}

await publish(path);
