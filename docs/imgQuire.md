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
  an arrow, a box, a line of text. `look` applies the steps that are on, in order; every place and size is
  in the original's pixels. Changing, removing, moving and switching off a step, undo and redo, and
  `steps.json` written one step to a line and read back checked field by field.
- `cover.ts`: a cover's color, from a thin ring of the picture round it.
- `draw.ts`, `gl.ts`, `gpu.ts`, `marks.ts`: drawing. One small interface (`Backend`) with two ways written
  by hand, WebGPU first and WebGL2 where it is missing; the plan for flattening piece by piece; marks drawn
  by the 2D canvas for both.
- `geometry.ts`: fitting, zooming about a point, and the crop's frame dragged, nudged and held to a shape.
- `stage.ts`: the picture on the screen and the tools that work on it.
- `export.ts`: the formats as one table, the weight search, file names, the clipboard.
- `metadata.ts`: a picture's Exif, XMP, IPTC and colour profile read and written by hand, through the
  core's walkers of a JPEG, PNG and WebP (`core/picture-bytes.ts`) and its own of AVIF, HEIC and JPEG XL
  boxes.
- `codec-run.ts`: running an encoder (or the HEIC reader) built to WebAssembly, in a worker, after
  checking its bytes against its pin in `codecs.json`. The modules are in `public/quire/codecs/`; they
  are built from source by `codecs/build.sh` (C wrappers in `codecs/wrap/`, the Rust ones in
  `codecs/rust/`).
- `read/`: reading the text in a picture, all by hand but the models and ONNX Runtime. `models.ts`, the
  three sizes of PP-OCRv6 pinned to commits and digests; `store.ts`, fetching and keeping them;
  `runtime.ts`, the site's ONNX Runtime fetched from `/ort/`; `pixels.ts`, `detect.ts`, `ctc.ts`,
  `words.ts` and `read.ts`, the steps from pixels to lines and words; `dictionary.ts`, the recognizer's
  characters out of its YAML; `private.ts`, the rules for what looks private; `engine.ts`, the worker.
- `reading.ts`: the tool as the editor offers it: the first time's dialog, the reading, what was read.
- `panels.ts`: the export panel, the resize box and the tool's strip.
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
| JPEG XL | libjxl 9e02071, `-Os` | 552 KB | quality (libjxl's distance), effort 3 |
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
label alone). Each thing is outlined on the picture in a warm dashed line, and the strip says "42
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

**As a Quire.** Menus File, Edit, View, Image, Tools, Help, as one table, an icon on every line, ticks for
what is on, submenus for Download, Copy as, Zoom, Crop shape, Resize filter, Mark color and Thickness;
single keys C, R, A, T, B, E, I and W only while the picture has the keyboard, Enter and Escape; the palette is
the core's; version history draws a version's steps over the original, small, and restores it as one step.

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
- **Wanted, to be designed:** reading and writing a picture's metadata (EXIF); colour grading of the whole
  picture or of parts of it; a picture analysed as it arrives (what is in it, its text, its metadata) so
  that the right tools are offered.
- Its working name is imgQuire, as part of a Quire suite with mdQuire.
- **No list of steps.** There is no steps list at all. Marks and covers are picked on the picture, and
  undo, redo and version history do the rest of what a list would; whatever only a list could do is
  reachable from the menus or the keys (removing, bringing forward and sending back what is picked).
- **A panel never covers the picture.** A surface that stays open makes room: the picture is fitted into
  what is left and glides there. A popover (the resize box, a menu) may lie over it while it is open.

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
- **Marking up.** Which of arrows, boxes, numbered steps, text, a highlighter, a magnifier and a pointer;
  whether marks stay editable after saving, which needs a file format of its own.
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
- The few lines that find and load ONNX Runtime are written twice, in dictation and in `read/runtime.ts`,
  since a kind may not import another's code; moving them into the core would let both share them.
- The tests hold that requests carry nothing of the picture through Chromium's own record of requests,
  with Hugging Face answered from the trial copies; a visitor's real download from Hugging Face (its
  redirects to its content network) was not made here.
- A picture in an mdQuire document does not yet open in imgQuire and come back: the core has the pieces
  (`takes`, `take`, one editor at a time) but a way for one kind to lend a picture to another and have it
  back is still to be designed.

## Next slices, in order

1. Color grading of the whole picture and of parts, with curves, wheels and `.cube` looks (G).
2. The cut-out ([cutout](cutout.md)).
3. More marks: numbered steps, a highlighter, a magnifier, a spotlight, outlined captions.
4. Many at once: batches through the same steps and export.
5. From the phone, and opening a picture from mdQuire and back.
