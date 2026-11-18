// After a build, removes generated files that nothing on the site refers to.
// Astro makes the pictures of every piece of content, including drafts that
// are not published, so a draft's cover would otherwise be put online. The
// same goes for the copies of trailers in public/videos/, which Astro copies
// whole: one that no built page names (its page is a draft) is taken out.

import { readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

export default function pruneAssets(): AstroIntegration {
    return {
        name: "prune-assets",
        hooks: {
            "astro:build:done": async ({ dir, logger }) => {
                const root = fileURLToPath(dir);
                const files = await readdir(root, { recursive: true });
                // Everything that can name another file: pages, styles, scripts, feeds.
                let text = "";
                for (const file of files) if (/\.(html|css|js|mjs|xml|json|txt)$/.test(file)) text += await readFile(`${root}/${file}`, "utf8");
                let removed = 0;
                for (const file of files) {
                    const video = file.startsWith("videos/") && /\.(mp4|webm)$/.test(file);
                    if (!video && (!file.startsWith("_astro/") || /\.(css|js|mjs)$/.test(file))) continue;
                    // A generated file is named by its hashed name alone; a video by its whole address.
                    const name = video ? `/${file}` : file.slice("_astro/".length);
                    if (text.includes(name) || text.includes(encodeURI(name))) continue;
                    await rm(`${root}/${file}`);
                    removed++;
                }
                logger.info(`removed ${removed} generated file${removed === 1 ? "" : "s"} that nothing uses`);
            },
        },
    };
}
