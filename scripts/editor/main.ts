// The page `bun run edit` opens: mdQuire (src/quire/), writing the site's own files through the
// small server in scripts/write.ts, with what only this place needs around it: the real page
// beside the text (shown and hidden from the three-dot menu), a post's frontmatter as a form of
// its fields above the text with the raw lines behind a switch, the notes on photographs, and the
// publish dialog. The server is the one that reads and writes; this only asks it.

import { accents } from "../../src/data/theme";
import { css } from "../../src/lib/color";
import { fields, setField, type Document } from "../../src/quire/md/document";
import { documentsList } from "../../src/quire/documents";
import { createEditor } from "../../src/quire/md/editor";
import { read, subtitleFromFront } from "../../src/quire/md/read";
import { subtitleToFront } from "../../src/quire/md/write";
import { browserStore, indexedTables } from "../../src/quire/store-browser";
import { flowMenu, make } from "../../src/quire/ui";
import { editStore, PHOTOS, server, type Offered } from "./store";

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
const key = meta("edit-key");
// The key came in the address; the page has it from its meta tag now, so it is taken out of the
// address bar and the history, where anyone looking over a shoulder or at the history could read it.
const bare = new URL(location.href);
bare.searchParams.delete("k");
history.replaceState(history.state, "", bare);
const site = meta("edit-site");
const ask = server(key);
const remembered = (() => {
    try {
        return localStorage.getItem("edit-last") ?? "";
    } catch {
        return "";
    }
})();

let offered: Offered[] = [];
const store = editStore(key, (groups) => (offered = groups.flatMap((group) => group.files)));
const preview = document.querySelector<HTMLIFrameElement>("#preview")!;
const host = document.querySelector<HTMLElement>("#quire")!;
const names: Record<string, string> = { violet: "Violet", pink: "Pink", blue: "Blue", mint: "Mint", amber: "Amber" };
const colors = Object.entries(accents).map(([name, value]) => ({ name: names[name] ?? name, value: css(value) }));

const entries = await store.list();
const documents = entries.filter((entry) => entry.id !== PHOTOS);
const first = documents.find((entry) => entry.id === remembered) ?? documents[0]!;
const opened = await store.open(first.id);
const versions = browserStore(await indexedTables("quire-edit")).versions;

/** Writes one frontmatter value: one written in quotes keeps them, and one written bare stays bare (a date, a list, true), unless what is typed would then read as something else. */
function writeField(now: Document, name: string, value: string): Document {
    const line = now.frontmatter?.split(/\r?\n/).find((each) => each.startsWith(`${name}:`)) ?? "";
    const was = line.slice(name.length + 1).trim();
    // a value written in quotes stays in the same quotes
    if (was.startsWith('"')) return setField(now, name, JSON.stringify(value), true);
    if (was.startsWith("'")) return setField(now, name, `'${value.replace(/'/g, "''")}'`, true);
    const bare = !/^["']/.test(was) && !/: | #|^[\s"'&*!|>%@`]/.test(value) && value !== "";
    return setField(now, name, value, bare);
}

const editor = createEditor(host, read(opened.text, { mdx: /\.mdx$/.test(first.id) }), {
    name: first.name,
    store,
    id: first.id,
    mark: opened.mark,
    versions,
    colors,
    top: document.querySelector<HTMLElement>(".quire-top") ?? undefined,
    // suggested words are learned from the site's own posts and pages
    learnFrom: () => [store],
    // a post's title is its frontmatter's; a file without one is titled by its name
    title: {
        read: (doc) => fields(doc).find(([field]) => field === "title")?.[1] ?? null,
        write: (doc, value) => writeField(doc, "title", value),
    },
    onOpen: (_store, entry) => arrive(entry.id),
    onName: (button) => (files.isOpen() ? files.close(true) : void showFiles(button)),
    more: () => [
        { label: document.body.classList.contains("no-preview") ? "Show the page" : "Hide the page", run: () => document.body.classList.toggle("no-preview") },
        { label: "Publish", run: () => void publish() },
    ],
});

// ---- arriving at a file: its page beside it, its frontmatter above it ----

function arrive(path: string) {
    try {
        localStorage.setItem("edit-last", path);
    } catch {
        // it is only a convenience to come back to the same file
    }
    document.body.classList.remove("notes");
    const route = offered.find((file) => file.path === path)?.route ?? "/";
    if (preview.dataset.route !== route) {
        preview.dataset.route = route;
        preview.src = site + route;
    }
    // the site's intro is TypeScript, not Markdown: it is written as its text alone
    editor.view({ plain: path.endsWith(".ts"), outline: false });
    front.show(editor.surface.getDocument(), !path.endsWith(".ts"));
}

// ---- the frontmatter, as a form of its fields, with its raw lines behind a switch ----

const front = (() => {
    const box = make("div", "edit-front");
    const rows = make("div", "edit-front-fields");
    const raw = make("textarea", "edit-front-raw");
    raw.spellcheck = false;
    raw.setAttribute("aria-label", "The frontmatter as it is written");
    const swap = make("button", "quire-button edit-front-swap", "Edit as text");
    swap.type = "button";
    box.append(rows, raw, swap);
    host.querySelector(".quire-title")!.after(box);
    let shownFront: string | null = null;

    /** The frontmatter's lines between its two fences, and the fences, so that the middle can be written back alone. */
    const parts = (frontmatter: string) => {
        const lines = frontmatter.split(/(?<=\n)/);
        return { open: lines[0]!, middle: lines.slice(1, -1).join(""), close: lines.at(-1)! };
    };

    function show(doc: Document, markdown: boolean) {
        shownFront = doc.frontmatter;
        box.classList.toggle("absent", !markdown || doc.frontmatter === null);
        rows.replaceChildren(
            // the title is the large line on the sheet, and the subtitle the line under it, not fields here
            ...fields(doc)
                .filter(([name]) => name !== "title" && name !== "subtitle")
                .map(([name, value]) => {
                const row = make("label", "edit-front-row");
                row.append(make("span", "edit-front-name", name));
                const input = make("input", "quire-link-field");
                input.value = value;
                input.spellcheck = name === "title" || name === "summary" || name.endsWith("Alt");
                input.addEventListener("input", () => {
                    editor.surface.run((now) => writeField(now, name, input.value), "type");
                    shownFront = editor.surface.getDocument().frontmatter;
                    raw.value = shownFront ? parts(shownFront).middle : "";
                });
                row.append(input);
                return row;
            }),
        );
        // as it will be written, with the subtitle line as typed under the title
        const written = subtitleToFront(doc).frontmatter;
        raw.value = written ? parts(written).middle : "";
    }

    raw.addEventListener("input", () => {
        editor.surface.run((now) => {
            if (!now.frontmatter) return now;
            const { open, close } = parts(now.frontmatter);
            const eol = now.eol;
            // a subtitle typed here is the line under the title
            return subtitleFromFront({ ...now, frontmatter: open + raw.value + (raw.value.endsWith("\n") || raw.value === "" ? "" : eol) + close });
        }, "type");
        shownFront = editor.surface.getDocument().frontmatter;
    });
    swap.addEventListener("click", () => {
        const asText = box.classList.toggle("as-text");
        swap.textContent = asText ? "Edit as fields" : "Edit as text";
        if (!asText) show(editor.surface.getDocument(), true);
    });
    // a change from elsewhere (undo, the Markdown view) is shown, unless it is being typed here
    editor.surface.on("change", ({ doc }) => {
        if (doc.frontmatter !== shownFront && !box.contains(document.activeElement)) show(doc, !box.classList.contains("absent") || doc.frontmatter !== null);
    });
    return { show };
})();

// ---- the list of files, from the name ----

const files = flowMenu("Files", { className: "quire-documents-menu" });
async function showFiles(from: HTMLElement) {
    const all = await store.list();
    const current = editor.current();
    const list = documentsList({
        name: current.name,
        placeLabel: "This site",
        entries: all,
        currentId: current.id,
        canCreate: true,
        canRename: false,
        canRemove: false,
        places: [],
        finish: () => {
            files.close(false);
            editor.surface.focus();
        },
        open: async (entry) => {
            files.close(false);
            if (entry.id === PHOTOS) return notes.open();
            await editor.open(store, entry);
            editor.surface.focus();
        },
        create: () => {
            // a new post needs its title first; the server makes the file with its frontmatter
            const form = make("form", "quire-repository");
            const title = make("input", "quire-link-field");
            title.placeholder = "The new post's title";
            title.setAttribute("aria-label", "The new post's title");
            title.addEventListener("keydown", (event) => event.stopPropagation());
            form.append(make("p", "quire-repository-title", "A new post"), title);
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!title.value.trim()) return;
                files.close(false);
                await editor.create(store, title.value.trim());
                editor.surface.focus();
            });
            files.open(from, form);
            title.focus({ preventScroll: true });
        },
        rename: () => {},
        remove: () => {},
    });
    files.open(from, list);
}

// ---- notes on photographs ----

const notes = (() => {
    interface Note {
        file: string;
        title?: string;
        note?: string;
    }
    const box = make("section", "edit-notes");
    box.setAttribute("aria-label", "Notes on photographs");
    const bar = make("p", "edit-notes-bar");
    const back = make("button", "quire-button", "Back");
    const next = make("button", "quire-button", "Next");
    const count = make("span", "edit-notes-count");
    const done = make("button", "quire-button", "Back to writing");
    for (const button of [back, next, done]) button.type = "button";
    bar.append(back, next, count, done);
    const picture = make("img", "edit-notes-picture");
    picture.alt = "";
    const title = make("input", "quire-link-field");
    title.placeholder = "a few words naming it";
    title.setAttribute("aria-label", "Heading");
    const note = make("textarea", "quire-link-field edit-notes-text");
    note.rows = 4;
    note.placeholder = "notes about this one, as rough as you like";
    note.setAttribute("aria-label", "Notes");
    const said = make("p", "edit-notes-said");
    said.setAttribute("role", "status");
    box.append(bar, picture, title, note, said);
    document.querySelector("main")!.append(box);
    let photos: Note[] = [];
    let at = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function draw() {
        const photo = photos[at];
        if (!photo) return;
        picture.src = `/api/asset?file=${PHOTOS}&src=/photos/${encodeURIComponent(photo.file)}&k=${key}`;
        title.value = photo.title ?? "";
        note.value = photo.note ?? "";
        count.textContent = `${at + 1} of ${photos.length}`;
    }
    const save = async () => {
        const photo = photos[at];
        if (!photo) return;
        photo.title = title.value;
        photo.note = note.value;
        try {
            await ask("/api/photos/note", { file: photo.file, title: photo.title, note: photo.note });
            said.textContent = "Saved";
        } catch (error) {
            said.textContent = `Not saved: ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    const changed = () => {
        said.textContent = "Not saved yet";
        clearTimeout(timer);
        timer = setTimeout(() => void save(), 700);
    };
    const step = async (by: number) => {
        clearTimeout(timer);
        await save();
        at = (at + by + photos.length) % photos.length;
        draw();
    };
    title.addEventListener("input", changed);
    note.addEventListener("input", changed);
    back.addEventListener("click", () => void step(-1));
    next.addEventListener("click", () => void step(1));
    done.addEventListener("click", () => {
        document.body.classList.remove("notes");
        box.inert = true;
        editor.surface.focus();
    });
    // Ctrl+Enter in the notes moves on to the next picture
    box.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void step(1);
        }
    });
    box.inert = true;
    return {
        async open() {
            photos = (await ask<{ photos: Note[] }>("/api/photos")).photos;
            at = 0;
            draw();
            document.body.classList.add("notes");
            box.inert = false;
            title.focus({ preventScroll: true });
        },
    };
})();

// ---- publishing ----

interface Plan {
    ok: boolean;
    log: string;
    pages: number;
    drafts: string[];
    changed: string;
    message: string;
    dryRun: boolean;
}

const dialog = (() => {
    const panel = make("aside", "quire-conflict edit-publish");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Publish");
    panel.inert = true;
    const head = make("div", "quire-conflict-head");
    head.append(make("p", "quire-conflict-title", "Publish"));
    const report = make("pre", "edit-publish-report");
    const message = make("input", "quire-link-field edit-publish-message");
    message.setAttribute("aria-label", "Commit message");
    const actions = make("div", "quire-conflict-choices");
    const deploy = make("button", "quire-button quire-choice", "Deploy to bybrooklyn.dev");
    const close = make("button", "quire-button quire-choice", "Close");
    deploy.type = close.type = "button";
    actions.append(deploy, close);
    panel.append(head, report, message, actions);
    document.body.append(panel);
    const shut = () => {
        panel.classList.remove("open");
        panel.inert = true;
        editor.surface.focus();
    };
    close.addEventListener("click", shut);
    panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape") shut();
    });
    deploy.addEventListener("click", async () => {
        deploy.disabled = true;
        report.textContent = "Committing, pushing and deploying.";
        try {
            const result = await ask<{ ok: boolean; log: string }>("/api/publish", { message: message.value });
            report.textContent = result.log;
            panel.classList.remove("ready", "with-message");
        } catch (error) {
            report.textContent = error instanceof Error ? error.message : String(error);
        }
    });
    return {
        async open() {
            await editor.flush();
            report.textContent = "Checking that the site still builds. This takes a few seconds.";
            panel.classList.remove("ready", "with-message");
            panel.classList.add("open");
            panel.inert = false;
            close.focus({ preventScroll: true });
            try {
                const plan = await ask<Plan>("/api/plan", { path: editor.current().id ?? "" });
                if (!plan.ok) {
                    report.textContent = `The check failed, so nothing can be published yet.\n\n${plan.log}`;
                    return;
                }
                report.textContent = [
                    `Built ${plan.pages} pages.`,
                    plan.drafts.length > 0 ? `Still drafts, so not going live:\n${plan.drafts.map((draft) => `  ${draft}`).join("\n")}` : "Nothing is marked as a draft.",
                    plan.changed ? `Changed files that will be committed:\n${plan.changed}` : "No files changed since the last commit; this would only deploy.",
                    plan.dryRun ? "This is a dry run: it will stop before the commit and the deploy." : "",
                ]
                    .filter(Boolean)
                    .join("\n\n");
                message.value = plan.message;
                panel.classList.toggle("with-message", !!plan.changed);
                panel.classList.add("ready");
                deploy.disabled = false;
            } catch (error) {
                report.textContent = error instanceof Error ? error.message : String(error);
            }
        },
    };
})();

async function publish() {
    await dialog.open();
}

arrive(first.id);
editor.surface.focus();
