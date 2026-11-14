// mdQuire as a whole, as its public page shows it: the editor, writing to a document in one of the
// places documents can live, with the documents list growing out of the name in the bar, the way
// to open a file or a folder, and the form that connects a GitHub repository. With nothing open it
// shows the home screen (shelf.ts): ways to start something new and the recent documents from
// every place, a row each, each opening by growing out of its row. The document the writer was in is
// remembered in this browser and opened again next time; leaving it for the home screen forgets it.
//
//   const app = await startApp(element, { colors });

import { createEditor, type Editor } from "./editor";
import { documentsList, repositoryForm, type Place } from "./documents";
import { drivePlace, type DriveOptions } from "./drive-place";
import { blockPaths, lengthOf } from "./document";
import { read } from "./read";
import { emptyParts, opened, type Parts } from "./quire-file";
import { copyDocument, fileName, type Entry, type Store } from "./store";
import { browserStore, indexedTables, memoryTables } from "./store-browser";
import { filesStore, OPENABLE } from "./store-files";
import { canOpen, folderStore, oneFileStore, type FileHandle, type FolderHandle } from "./store-folder";
import { folderPath, forgetSettings, githubStore, keepSettings, readSettings, repository, type Fetcher } from "./store-github";
import { boxOf, copyName, createShelf, recent, templates, travel, type Listed, type Template } from "./shelf";
import { openDialog } from "./dialog";
import { flowMenu, make, type Box } from "./ui";

/** What the page gives the app. */
export interface AppOptions {
    colors?: { name: string; value: string }[];
    /** A document with every kind of block, offered on the home screen. */
    sample?: string;
    /** The network, for the repository store; the browser's own if not given. */
    fetcher?: Fetcher;
    /** The name of the browser database. */
    database?: string;
    /** Google Drive: the client ID, and for the test page a Drive and a sign-in that stand in for Google's. */
    drive?: DriveOptions;
    /** The page's top: its two lines, with places marked for the document's name, the menu words, how saving stands and the tools. */
    top?: HTMLElement;
}

/** Where the writer was, remembered in this browser. */
const PLACE_KEY = "quire-place";

/** The home screen's ways to start as File, New names them, with their icons. */
const NEW: Record<string, [string, string]> = { blank: ["Document", "file"], post: ["Blog post", "pen"], notes: ["Notes", "task"], meeting: ["Meeting notes", "comment"], changelog: ["Changelog entry", "history"], project: ["Project page", "component"] };

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
    // a browser that keeps nothing (some private windows, site data blocked) still opens mdQuire: documents
    // are then kept in this tab only, and the status says so, as it does for a file opened from the computer
    const tables = await indexedTables(options.database).catch(() => undefined);
    const browser = tables ? browserStore(tables) : { ...browserStore(memoryTables()), note: "This browser is not keeping documents, so this one is kept in this tab only: download it to keep it." };
    const files = filesStore();
    let folder: Store | undefined;
    let settings = readSettings(local());
    let github = settings ? githubStore(settings, options.fetcher) : undefined;
    // Google Drive, locked with a passphrase in this tab (drive-place.ts); signing in again saves what waited
    const drive = drivePlace({ ...options.drive, onSignedIn: () => void editor.flush() });
    const keyOf = (store: Store) => (store === browser ? "browser" : store === github ? "github" : store === files ? "files" : store === drive.store() ? "drive" : "folder");

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
    // with nothing remembered, nothing is open and the home screen is shown

    const remember = (store: Store, entry: Entry) => {
        const place = keyOf(store);
        // a file or folder opened from the computer cannot be opened again without being chosen again
        try {
            if (place === "browser" || place === "github") local()?.setItem(PLACE_KEY, JSON.stringify({ place, id: entry.id, name: entry.name }));
        } catch {
            // a browser with no room keeps working; the document is only not opened again next time
        }
    };

    // the documents list is shown for a place, which is the current document's until another is chosen
    let shown: Store = start?.store ?? browser;
    const menu = flowMenu("Documents", { className: "quire-documents-menu" });
    let from: HTMLElement | undefined;

    const editor: Editor = createEditor(host, start ? opened(start.text, start.quire, { mdx: /\.mdx$/i.test(start.entry.id) }) : read(""), {
        name: start?.entry.name ?? "Untitled",
        store: start?.store,
        id: start?.entry.id,
        mark: start?.mark,
        versions: browser.versions,
        colors: options.colors,
        top: options.top,
        richHome: browser,
        // suggested words are learned from her documents here and in what she has already let mdQuire open; never from GitHub or Drive, which would mean fetching every document
        learnFrom: () => [browser, folder, files].filter((store): store is Store => !!store),
        // the File menu's first lines, as Docs has them: New, with the home screen's ways to start, and Open, the documents list, where the places to open from are
        fileItems: () => [
            { label: "New", icon: "plus", items: () => templates(new Date()).map((template) => ({ label: NEW[template.key]?.[0] ?? template.label, icon: NEW[template.key]?.[1], words: ["new document"], run: () => void startFrom(template, editor.nameElement()) })), run: () => {} },
            { label: "Open", icon: "folder", words: ["documents", "open a file", "open a folder", "github", "repository", "google drive"], run: () => ((from = editor.nameElement()), (shown = editor.current().store ?? browser), void showDocuments()) },
        ],
        onOpen: remember,
        onName: (button) => {
            if (menu.isOpen()) return menu.close(true);
            from = button;
            shown = editor.current().store ?? browser;
            void showDocuments();
        },
    });
    if (start) remember(start.store, start.entry);

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
        const entry = await files.add(picked).catch((error) => void editor.say("Not opened", `${picked.name} was not opened: ${error instanceof Error ? error.message : String(error)}`));
        if (!entry) return;
        if (!(await editor.open(files, entry))) return;
        await showEditor();
        editor.surface.focus();
    });
    const pickers = globalThis as unknown as { showOpenFilePicker?: (options: object) => Promise<FileHandle[]>; showDirectoryPicker?: (options: object) => Promise<FolderHandle> };
    const able = canOpen();
    const openInPlace = async () => {
        const [handle] = (await pickers.showOpenFilePicker?.({ types: [{ description: "Markdown and .quire documents", accept: { "text/markdown": [".md", ".mdx", ".markdown", ".txt"], "application/zip": [".quire"] } }] }).catch(() => [])) ?? [];
        if (!handle) return;
        const store = oneFileStore(handle);
        if (!(await editor.open(store, { id: handle.name, name: handle.name }))) return;
        menu.close(false);
        await showEditor();
    };
    const openFolder = async () => {
        const handle = await pickers.showDirectoryPicker?.({ mode: "readwrite" }).catch(() => undefined);
        if (!handle) return;
        folder = folderStore(handle);
        shown = folder;
        await placesChanged();
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
            { key: "file", label: "A file, as a copy", choose: () => chooser.click() },
            able.file ? { key: "in-place", label: "A file, saving to it", choose: () => void openInPlace() } : { key: "in-place", label: "", absent: "This browser cannot save to a file; Chrome and Edge can.", choose: () => {} },
            able.folder ? { key: "folder", label: folder ? `Folder: ${folder.label}` : "A folder", current: shown === folder && !!folder, choose: () => (folder && shown !== folder ? ((shown = folder), void showDocuments()) : void openFolder()) } : { key: "folder", label: "", absent: "Folders can be opened in Chrome and Edge.", choose: () => {} },
            github
                ? { key: "github", label: `GitHub: ${github.label}`, current: shown === github, choose: () => ((shown = github!), void showDocuments()) }
                : { key: "github", label: "GitHub", choose: (button) => showRepository(button) },
        ];
        if (github) places.push({ key: "github-settings", label: "GitHub settings", choose: (button) => showRepository(button) });
        places.push(...drivePlaces());
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
                // opened from the list over the home screen, the home screen makes way
                if (await editor.open(shown, entry)) await showEditor();
                editor.surface.focus();
            },
            create: async () => {
                menu.close(false);
                // Google Drive keeps documents by name, as the browser does, and so makes `.quire` ones with a plain name
                const made = shown === browser || shown === drive.store() ? editor.create(shown, "Untitled", "", emptyParts()) : editor.create(shown, fileName("Untitled"));
                if (await made) await showEditor();
                editor.surface.focus();
            },
            rename: async (name, done) => {
                if (done) finish();
                await editor.rename(name);
                if (!done && menu.isOpen()) await showDocuments();
            },
            finish,
            remove: async (entry) => {
                const problem = await shown.remove(entry.id).then(() => undefined, (error) => `${entry.name} was not deleted: ${error instanceof Error ? error.message : String(error)}`);
                await showDocuments(problem);
            },
            restore: async (entry) => {
                await browser.restore(entry.id);
                await showDocuments();
            },
        });
        if (from) menu.open(from, list);
    }

    /** Closes the documents list and gives the text back. */
    function finish() {
        menu.close(false);
        if (!shelf.shown()) editor.surface.focus();
    }

    // ---- connecting a repository: a form of five fields, so a dialog, grown out of what was pressed ----
    function showRepository(pressed?: HTMLElement) {
        const kept = settings;
        const forget = async () => {
            forgetSettings(local());
            settings = undefined;
            const was = github;
            github = undefined;
            if (editor.current().store === was) {
                const newest = (await browser.list())[0];
                if (newest) await editor.open(browser, newest);
                else await editor.create(browser, "Untitled", "", emptyParts());
            }
            shown = browser;
            await placesChanged();
        };
        const form = repositoryForm({
            settings,
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
                try {
                    if (storage) keepSettings(next, storage);
                } catch {
                    return "It could not be kept in this browser, which has no room or keeps nothing.";
                }
                settings = next;
                github = store;
                shown = store;
                return undefined;
            },
        });
        // the documents list it may have been opened from has closed; closing, it goes back to what opened the list
        const back = from;
        openDialog(pressed?.isConnected ? pressed : back, {
            title: "Write in a GitHub repository",
            className: "quire-repository-dialog",
            body: [form.element],
            returnTo: back,
            others: kept ? [{ label: "Forget", far: true, press: (dialog) => void dialog.close().then(forget) }] : [],
            dismiss: "Cancel",
            action: {
                label: kept ? "Save and open" : "Connect",
                press: (button, dialog) => {
                    button.disabled = true;
                    void form.send().then(async (connected) => {
                        button.disabled = false;
                        if (!connected) return;
                        await dialog.close();
                        await placesChanged();
                    });
                },
            },
        });
        form.element.querySelector("input")?.focus({ preventScroll: true });
    }

    // ---- Google Drive ----
    /** Google Drive's lines among the places: not set up, to open, or open with a way to lock it. */
    function drivePlaces(): Place[] {
        // until it is set up it is not offered at all: the note that it is not is for the owner, not the writer
        if (drive.state() === "not set up") return [];
        const open = drive.store();
        const lines: Place[] = [open ? { key: "drive", label: "Google Drive", current: shown === open, choose: () => ((shown = open), void showDocuments()) } : { key: "drive", label: "Google Drive", choose: (button) => void openDrive(button) }];
        if (open) lines.push({ key: "drive-out", label: "Lock Google Drive and sign out", choose: () => void signOutDrive() });
        return lines;
    }

    /** Opens Google Drive (signing in and asking the passphrase if need be) and shows its documents. */
    async function openDrive(button?: HTMLElement) {
        const store = await drive.open(button);
        if (!store) return;
        shown = store;
        from = button?.isConnected ? button : editor.nameElement();
        // its documents are shown at once, with New document among them, from the shelf as from the editor
        if (shelf.shown()) await shelf.refresh();
        await showDocuments();
    }

    /** Locks Google Drive and signs out of it in this tab; a document open from there is left first. */
    async function signOutDrive() {
        const was = drive.store();
        if (was && editor.current().store === was) {
            const newest = (await browser.list())[0];
            if (!(await (newest ? editor.open(browser, newest) : editor.create(browser, "Untitled", "", emptyParts())))) return;
        }
        drive.signOut();
        shown = browser;
        await placesChanged();
    }

    /** After a place is connected or forgotten: the home screen shows it, or else the documents list does. */
    async function placesChanged() {
        if (!shelf.shown()) return showDocuments();
        menu.close(false);
        await shelf.refresh();
    }

    // ---- the home screen, with nothing open ----
    const keyFor = (store: Store, id: string) => `${keyOf(store)}:${id}`;
    const shelf = createShelf({
        templates: templates(new Date()),
        start: (template, from) => void startFrom(template, from),
        documents: async () => {
            const places = [browser, github, drive.store(), folder, files].filter((store): store is Store => !!store);
            const lists = await Promise.all(places.map(async (store) => ({ store, entries: await store.list().catch(() => []) })));
            return recent(lists).map(({ store, id, name, modified }): Listed => ({
                key: keyFor(store, id),
                name,
                // the two places that are this machine are said in lowercase, as the row's other words are; a folder or a repository keeps its own name
                place: store === browser ? "this browser" : store === files ? "this computer" : store.label,
                modified,
                open: (from) => void enter(store, { id, name }, from),
                rename: store.can.rename ? async (wanted) => void (await store.rename(id, wanted).catch(() => undefined), await shelf.refresh()) : undefined,
                duplicate: store.can.create ? async () => void (await copyDocument(store, id, copyName(name))) : undefined,
                remove: store.can.remove ? async () => void (await store.remove(id).catch(() => undefined)) : undefined,
            }));
        },
        ways: () => [
            { label: "open a file", run: () => chooser.click() },
            ...(able.folder ? [{ label: "open a folder", run: (button: HTMLElement) => ((from = button), void openFolder()) }] : []),
            { label: github ? "repository settings" : "connect a repository", run: (button: HTMLElement) => ((from = button), showRepository()) },
            ...(drive.state() !== "not set up" ? [{ label: "google drive", run: (button: HTMLElement) => void openDrive(button) }] : []),
            ...(options.sample ? [{ label: "see a sample", run: (button: HTMLElement) => void startFrom({ key: "sample", label: "A sample", name: "A sample", text: options.sample!, quire: true }, button) }] : []),
        ],
    });
    host.append(shelf.element);

    /** Opens a document from its row on the home screen. */
    async function enter(store: Store, entry: Entry, from: HTMLElement) {
        const picture = boxOf(from);
        if (!(await editor.open(store, entry))) return;
        await showEditor(picture);
        editor.surface.focus();
    }

    /** Makes something new from a way of starting, and opens it from the word pressed. */
    async function startFrom(template: Template, from: HTMLElement) {
        const picture = boxOf(from);
        if (!(await editor.create(browser, template.name, template.text, template.quire ? emptyParts() : undefined))) return;
        await showEditor(picture);
        // the last line a template starts with stands in for what is written there, and is selected, so that typing takes its place
        const paths = blockPaths(editor.surface.getDocument());
        const last = paths[paths.length - 1] ?? [0];
        editor.surface.setSelection({ anchor: { path: last, offset: 0 }, focus: { path: last, offset: lengthOf(editor.surface.getDocument(), last) } });
        editor.surface.focus();
    }

    /** Puts the home screen away and shows the document, the page growing out of where it was pressed if there is such a place. */
    async function showEditor(picture?: Box) {
        if (!shelf.shown()) return;
        scrollTo({ top: 0, behavior: "instant" });
        host.classList.remove("shelved");
        options.top?.classList.remove("away");
        shelf.hide();
        if (picture) await travel(editor.paper, picture, true);
    }

    // "mdQuire" in the page's trail leads to the shelf: with a document open it goes there without leaving the page
    options.top?.querySelector(".quire-word")?.addEventListener("click", (event) => {
        if (shelf.shown() || (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) return;
        event.preventDefault();
        void home();
    });

    /** Leaves the document for the home screen: it is saved, and its page shrinks back into its row there. */
    async function home() {
        if (shelf.shown()) return;
        menu.close(false);
        const current = editor.current();
        // words that could not be saved keep the writer in the document until she chooses
        if (!(await editor.ready())) return;
        await shelf.refresh();
        scrollTo({ top: 0, behavior: "instant" });
        options.top?.classList.add("away");
        shelf.show();
        const row = current.store && current.id ? shelf.rowOf(keyFor(current.store, current.id)) : undefined;
        if (row) {
            row.style.visibility = "hidden";
            await travel(editor.paper, boxOf(row), false);
            row.style.visibility = "";
        }
        host.classList.add("shelved");
        if (!(await editor.leave())) {
            // typed while going home and not saved: back to the document
            host.classList.remove("shelved");
            options.top?.classList.remove("away");
            shelf.hide();
            return;
        }
        local()?.removeItem(PLACE_KEY);
        // the keyboard comes back to the row of the document left, or to the first way to start
        (row?.querySelector<HTMLElement>(".quire-shelf-open") ?? shelf.element.querySelector<HTMLElement>(".quire-shelf-word"))?.focus({ preventScroll: true });
    }

    if (!start) {
        host.classList.add("shelved");
        options.top?.classList.add("away");
        await shelf.refresh();
        shelf.show();
        return { editor, browser, files, shelf };
    }

    editor.surface.focus();
    return { editor, browser, files, shelf };
}
