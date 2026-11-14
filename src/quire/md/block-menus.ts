// The menus that open from controls drawn in the writing: a code block's language, chosen from the
// languages mdQuire highlights with a field on top that narrows them as it is typed in, and a
// callout's kind, one of GitHub's five. Each is the one kind of menu mdQuire has (ui.ts), growing
// from the control pressed; choosing changes the block as one undo step and gives the caret back to
// it, and Escape closes the menu with the caret where it was.
//
// Which languages a typed word finds is matchLanguages, which is pure and tested; the rest is DOM.
//
//   const menus = createBlockMenus(surface);   // menus.destroy()

import { blockAt, changeKind, setBox, type Position } from "./document";
import { finishes, flowMenu, make, type MenuItem, menuLine } from "../core/ui";
import { LANGUAGES, languageOf } from "./highlight";
import type { Surface } from "./surface";

/** A language a code block can be set to: what the menu calls it, and what is written after the fence. */
export interface LanguageChoice {
    label: string;
    name: string;
}

/** The kinds of callout, as Markdown writes them, in GitHub's order. */
export const CALLOUTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

/** A callout's kind as the menu and its label say it: Note, Tip and so on. */
export const calloutName = (kind: string): string => kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();

/** What a code block's control says for its language: the language's own name when mdQuire knows it, the words as written when it does not, and Plain text for none. */
export function languageLabel(language: string): string {
    if (!language.trim()) return "Plain text";
    return languageOf(language)?.label ?? language.trim();
}

/**
 * The languages offered for what has been typed: every one whose name, or a name a fence may give
 * it, has it in it, Plain text first while nothing is typed, and, for words that name none exactly,
 * a last line that writes them as they are, since Markdown takes any word after the fence.
 */
export function matchLanguages(typed: string): LanguageChoice[] {
    const wanted = typed.trim().toLowerCase();
    const all: LanguageChoice[] = [{ label: "Plain text", name: "" }, ...LANGUAGES.map((language) => ({ label: language.label, name: language.aliases[0]! }))];
    if (!wanted) return all;
    const found = all.filter((choice) => {
        const language = choice.name ? languageOf(choice.name) : undefined;
        const names = [choice.label.toLowerCase(), ...(language?.aliases ?? [])];
        return names.some((name) => name.includes(wanted));
    });
    const exact = found.some((choice) => choice.label.toLowerCase() === wanted || languageOf(choice.name)?.aliases.includes(wanted));
    if (!exact && /^[\w+#.-]+$/.test(wanted)) found.push({ label: `Use “${typed.trim()}”`, name: typed.trim() });
    return found;
}

/** Builds the menus for a surface's code blocks and callouts. */
export function createBlockMenus(surface: Surface): { destroy(): void } {
    const root = surface.element;
    const languages = flowMenu("Code language", { className: "quire-language-menu" });
    const kinds = flowMenu("Callout type");

    /** The model path a control inside a drawn block stands for, from the inner path it carries. */
    const pathOf = (control: HTMLElement, inner: string | undefined): number[] => {
        let top: HTMLElement = control;
        while (top.parentElement && top.parentElement !== root) top = top.parentElement;
        return [[...root.children].indexOf(top), ...(inner ? inner.split(",").map(Number) : [])];
    };

    /** The block is changed, and the caret goes into it unless it is there already. */
    function choose(path: number[], change: () => void) {
        change();
        const focus = surface.getSelection().focus;
        const inside = focus.path.length >= path.length && path.every((step, k) => focus.path[k] === step);
        if (!inside) {
            const block = blockAt(surface.getDocument(), path);
            const at: Position = block?.kind === "quote" ? { path: [...path, 0], offset: 0 } : { path, offset: 0 };
            surface.setSelection({ anchor: at, focus: at });
        }
        surface.focus();
    }

    function openLanguages(control: HTMLElement) {
        const path = pathOf(control, control.dataset.lang);
        const block = blockAt(surface.getDocument(), path);
        if (block?.kind !== "code") return;
        const form = make("div", "quire-language");
        const field = make("input", "quire-link-field quire-language-field");
        field.type = "search";
        field.placeholder = "Search the languages";
        field.setAttribute("aria-label", "Search the languages");
        field.spellcheck = false;
        const list = make("div", "quire-language-list");
        list.setAttribute("role", "menu");
        list.setAttribute("aria-label", "Code language");
        const set = (name: string) => {
            languages.close(false);
            choose(path, () => {
                if (name !== block.language) surface.run((doc) => changeKind(doc, path, { kind: "code", language: name }));
            });
        };
        const fill = () => {
            list.replaceChildren(
                ...matchLanguages(field.value).map((choice) => {
                    const current = choice.name === block.language || (!!choice.name && !!languageOf(block.language) && languageOf(choice.name) === languageOf(block.language));
                    const line = menuLine({ label: choice.label, pressed: current, group: "language", run: () => {} });
                    line.addEventListener("mousedown", (event) => event.preventDefault());
                    line.addEventListener("click", () => set(choice.name));
                    return line;
                }),
            );
        };
        field.addEventListener("input", fill);
        field.addEventListener("keydown", (event) => {
            if (finishes(event)) {
                event.preventDefault();
                list.querySelector<HTMLElement>(".quire-menu-line")?.click();
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                // the menu's own arrow keys must not move on again from the line just reached
                event.stopPropagation();
                list.querySelector<HTMLElement>(".quire-menu-line")?.focus();
            }
        });
        fill();
        form.append(field, list);
        languages.open(control, form);
        field.focus({ preventScroll: true });
    }

    function openKinds(control: HTMLElement) {
        const path = pathOf(control, control.dataset.calloutKind);
        const block = blockAt(surface.getDocument(), path);
        if (block?.kind !== "quote" || block.callout === undefined) return;
        const now = block.callout.toUpperCase();
        const lines: MenuItem[] = CALLOUTS.map((kind) => ({
            label: calloutName(kind),
            pressed: kind === now,
            group: "callout",
            run: () => {
                kinds.close(false);
                choose(path, () => kind !== now && surface.run((doc) => setBox(doc, path, { callout: kind })));
            },
        }));
        kinds.open(control, lines, true);
    }

    /** A press on one of the controls opens its menu, or closes it if it is open from that control. */
    function onPress(event: MouseEvent) {
        const target = event.target as HTMLElement;
        const lang = target.closest?.<HTMLElement>("[data-lang]");
        const kind = target.closest?.<HTMLElement>("[data-callout-kind]");
        const control = lang ?? kind;
        if (!control || !root.contains(control)) return;
        // a pointer's press is taken at once; a click no pointer made (Enter or Space on the control, a screen reader) at its click
        if (event.type === "click" && event.detail !== 0) return;
        event.preventDefault();
        const menu = lang ? languages : kinds;
        if (menu.isOpen() && control.classList.contains("open")) return menu.close(true);
        if (lang) openLanguages(lang);
        else openKinds(kind!);
    }
    root.addEventListener("mousedown", onPress);
    root.addEventListener("click", onPress);

    return {
        destroy() {
            root.removeEventListener("mousedown", onPress);
            root.removeEventListener("click", onPress);
            languages.box.remove();
            kinds.box.remove();
        },
    };
}
