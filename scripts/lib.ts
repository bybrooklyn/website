// What the scripts in this folder share: where the repo is, and how to read
// the content files.

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const root = resolve(new URL("..", import.meta.url).pathname);

/** A path inside the repo. */
export const at = (...parts: string[]) => join(root, ...parts);

/**
 * One `key: value` line from a file's frontmatter (the lines between the first two `---`), without
 * its quotes or a `# comment` after it. A line of the same shape in the text below is not read.
 */
export function frontmatter(source: string, key: string): string | undefined {
    const block = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(source)?.[1];
    const value = block === undefined ? undefined : new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(block)?.[1]?.trim();
    if (!value) return undefined;
    const quoted = /^(["'])(.*)\1(\s+#.*)?$/.exec(value);
    return quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
}

export async function isDraft(path: string): Promise<boolean> {
    return frontmatter(await Bun.file(at(path)).text(), "draft") === "true";
}

/**
 * Writes a data file with one record to a line: each top-level entry on its own line, and each item
 * of a top-level list on its own. A change to one photo is then one changed line.
 */
export function writeJson(path: string | URL, value: object): Promise<number> {
    const entry = (item: unknown) => (Array.isArray(item) ? `[\n${item.map((one) => `        ${JSON.stringify(one)}`).join(",\n")}\n    ]` : JSON.stringify(item));
    return Bun.write(path, `{\n${Object.entries(value).map(([key, item]) => `    ${JSON.stringify(key)}: ${entry(item)}`).join(",\n")}\n}\n`);
}

/** The Markdown files in a folder, by name. */
export async function listMdx(folder: string): Promise<string[]> {
    const names = await readdir(at(folder)).catch(() => []);
    return names.filter((name) => /\.mdx?$/.test(name)).sort();
}

/** A file name without its extension. */
export const stem = (name: string) => name.replace(/\.\w+$/, "");

/** Text as it can appear in an address or a file name. */
export function slug(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}
