# Audit of 13 November 2026

Every source file in the repository was read line by line, every page outside the editor was looked at in a
browser at three sizes, and what was found was fixed where fixing was a matter of fact. This file says what
was done, what was found, what was changed, and what was left and why. What is still open is in
[`TODO.md`](../TODO.md).

## How it was done

- **Reading.** The code was divided into twelve areas. Each was read whole by one reader that changed
  nothing and wrote down, for every finding, the file and line, what goes wrong and with what input, how
  sure it was, and the smallest fix.
- **Looking.** Thirty-five pages were opened at 390, 1280 and 1920 wide: scrolled through, tabbed through,
  and everything that opens was opened. Each mini was played.
- **Fixing.** Each area's findings went to a fixer on a branch of its own. A finding was confirmed first,
  with a failing test where a test was possible, then fixed in a commit of its own. Findings that could not
  be reproduced were dropped and say so.
- **What was not changed.** The words of content pages, anything that is a matter of taste, and anything
  that would change results that are relied on (the Walker's physics). Those are listed under "Left".
- Nothing was deployed.

## What was found and fixed, by area

### The editor's Publish, the build and the tools (18 findings, all addressed)

- Publish staged every file in the folder, and a file of secrets was kept out of commits only by care. It,
  `.env` files and key files are now ignored by git, and Publish stages only `src/` and `public/`.
- Publish works from `main` only and builds again after committing, so what is deployed is what was
  committed.
- `bun run deploy` runs the whole check, with the lint and the share pictures, and no longer only the type
  check.
- Held posts (`*.hold.mdx`) are left out of every build. Before, the drafts build would have published one.
- The editor's stop command could have stopped a dev server it had not started. It now stops only its own.
- The editing server's one path-traversal hole (`/api/exists`) is closed, uploads are served sandboxed, and
  the key is taken out of the address after loading.
- The browser driver waits for Chromium to end, kills what is left, and no longer hangs on a dead browser.
- `bun run projects` no longer empties its facts file when GitHub cannot be reached.
- The linter's holes are closed, and it now refuses an IP address, a tailnet name or a written-down port in
  tracked files.

### The site's pages and scripts (27 findings and a cleanliness list)

- The engines of the minis load by an address that carries a hash of their contents, so a returning visitor
  cannot run new script against an old engine.
- Photographs are cached for five minutes and then checked against the server. They had been cached for a
  week, which kept removed pictures in caches.
- The page policy allows frames from itch.io only, and the embedded game is sandboxed.
- The minis' test files were being built and deployed. They are not any more.
- Values read from the address are validated.

### The stylesheets (30 findings)

- A keyboard sweep of 1,379 controls found 266 focus rings cut off by clipping, and 34 more in opened
  states. All are whole now. Five styles of focus ring became one.
- No page scrolls sideways at 320, 360 or 390 wide.
- A field's edge reaches 3:1 against its ground (from 1.5:1) and the terminal's grey text 4.5:1.
- Styles nothing used were removed.

### What was seen in the browser (14 findings)

- On the about page, Tab past the timeline now brings the focused link into view.
- A terminal opened to full size fits the window in both directions.
- The Walker is in view on a laptop's first screen.
- "cite this" and the phone's contents list grow open.
- On a phone the back-to-top button no longer covers the footer.
- A distance is never shown as minus zero.

### Mote (26 findings, 22 fixed)

- A leak of graphics memory: dragging Plinko's slider through 200 steps left 24,590 live buffers. It now
  stays at 88, and a step takes 0.7 ms where it took 24.6 ms.
- A lost graphics context is restored. Before, the board stayed blank.
- The sheet of drawn words reuses its cells, so numbers no longer go wrong after about a hundred dice rolls.
- Sound resumes at the first press. Reduced motion is no longer overridden.
- A bad time step (not a number, negative, huge) can no longer freeze physics.
- Stepping is even at 60, 120 and 240 Hz.

### The minis (29 findings)

- Blocks: narrowing the window no longer strands blocks outside the walls.
- Dice: keeping more dice than were rolled keeps them all (`2d6 kh3` gave 2, and now gives the total).
- Comet: a damaged saved value can no longer freeze the tab, and every field is byte for byte as it was.
- The list of minis no longer starts training workers to draw the Walker's thumbnail.
- Space and Enter work as a click on Dice and Plinko.

### The Walker's engine (23 findings)

- A bad time step or one bad score can no longer freeze the world or stall evolution.
- One piece of undefined behaviour is gone.
- Results are the same to the bit as before, natively and in both WebAssembly builds.

### The Generalist (about 20 findings, and 9 from the minis' audit)

- Taking a see-saw out of the world removed the wrong bodies. Nineteen of sixty default worlds were
  corrupted within 120 m. A test now walks 200 worlds for 200 m each.
- What is shown is the policy as it was practised: one mapping of actions is used by both.
- Practice no longer goes dead when a setting is changed while an update is in flight.
- A reloaded learner keeps its place in the ramp of costs. Learners saved before this are refused.
- The comparison of evolution with practice was run again under a stated rule (each is measured under the
  rules it learned under) and its numbers are unchanged.

### mdQuire: saving, stores and what leaves it (about 40 findings)

- Leaving a document after a failed save or a conflict no longer discards the unsaved text. The writer is
  kept, told, and offered to try again, download a copy, stay, or leave.
- After a rename, later saves go to the new place.
- Choosing the other version in a conflict, when it cannot be read, keeps the writer's.
- A save to the browser's storage is reported only when it has committed.
- Autosave and version history are tied to their document.
- Two tabs on one document reach the conflict screen.
- A downloaded web page cannot run script from the document, and remote pictures are not fetched.
- A `.quire` file is limited to 2,000 entries, 128 MB each and 256 MB in all.
- A photograph loses its location, camera and time when it enters a document, without being re-encoded.
- Page setup reaches print.

### mdQuire: typing and the interface (about 35 findings)

- A keystroke in a 5,000-line document took 10 to 15 ms, because each key replaced the block's element and
  the browser restyled every block. The block is redrawn in place: 2.4 ms, and 5 ms after a pause.
- Typing with an input method, a dead key or a phone's keyboard inside a field no longer lands in the
  document.
- AltGr is typing, so `@ # { [ |` can be typed on layouts that need it. Letter shortcuts go by the
  character typed.
- Replacements by spell-check and autocorrect, dragged text and the browser's own undo are handled. After
  any input that was not expected, the drawing is repaired from the model.
- Selections across pictures, dividers, right-to-left text and joined emoji are valid.

### mdQuire: the document and Markdown (33 findings)

- Untouched text was already safe: 10,000 random documents came back byte for byte. Edited text was often
  written so that it read back as something else. A permanent randomised test now makes edits and checks,
  after every one, that what is written reads back as what is seen. Before: 297 of 400 runs failed. Now:
  none of 5,000.
- The word "undefined" could be written into a file. It cannot now.
- Pipes in table cells are escaped. A spoiler in a cell is written as its words.
- Backspace and Delete take whole characters as a reader sees them.
- Standard Markdown's meaning wins: autolinks are links, an emoji name is not read inside a word or an
  address, and a typed sign is made only from a complete pair.

### mdQuire: checking and its stylesheets (about 37 findings)

- One address with a percent sign stopped all checking in a document. Each rule now runs guarded.
- An emoji's parts are no longer taken for words.
- Harmful words are never offered as suggestions. One in the first three suggestions happened 13 times in
  5,963 misspellings, and now does not happen.
- Every fix a rule offers changes only what it says. The site's writing rules and the linter share one
  source.
- Checking holds the page for at most 6.4 ms at a time on 5,000 lines (from 25 ms).
- Numbers of ten and over in a list are whole. Placeholders and callout labels reach 4.5:1. Every control
  shows its focus ring.
- What spelling does now, its numbers, and the questions to settle are in [`spelling.md`](spelling.md).

### Dictation (27 findings, 21 fixed)

- The microphone is released the moment dictation stops, and on every path out of a session.
- Spoken "undo that" and "delete that" take back only the phrase just dictated, once.
- Closing the first-launch dialog cancels the download, and a finished download never opens the microphone.
- No sound and no transcript leaves the browser. The only requests are for the model and the runtime.

### mdQuire seen whole (19 fixes)

After the fixes above, the editor was looked at as one thing: both looks and page view, at 1500, 1300, 1024
and 390 wide, with the browser at 150% and zoom at 200% and 50%. About 120 states.

- The caret stands where the browser's own does, within a pixel, in 23 places. It sat low on an empty line
  and to the right in headings.
- Every neighbouring pair of blocks is one line apart. Maths, flowcharts, tables, pictures and loose lists
  had broken that.
- Tables: short columns keep their words whole, the controls stay under the editor's top, and a table at
  the end of a document can be left from the keyboard.
- Things that could not be seen can be: the link field from Ctrl+K when its button is folded away, the
  search of the menus on a phone, the find bar on a narrow window, the title under the selection bar.
- Paragraphs and headings pasted from Google Docs stay apart.
- Not looked at: every action on a shelf card, and cut between two documents.

## Left, and why

- **Results that are relied on.** A body moving faster than about 16 m/s can pass through a thin platform.
  The fastest seen in real runs is 8.6 m/s. Fixing it would change every result, so it is recorded with a
  test that documents it.
- **Words on the site.** Sentences in content pages that are no longer true are listed in `TODO.md` and
  were not edited.
- **Not verifiable here.** Safari, Firefox, phones, input methods on real devices, Windows AltGr, screen
  readers, a real voice, a real graphics card, Word, and the live site's headers.
- **Design decisions.** Each is a line in `TODO.md` under "Waiting on a decision".
- **Model files for dictation** were not pinned at the time of the audit. They have been since: each tier
  names a commit, and every file its digest, so a file changed upstream is refused.
- **Slow on hostile input.** A line of 100,000 opening brackets takes the Markdown reader four seconds.

## The state at the end

- `main` holds everything above. Nothing is deployed.
- With every fix merged, the whole suite passes on `main`: 1,231 tests in 130 files, none failing, with the
  lint, the type check and the build clean. It was 731 tests before the audit.
