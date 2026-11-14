# The shared core of the Quires

One core that every Quire is built on, so that a new one is only a kind of document, its tools and its
menus. This file holds the interface as designed, before anything moves; today the shared pieces still
live inside mdQuire in `src/quire/`.

## Decided

- The core is a framework and each Quire is a plug-in to it. The core is the app: the shelf, the places a
  document lives (the browser, files, a folder, a GitHub repository, an encrypted Google Drive), the
  `.quire` zip, the top bar and menus, the command palette, dialogs and popovers, version history, what is
  used most, and the look. A Quire gives it a kind of document, a surface to edit it on, its tools and
  its menu lines.
- It lives in `src/quire/`. mdQuire's own parts (the document model, Markdown reading and writing, typing,
  checking, dictation) move to a folder inside it, and imgQuire gets one beside it.
- One shelf lists every kind of document.
- It is to be written with no ties to this site, so that it can move to a repository of its own.

## The interface, as designed

Worked out from what mdQuire's editor and app ask of each other today (`app.ts` calls `createEditor`
and then only a dozen of its members) and from what imgQuire will need (`imgQuire.md`: a `.quire` zip
holding an original and its steps, tools on single keys, an export, a facts panel, the same shelf,
places, menus, palette and look).

### What a kind gives the core

A kind is one value, registered with the app by the page that mounts it:

```ts
interface Kind {
    key: string;                          // "md": kept nowhere a writer reads it
    name: string;                         // "mdQuire": the trail, About, the tab
    opens(name: string): boolean;         // a document of this name is this kind's (by its ending)
    starts(today: Date): Template[];      // the shelf's "new" words and File, New
    accept?: Record<string, string[]>;    // what the open-a-file chooser offers for it
    mount(host: HTMLElement, frame: Frame): Editing;   // its editor, in the core's frame
}
```

`mount` gives back the kind's editor as the app drives it, the members `app.ts` uses today:

```ts
interface Editing {
    paper: HTMLElement;                   // what grows out of a shelf row and shrinks back
    open(store, entry): Promise<boolean>; // leaves the document (saving it) and opens another
    create(store, name, text?, parts?): Promise<boolean>;
    ready(): Promise<boolean>;            // saves what waits, asking if it cannot: may it be left?
    leave(): Promise<boolean>;            // lets the document go, so nothing is open
    flush(): Promise<void>;
    rename(name): Promise<void>;
    current(): { store?, id?, name };
    nameElement(): HTMLElement;           // the name in the trail, from which the documents list grows
    say(short, full): void;
    focus(): void;
    started?(): void;                     // after a new document from a template: mdQuire selects its last line
    destroy(): void;
}
```

The kind does not write that lifecycle itself: the core's session (`session.ts`, taken out of
`editor.ts`) does the saving, the conflict, version history, renaming and leaving, and asks the kind
only for what it alone knows:

```ts
interface Body {
    writing(): Writing;                   // the document as a store saves it: text, and parts for a .quire
    load(found: Opened, entry: Entry): void;  // put a document in
    empty(): void;                        // nothing open
    changed(listener): () => void;        // tells the session each edit, so it saves and keeps versions
    named(name: string): void;            // the name changed: the trail and the title follow
    leaving?(): void; arrived?(): void;   // what it keeps beside the document (mdQuire's notes)
    history: { show(text, older, into): void; restore(text): void };  // how a version is drawn
}
```

### What the core gives a kind

The `Frame`, handed to `mount`:

- the top's places (`place("name" | "menus" | "status" | "bar")`), with the name button and the
  status line already in them (`say(short, full, tone, stays)`, a count beside it);
- the menu row, built from the kind's headings (`menus(() => Heading[])`): the menus, the palette, the
  right-click menu and the shortcuts panel all read the one table each kind gives;
- the command palette, given the same headings and what fits where the cursor is;
- the keyboard: Alt and a menu's letter, F10, and each shortcut the kind's table names, run from one
  listener;
- full screen, the look (dark or light paper), dialogs, menus, strips, tooltips (`ui.ts`, `dialog.ts`,
  `strips.ts`), what is used most (`most-used.ts`, counts kept by key), the word counter at the lower
  left given plain text, the facts in the margin;
- the site's own things as options from the page: the colours offered, the trail's name and flags (in
  the page's own top), the sample, the database's name, Google Drive's client.

### What stays out of the core on purpose

- The document model, reading and writing a format, typing, checking, dictation, suggestions,
  pictures in text, tables, links, comments, page view: each kind's own.
- A kind's bar of tools: the core gives the place and the folding into the three dots, not the tools.
- What a `.quire` holds inside: the core packs and unpacks the zip and keeps its pictures; a kind says
  what its parts are. Today the parts are mdQuire's `style.json` and `notes.json`, carried by every
  store as two strings (`Parts`); imgQuire's original and steps will need the stores to carry a set of
  named files instead. That widening is left until imgQuire is started, so that no store's saved
  documents change now.

### Print and export, version history, per browser

- Print and export are a kind's commands like any other, on its menus; the core gives the browser's
  print and a way to hand the writer a file.
- Version history: the core keeps snapshots (text, with the parts after it), thins them and lists
  them; the kind draws a version and its changes, and restores one.
- Per browser: each kind keeps its own choices under its own keys (`quire-look`, `quire-outline` and
  the rest stay as named); the core keeps where the writer was (`quire-place`), the places' settings
  and what is used most.

## Open

- Whether the minis that want imgQuire's engine (the flag assembler) use the core or only the engine.
