# A background remover

A page that takes the background out of a picture, as remove.bg does, free and with nothing in the way. It
has no name yet; "cutout" is only this file's name. It is to be a page of its own and one of imgQuire's
tools (`imgQuire.md`).

## Where the code is

Nowhere yet. Nothing is built.

## Built

Nothing.

## Decided

- It is free and has nothing in the way of the work.
- It is a page of its own and also a tool inside imgQuire, built once as one piece used in both places.

- Beyond drop, cut out and copy: a brush to fix what it got wrong (keep, remove); a new background (clear,
  a colour, a blur of the old one, another picture, a flag); many pictures at once, as a zip; a click to
  choose which subject is kept when there are several.
- A model that picks out what is in a picture is allowed; the candidates are in
  [imgQuire-models](imgQuire-models.md).

## Open

- **What "nothing in the way" rules out.** Proposed: no account, no limit on how many pictures, no
  watermark, no smaller picture unless paid for, no upload to a server, no wait. So: drop or paste a
  picture, the cut-out appears, copy it or save it as a PNG at full size. Nothing leaves the browser,
  which is also what keeps it free to run: the site stays static and there is no server to pay for.
- **How it would work.** Proposed: a segmentation model fetched into the browser once and run there, as
  mdQuire's dictation does, on ONNX Runtime, the one library already allowed. Such a model picks out what
  is already in the picture and invents nothing, which differs from making images. To confirm: that this
  sits on the right side of the site's rule against AI-made images.
- **Which model, and its licence.** Some of the good ones are free only for non-commercial use; to settle
  whether the site counts as that.
- **Download size.** Models run from about 5 MB to 170 MB, with better edges costing more. How big is
  acceptable.
- **The rest:** how well hair and fur edges must come out; many pictures at once; a brush to fix what it
  got wrong (keep, remove); a new background (clear, a colour, a blur of the old one, another picture); the
  picture's full size or a limit; phones.

## How to run and test

Not yet applicable.

## Known weak spots

None yet, as nothing is built.
