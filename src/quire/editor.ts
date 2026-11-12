// The whole editor: the bar, the writing column with the surface in it, and everything around it,
// put together on one element, writing to one document in one store at a time. The page that shows
// mdQuire calls createEditor and nothing else.
//
//   const editor = createEditor(element, read(text), { name, store, id, mark, versions, colors });
//   editor.surface              the editing surface (surface.ts)
//   editor.open(store, entry)   leaves the document (saving what is waiting) and opens another
//   editor.create(store, name)  makes a new document there and opens it
//   editor.flush()              saves now what is waiting
//   editor.getName(), editor.current(), editor.destroy()
//
// Without a store the editor writes nowhere, as in the tests of its parts.

import { createBar, link as linkAction, linkAt } from "./bar";
import { createConflict } from "./conflict";
import { type Document } from "./document";
import { collapsed } from "./keys";
import { createMarkdownView } from "./markdown-view";
import { createOutline } from "./outline";
import { read } from "./read";
import { createSelectBar } from "./select-bar";
import { createSlash } from "./slash";
import { createSaver, said, type Entry, type Status, type Store } from "./store";
import { createSurface, type Surface } from "./surface";
import { createTableTools } from "./tables";
import { flowMenu, linkForm, make, type MenuItem } from "./ui";
import { changes, createHistoryPanel, createKeeper, memoryStorage, type VersionStorage } from "./versions";
import { write } from "./write";

/** What the editor is given by the page. */
export interface EditorOptions {
    /** The document's name, shown in the bar and used for downloads. */
    name: string;
    /** Where the document lives, its id there and the mark of the version opened. Without a store it is saved nowhere. */
    store?: Store;
    id?: string;
    mark?: string;
    /** Where version history is kept, for every store; in memory if not given. */
    versions?: VersionStorage;
    /** The colors offered for text. */
    colors?: { name: string; value: string }[];
    onRename?: (name: string) => void;
    /** Told whenever the editor moves to another document, so the page can remember it. */
    onOpen?: (store: Store, entry: Entry) => void;
    /** Opens the documents list from the name in the bar. */
    onName?: (from: HTMLElement) => void;
    /** More lines for the three-dot menu, from the page. */
    more?: () => MenuItem[];
    /** Takes a picture file when there is no store to keep it. */
    onImage?: (file: File) => Promise<string>;
}

/** The editor, as the page sees it. */
export interface Editor {
    surface: Surface;
    getName(): string;
    current(): { store?: Store; id?: string; name: string };
    open(store: Store, entry: Entry): Promise<void>;
    create(store: Store, name: string, text?: string): Promise<void>;
    flush(): Promise<void>;
    status(): Status | undefined;
    /** The bar's name, from which the documents list grows. */
    nameElement(): HTMLElement;
    /** Renames the document where it lives. */
    rename(name: string): Promise<void>;
    /** Shows or hides the outline and the Markdown; `plain` shows the text alone, for a file that is not Markdown. */
    view(options: { outline?: boolean; markdown?: boolean; plain?: boolean }): void;
    destroy(): void;
}

/** A status in a word or two for the bar. */
const short = (status: Status, note?: string) => (status.state === "saved" ? (note ? "Download" : "Saved") : status.state === "saving" ? "Saving" : status.state === "waiting" ? "Not saved" : status.state === "changed" ? "Changed" : "Not saved");

/** Builds the editor on an element. */
export function createEditor(host: HTMLElement, doc: Document, options: EditorOptions): Editor {
    host.classList.add("quire-editor");
    let name = options.name;
    let store = options.store;
    let id = options.id;
    const versions = options.versions ?? memoryStorage();
    const column = make("div", "quire-column");
    const paper = make("div", "quire-paper");
    const text = make("div", "prose");
    text.setAttribute("aria-label", "Document");
    paper.append(text);
    host.append(column);

    // pictures are kept by the document's store, beside the document
    const keepPicture = async (file: File) => {
        if (store && id) {
            try {
                if (!store.can.pictures) throw new Error("pictures cannot be kept here");
                return await store.savePicture(id, file, file.name || "picture.png");
            } catch (error) {
                const why = error instanceof Error ? error.message : String(error);
                bar.setStatus("No picture", `The picture was not added: ${why}`, "warn");
                throw error;
            }
        }
        if (options.onImage) return options.onImage(file);
        return URL.createObjectURL(file);
    };
    const surface = createSurface(text, doc, { onImage: keepPicture, picture: async (address) => (store && id && store.show ? store.show(id, address) : undefined) });

    // ---- the link field, from the bar's button or Ctrl+K ----
    const links = flowMenu("Link");
    const openLink = (from: HTMLElement) => {
        if (links.isOpen()) return links.close(true);
        const selection = surface.getSelection();
        const current = linkAt(surface.getDocument(), collapsed(selection) ? selection.focus : selection.anchor);
        const finish = () => {
            links.close(false);
            surface.focus();
        };
        const form = linkForm(current?.href, {
            set: (href) => {
                surface.run((d) => linkAction(href)({ doc: d, selection }).doc);
                finish();
            },
            remove: () => {
                surface.run((d) => linkAction(null)({ doc: d, selection }).doc);
                finish();
            },
            cancel: finish,
        });
        links.open(from, form);
        form.querySelector("input")?.focus({ preventScroll: true });
    };

    // ---- the three-dot menu ----
    const download = () => {
        const written = write(surface.getDocument());
        const file = new Blob([written], { type: "text/markdown" });
        const anchor = make("a");
        anchor.href = URL.createObjectURL(file);
        const ending = surface.getDocument().mdx ? ".mdx" : ".md";
        anchor.download = /\.(md|mdx|markdown|txt)$/i.test(name) ? name : `${name}${ending}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    };
    const more = (): MenuItem[] => [
        { label: host.classList.contains("markdown") ? "Hide the Markdown" : "Show the Markdown", run: () => showMarkdown(!host.classList.contains("markdown")) },
        { label: "Version history", run: () => void history.open() },
        { label: outlineView.isOpen() ? "Hide the outline" : "Show the outline", run: () => (outlineView.isOpen() ? outlineView.close() : outlineView.open()) },
        ...(options.more?.() ?? []),
        { label: "Download", hint: surface.getDocument().mdx ? ".mdx" : ".md", run: download },
        { label: "Print", run: () => print() },
    ];

    const bar = createBar(surface, {
        name,
        colors: options.colors,
        onImage: keepPicture,
        onName: (from) => options.onName?.(from),
        onLink: openLink,
        more,
    });
    // the rich view and the Markdown, side by side when there is room and one in place of the other when not
    const markdown = createMarkdownView(surface);
    const panes = make("div", "quire-panes");
    panes.append(paper, markdown.element);
    const showMarkdown = (shown: boolean) => {
        host.classList.toggle("markdown", shown);
        markdown.element.inert = !shown;
        markdown.refresh();
        // on a narrow screen the Markdown takes the text's place, so focus goes with it
        if (getComputedStyle(paper).visibility === "hidden" || (shown && matchMedia("(max-width: 60rem)").matches)) (shown ? markdown.element : surface.element).focus({ preventScroll: true });
    };
    markdown.element.inert = true;
    column.append(bar.element, panes);
    surface.on("link", () => openLink(bar.element.querySelector<HTMLElement>('[aria-label^="Link"]')!));
    const selectBar = createSelectBar(surface, () => bar.element.getBoundingClientRect().bottom);
    const outlineView = createOutline(surface, () => bar.element.getBoundingClientRect().bottom);
    host.prepend(outlineView.element);
    const slash = createSlash(surface, bar.pickImage);
    const tableTools = createTableTools(surface);

    // ---- version history: a snapshot on opening and after each pause in editing, kept by store and document ----
    const historyKey = () => (store && id ? `${store.label}:${id}` : name);
    let keeper = createKeeper(versions, historyKey(), () => write(surface.getDocument()));
    void keeper.opened();
    const history = createHistoryPanel(surface, versions, historyKey, {
        opened: () => keeper.opened(),
        edited: () => keeper.edited(),
        now: () => keeper.now(),
        settled: () => keeper.settled(),
        stop: () => keeper.stop(),
    });

    // ---- saving as you type, and what to do when the document changed elsewhere ----
    let saver = store && id ? createSaver(store, id, options.mark ?? "") : undefined;
    let quiet = false;
    const conflict = createConflict(async (choice) => {
        if (!saver) return;
        if (choice === "mine") return void (await saver.choose("mine"));
        // what was typed here is kept in the version history before theirs takes its place
        const mine = saver.unsaved() ?? write(surface.getDocument());
        const theirs = await saver.choose("theirs");
        if (!theirs) return;
        await versions.save(historyKey(), mine, { time: Date.now(), ...changes(theirs.text, mine) });
        quiet = true;
        surface.run(() => read(theirs.text, { mdx: surface.getDocument().mdx }));
        quiet = false;
    }, () => surface.focus());
    const showStatus = (status: Status) => {
        bar.setStatus(short(status, store?.note), said(status, store?.note), status.state === "changed" || status.state === "failed" ? "warn" : "quiet");
        if (status.state === "changed" && saver) conflict.open(saver.unsaved() ?? write(surface.getDocument()), status.theirs?.text);
    };
    let stopListening = saver?.on(showStatus);
    if (saver) showStatus(saver.status());
    else bar.setStatus("", "This document is not being saved anywhere");

    surface.on("change", ({ doc: now }) => {
        keeper.edited();
        if (!quiet) saver?.changed(() => write(now));
    });

    // leaving the page with words not yet saved: they are saved if there is time, and the browser asks
    const leaving = (event: BeforeUnloadEvent) => {
        if (!saver?.unsaved()) return;
        void saver.flush();
        event.preventDefault();
    };
    addEventListener("beforeunload", leaving);

    async function rename(value: string) {
        if (!store || !id || !store.can.rename) {
            name = value;
            bar.setName(value);
            options.onRename?.(value);
            return;
        }
        await saver?.flush();
        try {
            id = await store.rename(id, value);
            name = (await store.list().catch(() => [])).find((entry) => entry.id === id)?.name ?? value;
            bar.setName(name);
            options.onRename?.(value);
            options.onOpen?.(store, { id, name });
        } catch (error) {
            bar.setName(name);
            bar.setStatus("Not renamed", `Not renamed: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
    }

    /** Moves to a document: saves what is waiting in the old one, opens the new, and starts its saver and history. */
    async function open(next: Store, entry: Entry) {
        await saver?.flush();
        saver?.stop();
        stopListening?.();
        keeper.stop();
        const opened = await next.open(entry.id);
        store = next;
        id = entry.id;
        name = entry.name;
        bar.setName(name);
        quiet = true;
        surface.setDocument(read(opened.text, { mdx: /\.mdx$/i.test(entry.id) || /\.mdx$/i.test(entry.name) }));
        quiet = false;
        saver = createSaver(next, entry.id, opened.mark);
        stopListening = saver.on(showStatus);
        showStatus(saver.status());
        keeper = createKeeper(versions, historyKey(), () => write(surface.getDocument()));
        void keeper.opened();
        options.onOpen?.(next, entry);
    }

    return {
        surface,
        getName: () => name,
        current: () => ({ store, id, name }),
        open,
        async create(next, wanted, body = "") {
            const made = await next.create(wanted, body);
            const entry = (await next.list().catch(() => [])).find((each) => each.id === made.id) ?? { id: made.id, name: wanted };
            await open(next, entry);
        },
        flush: async () => {
            await saver?.flush();
        },
        status: () => saver?.status(),
        nameElement: () => bar.name,
        rename,
        view({ outline, markdown: shown, plain }) {
            if (outline !== undefined) (outline ? outlineView.open() : outlineView.close());
            if (plain !== undefined) host.classList.toggle("plain", plain);
            if (shown !== undefined || plain) showMarkdown(plain || !!shown);
        },
        destroy() {
            surface.destroy();
            for (const menu of [...bar.menus, links]) menu.box.remove();
            selectBar.element.remove();
            slash.close();
            tableTools.element.remove();
            keeper.stop();
            saver?.stop();
            history.element.remove();
            conflict.element.remove();
            removeEventListener("beforeunload", leaving);
            host.replaceChildren();
        },
    };
}
