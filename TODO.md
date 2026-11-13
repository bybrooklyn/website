# To do

Everything still open, by project, most important first, one line each. The detail behind each item is in
the project's file in [`docs/`](docs/README.md); what has been done is in [`CHANGELOG.md`](CHANGELOG.md).

## Waiting on a decision

### The site and what it publishes

- Deploy: when. The live site is several days of work behind `main`, and none of the audit's fixes are live.
- The about page, the resume and one post name where the owner studies, works and volunteers, which together narrow down a place. Keep, or cut the place names and rebuild so the resume's PDF changes too.
- Git history is public and holds a personal email address in early commits and every photograph ever added, removed ones included. Clearing it means rewriting history again.
- The drafts preview address is public unless Cloudflare Access is put in front of it.
- The site says it does not track, while visitors' browsers ask GitHub for star counts. Reword, or fetch the counts at build time only.
- The setup page lists a download stack that a reader may take as piracy.
- The Terrustia recording shows a game server's port (the game's default).
- The code and engines of draft minis ship in the live build though their pages are not listed.
- Posts have no style for a `#` heading in the body, so the site draws it as large as the title. mdQuire now draws it smaller. Decide whether posts get the same rule.
- Sentences in content that are no longer true: `dice.mdx` (typing a roll; there is no text box), `generalist.mdx` (learning by evolution, twice), `plinko.mdx` (what its settings change), `mote.mdx` (how many things the minis page has).
- The share picture of the colophon post is out of date and is to be made again.
- A guard on `bun run deploy` that refuses a branch other than `main` or uncommitted changes.
- Page policy: whether the `blob:` allowance for pictures stays as it is ([mdQuire](docs/mdQuire.md#known-weak-spots)).
- Looks that are a matter of taste, noted and not changed: terminals and the Playmatter clip play when scrolled to; on the photos page "another" falls just below the fold on a laptop; the mdQuire cover card is narrower than the others; on a phone the back-to-top button sits over text while reading; at 1920 wide the main pages leave the right half empty; on Comet the pull band runs off the left edge.

### mdQuire

- About thirty new sentences a writer can see were written during the audit (the "Not saved" dialog, errors from the stores, errors on opening a damaged file, one about spelling being unavailable) and the wording of dictation's first-launch dialog. All are to be read and approved or reworded.
- Spelling: everything in [spelling](docs/spelling.md): American, British or both; on or off by default; a personal dictionary; names; a bigger word list.
- A spoiler cannot be written inside a table cell, where pipes are cell edges. One that arrives there is written as its words. Confirm.
- Backspace removes the last accent of a letter; Delete removes the whole letter. Confirm.
- Whether the GitHub token moves from `localStorage` to `sessionStorage`.
- Dictation: the model files are to be pinned to a revision and checked by digest; the hashes are to be read from Hugging Face and written into `models.ts`.

### The minis and Mote

- Generalist: keep or take out the small reward for one foot down, a rule about how to move ([generalist](docs/generalist.md#open)).
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

- Get two legs to walk with a foot always down, without a rule about how to move.
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

## imgQuire and the background remover

- Settle the questions in [imgQuire](docs/imgQuire.md#open) and [cutout](docs/cutout.md#open) before building; first, what imgQuire's file is.
