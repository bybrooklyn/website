# Changelog

What changed on the site, by day, newest first. It is built from the git history; a commit's own message has
the detail. Nothing here says whether a change is live: the footer of the live site links the commit it was
built from.

## 13 November 2026

### mdQuire

- A dialog piece other things can use, and dictation's first launch inside it: a Choose button becomes three
  cards, one per model, and the download's progress is shown there.
- Menus are the browser's popovers, anchored to their controls. Tooltips and the find bar grow from where
  they were asked for.
- More Markdown: highlighted code blocks, callouts, definition lists, superscript and subscript, marked text,
  emoji shortcodes, folding sections, maths and flowcharts drawn by its own code, and the site's components
  shown as cards of fields in an `.mdx` file. Typed `->`, `<-`, `=>`, `!=`, `<=` and `>=` become their signs.
- Pictures can be picked, resized, aligned and captioned in place. Notes can be put on selected words and are
  never written into the Markdown. Insert gains today's date, special characters and a table of contents.
  File gains Download as: Markdown, `.quire`, a web page, plain text and Word.
- The caret is one plain line, with no outline round a faint colour.
- A top heading's descenders are no longer cut off.
- Dictation's browser test stops the preview server it starts.

### Notes

- imgQuire and the background remover have notes files of their own.

## 12 November 2026

### mdQuire

- The editor as a page at `/mdquire/`, hidden for now: a document model with its own typing, selection, paste
  and undo; four places a document can live (the browser, files, a folder, a GitHub repository); the `.quire`
  file, which is a zip; a shelf of documents; find and replace; zoom and page setup; real pages with page
  breaks, headers and footers; version history; tables.
- Checking: Markdown tidiness, the site's writing rules, links and pictures that exist, spelling against a
  word list of its own, and prose rules, shown as faint underlines and a list.
- Dictation that runs in the browser: its own audio features and decoder for Parakeet-family models, a
  Moonshine path for phones, three sizes of model, spoken commands and custom words.
- The look chosen from a lab of mock-ups: no page, or light paper; a top of two lines with the trail and the
  menu words, then the tools in the order Google Docs has them; one kind of menu that drops below its word.
- The caret is drawn in the same frame as the letter typed.

### Minis

- Walker: a 2D physics engine, a small neural network and evolution, written in Rust and built to
  WebAssembly; drawn again as a little character; gaits, bigger brains, a course to cross and a load to
  carry; batched stepping with SIMD and workers so that it learns many times faster.
- Generalist, a draft: a creature that sees with rays and crosses worlds made from a six-number recipe. It
  learns by evolution or by practice (proximal policy optimisation written from scratch); its brain and a
  chart of how far it gets are drawn beside the world; two legs stay on their feet and take turns.
- Comet, a draft: a comet flung through stars into a black hole, with pushers and wormholes, on fields made
  from a seed, each kept only when a solver has found a launch that wins it.
- Dice and Plinko: panels restyled in the site's manner; unused code removed.

### Pages

- Tone tags at `/tonetags/`: a searchable list with a search by meaning, and a press to copy.
- Spectrum at `/spectrum/`, rewritten from the SvelteKit app with two sliders taken out; its sliders move
  smoothly and settle on the nearest of seventeen positions.
- Photos: missing pictures are skipped and the shuffle is remembered.
- About: a line on LinkedIn. Setup: one line removed. The license page names each license.

### Shared code

- One opener for the picture viewer and the terminal, and one helper for copying.
- The browser driver used by the tests always stops its browser and removes its profile.
- Things written more than once folded into one; styles nothing used taken out.

## 11 November 2026

- Mote, a small engine of the site's own, and a minis page of things that run on it. It began on forked
  libraries and ended with none: its own 2D physics, 3D drawing and 3D physics.
- Minis: Blocks, Climb, Plinko and Dice (first called Table); later cut to two, the others archived to a tag.
- A terminal that plays back real recorded runs of command-line programs, used for mFetchy and Terrustia.
- The picture viewer on every page, with a menu. Link previews. Covers drawn in code for projects with no
  picture.
- Playmatter on the homepage and playable in place. Photographs by a friend, credited to him.
- A license page in plain words. Sentences that read as machine-written made plain.
- Page changes animate in Firefox too; Back returns to where a post was opened from.

## 10 November 2026

- The site begins: Astro and Bun, the about page, the resume with its PDF printed as part of the build, the
  setup page, projects whose facts are brought up to date from GitHub, and posts with numbered sources.
- A timeline that is stepped through by scrolling.
- Photos from a folder, shown one at a time, with blurred previews behind them.
- An editing command with an editor for Markdown (later replaced by mdQuire).
- A first small physics engine for the Playmatter demo.
- The site's typefaces, lowercase headings and smaller headlines. The license, content under CC BY-NC.
