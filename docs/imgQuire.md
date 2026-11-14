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
- `panels.ts`: the steps list, the export panel, the resize box and the tool's strip.
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

**Steps.** Hidden until the Steps button grows the list open at the left side: each step a switch (its
words and a tick) that turns it off and on, a bin that removes it, Alt and the arrows to move it.

**Getting it out.** Ctrl+C copies: the first time a dialog asks whether as it looks or as the export is
set and remembers (`quire-img-copy`; Edit, Copy as changes it). The clipboard is handed a promise of the
picture at once, so the press counts. The export panel, at the right side: PNG, JPEG or WebP, a quality,
or a weight to come in under ("200", "1.5 MB") found by halving the quality seven times, the result's size
and weight, the same middle part of the original and the export side by side at their own pixels, Copy
(filled) and Save. Saved files are named from the document (`screenshot-14-nov-2026-01-30.webp`). What the
browser encodes carries no metadata; a picture with no steps given in its own format is its original with
where, when and with what it was taken cut out (`core/picture-bytes.ts`). The settings are kept in this
browser (`quire-img-export`), WebP at 0.85 to start; the pen too (`quire-img-pen`).

**As a Quire.** Menus File, Edit, View, Image, Tools, Help, as one table, an icon on every line, ticks for
what is on, submenus for Download, Copy as, Zoom, Crop shape, Resize filter, Mark color and Thickness;
single keys C, R, A, T, B and E only while the picture has the keyboard, Enter and Escape; the palette is
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
- **Working it.** The steps are hidden until wanted: a "steps" button grows the list open at the side.
  Single keys pick a tool (C crop, R redact, A arrow, T text, B box, G grade, E export), Enter applies,
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
- **Hiding things.** Blur can sometimes be undone and a solid block cannot: which is the default. Whether
  to find text to hide by itself (names, addresses, tokens), which needs reading text in pictures.
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
- A picture in an mdQuire document does not yet open in imgQuire and come back: the core has the pieces
  (`takes`, `take`, one editor at a time) but a way for one kind to lend a picture to another and have it
  back is still to be designed.

## Next slices, in order

1. The encoders: AVIF, JPEG XL, jpegli and oxipng as WebAssembly, each a line in `FORMATS`
   ([imgQuire-codecs](imgQuire-codecs.md)).
2. The facts panel and metadata: reading and writing EXIF, IPTC and XMP, strip all or only the place.
3. Reading text in pictures, and click-a-word redaction, with what looks private offered.
4. Color grading of the whole picture and of parts, with curves, wheels and `.cube` looks (G).
5. The cut-out ([cutout](cutout.md)).
6. More marks: numbered steps, a highlighter, a magnifier, a spotlight, outlined captions.
7. Many at once: batches through the same steps and export.
8. From the phone, and opening a picture from mdQuire and back.
