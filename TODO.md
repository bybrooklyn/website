# To do

Everything still open, by project, most important first, one line each. The detail behind each item is in
the project's file in [`docs/`](docs/README.md); what has been done is in [`CHANGELOG.md`](CHANGELOG.md).

## Waiting on a decision

### The site and what it publishes

- The drafts preview address is public unless Cloudflare Access is put in front of it.
- The site says it does not track, while visitors' browsers ask GitHub for star counts. Reword, or fetch the counts at build time only.
- The setup page lists a download stack that a reader may take as piracy.
- The Terrustia recording shows a game server's port (the game's default).
- The code and engines of draft minis ship in the live build though their pages are not listed.
- The share picture of the colophon post is out of date and is to be made again.
- A guard on `bun run deploy` that refuses a branch other than `main` or uncommitted changes.
- Page policy: whether the `blob:` allowance for pictures stays as it is ([mdQuire](docs/mdQuire.md#known-weak-spots)).
- Looks that are a matter of taste, noted and not changed: terminals and the Playmatter clip play when scrolled to; on the photos page "another" falls just below the fold on a laptop; the mdQuire cover card is narrower than the others; on a phone the back-to-top button sits over text while reading; at 1920 wide the main pages leave the right half empty; on Comet the pull band runs off the left edge.

### mdQuire

- About thirty new sentences a writer can see were written during the audit (the "Not saved" dialog, errors from the stores, errors on opening a damaged file, one about spelling being unavailable) and the wording of dictation's first-launch dialog. All are to be read and approved or reworded.
- Spelling: everything in [spelling](docs/spelling.md): American, British or both; on or off by default; a personal dictionary; names; a bigger word list.
- Where mdQuire differs from what a Docs user expects: a blank document starts in the body and not the title; Enter in a table cell moves down a row; the status reads "Not saved" while typing; the outline does not scroll to keep the current heading in view; arrow down past a picture lands at the end of the next line. Decide which to change.
- Right-to-left paragraphs are laid out left to right.
- "Pink" appears twice in Text colour, and the typeface control reads "The page's …".
- The Format menu needs scrolling at 1300 by 800, and long menus run to the window's very bottom.
- About fifteen panels are sized by the window's full width, so in a narrow desktop window with classic scrollbars they meet the left edge.
- Dictation: the model files are to be pinned to a revision and checked by digest; the hashes are to be read from Hugging Face and written into `models.ts`.

### The minis and Mote

- Generalist: the page text, and its changed controls line, to review; whether the page opens on practice (as now) or on evolution.
- Generalist: the world's checker proves a path for a body that hops, and practice has no hop. Practised creatures bound and get past. Decide whether the checker should use what the body can do.
- Generalist: the ramp of costs counts each worker's own steps, so with four workers it takes about four times as many steps in all.
- Walker's engine: a body faster than about 16 m/s passes through a thin platform. Fixing it changes every result and every shared walker.
- Mote: screens at 75 and 144 Hz cannot be stepped evenly unless the minis draw between physics steps.
- Mote: a role and a label on the canvas, and a label on the sound switch, would change what a visitor sees.

### Housekeeping

- Git: delete the leftover local branches once nothing holds them (the fixers' `fix-*` branches and twelve older ones).

## Not yet verified

- The resume's PDF, by eye.
- Dictation with a real voice, on phones, and in Safari.
- mdQuire in Firefox and Safari; on a phone; with an input method on a real device; AltGr on Windows; with a screen reader.
- Word files from mdQuire, opened in Word.
- mdQuire's table of contents: its links against the site's real heading ids.
- mdQuire: every action on a shelf card, and cut and paste between two documents.
- Frame rates on a real graphics card. Everything was measured with software drawing.
- That the live site's headers match `public/_headers`.

## From the audit of 13 November

What was found and fixed is in [`docs/AUDIT.md`](docs/AUDIT.md). Still open from it, besides the decisions above:

- mdQuire: editing a block rewrites the whole block, so untouched odd spellings in it (a doubled backslash, two spaces as a line break, `&amp;`) are normalised.
- mdQuire: a line of 100,000 opening brackets takes the reader four seconds; deeply nested `<u>` is slower still.
- mdQuire: the old `math` mark is still named in `docx.ts`, `export.ts`, `html.ts` and `surface.ts` and can go.
- mdQuire: errors on the shelf are shown nowhere.
- mdQuire: HEIC and AVIF pictures keep their metadata.
- A browser test that throws before closing its browser leaves Chromium running.
- Photo notes in the editing server have no check against two tabs.

## mdQuire

- Better spelling, with a word list of its own, once the questions in [spelling](docs/spelling.md) are settled.
- What Google Docs has that mdQuire does not: the list to choose from is in [mdQuire against Docs](docs/mdQuire-against-docs.md).
- Fluidity: typing, opening and closing, the bar; whether the caret glides.
- Polish the top bar by using and testing it.
- Decide when the page and its project page stop being hidden.
- Whether a passkey write area that saves into the repository is still wanted.
- What two typed equals signs should become, if anything.

## Generalist
- Next round, when the machine is quiet: hold a walk at ten minutes of practice and through whole worlds (the strict test stays). To try: a lean cost between 1 and 2, a small spin cost, a cost for standing at obstacles, several learner seeds in the page. It ships only when it does.
- Accepted: progress paid up to walking pace only, a cost for leaning, no rhythm sense for two legs, older saved two-legged learners forgotten.

- The teacher that evolves worlds (after ACCEL).
- Curiosity, food and energy: tiredness and recovery, never dying of hunger.
- The risky bet: a fixed brain that adds and cuts connections paid for in energy, its rule found by evolution.
- Memory, rhythm and mood neurons; connections that change by a learned rule; a cap on neurons.
- The brain's sliders within limits; a changed brain keeps what it can.
- Changing the world while it lives: ground, gravity, wind, day and night, things dropped in front of it.
- Senses: eyes it moves, touch, hearing or smell.
- Doing: food, using things, play, a second creature, calls between them.
- A creature saved as a file and loaded again.
- The small vision encoder, trained once on the owner's machine after asking, then the picture experiment.
- WebGPU for the brain's arithmetic and buffers handed over without copying, measured.
- Culture: each creature watches the last one's best runs.
- The article: a short story, then a simple technical write-up with the commands to rerun it.

## Comet

- Have it seen and played; decide whether it is what was wanted and when it leaves draft.

## Sending files between devices (Foxy's idea, rethought)

- After the Quires are good. To be thought through again before anything is built: the existing Rust tool and its specification are not the plan.
- What it is for: between the owner's own machines, phone to PC, and to a friend anywhere.
- Finding each other with no server at all: a QR code shown and scanned both ways.

## Site

- Spectrum: show the credit its license asks for somewhere a visitor sees it.
- Three details on the resume.
- Captions for photos.
- The 404 page with falling blocks.
- A public wiki about the projects and licensing.
- Accent colours from the two flags, quiet and optional.
- A small project like pronouns.cc.
- More queer memes on the photos page.
- Whether to adopt the one set of controls kept in the tag `controls-archive`.

## Mote

- Make the API even: pixels and y down in `flat.ts` against units and y up in `space.ts`, `still` as a value against a call, rows of bare numbers.
- Tests for `stage.ts`, `solids.ts`, `sound.ts` and `index.ts`.
- Features as minis need them: camera, particles, sprites and tiles, springs, sensors, replays, a debug view, two-finger touch, text input.
- 3D: smooth shading, shadows under solids, pictures on faces, models from files, a wireframe view, a movable camera.
- A repository of its own, if anyone else wants it.

## Minis

- A post about writing the physics, with a mini at each step.
- The Blocks demo on the home page.
- Physics minis: a ragdoll, a tower to knock down, a seesaw, a marble run that is drawn.
- Small games: something with the 3D solids, two people on one keyboard, a daily puzzle.
- Terminal recordings of full-screen menus.

## mdQuire, chosen on 13 November and not yet built

- The menus in Google Docs' order and names, a sign on every line, long menus folded into groups, each thing in one menu only.
- In the bar, alignment (left, centre, right, justify) as one button that grows open in place, and the three lists as another.
- Links: an address pasted over selected words links them; a pasted bare address gets a small chip to show it as words or a short form; resting on a link shows a card with open, copy, edit and remove.
- Subtitle in a plain Markdown file too, kept as a `subtitle:` line in the frontmatter (today it exists only in a `.quire` document).
- Deploy after the menus and the bar are reworked. mdQuire and its project page are listed once the audit's findings are fixed.
- The findings of the audit of how mdQuire looks and behaves ([mdQuire-ux-audit](docs/mdQuire-ux-audit.md)), starting with its ten changes.
- Suggesting the next words while typing: faint words after the caret that Tab takes, learned from the owner's own documents and posts in the browser, with no model.
- Spelling: American, on by default, with a personal dictionary.
- In the light paper look the list of documents sits on a light sheet too.
- An emoji picker: a grid with search and what was used lately first.
- New kinds to start from: meeting notes, a changelog entry, a project page.
- The shared core ([quire-core](docs/quire-core.md)): the app as a framework in `src/quire/`, each Quire a plug-in.

## imgQuire and the background remover

- Settle the questions in [imgQuire](docs/imgQuire.md#open) and [cutout](docs/cutout.md#open) before building; first, what imgQuire's file is.
