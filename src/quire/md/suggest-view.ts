// Suggested words, drawn: the rest of the word being typed, or the next few words, faint after the
// caret, as Gmail's and Docs' Smart Compose show them. Tab takes all of it; Ctrl+Right (Alt+Right on
// a Mac, the keys that move by a word) takes the next word; typing on goes through it, the faint
// words shortening while what is typed matches them and changing when it does not; Escape hides it
// until the next word. It is never part of the document: it is a drawing laid over the page after
// the caret (as the drawn caret is, caret.ts), so undo, selection, saving, the word count and
// checking never see it, and nothing in the text moves. It is shown only at the end of a paragraph,
// heading or list item's text, where nothing follows it on the line, and never in code, maths, a
// table, a field or the title; what does not fit on the caret's line is left off rather than drawn
// over the line below.
//
// Tab is shared this way: while faint words show, Tab takes them; when none show, Tab is what it was
// (indenting a list item, moving between a table's cells, which never have suggestions, the colon's
// emoji list, which takes Tab first). A list item's start has no words before it, so nothing shows
// there and Tab indents.
//
// The words come from the learner (suggest-learn.ts), over her documents. Tools has the switch,
// "Suggest words as I type", on unless she turned it off, and "Forget what it learned".
//
//   const suggestions = mountSuggestions(surface, paper, { stores, current, say });
//   suggestions.items()     the lines for Tools
//   suggestions.saved()     the document was saved: it is learned again a little later
//   suggestions.destroy()

import { activeBlock, activeMarks, collapsed } from "./keys";
import { textAt, type Document, type Mark, type Selection } from "./document";
import { caretBox } from "./caret";
import { typeIn } from "./inserts";
import { make, type MenuItem } from "../ui";
import { write } from "./write";
import type { Store } from "../store";
import type { Surface } from "./surface";
import { browserIdle, createLearner, documentKey, indexedKeeper, type Learner } from "./suggest-learn";

/** Where the switch is kept in this browser: "off" when she turned suggestions off. */
export const SUGGEST_KEY = "quire-suggest";

/** How long after a save the document is learned again, so that a run of saves while writing is learned once. */
const RELEARN = 20_000;

/** True on a Mac, where Alt and the arrows move by a word. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The text before the caret in its block, when faint words may be shown there: the selection is a
 * caret, at the very end of a paragraph's or heading's text (in a list or a quote too), not in a
 * table's cell and not in code or maths. Undefined anywhere else.
 */
export function placeFor(doc: Document, selection: Selection, marks: readonly Mark[]): string | undefined {
    if (!collapsed(selection)) return undefined;
    const { path, offset } = selection.focus;
    const kind = activeBlock(doc, path).kind;
    if (kind !== "paragraph" && kind !== "heading") return undefined;
    if (marks.includes("code") || marks.includes("math")) return undefined;
    const text = textAt(doc, path);
    if (offset !== text.length) return undefined;
    return text.slice(Math.max(0, offset - 200));
}

/** The next word of a suggestion, with any space before it: what Ctrl+Right takes. */
export function nextWord(text: string): string {
    return /^\s*\S+/.exec(text)?.[0] ?? text;
}

/** What the editor gives suggestions. */
export interface SuggestHost {
    /** The places to learn from. */
    stores: () => Store[];
    /** Where the document open now is kept. */
    current: () => { store?: Store; id?: string };
    /** Says something in the status: a few words, and the whole of it. */
    say?: (short: string, full: string) => void;
    /** A learner of the test's own; one over IndexedDB is made otherwise. */
    learner?: () => Learner;
    /** Where the switch is kept; the browser's localStorage if not given. */
    keep?: Pick<Storage, "getItem" | "setItem">;
}

/** Suggestions as the editor holds them. */
export interface Suggestions {
    items(): MenuItem[];
    /** Whether suggestions are switched on. */
    on(): boolean;
    /** The words shown now, or "" when none are. */
    shown(): string;
    saved(): void;
    learner(): Learner | undefined;
    destroy(): void;
}

/** Joins suggestions to the editor: the faint words, their keys and the Tools lines. */
export function mountSuggestions(surface: Surface, frame: HTMLElement, host: SuggestHost): Suggestions {
    const keep = host.keep ?? (() => {
        try {
            return localStorage;
        } catch {
            return undefined;
        }
    })();
    let on = (() => {
        try {
            return keep?.getItem(SUGGEST_KEY) !== "off";
        } catch {
            return true;
        }
    })();
    let learner: Learner | undefined;
    const ghost = make("div", "quire-suggestion");
    ghost.setAttribute("aria-hidden", "true");
    frame.append(ghost);

    function startLearning() {
        learner = host.learner?.() ?? createLearner({ stores: host.stores, keeper: indexedKeeper(), delay: 3000 });
        void learner.start();
        opened();
    }

    // ---- what is shown ----
    let text = "";
    /** The text before the caret when the words were shown, to tell a letter typed that matches them. */
    let before = "";
    let at = "";
    /** Where Escape hid the words: the block, and where the word being typed starts. */
    let dismissed: string | undefined;
    let composing = false;

    function hide() {
        if (!text) return;
        text = "";
        ghost.classList.remove("shown");
    }

    /** Where the word being typed starts in its block, as the key Escape hides it by. */
    const wordKey = (path: number[], textBefore: string) => `${path.join()}:${textBefore.length - (/[\p{L}\p{M}'’-]*$/u.exec(textBefore)?.[0].length ?? 0)}`;

    /** Draws the words after the caret, leaving off what does not fit on its line; false when nothing fits. */
    function draw(words: string): boolean {
        const box = caretBox(surface.element, frame);
        const holder = surface.elementAt(surface.getSelection().focus.path);
        if (!box || !holder) return false;
        const style = getComputedStyle(holder);
        // words laid after the caret line up only with text that starts at the left
        if (!["start", "left", "justify"].includes(style.textAlign) || style.direction === "rtl") return false;
        const node = getSelection()?.focusNode;
        const around = node instanceof Element ? node : node?.parentElement;
        const set = getComputedStyle(around && holder.contains(around) ? around : holder);
        const origin = frame.getBoundingClientRect();
        const zoom = origin.width / (frame.offsetWidth || origin.width) || 1;
        const edge = (holder.getBoundingClientRect().right - origin.left) / zoom - frame.clientLeft - (parseFloat(style.paddingRight) || 0);
        const room = edge - box.left - 2;
        const paint = measure();
        paint.font = `${set.fontStyle} ${set.fontWeight} ${set.fontSize} ${set.fontFamily}`;
        let fits = words;
        while (fits && paint.measureText(fits).width > room) {
            const cut = fits.replace(/\s*\S+\s*$/, "");
            // the end of the word being typed must fit whole, or nothing is shown
            if (cut === fits || (!/^\s/.test(words) && cut.length < nextWord(words).length)) return false;
            fits = cut;
        }
        if (fits.trim() === "") return false;
        Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, height: `${box.height}px`, lineHeight: `${box.height}px`, fontFamily: set.fontFamily, fontSize: set.fontSize, fontWeight: set.fontWeight, fontStyle: set.fontStyle, letterSpacing: set.letterSpacing });
        ghost.textContent = fits;
        text = fits;
        ghost.classList.add("shown");
        return true;
    }
    let canvas: CanvasRenderingContext2D | undefined;
    const measure = () => (canvas ??= document.createElement("canvas").getContext("2d")!);

    /** Looks again at what is at the caret, after a letter was typed: the words shortened, changed or hidden. */
    function look() {
        if (!on || !learner || composing || document.activeElement !== surface.element) return hide();
        const doc = surface.getDocument();
        const selection = surface.getSelection();
        const now = placeFor(doc, selection, activeMarks({ doc, selection }));
        if (now === undefined) return hide();
        const where = selection.focus.path.join();
        const key = wordKey(selection.focus.path, now);
        if (dismissed !== undefined && dismissed === key) return hide();
        dismissed = undefined;
        // a letter typed that is the next of the faint words: they shorten, and are not asked for again
        const typed = where === at && now.length === before.length + 1 && now.startsWith(before) ? now[now.length - 1]! : undefined;
        const kept = text && typed !== undefined && text[0] === typed ? text.slice(1) : undefined;
        const words = kept !== undefined && kept.trim() !== "" ? kept : learner.predict(now);
        before = now;
        at = where;
        if (!words || !draw(words)) hide();
    }

    // ---- following the writing ----
    let typing = false;
    let frameAsked = 0;
    const stops = [
        surface.on("change", ({ kind, before: was }) => {
            // a document put in place of another: what it says is noted, to take back exactly when it is saved
            if (!was) {
                hide();
                opened();
                return;
            }
            // only typing shows or changes the words; anything else hides them, at no cost to the key
            if (kind !== "type") return hide();
            typing = true;
            if (!frameAsked) frameAsked = requestAnimationFrame(() => {
                frameAsked = 0;
                look();
            });
        }),
        surface.on("select", () => {
            if (typing) return void (typing = false);
            hide();
        }),
    ];

    function accept(piece: string) {
        const rest = text.slice(piece.length);
        hide();
        surface.run((doc, selection) => typeIn({ doc, selection }, piece), "paste");
        // what is left after taking one word stays shown
        if (rest.trim()) {
            requestAnimationFrame(() => {
                const doc = surface.getDocument();
                const selection = surface.getSelection();
                const now = placeFor(doc, selection, activeMarks({ doc, selection }));
                if (now === undefined) return;
                before = now;
                at = selection.focus.path.join();
                draw(rest);
            });
        }
    }

    function onKey(event: KeyboardEvent) {
        if (!text || event.isComposing) return;
        const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
        if (event.key === "Tab" && plain && !event.shiftKey) accept(text);
        else if (event.key === "ArrowRight" && !event.shiftKey && (MAC ? event.altKey && !event.ctrlKey && !event.metaKey : event.ctrlKey && !event.altKey && !event.metaKey)) accept(nextWord(text));
        else if (event.key === "Escape" && plain) {
            const selection = surface.getSelection();
            const now = placeFor(surface.getDocument(), selection, []);
            dismissed = now === undefined ? undefined : wordKey(selection.focus.path, now);
            hide();
        } else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    const onCompose = (event: Event) => {
        composing = event.type === "compositionstart";
        hide();
    };
    const onBlur = () => hide();
    const onResize = () => hide();
    surface.element.addEventListener("keydown", onKey, true);
    surface.element.addEventListener("compositionstart", onCompose);
    surface.element.addEventListener("compositionend", onCompose);
    surface.element.addEventListener("blur", onBlur);
    addEventListener("resize", onResize);

    // ---- learning the document open, and again once it is saved ----
    const keyNow = () => {
        const { store, id } = host.current();
        return store && id ? documentKey(store, id) : undefined;
    };
    const idle = browserIdle();
    function opened() {
        const key = keyNow();
        const doc = surface.getDocument();
        if (!key || !learner) return;
        idle(() => learner?.opened(key, write(doc)));
    }
    let relearn: ReturnType<typeof setTimeout> | undefined;
    let waiting: { key: string; doc: Document } | undefined;
    const learnWaiting = () => {
        const was = waiting;
        waiting = undefined;
        clearTimeout(relearn);
        if (was && learner) idle(() => void learner?.saved(was.key, write(was.doc)));
    };
    function saved() {
        const key = keyNow();
        if (!on || !key) return;
        // another document's save still waiting is learned now, before this one takes its place
        if (waiting && waiting.key !== key) learnWaiting();
        waiting = { key, doc: surface.getDocument() };
        clearTimeout(relearn);
        relearn = setTimeout(learnWaiting, RELEARN);
    }

    function set(next: boolean) {
        on = next;
        try {
            keep?.setItem(SUGGEST_KEY, next ? "on" : "off");
        } catch {
            // kept for this visit only
        }
        if (next && !learner) startLearning();
        if (!next) {
            hide();
            learner?.stop();
            learner = undefined;
        }
    }

    if (on) startLearning();

    return {
        items: () => [
            { label: "Suggest words as I type", pressed: on, run: () => set(!on) },
            {
                label: "Forget what it learned",
                disabled: !on,
                run: () => {
                    hide();
                    void learner?.forget();
                    host.say?.("Forgotten", "What suggestions learned from your writing is forgotten. From now on it learns only from what you write next.");
                },
            },
        ],
        on: () => on,
        shown: () => text,
        saved,
        learner: () => learner,
        destroy() {
            learnWaiting();
            for (const stop of stops) stop();
            cancelAnimationFrame(frameAsked);
            surface.element.removeEventListener("keydown", onKey, true);
            surface.element.removeEventListener("compositionstart", onCompose);
            surface.element.removeEventListener("compositionend", onCompose);
            surface.element.removeEventListener("blur", onBlur);
            removeEventListener("resize", onResize);
            learner?.stop();
            ghost.remove();
        },
    };
}
