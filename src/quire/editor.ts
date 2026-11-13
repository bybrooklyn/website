// The whole editor: the bar, the writing column with the surface in it, and everything around it,
// put together on one element, writing to one document in one store at a time. The page that shows
// mdQuire calls createEditor and nothing else.
//
//   const editor = createEditor(element, read(text), { name, store, id, mark, versions, colors });
//   editor.surface              the editing surface (surface.ts)
//   editor.open(store, entry)   leaves the document (saving what is waiting) and opens another;
//                               words that cannot be saved keep the writer there until she chooses
//   editor.ready()              saves what is waiting, asking the writer if it cannot be: may it be left?
//   editor.create(store, name)  makes a new document there and opens it
//   editor.flush()              saves now what is waiting
//   editor.getName(), editor.current(), editor.destroy()
//
// Without a store the editor writes nowhere, as in the tests of its parts.

import { addCode, addDivider, addFootnote, addTable, align, aligned, clearFormat, createBar, indentBy, link as linkAction, linkAt, setStyleOf, toggle, toggleList, toggleSubtext, type Action } from "./bar";
import { createMenuRow, headings, type RowActions } from "./menu-row";
import { blockPaths, countWords, documentOf, lengthOf } from "./document";
import { createConflict } from "./conflict";
import { createDictation } from "./dictation/dictation";
import { type Document } from "./document";
import { collapsed, fragment, pageBreakAt } from "./keys";
import { createPages } from "./pages";
import { createMarkdownView } from "./markdown-view";
import { createOutline } from "./outline";
import { read } from "./read";
import { createSelectBar } from "./select-bar";
import { boxOf, createSlash, definitionList, drawnBlock } from "./slash";
import { createEmojiPicker } from "./emoji-picker";
import { createSaver, fileName, said, type Entry, type Opened, type Status, type Store } from "./store";
import { altGraph, createSurface, type Surface } from "./surface";
import { createTableTools } from "./tables";
import { createPictureTools } from "./picture-tools";
import { createCommentMargin, keptNotes, moveNotes } from "./comment-margin";
import { addContents, dateText, findContents, specialGrid, typeIn, typeSpecial, updateContents } from "./inserts";
import { colorHex, countRows, gatherPictures, heldElsewhere, markdownFor, pageHtml, plainText, readingStyles, type Picture } from "./export";
import { docx } from "./docx";
import { aboutPanel, control, flowMenu, keySymbols, linkForm, make, type MenuItem } from "./ui";
import { openDialog } from "./dialog";
import { chordFrom, findShortcuts, shortcutFor } from "./shortcuts";
import { findTyping } from "./vocabulary";
import { changes, createHistoryPanel, createKeeper, memoryStorage, moveVersions, snapshotParts, snapshotText, type VersionStorage } from "./versions";
import { write } from "./write";
import { emptyParts, opened, packQuire, written, type Parts } from "./quire-file";
import { pictureType, withoutMetadata } from "./pictures";
import { crc32 } from "./zip";
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
    /** Every command by name, as the menus, the shortcuts and the Ctrl+/ panel run them. */
    commands: RowActions;
    getName(): string;
    current(): { store?: Store; id?: string; name: string };
    /** Moves to another document; false when the writer chose to stay (the old one could not be saved) or it could not be opened. */
    open(store: Store, entry: Entry): Promise<boolean>;
    /** Makes a new document there and opens it; given parts, it is made as a `.quire` document. */
    create(store: Store, name: string, text?: string, quire?: Parts): Promise<boolean>;
    /** Says something went wrong, in the status: a few words, and the whole of it. */
    say(short: string, full: string): void;
    /** Saves what is waiting; when it cannot be saved, asks the writer whether to try again, stay or leave it. True when the document may be left. */
    ready(): Promise<boolean>;
    flush(): Promise<void>;
    status(): Status | undefined;
    /** The bar's name, from which the documents list grows. */
    nameElement(): HTMLElement;
    /** Renames the document where it lives. */
    rename(name: string): Promise<void>;
    /** Saves what is waiting and lets the document go, so that nothing is open; false when the writer stays. */
    leave(): Promise<boolean>;
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
/** True on a Mac, where Cmd does what Ctrl does elsewhere. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Where typed signs being turned off is kept. */
const SYMBOLS_KEY = "quire-symbols";

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
    // true when the document lives only in this tab until it is downloaded (a file opened from the computer) and has changed since
    let undownloaded = false;
    const versions = options.versions ?? memoryStorage();
    const column = make("div", "quire-column");
    const paper = make("div", "quire-paper");
    const text = make("div", "prose");
    text.setAttribute("aria-label", "Document");
    paper.append(text);
    host.append(column);

    /** A picture as it comes into a document: where and when it was taken cut out of it (pictures.ts), and its type read from its bytes. */
    const cleaned = async (picked: File) => {
        const bytes = withoutMetadata(new Uint8Array(await picked.arrayBuffer()), crc32);
        const sniffed = pictureType(bytes, picked.name);
        // a phone's HEIC, which this cannot read through, keeps the type it came with
        const type = sniffed === "application/octet-stream" && /^image\/hei[cf]$/.test(picked.type) ? picked.type : sniffed;
        return new File([bytes as BlobPart], picked.name || "picture.png", { type });
    };
    // pictures are kept by the document's store, beside the document
    const keepPicture = async (picked: File) => {
        let file: File;
        try {
            file = await cleaned(picked);
        } catch (error) {
            bar.setStatus("No picture", `The picture was not added: ${error instanceof Error ? error.message : String(error)}`, "warn");
            throw error;
        }
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
    /** Where a Markdown file's notes are kept in this browser: its place and name. */
    const notesPlace = () => (store && id ? `${store.label}:${id}` : undefined);
    const surface = createSurface(text, keptNotes(doc, notesPlace()).doc, { onImage: keepPicture, picture: async (address) => (store && id && store.show ? store.show(id, address) : undefined) });
    const caret = createCaret(surface.element, paper, FLAG);
    // typed signs are on unless the writer turned them off, for every document
    try {
        if (localStorage.getItem(SYMBOLS_KEY) === "off") surface.setSymbols(false);
    } catch {
        // a browser keeping nothing has them on
    }

    // ---- the title, the first line on the sheet: the document's name ----
    let renaming = Promise.resolve();
    let typing: ReturnType<typeof setTimeout> | undefined;
    /** True when the title shown is kept in the document rather than its name. */
    const owned = () => !!options.title && options.title.read(surface.getDocument()) !== null;
    const renameTo = (typed: string) => {
        const next = nameFor(name, typed);
        if (next === name) return;
        // the name typed belongs to the document it was typed in, not to one opened before the rename comes round
        const meant = { store, id };
        renaming = renaming.then(() => (store === meant.store && id === meant.id ? renameNow(next) : undefined)).catch(() => undefined);
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
        if (!doc.quire) undownloaded = false;
        // a .quire document's Markdown is downloaded with its color, size and centring as small HTML, as a Markdown file keeps them
        const ending = doc.mdx ? ".mdx" : ".md";
        give(new Blob([write(doc)], { type: "text/markdown" }), /\.(md|mdx|markdown|txt)$/i.test(name) ? name.replace(/^.*\//, "") : `${stem()}${ending}`);
    };
    const downloadQuire = async () => {
        undownloaded = false;
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
    // ---- Download as: each kind of file the document can be given as ----
    const downloads = flowMenu("Download as");
    const shownPictures = () => gatherPictures(surface.getDocument(), async (src) => (store && id && store.show ? store.show(id, src) : undefined));
    /** Says when a download leaves out pictures it did not fetch, those from elsewhere on the web among them. */
    const sayElsewhere = (pictures: Map<string, Picture>) => {
        if (heldElsewhere(surface.getDocument(), pictures).length) bar.setStatus("Downloaded", "Pictures from elsewhere on the web were not fetched, so the download does not hold them", "quiet");
    };
    const downloadAsQuire = async () => {
        const doc = surface.getDocument();
        if (doc.quire) return downloadQuire();
        undownloaded = false;
        // a Markdown document goes into the zip as it is, with its notes, as a .quire document of its own
        const { text: markdown, quire } = written({ ...doc, mdx: false, quire: { page: PAGE, notes: null } }, write);
        const pictures = (store && id && (await store.pictures?.(id).catch(() => undefined))) || new Map<string, Blob>();
        give(new Blob([(await packQuire({ markdown, parts: quire ?? emptyParts(), pictures })) as BlobPart], { type: "application/zip" }), `${stem()}.quire`);
    };
    const downloadLines = (): MenuItem[] => [
        { label: "Markdown", hint: surface.getDocument().mdx ? ".mdx" : ".md", run: () => give(new Blob([markdownFor(surface.getDocument())], { type: "text/markdown" }), `${stem()}${surface.getDocument().mdx ? ".mdx" : ".md"}`) },
        { label: "mdQuire", hint: ".quire", run: () => void downloadAsQuire() },
        {
            label: "Web page",
            hint: ".html",
            run: async () => {
                const pictures = await shownPictures();
                give(new Blob([pageHtml(surface.getDocument(), { title: shownName(name), styles: await readingStyles(), pictures })], { type: "text/html" }), `${stem()}.html`);
                sayElsewhere(pictures);
            },
        },
        { label: "Plain text", hint: ".txt", run: () => give(new Blob([plainText(surface.getDocument())], { type: "text/plain" }), `${stem()}.txt`) },
        {
            label: "Word",
            hint: ".docx",
            run: async () => {
                const pictures = await shownPictures();
                give(new Blob([(await docx(surface.getDocument(), { pictures, hex: colorHex, title: shownName(name) })) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${stem()}.docx`);
                sayElsewhere(pictures);
            },
        },
        // a browser cannot write a PDF itself: its print dialog can, with the page set up already given to it
        { label: "PDF, through the print dialog", hint: "Ctrl+P", run: () => print() },
    ];
    // ---- special characters: a grid that stays open while characters are typed from it ----
    const specials = flowMenu("Special characters", { className: "quire-specials-menu" });
    const openSpecials = (from: HTMLElement) => {
        specials.open(from, specialGrid(typeSpecial(surface)));
        specials.box.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
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
    const zoom = createZoom(paper, column, space, pageNow, pages.paged, (now) => {
        bar.setZoom(percent(now));
        requestAnimationFrame(() => roomBeside());
    });
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
    // as the Markdown opens beside the sheet, or the window (or the browser's own zoom) changes, the sheet's column narrows and the sheet follows it
    // what the editor listens to on the page and the host, let go when it is destroyed
    const watchers: ResizeObserver[] = [];
    const watch = (element: Element, run: () => void) => {
        if (typeof ResizeObserver === "undefined") return;
        const watcher = new ResizeObserver(run);
        watcher.observe(element);
        watchers.push(watcher);
    };
    // only a change of width matters: the editor grows taller with every line typed
    let wideAt = 0;
    watch(markdown.element, () => zoom.refresh(false));
    watch(host, () => {
        if (host.clientWidth === wideAt) return;
        wideAt = host.clientWidth;
        zoom.refresh(false);
    });
    // print is given the paper and margins of the page set up, in a stylesheet made in script: the page's
    // policy refuses a <style> element added at run time, but not a sheet built through the CSSOM and adopted
    const printing = typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in document ? new CSSStyleSheet() : undefined;
    if (printing) document.adoptedStyleSheets = [...document.adoptedStyleSheets, printing];
    let printed = "";
    // looked at only when the page set up has changed, so that typing measures nothing
    const showPage = () => {
        const rule = `@media print { ${pageRule(pageNow())} }`;
        if (printed === rule) return;
        printed = rule;
        printing?.replaceSync(rule);
        zoom.refresh();
    };
    surface.on("change", showPage);
    showPage();
    // Ctrl with + (as well as =) zooms in too, as a browser does
    const zoomKey = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key !== "+" || event.code === "Equal") return;
        event.preventDefault();
        zoom.step(1);
    };
    host.addEventListener("keydown", zoomKey);
    surface.on("link", () => openLink(bar.seen("Link")));
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
    // the outline and the details stand in the margins beside the sheet; when the sheet, zoomed or on a small
    // window, leaves them too little room to be read whole, they fade away rather than be cut or run under it
    const roomBeside = () => {
        const room = parseFloat(getComputedStyle(details.element).width);
        const least = 8.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
        host.classList.toggle("cramped", Number.isFinite(room) && room < least);
    };
    let besideAt = 0;
    watch(host, () => {
        if (host.clientWidth === besideAt) return;
        besideAt = host.clientWidth;
        roomBeside();
    });
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
    const emojiList = createEmojiPicker(surface);
    const tableTools = createTableTools(surface, () => bar.element.getBoundingClientRect().bottom);
    const pictureTools = createPictureTools(surface, { keep: keepPicture, margin: host });
    // the writer's notes: marked in the text, in the right margin on a wide window and a list on a narrow one
    const notes = createCommentMargin(surface, { place: notesPlace });
    host.append(notes.element);
    notes.opened();

    // ---- the menu row: every command by name, above the bar ----
    const doing = (action: Action) => () => {
        surface.run((doc, selection) => action({ doc, selection }));
        surface.focus();
    };
    const format = () => row.words[4]!;
    /** Every command, by name: the menus, their search, the keyboard's shortcuts (shortcuts.ts) and the Ctrl+/ panel all run these. */
    const actions: RowActions = {
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
                link: () => openLink(bar.seen("Link")),
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
                marked: doing(toggle("mark")),
                superscript: doing(toggle("sup")),
                subscript: doing(toggle("sub")),
                typedSigns: () => {
                    surface.setSymbols(!surface.symbols());
                    try {
                        localStorage.setItem(SYMBOLS_KEY, surface.symbols() ? "on" : "off");
                    } catch {
                        // kept for this visit only
                    }
                },
                downloadAs: () => downloads.open(row.words[0]!, downloadLines(), true),
                notes: () => notes.list(row.words[2]!),
                nextNote: () => notes.next(1),
                previousNote: () => notes.next(-1),
                comment: () => notes.add(row.words[3]!),
                date: doing((state) => typeIn(state, dateText(new Date()))),
                symbols: () => openSpecials(row.words[3]!),
                contents: doing(addContents),
                updateContents: () => (surface.run((doc) => updateContents(doc)), surface.focus()),
                pastePlain: () => {
                    // the menu line asks the clipboard for its text; a browser that will not give it says so, and Ctrl+Shift+V still does it
                    void navigator.clipboard?.readText().then(
                        (text) => (surface.pasteText(text), surface.focus()),
                        () => bar.setStatus("Press Ctrl+Shift+V", "This browser did not let mdQuire read the clipboard: press Ctrl+Shift+V (Cmd+Shift+V on a Mac) to paste without formatting", "warn"),
                    );
                },
                zoomIn: () => zoom.step(1),
                zoomOut: () => zoom.step(-1),
                zoomReset: () => zoom.reset(),
                callout: doing(boxOf({ callout: "NOTE" })),
                details: doing(boxOf({ details: { summary: "", open: false } })),
                definitions: doing(definitionList),
                maths: doing(drawnBlock("math")),
                diagram: doing(drawnBlock("mermaid")),
                heading4: doing(setStyleOf("heading4")),
                heading5: doing(setStyleOf("heading5")),
                heading6: doing(setStyleOf("heading6")),
                subtext: doing(toggleSubtext),
                spoiler: doing(toggle("spoiler")),
                bigger: () => (bar.sizeBy(1), surface.focus()),
                smaller: () => (bar.sizeBy(-1), surface.focus()),
                indent: doing(indentBy(1)),
                outdent: doing(indentBy(-1)),
                clear: doing(clearFormat),
                wordCount: () => showCount(row.words[5]!),
                shortcuts: () => showShortcuts(row.words[5]!),
                searchMenus: () => bar.search(),
                tools: () => dictation.items(row.words[5]!),
    };
    const row = createMenuRow(() =>
        headings(
            { rich: !!surface.getDocument().quire, contents: !!findContents(surface.getDocument()), paged: pages.paged(), look, outline: outlineView.isOpen(), markdown: host.classList.contains("markdown"), words: countWords(surface.getDocument()), align: aligned(surface.getDocument(), surface.getSelection().focus.path), symbols: surface.symbols() },
            actions,
        ),
    );
    // ---- the keyboard's shortcuts: each runs its command from the one table (shortcuts.ts); the surface's own it has already taken ----
    const shortcutKey = (event: KeyboardEvent) => {
        // AltGr types a character (@ # { [ | on many layouts): it is never a shortcut
        if (event.defaultPrevented || event.isComposing || altGraph(event)) return;
        const found = shortcutFor(chordFrom(event, MAC));
        if (!found?.command || found.surface) return;
        // a field of the editor's own (the find bar, a menu's search) keeps the keys that edit text in it
        const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
        if (field && ["selectAll", "pastePlain"].includes(found.command)) return;
        const run = actions[found.command];
        if (!run) return;
        // Ctrl+Shift+V pastes through the browser's own paste, which the surface takes as plain text
        if (found.command === "pastePlain") return;
        event.preventDefault();
        run();
    };
    host.addEventListener("keydown", shortcutKey);
    // ---- the word count, Ctrl+Shift+C: a small dialog, as Docs has ----
    const showCount = (from: HTMLElement) => {
        const doc = surface.getDocument();
        const all = plainText(doc);
        const selection = surface.getSelection();
        const picked = collapsed(selection) ? undefined : plainText(documentOf(fragment(doc, selection)));
        const rows = countRows(all, picked);
        const table = make("table", "quire-count");
        for (const [label, whole, part] of rows) {
            const tr = make("tr");
            tr.append(make("th", "", label), make("td", "", whole.toLocaleString("en")));
            if (picked !== undefined) tr.append(make("td", "", (part ?? 0).toLocaleString("en")));
            table.append(tr);
        }
        if (picked !== undefined) {
            const head = make("tr", "quire-count-head");
            head.append(make("th"), make("th", "", "Document"), make("th", "", "Selected"));
            table.prepend(head);
        }
        openDialog(from, { title: "Word count", body: [table], action: { label: "Done", press: (_, dialog) => void dialog.close() }, onClose: () => surface.focus() });
    };
    // ---- every shortcut and every piece of typing, Ctrl+/: a dialog with a search, grown from where it was asked for ----
    const showShortcuts = (from: HTMLElement) => {
        const field = make("input", "quire-link-field quire-keys-search");
        field.type = "search";
        field.placeholder = "Search the shortcuts and typing";
        field.setAttribute("aria-label", "Search the shortcuts and typing");
        const list = make("div", "quire-keys");
        const fill = () => {
            const found = findShortcuts(field.value);
            const typed = findTyping(field.value);
            list.replaceChildren();
            const section = (title: string, rows: [string, string][]) => {
                if (rows.length === 0) return;
                list.append(make("h3", "quire-keys-head", title));
                const table = make("table", "quire-keys-table");
                for (const [keys, label] of rows) {
                    const tr = make("tr");
                    const { shown, words } = keySymbols(keys, MAC);
                    const cell = make("td", "quire-keys-keys", shown);
                    if (words) cell.title = words;
                    tr.append(cell, make("td", "", label));
                    table.append(tr);
                }
                list.append(table);
            };
            for (const menu of ["File", "Edit", "View", "Insert", "Format", "Tools", "In the text"] as const) section(menu === "In the text" ? "Keys in the text" : menu, found.filter((each) => each.menu === menu).map((each) => [each.keys, each.label]));
            section("Typing", typed.map((each) => [each.typed, `${each.becomes}${each.origin === "extra" ? "" : `, as ${each.origin} has it`}`]));
            if (!list.firstChild) list.append(make("p", "quire-keys-none", "Nothing has those words."));
        };
        field.addEventListener("input", fill);
        fill();
        openDialog(from, { title: "Keyboard shortcuts", body: [field, list], className: "quire-keys-dialog", action: { label: "Done", press: (_, dialog) => void dialog.close() }, onClose: () => surface.focus() });
        field.focus({ preventScroll: true });
    };
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
    // true while a rename moves the document, and whether anything was typed meanwhile
    let moving = false;
    let typedWhileMoving = false;
    const conflict = createConflict(async (choice) => {
        const asked = saver;
        if (!asked) return;
        if (choice === "mine") return void (await asked.choose("mine"));
        // what was typed here is kept in the version history before theirs takes its place
        const mine = snapshot();
        const key = historyKey();
        const theirs = await asked.choose("theirs");
        if (!theirs) return;
        await versions.save(key, mine, { time: Date.now(), ...changes(theirs.text, snapshotParts(mine).markdown) });
        // their text is shown only if the writer is still in the document it belongs to
        if (saver !== asked) return;
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
        // a document being put in place of another is not an edit of the one leaving
        if (quiet) return;
        if (store?.note) undownloaded = true;
        keeper.edited();
        if (moving) typedWhileMoving = true;
        else saver?.changed(() => written(now, write));
    });

    // leaving the page with words not yet saved: they are saved if there is time, and the browser asks
    const leaving = (event: BeforeUnloadEvent) => {
        notes.keep();
        // a file opened from the computer is kept only in this tab: closing it loses what was not downloaded
        if (undownloaded) return event.preventDefault();
        if (saver?.unsaved() === undefined) return;
        void saver.flush();
        event.preventDefault();
    };
    addEventListener("beforeunload", leaving);

    /** Renames the document, one rename at a time. */
    function rename(value: string) {
        const run = renaming.then(() => renameNow(value));
        renaming = run.catch(() => undefined);
        return run;
    }

    async function renameNow(value: string) {
        if (!store || !id || !store.can.rename) {
            name = value;
            bar.setName(value);
            showTitle();
            options.onRename?.(value);
            return;
        }
        if (saver?.status().state === "changed") {
            bar.setName(name);
            showTitle();
            bar.setStatus("Not renamed", "Not renamed: it was changed somewhere else; choose which version to keep first", "warn");
            return;
        }
        await saver?.flush();
        const was = { store, id };
        // what is typed while the file moves is saved once it is in its new place, not into the old one
        moving = true;
        try {
            const moved = await was.store.rename(was.id, value);
            if (store !== was.store || id !== was.id) return;
            if (moved !== was.id) await follow(was.store, was.id, moved);
            name = (await was.store.list().catch(() => [])).find((entry) => entry.id === moved)?.name ?? value;
            bar.setName(name);
            showTitle();
            options.onRename?.(value);
            options.onOpen?.(was.store, { id: moved, name });
        } catch (error) {
            bar.setName(name);
            showTitle();
            bar.setStatus("Not renamed", `Not renamed: ${error instanceof Error ? error.message : String(error)}`, "warn");
        } finally {
            moving = false;
            if (typedWhileMoving) {
                typedWhileMoving = false;
                saver?.changed(() => written(surface.getDocument(), write));
            }
        }
    }

    /** After a rename that gave the document a new id (a path in a folder or a repository): saving, its history and its notes go on from there. */
    async function follow(where: Store, from: string, to: string) {
        const before = `${where.label}:${from}`;
        notes.keep();
        const mark = await (where.markOf ? where.markOf(to) : where.open(to).then((found) => found.mark)).catch(() => "");
        if (saver?.unsaved() !== undefined) typedWhileMoving = true;
        saver?.stop();
        stopListening?.();
        await keeper.now().catch(() => undefined);
        keeper.stop();
        id = to;
        saver = createSaver(where, to, mark);
        stopListening = saver.on(showStatus);
        showStatus(saver.status());
        await moveVersions(versions, before, historyKey()).catch(() => undefined);
        keeper = createKeeper(versions, historyKey(), snapshot);
        moveNotes(before, notesPlace() ?? before);
    }

    async function create(next: Store, wanted: string, body = "", quire?: Parts) {
        const made = await next.create(wanted, body, quire);
        const entry = (await next.list().catch(() => [])).find((each) => each.id === made.id) ?? { id: made.id, name: wanted };
        return open(next, entry);
    }

    /** Asks the writer what to do with changes that could not be saved: try again, stay, or leave them. A copy can be downloaded meanwhile. */
    const askUnsaved = (why: string) =>
        new Promise<"retry" | "stay" | "discard">((answer) => {
            let chosen: "retry" | "stay" | "discard" = "stay";
            // the two other ways sit under the words, as the row at the bottom has room for two buttons
            const ways = make("p");
            const way = (label: string, press: () => void) => {
                const button = make("button", "quire-dialog-dismiss", label);
                button.type = "button";
                button.addEventListener("click", press);
                ways.append(button);
            };
            way("Download a copy", () => void (surface.getDocument().quire ? downloadQuire() : download()));
            way("Leave without saving", () => ((chosen = "discard"), void dialog.close()));
            const dialog = openDialog(bar.statusLine, {
                title: "Not saved",
                body: [make("p", "", `The latest changes to this document have not been saved: ${why}. They are still here.`), ways],
                action: { label: "Try again", press: (_, open) => ((chosen = "retry"), void open.close()) },
                dismiss: "Stay",
                onClose: () => answer(chosen),
            });
        });

    /** Saves what is waiting before the document is let go. When it cannot be saved the writer is told and chooses; true when the document may go. */
    async function ready(): Promise<boolean> {
        // a rename on its way finishes first, so that what is saved goes to the document's new place
        await renaming;
        for (;;) {
            const now = saver;
            if (!now || !store?.can.save) return true;
            await now.flush();
            // what was typed while that save was on its way
            if (now.status().state === "waiting") await now.flush();
            if (now.unsaved() === undefined) return true;
            // whatever is chosen, what was typed is kept in the version history
            await keeper.now().catch(() => undefined);
            const status = now.status();
            const why = status.state === "failed" ? status.message : status.state === "changed" ? "it was changed somewhere else meanwhile" : "it is still waiting to be saved";
            const choice = await askUnsaved(why);
            if (choice === "stay") return false;
            if (choice === "discard" && saver === now) {
                now.stop();
                stopListening?.();
                stopListening = undefined;
                saver = undefined;
                return true;
            }
        }
    }

    /** Moves to a document: saves what is waiting in the old one, opens the new, and starts its saver and history. False when the writer stays where she is, or the new one could not be opened. */
    async function open(next: Store, entry: Entry): Promise<boolean> {
        clearTimeout(typing);
        if (!(await ready())) return false;
        let found: Opened;
        try {
            found = await next.open(entry.id);
        } catch (error) {
            // the document open stays open, still saving
            bar.setStatus("Not opened", `${entry.name} was not opened: ${error instanceof Error ? error.message : String(error)}`, "warn");
            return false;
        }
        // typed while the new one was being fetched
        if (saver?.unsaved() !== undefined && !(await ready())) return false;
        await keeper.now().catch(() => undefined);
        notes.keep();
        saver?.stop();
        stopListening?.();
        keeper.stop();
        store = next;
        id = entry.id;
        name = entry.name;
        bar.setName(name);
        quiet = true;
        surface.setDocument(keptNotes(opened(found.text, found.quire, { mdx: /\.mdx$/i.test(entry.id) || /\.mdx$/i.test(entry.name) }), notesPlace()).doc);
        quiet = false;
        notes.opened();
        showTitle();
        undownloaded = false;
        saver = createSaver(next, entry.id, found.mark);
        stopListening = saver.on(showStatus);
        showStatus(saver.status());
        keeper = createKeeper(versions, historyKey(), snapshot);
        void keeper.opened();
        showView(rememberedView(), false);
        options.onOpen?.(next, entry);
        return true;
    }

    /** Lets the document go: what is waiting is saved, and the editor holds an empty page kept nowhere. False when the writer stays. */
    async function leave(): Promise<boolean> {
        clearTimeout(typing);
        if (!(await ready())) return false;
        await keeper.now().catch(() => undefined);
        notes.keep();
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
        notes.opened();
        showTitle();
        keeper = createKeeper(memoryStorage(), "", snapshot);
        bar.setStatus("", "Nothing is open");
        return true;
    }

    return {
        surface,
        /** Every command by name, as the menus, the shortcuts and the Ctrl+/ panel run them. */
        commands: actions,
        paper,
        leave,
        getName: () => name,
        current: () => ({ store, id, name }),
        open,
        create,
        ready,
        say: (short, full) => bar.setStatus(short, full, "warn"),
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
            if (printing) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== printing);
            find.destroy();
            bar.destroy();
            if (!options.top) top.remove();
            dictation.destroy();
            surface.destroy();
            for (const menu of [...bar.menus, links, row.menu, zooms, setups, about]) menu.box.remove();
            selectBar.element.remove();
            slash.close();
            emojiList.close();
            tableTools.element.remove();
            pictureTools.destroy();
            notes.destroy();
            for (const menu of [downloads, specials]) menu.box.remove();
            keeper.stop();
            saver?.stop();
            history.element.remove();
            conflict.element.remove();
            removeEventListener("beforeunload", leaving);
            host.removeEventListener("keydown", zoomKey);
            host.removeEventListener("keydown", shortcutKey);
            for (const watcher of watchers) watcher.disconnect();
            for (const timer of [typing, easing, detailing]) clearTimeout(timer);
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
