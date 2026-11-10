// Sums GitHub's per-language byte counts across my own (non-fork) repos and
// writes src/data/languages.json. Run by hand with `bun run langs`; the site
// build only reads the committed JSON and never touches the network.
//
// Needs the GitHub CLI (`gh`) to be logged in. Pass --public-only to leave
// private repos out of the totals. Only totals are written, never repo names.

import { $ } from "bun";

const OWNER = "bybrooklyn";

/** Repos whose bytes would mislead (vendored code, generated output, not really mine). */
const IGNORE_REPOS: readonly string[] = ["resume", ".github", "swiftly"];

/** Things linguist counts that are not languages I "use" in any meaningful sense. */
const IGNORE_LANGUAGES: readonly string[] = [
    "HTML",
    "CSS",
    "SCSS",
    "Makefile",
    "Dockerfile",
    "Just",
    "Nix",
    "TeX",
    "Batchfile",
    "Roff",
    "Inno Setup",
    "Procfile",
];

interface Repo {
    name: string;
    isFork: boolean;
    visibility: string;
}

const publicOnly = process.argv.includes("--public-only");

const repos = (await $`gh repo list ${OWNER} --limit 500 --json name,isFork,visibility`.json()) as Repo[];

const wanted = repos.filter(
    (repo) =>
        !repo.isFork &&
        !IGNORE_REPOS.includes(repo.name) &&
        (!publicOnly || repo.visibility === "PUBLIC"),
);

const totals = new Map<string, number>();

for (const repo of wanted) {
    const bytes = (await $`gh api repos/${OWNER}/${repo.name}/languages`.json()) as Record<string, number>;
    for (const [language, count] of Object.entries(bytes)) {
        if (IGNORE_LANGUAGES.includes(language)) continue;
        totals.set(language, (totals.get(language) ?? 0) + count);
    }
}

const languages = [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);

const output = {
    updated: new Date().toISOString().slice(0, 10),
    repos: wanted.length,
    languages,
};

await Bun.write(new URL("../src/data/languages.json", import.meta.url), `${JSON.stringify(output, null, 4)}\n`);

const total = languages.reduce((sum, language) => sum + language.bytes, 0);
console.log(`${wanted.length} repos, ${languages.length} languages`);
for (const language of languages.slice(0, 12)) {
    console.log(`${((language.bytes / total) * 100).toFixed(1).padStart(5)}%  ${language.name}`);
}
