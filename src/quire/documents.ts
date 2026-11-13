// The documents list, which flows out of the document's name in the bar: the name to rename, the
// documents in the place this one lives, a new one, the other places documents can live (this
// browser, a file, a folder, a repository), and the browser's trash. And the form that connects a
// repository, which takes the list's place in the same box. What is shown is built here; app.ts
// says what each choice does. Filtering a long list is pure and tested.

import { enterGivesBack } from "./fields";
import type { Entry } from "./store";
import { control, icon, make } from "./ui";

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
    rename(name: string): void;
    /** Closes the list and gives the keyboard back to the writing, after Enter in the name. */
    done?(): void;
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
    field.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") field.value = view.name;
    });
    // Enter renames and gives the keyboard back to the writing (fields.ts); leaving the field renames too
    enterGivesBack(field, (name) => name && name !== view.name && view.rename(name), () => view.done?.());
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
                    // taking a document away asks once more on the same button, rather than in a dialog
                    const away = control(`Take ${entry.name} away`, icon("trash"), (button) => {
                        if (button.classList.contains("asking")) return view.remove(entry);
                        button.classList.add("asking");
                        button.setAttribute("aria-label", `Press again to take ${entry.name} away`);
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

    // the places documents can live
    box.append(next(make("p", "quire-outline-title quire-documents-head", "Places")));
    for (const place of view.places) {
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
        box.append(next(make("p", "quire-outline-title quire-documents-head", "Taken away")));
        for (const entry of view.trash) {
            const back = next(make("button", "quire-menu-line quire-documents-trash"));
            back.type = "button";
            back.append(make("span", "quire-menu-label", entry.name), make("span", "quire-menu-hint", "bring back"));
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
    forget(): void;
    back(): void;
}

/** Builds the form that connects a repository, saying plainly where the token is kept and sent. */
export function repositoryForm(form: RepositoryForm): HTMLElement {
    const box = make("form", "quire-repository");
    box.noValidate = true;
    const field = (label: string, value: string, hint: string, type = "text") => {
        const row = make("label", "quire-repository-row");
        row.append(make("span", "quire-repository-label", label));
        const input = make("input", "quire-link-field");
        input.type = type;
        input.value = value;
        input.placeholder = hint;
        input.spellcheck = false;
        input.autocomplete = "off";
        input.addEventListener("keydown", (event) => event.stopPropagation());
        row.append(input);
        box.append(row);
        return input;
    };
    const kept = form.settings;
    box.append(make("p", "quire-repository-title", "Write in a GitHub repository"));
    const repository = field("Repository", kept ? `${kept.owner}/${kept.repo}` : "", "owner/name");
    const branch = field("Branch", kept?.branch ?? "main", "main");
    const folder = field("Folder of documents", kept?.folder ?? "", "src/content/blog");
    const pictures = field("Folder for pictures", kept?.pictures ?? "", "src/assets/blog");
    const token = field("Access token", kept?.token ?? "", "github_pat_…", "password");
    const about = make("p", "quire-repository-about");
    about.append(
        "Use a fine-grained personal access token that can read and write the contents of this one repository and nothing else (",
        Object.assign(make("a", "", "make one on GitHub"), { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }),
        "). It is kept only in this browser, in its local storage, and is sent only to api.github.com. To remove it, press Forget below, or clear this site's data in the browser.",
    );
    box.append(about);
    const said = make("p", "quire-repository-said");
    said.setAttribute("role", "status");
    const actions = make("div", "quire-repository-actions");
    const connect = make("button", "quire-button quire-choice", kept ? "Save and open" : "Connect");
    connect.type = "submit";
    const back = control("Back to the documents", "Back", () => form.back(), "quire-button");
    actions.append(connect, back);
    if (kept) actions.append(control("Forget this repository and its token", "Forget", () => form.forget(), "quire-button quire-forget"));
    box.append(said, actions);
    box.addEventListener("submit", async (event) => {
        event.preventDefault();
        said.textContent = "Connecting";
        connect.disabled = true;
        let problem: string | undefined;
        try {
            problem = await form.connect({ repository: repository.value, branch: branch.value, folder: folder.value, pictures: pictures.value, token: token.value });
        } catch (error) {
            // whatever went wrong, the button comes back and the reason is said
            problem = error instanceof Error ? error.message : String(error);
        }
        connect.disabled = false;
        said.textContent = problem ?? "";
    });
    return box;
}
