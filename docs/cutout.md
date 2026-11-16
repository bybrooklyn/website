# A background remover

A page that takes the background out of a picture, as remove.bg does, free and with nothing in the way:
the hidden page `/cutout/`, and the same piece as imgQuire's Cut out tool (`imgQuire.md`). "Cut-out" is
its working name.

## Where the code is

`src/quire/img/cutout/`, one piece used in both places:

- `cut.ts`: what a cut-out is (the mask a model found as runs of bytes at most 1024 a side, the brush's
  strokes, the subject pressed, what it is laid on) and the cut-out made from it at full size.
- `refine.ts`: the edges' arithmetic at the mask's size: the guided filter, and the colors of what is kept
  and of the old background near each place; `applyOne`, one full-size pixel as the card makes it.
- `render.ts`: the full-size pass on the card through WebGL2, in pieces of at most 2048 a side; `cutHere`,
  the same on the processor.
- `asking.ts`: the first-use dialog (the qualities as cards in one step, fetched only when told), a quality
  taken by name, and the dialog for the model that picks a subject by a press.
- `page.ts`: the page, one picture or many; `src/pages/cutout.astro`, `src/scripts/cutout.ts` (the site's
  colors offered), `src/styles/quire-cutout.css`. Its box, its column of controls and the line under the
  picture are the parts every small tool is built from (`src/quire/core/bench.ts`, `quire-bench.css`), so that
  the tools are one design. Many pictures use imgQuire's batch pieces: the strip
  (`batch-strip.ts`), the names and the zip or folder (`batch.ts`, `batch-out.ts`) and the small copies
  (`thumbs.ts`).
- The models run in the part models' worker (`parts/finder.ts`), pinned in `parts/models.ts`
  (`CUT_TIERS`), fetched and kept as the text models are.

## Built

**The page.** It opens the way a mini or a project does (`layouts/Opened.astro`): the site's name and the
trail "tools / Cut-out", a small label, its name, one line saying what it does, then one box with a rule round
it. Its way back is the list of tools (`/tools/`, unlisted as the tools are). In the box the picture is on the left and a
column of controls on the right, written the way the Walker's column is: a small heading for each group, round
dots for a choice of one, words in the accent to press, thin rules between, no boxed buttons, and every label
in lowercase as the site's own are, names keeping their capitals (a format, an acronym, a product: PNG, WebP, Wi-Fi, GitHub), and the lines of a menu keeping a first capital as menus have (`lowered` and `raised` in `core/bench.ts`). The groups are background (clear, color, blur; the site's colors grow out
under "color"), touch up (keep, remove: a brush, pressed again to put it down), quality (quick, best), then
copy (the main one) and save, then hold to see the original (as the backslash is) and choose another picture.
The column is there from the start, faint and out of reach until it has something to act on, so nothing appears
from nowhere; the quality and another picture need only a picture, so a quality that found nothing can be
changed. In a narrow window the column goes under the picture. Before 16 November 2026 the page stood bare
under the editor's top line with one row of boxed buttons under the picture; the owner found the row
confusing and the tools unlike each other and unlike the site, and chose this frame, the column, lowercase and
the same words under headings. The cut-out is the first tool brought to it.

Empty, the box says one line and offers "choose a picture" (and on a phone, where there is no right-click and
no keys, a plain "paste"). A picture comes in four ways: Ctrl+V, a drop, a file chosen, and paste from the
right-click menu (the clipboard read through the browser; where it refuses, the page says to press Ctrl+V).
It is shown at once; the first time a dialog in the reading dialog's family says what is needed (a model,
downloaded once from Hugging Face, kept in this browser, run on this machine, the picture never leaving it)
and shows the two qualities as cards in the same step, with "download and cut out"; nothing is fetched until
then, and after that there is no dialog. A quality whose dot is pressed and whose model is not kept is asked
for alone; told "not now", the quality in use is the one it was. While it works a line under the picture says
so; when it is done the same line says what was done. Then the cut-out on a checkerboard, the picture as it
was fading out over it in 0.6 s (also when the cut-out is laid on another ground or cut again; a stroke of the
brush is drawn at once, and under reduced motion nothing fades). A press on the picture keeps the thing
pressed when there are several. A right-click opens a menu in the site's family: paste and choose a picture
when empty; copy, save, paste, then keep and remove with a cut-out; Shift leaves the browser's own.

**The qualities.** Two, standing two in a row as cards of their usual size: Quick, MODNet (13 MB, made for
people), and Best, BiRefNet lite at 512 by 512 (98 MB, `studioludens/birefnet-lite-512`, a converted copy of
ZhengPeng7/BiRefNet_lite's weights, MIT). Each card says its time in plain words: "Under a second a picture,
people only", "A few seconds a picture, most things". With nothing remembered, the dialog comes with Best picked;
a quality chosen on a past visit wins (`quire-cutout`). Both run on WebAssembly on every machine, and nothing in
the cut-out runs on the graphics card: there the 512 file gives an empty mask with no error from ONNX Runtime,
since the card refuses one of its shaders ("no matching constructor for 'i32(vec4<u32>)'", in the pipeline
`computeSliceOffsets`). On WebAssembly Best takes 2.7 to 2.8 s a picture warm in the test here, 2.0 to 3.4 s on
the owner's photographs, 4 to 6 s the first time.

When the model finds nothing (a mask with next to nothing kept, or everything), the picture is left as it was and
the page says the next step: "Nothing was found to cut out. Press the thing you want to keep." A press then cuts
that thing out with the press model (SlimSAM, asked for once, as for choosing a subject), and each press after
adds to it, since the press model takes a thing in parts: on a photograph of a cat in an office chair one press
on the chest kept the white of its chest, and presses on the face, the chest and the back kept the whole cat.
The presses that made a cut-out are kept with it (`presses` in the cut-out, and in imgQuire's `cutout` step in
`steps.json`, at most 64), so one of many pictures keeps its own and a document opened again can be pressed
further. imgQuire's Cut out tool does the same: its status says the sentence, its strip says "Press the thing
you want to keep", the press makes the step, and each press after is one undo. The model is not run again on
the same picture, since on WebAssembly a second run gives the same answer.

Best finds nothing on some photographs: of eleven of the owner's tried on 16 November 2026, four (two of a tabby
cat on a black mesh chair, colored blocks on a table, a mineral on a wall, `20251109-135135`). Its model is a
half-size conversion, and the full-size BiRefNet lite cannot run on WebAssembly at all (it runs out of memory,
with or without ONNX Runtime's memory arena). ISNet general-use (`imgly/isnet-general-onnx`, fp16, 88 MB, MIT by
its card, at 1024 by 1024) was tried against it on the same eleven: it answered on every one in about 3.4 s
against Best's 2.6 s, but was rougher where Best works (it lost a cat's tail and kept a drawer's handle) and on
the cat in the chair kept only the head and chest. The owner chose the press over a second model, so ISNet is
not used; its file is only in the trial folder on this machine.

How the qualities came to be: until 15 November 2026 there were three, Quick, Better (ormbg, 44 MB, about 20 s on
WebAssembly) and Best (BiRefNet lite at 1024, the rebuild for WebGPU, 123 MB, on a graphics card only). The 1024
model took more than 4.4 GB of the card's memory and ran it out beside the owner's other programs, so Best mostly
ended with "the graphics card was too busy to finish". ormbg's masks on things that are not people came out
washed-out and patchy (on her photographs, in 12 to 17 s), where the 512 BiRefNet's raw mask was clean and solid on
six of seven. So the 512 BiRefNet became Best, on WebAssembly, and ormbg and the 1024 BiRefNet left the cut-out
(imgQuire's Find keeps ormbg and SAM). A choice a browser kept as the old Better (`cut-better`) or the old Best
(`cut-best`) reads as the new Best, whose id is `cut-best`. The old files a browser fetched (ormbg is still Find's;
the 1024 BiRefNet's 123 MB) are left in its private storage: the model store has no way yet to take one model's
files out, and a way to do it safely (never a file another tool still uses) is its own small piece of work; clearing
the site's data takes them away. With nothing on the card, the cut-out's watching of the card (its error scopes,
the run made again in a fresh worker, "the graphics card was too busy to finish") was taken out; the repair models
keep their own.

**Edges.** The model's mask is found at its own size and kept at that size (at most 1024 a side, never read up
larger than the model answered: Best's is 512 on the picture's longer side), and applied at full size:
a guided filter in the picture's colors (radius 2, epsilon 1e-4) fits at each place of the mask the plane
`a · rgb + b` that best matches it (from the colors' 3 by 3 spread there), the planes averaged, worked out on
the processor at the mask's size; on the card each full-size pixel takes its mask from that plane at its own
color, so hair finer than the mask's pixels follows the real pixels, and a red coat is told from green grass of
the same lightness. Where a model's mask is soft across an edge the picture has sharp, the plane gives the
two sides shares short of whole and of nothing, a rim on a new background; so where the mask within 4 of its
pixels runs from under a tenth to over nine tenths, the plane's shares there are stretched from their least
to their most and an eighth at each end dropped. The old background's color is taken out of the edges: a pixel seen is `alpha × kept +
(1 − alpha) × ground`, solved for what is kept, with the ground's and the kept color near each place averaged
at the mask's size (three box blurs of radius 8 weighted by the mask and by what is not in it); below a share
of 0.02 the kept color nearby stands in, blended up to 0.3. The card's pass reads those numbers between their
entries by hand, so it gives the processor's pixels within one, on every background (`render.test.ts`).

Measured on a figure with forty strands a pixel wide against a green ground, its true mask known, the mask
given at a quarter size (`refine.test.ts`): over 5,039 edge pixels the mask's error is 6.0 of 255 guided
against 87.8 simply enlarged; the halo, the edge color's distance from the figure's own, is 15.6 of 255 with
the ground taken out against 52.7 with the picture's own edge colors (15.5 before sharp edges were
tightened; held under 16). Across a sharp, straight edge between a red coat and green grass of the same
lightness, its mask given at a quarter size and softened once more as a model's is, the band of partly clear
pixels (a share from 0.05 to 0.95) is 1.0 pixel wide in the cut against 11 in the mask enlarged (held to at
most 1.5).

With Best's mask at 512, a 4000 pixel picture's mask is an eighth of its size, not a quarter. The same two
measures with the mask given at an eighth: kept at that size and laid on by the guided filter, the strands' mask
error is 8.1 of 255 (6.0 at a quarter), the halo 8.4 of 255, and the band across the sharp edge 3 pixels wide
(1.0 at a quarter, 22 in the eighth's mask enlarged). Read up to a quarter first, as the mask was before (kept at
up to 1024 whatever the model gave), the same eighth came out at an error of 79 of 255, a halo of 32 and a band 33
pixels wide: the edge step's reach and its tightening of sharp edges are counted in the mask's own pixels, and a
mask read up spreads its soft edge over more of them. So a mask is now never kept larger than the model answered.
On a 12 megapixel photograph Best's edge is therefore about three pixels soft across a sharp edge where the 1024
model's was about one and a half; by eye on photographs from the photos page (the pictures with the report that
made this change) the outline follows the subject, with hair and fur a little softer than the old Best's.

**Full size out.** A 12 megapixel picture is cut and saved at 12 megapixels. Saved as a PNG through the
browser's own encoder, with the picture's colour profile when it has one (a Display P3 photograph keeps its
colors); the clipboard takes sRGB. Measured in headless Chromium (four cores, two WebAssembly threads, an RTX
3070 Ti for WebGPU), the model on a 2 and a 12 megapixel picture (the model's work is the same, at its own
size), warm:

| Quality | WebAssembly | WebGPU |
|---|---|---|
| Quick (MODNet) | 0.6 s | runs on WebAssembly: 0.6 s |
| Best (BiRefNet lite at 512) | 2.7 s (2 MP), 2.8 s (12 MP); 7.6 s the first time | never put there: an empty mask, one shader refused |
| ormbg, Better until 15 November 2026, taken out | 19.5 s | runs on WebAssembly: 19.5 s |
| BiRefNet lite at 1024, Best until 15 November 2026, taken out | does not run: out of memory | 0.86 s (2 MP), 0.90 s (12 MP); 2.5 s the first time, when the card had the memory |

and the edges worked out and the cut-out laid at full size, 12 megapixels: 1.3 s (the color guide and the
stretch at the mask's size on the processor, the full-size pass through WebGL2 on software drawing, in
headless Chromium).

**In imgQuire.** K, the bar's scissors or Tools, Cut out. The cut-out is a step (`cutout` in `steps.json`:
the mask as runs, the strokes, the subject pressed, what it is laid on and its color), so it is undone,
kept in versions, and drawn the same opened again with no model. The stage shows the cut-out's pixels in
place of the original's, on a checkerboard where clear; covers, marks and grades are drawn over it. The
strip: Clear, the mark colors, Blur, Keep, Remove, the quality, Take away. Export keeps the transparency
in PNG, WebP, AVIF and JPEG XL; with JPEG it says "JPEG has no transparency: what is clear comes out white."
and offers Lay it on a color or Use PNG.

**Many at once.** Several pictures pasted, dropped or chosen together sit in imgQuire's strip of small pictures
under the one shown (`batch-strip.ts`, taking room of its own, the picture fitted into what is left). The first is
cut out as one picture is; the rest are cut out one after another behind it, one model run at a time, each decoded
only while it is cut and let go, its mask kept; the line under the bar says "Cutting out 3 of 12", then "All 12 cut
out." A press on a small picture, Page Down and Page Up, or Home and End show another, which keeps its own mask,
strokes and subject pressed; Clear, Color and Blur are the page's, for every picture, and a new quality cuts them all
again. The bar gains Save all 12 as a zip and Save all into a folder (where the browser has `showDirectoryPicker`),
with Stop while they are saved: each cut-out laid as the page lays them, as a PNG at full size with its colour
profile, under its picture's own name with `.png` (the second of one name `photo (1).png`), never over a file in the
folder, two at a time, by the same code as imgQuire's Export all (`batch-out.ts`, `batch.ts`). A small picture's
right-click menu holds Save this one, Copy this one, Add pictures, Paste and Take out; one of many saved alone keeps
its own name as in the zip. One picture alone works as it always has (`field-cut-out.png`). Measured with the real
Quick model (`page.test.ts`): three pictures pasted at once were all cut out, Page Down showed the second, and Save
all gave one zip of `walk.png`, `walk (1).png` and `shore.png`, each at its own full size.

**Nothing leaves the browser.** The tests hold that the only requests are the page's own files, ONNX
Runtime's and the model's one file, each a GET with no body (`page.test.ts`, `cutout/tool.test.ts`).

## Decided

- Free, with nothing in the way: no account, no limit, no watermark, no smaller picture, no upload, no wait
  beyond the work itself. Drop or paste, the cut-out appears, copy it or save it at full size.
- A hidden page of its own at `/cutout/` and a tool in imgQuire, one piece used in both.
- Backgrounds in the first version: clear, a color (the site's colors offered), a blur of the old
  background. Not in this version: another picture, a flag.
- A brush to fix what it got wrong (Keep, Remove); a press to choose which subject is kept; right-click and
  Paste on the page, and on a phone a plain Paste button.
- Models fetched into the browser once and run there, on ONNX Runtime; they pick out what is in the picture
  and invent nothing.

## Open

- The page's words are hers to approve (listed in the reports that built it, the batch's too).

## Known weak spots

- Best's mask is 512 on the picture's longer side, so on a large photograph its edges are softer than the 1024
  model's were (about three pixels across a sharp edge on a 12 megapixel picture); the guided filter keeps hair
  following the picture, but fine strands far apart lose some of themselves.
- Best finds nothing on some photographs (four of eleven tried); the page and imgQuire's tool then ask for a
  press on the thing wanted, which cuts it out.
- A press made in the wrong place cannot be taken back by itself: the remove brush paints it away, or the picture
  is chosen again.
- The files of the qualities taken out stay in a browser that fetched them until the site's data is cleared.
- The brush's strokes are painted into the mask at its own size (at most 1024 a side), so on a large
  picture their edge is soft by a few pixels, then follows the picture by the guided filter.
- A press keeps what the cut-out found inside the thing pressed (its outline by SlimSAM, widened a little);
  it cannot add what the cut-out missed.
- The halo is measured on drawn fixtures, not on photographs of hair; the colors near an edge are averaged
  over 8 of the mask's pixels, so a background that changes quickly behind fine hair can leave some of
  itself.
- Saving uses the browser's PNG encoder (quick), not oxipng; the files are larger than they could be.
- Many at once: the background a cut-out is laid on and the quality are the page's for every picture, not each
  picture's; what is shown is held in this tab only, so leaving the page loses the masks and strokes; a picture
  that cannot be cut out is said in its small picture's label and in the line under the bar, and left out of Save
  all, which says how many could not be.
- Tried in Chromium only; not on a real phone.

## How to run and test

```sh
bun test src/quire/img/cutout     # the arithmetic, the card's pass, the page and the tool in Chromium
```

The tests with the real models read them from `~/.cache/quire-model-trials/parts/` and skip with a notice
when they are not there.
