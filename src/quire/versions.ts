// Version history: snapshots of a document, one when it is opened and one after each
// minute's pause in editing, at most fifty kept and thinned so that older ones are sparser. Each
// knows how many lines it added and removed since the one before. A panel lists them by time,
// shows a chosen one as it read, and restores it as a new step that can be undone.
//
// A snapshot is text: the Markdown, and for a `.quire` document its style.json and notes.json
// after it (snapshotText), so that restoring an old version brings back its typeface, highlight
// and spacing too. The lines added and removed are counted in the Markdown alone.
//
// The snapshots are kept through VersionStorage: in the browser's own database for every store
// (tableVersions in store-browser.ts), or in memory (memoryStorage). Thinning, the summary of
// changes and when snapshots are taken are pure and tested; the panel is DOM.

import { type Document } from "./document";
import { opened, type Parts } from "./quire-file";
import { createSurface, type Surface } from "./surface";
import { filledButton } from "./dialog";
import { control, icon, make } from "./ui";

/** What is known of a snapshot without its text. */
export interface VersionInfo {
    id: string;
    time: number;
    added: number;
    removed: number;
    /** True for the snapshot taken when the document was opened. */
    opened?: boolean;
}

/** Where snapshots are kept, by document name. `list` gives the newest first. */
export interface VersionStorage {
    save(name: string, text: string, info: Omit<VersionInfo, "id">): Promise<VersionInfo>;
    list(name: string): Promise<VersionInfo[]>;
    load(id: string): Promise<string>;
    remove(id: string): Promise<void>;
}

/** The most snapshots kept for one document. */
export const KEPT = 50;

// ---- what changed ----

/** How many lines were added and removed between two texts, counted by the longest run of lines they share. */
export function changes(before: string, after: string): { added: number; removed: number } {
    // a final newline ends the last line rather than starting another
    const lines = (text: string) => (text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/));
    const old = lines(before);
    const now = lines(after);
    let start = 0;
    while (start < old.length && start < now.length && old[start] === now[start]) start++;
    let end = 0;
    while (end < old.length - start && end < now.length - start && old[old.length - 1 - end] === now[now.length - 1 - end]) end++;
    const a = old.slice(start, old.length - end);
    const b = now.slice(start, now.length - end);
    // past a few million cells the count is not worth the wait: everything between is said to have changed
    if (a.length * b.length > 4_000_000) return { added: b.length, removed: a.length };
    let row = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        const next = new Array<number>(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j++) next[j] = a[i - 1] === b[j - 1] ? row[j - 1]! + 1 : Math.max(row[j]!, next[j - 1]!);
        row = next;
    }
    const shared = row[b.length]!;
    return { added: b.length - shared, removed: a.length - shared };
}

// ---- what a snapshot holds ----

/** What divides a snapshot's Markdown from the parts of a `.quire` document after it. A NUL is never in Markdown that is written. */
const PARTS_MARK = "\n\u0000quire parts\n";

/** A snapshot's text: the Markdown alone, or with a `.quire` document's parts after it. */
export function snapshotText(markdown: string, parts?: Parts): string {
    return parts ? `${markdown}${PARTS_MARK}${JSON.stringify(parts)}` : markdown;
}

/** A snapshot taken apart again: its Markdown and, if it was a `.quire` document's, its parts. A snapshot from before parts were kept is Markdown alone. */
export function snapshotParts(saved: string): { markdown: string; parts?: Parts } {
    const at = saved.indexOf(PARTS_MARK);
    if (at < 0) return { markdown: saved };
    try {
        const parts = JSON.parse(saved.slice(at + PARTS_MARK.length)) as Partial<Parts>;
        return { markdown: saved.slice(0, at), parts: { style: typeof parts.style === "string" ? parts.style : "", notes: typeof parts.notes === "string" ? parts.notes : "" } };
    } catch {
        return { markdown: saved.slice(0, at) };
    }
}

/** The document a snapshot holds, read as the editor opens a document; a Markdown snapshot of a `.quire` document keeps the page it is restored into. */
export function snapshotDocument(saved: string, into: Document): Document {
    const { markdown, parts } = snapshotParts(saved);
    if (parts) return opened(markdown, parts);
    const doc = opened(markdown, undefined, { mdx: into.mdx });
    return into.quire ? { ...doc, quire: into.quire } : doc;
}

/** Which of a version's top blocks are new since the one before it: those whose Markdown the one before does not have (as many times). */
export function addedBlocks(before: Document | undefined, after: Document): number[] {
    const markdown = (block: Document["blocks"][number]) => (block.source ?? JSON.stringify({ ...block, gap: "" })).trim();
    const left = new Map<string, number>();
    for (const block of before?.blocks ?? []) left.set(markdown(block), (left.get(markdown(block)) ?? 0) + 1);
    const added: number[] = [];
    after.blocks.forEach((block, index) => {
        const had = left.get(markdown(block)) ?? 0;
        if (had > 0) left.set(markdown(block), had - 1);
        else if (markdown(block)) added.push(index);
    });
    return added;
}

// ---- thinning ----

/**
 * Which snapshots to let go, given all of them, so that at most `kept` remain and older ones are
 * further apart: each is kept only if it is far enough from the newer one kept before it, and how
 * far is enough grows with its age. The newest and the oldest are always kept.
 */
export function thin(versions: { id: string; time: number }[], now: number, kept = KEPT): string[] {
    const newest = [...versions].sort((a, b) => b.time - a.time);
    if (newest.length <= 2) return [];
    let spacing = 30;
    for (;;) {
        const keep = [newest[0]!];
        for (const version of newest.slice(1, -1)) {
            const age = now - version.time;
            if (keep[keep.length - 1]!.time - version.time >= age / spacing) keep.push(version);
        }
        keep.push(newest[newest.length - 1]!);
        if (keep.length <= kept) return newest.filter((version) => !keep.includes(version)).map((version) => version.id);
        spacing /= 1.5;
    }
}

// ---- storage ----

/** Snapshots kept in memory, for as long as the page is open. */
export function memoryStorage(): VersionStorage {
    const all = new Map<string, { name: string; text: string; info: VersionInfo }>();
    let count = 0;
    return {
        async save(name, text, info) {
            const saved: VersionInfo = { ...info, id: `${name}:${++count}:${info.time}` };
            all.set(saved.id, { name, text, info: saved });
            return saved;
        },
        async list(name) {
            return [...all.values()].filter((each) => each.name === name).map((each) => each.info).sort((a, b) => b.time - a.time);
        },
        async load(id) {
            return all.get(id)?.text ?? "";
        },
        async remove(id) {
            all.delete(id);
        },
    };
}

/** Moves a document's snapshots to the name it has after a rename, so that its history follows it. */
export async function moveVersions(storage: VersionStorage, from: string, to: string) {
    if (from === to) return;
    for (const version of await storage.list(from)) {
        const { id, ...info } = version;
        await storage.save(to, await storage.load(id), info);
        await storage.remove(id);
    }
}

// ---- taking snapshots ----

/** Takes the snapshots for one document: when it is opened, and after each pause in editing. Time and waiting are passed in, so it can be tested. */
export function createKeeper(
    storage: VersionStorage,
    name: string,
    text: () => string,
    options: { pause?: number; now?: () => number; wait?: (run: () => void, ms: number) => () => void } = {},
) {
    const pause = options.pause ?? 60_000;
    const now = options.now ?? Date.now;
    const wait =
        options.wait ??
        ((run: () => void, ms: number) => {
            const timer = setTimeout(run, ms);
            return () => clearTimeout(timer);
        });
    let last: string | undefined;
    let cancel: (() => void) | undefined;
    let busy: Promise<unknown> = Promise.resolve();
    // once stopped, for a document that was left, no snapshot is taken: `text` reads whatever is shown now
    let stopped = false;

    /** Takes snapshots one after another; one that fails (no more room) does not stop those after it, nor the history panel waiting on them. */
    const queue = (run: () => Promise<VersionInfo | undefined>) => (busy = busy.then(run).catch(() => undefined));

    async function snapshot(opened = false): Promise<VersionInfo | undefined> {
        if (stopped) return undefined;
        const current = text();
        if (last === undefined) {
            const newest = (await storage.list(name))[0];
            last = newest ? await storage.load(newest.id) : undefined;
        }
        // the same text as the last one kept is not kept again, even on opening; nor is an empty page with nothing before it
        if (current === last || (current === "" && last === undefined)) return undefined;
        const counted = changes(snapshotParts(last ?? "").markdown, snapshotParts(current).markdown);
        const saved = await storage.save(name, current, { time: now(), ...counted, ...(opened ? { opened: true } : {}) });
        last = current;
        for (const id of thin(await storage.list(name), now())) await storage.remove(id);
        return saved;
    }

    return {
        /** Takes the snapshot for the document as opened, unless it is the same as the last one kept. */
        opened: () => queue(() => snapshot(true)),
        /** Says the document was changed: a snapshot follows once editing has paused. */
        edited() {
            if (stopped) return;
            cancel?.();
            cancel = wait(() => {
                cancel = undefined;
                queue(() => snapshot());
            }, pause);
        },
        /** Takes a snapshot now, if anything changed. */
        now: () => queue(() => snapshot()),
        /** Resolves once every snapshot asked for is kept. */
        settled: () => busy,
        stop() {
            stopped = true;
            cancel?.();
            cancel = undefined;
        },
    };
}

// ---- the panel ----

/** How a snapshot's time reads: the hour today, the day and hour before that. */
export function when(time: number, now: number): string {
    const date = new Date(time);
    const hour = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const today = new Date(now);
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(date, today)) return `Today, ${hour}`;
    const yesterday = new Date(now - 86_400_000);
    if (sameDay(date, yesterday)) return `Yesterday, ${hour}`;
    // the month first, as the site writes dates
    const day = date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
    return `${day}, ${hour}`;
}

/** Builds the history panel for a surface. */
export function createHistoryPanel(surface: Surface, storage: VersionStorage, name: () => string, keeper: ReturnType<typeof createKeeper>) {
    const panel = make("aside", "quire-history");
    panel.setAttribute("aria-label", "Version history");
    panel.inert = true;
    const head = make("div", "quire-history-head");
    const title = make("span", "quire-outline-title", "Version history");
    const back = control("Back to the list", icon("chevron"), () => showList());
    back.classList.add("quire-history-back");
    const closer = control("Close", icon("close"), () => close());
    head.append(back, title, closer);
    const views = make("div", "quire-history-views");
    const list = make("ol", "quire-history-list");
    const preview = make("div", "quire-history-preview");
    views.append(list, preview);
    panel.append(head, views);
    document.body.append(panel);

    async function fill() {
        await keeper.settled();
        const versions = await storage.list(name());
        const now = Date.now();
        list.replaceChildren(
            ...versions.map((version, index) => {
                const item = make("li");
                item.style.setProperty("--line-at", String(Math.min(index, 12)));
                const open = make("button", "quire-history-item");
                open.type = "button";
                open.append(make("span", "quire-history-time", when(version.time, now)));
                const summary = make("span", "quire-history-summary");
                if (version.opened) summary.append(make("span", "quire-history-opened", "opened"));
                summary.append(make("span", "quire-added", `+${version.added}`), make("span", "quire-removed", `−${version.removed}`));
                open.append(summary);
                open.setAttribute("aria-label", `${when(version.time, now)}: ${version.added} lines added, ${version.removed} removed${version.opened ? ", as opened" : ""}`);
                open.addEventListener("click", () => showVersion(version, versions[index + 1]));
                item.append(open);
                return item;
            }),
        );
        if (!versions.length) list.append(make("li", "quire-history-none", "Nothing kept yet."));
    }

    async function showVersion(version: VersionInfo, older?: VersionInfo) {
        const text = await storage.load(version.id);
        const before = older ? snapshotDocument(await storage.load(older.id), surface.getDocument()) : undefined;
        const shown = make("div", "quire-history-text prose");
        // the version as it read, styling and all, drawn as the editor draws it, and not editable; what it added since the one before is tinted
        const doc = snapshotDocument(text, surface.getDocument());
        const view = createSurface(shown, doc);
        for (const index of addedBlocks(before, doc)) view.elementAt([index])?.classList.add("quire-history-added");
        view.destroy();
        shown.removeAttribute("role");
        const restore = filledButton("Restore this version", () => {
            surface.run(() => snapshotDocument(text, surface.getDocument()));
            keeper.now();
            close();
            surface.focus();
        }, "quire-dialog-action quire-restore");
        const head = make("div", "quire-history-chosen");
        head.append(make("p", "quire-history-when", when(version.time, Date.now())), restore);
        preview.replaceChildren(head, shown);
        panel.classList.add("previewing");
        restore.focus({ preventScroll: true });
    }

    function showList() {
        panel.classList.remove("previewing");
        list.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }

    // Escape steps back one level, as everywhere: from a version shown to the list, and from the list out of the panel
    const keys = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (panel.classList.contains("previewing")) showList();
        else close();
    };
    const outside = (event: PointerEvent) => {
        if (!panel.contains(event.target as Node)) close();
    };

    async function open() {
        await keeper.now();
        await fill();
        panel.classList.remove("previewing");
        panel.classList.add("open");
        panel.inert = false;
        document.addEventListener("keydown", keys);
        setTimeout(() => document.addEventListener("pointerdown", outside, true));
        (list.querySelector<HTMLElement>("button") ?? closer).focus({ preventScroll: true });
    }

    function close() {
        // focus that was in the panel goes back to the text rather than nowhere
        if (panel.contains(document.activeElement)) surface.focus();
        panel.classList.remove("open");
        panel.inert = true;
        document.removeEventListener("keydown", keys);
        document.removeEventListener("pointerdown", outside, true);
    }

    return { element: panel, open, close, isOpen: () => panel.classList.contains("open") };
}
