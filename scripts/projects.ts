// Reads a few facts about each project's repository from GitHub and writes
// src/data/project-facts.json. Run by hand with `bun run projects`; the site
// build only reads the committed JSON. Needs a logged-in `gh`. On the page of a
// public project the numbers are then brought up to date in the visitor's
// browser (see the script in src/pages/projects/[slug].astro).

import { $ } from "bun";
import type { ProjectFacts } from "../src/lib/projects";
import { at, frontmatter, listMdx, stem, writeJson } from "./lib";

const folder = "src/content/projects";
/** What gh says when GitHub answers 404. */
const notFound = (said: string) => /\bNot Found\b|HTTP 404/.test(said);
function stop(asked: string, said: string): never {
    console.error(`GitHub did not answer for ${asked}, so src/data/project-facts.json was left as it was.\n${said.trim()}`);
    process.exit(1);
}
const facts: Record<string, ProjectFacts> = {};

for (const file of await listMdx(folder)) {
    const repo = frontmatter(await Bun.file(at(folder, file)).text(), "repo");
    if (!repo) continue;

    // A project can be written up before its repository exists: GitHub says it is not found. Any
    // other failure (logged out, offline, rate limited) stops the run before the file is written,
    // so that the facts already kept are not replaced by none.
    const found = await $`gh api repos/${repo}`.nothrow().quiet();
    if (found.exitCode !== 0) {
        if (!notFound(found.stderr.toString())) stop(repo, found.stderr.toString());
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
    // A repository with no release is not found here either.
    const release = await $`gh api repos/${repo}/releases/latest --jq .tag_name`.nothrow().quiet();
    if (release.exitCode !== 0 && !notFound(release.stderr.toString())) stop(`${repo}/releases/latest`, release.stderr.toString());

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
