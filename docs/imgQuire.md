# imgQuire

An image editor in the browser, meant to sit beside mdQuire as a second part of one suite of tools. It is
for the everyday work done to pictures: cropping, resizing and converting; fixing photographs; marking up
screenshots and hiding what should not be seen; memes and text on pictures; and upscaling. The background
remover (`cutout.md`) is to be one of its tools as well as a page of its own.

## Where the code is

`src/quire/img/`, a kind of document on the Quires' core ([quire-core](quire-core.md)), importing from
`core/` and nowhere else in `src/quire/`:

- `steps.ts`: the picture document. The original (its name in the `.quire`, size, type and weight) and a
  list of steps, each a small plain record: a crop, a resize with a named filter, a cover in a solid color,
  and the marks (an arrow, a box, text, a numbered step, a highlighter's stroke, a magnifier, a spotlight).
  `look` applies the steps that are on, in order; every place and size is in the original's pixels. Changing, removing, moving and switching off a step, undo and redo, and
  `steps.json` written one step to a line and read back checked field by field.
- `cover.ts`: a cover's color, from a thin ring of the picture round it.
- `draw.ts`, `gl.ts`, `gpu.ts`, `marks.ts`: drawing. One small interface (`Backend`) with two ways written
  by hand, WebGPU first and WebGL2 where it is missing; the plan for flattening piece by piece; marks drawn
  by the 2D canvas for both, by `marks.ts` alone on the screen and in the export, which also says which mark
  is under a place, how far each reaches and the ring round it when picked.
- `geometry.ts`: fitting, zooming about a point, and the crop's frame dragged, nudged and held to a shape.
- `stage.ts`: the picture on the screen and the tools that work on it.
- `export.ts`: the formats as one table, the weight search, file names, the clipboard.
- `profile.ts`: colour profiles: checked and bounded, put into a JPEG, WebP and PNG, the Display P3 profile
  written from its published numbers, and Display P3 made sRGB.
- `cutout/`: the cut-out, the same piece as the page `/cutout/` ([cutout](cutout.md)): what a cut-out is
  (`cut.ts`), its edges (`refine.ts`), the full-size pass on the card (`render.ts`), the first-use dialog
  (`asking.ts`) and the page (`page.ts`).
- `turn.ts`: the horizon's arithmetic: a place on the turned picture and back, the largest upright rectangle
  inside it, a crop fitted inside, and the turn a line drawn along the horizon asks for; with a perspective,
  the same through one plane-to-plane map.
- `homography.ts`: perspective's arithmetic: the map from four places to four others and back, maps put one
  after another, a camera tilted about its middle (the keystone dials), the stretch at a place, a rectangle's
  true proportions guessed from its corners, and the depths the card draws a shape in perspective by.
- `perspective.ts`: the perspective step: its dials and corners, the map it makes, and when a map is no map.
- `lines.ts`: a picture's straight lines found, where they meet, and the camera's turn that stands them upright.
- `deblock.ts`: a JPEG's tables read from its bytes, and its blocks and ringing taken out by hand;
  `repair.ts`, the same run in a worker, as the editor offers it.
- `tiles.ts`: a model run over a large picture tile by tile.
- `restore/`: repairing a JPEG and enlarging with a model. `models.ts`, the three files pinned with their sizes and
  digests and how each takes a picture; `engine.ts`, the worker that keeps, fetches and runs them through `tiles.ts`;
  `asking.ts`, the dialog of ways as cards; `half.ts`, half-precision numbers by hand; `graph.ts`, the one mend made
  to the Swin2SR file's bytes before it is loaded.
- `metadata.ts`: a picture's Exif, XMP, IPTC and colour profile read and written by hand, through the
  core's walkers of a JPEG, PNG and WebP (`core/picture-bytes.ts`) and its own of AVIF, HEIC and JPEG XL
  boxes.
- `codec-run.ts`: running an encoder (or the HEIC reader) built to WebAssembly, in a worker, after
  checking its bytes against its pin in `codecs.json`. The modules are in `public/quire/codecs/`; they
  are built from source by `codecs/build.sh` (C wrappers in `codecs/wrap/`, the Rust ones in
  `codecs/rust/`).
- `read/`: reading the text in a picture, all by hand but the models and ONNX Runtime. `models.ts`, the
  three sizes of PP-OCRv6 pinned to commits and digests; `store.ts`, fetching and keeping them;
  `runtime.ts`, the models made into sessions on the site's ONNX Runtime, which the core finds and loads (`core/onnx.ts`, shared with dictation); `pixels.ts`, `detect.ts`, `ctc.ts`,
  `words.ts` and `read.ts`, the steps from pixels to lines and words; `dictionary.ts`, the recognizer's
  characters out of its YAML; `private.ts`, the rules for what looks private; `engine.ts`, the worker.
- `reading.ts`: the tool as the editor offers it: the first time's dialog, the reading, what was read.
- `grade.ts`: color grading's arithmetic, the reference the shaders follow: what a grade is, how it is kept in
  `steps.json`, and one pixel graded. `grade-shader.ts`, the same sums in GLSL and WGSL over one packed run of
  numbers; `fix.ts`, Auto, Balance, a picture graded on the processor, the histogram and waveform;
  `measure.ts`, the histogram's worker; `cube.ts`, `.cube` files read and written; `masks.ts`, the parts'
  masks drawn into layers; `looks.ts`, looks kept in this browser and the surface's Looks section.
- `grade-panel.ts`, `grade-more.ts`, `grade-parts.ts`: the Grade surface, its deeper controls under More, and
  its parts. `finding.ts`, Find as the surface offers it; `parts/`, the part models pinned (`models.ts`), their
  arithmetic before and after a run (`segment.ts`) and their worker (`finder.ts`).
- `panels.ts`: the export panel, the resize box and the tool's strip.
- `batch.ts`: a batch: one steps.json listing every picture with its own steps, name, small copy and export
  settings (a document of one picture written as it always was), the names a batch's files go out under, and
  what Give to all hands on. `batch-strip.ts`, the strip of small pictures under the picture; `batch-out.ts`, a
  zip written as it goes, a folder written file by file, and the work run a few pictures at a time;
  `picture-out.ts`, one picture written out by the same rules on the stage and off it, and a picture flattened
  away from the stage; `thumbs.ts`, each picture's small copy and how it is drawn as the picture looks.
- `editor.ts`: the frame, the session, the bar, the menus' table, the keys, copying and pictures arriving.
- `kind.ts`: `img()`.
- `src/pages/imgquire.astro`, `src/scripts/imgquire.ts` and `src/scripts/quire-page.ts` (shared with
  `/mdquire/`), `src/styles/quire-img.css`; `scripts/img-page.ts`, the page its browser tests share.

## Built

The first slice: the foundations and the four fast jobs.

**One shelf.** `/imgquire/` (hidden, as `/mdquire/` is) and `/mdquire/` both mount the core with both
kinds, `markdown()` first and `img()` second, over the same database, so either page lists every document
of both kinds; a picture's row says "picture" before its place. The only change a writer of mdQuire can
see on `/mdquire/` is that: "picture" among the shelf's ways to start and in File, New, pictures among
the rows, and pictures among what the file chooser offers. The trail word is each page's own.

**Pictures arrive** by a paste anywhere on the page, a drop, a file chosen (the shelf's "open a file", the
documents list) or the editor's own Choose a picture. A picture becomes a document kept in this browser,
named from its file, or for a pasted screenshot (which comes named `image.png`) "Screenshot, 14 Nov 2026
01:30". The core takes it through `Kind.takes` and `Editing.take`. The original is kept as it came.

**The file.** A `.quire` zip of `steps.json` and the original at `pictures/<its name>`; the stores carry
it as named files ([quire-core](quire-core.md)), the browser and Drive saying `main: "steps.json"` in
their lists so the shelf knows the kind without opening it. Nothing in the original ever changes.

**The first second.** The picture fitted under the bar with the crop's frame on it and the strip for the
crop (five shapes and Apply), the bar above (undo, redo; crop, resize, hide; arrow, box, text; steps and
export at the right end), and under the picture its size and weight, then the weight it will export at,
worked out a moment after the steps stop changing.

**Crop.** Handles, the frame dragged, a new frame dragged out from outside it, arrow keys (Shift for ten
pixels), Shift on a corner or a shape from the strip to hold its shape, Enter to apply; outside dimmed. A
frame back on the whole picture takes the crop step away.

**Resize.** A box grown from its button: width and height linked (a link button unlinks them), Percent as
a switch, and 50%, 1920, 1280, 1080 and 800; Enter applies and gives the keyboard to the picture, Escape
gives it back to the button. The filter (Lanczos, bilinear, nearest) is in Image, Resize filter.

**Hide.** R, then a drag: covered at once in the color round it, no settings and no confirmation; drag
again for the next. The covers are painted into each piece of the original before anything is sampled,
so nothing they hide reaches the result through any resize; tests check the bytes.

**Mark.** A (arrow), B (box), T (text, typed where pressed, Enter to keep): six colors and three
thicknesses in the strip, which also change a picked mark. Every mark, and every cover, is picked by a
press and moved by a drag or the arrows, and removed with Delete.

**Zoom and pan.** The wheel and a touchpad's pinch about the pointer, two fingers, Space and a drag or the
middle button, Ctrl+0 to fit, Ctrl+1 for 100%, Ctrl+= and Ctrl+-.

**No list of steps.** Every step is still kept, but nothing lists them: marks and covers are picked by
pressing them on the picture, and pressed again in the same place without moving, the one beneath is
picked, round to the top again. What is picked is removed with Delete, Backspace or Edit, Remove, and
moved in front of the next thing drawn or behind the one before with Edit, Bring forward and Send back.
The crop and the resize are removed from the Image menu. Undo, redo and version history cover the rest.
Switching a step off is gone with the list; the file keeps the field and reads it, and nothing offers it.

**Getting it out.** Ctrl+C copies: the first time a dialog asks whether as it looks or as the export is
set and remembers (`quire-img-copy`; Edit, Copy as changes it). The clipboard is handed a promise of the
picture at once, so the press counts. The export panel, at the right side (on a phone, a sheet at the
foot), never lies over the picture: the picture's room gives the panel its width (or height) and the
picture glides into what is left as it opens and back as it closes: the format (below), a quality,
or a weight to come in under ("200", "1.5 MB") found by halving the quality seven times, the result's size
and weight, the same middle part of the original and the export side by side at their own pixels, Copy
(filled) and Save. Saved files are named from the document (`screenshot-14-nov-2026-01-30.webp`). No
encoder writes metadata; a picture with no steps given in its own format is its original with
where, when and with what it was taken cut out (`core/picture-bytes.ts`). The settings are kept in this
browser (`quire-img-export`), WebP at 0.85 to start; the pen too (`quire-img-pen`).

**Facts and metadata.** The facts open as the export does, in its place at the side (a sheet at the
foot on a phone), with I, the bar's Facts button or View, Facts; the picture refits beside them, and only
one of the two panels is open at a time. Quiet rows of a label and a value: size, camera, lens, exposure,
date taken, color profile, orientation and place, the place as numbers only, with no map and nothing
asked of any other service. A photograph with an Exif orientation is shown and exported upright, and the
facts say how it was turned. Five fields can be changed, as the notes decide: caption, alt text, author,
copyright (the licence) and date taken. What she writes is kept in the document's `steps.json`; the
original is never changed. Everything else the picture says (every Exif tag by name, XMP's simple
properties, IPTC's records, comments) is under Everything, which grows open.

The export asks, for each export, what metadata goes with it: None (the start, and what every export was
before), No place, or All. Kept, the original's Exif goes out byte for byte but for its orientation, set
upright as the pixels are; without the place, the GPS directory's entries and values are emptied in place;
a field she changed is emptied in Exif and IPTC and written in XMP, so that what she wrote is what is read.
It goes into a JPEG's APP1 and APP13 segments, a PNG's eXIf and iTXt chunks, a WebP's EXIF and XMP chunks
(with the extended header made where there was none), a JPEG XL's Exif and xml boxes (a bare codestream
put into a container first), and an AVIF through its encoder. A PNG has no place for IPTC, so its records
are not written there. A picture with no steps given in its own format is its original: with None, with
its metadata cut out as before (only its orientation and colour profile stay, which change how it looks);
with All and nothing changed, its own bytes.

Reading takes nothing on trust: every count, offset and length is checked against the bytes there are,
Exif directories that point back at each other are read once, and how much is read is bounded (16 MB of
metadata, 1,000 entries to a directory, 16 directories, 4,096 values to an entry, 2,000 boxes). The tests
read a phone's photograph made by sharp in each format, write each back and read it again here and with
sharp, read hostile, cut short, looping and huge files quickly to nothing, and on the built page export a
captioned photograph in all five formats and read each back (`metadata.test.ts`).

**The encoders.** The reference encoders the owner chose, built from source to WebAssembly by
`codecs/build.sh`, each its own module, fetched only when its format is first picked, checked against
the SHA-256 pinned in `src/quire/img/codecs.json` before it is compiled, and run in a worker of its own,
a fresh instance for each picture (`codec-run.ts`). Seven formats in two rows of the export panel, each
with a tooltip saying what it is good for:

| Format | Encoder, as built | On the wire (brotli) | Setting |
|---|---|---|---|
| JPEG | jpegli 031a007, `-Oz` | 32 KB | quality, progressive 4:2:0, laid on white |
| WebP | libwebp f9c049d, `-Oz` | 58 KB | quality, method 4 |
| AVIF | libavif 90d3b66 with libaom bcc98e0, `-Os`, 8-bit | 779 KB | quality, speed 8 |
| JPEG XL | libjxl 9e02071, `-Os` | 554 KB | quality (libjxl's distance), effort 3 |
| PNG | oxipng 10.2.1, Rust `opt-level "s"` | 62 KB | level 2 |
| WebP lossless | the WebP module | | preset 6 |
| JPEG XL lossless | the JPEG XL module | | effort 3 |

HEIC is read the same way, by heic-rs 0.1.4 (54 KB): a phone's photograph pasted, dropped or chosen is
kept as it came and shown through a PNG made in memory. JPEG, WebP and PNG fall back to the browser's
own encoder if their module cannot be had; a format the browser cannot show (JPEG XL in some) is copied
as it looks, and its sample in the panel says so. The clipboard always takes the browser's quick PNG.
Every encoder reads back in Chromium to the same pixels (the lossless ones exactly; the lossy ones 39
to 40 dB at quality 85 on the test picture), and the HEIC fixture at 36 dB; the built page makes all
five lossy and lossless kinds from a pasted HEIC (`codec-run.test.ts`). The modules are single-threaded;
the trial's times for a 12 megapixel photograph on one thread are JPEG 0.3 s, WebP 1.1 s, AVIF about
0.7 s at speed 8, JPEG XL 0.5 s at effort 3, PNG about 6 s ([imgQuire-codecs](imgQuire-codecs.md)).

**Reading text.** W, the bar's Read text (a magnifier, after Hide) or Tools, Read text. Nothing is
fetched until then. The first time a dialog grows from the button, as dictation's does: what reading
needs (a model, downloaded once from Hugging Face and kept in this browser, run on this machine, the
picture never leaving it), then Choose, then the three sizes as cards (Tiny 6 MB, Small 38 MB, Large
152 MB, each with who it suits and "On this device" once kept), the source and licence under them, and
Download and read, whose progress takes the buttons' place with Cancel. The size is remembered
(`quire-img-read`) and changed from the strip's model button or Tools, Text model; one kept is read
with at once. The next picture is read with no dialog.

The reading runs in a worker of its own (`read/engine.ts`) on the ONNX Runtime build the site already
ships, the graphics card where a real one gives a device and WebAssembly otherwise; while it reads,
the tool's strip says "Reading text 40%" and the picture stays in use. The picture goes to the worker
as a bitmap and nowhere else: the only requests are for ONNX Runtime's files and the model's, each a
GET with no body, and the browser test holds that. Each file is fetched from Hugging Face at its pinned
commit, with no referrer and no cookies, checked against its SHA-256 before it is kept in the
browser's private storage, and checked again before a model is made of it.

What was read is kept for the picture while it is open, not in the document. With the tool on, every
word is tinted lightly on the picture and the one under the pointer more; nothing is listed anywhere.
Pressing a word hides it: a cover over its box grown by a tenth of its line's height (at least two
pixels) on every side, rounded outward to whole pixels, in the color of the ring round it, the same
cover Hide makes, removable and undone the same way. The same press always gives the same cover.
Dragging across words hides the run, one cover over each line's stretch of it, as one step. A press
on a cover already made picks it, as with Hide.

What looks private is found by plain rules (`read/private.ts`): emails, phone numbers, keys and tokens
by their makers' shapes (GitHub, GitLab, npm, Hugging Face, OpenAI and Anthropic, Stripe, Amazon,
Google, Slack, a JSON web token, a private key's first line) and by long random runs, numbers shaped
like a card that pass Luhn, street addresses and a town with a ZIP code, machine addresses (v4 and
v6), and what follows a label such as password, token, PIN or API key (or the next line, under a
label alone). Each thing is outlined on the picture in a warm line, one rectangle a line of it, exactly where its cover would go, and the strip says "42
words, 4 look private" with Hide all, which covers what is still uncovered as one step; each can also
be hidden by pressing it. Nothing is hidden by itself.

With no tool, a drag across words selects them, filled as selected text is. Ctrl+C then copies the
words as text (words of a line by spaces, lines by line breaks) and not the picture; with nothing
selected it copies the picture as before. Escape lets the selection go. Edit, Copy text copies the
selection, or every word read when there is none.

How it reads (`read/read.ts`): a page turned on its side is set upright first (Large only); the picture
goes to the detector at its own size up to 4000 a side, in tiles of 1280 that overlap by 64 and whose
middles make one map, so small UI text is kept; lines are the map's patches above 0.2, each the
smallest turned rectangle round its hull, kept when the map's average inside is above the model's
`box_thresh` and grown by its area times 1.4 over its edge (PaddleOCR's DB steps, written here); each
line is cut from the original at full size along its slant, 48 high; lines upside down are turned
(Small and Large); the recognizer reads eight at a time, each batch as wide as its widest and at least
320; CTC gives each character and the slices it was seen in; a word's box is placed tight round its own
ink, split from its neighbours at the widest gap in the ink between where their letters were seen.
Lines the recognizer is unsure of are left out: below 0.5, or one or two characters below 0.9, which is
how the pattern of a photograph reads.

Measured in headless Chromium, the reader's worker, four cores (two WebAssembly threads), and an RTX
3070 Ti for WebGPU; a 1920 by 1080 settings screenshot and a 4000 by 3000 photograph drawn in the test:

| Size | Screenshot, WebAssembly | Screenshot, WebGPU | Photograph, WebAssembly | Photograph, WebGPU |
|---|---|---|---|---|
| Tiny | 0.6 s | 0.25 s | 3.0 s | 1.5 s |
| Small | 2.1 s | 0.33 s | 7.6 s | 1.7 s |
| Large | 12.4 s | 0.38 s | 41 s | 1.6 s |

Every size read the light and the dark screenshot with all 454 characters right, UI text from 11 to 28
pixels; the words' boxes lay within 1.3 pixels of their ink (60 words measured); Small and Large read
all five lines of a page with lines turned by 10, -12, 90 and 180 degrees (118 characters), Tiny all but
the upside-down one; Large set a page photographed on its side (either way) upright and read it in
order, where Small reads its lines right but not in order; the photograph's sign was read whole by all
three. What looks private was found on
the screenshot (6 things) and nothing else was (`read/real.test.ts`, `reading.test.ts`).

**Grading.** G, the bar's Grade (at its right end, before Facts and Export) or Image, Grade. The Grade
surface opens where Export and Facts do, one of the three at a time, the picture gliding into the room left
beside it (on a phone a sheet at the foot, opening at 22rem or 46 percent of the height if less, which its head
drags as short as 150 pixels or as tall as 80 percent of the window, the picture above refitting as it goes; its
foot fades over its last 2.25rem, so a row it cuts never shows as a half row). From the top: what is being graded ("Whole picture", or a
part's name), a small histogram (red, green and blue as fine lines over the luminance, quiet) that follows the
grade as it moves, pressed for a waveform and back; Auto, Balance and Reset; the six sliders Light, Contrast,
Shadows, Highlights, Warmth and Color; More, folded (Tint, the curve, the wheels, colors on their own); Looks,
folded; and Parts. A line at the foot says the space the picture is graded in.

A slider has its zero in the middle, marked; it is dragged from wherever its track is pressed, so its thumb
never jumps to the pointer, the whole track being the whole range (a tenth of it with Shift, in tenths);
within two of zero it snaps to zero; a double press puts it back to zero; its number can be typed; the arrow
keys move it by one (Shift ten), Page Up and Down by ten, Home and End to its ends, 0 to zero. While it moves
the grade is drawn as it would be and the histogram follows; letting go (or letting go of the key) is one
change, one undo. Moved sliders' words and numbers are in ink, the rest muted; nothing is tinted. Undo and
redo work from the surface too.

The original is seen while the backslash is held (on the picture or the surface), or while the eye button
beside the histogram is pressed and held, for a phone. The split button (or View, Split) puts a line down the
middle of the picture, the original to its left and the grade to its right; its grip is dragged, the line
exactly under the pointer, and it grows in and glides when switched.

Auto takes out a color cast (the average of the pixels near gray and neither near black nor white, or of all
of them when too few are) as Warmth and Tint, and sets the levels (the darkest and lightest half percent of
the balanced luminance) as the two ends of the curve of all three channels; each is a value to tune. Balance
then a press on the picture: the original's pixels in a five pixel square there, made neutral by Warmth and
Tint, in tenths.

The working space and what each control does, in numbers (`grade.ts`):

| Step | Where | At 100 |
|---|---|---|
| Warmth, Tint | linear light, gains on the picture's own primaries keeping a gray's luminance | red against blue 2 stops; green against the two 1 stop |
| Light | linear light: stops of exposure; brightening rolls highlights off as `1 - (1 - x)^g` so nothing clips | 2 stops |
| Contrast | encoded numbers, each channel, about middle gray (18 percent, encoded 0.461), black and white kept | slope 2 at the pivot (0.5 at -100) |
| Shadows, Highlights | encoded numbers, a bump `p(1-p)^3` peaking at a quarter (three quarters), never turning a tone back | lift 0.2, deepen 0.1 at the peak |
| Wheels | encoded numbers, pushed toward the puck's hue, weighted by luminance (shadows `(1-Y)^2`, highlights `Y^2`, midtones the rest) | 0.1 |
| Curve | encoded numbers, monotone cubic (Fritsch and Carlson) through the points, baked into 1024 entries, the channel's own after all three's | |
| Color | linear light about the luminance; above zero held back as a channel nears the edge of the range, smoothly | twice as strong, or gray at -100 |
| A color's own | encoded numbers, colors within 30 degrees of the picked hue all, falling to none at 60, none near gray | hue 60 degrees, saturation double or gray, lightness 0.2 |
| Look (.cube) | encoded numbers, read between the table's eight nearest entries | |

sRGB and Display P3 share sRGB's curve; P3 is known by its profile's red and green primaries
(`metadata.ts`, `spaceOf`), and differs in its primaries' luminance (0.229, 0.692, 0.079 against sRGB's 0.213,
0.715, 0.072), which Warmth, the wheels, Color and a color's own use. A picture with no profile is sRGB; any
other profile is graded as sRGB and the surface says so, naming the profile. Nothing is rounded to 8 bits
between the steps: the sums are in floating point from the pixel read to the pixel written, and a graded
picture is held in half floats between the two passes of a resize. Each step at its zero is skipped.

More: Tint; the curve, in a square under four channel buttons (All, Red, Green, Blue; a channel whose curve is
not straight in ink), a point added where the square is pressed and dragged from there, a point dragged off the
square (an eighth past its edge) taken away when let go ("Let go to take it away" while it is off), its two ends
never; a double press makes the channel straight. Three wheels, Shadows, Midtones, Highlights, a faint ring of
hues round each with red to the right and turning as the arithmetic turns; the puck goes under the pointer,
snaps to the middle within a twenty-fifth, goes back with a double press, and the arrows nudge it. Colors:
Pick a color, then a press on the picture adds the hue there as the shift will see it (up to three), each with
Hue, Saturation and Lightness sliders and a way to take it away; a place too near gray is refused.

Looks: a grade saved under a name (Save look, a name or the document's) in this browser's own database,
`quire-img-looks`, beside the Quires' `quire`; the looks listed newest first, each given to the grade by a press
(the same grade on another picture) and forgotten by its bin. Read .cube reads a 3D table of 2 to 65 a side or
a 1D one of up to 4096 into the grade, applied last (a table over 33 is kept at 33, sampled between its
entries); a file that is not one is refused, the status saying why. Write .cube writes the grade as a 33 a side
table. A look moves to another machine as a .cube.

Parts are picked on the picture, never listed. While Grade is open each part shows on the picture: a gradient
as its line and two ends with a line across the picture at each, any other part as one handle; the part picked
is drawn in the accent and tinted lightly where it reaches. Gradient, then a drag across the picture from
where the grade is whole to where it is gone, makes one; Paint makes a painted area with the brush on. A part
picked (a handle pressed) is graded by the whole surface, and has its own few controls: Feather (none to a tenth
of the longer side), Inside out, Brush with Size, Softness and Erase, Whole picture, and Remove part. A
gradient's ends are dragged, and its middle moves both. Escape goes back to the whole picture, Delete takes the
part away. A part's grade is applied after the whole picture's, blended by its mask.

In the document a grade is a step: the whole picture's one `grade` step, each part a `part` step with its shape
(a gradient's two ends, the brush's strokes as places in the original's pixels, a found mask as runs of bytes)
and its grade, only what is away from zero kept, read back checked and bounded. Undo, redo and version history
cover them, and the document opened again draws the same pixels (a test reopens it and compares). The grade
is drawn by the card on the screen as each pixel is drawn, and when flattening in the pass down before
rounding; covers are graded with what is round them, marks are not. Masks are layers of floats on the card,
at most 1024 a side, read between their entries by hand so both ways and the reference read them alike.

Find, the third maker in Parts, finds a part with a model. The first time a dialog grows from it, in the
reading dialog's family: a model is downloaded once from Hugging Face, kept in this browser, run on this
machine, the picture never leaving it; Choose; two cards, Small (27 MB, quick, on any machine: SlimSAM 77 and
MODNet) and Better (96 MB, cleaner edges, on a fast machine: SAM 2.1 tiny and ormbg); Download and find, its
progress in the buttons' place with Cancel. The choice is remembered (`quire-img-parts`). Then the strip says
"Press a thing to outline it; Alt and press to take away", with Subject and Background beside it. The first
press makes a found part, picked; each later press (Alt to take away) changes that part, one change each, all
the presses sent together to the decoder; Subject makes a part of the picture's subject, Background the same
turned inside out. Escape or Cancel ends finding. The picture is encoded once (the image encoder) and kept in
the worker, so a press after the first takes only the decoder. A found mask is kept in the document as runs of
bytes at most 512 on the picture's longer side, so it is drawn the same when the document is opened again
without the model, and it is a part like any other: feathered, turned inside out, added to or erased with the
brush. The files are fetched, checked and kept as the text models are (`read/store.ts`, in a folder of their
own), and run in a worker of their own on the site's ONNX Runtime through the core; on a graphics card only the
image encoders run there ([imgQuire-models](imgQuire-models.md) says why). The test holds that the only requests
are the page's own files, ONNX Runtime's and the model's three files, each a GET with no body, and that the
document reopened draws the same pixels with no request at all (`finding.test.ts`). Measured with the real files
in headless Chromium (four cores, two WebAssembly threads where isolated; an RTX 3070 Ti), on a 1200 by 800
scene: a first press, with the encoding and the sessions made, Small 2.7 s on WebAssembly and 2.5 s with the
encoder on the card, Better 3.8 s and 1.4 s; each press after, 60 to 110 ms; Subject, Small 0.6 s, Better 19 to
20 s (ormbg runs on WebAssembly only). A press on a figure outlined all of its coat and none of the far sky;
two presses on the sky and an Alt-press on the figure gave 94 to 95 percent of the sky and none of the coat
(`parts/real.test.ts`).

Measured: the same grade (every control, a 9 a side look, a part under a mask turned inside out) flattens
through WebGL2 to the reference arithmetic's pixels, through a crop and a resize, within one, and through
WebGPU to WebGL2's within one (`grade-shader.test.ts`). A slider dragged, each frame a new grade worked out,
packed, sent and drawn: 2.4 ms on a 12 megapixel photograph and 2.5 to 3.6 ms at 50 megapixels, on an RTX
3070 Ti through WebGL2 (headless Chromium on the card by ANGLE's Vulkan), held under 16 ms in the test; drawing
with no grade costs what it did (7.5 ms a frame of the crop's drag on SwiftShader). The histogram and waveform
of a 200 by 150 copy with every control: 18 ms, in their worker. A part's layer: a gradient 1.3 ms, with a 100
pixel feather 25 ms, a stroke of 60 places 6 ms (on the page's thread, when the shape changes).

**Colours going out.** A picture's colour profile goes out with it in every format: the original's own profile
byte for byte, after it is checked (at least 132 bytes and at most 4 MB, no longer in its header than the bytes
there are, signed `acsp`, for RGB numbers, at most 200 tags, each inside it); a broken one is never carried and
the picture is taken to be sRGB, said to be a guess. A PNG's profile is read from its iCCP chunk inflated by the
browser's own `DecompressionStream`, stopped past 4 MB; an AVIF's or HEIC's from its colour box, and one that says
Display P3 by numbers (its nclx box: primaries 12) is given the Display P3 profile written by hand in `profile.ts`
from P3's published primaries and white (made D50 by Bradford's adaptation) and sRGB's curve as a parametric curve
of type 3, 532 bytes, whose red, green and blue match Apple's own profile to within 0.0005. Where each format keeps
it: a JPEG's APP2 segments (`ICC_PROFILE`, 65,519 bytes a segment, after the JFIF header and Exif), a WebP's ICCP
chunk straight after its extended header (made where there was none, its profile flag set), a PNG's iCCP chunk
after its header, the profile deflated by the browser's `CompressionStream`; AVIF and JPEG XL through their
encoders, whose wrappers now take a profile as options 12 and 13 (libavif's `avifImageSetProfileICC`, libjxl's
`JxlEncoderSetICCProfile`, its pixels then taken to be in that profile; the two modules were linked again from the
libraries already built and pinned anew). libjxl keeps a Display P3 profile inside its codestream, as numbers in a
lossy file and compressed in a lossless one, where only a decoder reads it.

Export offers, for a Display P3 picture only, Colors: Display P3 (the start: its own colors, with its profile) or
sRGB (converted, for places that ignore profiles). The conversion is done on the card in the pass down, after the
grade and before the result is rounded: the numbers made linear by sRGB's curve, the matrix from linear P3 to
linear sRGB worked out from the two sets of primaries, each channel clipped to the range, and sRGB's curve again;
P3's own red (255, 0, 0) comes out as sRGB's (255, 0, 0). The choice is kept with the export's settings. The
clipboard always takes sRGB, since most places a picture is pasted into read no profile: as it looks, converted on
the card; as the export is set, the export decoded by the browser through its profile.

On the screen a Display P3 picture is drawn into a canvas put in Display P3 (WebGL2's `drawingBufferColorSpace`,
WebGPU's `colorSpace`), so a screen that shows P3 shows its colors and the browser maps them for one that cannot;
where the canvas has no Display P3 the picture is made sRGB as it is drawn, by the same conversion, the original
seen while held and left of the split too.

Measured (`profile.test.ts`): a P3 canvas's red and a green inside sRGB, given out as a PNG with the profile,
cropped and exported in all seven formats through WebGL2 and WebGPU: each file reads back with its profile byte
for byte (but JPEG XL, which keeps it in its codestream), its numbers the same (to the bit in the lossless ones,
within 6 in the lossy), and the browser, drawing each into a P3 canvas through its profile, gives back the same
numbers, JPEG XL too; made sRGB, the red is (255, 0, 0) and the file has no profile; and the screen's canvas is
handed P3's numbers in Display P3 and, made sRGB, the converted ones within one. Hostile profiles (cut short, too
long in their header, unsigned, for CMYK, a tag table or tag past the end, 100,000 tags, over 4 MB, a PNG whose
profile inflates past 4 MB or is not deflated) are refused in under 50 ms all told.

**The horizon.** The crop's strip has a dial: a ruler of degrees under a fixed middle line, dragged from wherever
it is pressed (the whole width 30 degrees, a tenth as far with Shift), the turn said above it in tenths
("2.4°"), snapping to level within a quarter of a degree, at most 15 either way; the arrow keys turn it by a tenth
(Shift, a degree), 0 or a double press levels it. While it is dragged the picture turns live with a faint grid of
ninths over the frame; letting go is one step, one undo, a `turn` step in `steps.json` (degrees, clockwise). Beside
it, a line button: then a drag on the picture draws a line, and letting go turns the picture so that the line is
level, or plumb when it is nearer upright than flat. Auto is left out: finding the horizon by plain arithmetic
(the dominant long edges) could not be made reliable on the drawn fixtures here, and a wrong level is worse than
none.

The picture turns about its middle and is cut, with no crop of her own, to the largest upright rectangle inside
the turned one: when the shorter side is short against the longer (`short ≤ 2 sin cos long`) it touches two
corners and has half the shorter side over the sine and the cosine; otherwise it touches all four sides and solves
`w cos + h sin = W`, `w sin + h cos = H`; rounded inward to whole pixels. The test checks it lies inside, touches
(a pixel more each way does not), and is within 0.2 percent of a search over 2,000 shapes, for wide, tall, square
and thin pictures at 3 to 15 degrees (`turn.test.ts`). A crop of her own is kept where it lies on the turned
picture, else made smaller about its middle, its shape kept; a crop's frame dragged stops where it would leave the
picture. While cropping the whole turned picture is shown, fitted.

Everything on the picture stays where it was put on it: covers, marks, parts and found words are kept in the
original's pixels as before and turn with the picture. A cover, a box or a text made on a turned picture is upright
on the screen: it keeps a turn of its own (`angle`, the picture's turn back) and so turns with the picture after.
On the card a turned picture is drawn as its pieces turned, four corners each, nearest pixels no longer used; when
flattening, each piece of the result reads the part of the original under it (the box round the piece turned back,
and four pixels more), the covers painted in first (a cover with a turn of its own drawn at its four corners grown
by half a pixel's diagonal, so that every pixel it touches is painted), then turns it upright in a pass of its own
(a six by six Lanczos filter at one to one) before the two passes of the resize; a part's mask is read at the place
turned back. With no turn, everything is drawn and flattened exactly as before. The marks are drawn by the 2D
canvas turned the same way.

Measured: through crops, a shrink, an enlargement and covers of both kinds, WebGL2 flattens a turned picture to the
arithmetic done on the processor within one (but the pixels near a turned cover's edge, which a card's rasterizer
may take either way and the test leaves out: 4 percent of a shrunk result), and WebGPU to WebGL2 within one
(`gl.test.ts`, `gpu.test.ts`); nothing under a turned cover is left. A round part painted on a picture turned 12
degrees is graded where it is on the turned picture, the same through both (`turn.test.ts`). On the page, turned
eight degrees by the dial's keys: a cover made before is picked by a press where it now is, a word read is hidden
by a press on it, a box made then is upright on the screen, and the export draws the cover and the arrow in their
places (`stage.test.ts`).

**Cut out.** K, the bar's scissors or Tools, Cut out: the background taken out of the picture, the same piece
as the page `/cutout/`, its result a step. Asked once in the reading dialog's family, the model runs in the
worker Find uses; the stage then shows the cut-out's pixels in place of the original's, on a checkerboard
where clear, everything else drawn over them; the strip lays it on nothing, one of the mark colors or the old
picture blurred, paints Keep and Remove, changes the quality and takes it away, and a press keeps the thing
pressed. A JPEG export says it has no transparency and offers a color or PNG. What it is and what was
measured are in [cutout](cutout.md).

**Since the horizon.** Round a turned picture the room shows through: the crop's dimming only darkens what
is drawn and adds nothing where there is no picture (the corners used to be a black box), and when the turn
changes the view glides until the turned picture and its frame are whole. On a narrow screen the crop's
strip puts the dial and its line button on a row of their own under the shapes, so Apply is always in sight,
and the picture is fitted under the strip as tall as it is. The export panel's samples are drawn in the
picture's own space (a Display P3 canvas for a P3 picture), and marks are drawn into a P3 export in P3, so a
red mark is the red picked (`profile.test.ts`).

**As a Quire.** Menus File, Edit, View, Image, Tools, Help, as one table, an icon on every line, ticks for
what is on, submenus for Download, Copy as, Zoom, Crop shape, Resize filter, Mark color and Thickness;
single keys C, R, A, T, B, N, H, M, S, E, I, W, G, K and P only while the picture has the keyboard, Enter and Escape; the palette is
the core's; version history draws a version's steps over the original, small, and restores it as one step.

**A right-click's menu** (`press-menu.ts`, opened in `editor.ts`), as mdQuire's text has one. On the
picture: Copy, Copy text when words were read, Paste, and Export under a rule. On a mark or a cover, that
one is picked first (`stage.pickAt`) and Remove, Bring forward and Send back come before the rest. With no
picture yet: Paste and Choose a picture. Each line is the menus' own, found by its name, so it does what
the menu's line does. Paste reads the clipboard through the browser (which asks once in Chromium); where
the browser refuses, the status says to press Ctrl+V. The menu key or Shift+F10 opens it from the
keyboard, Shift with the right-click leaves the browser's own, and a field, a button, the strip and a
panel keep theirs. Opened by the pointer it still takes the keyboard, so Escape closes it and gives the
keyboard back to the picture.

**Drawing.** WebGPU first, WebGL2 where it is missing, behind `Backend` in `draw.ts`. A picture of up to
4096 a side is one texture; a larger one a smaller copy and full-size pieces of 2048 made when zoomed in
(at most twelve kept). Nearest pixels past one to one, the card's smaller copies when zoomed out.
Flattening goes piece by piece: covers painted in, then resampled across and down. If WebGPU loses its
device the stage draws again with WebGL2 on a fresh canvas.

Measured in headless Chromium (software drawing), four cores: a 12 megapixel photograph's crop dragged at
57 frames a second, 50 megapixels at 58; flattened to 2000 wide in 0.3 s and 1.1 s through WebGL2, 1.0 s
and 2.9 s through WebGPU. The four jobs from paste to clipboard in the browser tests: crop and copy 0.6 s
(with the first-time question), shrink and convert a 12 megapixel photograph to WebP under 200 KB 1.9 s,
hide 0.6 s, mark up 0.5 s. Done by hand-paced drags with pauses to photograph each stage: 2.1 s, 5.6 s,
1.7 s and 1.8 s.

**Perspective.** P, the crop strip's perspective button (after the horizon's line button) or Image,
Perspective fills the crop's strip with perspective's controls: two dials, Vertical and Horizontal, then
Corners and Auto, and Done. Escape goes back to the crop's strip; a new picture starts with the crop's own.

The dials are the horizon's dial (its ruler twice as long, 30 degrees either way): dragged from wherever they
are pressed, a tenth as far with Shift, snapping to zero within a quarter of a degree, the arrows a tenth (Shift
a degree), 0 or a double press back to zero; while one is dragged the picture is drawn straightened live and
the crop's frame follows; letting go is one step. Vertical is the camera tilted up or down: lines that lean in
toward the top stand straight. Horizontal is the camera turned left or right: lines that run away to one side
become level. Each is `K R K⁻¹`, the camera turned about its own middle, with a focal length of the picture's
longer side (about a 36 mm lens on a full frame), then moved and scaled so that the picture's middle keeps its
place and its size there.

Corners shows the original as it came, whole, with four round handles (a finger's reach round each) on the
corners of a rectangle a sixth of the way in, the outside of their shape dimmed and a grid of quarters drawn
inside it through the map from a square, which shows how the shape will be squared. A handle is dragged from
wherever it is pressed, so it never jumps; it stops where the shape would bend inward, and stays on the picture.
Tab reaches the handles and the arrows nudge the one in hand a pixel (Shift ten). Each handle let go or nudged
is one change: the shape becomes a rectangle of the proportions guessed from it, the dials and the horizon's turn
go back to none (the corners now say how the picture stands), and the crop becomes that rectangle, so a page or
a screen comes out alone. Its proportions are found by Zhang and He's method ("Whiteboard scanning and image
enhancement", 2007): the camera's focal length is read from the four corners, the picture's middle taken as the
camera's. When one pair of sides is parallel the focal length cannot be read, and the one taken for the dials is
used. Corners that would throw part of the picture behind the camera or spread it past three times its longer
side are refused, and the status says "Not a rectangle". Escape (or Corners again) shows the result.

Auto (also Image, Straighten lines, and the picture's right-click menu) finds the picture's straight lines in a
copy 1024 on its longer side: edges by their gradient, pixels whose edges run the same way within 22.5 degrees
grown into regions and each fitted with a line, kept when long (4 percent of the longer side) and thin (the line
segment detector of von Gioi and others, much simplified). The lines within 30 degrees of upright vote on where
they meet (every pair's crossing, and far away), each scored by the length of the lines that point at it within
a degree and a half, refined by least squares. They are clear when at least three agree, together half the
picture's height long and half the upright lines' length, spread over a fifth of its width. Then the camera's
turn that sends their meeting place to straight up is worked out and read back as tilt, turn left or right and
roll: the tilt and turn go to the dials and the roll to the horizon's dial, all as one change, one undo. The
level lines are used too, when they are as clear and need a turn of at most 20 degrees (10 unless there are
eight or more); a tilt over 15 degrees needs eight upright lines. Past 30 degrees, or a roll past 15, nothing
is changed. With nothing clear the status says "No clear lines" and nothing is changed. With corners set by
hand the lines are first put where the corners' map puts them, so the dials straighten what the corners made.

In the document a perspective is one step, `{"type": "perspective", "vertical": 6.2, "horizontal": -1.5,
"corners": [...], "ratio": 0.707}`, only what is set kept, the dials held to 30 degrees in hundredths, the ratio
to a twentieth and twenty, corners only as four places; a step of nothing is no step; a file from before it reads
as it did. It is done before the horizon's turn: the two make one map from the original to the level picture,
and everything the horizon's arithmetic did reads through it. The crop with none of her own is the largest
upright rectangle inside the straightened picture, a convex four-sided shape: over any stretch from x0 to x1
the tallest rectangle is read from the two ends alone (its top edge is convex, its bottom concave), and the best
stretch is searched on a grid of 200 by 200, then each end on finer grids, and kept for each map since the
picture is drawn many times a second. A crop of her own is held to the box round the straightened picture,
then fitted inside as on a turned one (halving, since the map is not straight in the share). No empty corner is
exported. Covers, marks, parts and words stay where they were put in the original's pixels: a box's corners
and an arrow's ends are put where the map puts them and drawn straight between, a text and an arrow's head by
the map's nearest straight-line likeness at their place; a cover is painted into the original before anything
is sampled, as ever; a part's mask is read through the map back.

On the screen each piece of the picture is four corners where the map puts them, and the card is given each
corner's depth (the bottom of the map's fraction there, from the map of the unit square to the four corners),
as the position's last number, so it draws the piece through the map and not as two flat triangles; a picture
with no perspective draws exactly as before. Flattening, the pass that turned a piece upright follows the whole
map back to the original, nine numbers, its Lanczos filter of six by six widened by as much as a step of the
result moves more than a pixel of the original (up to eight times), so a part the map shrinks does not shimmer;
the part of the original each piece reads is grown by as much, and the pieces made smaller to fit the card.

Measured: the proportions of an A4 page, a 16 by 9 screen and a square photographed by a pinhole camera at
slants of up to 40 degrees are found within a percent; a building drawn as taken with the camera tilted up 4
to 12 degrees, turned up to 9 and rolled up to 2 is straightened within 0.6 degrees of tilt and 0.4 of roll
(`lines.test.ts`); the largest rectangle inside is within 0.2 percent of the closed form with only a turn and at
least 99.5 percent of a search over many shapes with a perspective (`perspective.test.ts`). Through a keystone
with a cover and a shrink, and corners with a turn and an enlargement four times over, WebGL2 flattens to the
same arithmetic done on the processor within one, but for 3 values of 433,200 that are two apart (a rounding of
the level piece carried by the filter's lobes when much enlarged), and WebGPU to WebGL2 within one (`gl.test.ts`,
`gpu.test.ts`). On the page (`perspective-tool.test.ts`), Auto on a drawn building taken at a 10 degree tilt and
a 1 degree roll gave 10.1 and 1, in 49 ms; the vertical dial's keys, the corners dragged and nudged, the crop
the rectangle's proportions, the export with no clear pixel, and the document opened again drawing the same
pixels; a photograph of soft shapes got "No clear lines". On 80 photographs from the photos page Auto found
clear lines in 15; by eye, the upright lines of the street, the rooms, the kitchen and the sign stood straighter,
which no number here measures.

**Repairing a JPEG.** Image, Repair JPEG, also in the picture's right-click menu, for a JPEG whose own tables
say it was made at quality 90 or below and which is stored upright (no Exif turn). It is a step, `{"type":
"repair"}`, taken away again by the same line or by undo. The repair is written by hand and fetches nothing
(`deblock.ts`): the file's quantization tables and sampling are read from its DQT and frame segments, and the
quality its luminance table is nearest (libjpeg's scaling of the standard's table) is known. The luminance is
cut into 8 by 8 blocks again on the grid moved by every even step (sixteen grids), each block's waves (its DCT)
rounded by the file's own steps and put back, and the sixteen averaged ("re-application of JPEG", Nosratinia
2001): a real edge survives every grid, a block's edge and the ringing round a real edge differ from grid to grid
and average away. The result is then held to the file: on its own grid each wave is kept within half a step of
what was decoded, so the repair only chooses among pictures that would have made the same file. Colour is left
alone (the code can repair it at the size the file kept it, but measured it sometimes made screenshots worse).
It runs in a worker of its own (`repair.ts`), once for each picture, about 0.36 s a megapixel on one thread, and
the repaired pixels take the original's place on the stage, under the cut-out, the models and the export.

Measured (`deblock.test.ts`, sharp's libjpeg at 4:2:0): photographs from the photos page made small (a river,
flowers, grass), screenshots kept as PNG (three of the site's project pictures) and drawings (a chart made in
the test and the Torrens Serif cover), each compressed at 10, 20, 30, 50, 75 and 90, the repair against the
decoded JPEG, by PSNR of red, green and blue against the clean picture, and SSIM of the luminance:

| Kind | 10 | 20 | 30 | 50 | 75 | 90 |
|---|---|---|---|---|---|---|
| Photographs, PSNR | +0.43 dB | +0.35 | +0.33 | +0.33 | +0.28 | +0.11 |
| Photographs, SSIM | +0.019 | +0.011 | +0.008 | +0.006 | +0.003 | +0.001 |
| Screenshots, PSNR | +0.24 dB | +0.41 | +0.46 | +0.56 | +0.60 | +0.33 |
| Screenshots, SSIM | −0.0008 | +0.002 | +0.002 | +0.003 | +0.003 | +0.001 |
| Drawings, PSNR | +0.17 dB | +0.19 | +0.11 | +0.25 | +0.33 | +0.18 |
| Drawings, SSIM | +0.0005 | +0.004 | +0.004 | +0.004 | +0.002 | +0.001 |

Every picture came nearer by PSNR at every quality but the chart at 30, which tied (0.01 dB below); at quality
10 the screenshots' SSIM fell by about a thousandth while their PSNR rose. Above 90 it was not measured and is
not offered. In the editor a 768 by 576 sign at quality 15 went from 35.99 to 36.44 dB (`repair.test.ts`).

**More marks.** Four more marks join the arrow, the box and the text, and the text gains lines, an outline and an
alignment. Each is a step like the arrow: made on the picture, picked by a press on it (pressed again in the same
place, the one beneath), moved by a drag or the arrows (Shift ten pixels), restyled from the strip while picked,
removed with Delete, brought forward and sent back from Edit and the right-click menu, undone and redone, kept in
`steps.json` and read back bounded; a file from before reads and draws as it did. Every mark is drawn by
`marks.ts` alone, on the screen over the picture and into the export in every format, so the two are the same; and
each follows a crop, a turn and a perspective as the arrow does (a number, a text and a spotlight made on a turned
picture keep a turn of their own, `angle`, and are upright on the screen).

- **Numbered step** (N, `{"type": "number", "at", "color", "size", "value"?}`): each press puts down a filled
  circle with the next number, in the pen's color, its figure black or white, whichever reads on that color; a drag
  places it where it is let go. The numbers are counted in the order the steps were made (their ids), not the
  order they are drawn in, so bringing one forward never renumbers them; one taken away renumbers the rest. Picked,
  its number shows in a field in the strip: a number typed there and kept with Enter is set by hand (`value`, 0 to
  9999), kept when others are taken away, and the count goes on from it. In order, beside the field, and Edit or the
  right-click menu's Number in order, let it be counted again. Its size is the pen's thickness seven times over.
- **Highlighter** (H, `{"type": "highlight", "from", "to", "color", "thickness"}`): a straight stroke, square at
  its ends, level on the screen as it is dragged (with Shift, at any angle), four times the pen's thickness. It
  multiplies what is under it, in its color a third of the way to white (as a highlighter's ink is lighter than
  paint), so a white page under it takes its color and black letters stay black; two strokes over each other are
  darker where they cross. On the screen the picture under each stroke is copied onto the marks' canvas first, so
  the same drawing multiplies the same pixels as in the export. Where the text reader has read this picture, a
  drag that starts on a word lies along that word's line, through its middle, from the first word to the word under
  the pointer on the same line and a tenth of the line's height past each, as thick as the line and a tenth more,
  slanted with the line; the reader is never run for it.
- **Magnifier** (M, `{"type": "magnifier", "at", "from", "radius", "zoom", "color", "thickness"}`): a drag from
  what is to be enlarged to where the lens goes; a press alone puts the lens half a lens up and to the right of
  the place pressed, or the first other side where it lies whole on the picture. A fine ring marks the place it
  looks at, a line runs from there to the lens, and the lens shows the square round that place, as wide as the
  lens over its enlargement (2, 3 or 4 times, from the strip; read back from 1.25 to 8). The weights become Small,
  Medium and Large lens (a radius of 0.048, 0.08 and 0.144 of the picture's longer side). Pressing the lens moves
  the lens; pressing the ring round the place it looks at moves that alone; the arrows move the part last pressed,
  the lens to start. What the lens shows is a look of its own (`lensLook` in `draw.ts`): the picture's grades,
  covers, repair, cut-out, turn and perspective, and the marks drawn before it but other lenses and spotlights,
  over that square of the level picture, flattened by the card exactly as the export is, as many pixels across as
  the lens is where it is drawn. So in the export it is sharp at full size from the original's own pixels, even when
  the picture is made smaller; and on the screen the stage flattens it the same way at the screen's size, keeping
  the last one drawn while a new one is made, so it never blinks while dragged.
- **Spotlight** (S, `{"type": "spotlight", "rect", "round"?, "dim"}`): a drag leaves a rectangle, or an ellipse
  (the strip's Rectangle and Ellipse), bright while all the rest of the picture is shaded. Every spotlight is one
  shade with all their shapes cut out, so two shapes that overlap leave their overlap bright, and it lies on the
  picture under every other mark whenever each was made (at first it lay at the place of the first spotlight,
  which dimmed a number or a lens made before it and left one made after it bright); the strip's Light, Medium and Dark shade (0.35, 0.55, 0.75 of black) change every spotlight at
  once, and a new one takes the shade there is. A spotlight is picked by its edge, as a box is, so what is inside it
  can still be pressed.
- **Text** (T): Enter keeps it and Shift and Enter starts another line; the field grows with what is typed and
  shows the outline and the alignment as they will be drawn. The strip's Align left, Align center and Align right
  lay the lines on the place pressed (`align`); changing it on a text picked moves its place by as much as keeps
  the block where it is. Outline opens a small menu grown from its button: No outline or one of the six colors, and
  Thin, Medium or Thick outline (0.05, 0.08, 0.13 of the text's size; `outline`, `outlineWidth`), drawn under the
  letters. The pen remembers all of these, and the mark last used, in `quire-img-pen`.

**Where the marks are.** The bar had room on a wide window for all seven, but not at 390 pixels, where it already
left Facts and Cut out out. So the bar has one button for the mark last used, one press away, its icon and tooltip
the mark's, and beside it a narrow Marks button (an arrow down) that opens a menu of all seven, grown from where it
was pressed, each line its icon, its name and its key, the mark in hand ticked; Tools lists them too. The menu takes
the keyboard when opened, so Escape closes it and leaves the tool in hand as it was (the outline's menu likewise).
That is one button fewer than the arrow, the box and the text had, which gives Cut out back to the narrowest
screens. Measured with a pasted screenshot, the room between the middle groups and the end group, and the buttons
shown: at 1300 wide 683 pixels before and 735 after (13 buttons, then 12); at 1024, 441 and 492; at 390, 11 buttons
in 336 pixels of 350 before (Facts and Cut out left out) and 11 in 328 after (Facts alone left out), one row each.

The keys: N numbered step, H highlighter, M magnifier, S spotlight, each listed in Help. The right-click menu on a
number set by hand has Number in order after Remove, Bring forward and Send back.

Measured (`marks-tool.test.ts`, headless Chromium, software drawing): three presses make 1, 2 and 3, the first
taken away leaves 1 and 2, a 7 typed is kept and Number in order puts it back, each change one undo. A highlighter
dragged crooked is level, with Shift it is not, and started on read words it lies on their line to within a
millionth of a pixel; under yellow the page is yellow and a letter stays under 90 of 255. A picture of one-pixel
stripes made half as large loses them (within 60 of gray), while a lens four times enlarged over them draws each
stripe two pixels wide at 37 and 218; a lens looking at a red square has the square's middle at its own and its
edges within four pixels of where twice its size puts them; on the screen the lens shows the square too. Two
spotlights leave their overlap at 244 of 244 and shade the rest to 110, then 61 with Dark shade. A white text with a
black outline has both inks, its middle within four pixels of the place pressed. Turned eight degrees, a number is
picked where it now is; straightened eight degrees, a text's ink starts within six pixels of the corner of a box made
at the same place (it had been drawn hundreds of pixels away before: the text was drawn at the map's likeness of the
origin, not of its own place). On a 4000 by 3000 photograph the export took 518 to 541 ms, 552 to 573 ms with a
magnifier; on the screen a lens is drawn again within about 57 ms of the place it looks at moving (the test's
waiting goes in steps of 50 ms, so this is an upper bound). A tap of a finger puts down a number and a magnifier.

**Ready for models.** `tiles.ts` cuts a picture into tiles read with a margin, runs a step on each and keeps
only its middle, enlarged by the step's scale, handing each finished tile on as it is done. A stand-in that
blurs twice and enlarges twice gives, tile by tile with a margin as wide as its reach, exactly the pixels it
gives the whole picture; with no margin the joins show. A 50 megapixel photograph read a tile at a time ran
through a blur in 54 tiles in 2.1 s, memory growing by 78 MB at most against 200 MB for the picture held whole.
It says the share done after each tile and stops between tiles when asked. A result past 16,384 a side is
refused (a 50 megapixel photograph cannot be enlarged at all; a 12 megapixel one four times).

**Repairing and enlarging with a model.** Nine candidates were tried on the site's own runtime and measured; what
ran where, what each is worth, how much each invents and why three were kept is in
[imgQuire-models](imgQuire-models.md). Each is fetched, checked and kept as the text models are (from Hugging Face
at its pinned commit, no referrer, no cookies, its size and SHA-256 checked before it is kept in the browser's
private storage, in a folder of its own, and again before it is used), and run in a worker of its own
(`restore/engine.ts`) tile by tile, each finished tile handed back to the page as it is done.

- **Repair JPEG** stays the instant way it was, and uses the way last chosen. **Repair JPEG with…** (Image, and the
  picture's right-click menu) opens a dialog in the reading dialog's family, straight to its cards, three in a row:
  Instant (no download, first and where it starts), Better (SCUNet, 38 MB, "Blocks and noise smoothed away") and
  Best (FBCNN, 144 MB, "Blocks gone, detail kept"), each with its size or "On this device", the source and license
  under them; the button says Download and repair, or Repair when nothing is to be fetched. Better is offered only
  for a file at quality 50 or below, both only where a graphics card gives WebGPU (on WebAssembly a megapixel takes
  one to one and a half minutes); without one the dialog says so and offers Instant. FBCNN is told the file's
  quality. The step is `{"type": "repair", "model": "repair-best", "made": "pictures/name-repaired-repair-best.webp"}`:
  the model's result is kept in the document beside the original, written by the site's own WebP lossless encoder
  (a PNG where it cannot be had), so the document opened again draws the same pixels with no model and no request,
  and the model is never run again on opening. The cost is in the file's size: about 1.0 to 1.1 bytes a pixel for a
  photograph (a 12 megapixel photograph's repair, about 12 MB beside a JPEG of 1 to 3 MB), 0.2 for a screenshot; as a
  PNG it would be 2.3 to 2.6 and 0.35. A step from before, `{"type": "repair"}`, reads and draws as it did; a model's
  result missing from the document falls back to the instant repair and says so.
- **Enlarging** is in Resize: the sizes gain 200% and 400%, and a quiet button under them says the way a picture
  made larger is enlarged, "Enlarge: Filter" or "Enlarge: Sharp", and opens the same dialog with two cards, Filter
  (the resize's own filter, no download) and Sharp (Swin2SR lightweight, 8 MB, "Faithful edges, a minute or two a
  megapixel"). A resize larger than the picture then names the model (`"model": "enlarge-small"`); one that makes
  it smaller ignores it. When the picture is exported or copied (and for the weight under it), the picture as it
  looks before the resize is flattened at its own size with no marks, run through the model once for up to twice
  as large and a second time over its own answer for more, made the asked size by the browser's best resampling if
  that is not the model's own, and the marks drawn over it. The result is kept while the document is open, for the
  look it was made from, and never in the document: it would cost four to sixteen times the picture's pixels in the
  file, and it is only wanted on export, so opening a document runs nothing. Past 16,384 a side or 64 megapixels it
  is refused in plain words and the filter used. Sharp runs on WebAssembly even where there is a graphics card,
  since it gives a wrong picture there.
- **While a model runs** the strip says "Repairing 40%" or "Enlarging 40%" (with "twice as large first" and "then
  twice again" for four times) with Stop; Escape stops it too. Stopped or failed, the picture is left as it was and
  the status says why in plain words; a run the graphics card could not finish (its errors watched for the length
  of each run, as the cut-out's are) is made once more in a fresh worker first. One run at a time.
- Help, Open-source notices credits the three models, their authors, sources and licenses (`codecs/MODELS-NOTICES.txt`,
  which `codecs/build.sh` writes into the notices).

Measured (`restore/real.test.ts`, `restore/tool.test.ts`, headless Chromium, four cores, an RTX 3070 Ti): a 1280 by
960 scene compressed at quality 30 came from 31.93 dB to 32.17 with Instant, 38.04 with Better and 39.99 with Best;
Best took 1.8 to 2.1 s, Better 9 to 10 s. A 320 by 240 scene made twice as large came to 34.77 dB against 29.60 for
the filter (and 28.90 for the browser's smooth enlargement), in 11.6 s on two WebAssembly threads, its tiles within
73.7 dB of the whole picture's answer; four times by twice over, 28.63 against 25.32. The document reopened draws
the same pixels with no request; the only request outside the page is the model's file, a GET with no body.

**Batches.** Several pictures chosen, dropped or pasted at once (on the home screen or in the editor) become one
document, one row on the shelf, named "Pictures, 15 Nov 2026 14:30". The first is shown at once; the rest are read
a few at a time and added in the order given, the strip growing in from where they were dropped and each small
picture arriving as it is read, the status saying "Bringing in 12 of 24". More are added by a drop on the strip,
File, Add pictures, or Add pictures and Paste in a small picture's menu; a document of one picture becomes a batch
that way. One is taken out from its menu; down to one picture, the document is a picture's document again.

*How it is kept.* One `.quire`, as the slice's notes suggested: steps.json lists the pictures, each with its
original (as before), the name its file came with (`given`), its small copy (`small`, `pictures/IMG_1.small.webp`,
192 on its longer side, made once as it arrives) and its own export settings, and its steps one to a line; every
original and small copy sits in `pictures/` beside it. A document of one picture is written exactly as before, byte
for byte (`writeBatch` hands it to `writeSteps`; a test holds it). What it costs: the browser's store keeps each
picture as its own record, so a batch costs what its originals weigh plus about 10 KB a picture for the small
copies; but a `.quire` written whole (downloaded, or kept in a folder or on Drive) holds every original in one zip,
and the core reads a zip of at most 256 MB, so a batch of phone photographs past that opens only from the browser's
store. steps.json is read with at most 1,000 pictures, 40,000 steps in all and 64 MB. Each picture keeps its own
undo while the document is open, and a picture's place in the batch on the stage is remembered in this browser
(`quire-img-batch-at`), so a batch opens again on the picture last worked on.

*The strip.* Under the picture and the line under it, taking room of its own: the picture is fitted into what is
left and glides there as the strip grows in. Small pictures 3.6 rem high (2.9 on a phone) in their own shapes,
quiet until the one on the stage, which has a ring in the accent inside its edge; drawn on the processor as each
picture looks (its crop, its whole grade, its covers and its cut-out, not its marks). It scrolls sideways by a
finger, a touchpad or the wheel, and brings the current picture into view. A press steps to a picture; Page Down
and Page Up step to the next and the one before, Home and End to the first and the last, keys that the crop's frame,
a mark and a corner never use; with the strip holding the keyboard its arrow keys step too. Stepping applies a crop
being dragged first and keeps the tool in hand if it is Hide or a mark (else the crop's frame, as a new picture
has); every picture keeps its own steps and undo. The line under the picture says "3 of 24 · 1400 × 788 px · 146
KB WebP". A small picture's right-click menu (Shift leaves the browser's): Save this one, Copy this one; Give its
changes to the other 23, with what they are said under it ("the grade, 1920 wide, WebP at 85"); Add pictures,
Paste; Take out of the batch. Pressed between small pictures it holds Add pictures and Paste.

*Give to all.* On the Grade surface under its fixes, in the resize box under the sizes, in the export panel, in the
cut-out's strip, in Image, Give to all (the grade, the size, the repair, the cut-out, the export settings, or all of
its changes) and in a small picture's menu. Each says in a few words what it will do before it is pressed ("Give this
grade to the other 23 pictures; their crops, marks and hidden areas stay their own"; "Make the other 23 pictures 1920
wide too"). The grade (the whole picture's, never a part's) and the size are put in place of each picture's own, a
size exactly as set; the export settings are given; the repair by hand is put in on each picture that is a JPEG
worth repairing; crops, covers, marks, parts, turns and perspectives are never touched. It is one undo step: every
picture's own undo holds the same group, so undo on any picture that still has it at the top takes it back from all
(and puts their export settings back), redo gives it again; a picture changed since keeps its own change on top. A
repair by a model or a cut-out is made for each picture in turn, each one joining the group as it is done, the strip
saying "Cutting out 3 of 23" (a repair also how far through that picture) with Stop, after which every picture is
done or as it was.

*Out.* The export panel in a batch says that its settings are this picture's own, offers Give to the other 23, and
Save all 24 as a zip and Save all into a folder. Each picture is written with its own settings, under its own name
with the format's ending (`IMG_1042.webp`), the second of one name `photo (1).webp`, then `photo (2).webp`, names
compared without case. The zip is written as it goes, into a file chosen with the browser's save picker where it has
one (else handed over when done, its parts the encoded files themselves); a folder chosen with `showDirectoryPicker`
is listed first and each name checked again just before it is written, so nothing there is written over. A few
pictures at a time (three, fewer on a machine of few cores): each is decoded, repaired and cut out as its steps say,
put on a card of its own and flattened in pieces of 1024, then encoded in its codec's worker while the next is
flattened; written in the batch's order, which also keeps no more pictures made and waiting than are being made. The
panel says "Saving 12 of 24" with Stop, which keeps what was written; the status says where they went and how long it
took. Any one picture is still copied or saved alone (Copy and Save, or its menu), a batch's under its own name.
File, Download has All pictures as a zip and All pictures into a folder.

Measured (`batch-strip.test.ts`, `batch.test.ts`, `batch-out.test.ts`, `picture-out.test.ts`): three pictures pasted
are one batch; Page Down and Page Up step, a cover and its undo staying with its picture; the grade given from the
surface reaches all three as one undo, no cover moving; the zip's files are `photo.png`, `photo (1).png` and
`other.png`; a folder holding `photo.png` gets `photo (1).png` and `photo (2).png` and keeps its own; a picture
flattened away from the stage is the stage's own flattening within one; the batch is one row on the shelf and opens
on the picture left; taken down to one picture it is written as one picture's steps.json. With the real Quick
model, the cut-out given to the others cuts each out laid on the same color, and one undo takes it from both
(`cutout/tool.test.ts`).

A hundred pictures, measured in headless Chromium on software drawing (SwiftShader), four cores, memory as the
proportional share (PSS) of all of the run's Chromium processes, the empty editor itself about 300 MB:

| | 100 phone-sized photographs made in code (4000 × 3000 JPEG with grain, 570 MB, chosen as files on disk) | 100 photographs from the photos page (AVIF, 19 MB) |
|---|---|---|
| First picture shown | 0.4 s | 1.5 s |
| All in the batch, every small picture drawn | 8.7 s | 17.7 s |
| Opened again (steps read, the picture shown, 100 small pictures drawn) | 2.7 s | 3.7 s |
| A step with Page Down | 0.23 to 0.46 s | 0.37 to 0.71 s |
| A grade given to all | 1.9 s | 2.4 s |
| Export all as one zip, WebP at 85, graded | 331 s, 499 MB | 84 s, 31 MB |
| Memory at its worst | 1.54 GB (while exporting) | 0.88 GB |

Memory stays where it is with the number of pictures: it rises while three pictures are made at once and falls
back between them (the 12 megapixel run swung between 0.6 and 1.5 GB through its five minutes of export and ended
at 0.62 GB). Most of a step's time and of the export is the software drawing; a grade given to all spends its time
drawing the hundred small pictures again. A first run that pasted the 570 MB of pictures as Blobs held in the page,
rather than files on disk, lost 9 of them to Chromium ("the requested file could not be read"); the status then said
so, with the reason, and the rest went on.

## Decided

## Decided

- Its uses, all four: crop, resize and convert; photo fixing; screenshots marked up and things hidden;
  memes and text on pictures. Upscaling is wanted too. It is to be simple to pick up, as Spectacle is,
  and rich in features underneath.
- **Quick first, layers later.** The fast everyday jobs come first; layers come after.
- What it must do better than other editors: open and save quickly, export well, and be easy to use with
  the features that are needed.
- **How pictures arrive:** a pasted screenshot, a dropped or opened file, and a photograph from the phone.
- **The four fast jobs**, each under ten seconds from paste to copied out: crop and copy; shrink and
  convert; hide something; mark up.
- **The first second:** the picture with a crop frame already on it, a small bar of tools above
  (crop, resize, hide, mark, export), and its size in pixels and bytes under it.
- **Machines:** built for a mouse and keyboard first, made usable on a phone afterwards.
- **The file is non-destructive from the first day.** The original is never changed. Every crop, grade,
  mark and hidden area is a step that can be changed or removed later. The file is a `.quire` zip holding
  the original and the steps. Export flattens.
- **Models.** Tools that need a model fetch it into the browser once and run it there; nothing is
  uploaded. Allowed: reading text, finding things, describing a picture, cutting out a subject,
  upscaling, denoising, removing an object and filling a gap from the surrounding picture. Ruled out:
  making an image from a text prompt. Each such tool offers models at about 10 MB, 50 MB and up to
  200 MB. Reading text in pictures is to be very good. The candidates are in
  [imgQuire-models](imgQuire-models.md).
- **The suite:** imgQuire has a page of its own and shares one shelf with mdQuire: one list shows both
  kinds of document, with the same places to keep them, menus, palette and look. A picture in an mdQuire
  document opens in imgQuire and comes back.
- **Hiding:** the default cover is a solid block, in a colour taken from the picture, and the pixels under
  it are gone from the export. Redacting is to be very simple.
- **Export:** a target weight ("under 200 KB") with the result shown beside the original; many pictures
  at once; the main button copies to the clipboard and saving a file is second. Formats: AVIF, JPEG XL,
  JPEG and PNG (and WebP, which the site uses).
- **Drawing and arithmetic:** WebGPU first, written by hand with no libraries, with WebGL2 where WebGPU
  is missing.
- **Grading, as the owner chose it.** G opens a surface of one-press fixes, then six plain sliders, with the
  deeper controls (curves and wheels) folded under More; a small histogram at its top that turns into a
  waveform. Before and after both ways: the original while a key or a button is held, and a split line that can
  be switched on and dragged. Everything in the notes is in scope: the whole picture and parts (a gradient, a
  painted area, a thing a model found), each part graded by the same surface with the part picked on the picture,
  feathered and turned inside out. Models for parts: press-to-select (more presses add, Alt takes away) and
  one-press Subject and Background, from SlimSAM and MODNet (small) or SAM 2.1 tiny and ormbg (better). Looks
  saved, given to other pictures, and read and written as `.cube` files.
- **Wanted, to be designed:** a picture analysed as it arrives (what is in it, its text, its metadata) so
  that the right tools are offered.
- Its working name is imgQuire, as part of a Quire suite with mdQuire.
- **No list of steps.** There is no steps list at all. Marks and covers are picked on the picture, and
  undo, redo and version history do the rest of what a list would; whatever only a list could do is
  reachable from the menus or the keys (removing, bringing forward and sending back what is picked).
- **A panel never covers the picture.** A surface that stays open makes room: the picture is fitted into
  what is left and glides there. A popover (the resize box, a menu) may lie over it while it is open.
- **Batches, as chosen on 15 November 2026** (built: Batches, above, says how, and which keys step through them). Many pictures dropped at once sit in a strip of
  small pictures under the one being worked on, which makes room for it; a press on one works on it and the
  arrow keys step through, the line under it saying which of how many. A change belongs to its own picture
  until it is given on: Give to all hands a change of a kind that fits any picture (the look, the resize, the
  repair, the cut-out, the export's settings) to every picture in the batch as one undo step; crops, marks
  and hidden areas are never handed on. A finished batch leaves as one zip, or, where the browser allows a
  folder to be chosen, as files written straight into it, and any one picture can still be copied or saved
  alone. Exported files keep their own names with the new ending; two of one name become `photo.webp` and
  `photo (1).webp`, and nothing is overwritten.

## Chosen features

All of it is to be simple and easy first, with the depth underneath.

- **Redacting.** Click a word to hide exactly that text (the text reader finds the words). On arrival,
  what looks private is found and offered: emails, phone numbers, addresses of machines, keys and tokens,
  names, street addresses, faces, number plates. Hiding one thing offers every other copy of it, across a
  batch too. Selecting something brings up the same small bar and right-click menu that mdQuire has for
  selected words, fitted to pictures.
- **Colour and fixing.** Grading a part of the picture (painted, a gradient, or a thing a model found: the
  sky, a person, the background) as well as the whole. Curves, colour wheels, a colour's own hue and
  saturation, with a histogram and waveform. Looks that are saved, applied to other pictures and to a
  batch, and written and read as `.cube` files. One-press fixes: levels, white balance, the horizon,
  perspective, a colour cast, each a step to tune afterwards. Repairing what compression took: blocks and
  ringing from a JPEG removed, and detail restored.
- **Knowing the picture.** A panel of facts on arrival: size, format, colour profile, camera, lens, date,
  place, whether it was edited, its main colours, what a model sees in it. All metadata read and written
  (EXIF, IPTC, XMP): a date fixed, author and licence set, alt text and a caption kept in the file,
  everything stripped or only the location. Text in a picture selected and copied as text on a page is.
- **Marking and making.** Arrows, boxes, numbered steps, a highlighter, a magnifier, a spotlight, all
  editable later. Caption text with an outline, speech bubbles, stickers, a thing cut from one picture
  and put on another. Named sizes, templates, grids and collages, shapes, guides that snap. Many typefaces
  to choose from.

- **Typefaces.** A bundled set of open-licensed faces, each loaded only when picked; a font file dropped
  in and kept in the browser; and, as an option that is off until chosen, fetching from Google Fonts, which
  is the one thing here that contacts another company's server.
- **From the phone.** The PC shows a QR code, the phone scans it, and the photograph goes between the two
  browsers with no account and nothing stored. Foxy's nine-digit code needs a rendezvous that a browser
  cannot do alone until Foxy's web client exists; when it does, imgQuire is to use it.

- **Where pictures come from, besides paste and files.** An Immich server of the owner's own: signed in
  to with her Immich account (its own sign-in, not a pasted key), the address and session kept in the
  browser only and never in the repository; albums browsed, searched and pulled in. Any folder on the
  machine as a library: a grid, dates, search by name and by the text found in the pictures (a folder
  that Syncthing keeps is one of these). Ideas are to be taken from Immich's own interface.
- **Writing and reading formats.** Browsers write only PNG, JPEG and WebP, so encoders are built to
  WebAssembly and each is loaded only when its format is picked; the measurements are in
  [imgQuire-codecs](imgQuire-codecs.md). Only permissive licences are used, never AGPL. The four writers
  are the reference C encoders built with Emscripten, each kept as one whole file: `libjxl` for JPEG XL
  (lossy and lossless), `libaom` for AVIF, `jpegli` for JPEG and `libwebp` for WebP, with threads for the
  two large ones. Rust crates do the rest: `oxipng` for PNG, `heic-rs` to read HEIC photographs from a
  phone, `little_exif` for metadata and `moxcms` for colour profiles. Before `libjxl` is relied on, a
  release of it is to be built and its lossy quality compared with the native encoder's.
- **Working it.** Single keys pick a tool (C crop, R redact, A arrow, T text, B box, G grade, E export), Enter applies,
  Escape leaves, and the palette is mdQuire's. The first Ctrl+C asks whether to copy the picture as it
  looks or as the export is set, and remembers.
- **Names.** imgQuire, in a suite called Quire: mdQuire, imgQuire, later vidQuire. The trail reads
  charlotte / Quire / the document.

## The pride flag assembler

A mini on imgQuire's engine. Flags mixed and faded: split, diagonal, a smooth fade from one into another,
stripes interleaved. Stripes edited: colour, height, order, added and removed, with the symbols (the
intersex ring, the progress chevron), and a flag of one's own saved. A flag as a mask: filling a shape,
text, or the subject cut from a photograph, or a photograph showing through the flag's shape. Moving flags,
exported as an animated picture or a small video.

## Ideas noted

- From Foxy, the owner's file transfer tool: send a photograph from the phone to the PC with a short code
  or a QR code and no account; a friendly three-word name for a session or a batch; a name already taken
  becomes `photo (1).jpg` and never overwrites; the receiver chooses the shape (a zip of many exports);
  saying plainly what is and is not done.
- From Canva, to look into: templates, text styles, stickers and shapes, sizes named for where a picture
  is going.
- A pride flag assembler as a mini on imgQuire's engine: mix flags, fade one into another, edit stripes,
  and use a flag as a mask of a shape or a picture.
- Other Quires, for another day: vidQuire.
- Foxy's idea, rebuilt for the web in TypeScript and much changed: two devices, a short code or a QR code,
  and a file goes straight across with no account.

## Open

Each of these is a question to settle before building.

- **The name and the suite.** What makes it a suite is what the two share: the shelf, the places a
  document lives (`src/quire/core/store*.ts`), the zip (`zip.ts`), the menus, popovers, dialog and tooltips
  (`ui.ts`, `dialog.ts`), version history and the trail at the top. Those are the core now (`src/quire/core/`).
  To settle: one address each (`/imgquire/`) or one front door; one shelf showing both kinds of document
  or two; whether mdQuire opens a picture in imgQuire in place.
- **Export.** Formats (WebP, AVIF, JPEG, PNG, others); a target weight in kilobytes; exact pixels; several
  sizes at once; a live preview beside the original with its size in bytes; location and camera data
  stripped by default; how files are named; presets for the site's own sizes; many files at once.
- **Hiding things.** Blur can sometimes be undone and a solid block cannot: which is the default. Text
  that looks private is now found and offered (Reading text, above), never hidden by itself; whether
  it should also be offered as a picture arrives, without the tool being chosen, is still open.
- **Marking up.** Arrows, boxes, numbered steps, text, a highlighter, a magnifier and a spotlight are built and
  stay editable in the `.quire`; a pointer (a drawn mouse cursor) is still to be settled.
- **Photo fixing.** Which of light, colour, curves, white balance, straightening, perspective, sharpening,
  noise, healing a blemish, removing an object and removing a background are real needs; raw files or not;
  HEIC files from a phone.
- **Memes.** Outlined text, the site's typefaces, stickers, cutting a thing out and pasting it on another.
- **Speed and size.** How large the pictures are (a phone photo is 12 to 50 megapixels); whether it must
  work on a phone; drawn by the processor or the graphics card (WebGL or WebGPU, written by hand as Mote's
  drawing is).
- **In or out:** a pen or tablet, colour management and wide-gamut screens, animated pictures (GIF,
  animated WebP), SVG.
- **Privacy.** Nothing leaves the browser, as with mdQuire, and the page says so. Assumed, to be confirmed.
- **Where it sits on the site.** A hidden draft like mdQuire until it is ready, a project page, its own
  mark on the browser tab.

## How to run and test

```sh
bun run dev                          # /imgquire/
bun test src/quire/img               # the document, the arithmetic, and the browser tests
bun test src/quire/img/kind.test.ts  # the four fast jobs, timed
codecs/build.sh                      # the encoders again, from the codec trial's sources (see the script)
```

The browser tests need a Chromium and skip, with a notice, without one. WebGPU runs in headless Chromium
only with `--enable-unsafe-webgpu`, which the drawing tests pass.

## Known weak spots

- WebGPU's drawing on the screen has not been seen: headless Chromium loses the device the moment it
  shows a WebGPU canvas, so there the stage falls back to WebGL2. WebGPU's flattening is tested, the
  same to within one as WebGL2's, which is the same as the arithmetic done on the processor.
- A resized picture is drawn on the screen from the original at the screen's zoom, not from the resized
  pixels, so past one to one it looks finer than the export will be.
- A `.quire` in a folder says its kind only when opened, so its row on the shelf has no "picture" word.
- GitHub keeps no `.quire`, so picture documents live in the browser, a folder, a file or Drive.
- A shrink of more than about two hundred times in one resize reads very wide pieces; not tried.
- Not tried in Firefox or Safari, nor on a real phone or touch screen; pinch has no test.
- The text marks use the system's sans serif; typefaces are a later slice.
- The encoders run on one thread; JPEG XL at effort 7 and AVIF at speed 6 would want the threaded builds
  the trial measured (four times quicker), which need Emscripten's glue file.
- libjxl is the trial's 0.13 snapshot, not a release; its lossy files measured 1.2 dB under cjxl 0.12 at
  the same size, and a release tag is to be built and compared before it is relied on.
- HEIC is HEVC, which is under patents; whether a free HEVC decoder may be shipped in a page is a legal
  question asked in the codec notes and not yet answered. iPhone files with grids, 10-bit or gain maps
  were not tried.
- The modules are kept in the repository as built files (4.8 MB), since the site's build has no
  Emscripten; `codecs/build.sh` rebuilds them and their pins, and `public/quire/codecs/NOTICES.txt`, the
  libraries' copyright and license texts, which Help, Open-source notices opens.
- Metadata: XMP is read for its simple properties only, by a bounded scan rather than an XML parser; a
  PNG's compressed text and colour profile are noted but not opened; Exif's pixel width and height are
  kept as the original's when a crop changes the size; an IPTC caption in a language other than UTF-8 is
  read as UTF-8.
- Reading text: the Large size on WebAssembly is slow (12 s for a screenshot, 41 s for a 12 megapixel
  photograph on two threads); on a graphics card it is as quick as the others. The fixtures are drawn
  in the browser with its sans serif, so they are cleaner than a real screenshot; real screenshots,
  photographs of signs and handwriting were not tried here, nor scripts other than Latin.
- A line longer than 3200 pixels once brought to 48 high is squeezed to 3200, which loses letters.
- A word's cover is level with the picture's edges, so a word on a slanted line is covered by the
  rectangle round it, which takes in some of its neighbours' corners.
- What was read is not kept in the document: a picture opened again is read again. It is kept per
  picture only while open.
- The rules for what looks private see only text: faces, number plates and names are not found; a
  label of "key" or "pin" offers whatever follows it ("Key: Escape" too); a long hash is offered as
  a key. Phone numbers are matched by shape, so a long reference number may be offered.
- The tests hold that requests carry nothing of the picture through Chromium's own record of requests,
  with Hugging Face answered from the trial copies; a visitor's real download from Hugging Face (its
  redirects to its content network) was not made here.
- The horizon: Auto is not offered (no reliable arithmetic for it was found). A turned picture is drawn smoothed
  past one to one, not as square pixels. A picture resized to another
  shape (width and height both given) and turned has its covers and marks drawn by a turn in the resized pixels,
  which skews them a little. A cover made on a turned picture takes its color from the ring round the upright box
  about it.
- Finding: Better's Subject takes about 20 s, since ormbg will not run on the card's runtime; its SAM 2.1 decoder
  runs there but gives a wrong mask, so it runs on WebAssembly. The models were tried on a drawn scene, not on
  photographs of people, skies or things; MODNet is made for portraits. The found mask is kept at 512 a side.
- Colour profiles: only Display P3 can be converted to sRGB; another profile (Adobe RGB, ProPhoto, a camera's) is
  carried out byte for byte and its picture graded as sRGB and said to be, and Copy as it looks hands the clipboard
  its numbers as if they were sRGB. Colors outside sRGB are clipped channel by channel, which can shift the hue of
  the most saturated colors. A profile's curve is not read: P3 is taken to use sRGB's, as Display P3 does. Tried in Chromium only; the profile in a JPEG XL is read back only by decoding.
- The cut-out: a cover's color is taken from the cut-out's pixels once a picture is cut out; making the cut-out
  again (each brush stroke) puts the whole picture on the card again, about half a second at 12 megapixels.
  Its weak spots as a page are in [cutout](cutout.md).
- Grading: a part's layer is drawn again on the page's thread whenever its shape changes, so painting with a
  wide feather draws about 25 ms a frame; masks are at most 1024 a side, so a hard brush on a 50 megapixel
  photograph has an edge about eight pixels soft. A .cube larger than 33 a side is kept at 33, sampled between
  its entries, which can differ from the file by a level or two where the table bends sharply.
- Grading: looks live in this browser only (`quire-img-looks`); they do not travel with the shelf to Drive or a
  folder. The histogram is of a 200 wide copy, so a thin clipped highlight can be missed. With Grade open a new
  picture opens with Grade still open, not with the crop's frame on it.
- Grading on a phone: on the narrowest screens (under 26rem) Facts leaves the bar for View, Facts and the I key,
  so that the other eleven tools fit; the sheet's drag and the sliders by thumb were tried only in a 390 wide
  window with a mouse, not on a touch screen.
- Perspective: the dials take the focal length to be the picture's longer side, so a picture taken with a long
  lens needs more degrees than it was tilted, and a wide one fewer; nothing reads the lens from the Exif. Corners
  with one pair of sides parallel guess the proportions with that same focal length. Auto was measured on drawn
  buildings and only looked at by eye on photographs; it takes the meeting of the most upright lines, so a
  picture of something leaning on purpose is stood up. Exporting the empty corners round a straightened picture,
  when asked for, is not built: the crop always lies on the picture. A cover made on a straightened picture is
  upright by the picture's turn only, not by the perspective's own slant there. The picture is drawn on the
  screen through the map exactly, but marks' text and arrow heads by the map's likeness at their place.
- Repairing a JPEG: luminance only; colour's blocks stay. About 4 s for a 12 megapixel photograph, on one thread
  in its worker. Not offered for a JPEG with an Exif turn (the file's grid would no longer lie at the picture's
  corner) or above quality 90. Measured with libjpeg's own tables at 4:2:0; a phone's encoder with tables of its
  own, and 4:4:4 files, were not measured.
- The pictures of the built page were made with software drawing: with Chromium's Vulkan drawing the canvas
  came out empty in the window's picture, though everything else on the page drew.
- More marks: a magnifier's lens shows the picture and the marks drawn before it, but not another lens or a
  spotlight's shade. Its size is measured on the level picture, so on a picture resized to another shape (width and
  height both given) the lens is round by its width and its picture a little squeezed; with a perspective it is round
  on the screen and does not take the map's slant where it lies. A lens looking past the picture's edge shows a quiet
  gray there. On the screen each lens is flattened by the card whenever what it shows changes, one at a time; with
  many lenses on a large picture they catch up a little after a drag. A text's width is measured by the browser's
  canvas, so picking a text and aligning it are exact in the browser and a close guess elsewhere (the tests without a
  browser). The text field grows with what is typed by CSS `field-sizing`, which Firefox does not have (there it is a
  field of fixed width). The highlighter's copy of the picture under it, on the screen, goes through the marks'
  canvas, which is sRGB, so under a highlighter a Display P3 picture is shown in sRGB's colors; the export is right.
  A number set by hand and a spotlight's shade are changed from the strip only; a text already made cannot have its
  words changed, only be made again. Not tried on a real touch screen: a finger's tap was tried in the headless
  browser.
- Repairing and enlarging with a model: the repair models run only on a graphics card, so a machine without one has
  the instant repair alone; Sharp runs only on WebAssembly (it is wrong on the card in ONNX Runtime 1.24.1), so four
  times a megapixel takes several minutes. Enlarging is worked out on export, not shown on the stage (the stage
  draws the resize from the original, as before), and its result is held whole on the page, up to 64 megapixels.
  The repair's kept result adds about a byte a pixel to a photograph's document. The models' quality was measured on
  pictures made smaller or compressed here, not on a phone's own JPEGs or pictures that came small; the Swin2SR
  model's gain on those will be less. Tile joins were held to the whole picture's answer for Sharp only. The repair
  models' licenses rest on their upstream projects (imgQuire-models says what is and is not confirmed). The tests
  put the repair models in the browser's storage before they start, since the browser's driver cannot hand over
  a file of 38 or 144 MB as an answer; their fetch is held with Sharp's 8 MB.
- A picture in an mdQuire document does not yet open in imgQuire and come back: the core has the pieces
  (`takes`, `take`, one editor at a time) but a way for one kind to lend a picture to another and have it
  back is still to be designed.
- Batches, kept: a `.quire` written whole (downloaded, or in a folder or on Drive) holds every original in one
  zip, which is made in memory when it is downloaded, and the core reads no zip past 256 MB, so a large batch of
  photographs is at home only in the browser's store. Taking a picture out is not undone by Ctrl+Z (version history
  brings it back, its original being kept with the document until the document is deleted). A conflict with a batch
  changed elsewhere, and restoring a batch's version, open it whole with nothing to undo.
- Batches, undo: a change given to all is one step on every picture that still has it on top; a picture changed
  since keeps its own change on top, and undoing that change and then the next takes the given change back from that
  picture alone.
- Batches, the strip: a small picture is drawn as its picture looks by its crop, whole grade, covers and cut-out, but
  not its marks, parts, turn or perspective, and always as sRGB. Stepping to another picture is refused while a model
  works on the one on the stage (a repair, a cut-out, an enlargement); a model run over the batch does not stop it.
- Batches, giving: a size is given exactly as set, so a smaller picture is made larger, and a size given with both
  width and height stretches a picture of another shape. What metadata goes out (None, No place, All) is chosen for
  the whole document while it is open, not for each picture. Ctrl+V in the editor still makes a new document; a
  picture is added to a batch from its strip (a drop, or Add pictures or Paste in a small picture's menu) or File,
  Add pictures.
- Batches, out: on a machine drawing without a graphics card, each piece of a picture flattened waits on the page's
  thread, so the page answers late while a batch is exported (up to about 3 s at a time for a 12 megapixel picture on SwiftShader). A zip past 4 GB (no zip64) is refused and
  saving into a folder offered. Where the browser has no save picker the zip is handed over when done, its parts held
  by the browser until then. Tried in Chromium only, by mouse and in a headless browser; not on a real touch screen.

## Next slices, in order

1. From the phone, and opening a picture from mdQuire and back.
