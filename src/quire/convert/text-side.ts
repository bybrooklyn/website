// The text and data side of the converter's panel: Markdown becomes HTML and HTML becomes Markdown
// (through mdQuire's own reader and writer, handed in by the page script), and CSV, JSON, YAML and TOML
// become the one chosen. A file's kind of text is found by its ending, else by what it holds. A shape
// one format cannot carry is refused in plain words with what can be done, as a button on the row that
// converts that file again with the offer taken. Text pasted becomes a file of its own, and a result
// can be copied as well as saved.

import { make } from "../core/ui";
import type { Found } from "./kinds";
import { DataError, type Offer } from "./errors";
import type { DataOptions } from "./data";
import type { Separator } from "./csv";
import { HTML_DROPPED, HTML_UNDERSTOOD, type MarkdownEngine } from "./markdown";
import { stemOf } from "./names";
import { choices, fold, line, note, Offered, section, type Becoming, type Item, type Made, type Side } from "./parts";
import { convertText, TEXT_FORMATS, textKindOf, type TextFormat } from "./text";

/** The most text read at once: a text file this large is nearly always something else. */
export const TEXT_MOST = 64 * 1024 * 1024;

/** What text with no kind found is told. */
export const UNKNOWN_TEXT = "Which kind of text this is cannot be told. Give it an ending such as .md, .html, .csv, .json, .yaml or .toml.";

/** The choices an offer makes for its file. */
export function optionsFor(offer: Offer): Record<string, unknown> {
    if (offer.key === "flatten") return { flatten: true };
    if (offer.key === "wrap") return { wrap: offer.name ?? "items" };
    if (offer.key === "drop-nulls") return { dropNulls: true };
    if (offer.key === "first-table") return { firstTable: true };
    return { header: false };
}

/** What a kind of text becomes with the data format chosen: Markdown and HTML into each other, data into the one chosen. */
export function targetOf(from: TextFormat, data: TextFormat): TextFormat | undefined {
    if (from === "md") return "html";
    if (from === "html") return "md";
    return from === data ? undefined : data;
}

/** The text and data side of the panel. */
export function textSide(markdown?: MarkdownEngine): Side {
    let data: TextFormat = "json";
    const options: DataOptions = { header: true, types: false };
    const side: Side = {
        kind: "text",
        element: make("div"),
        lane: "text",
        async identify(item: Item): Promise<Found | undefined> {
            if (item.file.size > TEXT_MOST) return undefined;
            const format = textKindOf(item.name, await item.file.text());
            return format ? { kind: "text", format, label: TEXT_FORMATS[format].label } : { kind: "text", format: "text", label: "Text" };
        },
        becomes(item: Item): Becoming {
            const from = item.found.format as TextFormat;
            if (item.file.size > TEXT_MOST) return { cannot: "This text is too large to convert here." };
            if (!(from in TEXT_FORMATS)) return { cannot: UNKNOWN_TEXT };
            if ((from === "md" || from === "html") && !markdown) return { cannot: "Markdown and HTML cannot be converted on this page." };
            const to = targetOf(from, data);
            if (!to) return { cannot: `This is ${TEXT_FORMATS[from].label} already. Choose another format for data.` };
            const separated = to === "csv" && options.separator === "\t";
            return { label: separated ? "CSV with tabs" : TEXT_FORMATS[to].label, ending: separated ? ".tsv" : TEXT_FORMATS[to].ending };
        },
        async run(item: Item, signal, told): Promise<Made> {
            const from = item.found.format as TextFormat;
            const to = targetOf(from, data)!;
            told(0, "Reading");
            const text = await item.file.text();
            if (signal.aborted) throw new DOMException("stopped", "AbortError");
            try {
                const made = convertText(text, from, to, { ...options, ...(item.options as DataOptions), title: stemOf(item.name) }, markdown);
                told(1);
                const lines = made.text.split("\n").length;
                return { blob: new Blob([made.text], { type: `${made.type};charset=utf-8` }), text: made.text, notes: made.notes, became: `${TEXT_FORMATS[to].label}, ${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"}` };
            } catch (error) {
                if (error instanceof DataError && error.offer) throw new Offered(error.message, { label: error.offer.words, options: optionsFor(error.offer) });
                throw error;
            }
        },
    };
    const changed = () => side.changed?.();
    const into = choices<TextFormat>("Data into", (["csv", "json", "yaml", "toml"] as TextFormat[]).map((value) => ({ value, label: TEXT_FORMATS[value].label })), data, (value) => ((data = value), changed()));
    const separators = choices<"find" | Separator>(
        "CSV separator",
        [
            { value: "find", label: "Find it", tip: "Found from the file when reading; a comma when writing" },
            { value: ",", label: "Comma" },
            { value: ";", label: "Semicolon" },
            { value: "\t", label: "Tab" },
            { value: "|", label: "Bar" },
        ],
        "find",
        (value) => {
            if (value === "find") delete options.separator;
            else options.separator = value;
            changed();
        },
    );
    const header = choices<"yes" | "no">("First CSV row", [{ value: "yes", label: "Names" }, { value: "no", label: "Data" }], "yes", (value) => ((options.header = value === "yes"), changed()));
    const types = choices<"text" | "read">(
        "CSV numbers",
        [
            { value: "text", label: "Kept as text", tip: "CSV does not say which values are numbers, so none are guessed" },
            { value: "read", label: "Read as numbers", tip: "Plain numbers, true and false, and empty fields are read as such" },
        ],
        "text",
        (value) => ((options.types = value === "read"), changed()),
    );
    // what HTML is read folds open under its button, growing, and shut again
    const htmlFold = fold(note(HTML_UNDERSTOOD), note(HTML_DROPPED));
    const htmlButton = make("button", "quire-convert-small quire-convert-more", "What HTML is understood");
    htmlButton.type = "button";
    htmlButton.setAttribute("aria-expanded", "false");
    htmlButton.addEventListener("click", () => {
        const open = htmlButton.getAttribute("aria-expanded") !== "true";
        htmlButton.setAttribute("aria-expanded", String(open));
        htmlFold.open(open);
    });
    const html = make("div", "quire-convert-html");
    html.append(htmlButton, htmlFold.element);
    side.element = section(
        "Text and data",
        line("Data into", into.element),
        line("Separator", separators.element),
        line("First row", header.element),
        line("Numbers", types.element),
        note(markdown ? "Markdown becomes HTML, and HTML becomes Markdown." : "Markdown and HTML cannot be converted on this page."),
        html,
    );
    side.element.dataset.kind = "text";
    return side;
}
