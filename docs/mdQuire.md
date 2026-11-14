# mdQuire

A word processor for Markdown files, in the browser, at `/mdquire/`. It writes the way a word processor
does (bold, lists, tables, pictures, headings) while the file underneath stays plain Markdown, and what was
not changed keeps every byte it had. It is also the editor behind `bun run edit`, where it replaced the
site's first editor. It is hidden for now: its project page (`src/content/projects/mdquire.mdx`) is a draft.

## Where the code is

- `src/quire/md/`: mdQuire, the first kind of document on the Quires' core ([quire-core](quire-core.md)).
  `kind.ts` registers it with the core's app, `editor.ts` fills the core's frame, and the rest is its own:
  the document model, reading and writing Markdown, typing, the surface, the bar, the menus' table
  (`menus.ts`) and the rest named below. File names in this document are in `src/quire/md/` unless they
  say `core/`.
- `src/quire/core/`: the core it is built on: the app, the shelf, the documents list, the stores and Google
  Drive, the `.quire` zip, the frame (the top, the menu row, the keys, the palette, full screen), the
  session (saving, conflicts, version history), dialogs, menus and strips. Nothing in `src/quire/` imports
  from outside it (`STYLE.md`, `scripts/lint.ts`); the one exception is ONNX Runtime, imported only from
  `src/quire/md/dictation/`.
- `src/quire/md/check/`: checking (spelling, prose, the site's writing rules, Markdown tidiness, links).
- `src/quire/md/dictation/`: dictation, with the speech recognizer in `dictation/parakeet/` and notes on the
  models in `dictation/MODELS.md` and `dictation/parakeet/RUNTIME.md`.
- `src/pages/mdquire.astro` and `src/scripts/mdquire.ts`: the public page. `src/pages/mdquire-dictation.astro`
  is dictation's test page; `src/pages/mdquire-kinds.astro` has mdQuire and the core's plain note on one
  shelf.
- `src/styles/quire.css`, `quire-markdown.css`, `quire-extras.css`: the look.
- `scripts/write.ts` and `scripts/editor/`: `bun run edit`, the local server that opens mdQuire on the
  site's own posts and pages.
- `design/mdquire/`: the audit of writing tools, three mock-ups and a lab (`/mdquire-lab/`) from which the
  look was chosen. `AUDIT.md` there explains it.
- `public/quire/words-en.dat`: the spelling dictionary, made from SCOWL by `scripts/dictionary.ts`.

Each file opens with a comment saying what it does; that is the place to start for any one part.

## Built

**The document model.** `document.ts` holds frontmatter as text and a list of blocks holding runs of text.
Every block read from a file remembers its exact source, so a block nobody touched is written back byte for
byte; an edit clears only the blocks it changed. `read.ts` and `write.ts` turn Markdown into the model and
back. `keys.ts` says what every key and typed text means, as pure functions with tests; `surface.ts` draws
the document into a `contenteditable` element and cancels every browser edit, so the model alone changes
the text. Undo, selection and paste are its own. Markdown typed as you go turns into what it means
(`## `, `**bold**`, `- `), and one undo gives back the characters as typed.

**Speed.** In a 5,000-line document a key, Enter, Backspace joining two blocks and a pasted line are
each shown in under 16 ms (`editor.test.ts` holds them, with no page and in page view; measured on
13 November: a key 2 to 4 ms, Enter 4 to 6 ms, where Enter took 61 ms before). Only the blocks that
changed are drawn again. What made Enter slow was the stylesheet, not the script: rules that look at a
block's neighbour (`h2 + h3`, the blocks after a wrapped picture as `[data-wrap] + *`) made the browser
work out the style of every block after a block put in or taken out (59 ms, 50 of them the picture's
rule). How a block stands to the one before it is now a class the surface sets on the blocks that
changed and the one after each (`quire-opens-section`, `quire-after-heading`, `quire-contents-list`,
`quire-beside`). The outline is drawn again only when a heading's words or level change, not when the
headings move down (7 ms). The rest of a change (checking, page view, the counts, suggestions, version
history, saving) costs under half a millisecond at once and under 5 ms in any later slice. A rule in
the editor's styles that looks inside or beside the document's blocks from the document's root (`:has()`,
`+`, `~`) brings this back.

**Stores.** A document can live in the browser (`core/store-browser.ts`), in a file opened and downloaded
(`core/store-files.ts`), in a real file or folder on the computer where the browser allows it
(`core/store-folder.ts`), in a GitHub repository (`core/store-github.ts`, with a fine-grained token kept only in this
browser and sent only to GitHub), in Google Drive locked with a passphrase (`core/store-drive.ts`, below), or on
the site's own writing server under `bun run edit`. A save whose document changed elsewhere is refused, and
nothing is written over it (`core/conflict.ts`).

**Google Drive, locked.** Documents can be kept in her Google Drive, locked in the browser with a
passphrase before they are sent, so that Drive holds only scrambled files. They cannot be opened in Google
Docs or by Google. The parts:

- `core/vault.ts` locks and opens bytes with the browser's own Web Crypto: AES-256-GCM, a fresh random 96-bit
  nonce for every file written, and the key made from the passphrase by PBKDF2-HMAC-SHA-256 at 600,000
  iterations over a random 16-byte salt kept with the vault. Argon2 would be stronger against guessing, but
  Web Crypto does not have it and no library is added. The key is a `CryptoKey` the page cannot read back
  out, held in memory only; the passphrase is never kept and is asked for once in each tab. Every file
  starts with a header ("MQ", a version byte, the iterations, the salt, the nonce) so that the numbers can be
  raised later. The header and a label naming the file's purpose are authenticated with the contents.
- A small `lock` file holds a known sentence, locked. It is opened first: if it does not open, the
  passphrase is wrong, and that is what the writer is told. If it opens and a document does not, the
  document is said to be damaged or changed outside mdQuire. There is no recovery if the passphrase is lost.
- Names are not sent. Each document and each picture is a file named with 32 random hex digits and locked
  under that name as its label, so that a file put in another's place does not open. Real names, which file
  holds each document, and the pictures' names are in one locked `index` file. All of it is in a folder
  named `mdQuire` that the app makes.
- `core/drive.ts` is the few Drive API v3 calls, behind an interface with a Drive kept in memory
  (`memoryDrive`) for tests and for the page `/mdquire-drive-try/`, which runs the whole app on it with no
  Google account.
- Saving. Drive v3 documents no conditional write (`files.update` takes no `If-Match`), so a save is checked
  twice: before writing, the file's `headRevisionId` must still be the mark; after writing, the revision just
  before the new one must be the mark. If another device or tab saved in the moment between, its revision
  is put back on top and the save is reported as changed elsewhere, with their text. For this every write
  sets "keep forever" on its revision (Drive lets only such revisions be downloaded), and the one before is
  let go once a later save is in place. The index is changed the same way, and a change refused because the
  index changed elsewhere is made again on the newer one, so two devices making documents at once both keep
  theirs.
- `core/google-sign-in.ts` signs in with no script of Google's and no server, by the OAuth 2.0 flow for
  JavaScript web apps: a small window at `accounts.google.com/o/oauth2/v2/auth` with
  `response_type=token`, a random `state` that is checked, and the scope `drive.file` alone (the app sees
  only the files it made). Google sends the window back to `/mdquire/drive/`, which hands the token to the
  tab that asked over a `BroadcastChannel` (the pages are cross-origin isolated, so the window cannot reach
  its opener) and closes. The token lasts about an hour and is kept in the tab's `sessionStorage` only; when
  it runs out, a refused call asks the writer to sign in again, and what she typed waits to be saved.
- `core/drive-place.ts` is the dialog: what Google can see, Sign in with Google, then the passphrase (twice for a
  new vault). `core/drive-config.ts` holds the client ID; while it is empty the place says "Google Drive is not set
  up yet." and does nothing. The page policy allows `https://www.googleapis.com` in `connect-src` and nothing
  else for it; the sign-in window is a page of its own and needs nothing in the policy.

**What Google can still see.** That she uses mdQuire (it is the app named on the sign-in screen and on every
request), when she signs in, the number of files in the folder, the size of each (a document's file is its
text's size plus a few dozen bytes, so length is not hidden), when each was made and when each changes, and which
files change together. It cannot read names, text, notes, styles or pictures, and it cannot tell which file
is a picture and which a document except by size and timing. It could delete or roll back files: a rolled
back or swapped file is found and refused, not shown as hers, but a deletion is not prevented.

**The `.quire` file.** A zip (`core/zip.ts`, written here) holding `document.md` (plain Markdown, readable by
anything), `style.json` (colour, size, typeface, highlight, alignment, spacing, picture sizes and the page,
which Markdown cannot hold) and `notes.json` (notes on the text). Tools a plain Markdown file cannot keep
fold away for such files, and a Markdown file can be turned into a `.quire`.

**The home screen** (`core/shelf.ts`) is a list drawn as the site's posts list is, with no pictures of
pages. A quiet "new" is followed by the six ways to start as words (blank, blog post, notes, meeting
notes, changelog entry, project page); under
"recent" each document is a ruled row of its name (ended with an ellipsis when long), where it is kept
(this browser, this computer, or a folder's or repository's own name) and when it was last touched
(today with the time, yesterday, the day, and the year when not this one), with three dots at the end
whose menu grows from them: open, rename, duplicate, and delete, which asks once more in the same menu.
Meeting notes are a `.quire` document of the date, who was there, what was decided and a checklist of
what comes next; a changelog entry is Markdown in `CHANGELOG.md`'s form, the day as a heading over
Added, Changed and Fixed; a project page is an `.mdx` file with the frontmatter the site's projects
collection needs (`src/content.config.ts`: name, summary, language, a status, order 99 so it comes
last, and a draft until it is ready) and the sections most project pages have (What it is, What it
does, Getting it). As with the others, the last line it starts with is selected, for typing over.
A row is one button, reached by Tab and opened with Enter. The page grows out of the row it was opened
from and shrinks back into it on leaving, the keyboard landing on that row again; something new grows
out of the word pressed. Narrower than 40rem a row takes two lines, the name first. Opening a file or a
folder, connecting a repository and the sample are a quiet row of words under the list, and an empty
shelf says so in one line. In light paper the list sits on a sheet of the same paper as the page, and the
round button for the commands is not shown while the home screen is.

**Around the writing.** The home screen, find and replace
(`find.ts`), zoom and page setup (`paper.ts`), page view with page breaks, headers, footers and page
numbers (`pages.ts`), version history kept in the browser (`core/versions.ts`), tables (`tables.ts`), an
outline of the headings (`outline.ts`), a command palette (`core/palette.ts`, below) and a bar over
selected text (`select-bar.ts`).

**The command palette** (`core/palette.ts`, with what mdQuire gives it in `slash-menu.ts`). Two quick taps of Ctrl, Alt+/ (Docs' Search the menus), or the
quiet round button resting in the window's bottom left corner, whose sign is a prompt (a chevron and a
short line, not the magnifier, which is Find's), grow it up out of that corner: a search field with the caret in it, and
under it seven lines, first what fits where the cursor is (a table's controls in a table, a picked
picture's menu on a picture, the formatting with words selected, the list commands in a list), then what
the writer uses most. Typing searches every command by its name, its other words and its menu, and the
headings, offered as "Go to:" lines; among answers as good, what fits where the cursor is comes first.
Each line shows its shortcut; Enter runs the first, the arrows move, Escape or another double tap sends
it back to the corner, and running a command gives the writing back where it was first. A tap is a press
and release of Ctrl with no other key between, each press and the wait between them within 350 ms; Ctrl
held for a shortcut, a click or the wheel, AltGr (sent as Ctrl and Alt on Windows) and typing with an input
method never count. On a Mac Cmd taps as well as Ctrl. It opens only from the writing, never over a field,
a menu or a dialog. On a phone it spans the window's foot. The button sits 0.75rem in from the corner and
is 2.25rem across; anything else at the bottom left starts 3.5rem in. Alt+/ opens it too, in place of the
search of the menus it does the job of. No command is listed in it: its lines are the menus' own (with their
shortcuts from `shortcuts.ts`), the lines of the menus beside their lines opened out, each of those saying
quietly where it is ("Format › Text"); they are found also by their former names (Indent more, Typeface,
Checking and the rest) and the slash items' words, and a table's controls and a picture's menu while they are
there, so a new command is in it with no more work. A line whose small form opens beside it (Bookmark,
Special characters) opens the menus down to it.

The slash is the palette's second way in. A `/` typed at the start of an empty line opens the same list
at the caret, with the things that can be put in there (`slash.ts`): the five the writer makes most and a
quiet last line, More, that grows it open to the rest; before anything is counted the five are Heading 2,
Bulleted list, Checklist, Picture and Code block. Typing after the slash narrows it, Backspace over the
slash closes it and leaves the line empty, and Escape leaves what was typed. A slash anywhere else is a
slash. The site's components are offered only in an `.mdx` file. What is made is counted however it was
made (the palette, the bar, a menu, a shortcut, a typed Markdown mark) by comparing the document before
and after each change that makes things (`made.ts`, counted by `core/most-used.ts`), and what is picked from the palette is counted
as well. The counts stay in the browser's own storage, are never sent, and Tools, Forget what I use most,
clears them.

**Checking** (`check/`). Markdown tidiness, the site's writing rules (written once in `check/tells.ts`,
which `scripts/lint.ts` imports, so the two give the same verdict), links and pictures that lead nowhere, spelling
against an English dictionary of its own (about 126,000 words), and prose rules with a reading score.
Findings are faint underlines, a small menu on each (the same lines a misspelling puts first in the
right-click menu), a count and a list. Spelling is on, alone and in
American, for a writer who has never set checking, and stays off for one who switched it off, for whom
nothing of it loads until Tools, Checking. A right-click on a misspelled word puts its spellings first in
the text's menu, then Add to dictionary and Ignore in this document; Tools, Personal dictionary lists the
words added, with Remove, Download as text and Add from a text file (`spelling.md`).

**Suggested words** (`suggest.ts`, `suggest-learn.ts`, `suggest-view.ts`). As Smart Compose in Gmail and
Docs: the rest of the word being typed, or the next few words, drawn faintly after the caret. Tab takes
all of it, Ctrl+Right (Alt+Right on a Mac) the next word, typing on goes through it (it shortens while
what is typed matches it), and Escape hides it until the next word. It is a drawing laid over the page
after the caret, as the drawn caret is, never characters in the model, so undo, selection, saving, the
word count and checking never see it; it shows only at the very end of a paragraph's, heading's or list
item's text, never in code, maths, a table, a field or the title, and what does not fit on the caret's
line is left off rather than drawn over the line below. Tab takes it whenever it shows; where none shows,
Tab is what it was, and a list item's start, having no words, never has any, so Tab indents there. A
word typed straight after a sign (`:smi`, `/head`, `#tag`) is never finished, so the emoji list and the
slash keep their own.

There is no model of language: it counts. Every run of words she has written (never across a full stop,
a comma or a line) is counted as the word that followed each one, two and three words, in two tables of
numbers kept by hashes. A word is offered only when it followed at least three times (five after a
single word), twice as often as the next, and as a large enough share of all that followed (40 % after
three words, 50 % after two, 70 % after one); the longest run seen often enough decides, backing off to
shorter ones. The word being typed is finished the same way from the words she has used that start with
its letters (from three letters when there is no word before it). At most four words and 48 characters.
Case follows her: a capital she typed stays, a word is offered as she writes it mid-sentence (mdQuire,
I), and capitals typed throughout carry on. Withheld words (`check/withheld.ts`) are never offered.

It learns in the browser, in idle time slices of 8 ms, from her documents in this browser and in a
folder or file already opened (under `bun run edit`, from the site's own posts and pages; never from
GitHub or Drive, which would mean fetching every document). The counts are kept in IndexedDB
(`quire-suggest`), read back on opening so nothing is learned twice; a saved document is learned again
twenty seconds after its last save, its old words taken back exactly. A document changed elsewhere
cannot be taken back, so it stays as learned and is counted as out of date, and once a tenth are, all is
learned again. Tools has the switch, Suggest words as I type (on unless turned off, kept as
`quire-suggest`), and Forget what it learned, after which documents not written in since are not
learned again. The tables hold at most 2^18 and 2^17 slots (3 MB each in memory); when full, the rarest
runs are dropped, below anything that would be offered. Measured: the site's 47 posts, pages and notes
(35,000 words) make 1.4 MB to keep and learn in 50 ms; 713,000 words make 3.9 MB to keep and 7 MB in
memory, learned in 0.6 s of idle time; a suggestion takes about 3 microseconds.

**Dictation** (`dictation/`). Speech recognition run in the browser: no sound leaves the machine. Its own
audio features and decoder for Parakeet-family models, a Moonshine path for phones, three tiers (Accurate,
Light for desktops and laptops, Tiny for phones), spoken punctuation and commands, and custom words the
decoder leans toward. The model is downloaded once into the browser's storage, resuming if cut off. Its
first launch is a dialog (`core/dialog.ts`, a piece other things can use): the page darkens, a rounded panel in
the middle explains and has a filled Choose button, which grows into three cards, one per model, with its
size and who it is for, the one that suits the machine picked; the download's progress is shown there.

**The look.** Chosen from the lab: two writing screens, no page (the writing on the site's ground at the
blog's measure) and light paper; it opens on no page, and paper is chosen from View. The top is two lines:
a trail (the site's name and flags, then mdQuire, then the document's name; the first leads home, the
second to the shelf, the third opens the documents list) with the menu words, and under it the tools in
the order Google Docs has them, with the size as a number between minus and plus. Find, the status, the
three dots and the microphone are at the right. An "About mdQuire" line is in Help, and opens a dialog. The
browser tab shows an italic Q on a dark rounded square
(`public/mdquire/icon.svg`). The caret is one plain line, drawn in the same frame as the letter typed.

**The bar** (`bar.ts`). Undo, redo, print, spelling, paint format; zoom; the style ("Normal text" for a
paragraph, as Format says, also in a list or a callout); the typeface; the size as a number between minus
and plus; bold, italic, underline, strikethrough, text color, highlight; link, picture; alignment; line
spacing; the lists; indent less and more; clear formatting. Alignment is one button showing the cursor's
alignment, and the lists one button showing the cursor's list, pressed when it is in one. Pressed, such a
button's choices open out of it to both sides (left, center, right and justify; checklist, bulleted and
numbered) on a raised strip that lies over the tools beside it, a middle choice on the button, so that it
opens to the left and the right alike and the pointer is on a choice; nothing else on the bar moves, and the bar keeps no empty room for
it. Opened by a press, the choice under the pointer shows its tooltip at once. A choice, a
press elsewhere or Escape closes it to one button again. From the keyboard Enter or Space opens it, the
side arrows move a lit mark along the choices while the keyboard stays on the button, Enter or Space takes
the lit one, and Escape closes it with nothing changed. The list's own kind again turns the list off. The
shortcuts (Ctrl+Shift+L, E, R, J and Ctrl+Shift+7, 8, 9) work as before and the buttons follow them. Every
tooltip is a word or two with its shortcut in words ("Bold (Ctrl+B)", Cmd on a Mac), from `shortcuts.ts`.
The size field selects its number when clicked or reached, so typing replaces it; Enter applies and gives
the writing back, Escape puts the number back. In a `.quire` document the size menu offers Docs' sizes
from 8 to 96, in a Markdown file the five it can keep. Text color and highlight are a grid of swatches
named in their tooltips, the highlight's marker line drawn in the highlight at the cursor. The style's
Title goes to the title line and the status says so. The magnifier is Find alone; searching the menus is
the command palette's job (Alt+/ opens it).

When the bar has less room than it needs, at any width, its tools fold into the three dots in a set order
(`FOLDS`): paint format, print, clear formatting, the indents and line spacing first, as she gave them,
then zoom, spelling, typeface, highlight, size, strikethrough, underline, text color and redo; picture,
alignment, link, the style, italic, the lists, bold and undo stay longest, undo last. A tool comes back
only when every one more needed is back. The dots hold those tools in the bar's order and nothing of the
document (print, version history, the Markdown and About are in the menus); under `bun run edit` its own
Show the page and Publish follow them, being in no menu. With nothing folded and none of those, the dots
fold away too. Room is kept beside the tools for the widest button to grow open into, except on a phone,
where the row slides along instead. At 390 wide the bar is undo, bold, italic and the lists, then find,
the dots and the microphone. While a grown button is open, nothing is laid out again. A message in the
status passes after five seconds and how saving stands comes back. A new document fills the window under
the top and does not scroll.

**Which surface a job gets.** One rule (`core/dialog.ts` says it at its head). A form of several fields, or
something to read, is a dialog: About, Page setup, Header and footer, Word count, Keyboard shortcuts,
Checking settings, connecting GitHub, Google Drive, dictation's first launch, Not saved. A single value is
one small field at the caret or the control (a link, a bookmark, a list's number). A list to pick from is a
menu (the documents list, what checking found, special characters). Something to consult while writing is
a side panel that starts below the bar: version history, comments, the picture, the outline, and the
changed elsewhere panel, which comes by itself and so leaves the keyboard in the text. Every dialog is
answered one way: the filled button at the right, a quiet cancel to its left, other quiet ways before
that, and one that leaves something behind (Leave without saving, Forget) alone at the far left. Enter in
a field does what the filled button does; Escape steps back one level, from a dialog, from a version
shown in the history to its list, and from the list out. A form that changes the document (Page setup,
Header and footer) changes nothing until OK, and the change is one undo. Deleting asks once more in the
same place, "Delete it" then "Keep it", on the home list and in the documents list. A switch is drawn one
way (`switchButton`): its words, a tick before them, and when on, the pressed square the bar's buttons
have. Corners are three sizes: small for what sits inside something, middle for menus, bars, strips and
cards, large for dialogs and panels.

**The small surfaces, three kinds.** Everything small that opens over the writing is one of three, and
looks and behaves like the others of its kind. A *menu* is a list to pick from, made by `flowMenu` with
`menuLine`s: a finding's menu (the same lines a misspelling puts first in the right-click menu), the
list of what checking found, the text's, a table's and a picture's menus, the code language, the callout
type, the emoji list, the emoji grid, the palette. It grows from what was pressed, takes the arrow keys and Enter, and
Escape gives focus back. A *strip* is a few actions on a thing in the text, icons only, each named in a
word or two in its tooltip with its shortcut: the bar over selected words, the link card (where the link
goes, to read, then Open, Copy, Edit, Remove), the chip after a pasted address (its few choices, all in
words), find, a table's strip and a picture's. Every strip wears the menus' skin (the raised surface,
their shadow, the middle corner, no line) and never covers the line being worked on (`core/strips.ts`). A
*card* is something to read with one or two actions: a comment, the word counter. It is the panel with
its fine edge and the middle corner, and its actions are a strip of icons. Tooltips are the small label
under a control. No surface says in a sentence what its label already says.

**The menus** (`menus.ts`, shown by the core's `core/menu-row.ts`, `flowMenu` in `core/ui.ts`). Every command is in the menu row by name with its
shortcut, in Google Docs' menus, order and words wherever mdQuire has the thing, so that hands that know Docs
know them. Every line has an icon in the editor's own line style, groups have rules between them, and a line
that is on shows a tick in its icon's place, never a colour alone. Each thing is in one menu only. A menu is
the browser's popover, anchored to its word: the word stays in the row, lit, and the menu grows from under
it, covering nothing above. A long menu is folded into groups as Docs folds it: a line ending in an arrow
opens a menu of its own beside it, growing sideways out of that line (to the right, else the left, else under
it on a phone), held inside the first so that the browser keeps both open. No menu is taller than the window;
one that must scroll fades at the edge where there is more.

A menu holds the keyboard while it is open, however it was opened, so that typing never reaches the document:
the arrows move, Enter chooses, a letter goes to the line starting with it, Right goes into the menu beside a
line and on to the next word's menu, Left comes back, and Escape steps back one level, from a menu beside a
line to that line and from the first to the writing. The pointer resting on a line with an arrow opens its
menu. Alt and a word's letter (F, E, V, I, O, T, H, as in Docs; Ctrl+Option on a Mac) or F10 open a menu from
the writing. Shortcuts are written as words on Linux and Windows (Ctrl+Shift+Z) and as symbols only on a Mac,
one for each command, the same in the menus, the palette and the Ctrl+/ panel.

The menus as they stand:

- File: New (Document, Blog post, Notes, Meeting notes, Changelog entry, Project page), Open (the documents list, which has the places to open from), Make
  a copy, Save as .quire document (for Markdown), Download (Markdown, mdQuire document, Web page, Plain text,
  Word), Rename, Version history, Details, Page setup (for `.quire`), Print.
- Edit: Undo, Redo; Cut, Copy, Paste, Paste without formatting; Select all, Select all matching text,
  Delete; Find and replace.
- View: Mode (Pageless or Pages), Paper (Dark or Light); Show outline, Show comments, Show Markdown, Show
  word count; Zoom (in, out, Fit, 50% to 200%), Full screen.
- Insert: Picture, Table, Date, Link, Special characters; Horizontal line, Emoji, Page break, Bookmark, Table of
  contents, Header, footer and page numbers, Footnote; Comment; then mdQuire's own blocks: Code block,
  Callout, Folding section, Definition list, Maths, Diagram, and Components in an `.mdx` file.
- Format: Text (bold to subscript; Size, Capitalization; Font, Text color, Highlight color; Inline code,
  Marked, Spoiler, Subtext), Paragraph styles, Align and indent, Line and paragraph spacing, Bullets and
  numbering (the three lists and List options); Clear formatting.
- Tools: Spelling and grammar, Word count; dictation; Preferences, Forget what I use most.
- Help: mdQuire help, Keyboard shortcuts; About mdQuire.

Tooltips and the find bar grow from where they were asked for.

**Lines taken from Google Docs** (chosen from `mdQuire-against-docs.md`). File has Make a copy (beside the
original, its pictures with it), Rename (to the title, selected) and Details (file, where it is kept and when
last saved, size, length). Edit has Cut, Copy, Paste and Delete with their keys; a menu paste the browser
refuses says in the status to press Ctrl+V. View has Full screen (Ctrl+Shift+F, the keys of Docs' compact
mode): the top folds away, the pointer at the window's top edge opens it while it stays there, Escape ends
it. View, Show word count keeps a counter at the lower left (`core/live-count.ts`), the selection's count
when there is one, opening to characters and pages on a press; on a phone it opens sideways. View, Show
comments puts the comments beside the text out of sight or back, and shown, opens the list of every one.
Tools, Preferences (`typing-panel.ts`) has a switch for each row of `vocabulary.ts`, and one for each of
Markdown's, GitHub's and mdQuire's own marks; what is off stays as typed. The arrows' switch is the old
Typed signs, still kept under its own key. Help, mdQuire help (`help.ts`) is a short page whose words have
not yet been reviewed. Choices kept per browser: `quire-live-count`, `quire-typing-off`, `quire-symbols`,
`quire-comments`.

**Markdown kinds** (`more-markdown.test.ts` covers them). Highlighted code blocks (`highlight.ts`),
callouts, definition lists, superscript and subscript, marked text, emoji shortcodes (`emoji.ts`, a short
table written by hand), folding sections (`core/details.ts`), maths laid out by its own code (`maths.ts`),
flowcharts from a `mermaid` fence drawn as SVG by its own code (`diagram.ts`), and the site's components
in an `.mdx` file shown as cards of fields (`components.ts`). Typed `->`, `<-`, `=>`, `!=`, `<=` and `>=`
become their signs.

**Pictures** (`pictures.ts`, `picture-tools.ts`). A picture lands exactly at the caret (a dropped one where
it was dropped), splitting a paragraph there. It sits at the left unless moved; centre and right are
chosen, and written as `<div align>`. Nothing stands under it but its caption, once it has words. Picked,
it is resized from its corners and dragged between any two blocks, into and out of lists and quotes, the
text opening where it will land, and no caret blinks beside it. A right-click, the menu key or the
strip's three dots open its menu: Picture options, Wrap text, Replace, Remove. Picture options opens a
panel at the right, in the manner of the document's facts there (on a phone, at the window's foot),
where caption, description, alignment and size are set; Enter in a field keeps it, closes the panel and
gives the keyboard back to the picture. Text can flow round a picture at the left or right, written as
HTML's own `align` on the `<img>`; Wrap text is one switch in the menu and the panel, dimmed for a
centred picture with "Left or right only". A resized, captioned or wrapped picture is written as
one line of HTML the site's Markdown already passes through. A picture in a document in the browser is
kept in the browser with it.

**In the text.** A field drawn in the writing (a folding section's summary, a component's property, a
picture's caption, the document's name) keeps what was typed on Enter and gives the keyboard back to the
writing where the field belongs (`fields.ts`). A code block takes blank lines: Enter is always a new line,
and only Enter at the end of code that already ends in two empty lines leaves it, taking the two away;
the down arrow on its last line, with no line of text after it, makes one and goes there. Its language is
a quiet button, always shown once set and shown as Plain text while the caret is in a block without one,
whose menu lists the languages highlighted with a field that narrows them and offers any other word as
written (`block-menus.ts`). A callout's kind is a menu of the five. A folding section's arrow folds it
away in the editor only, never saved, and a caret that lands inside unfolds it; "Closed for readers" is
the choice of its own written to the file, and a new section starts in its summary. A table has a menu
from a right-click, the menu key or its strip's dots: rows above and below, columns left and right,
removing the row, the column or the table, the sorts and the alignments, with what cannot act there
dimmed (`tables.ts`). A right-click on words opens cut, copy, link, comment, bold, italic and underline
(`text-menu.ts`), with a misspelled word's spellings, Add to dictionary and Ignore in this document above
them; Shift with it leaves the browser's. The selection bar, a table's strip and a picture's
are placed by one rule (`core/strips.ts`): never over what they belong to nor the line above or below it
while the window has room. The selection bar does not come for a selection made while the keyboard is
elsewhere, as find makes. Escape in a footnote goes back to just after its mark. A table of contents
has its own Update.

**Notes** (`comments.ts`, `comment-margin.ts`). Notes on selected words, kept beside the text and never
written into the Markdown. There are no accounts; a note is the writer's own.

**From Docs' menus** (`more-commands.ts` gives their lines to the row). Format, Text, Capitalization changes
the letters of the selected words (`capitals.ts`). Format, Bullets and numbering, List options (dimmed outside
a list) chooses the character a bulleted list is written with (Dash, Asterisk or Plus, all drawn alike,
since Markdown reads them alike), restarts a numbered list at a number (part way down, the list is cut in two
and the second written with the other delimiter, `1)`) and carries on the list before (`numbering.ts`). A table's strip sorts its rows by the
cursor's column (`tables.ts`). The style list has Title, which goes to the title line, since that line
is the document's name and Markdown has no title, and Subtitle. A document has one subtitle, the
line under the title: choosing Subtitle on a paragraph or heading moves its words there with the
cursor, and a subtitle there before goes back to the text where it stood; Normal text on it makes it a
paragraph again. A `.quire` document keeps it in its style.json; a Markdown file keeps it as the
frontmatter's `subtitle:` line, which Pandoc and Quarto read (`read.ts` shows that line as the
subtitle, `write.ts` puts it back): untouched, the frontmatter keeps every byte; changed, only that line
changes; emptied or taken off, the line goes, and a frontmatter left with no lines goes with it. A
value written over several lines or as a list is left in the frontmatter, not shown. Made a `.quire`
document, a Markdown file's subtitle moves into style.json; a `.quire` document downloaded as
Markdown has its subtitle in the frontmatter. Under `bun run edit` the frontmatter's fields leave the
subtitle to its line, and the frontmatter as text shows it as it will be written. Edit, Select all matching text selects every place the words appear, in capitals or not;
typing, Backspace and Format commands change all of them (`matching.ts`). Insert, Bookmark (dimmed in a
heading, which is a place to link to already) writes an empty anchor, `<a id="name"></a>`, drawn as a small flag, and the link field offers the headings (by the
ids the site gives them) and the bookmarks (`bookmarks.ts`).

**Links** (`link-card.ts`). A web address pasted over selected words makes them the link, in one undo
step, as Docs and GitHub do. What counts is one http, https or mailto address and nothing else around it
(`webAddress`); `javascript:` and every other scheme are pasted as text, and Ctrl+Shift+V always pastes the
text. An address pasted with nothing selected goes in as it is (a bare address is a link to any reader
with GitHub's extension), and a chip grows from under it offering to show it otherwise: words guessed
from the address in a small field, selected so they can be typed over at once, or a short form such as
`github.com/anomalyco/rune`, or the address as it is. Nothing is fetched: a static page cannot read
another site's title, so the words come from the address alone (`wordsFor`: the last part of the path
that is words, a repository and its issue on GitHub and GitLab, "YouTube video", or the site's name). The
chip takes no focus unless Tab or a press gives it one; typing, a press elsewhere, Escape or five seconds
without the pointer on it send it away and leave the address. Choosing is an undo step of its own, so
Ctrl+Z gives the bare address back. Resting the pointer on a link for half a second, or the cursor being
in one, grows a card from under it, drawn as the selection bar is: where the link goes (cut in the
middle when long), Open (a new tab, `rel="noopener noreferrer"`, offered only for web addresses), or Go
to for a heading or bookmark of the document, then Copy, Edit (the link field) and Remove (the words
stay). It sits below the link's line so it never covers the line being typed, and typing sends it away
until the cursor moves. With the cursor in a link Alt+Enter opens it (Docs' key; in mdQuire it was a
plain new paragraph), and Ctrl+K edits it as before.

**Inserts and downloads** (`inserts.ts`, `export.ts`, `docx.ts`). Insert adds today's date, special
characters and a table of contents.

**The emoji grid** (`emoji-picker.ts`). Insert, Emoji (beside its line, as Special characters is), the
palette, or Ctrl+; (Docs has no key for it on Linux, and Ctrl+. is superscript here) open a grid of the
emoji in `emoji.ts`, drawn by the system's own emoji font: a search field with the caret in it, a small
hand beside it for the skin tone, the groups along the top as Docs names them (Smileys and people,
Animals and nature, Food and drink, Activities, Travel and places, Objects, Symbols, Flags), with
Recently used first once anything has been used, and under them the group's emoji, eight to a row.
From the key it grows out of the cursor; from Insert, out of its line. It stays open while several are
put in. Typing searches every emoji by name and other words, and Enter puts in the first found; Down
goes from the search to the groups and the grid, the arrows move through the grid by rows, Up from its
first row goes back, Enter puts one in, and Escape gives the caret back (from Insert, steps back to the
line). The hand opens the five tones and none in place, growing under the search; holding an emoji that
takes a tone down for half a second opens the same row for it. An emoji is written as the colon list
writes it, its shortcode (`:heart:`), which the file shows as the character where a shortcode would not
read back as one; one in a skin tone, which no shortcode says, and one in code are written as the
character. What was used lately (24 at most) and the tone are kept in this browser
(`quire-emoji-used`, `quire-emoji-tone`), read back only as far as they name known emoji and tones.
The groups come from the table's own order: each group names the first emoji of each of its runs. File, Download gives Markdown, `.quire`, a web page, plain text and
Word (a `.docx` written from scratch). PDF is File, Print: the browser's print dialog with the page already set up.

## Decided, not yet built

**Standard Markdown's meaning always wins.** An extra is allowed only where Markdown gives no meaning. The
decided cases:

- `__text__` is bold, as Markdown has it.
- `~text~` and `~~text~~` are both strikethrough, as GitHub reads them (on `main`, typed `~text~` makes
  subscript).
- `$` is a dollar sign; maths is a block only (on `main`, `$...$` in a line is read as maths).
- `||spoiler||` makes a spoiler, kept as written.
- `-# ` at the start of a line makes small, quiet subtext, kept as written.
- `>>> ` quotes the line and everything after it.
- An emoji picker opened by a colon and letters, accepted only with Tab or Enter, so that ordinary typing
  with colons is never changed by surprise.

**Spacing.** Even spacing between blocks in the manner of Google Docs, with sizes taken from the site's
posts: one line between blocks, a little more above a heading that starts a section, the title at a post's
title size.

**Shortcuts.** Google Docs' everyday keyboard shortcuts.

**Spelling.** To be improved, with a word list of its own. How it works now, its numbers, what was decided
(American and on by default, a personal dictionary, her names built in, the right-click menu) and what is
still open are in `spelling.md`.

All of the above is built and on `main`. Lists are drawn as Docs draws them, and a list mark typed after a
soft line break turns only that line into an item.

## Open

- The wording of dictation's first-launch dialog has not been reviewed, nor that of the help page.
- Fluidity: typing and the text, opening and closing, the bar; whether the caret should glide to a new
  place in place of jumping there.
- The top bar is close and needs further polish, found by using and testing it.
- Speeds of opening and closing are the lab's starting values (open 200 ms with a slight spring, close
  140 ms, lines 14 ms apart); other values may be chosen.
- Whether a private write area that saves posts and photos into the repository, signed into with a
  passkey, is still wanted, since the site stays static and deploys stay by hand (`site.md`).
- When the page and its project page stop being hidden.
- What two typed equals signs should become, if anything; the arrows and the other signs above are built.

## Setting up Google Drive

Done once in the Google Cloud console (console.cloud.google.com), signed in as herself. Checked against
Google's pages "Configure the OAuth consent screen" and "Create access credentials" in November 2026; the
console's menus move from time to time.

1. Make a project: the project list at the top, New project, a name such as "mdQuire", Create. Choose it.
2. Switch on the Drive API: Menu, APIs and services, Library, search "Google Drive API", Enable.
3. The consent screen: Menu, Google Auth platform, Branding. Press Get started if it is not configured
   yet. App name "mdQuire", her email as the support email, Next. Audience: External, Next. Her email as the
   contact, Next. Agree to the user data policy, Continue, Create.
4. Test users: Google Auth platform, Audience. Leave the publishing status at Testing. Under Test users,
   Add users, her own Google address, Save. Only test users can sign in while it is in testing.
5. The scope: Google Auth platform, Data access, Add or remove scopes, tick
   `https://www.googleapis.com/auth/drive.file` ("See, edit, create and delete only the specific Google
   Drive files you use with this app"), Update, Save. It is a non-sensitive scope, so no review by Google
   is needed for it.
6. The client ID: Google Auth platform, Clients, Create client. Application type: Web application. Name:
   "mdQuire". Authorised JavaScript origins, Add URI, each of:
   - `https://bybrooklyn.dev`
   - `http://localhost` with the port `bun run dev` prints (4321 unless changed)
   Authorised redirect URIs, Add URI, each of (exactly, with the slash at the end):
   - `https://bybrooklyn.dev/mdquire/drive/`
   - the same local address followed by `/mdquire/drive/`
   Create. No client secret is used.
7. Copy the client ID (it ends in `.apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID` in
   `src/quire/core/drive-config.ts`. It is public, not a secret. `bun test src/quire` checks its shape.
8. Build and open mdQuire. Google Drive appears among the places; signing in shows Google's warning that the
   app is not verified, which is expected for an app in testing; Continue.

A preview deploy at another address needs that address added in step 6 as an origin and, with
`/mdquire/drive/`, as a redirect URI.

## How to run and test

```sh
bun run dev                    # /mdquire/
bun run edit                   # mdQuire on the site's own files, on a local server
bun test src/quire             # the model, reading and writing, keys, stores, checking, dictation
bun run build                  # needed first by the browser tests below
bun test src/quire/md/check/view.test.ts                # checking in headless Chromium
bun test src/quire/md/dictation/dictation.test.ts       # dictation's control with a made-up engine
bun scripts/dictation-check.ts                       # dictation with the real models (downloads them)
```

`src/quire/md/read.test.ts` holds every Markdown file on the site, and `docs/minis.md`, to a round trip byte
for byte. The browser tests need a Chromium and skip, with a notice, without one.

## Known weak spots

- Not verified in Firefox or Safari.
- Dictation has been measured only with a synthesized voice; it has not been tried with a real one, on
  phones or in Safari.
- Word files have not been opened in Word.
- The table of contents' links have not been checked against the heading ids the site itself makes.
- mdQuire's pages are cross-origin isolated (`Cross-Origin-Embedder-Policy: require-corp`) so dictation
  can use threads; anything they load from elsewhere must allow it.
- The page policy allows `blob:` for pictures (`astro.config.ts`), for pictures kept in the browser or in
  a `.quire` zip and for reading them back into a download. Whether that stays as it is is open.
- Google Drive has been tried only against the Drive kept in memory, never against Google: there is no
  client ID yet. Not yet seen working: the sign-in window and its return to `/mdquire/drive/` under the
  pages' cross-origin isolation, Drive's answers to CORS requests from an isolated page, whether every
  upload makes a new revision with "keep forever" honoured, whether `revisions.list` shows a revision at once
  after a write, the limit of 200 revisions kept forever, and uploads near 5 MB. A file over 5 MB is refused
  (Google's guide gives that limit for the two upload kinds used); a resumable upload would lift it.
- The Drive conflict check after a write narrows the moment two saves can cross to almost nothing, but Drive
  offers no compare-and-swap, so it cannot close it entirely; what crossed is put back and shown, not lost.
- Until `mdquire-writer` is merged, `main` reads `$...$` and `~text~` differently from the decided rule.
