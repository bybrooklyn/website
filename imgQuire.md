# imgQuire

An image editor, to be part of the Quire suite beside mdQuire. Her words, the questions to put to her, and what is
decided are kept here; ideas are added as she has them. The background remover has its own notes in
`cutout.md` and is to be one of imgQuire's tools as well as a page of its own.

## Her words

Her words, 12 Nov, late: "tomorrow i want to make an image editor that fits my use in every way". Asked what
she does to pictures she chose all four (crop, resize and convert; photo fixing; screenshots marked up and
things hidden; memes and text on pictures) and wrote "upscaling, everything basically i can do. ill think of
a lot of features and i want you to be ready to question the FUCK out of me tomorrow when you and i work on
it". Depth: "Quick first, layers later". What others get wrong: too slow to open and save, bad export, and
"hard to use or dont have the features i need". On where it lives she asked: "should we call this imgQuire?
and have it part of the *quire suite?". And: "seriously. i mean REALLY think tonight".

## Decided

Nothing yet. Nothing is built.

## To ask her

Mine, thought out that night, to be put to her as questions.

- **The name and the suite.** My view: yes. What makes it a suite is what the two would share, not the name:
  the shelf, the four places a document lives (`store*.ts`), the zip (`zip.ts`), the menus, popovers, dialog
  and tooltips (`ui.ts`, `dialog.ts`), version history, the trail at the top. Those would move to a shared
  folder that both use. To ask: one address each (`/imgquire/`) or one front door; one shelf showing both
  kinds or two; whether mdQuire opens a picture in imgQuire in place.
- **The first minute.** Paste, drop, open a file, a screenshot from the clipboard, a picture from the site's
  photos folder: which is the most common, and what should be on screen one second later.
- **The fast jobs, in order.** For each of her four: how often, on which machine, the last time it annoyed
  her and why. Which three must take under ten seconds from paste to copied back out.
- **Export**, where she says others fail: formats (WebP, AVIF, JPEG, PNG, others?), a target weight in
  kilobytes, exact pixels, several sizes at once, a live preview beside the original with its bytes, location
  and camera data stripped by default, the names files get, presets for the site's own sizes, many files at
  once.
- **Hiding things.** Blur can sometimes be undone; a solid block cannot. Which is the default. Finding text
  to hide by itself (names, addresses, tokens) would need reading text in pictures: wanted?
- **Marking up.** Arrows, boxes, numbered steps, text, a highlighter, a magnifier, a pointer: which, and
  whether they stay editable after saving (which needs a file format of its own).
- **Photo fixing.** Light, colour, curves, white balance, straighten, perspective, sharpen, noise, heal a
  blemish, remove an object, remove a background. Which are real for her; raw files or not; her phone's
  HEIC files.
- **Memes.** Text with an outline, her fonts, stickers, cutting a thing out and pasting it on another.
- **"Layers later".** What the file is: non-destructive from day one (every edit a step that can be changed)
  or pixels first. This decides the base and cannot cheaply be changed after.
- **Upscaling, and anything else that needs a model.** As with dictation it would be a model fetched into
  the browser and run there (the one library, ONNX Runtime, is already in). To ask: is that acceptable; how
  big a download; which model, since she does "not condone the usage of ai images" (upscaling invents
  detail: where is her line between that and generating); background removal and object removal sit on the
  same line.
- **Speed and size.** How big are her pictures (a phone photo is 12 to 50 megapixels); must it work on her
  phone; drawn by the processor or by the graphics card (WebGL or WebGPU, written by hand as Mote's is).
- **A pen or tablet,** colour management and wide-gamut screens, animated pictures (GIF, animated WebP),
  SVG: in or out.
- **Privacy.** Nothing leaves the browser, as mdQuire. Say so on the page.
- **Where it sits on the site.** Hidden draft like mdQuire until she says, a project page, its own tab mark.

## Ideas as she has them

- Upscaling.
- A background remover (`cutout.md`).
