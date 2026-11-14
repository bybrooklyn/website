// Where the Quires' code may reach, as the linter holds it (scripts/lint.ts). The core, in
// src/quire/core/, is the app every Quire is built on, and imports nothing from a kind of document:
// not from mdQuire's folder (src/quire/md/) nor from any other kind beside it. A kind may use the
// core, and no kind uses another. Tests are left out: a test of the core may bring a kind in to drive it.
//
//   crossing("src/quire/core/app.ts", "../md/editor")   "the core imports from md/, a kind of document"

import { dirname, join, normalize } from "node:path";

/** The folder of the core, and the folder the kinds sit in beside it. */
export const QUIRE = "src/quire/";
export const CORE = "src/quire/core/";

/** The folder of src/quire/ a file is in: "core", a kind's ("md", "note"), or undefined outside. */
export function quireFolder(file: string): string | undefined {
    if (!file.startsWith(QUIRE)) return undefined;
    const rest = file.slice(QUIRE.length);
    return rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : "";
}

/** What is wrong with a file of src/quire/ importing a relative path, if anything: the core reaching into a kind, or one kind into another. */
export function crossing(file: string, path: string): string | undefined {
    if (!path.startsWith(".") || file.endsWith(".test.ts")) return undefined;
    const from = quireFolder(file);
    if (from === undefined) return undefined;
    const to = quireFolder(normalize(join(dirname(file), path)));
    if (to === undefined || to === from || to === "") return undefined;
    // a file at the top of src/quire/ is the core's too: nothing is meant to be there but core/ and the kinds
    if (from === "core" || from === "") return `the core imports from ${to}/, a kind of document`;
    if (to !== "core") return `${from}/ imports from ${to}/, another kind of document`;
    return undefined;
}
