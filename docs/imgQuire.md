# imgQuire

An image editor in the browser, meant to sit beside mdQuire as a second part of one suite of tools. It is
for the everyday work done to pictures: cropping, resizing and converting; fixing photographs; marking up
screenshots and hiding what should not be seen; memes and text on pictures; and upscaling. The background
remover (`cutout.md`) is to be one of its tools as well as a page of its own.

## Where the code is

Nowhere yet. Nothing is built.

## Built

Nothing.

## Decided

- Its uses, all four: crop, resize and convert; photo fixing; screenshots marked up and things hidden;
  memes and text on pictures. Upscaling is wanted too.
- **Quick first, layers later.** The fast everyday jobs come first; layers come after.
- What it must do better than other editors: open and save quickly, export well, and be easy to use with
  the features that are needed.
- Its working name is imgQuire, as part of a Quire suite with mdQuire. The name is to be confirmed (below).

## Open

Each of these is a question to settle before building.

- **The name and the suite.** What makes it a suite is what the two would share: the shelf, the places a
  document lives (`src/quire/store*.ts`), the zip (`zip.ts`), the menus, popovers, dialog and tooltips
  (`ui.ts`, `dialog.ts`), version history and the trail at the top. Those would move to a shared folder.
  To settle: one address each (`/imgquire/`) or one front door; one shelf showing both kinds of document
  or two; whether mdQuire opens a picture in imgQuire in place.
- **The first minute.** Paste, drop, open a file, a screenshot from the clipboard, a picture from the
  site's photos folder: which is most common, and what is on screen one second later.
- **The fast jobs, in order.** For each use: how often, on which machine, and which three must take under
  ten seconds from paste to copied back out.
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
- **What the file is.** Non-destructive from the first day (every edit a step that can be changed later)
  or pixels first. This decides the base and cannot cheaply be changed afterwards.
- **Upscaling, and anything else that needs a model.** As with dictation, a model would be fetched into
  the browser and run there on ONNX Runtime, the one library already allowed. To settle: whether that is
  acceptable; how big a download; which model. Upscaling invents detail, and the site uses no AI-made
  images, so where the line falls between upscaling and generating has to be decided. Background removal
  and object removal sit near the same line.
- **Speed and size.** How large the pictures are (a phone photo is 12 to 50 megapixels); whether it must
  work on a phone; drawn by the processor or the graphics card (WebGL or WebGPU, written by hand as Mote's
  drawing is).
- **In or out:** a pen or tablet, colour management and wide-gamut screens, animated pictures (GIF,
  animated WebP), SVG.
- **Privacy.** Nothing leaves the browser, as with mdQuire, and the page says so. Assumed, to be confirmed.
- **Where it sits on the site.** A hidden draft like mdQuire until it is ready, a project page, its own
  mark on the browser tab.

## How to run and test

Not yet applicable.

## Known weak spots

None yet, as nothing is built. The biggest risk is the choice of file model above, which is hard to undo.
