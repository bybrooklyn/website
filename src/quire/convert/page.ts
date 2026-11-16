// The converter's page (/convert/): files in, files out, everything in this browser. The list of files
// is the work: each a quiet row of its name, what it is, what it will become, its size before and
// after, and how it is going, with a bar that fills only as steps are done. The choices for each kind
// (pictures, text and data, sounds, films) have their own room beside the list (under it on a phone),
// never over it. Files arrive by a drop, a paste, Choose files, or Paste in the list's right-click menu
// (Shift leaves the browser's own), and on a phone a Paste button; text pasted becomes a file of its
// own. Convert runs every file not yet done, a few at a time; each can be stopped, saved alone, or
// tried again. Many leave as one zip or, where the browser allows it, straight into a folder, each
// under its own name with the new ending, a second of one name numbered, nothing overwritten. Rows
// arrive and leave by growing and shrinking; reduced motion turns the motion off.
//
//   createConvertPage(host, [pictureSide(engine), textSide(markdown), audioSide(), videoSide()]);

import { flowMenu, make, RULE, type MenuItem } from "../core/ui";
import { kindOf, type Found, type Kind } from "./kinds";
import { changeSaid, outName, sizeSaid } from "./names";
import { download, foldersAllowed, intoFolder, pickFolder, zipOf } from "./out";
import { Offered, type Item, type Made, type Side } from "./parts";
import { createQueue, type Job } from "./queue";

/** The words of the page a visitor reads first, and of its buttons. */
export const WORDS = {
    empty: "Drop files here, paste them, or choose them: pictures, text and data, sounds and films. Nothing leaves your browser.",
    choose: "Choose files",
    paste: "Paste",
    convert: "Convert",
    stop: "Stop all",
    zip: "Save all as a zip",
    folder: "Save all into a folder",
    clear: "Clear the list",
    noFolder: "This browser cannot write into a folder, so many files leave as one zip.",
};

/** Where a file in the list is. */
export type RowState = "ready" | "waiting" | "running" | "done" | "stopped" | "failed" | "cannot";

/** The words for where a file is, when nothing more is said. */
export const STATE_WORDS: Record<RowState, string> = {
    ready: "Ready",
    waiting: "Waiting",
    running: "Working",
    done: "Done",
    stopped: "Stopped",
    failed: "Not converted",
    cannot: "Cannot convert",
};

/** The lines of the list's right-click menu: for a file, what can be done with it; then Paste and Choose files. */
export function menuLines(row: { state: RowState; text: boolean } | undefined, run: { save(): void; copy(): void; stop(): void; again(): void; remove(): void; paste(): void; choose(): void }): MenuItem[] {
    const always: MenuItem[] = [
        { label: "Paste", icon: "paste", hint: "Ctrl+V", key: "paste", run: run.paste },
        { label: WORDS.choose, icon: "file", hint: "Ctrl+O", key: "choose", run: run.choose },
    ];
    if (!row) return always;
    const lines: MenuItem[] = [];
    if (row.state === "done") lines.push({ label: "Save", icon: "download", key: "save", run: run.save });
    if (row.state === "done" && row.text) lines.push({ label: "Copy", icon: "copy", key: "copy", run: run.copy });
    if (row.state === "waiting" || row.state === "running") lines.push({ label: "Stop", icon: "close", key: "stop", run: run.stop });
    if (row.state === "done" || row.state === "stopped" || row.state === "failed") lines.push({ label: row.state === "done" ? "Convert again" : "Try again", icon: "redo", key: "again", run: run.again });
    lines.push({ label: "Remove", icon: "trash", hint: "Delete", key: "remove", run: run.remove });
    return [...lines, RULE, ...always];
}

/** The line under the list: how many files, how many done, and what they weigh before and after. */
export function summaryOf(rows: { state: RowState; before: number; after?: number }[]): string {
    if (!rows.length) return "";
    const done = rows.filter((row) => row.state === "done");
    const parts = [`${rows.length} ${rows.length === 1 ? "file" : "files"}`];
    if (done.length) {
        parts.push(`${done.length} done`);
        const before = done.reduce((sum, row) => sum + row.before, 0);
        const after = done.reduce((sum, row) => sum + (row.after ?? 0), 0);
        parts.push(`${sizeSaid(before)} to ${sizeSaid(after)}`);
    }
    const working = rows.filter((row) => row.state === "running" || row.state === "waiting").length;
    if (working) parts.push(`${working} working`);
    return parts.join(" · ");
}

/** One file in the list. */
interface Row {
    id: number;
    item: Item;
    state: RowState;
    element: HTMLLIElement;
    what: HTMLElement;
    becomes: HTMLElement;
    sizes: HTMLElement;
    status: HTMLElement;
    bar: HTMLElement;
    notes: HTMLElement;
    main: HTMLButtonElement;
    copy: HTMLButtonElement;
    job?: Job;
    made?: Made & { name: string };
    /** The name its result will leave with, kept for it from when it was put in the queue, so that names follow the list's order. */
    named?: string;
    share: number;
}

/** Builds the page on its host, with a side of the panel for each kind it converts. */
export function createConvertPage(host: HTMLElement, sides: Side[]) {
    const root = make("div", "quire-convert");
    const work = make("div", "quire-convert-work");
    const panel = make("div", "quire-convert-panel");
    panel.setAttribute("aria-label", "Choices");
    root.append(work, panel);
    host.append(root);

    // ---- the work: where files arrive, what can be done with them all, and the list ----
    const drop = make("div", "quire-convert-drop");
    const chooser = make("input");
    chooser.type = "file";
    chooser.multiple = true;
    chooser.hidden = true;
    const choose = make("button", "quire-convert-main", WORDS.choose);
    choose.type = "button";
    choose.title = "Choose files (Ctrl+O)";
    choose.addEventListener("click", () => chooser.click());
    const pasteButton = make("button", "quire-convert-plain quire-convert-paste", WORDS.paste);
    pasteButton.type = "button";
    pasteButton.addEventListener("click", () => void pasteFromMenu());
    const dropActions = make("div", "quire-convert-actions");
    dropActions.append(choose, pasteButton, chooser);
    drop.append(make("p", "quire-convert-empty", WORDS.empty), dropActions);

    const bar = make("div", "quire-convert-bar");
    const convertButton = make("button", "quire-convert-main", WORDS.convert);
    convertButton.type = "button";
    convertButton.title = "Convert every file not yet done (Ctrl+Enter)";
    convertButton.addEventListener("click", () => convertAll());
    const stopButton = make("button", "quire-convert-plain", WORDS.stop);
    stopButton.type = "button";
    stopButton.addEventListener("click", () => queue.stopAll());
    const zipButton = make("button", "quire-convert-plain", WORDS.zip);
    zipButton.type = "button";
    zipButton.title = "Save every file done as one zip (Ctrl+S)";
    zipButton.addEventListener("click", () => void saveZip());
    const folderButton = make("button", "quire-convert-plain", WORDS.folder);
    folderButton.type = "button";
    folderButton.title = foldersAllowed() ? "Write every file done into a folder you choose (Ctrl+Shift+S)" : WORDS.noFolder;
    if (!foldersAllowed()) {
        folderButton.setAttribute("aria-disabled", "true");
        folderButton.classList.add("cannot");
    }
    folderButton.addEventListener("click", () => void saveFolder());
    const clearButton = make("button", "quire-convert-plain", WORDS.clear);
    clearButton.type = "button";
    clearButton.addEventListener("click", () => clear());
    bar.append(convertButton, stopButton, zipButton, folderButton, clearButton);
    const summary = make("p", "quire-convert-summary");
    summary.setAttribute("aria-live", "polite");
    const said = make("p", "quire-convert-said");
    said.setAttribute("aria-live", "polite");
    const list = make("ol", "quire-convert-rows");
    list.setAttribute("aria-label", "Files");
    work.append(drop, bar, summary, said, list);
    const say = (words: string) => (said.textContent = words);

    for (const side of sides) {
        panel.append(side.element);
        side.changed = () => refresh();
    }

    // ---- the rows ----
    const rows: Row[] = [];
    const taken = new Set<string>();
    let count = 0;
    const queue = createQueue({ picture: 2, text: 2, audio: 2, video: 1 }, (job) => {
        const row = rows.find((each) => each.job === job);
        if (!row) return;
        if (job.state === "stopped" && row.state !== "done") setState(row, "stopped");
        else if (job.state === "waiting") setState(row, "waiting");
        else if (job.state === "running") setState(row, "running");
    });
    const sideOf = (row: Row) => sides.find((side) => side.kind === row.item.found.kind);

    function button(label: string, className: string, press: () => void) {
        const made = make("button", className, label);
        made.type = "button";
        made.addEventListener("click", press);
        return made;
    }

    /** Adds a file to the list, its row growing in. */
    async function add(file: Blob, name: string) {
        // the row is made at once, so that files keep the order they came in; what each is follows from its first bytes
        let found: Found = kindOf(new Uint8Array(), name, file.type);
        const item: Item = { file, name, found, options: {} };
        const element = make("li", "quire-convert-row arriving");
        const inner = make("div", "quire-convert-row-in");
        const body = make("div", "quire-convert-row-body");
        const label = make("div", "quire-convert-row-label");
        const title = make("span", "quire-convert-name", name);
        title.title = name;
        const what = make("span", "quire-convert-what", found.label);
        const becomes = make("span", "quire-convert-becomes");
        label.append(title, what, becomes);
        const sizes = make("span", "quire-convert-sizes", sizeSaid(file.size));
        const status = make("span", "quire-convert-status");
        const actions = make("div", "quire-convert-row-actions");
        const row: Row = { id: ++count, item, state: "ready", element, what, becomes, sizes, status, bar: make("i"), notes: make("div", "quire-convert-notes"), main: undefined as unknown as HTMLButtonElement, copy: undefined as unknown as HTMLButtonElement, share: 0 };
        row.main = button("", "quire-convert-small quire-convert-row-main", () => pressMain(row));
        row.copy = button("Copy", "quire-convert-small quire-convert-copy", () => void copyText(row));
        const remove = button("×", "quire-convert-small quire-convert-remove", () => removeRow(row));
        remove.title = "Remove";
        remove.setAttribute("aria-label", `Remove ${name}`);
        actions.append(row.main, row.copy, remove);
        const track = make("div", "quire-convert-track");
        track.append(row.bar);
        body.append(label, sizes, status, actions, track, row.notes);
        inner.append(body);
        element.append(inner);
        element.dataset.id = String(row.id);
        element.tabIndex = -1;
        rows.push(row);
        list.append(element);
        // the row grows from no height on the next frame, so the change is seen
        requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove("arriving")));
        row.status.textContent = "Reading";
        found = kindOf(new Uint8Array(await file.slice(0, 64).arrayBuffer()), name, file.type);
        item.found = found;
        what.textContent = found.label;
        // a closer look by the side of its kind, and by the side of another kind if the first finds it is one (a film's container holding only sound)
        for (let look = 0; look < 2; look++) {
            const side = sides.find((each) => each.kind === found.kind);
            if (!side?.identify) break;
            const better = await side.identify(item).catch(() => undefined);
            if (!better) break;
            const other = better.kind !== found.kind;
            found = better;
            item.found = better;
            what.textContent = better.label;
            if (!other) break;
        }
        setState(row, "ready");
    }

    function setState(row: Row, state: RowState, words?: string) {
        const side = sideOf(row);
        const becoming = side ? side.becomes(row.item) : { cannot: row.item.found.kind === "unknown" ? "This is not a kind of file the converter knows." : "This kind of file cannot be converted here." };
        if ("cannot" in becoming && (state === "ready" || state === "cannot")) state = "cannot";
        else if (state === "cannot") state = "ready";
        row.state = state;
        row.element.dataset.state = state;
        if (state !== "done" && state !== "stopped" && state !== "failed") row.becomes.textContent = "cannot" in becoming ? "" : `to ${becoming.label}`;
        if (state === "cannot" && "cannot" in becoming) showNotes(row, [becoming.cannot]);
        else if (state === "ready") showNotes(row, []);
        row.status.textContent = words ?? STATE_WORDS[state];
        const main = state === "waiting" || state === "running" ? "Stop" : state === "done" ? "Save" : state === "stopped" || state === "failed" ? "Try again" : "";
        row.main.textContent = main;
        row.main.classList.toggle("away", !main);
        row.main.inert = !main;
        row.copy.classList.toggle("away", !(state === "done" && row.made?.text !== undefined));
        row.copy.inert = !(state === "done" && row.made?.text !== undefined);
        if (state === "ready" || state === "waiting") setShare(row, 0);
        refreshBar();
    }

    function setShare(row: Row, share: number) {
        row.share = share;
        row.bar.style.width = `${Math.round(share * 1000) / 10}%`;
    }

    function showNotes(row: Row, notes: string[], offer?: { label: string; options: Record<string, unknown> }) {
        const lines: HTMLElement[] = notes.map((each) => make("p", "quire-convert-row-note", each));
        if (offer) {
            const take = button(offer.label, "quire-convert-small quire-convert-offer", () => {
                row.item.options = { ...row.item.options, ...offer.options };
                start(row);
            });
            lines.push(take);
        }
        row.notes.replaceChildren(...lines);
        row.notes.classList.toggle("empty", !lines.length);
    }

    function pressMain(row: Row) {
        if (row.state === "waiting" || row.state === "running") row.job?.stop();
        else if (row.state === "done") saveOne(row);
        else if (row.state === "stopped" || row.state === "failed") start(row);
    }

    /** Puts a file in the queue to be converted with the choices as they are now. */
    function start(row: Row) {
        const side = sideOf(row);
        if (!side || "cannot" in side.becomes(row.item)) return setState(row, "cannot");
        if (row.named) taken.delete(row.named.toLowerCase());
        if (row.made) {
            row.made = undefined;
            row.sizes.textContent = sizeSaid(row.item.file.size);
        }
        showNotes(row, []);
        setShare(row, 0);
        const becoming = side.becomes(row.item) as { label: string; ending: string };
        row.becomes.textContent = `to ${becoming.label}`;
        const name = outName(row.item.name, becoming.ending, taken);
        row.named = name;
        // the work may start at once, before `add` gives the job back, so the row holds it first
        let job: Job | undefined;
        job = queue.add(side.lane, async (signal) => {
            try {
                const made = await side.run(row.item, signal, (share, words) => {
                    if (signal.aborted || row.job !== job) return;
                    setShare(row, share);
                    row.status.textContent = words ? `${words}${share > 0 && share < 1 ? ` ${Math.floor(share * 100)}%` : ""}` : `${Math.floor(share * 100)}%`;
                });
                if (signal.aborted || row.job !== job) return;
                row.made = { ...made, name };
                setShare(row, 1);
                row.sizes.textContent = `${sizeSaid(row.item.file.size)} to ${sizeSaid(made.blob.size)}, ${changeSaid(row.item.file.size, made.blob.size)}`;
                if (made.facts) row.what.textContent = `${row.item.found.label}, ${made.facts}`;
                if (made.became) row.becomes.textContent = `to ${made.became}`;
                setState(row, "done");
                row.status.textContent = name;
                row.status.title = `Leaves as ${name}`;
                showNotes(row, made.notes);
            } catch (error) {
                if (signal.aborted || row.job !== job) return;
                setState(row, "failed");
                showNotes(row, [error instanceof Error ? error.message : String(error)], error instanceof Offered ? error.offer : undefined);
                throw error;
            }
        });
        row.job = job;
        setState(row, job.state === "running" ? "running" : job.state === "waiting" ? "waiting" : row.state);
    }

    function convertAll() {
        const todo = rows.filter((row) => row.state === "ready" || row.state === "stopped" || row.state === "failed");
        if (!todo.length) return say(rows.length ? "Every file is done." : "There are no files yet.");
        say("");
        for (const row of todo) start(row);
    }

    function removeRow(row: Row) {
        row.job?.stop();
        if (row.named) taken.delete(row.named.toLowerCase());
        rows.splice(rows.indexOf(row), 1);
        const element = row.element;
        element.classList.add("leaving");
        element.inert = true;
        let gone = false;
        const away = () => {
            if (gone) return;
            gone = true;
            element.remove();
        };
        element.addEventListener("transitionend", (event) => event.target === element.firstElementChild && away());
        setTimeout(away, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500);
        refreshBar();
    }

    function clear() {
        for (const row of [...rows]) removeRow(row);
        say("");
    }

    /** Every row not yet done says again what it will become, after a choice changed. */
    function refresh() {
        for (const row of rows) if (row.state === "ready" || row.state === "cannot") setState(row, row.state);
    }

    function refreshBar() {
        const done = rows.filter((row) => row.state === "done");
        const working = rows.some((row) => row.state === "running" || row.state === "waiting");
        const todo = rows.some((row) => row.state === "ready" || row.state === "stopped" || row.state === "failed");
        convertButton.disabled = !todo;
        stopButton.disabled = !working;
        zipButton.disabled = !done.length;
        folderButton.disabled = !done.length && foldersAllowed();
        clearButton.disabled = !rows.length;
        root.classList.toggle("has-files", rows.length > 0);
        summary.textContent = summaryOf(rows.map((row) => ({ state: row.state, before: row.item.file.size, after: row.made?.blob.size })));
    }

    // ---- getting results out ----
    const results = () => rows.filter((row) => row.state === "done" && row.made).map((row) => ({ name: row.made!.name, blob: row.made!.blob }));
    function saveOne(row: Row) {
        if (!row.made) return;
        download({ name: row.made.name, blob: row.made.blob });
        say(`Saved ${row.made.name}.`);
    }
    async function saveZip() {
        const all = results();
        if (!all.length) return;
        if (all.length === 1) return saveOne(rows.find((row) => row.made?.name === all[0]!.name)!);
        try {
            say(`Making the zip of ${all.length} files`);
            const zip = await zipOf(all, new Date(), (done) => say(`Making the zip, ${done} of ${all.length}`));
            download({ name: "converted.zip", blob: zip });
            say(`Saved ${all.length} files as converted.zip, ${sizeSaid(zip.size)}.`);
        } catch (error) {
            say(error instanceof Error ? error.message : String(error));
        }
    }
    async function saveFolder() {
        if (!foldersAllowed()) return say(WORDS.noFolder);
        const all = results();
        if (!all.length) return;
        const folder = await pickFolder();
        if (!folder) return;
        try {
            const written = await intoFolder(folder, all, (done) => say(`Writing ${done} of ${all.length}`));
            const renamed = written.filter((name, index) => name !== all[index]!.name).length;
            say(`Wrote ${written.length} ${written.length === 1 ? "file" : "files"} into the folder${renamed ? `, ${renamed} under a new number as the name was there already` : ""}.`);
        } catch (error) {
            say(`Not written: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async function copyText(row: Row) {
        if (row.made?.text === undefined) return;
        try {
            await navigator.clipboard.writeText(row.made.text);
            say(`Copied what ${row.made.name} holds.`);
        } catch (error) {
            say(`Not copied: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // ---- the ways in: a drop, a paste, Choose files, and Paste from the menu or the phone's button ----
    let pastedCount = 0;
    const pastedName = () => (++pastedCount === 1 ? "Pasted text" : `Pasted text ${pastedCount}`);
    const takeAll = (files: File[]) => {
        for (const file of files) void add(file, file.name || "Pasted file");
    };
    chooser.addEventListener("change", () => {
        takeAll([...(chooser.files ?? [])]);
        chooser.value = "";
    });
    const pasted = (event: ClipboardEvent) => {
        if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]"))) return;
        const files = [...(event.clipboardData?.files ?? [])];
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!files.length && !text) return;
        event.preventDefault();
        if (files.length) takeAll(files);
        else void add(new Blob([text], { type: "text/plain" }), pastedName());
    };
    document.addEventListener("paste", pasted);
    async function pasteFromMenu() {
        try {
            let any = false;
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((each) => !each.startsWith("text/"));
                if (type) {
                    const blob = await item.getType(type);
                    const ending = type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*$/, "") ?? "bin";
                    void add(blob, `Pasted ${type.split("/")[0] === "image" ? "picture" : "file"}.${ending}`);
                    any = true;
                } else if (item.types.includes("text/plain")) {
                    const text = await (await item.getType("text/plain")).text();
                    if (text) {
                        void add(new Blob([text], { type: "text/plain" }), pastedName());
                        any = true;
                    }
                }
            }
            if (!any) say("There is nothing on the clipboard to convert.");
        } catch {
            say("Press Ctrl+V to paste.");
        }
    }
    root.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((each) => each.kind === "file")) return;
        event.preventDefault();
        root.classList.add("dropping");
    });
    root.addEventListener("dragleave", (event) => {
        if (!root.contains(event.relatedTarget as Node | null)) root.classList.remove("dropping");
    });
    root.addEventListener("drop", (event) => {
        root.classList.remove("dropping");
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return;
        event.preventDefault();
        takeAll(files);
    });

    // ---- the list's right-click menu ----
    const menu = flowMenu("Files", { className: "quire-img-press-menu" });
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    function openMenu(x: number, y: number, row?: Row) {
        Object.assign(anchor.style, { left: `${x}px`, top: `${y}px`, height: "0px" });
        if (!anchor.isConnected) document.body.append(anchor);
        const lines = menuLines(row && { state: row.state, text: row.made?.text !== undefined }, {
            save: () => row && saveOne(row),
            copy: () => row && void copyText(row),
            stop: () => row?.job?.stop(),
            again: () => row && start(row),
            remove: () => row && removeRow(row),
            paste: () => void pasteFromMenu(),
            choose: () => chooser.click(),
        });
        menu.open(anchor, lines, false);
        menu.box.querySelector<HTMLElement>(".quire-menu-items")?.focus({ preventScroll: true });
    }
    work.addEventListener("contextmenu", (event) => {
        if (event.shiftKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) return;
        event.preventDefault();
        const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".quire-convert-row") : null;
        openMenu(event.clientX, event.clientY, rows.find((row) => row.element === element));
    });

    // ---- the keys ----
    const keys = (event: KeyboardEvent) => {
        const typing = event.target instanceof HTMLElement && !!event.target.closest("input, textarea");
        const command = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (command && key === "o") {
            event.preventDefault();
            return chooser.click();
        }
        if (typing) return;
        if (command && event.key === "Enter") {
            event.preventDefault();
            convertAll();
        } else if (command && key === "s") {
            event.preventDefault();
            void (event.shiftKey ? saveFolder() : saveZip());
        } else if ((event.key === "Delete" || event.key === "Backspace") && document.activeElement instanceof HTMLElement) {
            const row = rows.find((each) => each.element.contains(document.activeElement));
            if (!row) return;
            event.preventDefault();
            const next = rows[rows.indexOf(row) + 1] ?? rows[rows.indexOf(row) - 1];
            removeRow(row);
            next?.element.focus();
        } else if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && work.contains(document.activeElement)) {
            event.preventDefault();
            const row = rows.find((each) => each.element.contains(document.activeElement));
            const at = (row?.element ?? list).getBoundingClientRect();
            openMenu(at.left + 24, at.top + 16, row);
        }
    };
    document.addEventListener("keydown", keys);

    refreshBar();
    root.classList.add("ready");
    return {
        element: root,
        add,
        /** What each row holds, for tests. */
        rows: () => rows.map((row) => ({ name: row.item.name, kind: row.item.found.kind, label: row.item.found.label, state: row.state, status: row.status.textContent, made: row.made, notes: [...row.notes.children].map((each) => each.textContent) })),
        destroy() {
            queue.stopAll();
            document.removeEventListener("paste", pasted);
            document.removeEventListener("keydown", keys);
            root.remove();
            anchor.remove();
        },
    };
}

/** The kinds the page knows, in the order the panel shows them. */
export const KINDS: Kind[] = ["picture", "text", "audio", "video"];
