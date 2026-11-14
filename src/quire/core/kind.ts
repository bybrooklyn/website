// A kind of document, as the core's app (app.ts) knows it: what a Quire gives the core. mdQuire is one
// (md/kind.ts), a plain note is another (note/note.ts), and imgQuire is to be the next. The page that
// mounts the app lists its kinds; the shelf lists every kind's documents together, and opening one
// mounts its kind's editor in the app's frame.
//
//   startApp(host, { kinds: [markdown({ colors, sample }), note()] });
//
// A kind says which documents are its own by their names, how to start a new one, and how to mount
// its editor. Its editor makes the core's frame (frame.ts) and holds its document through the core's
// session (session.ts), so that saving, conflicts, version history and moving between documents are
// the same for every kind.

import type { Template } from "./shelf";
import type { Entry, Opened, Status, Store } from "./store";
import type { Parts } from "./quire-file";
import type { VersionStorage } from "./versions";
import type { MenuItem } from "./ui";

/** What a kind of document gives the core. */
export interface Kind {
    /** Its key, kept nowhere a writer reads it: "md", "note". */
    key: string;
    /** Its name, as a writer reads it: "mdQuire". */
    name: string;
    /** True when a document of this name is this kind's (by its ending). The first kind listed is asked last and takes whatever no other claims. */
    opens(name: string): boolean;
    /** The ways to start one, as the shelf's "new" words and File, New give them. */
    starts(today: Date): Template[];
    /** Ways to start one offered quietly under the shelf's list, as mdQuire offers its sample. */
    quiet?(): Template[];
    /** What the file choosers offer for it: a description and the endings by type for a browser's file picker, and the same for a file input (`chooser`, as its accept says it). */
    files: { description: string; accept: Record<string, string[]>; chooser: string };
    /** A word said in its shelf rows beside the place, for a kind that is not the first ("note"); none for the first. */
    row?: string;
    /** Mounts its editor on the app's element, in the frame. */
    mount(host: HTMLElement, context: Context): Editing;
}

/** What the app gives a kind's editor when it mounts it. */
export interface Context {
    /** The page's top, with places for the name, the menu words, how saving stands and the tools. */
    top?: HTMLElement;
    /** Where version history is kept, for every store. */
    versions: VersionStorage;
    /** The browser's own store, where a copy goes when the document's own store cannot keep one. */
    richHome?: Store;
    /** The places the editor may learn from without fetching (mdQuire's suggested words). */
    learnFrom: () => Store[];
    /** The File menu's first lines, the app's: New with every kind's ways to start, and Open. */
    fileItems: () => MenuItem[];
    /** Told whenever the editor moves to another document, so the app can remember it. */
    onOpen: (store: Store, entry: Entry) => void;
    /** Opens the documents list from the name in the trail. */
    onName: (from: HTMLElement) => void;
    /** The document to start on, already opened from its store; nothing open if not given. */
    start?: { store: Store; entry: Entry; found: Opened };
}

/** A kind's editor, as the app drives it. */
export interface Editing {
    /** The sheet, which grows out of a row on the shelf and shrinks back. */
    paper: HTMLElement;
    /** Moves to another document; false when the writer chose to stay (the old one could not be saved) or it could not be opened. */
    open(store: Store, entry: Entry): Promise<boolean>;
    /** Makes a new document there and opens it; given parts, it is made as a `.quire` document. */
    create(store: Store, name: string, text?: string, quire?: Parts): Promise<boolean>;
    /** Saves what is waiting, asking the writer when it cannot be: true when the document may be left. */
    ready(): Promise<boolean>;
    /** Saves what is waiting and lets the document go, so that nothing is open; false when the writer stays. */
    leave(): Promise<boolean>;
    flush(): Promise<void>;
    rename(name: string): Promise<void>;
    current(): { store?: Store; id?: string; name: string };
    status(): Status | undefined;
    /** The name in the trail, from which the documents list grows. */
    nameElement(): HTMLElement;
    /** Says something went wrong, in the status: a few words, and the whole of it. */
    say(short: string, full: string): void;
    /** Gives the keyboard to the writing. */
    focus(): void;
    /** After a document started from a way to start: mdQuire selects its last line, for typing over. */
    started?(): void;
    destroy(): void;
}

/** The kind a document of this name is: the others are asked first, in order, and the first kind listed takes whatever none of them claims. */
export function kindFor<K extends Pick<Kind, "opens">>(kinds: K[], name: string): K {
    return kinds.slice(1).find((kind) => kind.opens(name)) ?? kinds[0]!;
}
