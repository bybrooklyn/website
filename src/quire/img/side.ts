// imgQuire's one side panel: a column at the right of the picture that is always there (under it on a
// phone), so that the picture never glides aside when a tool is chosen and nothing that stays open lies
// over it. It shows one page at a time: the export with no tool on, or the controls of whatever is on
// (crop, resize, mark up, cut out, color, more, the facts, version history). The page that goes fades
// out where it was while the one that comes fades in, quickly. Over the page there is one line for what
// is being done now (a model running, a press asked for on the picture), which grows in and folds away.
// The controls are the small tools' kit (core/bench.ts), so the column reads as theirs do.
//
//   const side = sideColumn({ home: () => exporting, back: () => stage.focus(), escape: () => ... });
//   const crop = side.page("crop", "quire-img-crop-page");
//   crop.body.append(...); crop.open();

import { make, still } from "../core/ui";

/** A page of the column: its element, where its controls go, and whether it is the one shown. */
export interface Page {
    panel: HTMLElement;
    body: HTMLElement;
    isOpen(): boolean;
    /** Shows this page in the column, in place of the one shown. */
    open(from?: HTMLElement): void;
    /** Shows the column's first page in this one's place, when this one is shown. */
    close(): void;
}

/** What the column is given: the page it goes back to, where the keyboard goes when the page that had it goes, and what Escape inside it does (true when it did something). */
export interface SideHooks {
    home(): Page;
    back(): void;
    escape?(): boolean;
    /** A page has given its place to another. */
    left?(page: Page): void;
}

/** The column's name for a page, from its title: the words a test or a style can find it by ("mark up" is "mark-up"). */
export const pageName = (title: string): string => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Builds the column; its pages are made with `page` and shown one at a time. */
export function sideColumn(hooks: SideHooks) {
    const element = make("div", "quire-bench-side quire-img-side");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Tool");
    // what is being done now, over every page
    const doing = make("div", "quire-img-doing quire-bench-fold away");
    doing.setAttribute("role", "status");
    doing.inert = true;
    const pages = make("div", "quire-img-pages");
    element.append(doing, pages);
    let current: Page | undefined;
    const left = new Map<HTMLElement, (() => void) | undefined>();

    /** Shows a page in place of the one shown: the one going is told it went, and gives the keyboard back if it had it. */
    function show(next: Page) {
        if (next.panel === current?.panel) return;
        const was = current;
        current = next;
        element.dataset.page = next.panel.dataset.page ?? "";
        next.panel.inert = false;
        next.panel.classList.add("open");
        if (!was) return;
        const had = was.panel.contains(document.activeElement);
        was.panel.classList.remove("open");
        was.panel.inert = true;
        if (had) hooks.back();
        left.get(was.panel)?.();
        hooks.left?.(was);
    }

    /** A page of the column, titled with its small heading (none for a page that has its own); `left` is told when another page takes its place. */
    function page(title: string, className = "", options: { heading?: boolean; left?: () => void } = {}): Page {
        const panel = make("section", `quire-img-page ${className}`.trim());
        panel.dataset.page = pageName(title);
        panel.setAttribute("aria-label", title);
        panel.inert = true;
        const body = make("div", "quire-img-page-body");
        if (options.heading !== false) panel.append(make("h2", "quire-img-page-title", title));
        panel.append(body);
        pages.append(panel);
        const made: Page = {
            panel,
            body,
            isOpen: () => current?.panel === panel,
            open: () => show(made),
            close: () => {
                if (current?.panel === panel && panel !== hooks.home().panel) show(hooks.home());
            },
        };
        left.set(panel, options.left);
        return made;
    }

    // Escape inside the column: what the tool says it does (a press asked for let go, the tool left), else back to the first page
    element.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        // a part that answers Escape itself, a step at a time (version history), keeps it
        if (event.target instanceof Element && event.target.closest("[data-own-escape]")) return;
        if (hooks.escape?.()) {
            event.preventDefault();
            event.stopPropagation();
            hooks.back();
            return;
        }
        if (current && current.panel !== hooks.home().panel) {
            event.preventDefault();
            event.stopPropagation();
            show(hooks.home());
            hooks.back();
        }
    });

    // the control of the column that last held the keyboard
    let held: HTMLElement | undefined;
    element.addEventListener("focusin", (event) => {
        if (event.target instanceof HTMLElement) held = event.target;
    });
    /**
     * Gives the keyboard back when the control holding it was just switched off or folded away (hide all once all is hidden, a
     * number's in order once it is in order): the browser drops it to the page's body, outside the editor's keys, where Escape and
     * Ctrl+Z did nothing. True when it was given back.
     */
    function keepKeyboard(): boolean {
        const now = document.activeElement;
        // the browser lets go of a control switched off only when it next draws: until then the control itself still holds the keyboard
        const holder = now instanceof HTMLElement && now !== document.body ? (element.contains(now) ? now : undefined) : held;
        if (!holder || holder.isConnected && !holder.matches(":disabled") && !holder.closest("[inert]")) return false;
        held = undefined;
        hooks.back();
        return true;
    }

    /** Says what is being done now over the page, with its few words to press, or folds the line away when nothing is. */
    function say(said: { words: string; controls?: HTMLElement[] } | undefined) {
        doing.classList.toggle("away", !said);
        doing.inert = !said;
        if (!said) return;
        const line = make("p", "quire-img-doing-said", said.words);
        const before = new Set([...doing.querySelectorAll("button")].map((each) => each.textContent));
        doing.replaceChildren(line, ...(said.controls?.length ? [make("div", "quire-img-doing-controls")] : []));
        doing.querySelector(".quire-img-doing-controls")?.append(...(said.controls ?? []));
        // what is new in the line grows in, rather than appearing
        if (!still()) for (const control of said.controls ?? []) if (!before.has(control.textContent)) control.classList.add("grows");
    }

    return { element, doing, page, show, say, keepKeyboard, current: () => current };
}
