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

import { addCode, addDivider, addFootnote, addTable, align, aligned, createBar, link as linkAction, linkAt, setStyleOf, toggle, toggleList, type Action } from "./bar";
import { createMenuRow, headings } from "./menu-row";
import { blockPaths, countWords, lengthOf } from "./document";
import { createConflict } from "./conflict";
import { createDictation } from "./dictation/dictation";
import { type Document } from "./document";
import { collapsed, pageBreakAt } from "./keys";
import { createPages } from "./pages";
import { createMarkdownView } from "./markdown-view";
import { createOutline } from "./outline";
import { read } from "./read";
import { createSelectBar } from "./select-bar";
import { createSlash } from "./slash";
import { createSaver, fileName, said, type Entry, type Status, type Store } from "./store";
import { createSurface, type Surface } from "./surface";
import { createTableTools } from "./tables";
import { aboutPanel, control, flowMenu, linkForm, make, type MenuItem } from "./ui";
import { changes, createHistoryPanel, createKeeper, memoryStorage, snapshotParts, snapshotText, type VersionStorage } from "./versions";
import { write } from "./write";
import { emptyParts, opened, packQuire, written, type Parts } from "./quire-file";
import { PAGE } from "./styling";
import { createCaret, FLAG, FLAG_ON_PAPER } from "./caret";
import { createDetails } from "./details";
import { createFind } from "./find";
import { mountChecking } from "./check/mount";
import { createTitle, nameFor, shownName, type OwnTitle } from "./title";
import { createZoom, pageRule, percent, setPage, setupItems } from "./paper";
import type { Page } from "./document";

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
    /** The page's own lines at the head of the File menu: new documents, opening files and folders. */
    fileItems?: () => MenuItem[];
    /** More lines for the three-dot menu, from the page. */
    more?: () => MenuItem[];
    /** The page's top, with places marked for the document's name, the menu words, how saving stands and the tools (src/pages/mdquire.astro). Made above the editor if not given. */
    top?: HTMLElement;
    /** Takes a picture file when there is no store to keep it. */
    onImage?: (file: File) => Promise<string>;
    /** Where a Markdown document turned into a `.quire` one is made when its own store keeps no `.quire` documents; downloaded if not given. */
    richHome?: Store;
    /** Where the title is kept when it is the document's own (a post's frontmatter title) rather than its name. */
    title?: OwnTitle;
}

/** The editor, as the page sees it. */
export interface Editor {
    surface: Surface;
    getName(): string;
    current(): { store?: Store; id?: string; name: string };
    open(store: Store, entry: Entry): Promise<void>;
    /** Makes a new document there and opens it; given parts, it is made as a `.quire` document. */
    create(store: Store, name: string, text?: string, quire?: Parts): Promise<void>;
    flush(): Promise<void>;
    status(): Status | undefined;
    /** The bar's name, from which the documents list grows. */
    nameElement(): HTMLElement;
    /** Renames the document where it lives. */
    rename(name: string): Promise<void>;
    /** Saves what is waiting and lets the document go, so that nothing is open. */
    leave(): Promise<void>;
    /** The sheet, which grows out of a picture of it on the home screen and shrinks back. */
    paper: HTMLElement;
    /** Shows or hides the outline and the Markdown; `plain` shows the text alone, for a file that is not Markdown. */
    view(options: { outline?: boolean; markdown?: boolean; plain?: boolean }): void;
    destroy(): void;
}

/** The two looks of the writing: A, no page, on the site's ground; C, light paper on the dark desk. */
export type Look = "none" | "paper";

/** Where the look chosen is kept, for every document. */
const LOOK_KEY = "quire-look";

/** Where the outline being open or shut on a wide window is kept. */
const OUTLINE_KEY = "quire-outline";

/** True when the window has room for the outline in the margin beside the writing. */
const wide = () => typeof matchMedia !== "undefined" && matchMedia("(min-width: 64rem)").matches;

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
    const caret = createCaret(surface.element, paper, FLAG);

    // ---- the title, the first line on the sheet: the document's name ----
    let renaming = Promise.resolve();
    let typing: ReturnType<typeof setTimeout> | undefined;
    /** True when the title shown is kept in the document rather than its name. */
    const owned = () => !!options.title && options.title.read(surface.getDocument()) !== null;
    const renameTo = (typed: string) => {
        const next = nameFor(name, typed);
        if (next === name) return;
        renaming = renaming.then(() => rename(next));
    };
    const title = createTitle({
        goOn: () => {
            surface.setSelection({ anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 0 } });
            surface.focus();
        },
        typed: (value) => {
            if (owned()) {
                surface.run((now) => options.title!.write(now, value), "type");
                return;
            }
            // the bar follows as it is typed; where renaming is cheap the document is renamed a moment after
            bar.setName(nameFor(name, value));
            clearTimeout(typing);
            if (store?.renameAsTyped || !store || !id) typing = setTimeout(() => renameTo(value), 400);
        },
        settled: (value) => {
            if (owned()) return;
            clearTimeout(typing);
            renameTo(value);
        },
    });
    paper.prepend(title.element);
    /** Shows the title for the document as it is now, and its name in the margin. */
    const showTitle = () => {
        showDetails();
        const own = options.title?.read(surface.getDocument());
        if (own !== null && own !== undefined) title.show(own);
        else title.show(shownName(name) === "Untitled" ? "" : shownName(name), !options.title && (!store || !id || store.can.rename));
    };
    // ---- a faint "Type / for blocks" on the empty line the cursor is on, and on an empty document ----
    let hinted: HTMLElement | undefined;
    const hint = () => {
        const blocks = surface.getDocument().blocks;
        const focused = surface.element.contains(document.activeElement) || document.activeElement === surface.element;
        const empty = (element: HTMLElement | undefined) => !!element && element.tagName === "P" && element.textContent === "";
        const line = focused ? surface.elementAt(surface.getSelection().focus.path.slice(0, 1)) : blocks.length === 1 ? surface.elementAt([0]) : undefined;
        const next = empty(line) && surface.getSelection().anchor.path[0] === surface.getSelection().focus.path[0] ? line : undefined;
        if (next === hinted) return;
        hinted?.classList.remove("quire-hinted");
        hinted = next;
        if (!next) return;
        next.dataset.hint = "Type / for blocks";
        // the words are there first and seen a frame later, so they fade in
        requestAnimationFrame(() => next === hinted && next.classList.add("quire-hinted"));
    };
    surface.on("select", hint);
    surface.on("change", hint);
    surface.element.addEventListener("focus", hint);
    surface.element.addEventListener("blur", () => setTimeout(hint));

    // ArrowUp at the very start of the writing goes up to the title
    surface.element.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowUp" || event.shiftKey) return;
        const { anchor, focus } = surface.getSelection();
        if (focus.offset === 0 && anchor.offset === 0 && focus.path.every((step) => step === 0) && anchor.path.every((step) => step === 0)) {
            event.preventDefault();
            title.focus();
        }
    });
    const dictation = createDictation(surface);

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

    // ---- About mdQuire, from Tools and the three dots: a small panel that grows out of where it was asked for ----
    const about = flowMenu("About mdQuire", { className: "quire-about-menu" });
    const showAbout = (from: HTMLElement) => (about.isOpen() ? about.close(true) : about.open(from, aboutPanel()));

    // ---- the three-dot menu ----
    const give = (file: Blob, fileName: string) => {
        const anchor = make("a");
        anchor.href = URL.createObjectURL(file);
        anchor.download = fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    };
    /** The document's name without its folder or ending, for a download's name. */
    const stem = () => name.replace(/^.*\//, "").replace(/\.(md|mdx|markdown|txt|quire)$/i, "") || "Untitled";
    const download = () => {
        const doc = surface.getDocument();
        // a .quire document's Markdown is downloaded with its color, size and centring as small HTML, as a Markdown file keeps them
        const ending = doc.mdx ? ".mdx" : ".md";
        give(new Blob([write(doc)], { type: "text/markdown" }), /\.(md|mdx|markdown|txt)$/i.test(name) ? name.replace(/^.*\//, "") : `${stem()}${ending}`);
    };
    const downloadQuire = async () => {
        const { text: markdown, quire } = written(surface.getDocument(), write);
        const pictures = (store && id && (await store.pictures?.(id).catch(() => undefined))) || new Map<string, Blob>();
        give(new Blob([(await packQuire({ markdown, parts: quire ?? emptyParts(), pictures })) as BlobPart], { type: "application/zip" }), `${stem()}.quire`);
    };
    /** Makes a `.quire` copy of a Markdown document and opens it: in the same place if it can keep one, in the browser if not, or as a download. */
    const makeRich = async () => {
        const doc = surface.getDocument();
        if (doc.quire) return;
        const copy = written({ ...doc, mdx: false, quire: { page: PAGE, notes: null } }, write);
        const target = store?.quire && store.can.create ? store : options.richHome;
        if (!target) {
            const pictures = new Map<string, Blob>();
            give(new Blob([(await packQuire({ markdown: copy.text, parts: copy.quire ?? emptyParts(), pictures })) as BlobPart], { type: "application/zip" }), `${stem()}.quire`);
            return;
        }
        await create(target, stem(), copy.text, copy.quire);
        surface.focus();
    };
    const more = (): MenuItem[] => [
        ...(surface.getDocument().quire ? [] : [{ label: "Turn into a .quire document", icon: "file", run: () => void makeRich() }]),
        { label: host.classList.contains("markdown") ? "Hide the Markdown" : "Show the Markdown", run: () => showMarkdown(!host.classList.contains("markdown")) },
        { label: "Version history", run: () => void history.open() },
        ...(options.more?.() ?? []),
        ...dictation.items(dictation.more),
        ...(surface.getDocument().quire ? [{ label: "Download", hint: ".quire", run: () => void downloadQuire() }] : []),
        { label: surface.getDocument().quire ? "Download as Markdown" : "Download", hint: surface.getDocument().mdx ? ".mdx" : ".md", run: download },
        { label: "About mdQuire", run: () => showAbout(bar.element.querySelector<HTMLElement>(".quire-dots")!) },
    ];

    const bar = createBar(surface, {
        name,
        colors: options.colors,
        onImage: keepPicture,
        onName: (from) => options.onName?.(from),
        onLink: openLink,
        onFind: () => find.open(),
        onPrint: () => print(),
        onSpelling: (from) => checking.open(from),
        onZoom: (from) => (zooms.isOpen() ? zooms.close(true) : zooms.open(from, zoomLines(() => from), document.activeElement === from)),
        // every command of the menus, by name, for the search of them
        commands: () => row.headings().flatMap((heading) => heading.items()),
        more,
    });
    // checking (src/quire/check/): underlines, a count at the bar's end, and its settings from Tools
    const checking = mountChecking({ surface, bar: bar.element, where: () => ({ store, id, name }) });
    // ---- find and replace, from its button, the Edit menu, Ctrl+F and Ctrl+H ----
    const find = createFind(surface, paper, () => bar.element.getBoundingClientRect().bottom);
    host.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || (event.key !== "f" && event.key !== "h")) return;
        event.preventDefault();
        find.open(event.key === "h");
    });
    // dictation: a microphone at the end of the bar after the three dots, the shortcut, and its lines in the three-dot menu (src/quire/dictation/)
    if (!dictation.why) dictation.mount(bar.element.querySelector<HTMLElement>(".quire-bar-end")!);
    // the rich view and the Markdown, side by side when there is room and one in place of the other when not
    const markdown = createMarkdownView(surface);
    const panes = make("div", "quire-panes");
    panes.append(paper, markdown.element);
    const showMarkdown = (shown: boolean) => {
        // three columns need room: on a smaller window the outline folds away when the Markdown comes
        if (shown && outlineView.isOpen() && host.getBoundingClientRect().width < 80 * parseFloat(getComputedStyle(document.documentElement).fontSize)) outlineView.close();
        host.classList.toggle("markdown", shown);
        markdown.element.inert = !shown;
        markdown.refresh();
        // on a narrow screen the Markdown takes the text's place, so focus goes with it
        if (getComputedStyle(paper).visibility === "hidden" || (shown && matchMedia("(max-width: 60rem)").matches)) (shown ? markdown.element : surface.element).focus({ preventScroll: true });
    };
    markdown.element.inert = true;
    // the top: the page's own, or one made above the editor in the same shape; its places are filled below
    const top = options.top ?? makeTop();
    if (!options.top) host.prepend(top);
    else host.classList.add("bar-away");
    const place = (name: string) => top.querySelector<HTMLElement>(`.quire-${name}-home`)!;
    place("name").append(bar.name);
    place("status").append(bar.statusLine);
    place("bar").append(bar.element);
    bar.element.querySelector('[aria-label="Outline"]')?.setAttribute("data-outline-control", "");
    column.append(panes);

    // ---- the paper and how near it is seen: a small control at the window's lower right, the View and File menus, and Ctrl with plus, minus and 0 ----
    const pageNow = (): Page => surface.getDocument().quire?.page ?? PAGE;
    /** The width the page may fill in page view: the window less its gutters, and half of that while the Markdown is beside it. */
    const space = () => {
        const gutter = parseFloat(getComputedStyle(host).getPropertyValue("--edge")) || 16;
        return (host.clientWidth - gutter * 2) / (host.classList.contains("markdown") ? 2 : 1);
    };
    const zooms = flowMenu("Zoom", { align: "right" });
    const setups = flowMenu("Page setup", { align: "right" });
    // the page as pages of that paper in page view, with the header, footer and numbers of a .quire document
    const pages = createPages(paper, surface, { page: pageNow, rich: () => !!surface.getDocument().quire });
    const zoom = createZoom(paper, column, space, pageNow, pages.paged, (now) => bar.setZoom(percent(now)));
    // ---- the two looks, A (no page) and C (light paper), kept for every document; and page view, kept for each ----
    const looked = (): Look => {
        try {
            return localStorage.getItem(LOOK_KEY) === "paper" ? "paper" : "none";
        } catch {
            return "none";
        }
    };
    let look: Look = looked();
    let easing: ReturnType<typeof setTimeout> | undefined;
    /** Shows the writing in a look, easing from the one it was in; `keep` remembers it for every document. */
    const showLook = (next: Look, keep = true) => {
        look = next;
        if (keep) {
            host.classList.add("easing");
            clearTimeout(easing);
            easing = setTimeout(() => host.classList.remove("easing"), 600);
        }
        host.classList.toggle("look-paper", next === "paper");
        caret.setColours(next === "paper" ? FLAG_ON_PAPER : FLAG);
        if (keep) {
            try {
                localStorage.setItem(LOOK_KEY, next);
            } catch {
                // a browser keeping nothing still shows the look; it is only not remembered
            }
        }
        // the page's width eases from one look to the other; the zoom looks again once it has
        setTimeout(() => zoom.refresh(false), 500);
    };
    showLook(look, false);
    const viewKey = () => `quire-view:${store && id ? `${store.label}:${id}` : name}`;
    const rememberedView = () => {
        try {
            return localStorage.getItem(viewKey()) === "page";
        } catch {
            return false;
        }
    };
    /** Shows the document in page view or in its look; `keep` remembers the choice for it. */
    const showView = (paged: boolean, keep = true) => {
        pages.set(paged);
        host.classList.toggle("paged", paged);
        if (keep) {
            try {
                localStorage.setItem(viewKey(), paged ? "page" : "writing");
            } catch {
                // a browser keeping nothing still shows the view; it is only not remembered
            }
        }
        zoom.refresh();
    };
    showView(rememberedView(), false);
    const openSetup = (from: HTMLElement) => setups.open(from, setupItems(pageNow(), (change) => surface.run((doc) => setPage(doc, { ...pageNow(), ...change }))), true);
    /** The zoom's lines, and for a `.quire` document the page setup, which opens in its place. */
    const zoomLines = (from: () => HTMLElement): MenuItem[] => [{ label: "Page view", pressed: pages.paged(), run: () => showView(!pages.paged()) }, ...zoom.items(), ...(surface.getDocument().quire ? [{ label: "Page setup", hint: "›", run: () => openSetup(from()) }] : [])];
    // as the Markdown opens beside the sheet, the sheet's column narrows and the sheet follows it
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => zoom.refresh(false)).observe(markdown.element);
    // print is given the paper and margins of the page set up
    const printing = make("style");
    document.head.append(printing);
    // looked at only when the page set up has changed, so that typing measures nothing
    const showPage = () => {
        const rule = `@media print { ${pageRule(pageNow())} }`;
        if (printing.textContent === rule) return;
        printing.textContent = rule;
        zoom.refresh();
    };
    surface.on("change", showPage);
    showPage();
    host.addEventListener("keydown", (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const by = event.key === "=" || event.key === "+" ? 1 : event.key === "-" ? -1 : event.key === "0" ? 0 : undefined;
        if (by === undefined) return;
        event.preventDefault();
        if (by === 0) zoom.reset();
        else zoom.step(by);
    });
    surface.on("link", () => openLink(bar.element.querySelector<HTMLElement>('[aria-label^="Link"]')!));
    const selectBar = createSelectBar(surface, () => bar.element.getBoundingClientRect().bottom);
    const outlineView = createOutline(surface, () => bar.element.getBoundingClientRect().bottom, (open) => {
        host.classList.toggle("outlined", open);
    });
    /** Opens or shuts the outline as the writer asks; on a wide window, where it is part of the look, it is kept as they left it. */
    function toggleOutline() {
        if (outlineView.isOpen()) outlineView.close();
        else outlineView.open();
        if (!wide()) return;
        try {
            localStorage.setItem(OUTLINE_KEY, outlineView.isOpen() ? "open" : "shut");
        } catch {
            // kept for this visit only
        }
    }
    host.insertBefore(outlineView.element, column);
    // the document's file, length and where it is kept, in the right margin of the look with no page
    const details = createDetails();
    host.append(details.element);
    let savedAt: number | undefined;
    const showDetails = () => details.show({ file: fileName(name, surface.getDocument().quire ? ".quire" : surface.getDocument().mdx ? ".mdx" : ".md"), words: countWords(surface.getDocument()), place: store?.label, saved: savedAt });
    let detailing: ReturnType<typeof setTimeout> | undefined;
    surface.on("change", () => {
        clearTimeout(detailing);
        detailing = setTimeout(showDetails, 400);
    });
    // on a wide window the outline opens with the editor, unless the writer shut it last time; as the
    // window narrows it goes, rather than become a panel over the page, and comes back as it widens
    const outlineAsKept = () => {
        let kept: string | null = null;
        try {
            kept = localStorage.getItem(OUTLINE_KEY);
        } catch {
            // nothing kept: the outline opens
        }
        if (!wide()) outlineView.close();
        else if (kept !== "shut" && !outlineView.isOpen()) outlineView.open();
    };
    outlineAsKept();
    const widening = typeof matchMedia !== "undefined" ? matchMedia("(min-width: 64rem)") : undefined;
    widening?.addEventListener("change", outlineAsKept);
    const slash = createSlash(surface, bar.pickImage);
    const tableTools = createTableTools(surface);

    // ---- the menu row: every command by name, above the bar ----
    const doing = (action: Action) => () => {
        surface.run((doc, selection) => action({ doc, selection }));
        surface.focus();
    };
    const format = () => row.words[4]!;
    const row = createMenuRow(() =>
        headings(
            { rich: !!surface.getDocument().quire, paged: pages.paged(), look, outline: outlineView.isOpen(), markdown: host.classList.contains("markdown"), words: countWords(surface.getDocument()), align: aligned(surface.getDocument(), surface.getSelection().focus.path) },
            {
                file: options.fileItems,
                turnRich: () => void makeRich(),
                download,
                downloadQuire: () => void downloadQuire(),
                history: () => void history.open(),
                pageSetup: () => openSetup(row.words[0]!),
                zoom: () => zooms.open(row.words[2]!, zoomLines(() => row.words[2]!), true),
                print: () => print(),
                undo: () => (surface.undo(), surface.focus()),
                redo: () => (surface.redo(), surface.focus()),
                find: () => find.open(),
                replace: () => find.open(true),
                selectAll: () => {
                    const paths = blockPaths(surface.getDocument());
                    const last = paths[paths.length - 1] ?? [0];
                    surface.setSelection({ anchor: { path: paths[0] ?? [0], offset: 0 }, focus: { path: last, offset: lengthOf(surface.getDocument(), last) } });
                    surface.focus();
                },
                link: () => openLink(bar.element.querySelector<HTMLElement>('[aria-label^="Link"]') ?? format()),
                outline: () => (toggleOutline()),
                markdown: () => showMarkdown(!host.classList.contains("markdown")),
                pageView: () => showView(!pages.paged()),
                lookNone: () => showLook("none"),
                lookPaper: () => showLook("paper"),
                table: doing(addTable),
                picture: () => bar.pickImage(),
                divider: doing(addDivider),
                code: doing(addCode),
                footnote: doing(addFootnote),
                pageBreak: doing(pageBreakAt),
                headerFooter: () => pages.edit(row.words[3]!),
                bullet: doing(toggleList("bullet")),
                number: doing(toggleList("number")),
                task: doing(toggleList("task")),
                bold: doing(toggle("bold")),
                italic: doing(toggle("italic")),
                underline: doing(toggle("underline")),
                strike: doing(toggle("strike")),
                inline: doing(toggle("code")),
                paragraph: doing(setStyleOf("paragraph")),
                heading1: doing(setStyleOf("heading1")),
                heading2: doing(setStyleOf("heading2")),
                heading3: doing(setStyleOf("heading3")),
                quote: doing(setStyleOf("quote")),
                left: doing(align("left")),
                center: doing(align("center")),
                right: doing(align("right")),
                justify: doing(align("justify")),
                spacing: () => bar.pickers.spacing(format()),
                color: () => bar.pickers.color(format()),
                size: () => bar.pickers.size(format()),
                font: () => bar.pickers.font(format()),
                highlight: () => bar.pickers.highlight(format()),
                check: () => checking.open(row.words[5]!),
                about: () => showAbout(row.words[5]!),
            },
        ),
    );
    // the menu words, on the top's first line after the trail
    place("menus").append(row.element);

    // ---- version history: a snapshot on opening and after each pause in editing, kept by store and document ----
    const historyKey = () => (store && id ? `${store.label}:${id}` : name);
    /** The document as a snapshot keeps it: a `.quire` document with its styling. */
    const snapshot = () => {
        const { text: markdown, quire } = written(surface.getDocument(), write);
        return snapshotText(markdown, quire);
    };
    let keeper = createKeeper(versions, historyKey(), snapshot);
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
        const mine = snapshot();
        const theirs = await saver.choose("theirs");
        if (!theirs) return;
        await versions.save(historyKey(), mine, { time: Date.now(), ...changes(theirs.text, snapshotParts(mine).markdown) });
        quiet = true;
        surface.run(() => opened(theirs.text, theirs.quire ?? (surface.getDocument().quire ? emptyParts() : undefined), { mdx: surface.getDocument().mdx }));
        quiet = false;
    }, () => surface.focus());
    const showStatus = (status: Status) => {
        if (status.state === "saved") savedAt = Date.now();
        showDetails();
        bar.setStatus(short(status, store?.note), said(status, store?.note), status.state === "changed" || status.state === "failed" ? "warn" : "quiet");
        if (status.state === "changed" && saver) conflict.open(saver.unsaved() ?? write(surface.getDocument()), status.theirs?.text);
    };
    let stopListening = saver?.on(showStatus);
    if (saver) showStatus(saver.status());
    else bar.setStatus("", "This document is not being saved anywhere");

    // what only a .quire document can keep folds away from the bar while the document is Markdown
    const richNow = () => {
        const on = !!surface.getDocument().quire;
        bar.setRich(on);
        host.classList.toggle("rich", on);
    };
    surface.on("change", richNow);
    richNow();
    showTitle();
    hint();
    // a title kept in the document follows a change from elsewhere (undo, the Markdown, a form)
    surface.on("change", () => {
        if (options.title && document.activeElement !== title.element) showTitle();
    });
    surface.on("change", ({ doc: now }) => {
        keeper.edited();
        if (!quiet) saver?.changed(() => written(now, write));
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
            showTitle();
            options.onRename?.(value);
            return;
        }
        await saver?.flush();
        try {
            id = await store.rename(id, value);
            name = (await store.list().catch(() => [])).find((entry) => entry.id === id)?.name ?? value;
            bar.setName(name);
            showTitle();
            options.onRename?.(value);
            options.onOpen?.(store, { id, name });
        } catch (error) {
            bar.setName(name);
            showTitle();
            bar.setStatus("Not renamed", `Not renamed: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
    }

    async function create(next: Store, wanted: string, body = "", quire?: Parts) {
        const made = await next.create(wanted, body, quire);
        const entry = (await next.list().catch(() => [])).find((each) => each.id === made.id) ?? { id: made.id, name: wanted };
        await open(next, entry);
    }

    /** Moves to a document: saves what is waiting in the old one, opens the new, and starts its saver and history. */
    async function open(next: Store, entry: Entry) {
        await saver?.flush();
        saver?.stop();
        stopListening?.();
        keeper.stop();
        const found = await next.open(entry.id);
        store = next;
        id = entry.id;
        name = entry.name;
        bar.setName(name);
        quiet = true;
        surface.setDocument(opened(found.text, found.quire, { mdx: /\.mdx$/i.test(entry.id) || /\.mdx$/i.test(entry.name) }));
        quiet = false;
        showTitle();
        saver = createSaver(next, entry.id, found.mark);
        stopListening = saver.on(showStatus);
        showStatus(saver.status());
        keeper = createKeeper(versions, historyKey(), snapshot);
        void keeper.opened();
        showView(rememberedView(), false);
        options.onOpen?.(next, entry);
    }

    /** Lets the document go: what is waiting is saved, and the editor holds an empty page kept nowhere. */
    async function leave() {
        await saver?.flush();
        saver?.stop();
        stopListening?.();
        keeper.stop();
        saver = undefined;
        stopListening = undefined;
        store = undefined;
        id = undefined;
        name = "Untitled";
        bar.setName(name);
        if (!wide()) outlineView.close();
        quiet = true;
        surface.setDocument(read(""));
        quiet = false;
        showTitle();
        keeper = createKeeper(memoryStorage(), "", snapshot);
        bar.setStatus("", "Nothing is open");
    }

    return {
        surface,
        paper,
        leave,
        getName: () => name,
        current: () => ({ store, id, name }),
        open,
        create,
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
            caret.destroy();
            details.destroy();
            widening?.removeEventListener("change", outlineAsKept);
            checking.destroy();
            pages.destroy();
            printing.remove();
            find.destroy();
            bar.destroy();
            if (!options.top) top.remove();
            dictation.destroy();
            surface.destroy();
            for (const menu of [...bar.menus, links, row.menu, zooms, setups, about]) menu.box.remove();
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

/** The top's two lines, for an editor on a page without one of its own: the places the page would mark, in the same shape. */
function makeTop(): HTMLElement {
    const top = make("div", "quire-top quire-top-own");
    const inner = make("div", "quire-top-in");
    const line = make("div", "quire-top-line");
    line.append(make("span", "quire-name-home"), make("div", "quire-menus-home"), make("div", "quire-status-home"));
    inner.append(line, make("div", "quire-bar-home"));
    top.append(inner);
    return top;
}
