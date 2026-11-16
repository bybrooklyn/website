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
- `asking.ts`: the first-use dialog (the qualities as cards, fetched only when told) and the one for the
  model that picks a subject by a press.
- `page.ts`: the page, one picture or many; `src/pages/cutout.astro`, `src/scripts/cutout.ts` (the site's
  colors offered), `src/styles/quire-cutout.css`. Many pictures use imgQuire's batch pieces: the strip
  (`batch-strip.ts`), the names and the zip or folder (`batch.ts`, `batch-out.ts`) and the small copies
  (`thumbs.ts`).
- The models run in the part models' worker (`parts/finder.ts`), pinned in `parts/models.ts`
  (`CUT_TIERS`), fetched and kept as the text models are.

## Built

**The page.** Empty, it says one line and offers Choose a picture (and on a phone, where there is no
right-click and no keys, a plain Paste button). A picture comes in four ways: Ctrl+V, a drop, a file chosen,
and Paste from the right-click menu (the clipboard read through the browser; where it refuses, the page says
to press Ctrl+V). It is shown at once; the first time a dialog in the reading dialog's family says what is
needed (a model, downloaded once from Hugging Face, kept in this browser, run on this machine, the picture
never leaving it), then the qualities as cards, and Download and cut out; nothing is fetched until then, and
after that there is no dialog. While it works a quiet line breathes over the picture's foot. Then the
cut-out on a checkerboard, and under it, never over it: Copy (the main button), Save, Clear, Color (the
site's colors grow out beside it), Blur, Keep, Remove, the quality, Original (held, as the backslash is) and
Choose another picture. A press on the picture keeps the thing pressed when there are several. A right-click
opens a menu in the site's family: Paste and Choose a picture when empty; Copy, Save, Paste, then Keep and
Remove with a cut-out; Shift leaves the browser's own.

**The qualities.** Quick, MODNet (13 MB, made for people); Better, ormbg (44 MB); Best, BiRefNet lite's
rebuild for WebGPU (123 MB), offered only where there is a graphics card. Each card says its time in plain
words: "Under a second a picture, people only", "About 20 seconds a picture, most things", "About a second a
picture, hair and fine edges". With nothing remembered, the dialog comes with Best picked where a graphics
card gives WebGPU, and Better where there is none (with Quick beside it); a quality chosen on a past visit
wins (`quire-cutout`). While Better works the line says "Cutting out, usually about 20 seconds".

**Edges.** The model's mask is found at its own size and kept at most 1024 a side, and applied at full size:
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

**Full size out.** A 12 megapixel picture is cut and saved at 12 megapixels. Saved as a PNG through the
browser's own encoder, with the picture's colour profile when it has one (a Display P3 photograph keeps its
colors); the clipboard takes sRGB. Measured in headless Chromium (four cores, two WebAssembly threads, an RTX
3070 Ti for WebGPU), the model on a 2 and a 12 megapixel picture (the model's work is the same, at its own
size), warm:

| Quality | WebAssembly | WebGPU |
|---|---|---|
| Quick (MODNet) | 0.6 s | runs on WebAssembly: 0.6 s |
| Better (ormbg) | 19.5 s | runs on WebAssembly: 19.5 s |
| Best (BiRefNet lite) | does not run: out of memory | 0.86 s (2 MP), 0.90 s (12 MP); 2.5 s the first time |

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

- Better takes about 20 s, since ormbg runs on WebAssembly only; Best needs a graphics card. On a machine
  with no card the choice is Quick (made for people) or a slow Better.
- Best's rebuild (wonfy/BiRefNet_lite-ONNX-webgpu, MIT, a third party's rewrite of the stock graph with
  the same weights) could not be checked against the stock export here: the stock file runs out of memory on
  the site's runtime both on WebAssembly and on the card. Its card says its fp16 file differs from the fp32
  stock one by at most 0.07 percent of pixels; that is its maker's claim.
- Best beside another browser drawing hard on the same graphics card: a buffer of the model fails to be made,
  every buffer after it is invalid ("Invalid Buffer is invalid due to a previous error"), and ONNX Runtime goes
  on giving answers of nothing (all kept) or of part nothing, run after run, without a word. Reproduced three
  times in about sixty runs beside the drawing tests. The card's errors are now watched for each run (error scopes for
  memory, validation and internal errors, the device's loss and errors no one caught), such a run is no
  answer named by its cause, and the cut-out runs it once more by itself in a fresh worker (a fresh runtime
  and hold on the card) before telling the person "the graphics card was too busy to finish". A mask all kept
  or all gone is refused the same way. A wrong mask that raised no error on the card would still not be caught.
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
