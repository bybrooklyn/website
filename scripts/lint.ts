// The site's own linter: the habits of this codebase, checked. `bun run lint` runs it, and so does
// `bun run check`. It is here so that code written by anyone, an agent included, comes out the way
// the rest is written. STYLE.md says the same things in words.
//
//   dependencies   package.json may not gain a library; Mote and mdQuire import nothing from outside their folders
//   comments       a source file opens by saying what it is; in Mote and mdQuire every exported thing has a sentence
//   leftovers      no console.log in src/
//   words          comments and page text in plain words: no dash as punctuation, no emoji, none of the tells
//   tests          a file of engine or logic code has a test beside it
//   tokens         stylesheets take colors from the site's tokens, not hex values

import { Glob } from "bun";
import { at } from "./lib";

/** The libraries the site has. A new one fails the lint: add it here on purpose or do without it. */
const LIBRARIES = ["@astrojs/check", "@astrojs/markdown-satteri", "@astrojs/mdx", "@astrojs/rss", "@astrojs/sitemap", "@types/bun", "astro", "sharp", "simple-icons", "typescript", "wrangler"];
/** Folders whose code stands alone: nothing in them imports from outside them. */
const ALONE = ["src/mote/", "src/quire/"];
/** Logic files that had no test when this rule was made. Do not add to it: write the test. */
const UNTESTED = ["src/mote/stage.ts", "src/mote/solids.ts", "src/mote/sound.ts", "src/mote/index.ts"];
/** Where every exported thing must have a sentence above it. Mote was written before this rule and is held to it only for what is added. */
const SPOKEN = ["src/quire/"];
/** Her own pages, in her own words, which the word rules do not second-guess. */
const HERS = ["src/content/pages/about.mdx"];
/** Stylesheets with colors that are not the theme's: the pride flags, print on white paper, the timeline's marks. */
const OWN_COLORS = ["src/styles/base.css", "src/styles/resume.css", "src/styles/timeline.css"];
/** Words and turns of phrase that read as written by a model (from her prose rules), and dashes used as punctuation. */
const TELLS: [RegExp, string][] = [
    [/[—–]/, "a dash used as punctuation"],
    [/\p{Extended_Pictographic}/u, "an emoji"],
    [/\b(journey|passion|crafted|delightful|seamless(ly)?|leverag(e|ing)|robust|elevate|effortless(ly)?|game.changer)\b/i, "a word from the keep-out list"],
];
/** A framing that reads as a model's in prose, though it is ordinary in a comment. */
const FRAMING: [RegExp, string] = [/\b(not just|not only|isn't just|more than just)\b/i, "a 'not just X' framing"];

const found: string[] = [];
const say = (file: string, line: number, what: string) => found.push(`${file}:${line}  ${what}`);
const files = async (pattern: string) => (await Array.fromAsync(new Glob(pattern).scan({ cwd: at() }))).filter((file) => !file.includes("node_modules/")).sort();
const read = (file: string) => Bun.file(at(file)).text();

// ---- dependencies ----
const pack = (await Bun.file(at("package.json")).json()) as { dependencies?: object; devDependencies?: object };
for (const name of Object.keys({ ...pack.dependencies, ...pack.devDependencies })) if (!LIBRARIES.includes(name)) say("package.json", 1, `a new library, ${name}`);

const sources = [...(await files("src/**/*.ts")), ...(await files("scripts/**/*.ts")), ...(await files("integrations/**/*.ts"))];
for (const file of sources) {
    const text = await read(file);
    const lines = text.split("\n");
    const test = file.endsWith(".test.ts");
    const alone = ALONE.find((folder) => file.startsWith(folder));

    // ---- comments: the file says what it is ----
    if (!/^\s*(\/\/|\/\*)/.test(lines.find((line) => line.trim() !== "") ?? "")) say(file, 1, "does not open with a comment saying what the file is");

    lines.forEach((line, index) => {
        const number = index + 1;
        // ---- dependencies: code that stands alone ----
        const from = /\bfrom\s+"([^"]+)"|import\("([^"]+)"\)/.exec(line);
        const path = from?.[1] ?? from?.[2];
        if (alone && path && !test) {
            const depth = file.slice(alone.length).split("/").length - 1;
            const leaves = (path.match(/\.\.\//g) ?? []).length > depth;
            if (!path.startsWith(".") || leaves) say(file, number, `imports ${path}, from outside ${alone}`);
        }
        // ---- comments: every exported thing in such a folder has a sentence above it ----
        if (SPOKEN.some((folder) => file.startsWith(folder)) && !test && /^export (async )?(function|const|class|interface|type) /.test(line) && !/^\s*(\*\/|\/\/|\*)/.test(lines[index - 1] ?? "") && !/\*\/\s*$/.test(lines[index - 1] ?? "")) say(file, number, "exported with no sentence above it");
        // ---- leftovers ----
        if (file.startsWith("src/") && !test && /\bconsole\.log\(/.test(line)) say(file, number, "console.log left in");
        // ---- words, in comments ----
        const comment = /(^|\s)(\/\/|\*)\s(.*)$/.exec(line)?.[3];
        if (comment) for (const [tell, what] of TELLS) if (tell.test(comment)) say(file, number, `${what} in a comment`);
    });

    // ---- tests ----
    const logic = (alone || /^src\/minis\/(tower|rolls|board)\.ts$/.test(file)) && !test && !UNTESTED.includes(file);
    if (logic && !(await Bun.file(at(file.replace(/\.ts$/, ".test.ts"))).exists())) say(file, 1, "has no test beside it");
}

// ---- words, in the text of pages ----
for (const file of await files("src/content/**/*.mdx")) {
    if (file.includes(".hold.") || HERS.includes(file)) continue;
    let fenced = false;
    (await read(file)).split("\n").forEach((line, index) => {
        if (/^(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced || /^\s*(import |<|\|?\s*-{3})/.test(line)) return;
        for (const [tell, what] of [...TELLS, FRAMING]) if (tell.test(line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]"))) say(file, index + 1, what);
    });
}

// ---- tokens ----
for (const file of (await files("src/styles/*.css")).filter((file) => !OWN_COLORS.includes(file))) {
    (await read(file)).split("\n").forEach((line, index) => {
        if (/#[0-9a-f]{3,8}\b/i.test(line.replace(/\/\*.*?\*\//g, "")) && !/^\s*(\/\*|\*)/.test(line)) say(file, index + 1, "a hex color where a token belongs");
    });
}

if (found.length > 0) {
    console.error(found.join("\n"));
    console.error(`\n${found.length} thing${found.length === 1 ? "" : "s"} to put right. What each rule is for is at the top of scripts/lint.ts and in STYLE.md.`);
    process.exit(1);
}
console.log(`lint: ${sources.length} source files, nothing to put right`);
