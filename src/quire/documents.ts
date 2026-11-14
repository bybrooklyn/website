// The documents list, which flows out of the document's name in the bar: the name to rename, the
// documents in the place this one lives, a new one, the other places to open from (this browser, a
// file, a folder, GitHub), and the browser's trash. A list to pick from, so a menu. And the form
// that connects a repository, which is a form of several fields and so a dialog (app.ts opens it).
// What is shown is built here; app.ts says what each choice does. Filtering a long list is pure and
// tested.

import { enterGivesBack } from "./md/fields";
import type { Entry } from "./store";
import { composing, control, icon, make } from "./ui";

/** The entries whose name has every word of the query in it, in the order they came. */
export function filterEntries(entries: Entry[], query: string): Entry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter((entry) => words.every((word) => entry.name.toLowerCase().includes(word)));
}

/** A place documents can live, as the list offers it. */
export interface Place {
    key: string;
    label: string;
    /** Why it cannot be chosen here, if it cannot. */
    absent?: string;
    current?: boolean;
    /** Told the button that was pressed, for what grows out of it. */
    choose: (button?: HTMLElement) => void;
}

/** The places the list offers to open from: those that can be chosen, less the one shown, whose name already heads the documents. */
export function placesOffered(places: Place[]): Place[] {
    return places.filter((place) => !place.current);
}

/** What the documents list shows, and what to call for each thing in it. */
export interface DocumentsView {
    name: string;
    placeLabel: string;
    entries: Entry[];
    currentId?: string;
    canCreate: boolean;
    canRename: boolean;
    canRemove: boolean;
    places: Place[];
    trash?: Entry[];
    open(entry: Entry): void;
    create(): void;
    /** Renames the document; `done` when it was asked for with Enter, which closes the list and gives the text back. */
    rename(name: string, done: boolean): void;
    /** Closes the list and gives the text back, as Enter in the name does when the name did not change. */
    finish(): void;
    remove(entry: Entry): void;
    restore?(entry: Entry): void;
}

/** Builds the documents list. */
export function documentsList(view: DocumentsView): HTMLElement {
    const box = make("div", "quire-documents");
    let line = 0;
    const next = <T extends HTMLElement>(element: T) => {
        element.style.setProperty("--line-at", String(Math.min(line++, 14)));
        return element;
    };

    // the name, to rename in place
    const naming = next(make("label", "quire-documents-rename"));
    naming.append(make("span", "quire-outline-title", "Name"));
    const field = make("input", "quire-link-field");
    field.value = view.name;
    field.disabled = !view.canRename;
    field.setAttribute("aria-label", "This document's name");
    let renamed = false;
    field.addEventListener("keydown", (event) => {
        // Escape is the menu's, which closes as it does from any line; the name typed is let go first
        if (event.key === "Escape") {
            field.value = view.name;
            return;
        }
        event.stopPropagation();
        if (event.key !== "Enter" || composing(event)) return;
        event.preventDefault();
        // Enter renames, closes the list and gives the text back
        renamed = true;
        if (field.value.trim() && field.value.trim() !== view.name) view.rename(field.value.trim(), true);
        else view.finish();
    });
    field.addEventListener("change", () => {
        if (!renamed && field.value.trim() && field.value.trim() !== view.name) view.rename(field.value.trim(), false);
    });
    naming.append(field);
    box.append(naming);

    // the documents where this one lives
    box.append(next(make("p", "quire-outline-title quire-documents-head", view.placeLabel)));
    const list = make("ul", "quire-documents-list");
    const draw = (entries: Entry[]) => {
        list.replaceChildren(
            ...entries.map((entry) => {
                const item = make("li", "quire-documents-item");
                const open = make("button", `quire-menu-line${entry.id === view.currentId ? " pressed" : ""}`, entry.name);
                open.type = "button";
                if (entry.id === view.currentId) open.setAttribute("aria-current", "true");
                open.addEventListener("click", () => view.open(entry));
                item.append(open);
                if (view.canRemove && entry.id !== view.currentId) {
                    // deleting asks once more in the same place, as the home list does: "Delete it" and "Keep it" in place of the line
                    const away = control(`Delete ${entry.name}`, icon("trash"), () => {
                        const sure = make("button", "quire-menu-line quire-documents-sure");
                        sure.type = "button";
                        sure.append(icon("trash"), make("span", "quire-menu-label", `Delete ${entry.name}`));
                        sure.addEventListener("click", () => view.remove(entry));
                        const keep = make("button", "quire-menu-line quire-documents-keep", "Keep it");
                        keep.type = "button";
                        keep.addEventListener("click", () => {
                            item.replaceChildren(open, away);
                            away.focus();
                        });
                        item.replaceChildren(sure, keep);
                        item.classList.add("asking");
                        sure.focus();
                    });
                    away.classList.add("quire-documents-away");
                    item.append(away);
                }
                return item;
            }),
        );
        if (!entries.length) list.append(make("li", "quire-history-none", "Nothing here yet."));
    };
    if (view.entries.length > 8) {
        const search = next(make("input", "quire-link-field quire-documents-search"));
        search.placeholder = "Find a document";
        search.setAttribute("aria-label", "Find a document");
        search.addEventListener("input", () => draw(filterEntries(view.entries, search.value)));
        search.addEventListener("keydown", (event) => event.stopPropagation());
        box.append(search);
    }
    draw(view.entries);
    box.append(next(list));
    if (view.canCreate) {
        const fresh = next(make("button", "quire-menu-line quire-documents-new"));
        fresh.type = "button";
        fresh.append(icon("plus"), make("span", "quire-menu-label", "New document"));
        fresh.addEventListener("click", () => view.create());
        box.append(fresh);
    }

    // the other places to open from
    box.append(next(make("p", "quire-outline-title quire-documents-head", "Open from")));
    for (const place of placesOffered(view.places)) {
        if (place.absent) {
            box.append(next(make("p", "quire-menu-note", place.absent)));
            continue;
        }
        const go = next(make("button", `quire-menu-line${place.current ? " pressed" : ""}`, place.label));
        go.type = "button";
        go.dataset.place = place.key;
        go.addEventListener("click", () => place.choose(go));
        box.append(go);
    }

    // the browser's trash, from where a document can be brought back
    if (view.trash?.length && view.restore) {
        box.append(next(make("p", "quire-outline-title quire-documents-head", "Deleted")));
        for (const entry of view.trash) {
            const back = next(make("button", "quire-menu-line quire-documents-trash"));
            back.type = "button";
            back.append(make("span", "quire-menu-label", entry.name), make("span", "quire-menu-hint", "Restore"));
            back.addEventListener("click", () => view.restore!(entry));
            box.append(back);
        }
    }
    return box;
}

/** What the repository form starts with, and what it calls. */
export interface RepositoryForm {
    settings?: { owner: string; repo: string; branch: string; folder: string; pictures: string; token: string };
    connect(values: { repository: string; branch: string; folder: string; pictures: string; token: string }): Promise<string | undefined>;
}

/**
 * Builds the form that connects a repository, for its dialog, saying plainly where the token is
 * kept and sent. `send()` tries what was typed and is true once it is connected; while it tries,
 * and when it is refused, the form says so in its own words.
 */
export function repositoryForm(form: RepositoryForm): { element: HTMLElement; send(): Promise<boolean> } {
    const box = make("div", "quire-repository");
    const field = (label: string, value: string, hint: string, type = "text") => {
        const row = make("label", "quire-repository-row");
        row.append(make("span", "quire-repository-label", label));
        const input = make("input", "quire-link-field");
        input.type = type;
        input.value = value;
        input.placeholder = hint;
        input.spellcheck = false;
        input.autocomplete = "off";
        row.append(input);
        box.append(row);
        return input;
    };
    const kept = form.settings;
    const repository = field("Repository", kept ? `${kept.owner}/${kept.repo}` : "", "owner/name");
    const branch = field("Branch", kept?.branch ?? "main", "main");
    const folder = field("Folder of documents", kept?.folder ?? "", "src/content/blog");
    const pictures = field("Folder for pictures", kept?.pictures ?? "", "src/assets/blog");
    const token = field("Access token", kept?.token ?? "", "github_pat_…", "password");
    const about = make("p", "quire-repository-about");
    about.append(
        "Use a fine-grained personal access token that can read and write the contents of this one repository and nothing else (",
        Object.assign(make("a", "", "make one on GitHub"), { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }),
        // Forget is offered only once a repository is kept, so it is spoken of only then
        `). It is kept only in this browser, in its local storage, and is sent only to api.github.com.${kept ? " To remove it, press Forget, or clear this site's data in the browser." : ""}`,
    );
    box.append(about);
    const said = make("p", "quire-repository-said");
    said.setAttribute("role", "status");
    box.append(said);
    let sending = false;
    async function send(): Promise<boolean> {
        if (sending) return false;
        sending = true;
        said.textContent = "Connecting";
        let problem: string | undefined;
        try {
            problem = await form.connect({ repository: repository.value, branch: branch.value, folder: folder.value, pictures: pictures.value, token: token.value });
        } catch (error) {
            // whatever went wrong, the reason is said
            problem = error instanceof Error ? error.message : String(error);
        }
        sending = false;
        said.textContent = problem ?? "";
        return !problem;
    }
    return { element: box, send };
}
