// After a build, removes generated files that nothing on the site refers to.
// Astro makes the pictures of every piece of content, including drafts that
// are not published, so a draft's cover would otherwise be put online. The
// same goes for the copies of trailers in public/videos/, which Astro copies
// whole: one that no built page names (its page is a draft) is taken out.
// Scripts are pruned too: a page left out of the build (a draft, or one that
// is hidden) still has its scripts written, and one that no other file names
// is taken out. So are the engines in wasm/, copied whole from public/wasm/,
// once no script left names them. Removing one file can leave another
// unnamed, so this goes round until nothing more is removed.

import { readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

/** The name a file is referred to by, if it is one that may be pruned. */
export function prunable(file: string): string | undefined {
    if (file.startsWith("videos/") && /\.(mp4|webm)$/.test(file)) return `/${file}`;
    if (file.startsWith("wasm/") && file.endsWith(".wasm")) return `/${file}`;
    // generated files, pictures and scripts alike, are named by their hashed name alone; styles are
    // written into the pages, and a stylesheet left over is not worth the risk of missing a use
    if (file.startsWith("_astro/") && !file.endsWith(".css")) return file.slice("_astro/".length);
    return undefined;
}

/** Which of the files are named by none of the others. Each text is a file's contents, by its path. */
export function unused(texts: Map<string, string>, files: string[]): string[] {
    const gone: string[] = [];
    for (const file of files) {
        const name = prunable(file);
        if (!name) continue;
        const named = [...texts].some(([other, text]) => other !== file && (text.includes(name) || text.includes(encodeURI(name))));
        if (!named) gone.push(file);
    }
    return gone;
}

export default function pruneAssets(): AstroIntegration {
    return {
        name: "prune-assets",
        hooks: {
            "astro:build:done": async ({ dir, logger }) => {
                const root = fileURLToPath(dir);
                let files = (await readdir(root, { recursive: true })).map(String);
                // Everything that can name another file: pages, styles, scripts, feeds.
                const texts = new Map<string, string>();
                for (const file of files) if (/\.(html|css|js|mjs|xml|json|txt)$/.test(file)) texts.set(file, await readFile(`${root}/${file}`, "utf8"));
                let removed = 0;
                for (;;) {
                    const gone = unused(texts, files);
                    if (gone.length === 0) break;
                    for (const file of gone) {
                        await rm(`${root}/${file}`);
                        texts.delete(file);
                    }
                    files = files.filter((file) => !gone.includes(file));
                    removed += gone.length;
                }
                logger.info(`removed ${removed} generated file${removed === 1 ? "" : "s"} that nothing uses`);
            },
        },
    };
}
