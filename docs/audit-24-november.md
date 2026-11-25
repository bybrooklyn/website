# Audit of 24 November 2026

Asked for by the owner, who chose to act on the six choices the audit of 19 November had left
([audit-19-november.md](audit-19-november.md#for-the-owner-to-choose)), each by the question tool, and
added three things of her own: hiding the interests page, the Walker and the generalist from every build,
and seeing about updating the dependencies. Nothing was committed between the two audits. Nothing was
deployed. The machine was busy all through (a load of 20 to 28 and 24 GB in swap), so everything ran at
the lowest priority.

## What was chosen and done

1. **The pages for trying and testing are off the live site.** The mdQuire lab and its three mock-ups are
   taken out of the site; their files stay in `design/mdquire/`. `/mdquire-kinds/`, `/mdquire-drive-try/`
   and `/mdquire-dictation/` are built on the dev server and by a new command, `bun run build:test`, and
   by no build that is deployed (`src/lib/test-pages.ts`). The dictation browser test, which opens one of
   them, passed against `build:test`: 15 of 15.
2. **The build takes out scripts and engines that nothing names.** It already took out pictures and
   trailers; now any script in `_astro/` and any engine in `wasm/` that no other built file names is
   removed, round after round, since removing one can leave another unnamed. 62 files are removed where
   58 were. Every script and engine any page or script names was checked to be there after.
3. **The interests page is hidden.** It is built nowhere, not on the dev server and not in a drafts
   build, until the owner says so (`HIDDEN` in `src/lib/interests.ts`). Its words are still to be read by
   her before it goes out.
4. **The Walker and the generalist are hidden.** A mini with `hidden: true` is left out of every build,
   and its scene is left out of what the minis' loader can fetch, so no page, script or engine of theirs
   is built (`minis.md`, "Hidden"). Sand had taken its check for SIMD from the Walker's file, which
   brought the Walker's engine along; the check is a file of its own in Mote now. Comet, the third the
   owner named, had been removed on 18 November.
5. **Tests of speed fail only when asked to.** Each prints what it measured; on a busy machine a slow time
   is a warning and the run stays green, and `STRICT_SPEED=1` holds them to their limits on a quiet one.
   Ten limits in six files go through one helper, `scripts/speed.ts`. In this audit's own run, two were
   over: checking a block again after an edit, 17 ms against 12, and the slowest of 3,000 hostile
   documents, 1,068 ms against 100. The second is far over for a busy machine alone, and is worth timing
   again on a quiet one.
6. **The minis list runs one mini at a time.** The card under the mouse, reached with the keyboard or last
   touched runs, or else the first in view; every other card runs its first two seconds and holds that
   frame, so that it shows something. Checked in a browser: pointing at Plinko started it and stopped
   Blocks, and taking the pointer away gave Blocks back; the still cards show Dice's tower, Plinko's
   board with balls in it and Sand pouring.
7. **The build's tools are up to date within their majors.** The twelve known faults are gone (`bun
   audit` finds none in 451 packages). Astro is 7.4.13, Wrangler 4.168.0, and the Markdown, MDX and
   sitemap integrations, Bun's types and the icons take their latest patches. Every built page is the
   same as before, word for word and link for link, but for its build stamp; the check passes.

## Measured: styles inside each page or in shared files

The owner chose to measure before changing anything. The site was built both ways and both were served
as the live site serves them (built files kept a year, pages checked every time, everything compressed),
then opened in Chromium as a phone, 390 wide, with a fresh cache, going from the home page to a post, a
project, the bio and the QR tool. Three runs of each; the medians. The processor was not slowed, since the
machine was busy enough already.

| On slow 4G (1.6 Mbit/s, 560 ms) | Inside: first paint, loaded, KB sent | Shared files: first paint, loaded, KB sent |
| --- | --- | --- |
| First visit, home | 804 ms, 2,008 ms, 129.4 | 1,412 ms, 2,156 ms, 125.4 |
| Then a post | 728 ms, 1,842 ms, 115.6 | 1,320 ms, 2,370 ms, 110.8 |
| Then a project | 732 ms, 2,444 ms, 34.6 | 1,252 ms, 2,431 ms, 19.3 |
| Then the bio | 720 ms, 1,319 ms, 26.2 | 632 ms, 1,275 ms, 9.9 |
| Then the QR tool | 780 ms, 2,160 ms, 66.6 | 1,400 ms, 2,126 ms, 63.4 |

| On 4G (9 Mbit/s, 150 ms) | Inside | Shared files |
| --- | --- | --- |
| First visit, home | 496 ms, 805 ms, 126.3 | 424 ms, 591 ms, 126.5 |
| Then a post | 248 ms, 507 ms, 100.8 | 356 ms, 573 ms, 96.0 |
| Then a project | 184 ms, 649 ms, 34.6 | 344 ms, 640 ms, 19.3 |
| Then the bio | 196 ms, 355 ms, 26.2 | 184 ms, 329 ms, 9.9 |
| Then the QR tool | 204 ms, 574 ms, 67.2 | 364 ms, 547 ms, 64.0 |

Styles inside each page draw first sooner nearly everywhere, by about half a second on the slow
connection, because each kind of page uses a different set of the site's style files (a post asks for
seven), so going to a new kind of page still waits for a round trip or more. Shared files send 5 to 16 KB
less on each page, and are ahead only where every file is already kept (the bio, after a project). Keeping
styles inside the page is the faster choice for this site as it is. Nothing was changed.

## Left for the owner

- **TypeScript 7 and ONNX Runtime 1.31.** Each is a larger step than the updates made. TypeScript 7 is the
  rewritten compiler, and `astro check` would have to support it first; ONNX Runtime runs dictation and
  the cut-out, from files listed by hand in `astro.config.ts` (and a smaller build that can be made by
  hand, `src/quire/md/dictation/parakeet/RUNTIME.md`), so moving it means testing both with the real
  models.
- **mdQuire's spelling and grammar,** which the owner found let a lot through and marked things that were
  right while she wrote a story on the live site. Asked for during this audit, and taken up after it.

## Not done

- The browser tests as a whole, and the minis' and Mote's long run: the machine was too busy. The tests of
  the files changed were run, and the dictation browser test.
