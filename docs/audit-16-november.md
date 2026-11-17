# Audit of 16 November 2026

Asked for by the owner, who found the site and the things added to it inconsistent in design and layout, the
image editor bad and confusing, many things broken, and far too much code in the repository. This file says
how the audit was done, what it found with its numbers, what was changed, what the owner decided, and what is
left. The audit of 13 November is in [AUDIT.md](AUDIT.md).

## How it was done

- **By machine.** The whole test suite was run; every kind of page was opened at 1288 and 390 pixels wide and
  looked at for errors, sideways scrolling, pictures that did not load and dead links; and the code was read
  by script for files nothing reaches, exported things nothing names, style rules for classes nothing writes,
  and runs of lines written twice.
- **By hand.** Three testers used the real pages in a headless browser with real presses and drags, every
  control, at both sizes, and changed no code: one on imgQuire, one on the cut-out, the QR codes and the
  converter, one on the Sand mini, counting grains. Each finding was seen twice before it was reported.
- **By asking.** What to cut, how the image editor should be laid out, and how Sand should look were put to
  the owner as questions with pictures, and built only as answered.
- Nothing was deployed.

## How much code there is

184,500 lines of code and tests on the day. Almost none of it is unused: four exported things are named
nowhere at all, and 37 of 1,267 classes in the stylesheets are written by no source file. The size is
features.

| What | Lines of code and tests | Share |
| --- | --- | --- |
| The minis, with their Rust engines | 50,400 | 27 in 100 |
| mdQuire | 43,300 | 23 |
| imgQuire | 28,200 | 15 |
| Stylesheets | 16,200 | 9 |
| The core the tools share | 12,200 | 7 |
| The converter | 8,400 | 5 |
| Mote | 7,700 | 4 |
| The website itself: pages, components, page scripts | 6,000 | 3 |
| Build tools | 5,100 | 3 |
| QR codes | 4,400 | 2 |

Draft minis no visitor can see came to 35,400 lines, a fifth of everything: the Generalist 17,100, Marbles
11,300, Sand 6,500, Comet and Rolling 560. Tests are about a quarter of all lines.

**Decided.** No draft is deleted. mdQuire's source is marked as vendored in `.gitattributes`, so that GitHub's
language bar and counts leave it out. Nothing was removed from imgQuire: what is outside the four jobs the
owner uses it for goes under one word, "more".

## What the machine found

- Every page was clean at both widths: no errors, no sideways scrolling, no dead link among 49. The QR page
  holds three pictures with no address, which draw nothing.
- The whole suite, 2,305 tests, had ten failures:
  - One was a real fault of that morning's work: the photos script had gained a file its test's scratch copy
    did not bring along. Fixed.
  - Five were one weakness. Forty-one tests that drive a browser ran on Bun's own limit of five seconds; on a
    busy machine one of imgQuire's grading tests ran out of it, and the three after it failed with it, since
    they share its page. Every test now has sixty seconds unless it sets its own (`scripts/test-setup.ts`,
    loaded through `bunfig.toml`).
  - One pressed a button from script to open a file chooser, which Chromium opens only within a few seconds of
    a real input, so it failed whenever the machine was slow. It now presses with a real click.
  - One waited for the wrong thing; one looked its results up under words that had since become lowercase.
    Both fixed.
  - One is fragile and was left: the spelling test fails when unknown words in the site's own comments pass
    4 in 100, and they stood at 4.002.
  - One needs a quiet machine and was left: the part models' real run takes longer than the browser driver
    waits for one answer while the graphics card is busy with other work.
- A picture a model is given was drawn on the graphics card and could read back empty when the card was busy.
  It is drawn on the processor now.

## What the testers found, and what was done

**imgQuire, thirteen findings.** Nine were faults and are fixed, each with a test: a resized picture is fitted
and centered again; a crop's shape holds while the level dial turns, and the crop is no longer lost; Escape
keeps a text being typed; Ctrl with the wheel zooms as gently as the plain wheel; Escape leaves the crop after
the dial was used; the size line follows the crop's frame; the name's field takes the keyboard at once;
version history no longer lies over the picture; and a picked box, cover, highlighter, magnifier or spotlight
has handles to resize it, an arrow one at each end. The rest were the editor's layout, which the owner then
chose anew (below).

**The cut-out, the QR codes and the converter, fourteen findings, all fixed.**
- Cut-out: a press on the picture threw the cut-out away with no way back. Now a press on something kept keeps
  only that, a press on something left out adds it, and Ctrl+Z takes a press or a brush stroke back. "choose a
  picture" in the empty box could not be pressed, an empty canvas lying over it. Page Down and Up stopped
  after a small picture was pressed. A picture of 8 by 6 was a dot. A file that is no picture was not named.
- QR codes: a hex line kept digits that were no color while the code kept another; the password's line stayed
  with a network that has none; a file that is no picture left the old reading on screen.
- Converter: a format chosen after converting left the files as they were with convert out of reach; a zip of
  one file was no zip; the list showed two rows over empty room; a control reached by Tab lay under the words
  pinned at the window's foot; an empty file's line ended on a comma.
- In all three a word out of reach kept the underline that says to press it.

**Where a cut-out's model finds nothing.** The best model answered that everything was background on four of
eleven of the owner's photographs. The full-size model cannot run on WebAssembly at all. Another model was
tried and not taken. The owner chose a press: the page and imgQuire's tool say "Nothing was found to cut out.
Press the thing you want to keep.", and each press adds to what is kept. The whole of it is in
[cutout.md](cutout.md).

**Sand, seventeen findings.** Fixed in the engine, each with a test: a flame lives about five times as long
and lights wood readily; oil burns as a fire moving across it where it had flashed off or never caught; lava
sinks in water, hisses and leaves loose rock, where it had hardened into a stone raft resting on the water;
ash and flames no longer dam water; steam poured with the brush reaches a roof and rains later; smoke and
steam can be seen and steam no longer reads as stone; the keys work wherever the keyboard is in the mini. At
the owner's word the world is four times the grains, one CSS pixel a cell. Left: oil does not catch from
flames that never touch it, and embers keep burning where the water beside them boils away. See
[sand.md](sand.md).

**Marbles.** Panning went the wrong way, the drag handed to the camera with its sign turned. Fixed, with a
test that holds the direction.

## Design and layout

Measured on the day: three page frames (the site's header with its navigation; the opened panel a post, a
project or a mini has; the editors' own top), four left edges for content (49, 122, 183 and 0 pixels), four
kinds of thing to press (underlined words, plain words, filled round buttons, boxed pills).

**Decided and done.**
- A tool page sits in the opened frame as a mini does, with the trail "tools / Name" leading to an unlisted
  list at `/tools/`.
- The small tools are one box: the work on the left, a column of controls on the right, written as the Walker
  mini's column is, from one kit (`src/quire/core/bench.ts`, `quire-bench.css`). The cut-out, the QR codes and
  the converter are built from it.
- Letters: what is on the page is lowercase, names keep their capitals (PNG, WebP, Wi-Fi, GitHub), the lines
  of menus and tooltips keep a first capital, sentences keep theirs. Applied to the three small tools and to
  the on-page labels of both editors.
- About, setup and license start at the page's left edge with every other page that has the navigation.
- A background cut away fades out where it had vanished between two frames.
- Sand has one look, chosen from pictures of three palettes, three kinds of light and four stages: softened
  colors leaning to the site's violet with every two materials tellable apart (a test holds how far), light
  from fire and lava on the grains near them and a glow in the air, water lighter at its surface and darker
  below, and the materials and controls in a column beside a stage with soft edges and a floor, so that the
  whole stage and every material are in the first screen at 1288 by 828.

**Decided, being built on the day.**
- imgQuire keeps its menu bar; under it every tool has its word: crop, resize, mark up, cut out, color, then
  export and more. A picture opens with no tool on. One side panel is always there and holds the controls of
  whatever is on, so nothing floats over the picture and the picture never glides aside.

## Left

- The two tests named above as fragile and as needing a quiet machine.
- The editors' panels and dialogs beyond imgQuire's new layout, and mdQuire's layout, are as they were.
- Undo on the cut-out page is by the keyboard only.
- The lists of the site (blog, projects, minis, photos, tools) are laid out four ways; not looked into
  further.
