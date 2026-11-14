// The site's own linter: the habits of this codebase, checked. `bun run lint` runs it, and so does
// `bun run check`. It is here so that code written by anyone, an agent included, comes out the way
// the rest is written. STYLE.md says the same things in words.
//
//   dependencies   package.json may not gain a library; Mote and mdQuire import nothing from outside their folders
//                  (onnxruntime-web, from src/quire/md/dictation/ only, is the one allowed exception)
//   comments       a source file opens by saying what it is; in Mote and mdQuire every exported thing has a sentence
//   leftovers      no console.log in src/
//   words          comments and page text in plain words: no dash as punctuation, no emoji, none of the tells
//   tests          a file of engine or logic code has a test beside it
//   tokens         stylesheets take colors from the site's tokens, not hex values
//   private        no IP address, Tailscale host name or port (written as host:NNNN) in any file git tracks,
//                  but for the few kinds in SAFE below

import { Glob } from "bun";
import { pageTells, TELL_NAMES, tellsIn } from "../src/quire/md/check/tells";
import { at } from "./lib";

/** The libraries the site has. A new one fails the lint: add it here on purpose or do without it. */
const LIBRARIES = ["@astrojs/check", "@astrojs/markdown-satteri", "@astrojs/mdx", "@astrojs/rss", "@astrojs/sitemap", "@types/bun", "astro", "onnxruntime-web", "sharp", "simple-icons", "typescript", "wrangler"];
/**
 * The one exception to the editor importing nothing from outside itself, by the owner's choice:
 * the speech models run on ONNX Runtime, which is not rewritten. Only this package may be imported,
 * and only from src/quire/md/dictation/, where it is loaded when dictation is first switched on so
 * that a visitor who never dictates downloads none of it. (The pages fetch its files from /ort/.)
 */
const SPEECH = ["onnxruntime-web"];
const SPEECH_HOME = "src/quire/md/dictation/";
/** Files that only wire a browser feature (a worker, an audio worklet) to code that is tested; they cannot be loaded outside a browser, so their test is the browser test. */
const SHELLS = ["src/quire/md/dictation/engine-worker.ts", "src/quire/md/dictation/capture-worklet.ts", "src/quire/md/dictation/capture.ts", "src/quire/md/dictation/engine.ts", "src/quire/md/dictation/page.ts"];
/** Folders whose code stands alone: nothing in them imports from outside them. */
const ALONE = ["src/mote/", "src/quire/"];
/** Logic files that had no test when this rule was made. Do not add to it: write the test. */
const UNTESTED = ["src/mote/stage.ts", "src/mote/solids.ts", "src/mote/sound.ts", "src/mote/index.ts"];
/** Where every exported thing must have a sentence above it. Mote was written before this rule and is held to it only for what is added. */
const SPOKEN = ["src/quire/"];
/** Stylesheets with colors that are not the theme's: the pride flags, print on white paper, the timeline's marks. */
const OWN_COLORS = ["src/styles/base.css", "src/styles/resume.css", "src/styles/timeline.css"];
// The words rules (dashes used as punctuation, emoji, the keep-out words, a "not just X" framing) and
// her own pages that they leave alone are written once, in src/quire/md/check/tells.ts, which mdQuire's
// checking reads too, so the editor and this linter give the same verdict.

/** What looks like an address of her machines in a tracked file: an IPv4 address, a Tailscale name, a port after a host. */
const PRIVATE: [RegExp, string][] = [
    [/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, "an IP address"],
    [/\bts\.net\b/gi, "a Tailscale host name"],
    [/(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*):\d{4,5}\b/gi, "a port"],
];
/** What looks like one of those and is not: the files it may be in, what it is, and why it is allowed. */
const SAFE: { files: RegExp; what: RegExp; why: string }[] = [
    { files: /./, what: /^(127\.0\.0\.1|0\.0\.0\.0)$/, why: "this computer's own address and the any-address, which name no machine" },
    { files: /^(scripts|integrations)\/|\.test\.ts$|^(README|STYLE)\.md$/, what: /^(localhost|127\.0\.0\.1):\d+$/, why: "a port on this computer, for the dev server, the editor and the tests" },
    { files: /^(src\/content\/projects\/terrustia\.mdx|public\/casts\/terrustia\.cast)$/, what: /^1\.4\.\d+\.\d+$/, why: "Terraria's version number, which has the shape of an address" },
    { files: /^public\/casts\/terrustia\.cast$/, what: /^0\.0\.0\.0:7777$/, why: "the Terraria server's standard port, in the recorded demo of the project" },
];
/** Files that are not text, which the search for addresses does not read. */
const BINARY = /\.(png|jpe?g|avif|webp|gif|ico|woff2?|ttf|otf|wasm|mp4|webm|dat|pdf|onnx|bin|zip|gz)$/i;

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
        // `from "x"`, `import "x"` (for its effect alone), `import("x")` and `require("x")`, in either kind of quotes
        const path = /\b(?:from|import|require)(?:\s+|\s*\(\s*)["']([^"']+)["']/.exec(line)?.[1];
        const speech = path !== undefined && SPEECH.some((name) => path === name || path.startsWith(`${name}/`)) && file.startsWith(SPEECH_HOME);
        if (alone && path && !test && !speech) {
            const depth = file.slice(alone.length).split("/").length - 1;
            const leaves = (path.match(/\.\.\//g) ?? []).length > depth;
            if (!path.startsWith(".") || leaves) say(file, number, `imports ${path}, from outside ${alone}`);
        }
        // ---- comments: every exported thing in such a folder has a sentence above it ----
        if (SPOKEN.some((folder) => file.startsWith(folder)) && !test && /^export (default\b|(async |declare |abstract )*(function|const|let|var|class|interface|type|enum) )/.test(line) && !/^\s*(\*\/|\/\/|\*)/.test(lines[index - 1] ?? "") && !/\*\/\s*$/.test(lines[index - 1] ?? "")) say(file, number, "exported with no sentence above it");
        // ---- leftovers ----
        if (file.startsWith("src/") && !test && /\bconsole\.log\(/.test(line)) say(file, number, "console.log left in");
        // ---- words, in comments ----
        // a line comment, a comment of one line between /* or /** and */ (or the first line of a longer one), or a line inside one
        const comment = /(^|\s)\/\/\s(.*)$/.exec(line)?.[2] ?? /(^|\s)\/\*\*?\s(.*?)\s*(\*\/|$)/.exec(line)?.[2] ?? /^\s*\*\s(.*)$/.exec(line)?.[1];
        if (comment) for (const tell of tellsIn(comment, false)) say(file, number, `${TELL_NAMES[tell]} in a comment`);
    });

    // ---- tests ----
    const logic = (alone || /^src\/minis\/(tower|rolls|board|flight|fields)\.ts$/.test(file)) && !test && !UNTESTED.includes(file) && !SHELLS.includes(file);
    if (logic && !(await Bun.file(at(file.replace(/\.ts$/, ".test.ts"))).exists())) say(file, 1, "has no test beside it");
}

// ---- words, in the text of pages ----
// (drafts on hold are not published, so they are not held to them; her own pages are left alone by pageTells)
for (const file of await files("src/content/**/*.mdx")) {
    if (file.includes(".hold.")) continue;
    for (const { line, tell } of pageTells(file, await read(file))) say(file, line, TELL_NAMES[tell]);
}

// ---- private: what never goes on the site, in every file git tracks ----
const tracked = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: at() });
for (const file of tracked.success ? tracked.stdout.toString().split("\0").filter((name) => name && !BINARY.test(name)) : []) {
    const bytes = new Uint8Array(await Bun.file(at(file)).arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (bytes.subarray(0, 8000).includes(0)) continue;
    // color codes in a terminal recording are taken out first, so that they do not run into what follows them
    new TextDecoder().decode(bytes).split("\n").map((line) => line.replace(/\\u001b\[[\d;]*[a-z]/gi, " ")).forEach((line, index) => {
        for (const [pattern, what] of PRIVATE) {
            for (const [seen] of line.matchAll(pattern)) {
                if (!SAFE.some((safe) => safe.files.test(file) && safe.what.test(seen))) say(file, index + 1, `${what}, which is never written down in the repository (shown here with its digits hidden: ${seen.replace(/\d/g, "N")})`);
            }
        }
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
