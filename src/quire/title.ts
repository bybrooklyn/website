// The title: the large line at the top of the sheet, which is the document's name. Typing in it
// renames the document (as it is typed where renaming is cheap, as in this browser; when the line
// is left where it is not, as for a file or a repository) and the name in the bar follows it.
// Empty, it shows a faint "Untitled". Enter goes on to the writing. It is not part of the Markdown:
// a file's title is its name without the extension, and a post's (under `bun run edit`) is its
// frontmatter's title, given through `own`.

import type { Document } from "./document";

const extension = /\.(md|mdx|markdown|txt|quire)$/i;

/** The name as the title shows it: a file's name without its extension. */
export function shownName(name: string): string {
    return name.replace(extension, "");
}

/** The name to give a document called `old` when its title is typed as `typed`: its extension kept, "Untitled" for nothing. */
export function nameFor(old: string, typed: string): string {
    const words = typed.replace(/\s+/g, " ").trim() || "Untitled";
    return words + (old.match(extension)?.[0] ?? "");
}

/** What the title line tells the editor. */
export interface TitleOptions {
    /** The writing's own element, which Enter goes on to. */
    goOn: () => void;
    /** Told of each change as it is typed. */
    typed: (value: string) => void;
    /** Told when the line is left (or Enter pressed) with a changed value. */
    settled: (value: string) => void;
}

/** A title kept in the document itself, such as a post's frontmatter title, rather than in its name. */
export interface OwnTitle {
    read(doc: Document): string | null;
    write(doc: Document, value: string): Document;
}

/** Builds the title line. */
export function createTitle(options: TitleOptions): { element: HTMLTextAreaElement; show(value: string, editable?: boolean): void; focus(): void } {
    const field = document.createElement("textarea");
    field.className = "quire-title";
    field.rows = 1;
    field.placeholder = "Untitled";
    field.spellcheck = true;
    field.setAttribute("aria-label", "Title");
    let settledAt = "";
    // as tall as its lines, where the browser does not size a field to its content itself
    const fit = () => {
        if (CSS.supports("field-sizing", "content")) return;
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight}px`;
    };
    const settle = () => {
        const value = field.value.replace(/\s+/g, " ").trim();
        if (value === settledAt) return;
        settledAt = value;
        options.settled(value);
    };
    field.addEventListener("input", () => {
        // a title is one line: a line break pasted in becomes a space
        if (/\n/.test(field.value)) {
            const at = field.selectionStart;
            field.value = field.value.replace(/\r?\n/g, " ");
            field.setSelectionRange(at, at);
        }
        fit();
        options.typed(field.value);
    });
    field.addEventListener("keydown", (event) => {
        const atEnd = field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
        if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
            event.preventDefault();
            settle();
            options.goOn();
        }
    });
    field.addEventListener("blur", settle);
    return {
        element: field,
        show(value, editable = true) {
            settledAt = value;
            field.readOnly = !editable;
            if (document.activeElement !== field) field.value = value;
            fit();
        },
        focus() {
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
        },
    };
}
