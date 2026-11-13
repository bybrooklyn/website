# mdQuire

A word processor for Markdown files, in the browser, at `/mdquire/`. It writes the way a word processor
does (bold, lists, tables, pictures, headings) while the file underneath stays plain Markdown, and what was
not changed keeps every byte it had. It is also the editor behind `bun run edit`, where it replaced the
site's first editor. It is hidden for now: its project page (`src/content/projects/mdquire.mdx`) is a draft.

## Where the code is

- `src/quire/`: the editor. It imports nothing from outside its folder (`STYLE.md`, `scripts/lint.ts`);
  the one exception is ONNX Runtime, imported only from `src/quire/dictation/`.
- `src/quire/check/`: checking (spelling, prose, the site's writing rules, Markdown tidiness, links).
- `src/quire/dictation/`: dictation, with the speech recognizer in `dictation/parakeet/` and notes on the
  models in `dictation/MODELS.md` and `dictation/parakeet/RUNTIME.md`.
- `src/pages/mdquire.astro` and `src/scripts/mdquire.ts`: the public page. `src/pages/mdquire-dictation.astro`
  is dictation's test page.
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

**Stores.** A document can live in the browser (`store-browser.ts`), in a file opened and downloaded
(`store-files.ts`), in a real file or folder on the computer where the browser allows it
(`store-folder.ts`), in a GitHub repository (`store-github.ts`, with a fine-grained token kept only in this
browser and sent only to GitHub), or on the site's own writing server under `bun run edit`. A save whose
document changed elsewhere is refused, and nothing is written over it (`conflict.ts`).

**The `.quire` file.** A zip (`zip.ts`, written here) holding `document.md` (plain Markdown, readable by
anything), `style.json` (colour, size, typeface, highlight, alignment, spacing, picture sizes and the page,
which Markdown cannot hold) and `notes.json` (notes on the text). Tools a plain Markdown file cannot keep
fold away for such files, and a Markdown file can be turned into a `.quire`.

**The home screen** (`shelf.ts`) is a list drawn as the site's posts list is, with no pictures of
pages. A quiet "new" is followed by the three ways to start as words (blank, blog post, notes); under
"recent" each document is a ruled row of its name (ended with an ellipsis when long), where it is kept
(this browser, this computer, or a folder's or repository's own name) and when it was last touched
(today with the time, yesterday, the day, and the year when not this one), with three dots at the end
whose menu grows from them: open, rename, duplicate, and delete, which asks once more in the same menu.
A row is one button, reached by Tab and opened with Enter. The page grows out of the row it was opened
from and shrinks back into it on leaving, the keyboard landing on that row again; something new grows
out of the word pressed. Narrower than 40rem a row takes two lines, the name first. Opening a file or a
folder, connecting a repository and the sample are a quiet row of words under the list, and an empty
shelf says so in one line.

**Around the writing.** The home screen, find and replace
(`find.ts`), zoom and page setup (`paper.ts`), page view with page breaks, headers, footers and page
numbers (`pages.ts`), version history kept in the browser (`versions.ts`), tables (`tables.ts`), an
outline of the headings (`outline.ts`), a slash menu on an empty line (`slash.ts`) and a bar over
selected text (`select-bar.ts`). The slash menu opens on the five things the writer makes most and a
quiet last line, More, that grows it open to the rest; before anything is counted the five are Heading 2,
Bulleted list, Checklist, Picture and Code block. What is made is counted however it was made (the slash
menu, the bar, a menu, a shortcut, a typed Markdown mark) by comparing the document before and after each
change that makes things (`most-used.ts`). The counts stay in the browser's own storage, are never sent,
and Tools, Forget what I use most, clears them.

**Checking** (`check/`). Markdown tidiness, the site's writing rules (written once in `check/tells.ts`,
which `scripts/lint.ts` imports, so the two give the same verdict), links and pictures that lead nowhere, spelling
against an English dictionary of its own (about 126,000 words), and prose rules with a reading score.
Findings are faint underlines, a popover with fixes, a count and a list. Nothing of it loads until it is
first switched on.

**Dictation** (`dictation/`). Speech recognition run in the browser: no sound leaves the machine. Its own
audio features and decoder for Parakeet-family models, a Moonshine path for phones, three tiers (Accurate,
Light for desktops and laptops, Tiny for phones), spoken punctuation and commands, and custom words the
decoder leans toward. The model is downloaded once into the browser's storage, resuming if cut off. Its
first launch is a dialog (`dialog.ts`, a piece other things can use): the page darkens, a rounded panel in
the middle explains and has a filled Choose button, which grows into three cards, one per model, with its
size and who it is for, the one that suits the machine picked; the download's progress is shown there.

**The look.** Chosen from the lab: two writing screens, no page (the writing on the site's ground at the
blog's measure) and light paper; it opens on no page, and paper is chosen from View. The top is two lines:
a trail (the site's name and flags, then mdQuire, then the document's name; the first leads home, the
second to the shelf, the third opens the documents list) with the menu words, and under it the tools in
the order Google Docs has them, with the size as a number between minus and plus and alignment as four
buttons always shown. Find, the status, the three dots and the microphone are at the right. An "About
mdQuire" line is in Tools and the three dots. The browser tab shows an italic Q on a dark rounded square
(`public/mdquire/icon.svg`). The caret is one plain line, drawn in the same frame as the letter typed.

**The menus.** Every command is in the menu row by name with its shortcut. A menu is the browser's popover,
anchored to its word: the word stays in the row, lit, and the menu grows from under it, covering nothing
above, with the raised look and shortcuts shown as symbols. Tooltips and the find bar grow from where they
were asked for.

**Markdown kinds** (`more-markdown.test.ts` covers them). Highlighted code blocks (`highlight.ts`),
callouts, definition lists, superscript and subscript, marked text, emoji shortcodes (`emoji.ts`, a short
table written by hand), folding sections (`details.ts`), maths laid out by its own code (`maths.ts`),
flowcharts from a `mermaid` fence drawn as SVG by its own code (`diagram.ts`), and the site's components
in an `.mdx` file shown as cards of fields (`components.ts`). Typed `->`, `<-`, `=>`, `!=`, `<=` and `>=`
become their signs.

**Pictures** (`pictures.ts`, `picture-tools.ts`). A picture lands exactly at the caret (a dropped one where
it was dropped), splitting a paragraph there. It sits at the left unless moved; centre and right are
chosen, and written as `<div align>`. Nothing stands under it but its caption, once it has words. Picked,
it is resized from its corners and dragged between any two blocks, into and out of lists and quotes, the
text opening where it will land. A right-click, the menu key or the strip's three dots open its menu;
caption, description, alignment and size are set in a panel at the right, in the manner of the
document's facts there (on a phone, at the window's foot). Text can flow round a picture at the left or
right, written as HTML's own `align` on the `<img>`. A resized, captioned or wrapped picture is written as
one line of HTML the site's Markdown already passes through. A picture in a document in the browser is
kept in the browser with it.

**Notes** (`comments.ts`, `comment-margin.ts`). Notes on selected words, kept beside the text and never
written into the Markdown. There are no accounts; a note is the writer's own.

**Inserts and downloads** (`inserts.ts`, `export.ts`, `docx.ts`). Insert adds today's date, special
characters and a table of contents. File, Download as gives Markdown, `.quire`, a web page, plain text and
Word (a `.docx` written from scratch). PDF is the browser's print dialog with the page already set up.

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

**Spelling.** To be improved, with a word list of its own. How it works now, its numbers and the questions to settle are in `spelling.md`.

All of the above is built and on `main`. Lists are drawn as Docs draws them, and a list mark typed after a
soft line break turns only that line into an item.

## Open

- The wording of dictation's first-launch dialog has not been reviewed.
- Fluidity: typing and the text, opening and closing, the bar; whether the caret should glide to a new
  place in place of jumping there.
- The top bar is close and needs further polish, found by using and testing it.
- Speeds of opening and closing are the lab's starting values (open 200 ms with a slight spring, close
  140 ms, lines 14 ms apart); other values may be chosen.
- Whether a private write area that saves posts and photos into the repository, signed into with a
  passkey, is still wanted, since the site stays static and deploys stay by hand (`site.md`).
- When the page and its project page stop being hidden.
- What two typed equals signs should become, if anything; the arrows and the other signs above are built.

## How to run and test

```sh
bun run dev                    # /mdquire/
bun run edit                   # mdQuire on the site's own files, on a local server
bun test src/quire             # the model, reading and writing, keys, stores, checking, dictation
bun run build                  # needed first by the browser tests below
bun test src/quire/check/view.test.ts                # checking in headless Chromium
bun test src/quire/dictation/dictation.test.ts       # dictation's control with a made-up engine
bun scripts/dictation-check.ts                       # dictation with the real models (downloads them)
```

`src/quire/read.test.ts` holds every Markdown file on the site, and `docs/minis.md`, to a round trip byte
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
- Until `mdquire-writer` is merged, `main` reads `$...$` and `~text~` differently from the decided rule.
