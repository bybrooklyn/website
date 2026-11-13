# Publishing

How words and pictures get onto the site: writing in the browser, drafts, held posts, photos, share pictures,
and the deploy. The rules for what may go on the site are in `site.md` and `STYLE.md`.

## Where the code is

- `scripts/write.ts` and `scripts/editor/`: `bun run edit`.
- `scripts/photos.ts` and `scripts/exif.ts`: `bun run photos`.
- `scripts/pictures.ts`: the share pictures.
- `scripts/projects.ts` and `scripts/languages.ts`: project facts from GitHub and the language bar.
- `src/lib/drafts.ts`: what counts as a draft.

## Built

**Writing in the browser.** `bun run edit` starts a small server on this computer only and opens mdQuire
(`mdQuire.md`) on every post, page and project, the resume and the home page's intro, with the real page
beside the text. It saves as it goes. Its publish button builds, commits, pushes and deploys what changed,
after showing what is about to go live and asking. Options: `--dry-run` (go through publishing without
committing or deploying), `--no-open`, `--no-preview` (no dev server for the page beside the text),
`--port N` (default 4400).

**Drafts.** Anything with `draft: true` is left out of production builds and shown on the dev server.
`bun run deploy:drafts` builds the whole site with drafts shown and deploys it to a preview address only;
`bun run deploy:preview` deploys a normal build to the preview branch.

**Held posts.** A post named `*.hold.mdx` in `src/content/blog/` is shown on the dev server and never
committed (`.gitignore`). To publish it, take `.hold` out of its name.

**Photos.** Pictures go in `photos/` at the top of the repository (never committed); `bun run photos`
(also run before `dev` and `build`) saves each as an AVIF, upright and at most 2000 px on its long edge,
with a smaller copy for phones, keeping only the date it was taken and throwing away location, camera and
serial number. A caption is a text file of the same name beside it. Memes go in `photos/shitposts/`, a
friend's photographs in `photos/by-<name>/`, the setup page's screenshot in `photos/setup/`. To take a
photo off, delete its file from `public/photos/`.

**Share pictures.** `bun run pictures` makes the picture each page shows when its link is shared (the
site's card, a project's drawn cover, a post's title and date). `bun run check` fails if one is missing.

**Facts.** `bun run projects` brings stars, forks and the last push up to date from GitHub; `bun run langs`
remakes the language bar. After changing a font, `python3 scripts/trim-fonts.py`.

## Decided

- Deploying is by hand from the owner's computer and only when the owner says: `bun run deploy`, or the
  publish button of `bun run edit`. Nothing deploys by itself, and an agent working on a branch neither
  pushes nor deploys without the owner's word.
- The site stays files in git.

## Open

- When to deploy next: the live site is several days of work behind `main`.

## How to run and test

```sh
bun run edit --dry-run       # the whole publishing path, with no commit and no deploy
bun test scripts             # the editor server (scripts/editor/edit.test.ts)
```

## Known weak spots

- None recorded beyond `site.md`.
