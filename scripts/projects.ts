// Reads a few facts about each project's repository from GitHub and writes
// src/data/project-facts.json. Run by hand with `bun run projects`; the site
// build only reads the committed JSON. Needs a logged-in `gh`. On the page of a
// public project the numbers are then brought up to date in the visitor's
// browser (see the script in src/pages/projects/[slug].astro).

import { $ } from "bun";
import type { ProjectFacts } from "../src/lib/projects";
import { at, frontmatter, listMdx, stem, writeJson } from "./lib";

const folder = "src/content/projects";
const facts: Record<string, ProjectFacts> = {};

for (const file of await listMdx(folder)) {
    const repo = frontmatter(await Bun.file(at(folder, file)).text(), "repo");
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
        forks_count: number;
        pushed_at: string;
        private: boolean;
    };
    const release = await $`gh api repos/${repo}/releases/latest --jq .tag_name`.nothrow().quiet();

    const license = info.license?.spdx_id;
    facts[stem(file)] = {
        license: license && license !== "NOASSERTION" ? license : null,
        stars: info.stargazers_count,
        forks: info.forks_count,
        release: release.exitCode === 0 ? release.text().trim() || null : null,
        updated: info.pushed_at.slice(0, 10),
        public: !info.private,
    };
    console.log(file, facts[stem(file)]);
}

await writeJson(at("src/data/project-facts.json"), facts);
