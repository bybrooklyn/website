// mdQuire as a whole, as its public page shows it: the editor, writing to a document in one of the
// places documents can live, with the documents list growing out of the name in the bar, the way
// to open a file or a folder, and the form that connects a GitHub repository. The first time, it
// starts writing at once in a new document kept in this browser, with a short welcome above it.
// Where the writer was is remembered in this browser for next time.
//
//   const app = await startApp(element, { colors });

import { createEditor, type Editor } from "./editor";
import { documentsList, repositoryForm, type Place } from "./documents";
import { read } from "./read";
import { emptyParts, opened, type Parts } from "./quire-file";
import { fileName, type Entry, type Store } from "./store";
import { browserStore, indexedTables } from "./store-browser";
import { filesStore, OPENABLE } from "./store-files";
import { canOpen, folderStore, oneFileStore, type FileHandle, type FolderHandle } from "./store-folder";
import { folderPath, forgetSettings, githubStore, keepSettings, readSettings, repository, type Fetcher } from "./store-github";
import { flowMenu, make } from "./ui";

/** What the page gives the app. */
export interface AppOptions {
    colors?: { name: string; value: string }[];
    /** A document with every kind of block, offered from the welcome. */
    sample?: string;
    /** The network, for the repository store; the browser's own if not given. */
    fetcher?: Fetcher;
    /** The name of the browser database. */
    database?: string;
    /** Where the page wants the bar: in its own top row, beside the site's name. */
    barHome?: HTMLElement;
}

/** Where the writer was, remembered in this browser. */
const PLACE_KEY = "quire-place";

/** The browser's local storage, or nothing where it may not be used. */
function local(): Storage | undefined {
    try {
        return globalThis.localStorage;
    } catch {
        return undefined;
    }
}

/** Starts mdQuire on an element. */
export async function startApp(host: HTMLElement, options: AppOptions = {}) {
    const browser = browserStore(await indexedTables(options.database));
    const files = filesStore();
    let folder: Store | undefined;
    let settings = readSettings(local());
    let github = settings ? githubStore(settings, options.fetcher) : undefined;
    const keyOf = (store: Store) => (store === browser ? "browser" : store === github ? "github" : store === files ? "files" : "folder");

    // ---- where to start ----
    let start: { store: Store; entry: Entry; text: string; mark: string; quire?: Parts } | undefined;
    const remembered = (() => {
        try {
            return JSON.parse(local()?.getItem(PLACE_KEY) ?? "null") as { place: string; id: string; name: string } | null;
        } catch {
            return null;
        }
    })();
    const tryOpen = async (store: Store, entry: Entry) => {
        const opened = await store.open(entry.id).catch(() => undefined);
        if (opened) start = { store, entry, ...opened };
    };
    if (remembered?.place === "github" && github) await tryOpen(github, { id: remembered.id, name: remembered.name });
    if (!start && remembered?.place === "browser") await tryOpen(browser, { id: remembered.id, name: remembered.name });
    if (!start) {
        const newest = (await browser.list())[0];
        if (newest) await tryOpen(browser, newest);
    }
    const firstRun = !start;
    if (!start) {
        const made = await browser.create("Untitled", "");
        start = { store: browser, entry: { id: made.id, name: "Untitled" }, text: "", mark: made.mark, quire: emptyParts() };
    }

    const remember = (store: Store, entry: Entry) => {
        const place = keyOf(store);
        // a file or folder opened from the computer cannot be opened again without being chosen again
        if (place === "browser" || place === "github") local()?.setItem(PLACE_KEY, JSON.stringify({ place, id: entry.id, name: entry.name }));
    };

    // the documents list is shown for a place, which is the current document's until another is chosen
    let shown: Store = start.store;
    const menu = flowMenu("Documents", { className: "quire-documents-menu" });
    let from: HTMLElement | undefined;

    const editor: Editor = createEditor(host, opened(start.text, start.quire, { mdx: /\.mdx$/i.test(start.entry.id) }), {
        name: start.entry.name,
        store: start.store,
        id: start.entry.id,
        mark: start.mark,
        versions: browser.versions,
        colors: options.colors,
        barHome: options.barHome,
        richHome: browser,
        // the File menu's first lines: what the documents list and the welcome offer, by name
        fileItems: () => [
            { label: "New document", icon: "plus", run: () => void editor.create(browser, "Untitled", "", emptyParts()).then(() => (welcome?.go(), editor.surface.focus())) },
            { label: "Documents", run: () => ((from = editor.nameElement()), (shown = editor.current().store ?? browser), void showDocuments()) },
            { label: "Open a file", run: () => chooser.click() },
            ...(able.file ? [{ label: "Open a file to write in place", run: () => void openInPlace() }] : []),
            ...(able.folder ? [{ label: "Open a folder", run: () => ((from = editor.nameElement()), void openFolder()) }] : []),
            { label: github ? "Repository settings" : "Connect a repository", run: () => ((from = editor.nameElement()), showRepository()) },
        ],
        onOpen: remember,
        onName: (button) => {
            if (menu.isOpen()) return menu.close(true);
            from = button;
            shown = editor.current().store ?? browser;
            void showDocuments();
        },
    });
    remember(start.store, start.entry);

    // ---- choosing files and folders ----
    const chooser = make("input", "quire-file");
    chooser.type = "file";
    chooser.accept = OPENABLE;
    chooser.tabIndex = -1;
    chooser.setAttribute("aria-hidden", "true");
    host.append(chooser);
    chooser.addEventListener("change", async () => {
        const picked = chooser.files?.[0];
        chooser.value = "";
        if (!picked) return;
        const entry = await files.add(picked).catch(() => undefined);
        if (entry) await editor.open(files, entry);
        welcome?.go();
        editor.surface.focus();
    });
    const pickers = globalThis as unknown as { showOpenFilePicker?: (options: object) => Promise<FileHandle[]>; showDirectoryPicker?: (options: object) => Promise<FolderHandle> };
    const able = canOpen();
    const openInPlace = async () => {
        const [handle] = (await pickers.showOpenFilePicker?.({ types: [{ description: "Markdown and .quire documents", accept: { "text/markdown": [".md", ".mdx", ".markdown", ".txt"], "application/zip": [".quire"] } }] }).catch(() => [])) ?? [];
        if (!handle) return;
        const store = oneFileStore(handle);
        await editor.open(store, { id: handle.name, name: handle.name });
        welcome?.go();
        menu.close(false);
    };
    const openFolder = async () => {
        const handle = await pickers.showDirectoryPicker?.({ mode: "readwrite" }).catch(() => undefined);
        if (!handle) return;
        folder = folderStore(handle);
        shown = folder;
        welcome?.go();
        await showDocuments();
    };

    // ---- the documents list ----
    async function showDocuments(problem?: string) {
        const current = editor.current();
        let entries: Entry[] = [];
        let note = problem;
        try {
            entries = await shown.list();
        } catch (error) {
            note = error instanceof Error ? error.message : String(error);
        }
        const places: Place[] = [
            { key: "browser", label: "This browser", current: shown === browser, choose: () => ((shown = browser), void showDocuments()) },
            { key: "file", label: "Open a file", choose: () => chooser.click() },
            able.file ? { key: "in-place", label: "Open a file to write in place", choose: () => void openInPlace() } : { key: "in-place", label: "", absent: "This browser cannot write files in place; Chrome and Edge can.", choose: () => {} },
            able.folder ? { key: "folder", label: folder ? `Folder: ${folder.label}` : "Open a folder", current: shown === folder && !!folder, choose: () => (folder && shown !== folder ? ((shown = folder), void showDocuments()) : void openFolder()) } : { key: "folder", label: "", absent: "Folders can be opened in Chrome and Edge.", choose: () => {} },
            github
                ? { key: "github", label: `Repository: ${github.label}`, current: shown === github, choose: () => ((shown = github!), void showDocuments()) }
                : { key: "github", label: "Connect a repository", choose: () => showRepository() },
        ];
        if (github) places.push({ key: "github-settings", label: "Repository settings", choose: () => showRepository() });
        const list = documentsList({
            name: current.name,
            placeLabel: note ? `${shown.label}: ${note}` : shown.label,
            entries,
            currentId: shown === current.store ? current.id : undefined,
            canCreate: shown.can.create,
            canRename: !!current.store?.can.rename,
            canRemove: shown.can.remove,
            places,
            trash: shown === browser ? await browser.trash() : undefined,
            open: async (entry) => {
                menu.close(false);
                await editor.open(shown, entry);
                welcome?.go();
                editor.surface.focus();
            },
            create: async () => {
                menu.close(false);
                await editor.create(shown, shown === browser ? "Untitled" : fileName("Untitled"));
                welcome?.go();
                editor.surface.focus();
            },
            rename: async (name) => {
                await editor.rename(name);
                await showDocuments();
            },
            remove: async (entry) => {
                await shown.remove(entry.id).catch(() => undefined);
                await showDocuments();
            },
            restore: async (entry) => {
                await browser.restore(entry.id);
                await showDocuments();
            },
        });
        if (from) menu.open(from, list);
    }

    // ---- connecting a repository ----
    function showRepository() {
        const form = repositoryForm({
            settings,
            back: () => void showDocuments(),
            forget: async () => {
                forgetSettings(local());
                settings = undefined;
                const was = github;
                github = undefined;
                if (editor.current().store === was) {
                    const newest = (await browser.list())[0];
                    if (newest) await editor.open(browser, newest);
                    else await editor.create(browser, "Untitled");
                }
                shown = browser;
                await showDocuments();
            },
            connect: async (values) => {
                const where = repository(values.repository);
                if (!where) return "The repository is written as owner/name.";
                if (!values.token.trim()) return "An access token is needed.";
                const next = { ...where, branch: values.branch.trim() || "main", folder: folderPath(values.folder), pictures: folderPath(values.pictures) || folderPath(values.folder), token: values.token.trim() };
                const store = githubStore(next, options.fetcher);
                try {
                    await store.list();
                } catch (error) {
                    return `It could not be opened: ${error instanceof Error ? error.message : String(error)}`;
                }
                const storage = local();
                if (storage) keepSettings(next, storage);
                settings = next;
                github = store;
                shown = store;
                await showDocuments();
                return undefined;
            },
        });
        if (from) menu.open(from, form);
        form.querySelector("input")?.focus({ preventScroll: true });
    }

    // ---- the welcome, the first time ----
    const welcome = firstRun ? showWelcome() : undefined;
    function showWelcome() {
        const card = make("div", "quire-welcome");
        const inner = make("div", "quire-welcome-inner");
        inner.append(make("p", "quire-welcome-title", "Start writing."), make("p", "quire-welcome-said", "It is kept in this browser as you type."));
        const choices = make("div", "quire-welcome-choices");
        const choice = (label: string, run: () => void) => {
            const button = make("button", "quire-button quire-choice", label);
            button.type = "button";
            button.addEventListener("click", run);
            choices.append(button);
        };
        choice("Open a file", () => chooser.click());
        if (able.folder) choice("Open a folder", () => {
            from = editor.nameElement();
            void openFolder();
        });
        choice("Connect a repository", () => {
            from = editor.nameElement();
            showRepository();
        });
        if (options.sample) choice("See a sample", () => {
            editor.surface.setDocument(read(options.sample!, { mdx: true }));
            go();
        });
        inner.append(choices);
        card.append(inner);
        (host.querySelector(".quire-title") ?? host.querySelector(".quire-paper")?.firstChild)?.after(card);
        requestAnimationFrame(() => card.classList.add("shown"));
        // it goes as soon as the writer starts writing or chooses somewhere else
        const stop = editor.surface.on("change", () => go());
        function go() {
            stop();
            card.classList.remove("shown");
            card.inert = true;
            setTimeout(() => card.remove(), 600);
        }
        return { go };
    }

    editor.surface.focus();
    return { editor, browser, files };
}
