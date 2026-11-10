// Works out how much I use each language across my own (non-fork) repos and
// writes src/data/languages.json.
//
// Bytes alone let one enormous project decide the answer, so a language's
// share is half "how much of the code is in it" and half "how many of the
// projects are mainly written in it". Run by hand with `bun run langs`; the site
// build only reads the committed JSON and never touches the network.
//
// Needs the GitHub CLI (`gh`) to be logged in. Pass --public-only to leave
// private repos out of the totals. Only totals are written, never repo names.

import { $ } from "bun";

const OWNER = "bybrooklyn";

/** Repos whose bytes would mislead (vendored code, generated output, not really mine). */
const IGNORE_REPOS: readonly string[] = ["resume", ".github", "swiftly"];

/** Things linguist counts that are not languages I use. */
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
/** How many repos have each language as their main one. */
const mains = new Map<string, number>();

for (const repo of wanted) {
    const bytes = (await $`gh api repos/${OWNER}/${repo.name}/languages`.json()) as Record<string, number>;
    const counted = Object.entries(bytes).filter(([language]) => !IGNORE_LANGUAGES.includes(language));
    for (const [language, count] of counted) {
        totals.set(language, (totals.get(language) ?? 0) + count);
    }
    const main = counted.sort((a, b) => b[1] - a[1])[0]?.[0];
    if (main) mains.set(main, (mains.get(main) ?? 0) + 1);
}

const allBytes = [...totals.values()].reduce((sum, count) => sum + count, 0);
const allMains = [...mains.values()].reduce((sum, count) => sum + count, 0);

const languages = [...totals.entries()]
    .map(([name, bytes]) => ({
        name,
        bytes,
        repos: mains.get(name) ?? 0,
        share: Number((0.5 * (bytes / allBytes) + 0.5 * ((mains.get(name) ?? 0) / allMains)).toFixed(4)),
    }))
    .sort((a, b) => b.share - a.share);

const output = {
    updated: new Date().toISOString().slice(0, 10),
    repos: wanted.length,
    languages,
};

await Bun.write(new URL("../src/data/languages.json", import.meta.url), `${JSON.stringify(output, null, 4)}\n`);

console.log(`${wanted.length} repos, ${languages.length} languages`);
for (const language of languages.slice(0, 12)) {
    const byBytes = ((language.bytes / allBytes) * 100).toFixed(1);
    console.log(`${(language.share * 100).toFixed(1).padStart(5)}%  ${language.name}  (${byBytes}% of bytes, main language of ${language.repos})`);
}
