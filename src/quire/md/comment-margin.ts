// The writer's notes as she sees them: the words a note is on are marked faintly in the text (with
// the browser's highlights, which colour text without changing the page), and the notes sit in the
// right margin beside their words on a wide window, where the document's details are otherwise, or
// in a list that opens from the menus on a narrow one. A note is added from Insert, Comment (or
// Ctrl+Alt+M) on the selected words; resolved, reopened, edited and deleted from its card; and the
// notes are gone through with next and previous. Each change is one undo step (comments.ts holds
// the model). A plain Markdown file cannot hold notes, so for one they are kept in this browser
// only, under the document's place and name, and the list says so.
//
//   const notes = createCommentMargin(surface, { place: () => key, menu });
//   host.append(notes.element);  notes.add(from); notes.next(1); notes.list(from); notes.opened();

import { addComment, changeComment, commentAt, deleteComment, inOrder, nextComment, notesData, spansOf, withNotes, type Span } from "./comments";
import type { Comment, Document, Range } from "./document";
import { caret, collapsed, rangeOf } from "./keys";
import { wordAt } from "./bar";
import { dateText } from "./inserts";
import type { Surface } from "./surface";
import { control, flowMenu, icon, make, still } from "../core/ui";

/** Where a Markdown file's notes are kept in this browser, by the document's place and name. */
const KEY = "quire-notes:";

/** Where the choice to put the comments out of sight is kept. */
const HIDDEN = "quire-comments";

/** A plain Markdown document with the notes kept for it in this browser put back on it; a `.quire` document, or one with none kept, as it was. */
export function keptNotes(doc: Document, place: string | undefined): { doc: Document; lost: number } {
    if (doc.quire || !place) return { doc, lost: 0 };
    let data: unknown = null;
    try {
        data = JSON.parse(localStorage.getItem(KEY + place) ?? "null");
    } catch {
        return { doc, lost: 0 };
    }
    return withNotes(doc, data);
}

/** When a note was written, as the site writes a date, with the time for one written today. */
export function writtenWhen(created: number, now = Date.now()): string {
    if (!created) return "";
    const then = new Date(created);
    const today = new Date(now).toDateString() === then.toDateString();
    return today ? `Today, ${then.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : dateText(then);
}

/** The marks of the notes in the text: every open note's words, and the one being looked at. */
const MARKS = { all: "quire-note", now: "quire-note-now" };

/** Moves a Markdown file's notes kept in this browser to the place it has after a rename. */
export function moveNotes(from: string, to: string) {
    if (from === to) return;
    try {
        const kept = localStorage.getItem(KEY + from);
        if (kept === null) return;
        localStorage.setItem(KEY + to, kept);
        localStorage.removeItem(KEY + from);
    } catch {
        // a browser that keeps nothing had nothing to move
    }
}

/** Builds the notes' margin and list for a surface. */
export function createCommentMargin(surface: Surface, options: { place: () => string | undefined }) {
    const margin = make("aside", "quire-notes");
    margin.setAttribute("aria-label", "Comments");
    const cards = make("div", "quire-notes-cards");
    margin.append(cards);
    const list = flowMenu("Comments", { className: "quire-notes-menu" });
    let current: string | undefined;
    /** True while the writer has put the comments out of sight (View, Show comments), kept for every document. */
    let hidden = (() => {
        try {
            return localStorage.getItem(HIDDEN) === "hidden";
        } catch {
            return false;
        }
    })();
    let draft: { range: Range; card: HTMLElement } | undefined;
    let editing: string | undefined;
    let spans = new Map<string, Span[]>();
    const highlights = typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : undefined;
    const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: globalThis.Range[]) => unknown }).Highlight;

    const doc = () => surface.getDocument();
    const comments = () => doc().comments ?? [];
    /** True when the margin has room to hold the notes beside the text; on a narrow window they are a list instead. */
    const roomy = () => margin.isConnected && getComputedStyle(margin).display !== "none" && margin.clientWidth >= 150;

    // ---- the marks in the text ----
    function markText() {
        if (!highlights || !Highlight) return;
        const ranges = (ids: string[]) =>
            ids.flatMap((id) => (spans.get(id) ?? []).map((span) => surface.rangeOf({ path: span.path, offset: span.from }, { path: span.path, offset: span.to })).filter((range): range is globalThis.Range => !!range));
        const open = comments().filter((each) => !each.resolved).map((each) => each.id);
        const now = draft ? [] : current && open.includes(current) ? [current] : [];
        if (open.length) highlights.set(MARKS.all, new Highlight(...ranges(open)));
        else highlights.delete(MARKS.all);
        const drafted = draft ? [surface.rangeOf(draft.range.start, draft.range.end)].filter((range): range is globalThis.Range => !!range) : [];
        if (now.length || drafted.length) highlights.set(MARKS.now, new Highlight(...ranges(now), ...drafted));
        else highlights.delete(MARKS.now);
    }

    // ---- the cards ----
    const top = (span: Span | undefined): number | undefined => {
        const range = span && surface.rangeOf({ path: span.path, offset: span.from }, { path: span.path, offset: span.to });
        const box = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
        return box ? box.top - cards.getBoundingClientRect().top : undefined;
    };

    /** A card for a note: what it says, when, and what can be done with it. */
    function card(comment: Comment, inList: boolean): HTMLElement {
        const element = make("article", "quire-note");
        element.dataset.id = comment.id;
        const gone = !spans.has(comment.id);
        if (comment.resolved) element.classList.add("resolved");
        if (gone) element.classList.add("gone");
        if (comment.id === current) element.classList.add("now");
        if (inList && comment.quote) element.append(make("p", "quire-note-quote", comment.quote.length > 80 ? `${comment.quote.slice(0, 80)}…` : comment.quote));
        if (editing === comment.id) element.append(field(comment.text, (text) => (text ? keep((now) => changeComment(now, comment.id, { text })) : undefined), () => ((editing = undefined), redraw())));
        else element.append(make("p", "quire-note-text", comment.text));
        const said = [writtenWhen(comment.created), comment.resolved ? "Resolved" : ""].filter(Boolean).join(", ");
        if (said) element.append(make("p", "quire-note-meta", said));
        if (gone) element.append(make("p", "quire-note-gone", comment.quote ? `Its words, “${comment.quote.length > 60 ? `${comment.quote.slice(0, 60)}…` : comment.quote}”, are gone from the text. Undo brings them back.` : "Its words are gone from the text."));
        // a strip of icons, each named in its tooltip, as every row of actions on a thing in the text is
        const actions = make("div", "quire-note-actions");
        if (!gone) actions.append(control(comment.resolved ? "Reopen" : "Resolve", icon(comment.resolved ? "undo" : "tick"), () => keep((now) => changeComment(now, comment.id, { resolved: !comment.resolved }))));
        if (!gone && !comment.resolved)
            actions.append(
                control("Edit", icon("pen"), () => {
                    editing = comment.id;
                    redraw();
                }),
            );
        actions.append(control("Remove", icon("trash"), () => keep((now) => deleteComment(now, comment.id))));
        element.append(actions);
        element.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).closest("button, textarea")) return;
            look(comment.id, false);
        });
        return element;
    }

    /** A field to write a comment in: Ctrl+Enter or Comment keeps it, Escape or Cancel lets it go, as in Docs. */
    function field(value: string, done: (text: string) => void, cancel: () => void): HTMLElement {
        const form = make("div", "quire-note-form");
        const area = make("textarea", "quire-note-field");
        area.value = value;
        area.rows = 3;
        area.placeholder = "Write a comment";
        area.setAttribute("aria-label", "Comment");
        area.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                cancel();
            } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                done(area.value.trim());
            }
        });
        const buttons = make("div", "quire-note-actions");
        // in every dialog's order: the quiet cancel, then the filled button, named as Docs names it, at the right
        buttons.append(control("Cancel", "Cancel", cancel, "quire-button quire-note-button"), control("Comment", "Comment", () => done(area.value.trim()), "quire-button quire-note-button quire-note-keep"));
        form.append(area, buttons);
        requestAnimationFrame(() => area.isConnected && area.focus({ preventScroll: true }));
        return form;
    }

    /** Makes a change to the notes as one undo step, and draws them again. */
    function keep(change: (now: Document) => Document) {
        editing = undefined;
        surface.run((now) => change(now));
        redraw();
    }

    /** Draws the cards in the margin beside their words, each below the one before when they would overlap. */
    function drawMargin() {
        const open = inOrder(doc(), spans).filter((each) => !each.resolved);
        const resolved = comments().length - open.length;
        const shown = (!hidden || !!draft) && roomy() && (open.length > 0 || !!draft);
        margin.closest(".quire-editor")?.classList.toggle("noted", shown);
        if (!roomy() || (hidden && !draft)) {
            cards.replaceChildren();
            return;
        }
        const was = new Map([...cards.querySelectorAll<HTMLElement>(".quire-note")].map((element) => [element.dataset.id ?? "", element]));
        const made: HTMLElement[] = [];
        for (const comment of open) {
            // the card being edited is kept as it is, so that what is being written in it stays
            const element = comment.id === editing && was.get(comment.id)?.querySelector("textarea") ? was.get(comment.id)! : card(comment, false);
            if (!was.has(comment.id)) element.classList.add("arriving");
            made.push(element);
        }
        if (draft) made.push(draft.card);
        // with no open notes the margin is the details' again, and the resolved ones are in the list from View
        if (resolved > 0 && open.length > 0) {
            const more = control("Show the resolved comments", `${resolved} resolved`, (button) => showList(button), "quire-button quire-notes-resolved");
            more.dataset.id = "resolved";
            made.push(more);
        }
        cards.replaceChildren(...made);
        let below = 0;
        for (const element of made) {
            const id = element.dataset.id;
            const wanted = id === "draft" ? top({ path: draft!.range.start.path, from: draft!.range.start.offset, to: draft!.range.start.offset }) : id === "resolved" ? below : top(spans.get(id ?? "")?.[0]);
            const at = Math.max(wanted ?? below, below);
            element.style.top = `${at}px`;
            const old = was.get(id ?? "");
            // a card that moved flows to its new place from where it was
            if (old && old.style.top && old.style.top !== element.style.top && !still()) element.animate([{ top: old.style.top }, { top: element.style.top }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
            below = at + element.offsetHeight + 10;
        }
        for (const element of made) if (element.classList.contains("arriving")) requestAnimationFrame(() => element.classList.remove("arriving"));
    }

    /** The list of every note, resolved ones too, for a narrow window and for the resolved ones on a wide one. */
    function listContent(): HTMLElement {
        const box = make("div", "quire-notes-list");
        const head = make("div", "quire-notes-head");
        const all = inOrder(doc(), spans);
        const open = all.filter((each) => !each.resolved);
        head.append(make("span", "quire-notes-count", open.length === 1 ? "1 open comment" : `${open.length} open comments`));
        head.append(control("Previous comment", icon("chevron"), () => go(-1), "quire-button quire-notes-back"), control("Next comment", icon("chevron"), () => go(1), "quire-button quire-notes-on"));
        box.append(head);
        if (draft && !roomy()) box.append(draft.card);
        for (const comment of all) box.append(card(comment, true));
        if (all.length === 0 && !draft) box.append(make("p", "quire-notes-empty", "No comments yet. Select some words and choose Insert, Comment."));
        if (!doc().quire) box.append(make("p", "quire-notes-where", "A Markdown file cannot hold comments, so these are kept in this browser only."));
        return box;
    }
    let listFrom: HTMLElement | undefined;
    function showList(from: HTMLElement) {
        listFrom = from;
        list.open(from, listContent(), false);
    }

    /** Draws everything again from the document: the marks, the margin and the list if it is open. */
    function redraw() {
        spans = spansOf(doc());
        if (current && !comments().some((each) => each.id === current)) current = undefined;
        markText();
        drawMargin();
        if (list.isOpen() && listFrom) list.open(listFrom, listContent(), false);
    }

    /** Looks at a note: its card is lit and its words marked more strongly; `go` takes the cursor and the page to them. */
    function look(id: string, go: boolean) {
        current = id;
        const span = spans.get(id)?.[0];
        if (go && span) {
            surface.setSelection(caret(span.path, span.from));
            surface.elementAt(span.path)?.scrollIntoView({ block: "center", behavior: still() ? "auto" : "smooth" });
        }
        markText();
        for (const element of document.querySelectorAll<HTMLElement>(".quire-note")) element.classList.toggle("now", element.dataset.id === id);
    }

    function go(by: 1 | -1) {
        const id = nextComment(doc(), current, by, spans);
        if (id) look(id, true);
    }

    // ---- keeping a Markdown file's notes in this browser ----
    let saving: ReturnType<typeof setTimeout> | undefined;
    // the document and its place as they were when the notes changed: written to that place even if another is open by the time it is written
    let waiting: { now: Document; place: string | undefined } | undefined;
    function keepInBrowser() {
        clearTimeout(saving);
        if (!waiting) return;
        const { now, place } = waiting;
        waiting = undefined;
        if (now.quire || !place) return;
        try {
            if (now.comments?.length) localStorage.setItem(KEY + place, JSON.stringify(notesData(now)));
            else localStorage.removeItem(KEY + place);
        } catch {
            // a browser that keeps nothing still shows the notes for this visit
        }
    }

    let drawing = 0;
    const stop = [
        surface.on("change", ({ doc: now }) => {
            if (!now.comments?.length && !spans.size && !draft && !cards.childElementCount) return;
            // the blocks drawn again have new text nodes, so the marks are put on them once the frame is drawn
            cancelAnimationFrame(drawing);
            drawing = requestAnimationFrame(redraw);
            clearTimeout(saving);
            waiting = { now, place: options.place() };
            saving = setTimeout(keepInBrowser, 400);
        }),
        surface.on("select", ({ selection }) => {
            if (!comments().length) return;
            const id = commentAt(doc(), selection.focus, spans);
            if (id !== current && id) look(id, false);
        }),
    ];
    const relayout = () => comments().length && drawMargin();
    addEventListener("resize", relayout);
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(relayout) : undefined;
    watcher?.observe(surface.element);

    return {
        element: margin,
        /** Starts a note on the selected words, or the word at the cursor, in the margin or in the list. */
        add(from: HTMLElement) {
            const selection = surface.getSelection();
            const range = collapsed(selection) ? wordAt(doc(), selection.focus) : rangeOf(selection);
            if (range.start.offset === range.end.offset && range.start.path.join() === range.end.path.join()) return false;
            const cancel = () => {
                draft = undefined;
                redraw();
                surface.focus();
            };
            const element = make("article", "quire-note quire-note-draft arriving");
            element.dataset.id = "draft";
            element.append(
                field(
                    "",
                    (text) => {
                        if (!text || !draft) return cancel();
                        const kept = draft.range;
                        draft = undefined;
                        let made: string | undefined;
                        surface.run((now) => {
                            const added = addComment(now, kept, text);
                            made = added.id;
                            return added.doc;
                        });
                        redraw();
                        if (made) look(made, false);
                        surface.focus();
                    },
                    cancel,
                ),
            );
            draft = { range, card: element };
            redraw();
            if (!roomy()) showList(from);
            // the field is brought into sight, as words selected low on the page put it below the window
            else requestAnimationFrame(() => element.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" }));
            return true;
        },
        /** Goes to the next (1) or previous (-1) open note. */
        next: go,
        /** Opens the list of every note from a control. */
        list: showList,
        /** True while the comments are shown: in the margin where it has room. */
        shown: () => !hidden,
        /** Shows the comments or puts them out of sight; shown, the list of every one, resolved ones too, opens from `from`. */
        show(on: boolean, from: HTMLElement) {
            hidden = !on;
            try {
                localStorage.setItem(HIDDEN, on ? "shown" : "hidden");
            } catch {
                // kept for this visit only
            }
            redraw();
            if (on) showList(from);
            else list.close(false);
        },
        /** True when the notes have room in the margin. */
        roomy,
        /** Writes now a Markdown file's notes waiting to be kept in this browser: before the document is left, renamed or the page closed. */
        keep: keepInBrowser,
        /** Called when a document has been opened: nothing is looked at or being written yet. */
        opened() {
            current = undefined;
            draft = undefined;
            editing = undefined;
            redraw();
        },
        destroy() {
            for (const each of stop) each();
            removeEventListener("resize", relayout);
            watcher?.disconnect();
            highlights?.delete(MARKS.all);
            highlights?.delete(MARKS.now);
            list.box.remove();
            margin.remove();
        },
    };
}
