# QR codes

A page that makes and reads QR codes, everything in the browser: the hidden page `/qr/`, built in
production and linked from nowhere but the list of tools (`/tools/`), as `/cutout/` is. It is a small tool of the Quire suite, beside mdQuire
and imgQuire, written from scratch with no library.

## Where the code is

`src/quire/qr/`:

- `tables.ts`: the numbers looked up from ISO/IEC 18004 (blocks and check bytes for each version and level),
  and what follows from them (sides, alignment places, data modules, format and version words).
- `galois.ts`: the field of 256 numbers, Reed-Solomon check bytes, and the repair of a block read with errors
  (syndromes, Berlekamp and Massey, Chien, Forney).
- `encode.ts`: the maker. Modes chosen for the fewest bits, Latin-1 or UTF-8, the smallest version, the
  level raised while the size holds, interleaving, the zigzag, the eight masks and the penalty.
- `decode.ts`: a square of modules back into text (format and version through three wrong bits, ECI, kanji).
- `read.ts` and `perspective.ts`: the reader that finds codes in a picture.
- `content.ts`: what goes in (Wi-Fi, vCard 3.0, `mailto:`, `tel:`, `sms:`) and what a code read holds, laid
  out by kind; files named in a few safe letters.
- `colors.ts`: contrast, deepening, the rainbow, and the pride flags (a copy of `src/minis/flags.ts`, held
  equal by a test, since the suite imports nothing from outside `src/quire/`).
- `style.ts`: the one SVG every look is drawn as, and `codeFor`, which raises error correction for a picture.
- `page.ts`: the page; `src/pages/qr.astro`, `src/scripts/qr.ts` (the site's colors offered as grounds),
  `src/styles/quire-qr.css`; its box and column are the small tools' kit (`src/quire/core/bench.ts`).

## Built

**The maker.** QR Code Model 2, versions 1 to 40, levels L, M, Q and H. The text is split into numeric,
alphanumeric and byte runs by a search over every character for the fewest bits; text all in Latin-1 is
written in Latin-1 (the standard's reading of byte mode), any other in UTF-8, with no ECI. The smallest
version that holds it is used, then the level is raised while it still fits that version. Each mask is
scored by the standard's four rules (the light outside the code counts toward the finder-like rule) and the
least is kept.

**What goes in.** Six kinds, each a form that fills the code as it is typed: link or text; Wi-Fi
(`WIFI:T:WPA;S:name;P:password;H:true;;`, with `\ ; , : "` escaped; no password makes it open); contact (a
vCard 3.0 of only the lines filled in, CR LF, `\ , ;` and line breaks escaped); email (`mailto:` with subject
and body percent-encoded, line breaks as CR LF); phone (`tel:` with only digits, a leading plus, `*` and
`#`); message (`sms:` with `?body=`). Text too long for version 40 at the level chosen is said plainly with
its size and the most that fits, and the last code stays, faded, so nothing jumps.

**How it looks.** Shapes: squares (each row's runs one path, so no seams), rounded squares, dots, diamonds,
bars (a column's runs as one rounded bar) and joined (outer corners rounded where a module has no neighbor,
inner corners of an L filled with a curve). Corners, the three finders, drawn whole: square, rounded or
round. Color: one color (eight deep ones offered, or any as hex digits), a gradient of two in four
directions, a rainbow at one lightness (OKLCH 0.5 on a light ground, 0.78 on a dark one), or a flag's stripes
(rainbow, trans, lesbian, bisexual, pansexual, nonbinary). Ground: white, the site's five light colors, any
hex, or clear. Margin: 0 to 8 modules, in steps of one. Error correction: low, medium, high, highest (L, M, Q,
H). The colors are checked by contrast (WCAG's): under 1.6 "too alike for a phone to read", under 3 "some
phones will not read it", and a code lighter than its ground is said to be so. A flag's stripes, and the
rainbow's colors, are deepened in even steps toward black (or toward white on a dark ground) until each
stands 3.5 from the ground, and the page says so.

**A picture in the middle.** The modules under a centered square (12 to 32 percent of the side, in steps
of 2) are left out and the picture sits inside it, half a module in, with round corners. For each level
from the one chosen, the code's bytes under the square are counted block by block (`damage`), and the first
level at which every block can mend them with one byte to spare (two for blocks of 20 check bytes or more)
is used, then raised while the size holds. A picture too big for any level is said so.

**A picture as the code.** In color: the picture over the code's square, each data module a small square
(0.46 of a module) or dot in the code's two colors over it, the finders on plain ground, the timing,
alignment and format modules drawn whole. As a halftone: each module split in thirds, the picture spread
into the two colors by Floyd and Steinberg's error spreading, each data module's middle third set to its
own color, the patterns whole. Either is given the highest level that fits the code's size.

**Read back.** Every code drawn is drawn again as it will be saved (at 5 pixels a module, 6 for the
halftone, at least 320 pixels), turned into pixels by the browser, and read by the reader; the page says
"It reads back as written." or "It does not read back here, so phones may not read it either."

**Out.** copy (a PNG on the clipboard), save PNG at 512, 1024, 2048 or 4096 pixels a side (PNG size), save SVG
(pictures inside it as data, the text it holds as its title). Names: `qr-`, the kind, and a word or two of
what it holds, in ASCII letters, digits and hyphens (`qr-link-example-com.png`, `qr-wifi-cafe-wi-fi.svg`).

**The reader.** A picture comes by Ctrl+V, a drop, choose a picture (Ctrl+O), or "paste a picture to read" in the code's
right-click menu; on a phone a plain paste. It is made gray (clear counted white), shrunk by whole steps to
at most 1400 pixels a side (2800 if nothing is found), and each pixel called dark or light against the mean
of its 8 by 8 block smoothed over 5 by 5 blocks (Otsu's single threshold if that finds nothing). Finders
are found by their 1:1:3:1:1 runs, checked down, across and along a diagonal; every three of about one
size that make a corner are tried. The perspective is guessed from the finders' module sizes along each
edge (`guessMap`), the version read from its own information from version 7, the alignment pattern looked
for within 4, then 9 modules, and, where none is found or for version 1, the fourth corner is searched
around the guess. Each module is read at its middle. A mirrored code is read turned back; light on dark is
read by turning the picture over. Each code found is outlined on the picture and laid out by its kind, with
copy beside each line and copy all; a link is shown as text and copied, never opened.

**The page.** It opens the way a mini or a project does (`layouts/Opened.astro`), as the cut-out does: the
site's name and the trail "tools / QR codes", a small label, its name, one line saying what it does, then one
box with a rule round it, built from the small tools' kit (`src/quire/core/bench.ts`, `quire-bench.css`). Its
way back is the list of tools (`/tools/`). In the box the code's square is on the left, the same size whatever
the version, with one line under it: what the code is (its version, size and error correction, and any note on
its colors or picture), then, after a small dot, whether it reads back; while reading a picture it says so, then
what was found. The code and its line stay in view while the longer column scrolls past them (at the top on a
phone, the square a third of the height, the column scrolling under it). The column, written as the Walker's is:
a small heading for each group, round dots for a choice of one, small pictures for a choice drawn as one (the
kit's `pictured`: drawn quietly in the muted ink, the one chosen in the accent with a short rule under it),
lines to type on, words in the accent to press, thin rules between, no boxed buttons, every label in lowercase,
names keeping their capitals (PNG, SVG, Wi-Fi, WPA).
The groups are make or read; what it holds (link or text, Wi-Fi, contact, email, phone, message, and the lines
of the one chosen under it); shape; corners; color (one color, gradient, rainbow, flag, with the colors, from and
to and the direction, or the flags under it); ground (white, the site's colors, clear, and a line for hex
digits); margin (less and more, in modules); picture (none, in the middle, as the code, then choose a picture,
its size or how it shows); error correction (low, medium, high, highest); PNG size; then copy, save PNG and save
SVG at the foot. What acts on a code is there from the start and faint until there is one. Read in place of make
has choose a picture (and on a phone, where there is no right-click and no keys, a plain paste), then each code
found as a group of its own, its kind for a heading, a row for each line with copy beside it, copy all, and its
version and error correction. Parts grow open and shut, make and read fade one into the other while the
column's room goes to the height of the one shown; the menu is the suite's, each line with a first capital as menus have, and grows from where
it was pressed. Before 16 November 2026 the page stood under the editor's top line with boxed buttons, boxed
fields and capitalized labels; the owner found the small tools unlike each other and unlike the rest of the
site, and chose this frame, the column, lowercase and the same words under headings, as the cut-out has.

Keys: 1 to 6 pick a kind, M and R make or read, arrows move within a row of choices, Ctrl+C copies, Ctrl+S
saves a PNG, Ctrl+Shift+S an SVG, Ctrl+O chooses a picture, Ctrl+V pastes one, the menu key or Shift+F10
opens the code's menu. Shift with a right-click leaves the browser's. Reduced motion turns the motion off.

**Nothing leaves the browser.** The page's test holds that it fetches nothing over the network.

## Measured

- The standard's worked example (01234567 at 1-M) comes out byte for byte, data and check bytes; HELLO
  WORLD at 1-Q gives the well-known 13 data bytes; the generator of 7 check bytes is Annex A's.
- Capacities at their bounds: 7089 digits, 4296 alphanumeric characters, 2953 bytes at 40-L, each one more
  refused; 41 digits at 1-L, 7 bytes and 10 alphanumeric characters at 1-H.
- All 160 versions and levels are made full and read back by the grid reader.
- qrencode (where installed, it is here): its codes for 8 texts at 4 levels all read here; ours match its
  module for module with the same mask whenever both write byte mode alone (at least 12 of the 32; 24 of 28
  in a wider trial). The masks chosen differ in some cases, as its penalty counts differently.
- zbarimg reads our codes at every level and up to version 40.
- Every family of style (26: six shapes, three corners, one color, a gradient, the rainbow, all six flags,
  a colored ground, clear, light on dark, a rainbow on dark, a margin of one, two pictures in the middle,
  two pictures in color as the code, two halftones) is drawn in Chromium at 4 and 12 pixels a module and
  read back by this reader; zbarimg reads each too, light on dark with its inverted test on, the halftone
  from 6 pixels a module (not at 4).
- The reader, on codes drawn and spoiled in code: versions 1 to 40 straight; turned to any of 10 angles;
  seen at an angle with one side 15, 30 and 40 percent shorter at versions 1, 5 and 12; blurred by three box
  blurs of radius 1 to 3 at 9 pixels a module; light on dark, mirrored, grainy (noise of 60 of 255); a 170
  pixel code in a 2400 by 1800 busy picture; four codes in one picture. A photograph made in code (a code on
  a textured table, tilted, shaded, blurred and grainy, saved as JPEG) is read.
- What defeats it, held as a test: modules of 1.5 pixels, a blur of radius 4 at 6 pixels a module, and a
  dark ground right up to the finders.

## Decided

- Kinds: a link or any text, Wi-Fi, a contact, an email, a phone call, a text message.
- It reads from a picture only, never the camera.
- Rich styling of many kinds, the pride flags' stripes among the colors; pictures are the person's own and
  nothing is generated.
- Both meanings of a picture in a code: in the middle, and as the code.
- Everything stays in the page.

## For her to confirm

- Latin-1 for text all in Latin-1, UTF-8 otherwise, and no ECI header (phones guess UTF-8 well; an ECI can
  confuse older readers).
- The level raised for free while the size holds, so a short link comes out at High or Highest.
- vCard lines end in CR LF as the standard says, and are not folded at 75 characters.
- `sms:` with `?body=`, not the older `SMSTO:`; the reader reads both.
- A flag's light stripes are deepened rather than refused, so the trans flag's white is drawn gray.
- The page's words, listed in the report that built it and in the one that brought it to the kit.

## Known weak spots

- The halftone needs about 6 pixels a module to be read by zbarimg; at 4 only this reader reads it.
- A picture in the middle may cover alignment patterns in the code's middle (from version 7). This reader
  uses only the one nearest the fourth corner; a reader that leans on the middle ones may struggle.
- One perspective map for the whole code: a large code on a curved surface or through a wide lens, which
  bends, is not followed.
- Codes of under two pixels a module, or blurred past half a module, are not read.
- Kanji mode is read but never written; Shift JIS text is written as UTF-8 bytes.
- The colored picture-as-code is read here and by zbarimg on drawn pictures; a busy photograph behind it,
  with small modules on dark and light patches alike, has not been tried on real phones.
- Tried in Chromium only, never on a real phone or with a real camera's photograph.

## How to run and test

```sh
bun test src/quire/qr   # the maker, the reader, the looks (in Chromium), the page (in Chromium)
```

The cross-checks with qrencode and zbarimg run where they are installed and say so where they are not.
