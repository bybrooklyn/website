# How this site's code is written

For anyone adding to it, a person or an agent. `bun run lint` checks what can be checked.

## The code

- **Plain names.** `drop`, `landed`, `shown`, `place`: a word a reader already knows, not an
  abbreviation and not a pattern's name.
- **A file opens by saying what it is**, in a few lines, and how it is used if that is not plain.
- **Comments say why**, or what cannot be seen from the line. They are sentences in plain words.
  No dash used as punctuation, no emoji, no sales words.
- **No new libraries.** `src/mote/` and `src/quire/` import nothing from outside their own folders.
  What is needed is written, with a test that measures the thing it is for.
- **Logic has tests** beside it (`thing.ts`, `thing.test.ts`), which say in their names what is
  held true. `bun run test` runs them.
- **Four spaces, double quotes, semicolons, long lines allowed.** Match the file you are in.
- **Data files keep one record to a line** (`writeJson` in `scripts/lib.ts`).
- **Styles use the site's tokens** (`src/styles/tokens.css`, colors from `src/data/theme.ts`).
  Motion is quick to start and slow to settle (`--ease`), and is switched off under
  `prefers-reduced-motion`.
- **Nothing simply appears.** A button or a menu that is not always there grows in and shrinks
  away; it is never switched on and off with `hidden` or `display`.
- **What moves, flows.** A thing that opens grows from where it was pressed and goes back there,
  as the picture viewer's menu does (`src/styles/viewer.css`).

Three files to read first: `src/mote/stage.ts`, `src/minis/board.ts` with `board.test.ts`, and
`src/scripts/viewer.ts`.

## The words a visitor reads

Her pages are in her voice and are hers to write. Text written for her is plain and short and is
shown to her before it goes in. Nothing is said about her life that she did not say.

## Git

- Plain git. Commit messages say what changed and why, in the style of `git log`.
- No co-author line and no mention of an agent or a model in a commit.
- `password.md` is never committed.
- Nothing is deployed, and nothing is pushed by an agent working on a branch, without her word.

## What never goes on the site

Her old name. IP addresses, host names, ports other than 80 and 443, user names and tokens. Her
private email address. Pictures made by a model. Sexual or political pictures. Projects she has
taken off the site.
