// The menu row: the words of a kind of document's menus, above its bar in the top's first line
// (mdQuire's are File, Edit, View, Insert, Format, Tools and Help, md/menus.ts). The kind gives the
// headings and the lines under each; the row is the core's, the same for every kind.
//
// Its menus are the core's own (flowMenu in ui.ts): one box that flows open from the word pressed
// and, while open, slides along to the next word as the pointer moves over the row. A menu holds the
// keyboard while it is open, however it was opened: the arrows move, a letter goes to the line that
// starts with it, Left and Right go from menu to menu, and Escape steps back. Alt and the word's
// letter (Docs' keys; Ctrl+Option on a Mac) or F10 open a menu from the writing. On a narrow window
// the row folds into the three-dot menu, each word a line there that opens its menu.

import { flowMenu, make, moveIndex, type Menu, type MenuItem } from "./ui";

/** A word of the row, and the lines of its menu. */
export interface Heading {
    label: string;
    items: () => MenuItem[];
}

/** Docs' words for its menus, which a kind's menus take where they have the same thing. */
export const DOCS_WORDS = ["File", "Edit", "View", "Insert", "Format", "Tools", "Help"];

/** The letter of a word that opens its menu with Alt, as in Docs: Format's is O, the others their first. */
export const letterOf = (word: string): string => (word === "Format" ? "O" : word.charAt(0).toUpperCase());

/** The menu a key opens from the writing: Alt and a word's letter (Ctrl+Option on a Mac, where Option alone types), or F10 for the first. */
export function menuFor(event: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">, onMac = false, words: string[] = DOCS_WORDS): number | undefined {
    if (event.key === "F10" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) return 0;
    if (!event.altKey || event.shiftKey || event.metaKey || event.ctrlKey !== onMac) return undefined;
    const at = words.map(letterOf).indexOf(event.code.replace(/^Key/, ""));
    return /^Key[A-Z]$/.test(event.code) && at >= 0 ? at : undefined;
}

/** Builds the row over the menus the kind gives each time one is opened. */
export function createMenuRow(menus: () => Heading[]) {
    const row = make("div", "quire-menu-row");
    row.setAttribute("role", "menubar");
    row.setAttribute("aria-label", "Menus");
    let current = -1;
    const menu = flowMenu("Menu", {
        className: "quire-row-menu",
        onSide: (by) => open((current + by + words.length) % words.length, true),
        onClose: () => {
            current = -1;
            menu.box.classList.remove("sliding");
        },
    });
    // the words are the kind's headings as they are when the row is made
    const labels = menus().map((heading) => heading.label);
    const words = labels.map((label, index) => {
        const word = make("button", "quire-row-word", label);
        word.type = "button";
        word.setAttribute("role", "menuitem");
        word.setAttribute("aria-haspopup", "menu");
        word.tabIndex = index === 0 ? 0 : -1;
        // pressing a word must leave the selection in the text it will act on
        word.addEventListener("mousedown", (event) => event.preventDefault());
        word.addEventListener("click", () => (current === index && menu.isOpen() ? menu.close(true) : open(index, document.activeElement === word)));
        // while a menu is open, the pointer moving along the row takes it to the word it is over
        word.addEventListener("pointerenter", () => {
            if (menu.isOpen() && current !== index && current >= 0) open(index, false);
        });
        row.append(word);
        return word;
    });
    row.addEventListener("keydown", (event) => {
        const at = words.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0) return;
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open(at, true);
            return;
        }
        const next = moveIndex(at, event.key, words.length);
        if (next === undefined) return;
        event.preventDefault();
        for (const word of words) word.tabIndex = word === words[next] ? 0 : -1;
        words[next]!.focus();
    });

    /** Opens a word's menu, holding the keyboard, on its first line when opened from the keys; from an open one, the box slides over to it. */
    function open(index: number, focus: boolean) {
        const heading = menus()[index];
        if (!heading) return;
        menu.box.classList.toggle("sliding", menu.isOpen());
        current = index;
        for (const word of words) word.tabIndex = word === words[index] ? 0 : -1;
        // the word takes the keyboard only from the row or its menus; opened by a key from the writing, closing goes back there
        if (focus && (row.contains(document.activeElement) || menu.box.contains(document.activeElement))) words[index]!.focus({ preventScroll: true });
        menu.open(words[index]!, heading.items(), focus);
        // opened by a press, the menu holds the keyboard before any line does, so that typing never reaches the document
        if (!focus) menu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }

    return {
        element: row,
        menu,
        /** The menus as they stand now, for the palette and the text's menu. */
        headings: menus,
        words,
        /** The words, for the keys that open their menus (menuFor). */
        labels,
        open,
        /** Opens the menus down to a line, its menu beside it open with the keyboard in it: ["Insert", "Bookmark"]. */
        reveal(path: string[]) {
            open(labels.indexOf(path[0] ?? ""), true);
            path.slice(1).reduce<Menu | undefined>((at, label) => at?.sub(label), menu);
        },
        /** Opens a word's menu from somewhere else, as the three-dot menu does when the row has folded into it. */
        openFrom(trigger: HTMLElement, index: number) {
            const heading = menus()[index];
            if (!heading) return;
            current = -1;
            menu.box.classList.remove("sliding");
            menu.open(trigger, heading.items(), true);
        },
    };
}
