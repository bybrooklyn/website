// The text side of the converter in one place for the page: what kind of text a file is (by its
// ending, then by a careful look at what it holds), what it can become (Markdown and HTML into each
// other, CSV, JSON, YAML and TOML into each other), and the conversion itself, with the type and the
// ending the result is saved with.
//
//   `textKindOf("people.csv", text)` gives `"csv"`
//   `convertText(text, "csv", "json", {})` gives `{ text, notes, type, ending }`

import { findSeparator, readCsv } from "./csv";
import { convertData, DataError, type DataFormat, type DataOptions } from "./data";
import { htmlToMarkdown, markdownToHtml, type MarkdownEngine } from "./markdown";
import { readToml } from "./toml";
import { readYaml } from "./yaml";

/** The kinds of text the converter knows. */
export type TextFormat = "md" | "html" | DataFormat;

/** Each kind's name for a person, the type it is saved with, and its ending. */
export const TEXT_FORMATS: Record<TextFormat, { label: string; type: string; ending: string }> = {
    md: { label: "Markdown", type: "text/markdown", ending: ".md" },
    html: { label: "HTML", type: "text/html", ending: ".html" },
    csv: { label: "CSV", type: "text/csv", ending: ".csv" },
    json: { label: "JSON", type: "application/json", ending: ".json" },
    yaml: { label: "YAML", type: "application/yaml", ending: ".yaml" },
    toml: { label: "TOML", type: "application/toml", ending: ".toml" },
};

const ENDINGS: [RegExp, TextFormat][] = [
    [/\.(md|markdown|mdown|mkd|mkdn)$/i, "md"],
    [/\.(html?|xhtml)$/i, "html"],
    [/\.(csv|tsv|psv)$/i, "csv"],
    [/\.json$/i, "json"],
    [/\.ya?ml$/i, "yaml"],
    [/\.toml$/i, "toml"],
];

const works = (read: () => unknown) => {
    try {
        read();
        return true;
    } catch {
        return false;
    }
};

/** What kind of text a file is: by its ending, else by what it holds, else undefined. */
export function textKindOf(name: string, text: string): TextFormat | undefined {
    for (const [ending, kind] of ENDINGS) if (ending.test(name)) return kind;
    const body = text.replace(/^\ufeff/, "").trim();
    if (!body) return undefined;
    if (/^<!doctype html|^<html[\s>]/i.test(body) || (/^<([a-z][a-z0-9]*)[\s>]/i.test(body) && /<\/[a-z][a-z0-9]*>\s*$/i.test(body))) return "html";
    if (/^[[{]/.test(body) && works(() => JSON.parse(body))) return "json";
    const lines = body.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
    const tomlLines = lines.filter((line) => /^\s*(\[[^\]]+\]|[\w"'.-]+\s*=\s*\S)/.test(line)).length;
    if (tomlLines && tomlLines === lines.length && works(() => readToml(body))) return "toml";
    // Markdown's headings, lists and links are looked for before YAML, whose comments look like headings
    const markdown = /^#{1,6} \S/m.test(body) || /\[[^\]]+\]\([^)]+\)/.test(body) || /^```/m.test(body) || /\*\*\S/.test(body);
    if (!markdown && /^(---\s*\n)?[\w"'-][^\n:]*:(\s|$)/.test(body) && works(() => readYaml(body))) {
        const value = readYaml(body);
        if (typeof value === "object" && value !== null) return "yaml";
    }
    const separator = findSeparator(body);
    const rows = works(() => readCsv(body, separator)) ? readCsv(body, separator) : [];
    if (rows.length >= 2 && rows[0]!.length > 1 && rows.every((row) => row.length === rows[0]!.length)) return "csv";
    if (markdown) return "md";
    return undefined;
}

/** What a kind of text can become. */
export function targetsFor(from: TextFormat): TextFormat[] {
    if (from === "md") return ["html"];
    if (from === "html") return ["md"];
    return (["csv", "json", "yaml", "toml"] as TextFormat[]).filter((each) => each !== from);
}

/** Converts a text from one kind to another, with notes on what changed, and the type and ending it is saved with. Throws a DataError. */
export function convertText(text: string, from: TextFormat, to: TextFormat, options: DataOptions & { title?: string } = {}, markdown?: MarkdownEngine): { text: string; notes: string[]; type: string; ending: string } {
    if (!targetsFor(from).includes(to)) throw new DataError(`${TEXT_FORMATS[from].label} cannot be made into ${TEXT_FORMATS[to].label} here.`);
    const { type, ending } = TEXT_FORMATS[to];
    if (from === "md" || from === "html") {
        if (!markdown) throw new DataError("Markdown and HTML cannot be converted on this page.");
        const made = from === "md" ? markdownToHtml(text, markdown, options.title ?? "Untitled") : htmlToMarkdown(text, markdown);
        return { text: made, notes: [], type, ending };
    }
    const made = convertData(text, from, to as DataFormat, options);
    // tab-separated values keep their own ending
    if (to === "csv" && options.separator === "\t") return { ...made, type: "text/tab-separated-values", ending: ".tsv" };
    return { ...made, type, ending };
}
