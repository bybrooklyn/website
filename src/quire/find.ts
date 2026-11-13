// Find and replace: a small bar that grows from the top right of the sheet (Ctrl+F, or Ctrl+H with
// its replace line open). Every match is marked in the text and the current one more strongly,
// through the browser's highlights, which colour the text without changing the page's elements.
// Enter and the arrows go to the next and the one before; match case and whole word narrow it.
// Replacing one, or all, is one step that one undo takes back.
//
// Finding and replacing are pure and tested (findMatches, replaceMatches); the bar is DOM.

import { blockAt, blockPaths, deleteText, insertText, textAt, type Document, type Position } from "./document";
import { type Surface } from "./surface";
import { control, glyph, icon, make, originFor, still } from "./ui";

/** How to look: matching capitals or not, and whole words only or not. */
export interface FindOptions {
    matchCase?: boolean;
    wholeWord?: boolean;
}

/** A match: the path of the text it is in, and where in that text it starts and ends. */
export interface Match {
    path: number[];
    from: number;
    to: number;
}

/** Every path whose text can be searched, in reading order: each block's, and each cell of a table. */
function textPaths(doc: Document): number[][] {
    return blockPaths(doc).flatMap((path) => {
        const block = blockAt(doc, path);
        if (block?.kind !== "table") return [path];
        return [block.header, ...block.rows].flatMap((row, r) => row.map((_, c) => [...path, r, c]));
    });
}

const wordy = /[\p{L}\p{N}_]/u;

/** Where `query` is found in the document, in reading order. A match does not run from one block into the next. */
export function findMatches(doc: Document, query: string, options: FindOptions = {}): Match[] {
    if (!query) return [];
    const wanted = options.matchCase ? query : query.toLocaleLowerCase();
    const found: Match[] = [];
    for (const path of textPaths(doc)) {
        const text = textAt(doc, path);
        const looked = options.matchCase ? text : text.toLocaleLowerCase();
        // lowering some letters changes their length; such text is looked through as it is
        const haystack = looked.length === text.length ? looked : text;
        for (let at = haystack.indexOf(wanted); at >= 0; at = haystack.indexOf(wanted, at + Math.max(1, wanted.length))) {
            const end = at + wanted.length;
            if (options.wholeWord && ((at > 0 && wordy.test(text[at - 1]!) && wordy.test(text[at]!)) || (end < text.length && wordy.test(text[end]!) && wordy.test(text[end - 1]!)))) continue;
            found.push({ path, from: at, to: end });
        }
    }
    return found;
}

/** The document with each of the matches replaced, the last first so that the earlier ones stay where they were found. */
export function replaceMatches(doc: Document, matches: Match[], replacement: string): Document {
    let next = doc;
    for (const match of [...matches].reverse()) {
        const at = (offset: number): Position => ({ path: match.path, offset });
        if (!replacement) {
            next = deleteText(next, { start: at(match.from), end: at(match.to) });
            continue;
        }
        // typed in just after the match's first letter, the new words take that letter's marks; then the old ones go round them
        const length = replacement.length;
        next = insertText(next, at(match.from + 1), replacement);
        next = deleteText(next, { start: at(match.from + 1 + length), end: at(match.to + length) });
        next = deleteText(next, { start: at(match.from), end: at(match.from + 1) });
    }
    return next;
}

/** Which match is the current one after the cursor moved to `position`: the first that does not end before it. */
export function matchAfter(matches: Match[], position: Position): number {
    if (!matches.length) return -1;
    const compare = (a: number[], b: number[]) => {
        for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
        return a.length - b.length;
    };
    const at = matches.findIndex((match) => compare(match.path, position.path) > 0 || (compare(match.path, position.path) === 0 && match.to > position.offset));
    return at < 0 ? 0 : at;
}

/** Builds the find bar for a surface, on the sheet it writes on. */
export function createFind(surface: Surface, sheet: HTMLElement, top: () => number) {
    // it is drawn as the selection bar is (one rule in quire.css), and grows in the same way, from its top right corner
    const bar = make("div", "quire-find");
    bar.setAttribute("role", "search");
    bar.setAttribute("aria-label", "Find and replace");
    bar.inert = true;
    const lines = make("div", "quire-find-lines");
    const findLine = make("div", "quire-find-line");
    const field = make("input", "quire-link-field quire-find-field");
    field.placeholder = "Find";
    field.setAttribute("aria-label", "Find");
    field.spellcheck = false;
    const count = make("span", "quire-find-count");
    count.setAttribute("aria-live", "polite");
    const options: FindOptions = {};
    const toggle = (label: string, content: Node, key: keyof FindOptions) => {
        const button = control(label, content, () => {
            options[key] = !options[key];
            button.setAttribute("aria-pressed", String(!!options[key]));
            button.classList.toggle("pressed", !!options[key]);
            search(true);
        });
        button.setAttribute("aria-pressed", "false");
        return button;
    };
    const back = control("The one before (Shift+Enter)", icon("chevron"), () => go(-1));
    back.classList.add("quire-find-back");
    const on = control("The next (Enter)", icon("chevron"), () => go(1));
    const more = control("Replace", icon("chevron"), () => showReplace(!bar.classList.contains("replacing")));
    more.classList.add("quire-find-more");
    findLine.append(more, field, count, toggle("Match case", glyph("Aa", "case"), "matchCase"), toggle("Whole word", glyph("W", "word"), "wholeWord"), back, on, control("Close (Escape)", icon("close"), () => close()));
    const replaceLine = make("div", "quire-find-line quire-find-replace");
    const inner = make("div", "quire-find-replace-inner");
    const replacement = make("input", "quire-link-field quire-find-field");
    replacement.placeholder = "Replace with";
    replacement.setAttribute("aria-label", "Replace with");
    replacement.spellcheck = false;
    inner.append(replacement, control("Replace this one", "Replace", () => replaceOne(), "quire-button quire-choice"), control("Replace all", "All", () => replaceAll(), "quire-button quire-choice"));
    replaceLine.append(inner);
    lines.append(findLine, replaceLine);
    bar.append(lines);
    document.body.append(bar);

    let matches: Match[] = [];
    let current = -1;
    const marks = typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : undefined;
    const Marker = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

    function paint() {
        if (!marks || !Marker) return;
        if (!bar.classList.contains("shown") || !matches.length) {
            marks.delete("quire-found");
            marks.delete("quire-found-now");
            return;
        }
        const ranges = matches.map((match) => surface.rangeOf({ path: match.path, offset: match.from }, { path: match.path, offset: match.to }));
        marks.set("quire-found", new Marker(...ranges.filter((range, index): range is Range => !!range && index !== current)));
        const now = ranges[current];
        if (now) marks.set("quire-found-now", new Marker(now));
        else marks.delete("quire-found-now");
    }

    function say() {
        count.textContent = !field.value ? "" : matches.length ? `${current + 1} of ${matches.length}` : "None";
        bar.classList.toggle("none", !!field.value && !matches.length);
    }

    /** Brings the current match into sight, below the bars at the top. */
    function reveal() {
        const match = matches[current];
        const range = match && surface.rangeOf({ path: match.path, offset: match.from }, { path: match.path, offset: match.to });
        const box = range?.getBoundingClientRect();
        if (!box) return;
        const above = top() + bar.offsetHeight + 16;
        if (box.top < above || box.bottom > innerHeight - 40) scrollBy({ top: box.top - (above + innerHeight) / 2, behavior: still() ? "instant" : "smooth" });
    }

    /** Looks again; `fresh` starts from the cursor rather than staying on the match it was on. */
    function search(fresh = false) {
        const was = matches[current];
        matches = findMatches(surface.getDocument(), field.value, options);
        if (fresh || !was) current = matchAfter(matches, surface.getSelection().anchor);
        else current = Math.min(Math.max(0, matches.findIndex((match) => match.path.join() === was.path.join() && match.from >= was.from)), matches.length - 1);
        if (current < 0 && matches.length) current = 0;
        paint();
        say();
        if (fresh) reveal();
    }

    function go(by: 1 | -1) {
        if (!matches.length) return;
        current = (current + by + matches.length) % matches.length;
        paint();
        say();
        reveal();
    }

    function replaceOne() {
        const match = matches[current];
        if (!match) return;
        surface.run((doc) => replaceMatches(doc, [match], replacement.value));
        // the next match is the one now standing where this one was
        matches = findMatches(surface.getDocument(), field.value, options);
        current = matchAfter(matches, { path: match.path, offset: match.from + replacement.value.length });
        paint();
        say();
        reveal();
    }

    function replaceAll() {
        if (!matches.length) return;
        const all = matches;
        surface.run((doc) => replaceMatches(doc, all, replacement.value));
        search(true);
    }

    function showReplace(shown: boolean) {
        bar.classList.toggle("replacing", shown);
        replaceLine.inert = !shown;
        more.setAttribute("aria-expanded", String(shown));
    }
    showReplace(false);

    const keys = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            close(true);
        } else if (event.key === "Enter" && event.target === field) {
            event.preventDefault();
            go(event.shiftKey ? -1 : 1);
        } else if (event.key === "Enter" && event.target === replacement) {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) replaceAll();
            else replaceOne();
        } else if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "h")) {
            event.preventDefault();
            open(event.key === "h");
        }
    };
    bar.addEventListener("keydown", keys);
    field.addEventListener("input", () => search(true));

    /** Puts the bar at the top right of the sheet, under the bars that stay at the top. */
    function place() {
        const box = sheet.getBoundingClientRect();
        bar.style.top = `${Math.max(top(), box.top) + 10}px`;
        // on a narrow window it slides left as far as it must to stay whole
        bar.style.right = `${Math.max(8, Math.min(innerWidth - box.right + 10, innerWidth - bar.offsetWidth - 8))}px`;
    }
    const follow = () => bar.classList.contains("shown") && place();
    addEventListener("scroll", follow, { passive: true });
    addEventListener("resize", follow);
    // the text changing elsewhere (typing, undo) moves the matches with it
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const stop = surface.on("change", () => {
        if (!bar.classList.contains("shown")) return;
        clearTimeout(waiting);
        waiting = setTimeout(() => search(false), 120);
    });

    function open(replacing = false) {
        const selection = surface.getSelection();
        // what is selected, on one line, is what is looked for
        if (selection.anchor.path.join() === selection.focus.path.join() && selection.anchor.offset !== selection.focus.offset) {
            const [from, to] = [selection.anchor.offset, selection.focus.offset].sort((a, b) => a - b);
            field.value = textAt(surface.getDocument(), selection.anchor.path).slice(from, to);
        }
        if (replacing) showReplace(true);
        place();
        // it grows out of what was pressed (the bar's button, a menu's line), or from the sheet's corner when asked for from the keyboard
        const width = bar.offsetWidth;
        bar.style.transformOrigin = originFor({ left: document.documentElement.clientWidth - parseFloat(bar.style.right) - width, top: parseFloat(bar.style.top), width, height: bar.offsetHeight }, "100% 0");
        void bar.offsetWidth;
        bar.classList.add("shown");
        bar.inert = false;
        (replacing && field.value ? replacement : field).focus({ preventScroll: true });
        (replacing && field.value ? replacement : field).select();
        search(true);
    }

    function close(back = false) {
        if (!bar.classList.contains("shown")) return;
        bar.classList.remove("shown");
        bar.inert = true;
        paint();
        const match = matches[current];
        // going back to the text, the cursor is on the match that was found
        if (back && match) surface.setSelection({ anchor: { path: match.path, offset: match.from }, focus: { path: match.path, offset: match.to } });
        if (back || bar.contains(document.activeElement)) surface.focus();
    }

    return {
        element: bar,
        open,
        close,
        isOpen: () => bar.classList.contains("shown"),
        destroy() {
            stop();
            clearTimeout(waiting);
            removeEventListener("scroll", follow);
            removeEventListener("resize", follow);
            marks?.delete("quire-found");
            marks?.delete("quire-found-now");
            bar.remove();
        },
    };
}
