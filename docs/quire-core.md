# The shared core of the Quires

One core that every Quire is built on, so that a new one is only a kind of document, its tools and its
menus. Nothing of this is built yet; today the shared pieces live inside mdQuire in `src/quire/`.

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

## Open

- The interface a Quire implements: opening, saving, the surface, commands, what the palette and menus are
  given, what the shelf shows for a row.
- What moves and in what order, without a week in which mdQuire is broken.
- Whether the minis that want imgQuire's engine (the flag assembler) use the core or only the engine.
