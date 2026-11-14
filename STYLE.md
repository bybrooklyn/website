# How this site's code is written

For anyone adding to it, a person or an agent. `bun run lint` checks what can be checked.

## The code

- **Plain names.** `drop`, `landed`, `shown`, `place`: a word a reader already knows, not an
  abbreviation and not a pattern's name.
- **A file opens by saying what it is**, in a few lines, and how it is used if that is not plain.
  In `src/quire/` every exported thing also has a sentence above it.
- **Comments say why**, or what cannot be seen from the line. They are sentences in plain words.
  No dash used as punctuation, no emoji, no sales words.
- **No new libraries.** `src/mote/` and `src/quire/` import nothing from outside their own folders.
  What is needed is written, with a test that measures the thing it is for. Two exceptions: their
  tests may import from elsewhere, and dictation (`src/quire/md/dictation/`, and only there) runs its
  speech models on ONNX Runtime (`onnxruntime-web`), the one library she chose not to rewrite.
- **Logic has tests** beside it (`thing.ts`, `thing.test.ts`), which say in their names what is
  held true. `bun run test` runs them. The linter holds Mote, mdQuire and the minis' engines to
  this; a file that only wires a browser feature (a worker, an audio worklet) is tested in the browser.
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
shown to her before it goes in. Nothing is said about her life that she did not say. `bun run lint`
reads posts and pages (but not her about page) for dashes used as punctuation, emoji, the
keep-out words and a "not just X" turn of phrase.

## Git

- Plain git. Commit messages say what changed and why, in the style of `git log`.
- No co-author line and no mention of an agent or a model in a commit.
- `password.md` is never committed.
- Nothing is deployed, and nothing is pushed by an agent working on a branch, without her word.

## What never goes on the site

Her old name. IP addresses, host names, ports other than 80 and 443, user names and tokens. Her
private email address. Pictures made by a model. Sexual or political pictures. Projects she has
taken off the site.

`bun run lint` fails on an IP address, a Tailscale host name or a host and port (`name:NNNN`) in
any file git tracks, but for the few allowed in `SAFE` in `scripts/lint.ts`: this computer's own
address, `localhost` ports in scripts, tests and these two files, and two things in the Terraria
project that only look like addresses.
