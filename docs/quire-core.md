# The shared core of the Quires

One core that every Quire is built on, so that a new one is only a kind of document, its tools and its
menus. The core is the app; each Quire is a kind of document plugged into it. mdQuire is the first kind,
a plain note the second (kept to prove the interface and to start imgQuire from), and imgQuire is to be
the third.

## Where the code is

- `src/quire/core/`: the core. It imports nothing from a kind of document, and `bun run lint` holds it to
  that (`scripts/lint-bounds.ts`). 31 source files, about 7,200 lines, with 31 test files.
- `src/quire/md/`: mdQuire, the Markdown word processor, with checking (`md/check/`) and dictation
  (`md/dictation/`). 97 source files, about 26,900 lines.
- `src/quire/note/`: the plain note, the smallest kind. One file of about 130 lines and its test.
- `src/pages/mdquire-kinds.astro` and `src/scripts/mdquire-kinds.ts`: a hidden page with both kinds on one
  shelf, its documents in a database of its own.
- `scripts/core-page.ts`: the page the core's browser tests open.

The core is a folder of its own rather than the top of `src/quire/`, so that `src/quire/` reads as the
core and its kinds side by side (`core/`, `md/`, `note/`, later `img/`), and so that the rule for what may
import what is one line: nothing in `core/` reaches into another folder of `src/quire/`.

## Built

**The pieces of the core.** The app (`app.ts`): the shelf (`shelf.ts`), the documents list
(`documents.ts`), the places a document lives (`store*.ts`, `drive*.ts`, `vault.ts`,
`google-sign-in.ts`), the `.quire` zip (`zip.ts`, `quire-file.ts`), a picture's bytes (`picture-bytes.ts`:
its real type and its metadata cut out). The frame (`frame.ts`): the top and its places, the name and
the status (`status.ts`), the menu row (`menu-row.ts`), the keys, the command palette (`palette.ts`) and
full screen. The session (`session.ts`): saving as the document changes, a document changed elsewhere
(`conflict.ts`), version history (`versions.ts`), renaming and moving between documents. And the small
surfaces every kind uses: menus, tooltips and icons (`ui.ts`), dialogs and switches (`dialog.ts`), strips
(`strips.ts`), the facts in the margin (`details.ts`), the word counter (`live-count.ts`), what is used
most (`most-used.ts`).

**The interface.** A kind is one value (`kind.ts`), listed by the page that mounts the app:

```ts
interface Kind {
    key: string;                       // "md": kept nowhere a writer reads it
    name: string;                      // "mdQuire"
    opens(name: string): boolean;      // its documents, by their names; the first kind listed takes the rest
    starts(today: Date): Template[];   // the shelf's "new" words and File, New
    quiet?(): Template[];              // ways to start offered under the shelf's list (mdQuire's sample)
    files: { description; accept; chooser };  // what the file choosers offer for it
    row?: string;                      // a word in its shelf rows ("note"); none for the first kind
    mount(host, context): Editing;     // its editor, on the app's element
}
```

`mount` is given a `Context` (the page's top, the version store, the browser store for copies, what may
be learned from, the File menu's New and Open, and the document to start on) and gives back an `Editing`:
the sheet that grows out of a shelf row, `open`, `create`, `ready`, `leave`, `flush`, `rename`,
`current`, `status`, the name in the trail, `say`, `focus`, `started` (after a way to start) and
`destroy`. A kind's editor builds these from two pieces of the core:

- `createFrame(host, { top, name, onName })` makes the top with the name and the status in their places.
  The kind puts its bar in `place("bar")`, gives `menus(() => headings)` its menus (the row, the palette
  and the keys all read that one table), `keys(event => command)` its shortcuts (Alt and a menu's
  letter, F10 and Alt+/ are the frame's), and `palette({ writing, here, found, describe, first, counts,
  back })` what fits where the cursor is. `fullScreen`, `watch` and `destroy` are the frame's.
- `createSession(body, { name, store, id, mark, versions, say })` holds the document. The kind gives a
  `Body`: `writing()` (the document as a store saves it), `load`, `replace` (their version, after a
  conflict), `empty`, `placed` and `named` (where it is and what it is called), `status`, `leaving` and
  `moved` (what it keeps beside the document), `download`, `from`, `focus`. The kind calls `changed()`
  after each edit; the session saves once typing pauses, keeps versions, asks when words cannot be saved
  and moves between documents.

Version history's panel is the core's; how a version is drawn and restored is the kind's
(`VersionView`: `show(text, older, into)`, `restore(text)`, `focus()`).

**Registering a kind**, from the note (`note/note.ts`, shortened):

```ts
export function note(): Kind {
    return {
        key: "note", name: "Note", row: "note",
        opens: (name) => /\.note$/i.test(name),
        starts: () => [{ key: "note", label: "note", name: "Untitled.note", text: "", quire: false }],
        files: { description: "Notes", accept: { "text/plain": [".note"] }, chooser: ".note" },
        mount(host, context) {
            const frame = createFrame(host, { top: context.top, name: "Untitled", onName: context.onName });
            const text = make("textarea", "quire-plain-text");
            const session = createSession({ writing: () => ({ text: text.value }), load: (found) => void (text.value = found.text), ... }, { ... });
            text.addEventListener("input", () => session.changed());
            frame.menus(() => [{ label: "File", items: context.fileItems }, { label: "Edit", items: () => [stampLine, tidyLine] }]);
            frame.keys((event) => (event.ctrlKey && event.shiftKey && event.code === "KeyD" ? stamp : undefined));
            frame.palette({ writing: () => text, back: () => text.focus() });
            return { paper, open: session.open, create: session.create, ... };
        },
    };
}

startApp(host, { kinds: [markdown({ colors, sample }), note()], top });
```

**One shelf.** Every kind's ways to start are on the shelf's "new" line, and File, New lists them all.
Every document of every kind is a row of the same list; a kind other than the first says its word before
the place ("note, this browser"). Opening a document of another kind (from its row, the documents list,
a file or a template) asks the editor in the frame whether it may be left, destroys it, and mounts the
other kind's editor on the same element; the shelf and the file chooser are the app's and stay. With only
mdQuire listed, as on `/mdquire/`, nothing of this is ever seen.

**What the core takes from the page.** The kinds and what is the site's: mdQuire's text colours and
sample (given to `markdown()`), the top with the site's name and flags, the database's name, Google
Drive's client and a stand-in for it, the network for GitHub.

**The second kind, as a proof.** The note (`note/note.ts`) is plain text in a `.note` file, with two
commands of its own, Insert the date (Ctrl+Shift+D) and Tidy the lines, on its Edit menu, its bar and the
palette. `note/note.test.ts` opens `/mdquire-kinds/`'s app in Chromium, starts one note and one mdQuire
document from one shelf, and holds that each shows its own menu words, menu lines, palette and bar and
none of the other's, that both are listed with their own rows, and that each opens again from the shelf
and from the documents list in its own editor. The core's own pieces have browser tests that use no kind
at all (`frame.test.ts`, `session.test.ts`, `status.test.ts`).

**What a new Quire does.** A folder beside `md/` (`img/` for imgQuire) with a `kind.ts` giving a `Kind`;
an editor that makes a frame, a session and a body; its menus as one table of headings; its bar in the
frame's place; its stylesheet rules; its tests beside its files; and its line in the page's `kinds`. It
imports from `core/` and from nowhere else in `src/quire/`.

## Left tangled

Each of these works, and each is what imgQuire will need changed first.

- **The stores carry mdQuire's parts.** Every store saves a document as text and, for a `.quire`, two
  strings, `style.json` and `notes.json` (`Parts` in `quire-file.ts`), and `quire-file.ts` packs exactly
  that layout. imgQuire's `.quire` holds an original picture and its steps, so the stores must carry a set
  of named files instead. Changing it now would change how every store keeps documents already saved
  (IndexedDB rows, folder and repository files, Drive's locked files), so it waits for imgQuire.
- **The stores know mdQuire's endings.** A folder, a repository and a file opened from the computer treat
  `.md`, `.mdx`, `.markdown`, `.txt` and `.quire` as documents (`openable` and `markdownFile` in
  `store-files.ts`). The kinds' `opens` should decide that. The note therefore lives in the browser and in
  Drive only.
- **The stylesheets are not split.** `src/styles/quire.css`, `quire-markdown.css` and `quire-extras.css`
  hold the core's look and mdQuire's together (the shelf, the menus and dialogs beside the bar and the
  writing), and a rule often serves both. They are left as they are; the note's few rules are at the end
  of `quire-extras.css`.
- **Google Drive's words say mdQuire.** Drive's folder is named `mdQuire`, the vault's lock sentence is
  "mdQuire vault", and its dialog says Google can see that she uses mdQuire. The first two are kept data
  and cannot change without moving every vault; the words of the dialog follow the app's name on
  Google's side.
- **Typing preferences, the look and the outline are mdQuire's.** Tools, Preferences (`md/typing-panel.ts`)
  lists mdQuire's typing table, and the dark and light paper (`quire-look`) is mdQuire's sheet. A second
  kind that types text would share neither until they are made general.
- **One kind's editor at a time.** Moving between kinds destroys one editor and mounts the other; what
  the first kept only in memory (the zoom, an open panel) is not kept. Choices kept in the browser are.

## Kept the same for a writer

No address, menu line, key, saved document or stored choice changed: the keys in `localStorage`
(`quire-place`, `quire-look`, `quire-outline`, `quire-most-used`, `quire-most-picked` and the rest) and the
databases (`quire`, `quire-suggest`, `quire-edit`) are named as before. The home list, an open document,
each of the seven menus and the palette were photographed at 1300 wide in the dark look before and after
the move and compared.

## Decided

- The core is a framework and each Quire is a plug-in to it; one shelf lists every kind of document; it is
  written with no ties to this site, so that it can move to a repository of its own.

## Open

- Whether the minis that want imgQuire's engine (the flag assembler) use the core or only the engine.
- Whether the stores' parts become a set of named files before imgQuire starts or as its first step.
