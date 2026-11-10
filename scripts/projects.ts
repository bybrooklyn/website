// Reads a few facts about each project's repository from GitHub and writes
// src/data/project-facts.json. Run by hand with `bun run projects`; the site
// build only reads the committed JSON. Needs a logged-in `gh`.

import { $ } from "bun";
import { readdir } from "node:fs/promises";

interface Facts {
    license: string | null;
    stars: number;
    release: string | null;
    updated: string;
    public: boolean;
}

const folder = new URL("../src/content/projects/", import.meta.url);
const facts: Record<string, Facts> = {};

for (const file of (await readdir(folder)).sort()) {
    if (!file.endsWith(".mdx")) continue;
    const source = await Bun.file(new URL(file, folder)).text();
    const repo = /^repo:\s*(\S+)\s*$/m.exec(source)?.[1];
    if (!repo) continue;

    // A project can be written up before its repository exists.
    const found = await $`gh api repos/${repo}`.nothrow().quiet();
    if (found.exitCode !== 0) {
        console.log(file, "(no repository yet)");
        continue;
    }
    const info = found.json() as {
        license: { spdx_id: string } | null;
        stargazers_count: number;
        pushed_at: string;
        private: boolean;
    };
    const release = await $`gh api repos/${repo}/releases/latest --jq .tag_name`.nothrow().quiet();

    const license = info.license?.spdx_id;
    facts[file.replace(/\.mdx$/, "")] = {
        license: license && license !== "NOASSERTION" ? license : null,
        stars: info.stargazers_count,
        release: release.exitCode === 0 ? release.text().trim() || null : null,
        updated: info.pushed_at.slice(0, 10),
        public: !info.private,
    };
    console.log(file, facts[file.replace(/\.mdx$/, "")]);
}

await Bun.write(new URL("../src/data/project-facts.json", import.meta.url), `${JSON.stringify(facts, null, 4)}\n`);
