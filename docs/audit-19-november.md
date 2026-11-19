# Audit of 19 November 2026

Asked for by the owner as one thing: bugs and stability, with the site kept as simple as it is. This file
says how it was done, what was clean, what was found and fixed, what was found and is the owner's to choose,
and what was not done. The audit of 17 November is in [audit-17-november.md](audit-17-november.md).

Nothing was added to the site and nothing was deployed. Three faults were fixed, one commit each.

## How it was done

The machine was busy all through (a load of 10, 19 GB in swap, other work running), so everything was run on
three cores at the lowest priority, and nothing long or heavy was started.

- **By machine, without a browser.** The lint and the type check. Then every built page was read for what it
  names: each link, picture, script, style and anchor was looked up among the built files, each page's ids
  were checked for doubles, and each page for its title, description, language, page policy and one top
  heading.
- **By machine, in a browser.** Every built page was opened in one headless browser at 1280 and 390 wide.
  Written down for each: errors thrown, errors and warnings logged, refusals by the page policy, requests
  that failed or answered 400 and over, pictures that did not load, and sideways scrolling. The driver the
  tests use hears thrown and logged errors only, so this was done with a reader that also hears the
  browser's own log and the network.
- **With things taken away.** The same pass three more times at 1280, each with one thing a browser may
  lack taken away before the page's script ran: storage (reading it throws, as it does where site data is
  blocked), WebGL, and WebAssembly on the page's thread.
- **Against the live site.** Its headers and a few addresses were fetched and compared with the repository.
- **By reading.** The layouts and the scripts every visitor loads (the page change, the picture viewer, the
  terminal, the photos page, the contents, the timeline, the minis' stage), and the deploy's own steps.
- **Tests.** The site's own, the scripts' and the build steps' (96), and the 185 test files that drive no
  browser. The 74 files that drive a browser, and the minis' and Mote's long run, were not run: see
  Not done.

## What was clean

- The lint: 674 files, nothing to put right. The type check: 736 files, no errors, no warnings.
- All 45 built pages: no dead link, no dead anchor, no id used twice, no picture or script that is not there.
- All 45 pages at both widths: nothing thrown, nothing refused by the page policy, no request that failed,
  no picture that did not load, no sideways scrolling.
- With no WebGL, no page throws, and Dice still draws its tower. With no WebAssembly, the Walker says it
  could not be loaded and that reloading may help. With storage blocked, every page outside the editors
  works.
- The live site sends the headers `public/_headers` asks for: the five on every page, five minutes for
  photographs, a year and the embedder policy for built files. This had stood as not yet verified.
- The main pages are still light: 10 to 26 KB of script each (4 to 11 KB sent), the photos page's list of
  324 pictures aside.
- The site's own tests: 96 of 96. Of the 1,305 tests in files that drive no browser, 1,304 passed; the one
  that failed is a test of speed (below).

## Found and fixed

1. **mdQuire and imgQuire did not start where the browser refuses its storage.** With site data blocked,
   the very reading of `localStorage` throws. The editors were written to open all the same and keep
   documents in the tab, but two defaults reached for the storage outside any guard: the repository's
   settings (the app asked for them with the nothing it had found, which fell back to the storage that
   throws) and dictation's word list. The page stayed empty: the trail and one button. Both now go through a
   guarded reader, each with a test that failed first. Seen again in the browser: mdQuire's whole home
   screen, 84 controls, where there had been one.
2. **A deploy could put uncommitted pictures live.** `bun run deploy` asked its guard whether everything
   was committed, then built; but the build adds any pictures waiting in `photos/`, after the guard had
   answered. The guard is asked again after the build, as the editor's Publish already did. No pictures
   were waiting on the day. A test holds the guard's place in the deploy.
3. **The scrolling keys moved the page under an open picture.** On a page that itself scrolls (the photos
   page), Page Down, the arrows, Home and End scrolled the page behind the viewer, from 55 pixels to 267 in
   the test, where the viewer's notes say keys do not reach the page. They do nothing while a picture is
   open and scroll again once it is closed. On a post or a project the page already held still, and a
   terminal opened to the whole window holds it too.

## Looked into and dropped

- **"another" on the photos page going dead** after several pictures in a row were not there. By reading,
  it could be left asking for a picture that does not exist. In the browser it cannot be reached: a picture
  that is not there always loses to its placeholder, so there is always a next one, and with every picture
  blocked and then let through again the page went on by itself. Nothing was changed.
- **Four buttons with no words in imgQuire.** They are the batch's, folded away and out of reach of the
  keyboard and of screen readers until there is a batch.

## For the owner to choose

Each is as it was found; nothing here was changed.

1. **Four pages made for trying and testing are on the live site.** `/mdquire-lab/` with its three
   mock-ups, `/mdquire-kinds/`, `/mdquire-drive-try/` and `/mdquire-dictation/` are built with everything
   else and deployed. None is linked or listed, and all ask not to be indexed, but anyone with the address
   can open them. The three mock-ups are bare files: they carry no page policy and ask for an icon that is
   not there. The lab's choice was made on 12 November and the mock-ups are also kept in `design/mdquire/`;
   the other three exist because tests open them in the built site. The ways it could go: leave them; take
   the lab out of the site and keep its files in `design/`; build the three test pages only when the tests
   ask for them.
2. **The scripts of the interests page are deployed though the page is not.** Two files, 5.7 KB together,
   that no built page names. They hold code and no words. The build's pruning of unused files leaves
   scripts alone; it could take these too.
3. **Tests of speed fail on a busy machine, and the machine is busy.** One failed today (the checker's
   slices against 16 ms); the audits of 16 and 17 November each met others. Five tests in files that drive
   no browser pass or fail by the clock (the checker's slices and its hostile documents, highlighting,
   styles, and imgQuire's grading on a card), besides the two of typing speed in the browser. A red run
   that may be the clock is harder to trust than a green one. The ways it could go: leave them; have a test
   of speed always print its number and fail only when asked to on a quiet machine, before a deploy say;
   widen the limits.
4. **Every opened page carries its styles inside it, and they have grown.** The build writes all styles into
   each page so that it draws after one round trip, a choice made when they were small. Now a post, a
   project, the bio, setup and license each carry 72 to 79 KB of styles in a page of about 93 KB (about 24
   KB sent), the lists 26 to 37 KB, and the tools 122 to 152 KB. They are sent again with every page. The
   other way is styles in files of their own, kept by the browser from one page to the next. Not measured
   on a slow connection; it may well be fine as it is.
5. **Twelve known faults in tools the build uses, none in anything a visitor is sent.** Four high, six
   moderate, two low, all in two packages that come with the tools: `undici` (under Wrangler and under
   Astro's font fetching) and `fast-uri` (under the type check). `bun audit fix` takes the versions that
   mend them, within the ranges already allowed; a build and a check would confirm it.
6. **The list of minis runs every mini at once.** Each card is the mini itself running small, and a
   preview never comes to rest, so five run for as long as the list is open and in view. It is as designed.
   What it costs a phone was not measured; a headless browser drawing in software cannot say.

## The machine

Not faults of the site, but they bear on how it feels to work on and how tests behave.

- 1.7 GB of an earlier session's scratch (films, pictures, a build) has sat since 16 November in the
  temporary folder, which is kept in memory. Two empty browser profiles from tests that died are beside it.
- A preview server started on 17 November is still running, its starter long gone. It is small, and this
  audit used it.
- A local branch, `sand-looks-options`, holds one commit that is not on `main`: the looks for Sand to
  choose between. The choice was made on 16 November.
- A build's log from 13 November is left in the folder for agents' worktrees.

## Notes that had fallen behind

Put right with this audit:

- The live site was said to be as it was on 11 November. It was built from the commit of 17 November,
  19:58, and `main` was 25 commits ahead of it when the audit began.
- Sand was said to be a draft waiting to be listed. It is listed and live.
- The index of these notes said of imgQuire, Marbles and the cut-out that nothing was built.
- The site's notes gave photographs a week in browsers and called a shorter time undecided; they have had
  five minutes since 13 November. They also said an audit of the whole site was being written.

Still behind: `CHANGELOG.md` ends on 13 November.

## Not done

- **The tests that drive a browser** (74 files) and the minis' and Mote's long run. On a machine this busy
  they fail by the clock and would have slowed everything else. They want a quiet hour.
- **A build.** The built site of 18 November was used, made a minute before the last change to the source.
  The three fixes were checked by their tests, by the type check, and in the browser on the dev server.
- **Twelve share pictures.** The check of the pictures shown when a page is shared passed, but it has no
  record of what twelve of them were made from (the site's own, five projects', one post's and five
  minis'), so it cannot say whether those are out of date. Making them again records it; that opens a
  browser for each and was left for a quiet hour.
- **Other browsers, a phone, a real graphics card.** As before.
- **The editors by hand.** They were audited on 13, 16 and 17 November. Here they were only loaded, at two
  widths and with things taken away.
- **The timeline's scrolling**, which takes the wheel, the keys and a finger for itself. It is the most
  intricate thing a visitor meets on a main page and can only be judged on real devices.
