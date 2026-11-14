// Help, mdQuire help: a short page in the editor's dialog saying what mdQuire is, where documents
// are kept, what typing does and how to get a file out. Its words are here, in one place, and its
// test holds them short; `helpBody` draws them, with the keyboard shortcuts a press away.

import { make } from "../ui";

/** The help's paragraphs. `{shortcuts}` stands where the way to the keyboard shortcuts goes. */
export const HELP = [
    "mdQuire is a word processor for Markdown. You write as you would in any word processor, and the file underneath stays plain Markdown.",
    "Your documents are kept in this browser. Nothing leaves it unless you save to a folder on your computer or to a GitHub repository.",
    "Markdown typed as you go turns into what it means: ## and a space makes a heading, and two stars each side of a word make it bold. {shortcuts} lists all of it, and Tools, Typing preferences switches any of it off.",
    "To get a file out, use File, Download. Download as gives Markdown, a .quire file, a web page, plain text or Word, and Print can save a PDF.",
];

/** The help's paragraphs as elements, the keyboard shortcuts a button that opens them. */
export function helpBody(shortcuts: (from: HTMLElement) => void): HTMLElement[] {
    return HELP.map((text) => {
        const paragraph = make("p");
        const [before, after] = text.split("{shortcuts}");
        paragraph.append(before!);
        if (after !== undefined) {
            const button = make("button", "quire-help-link", "Keyboard shortcuts (Ctrl+/)");
            button.type = "button";
            button.addEventListener("click", () => shortcuts(button));
            paragraph.append(button, after);
        }
        return paragraph;
    });
}
