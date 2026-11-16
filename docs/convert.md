# Convert

A file converter for pictures, text and data, sounds and films, everything in the browser: the hidden page
`/convert/`, built in production and linked from nowhere, as `/qr/` is. It is a small tool of the Quire
suite, beside mdQuire, imgQuire and the QR page. Pictures go through imgQuire's own encoders; text through
mdQuire's Markdown reader and writer and readers and writers of its own; sounds and films through the
browser's own codecs (WebCodecs), with the containers read and written here. Nothing is uploaded. The only
files fetched are the site's own: the page, and imgQuire's encoders when a picture format is first used.

## Where the code is

`src/quire/convert/`, each file with a test beside it:

- `page.ts`: the page: where files arrive, the list, the bar of what is done with them all, the right-click
  menu and the keys. `parts.ts`: the panel's pieces (rows of choices, folds, number fields) and what a kind's
  side of the panel gives the page.
- `kinds.ts`: what a file is, from its first bytes before its name. `names.ts`: names (`photo (1).webp`),
  sizes, times and weights in plain words. `queue.ts`: a few at a time, each stoppable. `out.ts`: one zip
  made of the results' own blobs, or files written into a folder.
- Pictures: `pictures.ts` and `picture-side.ts`.
- Text and data: `text.ts`, `text-side.ts`, `markdown.ts`, `data.ts`, `errors.ts`, `csv.ts`, `yaml.ts`,
  `toml.ts`.
- Sounds: `audio.ts`, `audio-side.ts`, `wav.ts`, `flac.ts`, `md5.ts`, `ogg.ts`.
- Films: `video.ts`, `video-side.ts`, `resample.ts`.
- Containers: `bytes.ts` (a growing buffer, a file read a slice at a time), `tracks.ts` (tracks, samples,
  codec strings), `webm.ts`, `mp4.ts`.

`src/pages/convert.astro`, `src/scripts/convert.ts`, `src/styles/quire-convert.css`. The linter holds that
no kind of the suite imports another, so `src/scripts/convert.ts`, outside `src/quire/`, hands the page
imgQuire's encoders and metadata writer (`codec-run.ts`, `export.ts`, `metadata.ts`) and mdQuire's reader
and writer (`read.ts`, `write.ts`, `html.ts`). Nothing under `src/quire/img/` or `src/quire/md/` was changed.

## Built

**The page.** The list of files is the work, at the left; the choices for each kind have their own room
at the right, staying in view as the page scrolls. On a phone the list stays at the top with its own
scroll, and the choices run under it. Files arrive by a drop anywhere on the page, Ctrl+V, Choose files
(Ctrl+O), or Paste in the list's right-click menu; on a phone a Paste button. Text pasted (not a file)
becomes a file of its own, "Pasted text". Each file is a quiet row: its name; what it is ("JPEG picture",
"WAV sound, 44.1 kHz stereo, 3:25", "MP4 film, H.264 1920 × 1080, AAC sound, 0:42"); what it will become;
its size before and after ("3.4 MB to 412 KB, 88% smaller"); and how it is going ("Writing WebP 50%",
"Done", the name it leaves with). A thin bar under it fills only as steps are done: for a picture, the
reading and each run of the encoder; for a sound, each second written; for a film, the time of the last
picture written against its length. A row's own buttons keep their places: one that changes with the
state (Stop, Save, Try again), Copy for text, and the cross that removes it. A refusal that comes with
something that can be done shows that as a button on the row.

Convert (Ctrl+Enter) runs every file not yet done with the choices as they are. Pictures and sounds run
two at a time, films one, each kind in its own lane so a film does not hold up pictures. Stop all, Save
all as a zip (Ctrl+S), Save all into a folder (Ctrl+Shift+S, where the browser allows it; elsewhere the
button is dimmed and says why), Clear the list. Names are kept for the files in the list's order as they
are put in the queue, so two files named `photo` become `photo.webp` and `photo (1).webp` whichever
finishes first. The zip is stored, not squeezed (pictures, sounds and films are squeezed already), made of
the results' own blobs with small headers between, so a zip of films is not held in memory; only each
file's checksum is worked out, reading it through once. A folder keeps what is in it: a name there already
gets the next number in brackets. The line under the bar counts the files, those done and what they weigh
before and after.

The right-click menu on a row: Save, Copy (for text), Stop, Convert again or Try again, Remove; then
Paste and Choose files. Shift with a right-click leaves the browser's own menu. Delete removes the row
with the focus; the menu key or Shift+F10 opens the menu. Rows grow in from no height and shrink away;
folds in the panel open by growing; the menu is the suite's own and grows from where it was pressed.
Reduced motion turns the motion off.

**Pictures.** imgQuire's export with no editing, through its own encoders: JPEG (jpegli), WebP (libwebp),
AVIF (libaom), JPEG XL (libjxl), and lossless PNG (oxipng), WebP and JPEG XL; HEIC is read by imgQuire's
HEIC reader, anything else by the browser. The quality (5 to 100), or a weight to come in under, for which
imgQuire's own search finds the highest quality under it (nine runs of the encoder at most). The size: as
it came, a largest side in pixels, or a percent, never larger than it came. What goes with it of its
metadata, in imgQuire's words: None, No place, All (imgQuire's `blocksOut`, its Exif turned upright as the
pixels are). Pictures are read upright (`imageOrientation: "from-image"`), made smaller by the browser's
own high quality scaling, and written in sRGB with no colour profile. A moving GIF keeps its first frame
and says so.

**Text and data.** Markdown becomes HTML (a whole small page with its title) and HTML becomes Markdown,
through mdQuire's own reader and writer. What HTML is understood is said on the page under "What HTML is
understood": headings, paragraphs, line breaks, bulleted, numbered and checkbox lists, quotes, code blocks
with their language, tables with their alignment, dividers, links, pictures by address, and bold, italic,
underline, strikethrough and code, as elements or as styles. Left out: the head, scripts, styles, forms,
frames, embedded objects, canvases, SVG and MathML with everything inside them, and comments; any other
element with its text kept; classes, ids, colours, sizes, highlighting, superscript and subscript; links
and pictures whose addresses are not web, mail or relative ones; pictures held inside the page.

CSV, JSON, YAML and TOML into each other, each read and written by hand (JSON by the browser's own
`JSON.parse`, its faults found by a walker of our own to say the line). CSV: RFC 4180, quotes, doubled
quotes, line breaks inside fields, CR LF or LF, a byte order mark; the separator found (comma, semicolon,
tab or bar, whichever gives the most rows of one length) or chosen; the first row names or data; numbers
kept as text unless chosen otherwise; written with CR LF and quotes only where needed. YAML, the common
subset of 1.2: block mappings and lists, flow `[ ]` and `{ }`, plain, single-quoted and double-quoted
values with every escape, `|` and `>` blocks with their chomping, comments, `---` and `...`; values typed
by the core schema (only true and false are booleans; yes, no, on and off stay words). Refused, each with
its line and never guessed: anchors and aliases, tags, directives, more than one document, complex keys,
merge keys, a key given twice, tabs in indentation. TOML 1.0, all of it; dates are kept as text, as the
other formats have none, and said so. A shape one format cannot carry is refused in plain words with what
can be done: nested data into CSV (spread into columns named like `address.city`), a list into TOML (put
under the name `items`), an empty value into TOML (left out), a table holding a list into CSV (that list
as the rows), a first row with a name twice (read as data). Each offer is a button on the row that
converts that file again with it taken. A result can be copied as well as saved.

**Sounds.** Read whole by the browser's own decoder (`decodeAudioData`): whatever this browser reads (in
Chromium, as tried: WAV, FLAC, MP3, Ogg Vorbis and Opus, AAC in M4A, Opus in WebM). The rate it came at and its
channels are read from its own header first (WAV, AIFF, FLAC, Ogg, MP3, and the tracks of an M4A or WebM),
so that "As it came" keeps them. Written: WAV by hand (16 or 24 bits, or 32-bit float; extensible past two
channels or at 24 bits); FLAC by hand (16 or 24 bits; every frame chooses its stereo coding and each
channel's predictor, fixed or linear of order up to 12, with Rice coding; the MD5 of the samples written);
Opus in WebM or in Ogg and AAC in M4A by the browser's AudioEncoder where it has them. Rate (as it came,
48, 44.1, 32, 24, 16 kHz; Opus is always 48 kHz), channels (as it came, stereo, mono, by the browser's own
mixing), bitrate for Opus and AAC (64 to 256 kbps), bits for WAV and FLAC. Opus keeps its exact delay and
length: Ogg's granule positions count from the encoder's first sample and the last page is cut to the true
length; in WebM the timestamps are in half milliseconds, so that Opus's delay of 6.5 ms is not rounded by a
player, and the last block says the padding to drop. MP3 is read and never written: there is no MP3
encoder with a free licence, and browsers do not write MP3. The panel says so.

**Films.** MP4 (and MOV) and WebM (and MKV) read a slice at a time; the pictures through the browser's
VideoDecoder, made smaller by drawing if asked (as it came, 1080p, 720p, 480p, 360p, never larger), and
through its VideoEncoder: H.264 for MP4, VP9 or AV1 for WebM, a key frame every two seconds. Bitrate:
Auto (about a tenth of a bit for each pixel shown with H.264, two thirds of that with VP9 or AV1) or 8, 4,
2, 1, 0.5 Mbps. The sound is carried over untouched where the new file holds it (AAC or Opus into MP4,
Opus into WebM); otherwise it is decoded, mixed to stereo at most (5.1 by the usual weights), brought to
48 kHz for Opus by a resampler of our own, and encoded again: AAC for MP4 where this browser writes it,
Opus otherwise (and said so on the row). Each step waits for the one after it, so only a few pictures are
in memory at once, and what is made goes out as blobs: the MP4 writer gathers each sample's place and
length and puts the movie box first at the end; the WebM writer closes a cluster at a key frame after half
a second and puts its cues at the end. A film of only sound in an MP4 or WebM is passed to the sounds.

**What this browser cannot do is asked of it.** `AudioEncoder.isConfigSupported`, `VideoEncoder.isConfigSupported`
and `VideoDecoder.isConfigSupported` for each choice; a format it cannot write is dimmed with the reason
as its tooltip and a line in the panel ("This browser cannot write AAC, so it is not offered here."); a
film whose pictures it cannot read says so on its row ("This browser cannot read H.265 film.").

## Each format, read and written, and where it was proven

Proven in headless Chromium 157 on Linux (the one browser driven here), by the tests named.

| Format | Read | Written |
|---|---|---|
| JPEG, PNG, WebP, GIF, BMP, AVIF | the browser | JPEG, PNG, WebP, AVIF, JPEG XL by imgQuire's encoders (`page.test.ts`; imgQuire's own tests for each encoder) |
| HEIC | imgQuire's HEIC reader (`page.test.ts`) | no |
| JPEG XL | where the browser shows it | yes |
| Markdown, HTML | mdQuire (`markdown.test.ts`, `page.test.ts`) | yes |
| CSV, JSON, YAML, TOML | by hand (`csv`, `data`, `yaml`, `toml`, `text`, `page` tests) | yes |
| WAV | the browser | by hand, read back exactly (`wav.test.ts`, `audio.test.ts`) |
| FLAC | the browser | by hand, read back exactly by the browser and by the `flac` tool (`flac.test.ts`, `audio.test.ts`) |
| Opus in Ogg, in WebM | the browser | the browser's encoder, our containers (`ogg`, `webm`, `audio` tests) |
| AAC in M4A | the browser | where the browser encodes AAC (not Chromium on Linux: said so, `audio.test.ts`, `page.test.ts`) |
| MP3, Vorbis | the browser (MP3, AAC, Vorbis and FLAC files made by `ffmpeg` read in `audio.test.ts`) | no |
| AIFF | where the browser reads it; its header is read here (not tried in Chromium) | no |
| MP4 (H.264, with AAC or Opus) | our reader, the browser's decoders (`mp4.test.ts`, `video.test.ts`) | H.264 by the browser, our writer; played by the browser's own player (`video.test.ts`) |
| WebM (VP9, AV1, VP8, with Opus) | our reader, the browser's decoders | VP9 and AV1 by the browser, our writer; played by the browser's own player |
| MOV, MKV | our readers (MOV shares MP4's boxes, MKV WebM's); not tried on real files | no |

## Measured

- **Pictures.** Four pictures dropped, pasted and pasted from the menu, at a largest side of 256, come out
  as WebP with their own names (`photo.webp`, `photo (1).webp`) and sizes; the zip of them reads back with
  the suite's own zip reader, file for file; a 3000 × 2000 picture stopped while AVIF writes it stays
  stopped. A phone's HEIC photograph comes out at its 96 × 64.
- **FLAC**, against the `flac` tool at `-5`, ten seconds: a test sound 35% of the WAV (theirs 47%), chords
  at 44.1 kHz in 16 bits 54% (53.6%), at 48 kHz in 24 bits 69% (69%); written at 19 to 37 times real time
  on one core in Bun. Every frame passes `flac -t` (each CRC and the MD5), and both `flac -d` and
  Chromium's decoder give back the integers bit for bit, mono to six channels, 16 and 24 bits.
- **A sound made in code** (a sweep on the left, a tone on the right, three seconds at 48 kHz) written as
  WAV and FLAC comes back from Chromium's decoder sample for sample; as Opus at 128 kbps in WebM (50 KB) and
  in Ogg (49 KB), it comes back exactly 144,000 samples long, lined up to the sample, 38 dB above what
  differs. A rate changed to 44.1 kHz keeps the tone's pitch to within a cycle a second; stereo mixed to
  mono is the average.
- **A film made in code** (each picture showing its own number in black and white blocks, three seconds at
  30 a second, with an Opus tone), as MP4 with H.264 and as WebM with VP9: MP4 to WebM VP9 at 160 × 120 and
  0.3 Mbps (58 KB in 0.28 s), WebM to MP4 H.264 at 240 × 180 and 0.4 Mbps (59 KB), MP4 to WebM AV1 at 160 ×
  120 and 0.2 Mbps (51 KB): every one of the 90 pictures read back in order showing its own number, 3.02 s
  of sound, and the browser's own player opens each, says 3.02 s and the right size, and shows picture 45
  when sent to 1.5 s. A film made by `ffmpeg` in H.264 with pictures out of order and AAC at 44.1 kHz
  becomes WebM with all 90 pictures and its sound as Opus at 48 kHz.
- **Long films.** A film made by `ffmpeg` at 640 × 360, 30 a second, H.264 with AAC at 44.1 kHz, of one minute
  (12 MB) and of ten minutes (118 MB), to WebM VP9 with its sound as Opus: one minute in 10 s, ten minutes
  in 138 s (four times real time on four cores of a Ryzen 7 9700X), and the page's JavaScript memory at
  its highest 61 MB for the one and 53 MB for the other: it does not grow with the film's length.
- The resampler: a tone from 44.1 to 48 kHz within 0.003 of the true tone; one above the new half rate
  taken out (under 0.01); pieces of any size give the same as the whole, to a millionth.

## Decided

- All four kinds: pictures as a quick page, text and data, sounds, films.
- Many at once: one zip, or files written straight into a folder where the browser allows it; any one
  saved alone; each keeps its own name with the new ending, a second of one name numbered, nothing
  overwritten.
- Permissive licences only and nothing downloaded: sounds and films through the browser's own codecs, no
  encoder shipped; what a browser cannot encode is not offered there, and the page says so.
- MP3 is read and not written.

## For her to confirm

- The default for a picture's metadata is None, as imgQuire's export starts (the place goes with nothing
  else); No place and All are a press away.
- Pictures are written in sRGB with no colour profile: a Display P3 photograph is brought into sRGB by the
  browser as it is read. imgQuire keeps P3 with its profile; this page does not yet.
- Files wait for Convert, rather than converting as they arrive, so that choices can be changed first.
- The default sound format is FLAC, the default film MP4 with H.264, the default for data JSON.
- Where Chromium cannot write AAC, the sound of an MP4 that must be encoded again goes in as Opus (most
  players read Opus in MP4; some older ones do not), and the row says so.
- A 16-bit sample is turned to an integer with positive values scaled by 32767, as Chromium's decoder
  divides them, so that a 16-bit WAV or FLAC read by the browser is written back with exactly its integers.
- The zip is named `converted.zip`.
- The page's words, listed in the report that built it.

## Known weak spots

- Tried in headless Chromium on Linux only: never in Firefox or Safari, nor on a phone.
- A sound is read whole (`decodeAudioData`), so a sound file over 512 MB is refused, and a very long one
  takes its decoded size in memory. Films are read a slice at a time; only their sound when encoded again
  passes through memory piece by piece.
- Results are held as blobs until saved. Chromium keeps large blobs on disk, but a very long film's result
  still waits in the browser until it is saved.
- A zip over 4 GB is refused (zip64 is not written); a folder has no such limit.
- The MP4 writer writes no edit list and no composition offsets: the browser's encoders give pictures in
  order, so none are needed for what it writes, but a film's start is taken as its first picture, and AAC's
  priming samples at the start of an M4A are not marked.
- MP4 reading ignores edit lists, and takes a track's start from its first pictures' times.
- An HDR or 10-bit film is written in 8 bits. Rotation in a phone's film is not carried over.
- Subtitles, chapters and every track but the first picture track and first sound track are left out.
- A picture already in the encoder when it is stopped finishes there, out of sight, and is thrown away.
- FLAC is written on the page's own thread in steps of a second, so a long sound keeps the page busy,
  though it can still be stopped.
- YAML's numbers past 2 to the 53rd lose their last digits, and TOML's `2.0` comes back as `2`.
- `textKindOf` guesses a file with no ending from what it holds: a short `key: value` text is taken for YAML.

## How to run and test

```sh
bun test src/quire/convert   # everything, the Chromium tests included
```

The Chromium tests need a Chromium on the path; the cross-checks with `flac` and `ffmpeg` run where they
are installed and say so where they are not.
