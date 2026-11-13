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

## Open

Each of these is a question to settle before building.

- **The name and the suite.** What makes it a suite is what the two would share: the shelf, the places a
  document lives (`src/quire/store*.ts`), the zip (`zip.ts`), the menus, popovers, dialog and tooltips
  (`ui.ts`, `dialog.ts`), version history and the trail at the top. Those would move to a shared folder.
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

Not yet applicable.

## Known weak spots

None yet, as nothing is built. The biggest risk is the choice of file model above, which is hard to undo.
