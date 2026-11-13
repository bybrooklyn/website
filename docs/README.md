# Docs

Notes on each part of the site: what it is, where its code is, what is built, what is decided, what is
open, how to run and test it, and its known weak spots.

## The files

- [site.md](site.md): the site itself, its pages, the rules for what goes on them, caching and deploying.
- [publishing.md](publishing.md): writing in the browser, drafts, held posts, photos and share pictures.
- [mdQuire.md](mdQuire.md): the Markdown word processor at `/mdquire/`, also behind `bun run edit`.
- [imgQuire.md](imgQuire.md): an image editor to sit beside mdQuire; nothing built.
- [cutout.md](cutout.md): a background remover, a page of its own and a tool of imgQuire; nothing built.
- [mote.md](mote.md): the small engine the minis run on, with no third-party libraries.
- [minis.md](minis.md): the minis page and the small minis (Blocks, Dice, Plinko) and the terminal player.
- [walker.md](walker.md): the Walker mini and its Rust engine.
- [generalist.md](generalist.md): the generalist, a creature that sees and learns, and its long plan.
- [comet.md](comet.md): Comet, an aim-and-fling gravity game, a draft.
- [spectrum.md](spectrum.md): Spectrum, the sliders for gender and sexuality, rewritten for the site.
- [tonetags.md](tonetags.md): the tone tags page.
- `AUDIT.md`: an audit of the whole site, to be added.

## How the docs are kept

- **At the top of the repository:** `README.md` (how to run the site, where things are),
  [`CHANGELOG.md`](../CHANGELOG.md) (what changed, by day: the history) and [`TODO.md`](../TODO.md) (everything
  still to do, by project). `STYLE.md` there says how code and words are written; these docs follow it.
- **Everything else is here,** one file per project, all in the same shape.
- **Decisions and open questions live in the project's own file.** A decision is written as what was
  decided, in plain words; a question still to settle is written as a question under Open. When a question
  is settled, it moves from Open to Decided, and when a decision is built, it moves to Built.
- **History lives in `CHANGELOG.md`,** made from the git history, so a project's file says what is true
  now and leaves the story to the changelog.
- **What is still to do lives in `TODO.md`,** one line an item, drawn from the Open sections here.
- The docs are documentation: no quotations of people and no accounts of conversations. Reference material
  that belongs beside code stays there (`walker/README.md`, `src/mote/README.md`,
  `src/quire/dictation/MODELS.md`, `design/`).
