// Fails the build if a page links to a repository that is still private.
// A visitor following such a link gets GitHub's "not found" page.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import facts from "../src/data/project-facts.json";

const folder = "src/content/projects";

export default function privateLinks(): AstroIntegration {
    return {
        name: "private-links",
        hooks: {
            "astro:build:done": async ({ dir, logger }) => {
                // The repositories the facts file says are private, by the address a link to them would have.
                const hidden: string[] = [];
                for (const file of await readdir(folder)) {
                    const repo = /^repo:\s*(\S+)/m.exec(await readFile(`${folder}/${file}`, "utf8"))?.[1];
                    const known = (facts as Record<string, { public: boolean }>)[file.replace(/\.mdx?$/, "")];
                    if (repo && known && !known.public) hidden.push(`href="https://github.com/${repo}"`);
                }
                const root = fileURLToPath(dir);
                const found: string[] = [];
                for (const file of await readdir(root, { recursive: true })) {
                    if (!file.endsWith(".html")) continue;
                    const page = (await readFile(`${root}/${file}`, "utf8")).toLowerCase();
                    for (const link of hidden) if (page.includes(link.toLowerCase())) found.push(`${file}: ${link}`);
                }
                if (found.length > 0) throw new Error(`Links to private repositories:\n${found.join("\n")}`);
                logger.info(`no links to ${hidden.length} private repositories`);
            },
        },
    };
}
