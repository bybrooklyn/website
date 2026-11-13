# bybrooklyn.dev

Charlotte's website. Astro and Bun, hosted on Cloudflare Pages. No analytics, hardly any JavaScript.

```sh
bun install
bun run dev      # http://localhost:4321, drafts included
bun run check    # astro check, the share pictures (pictures --check) and the lint
bun run lint     # the lint alone: scripts/lint.ts, the habits in STYLE.md
bun run build    # writes dist/
bun run test     # every test; build first, as some open the built site
bun run edit     # write and edit in the browser, then publish
bun run deploy          # check, build, deploy to bybrooklyn.dev
bun run deploy:preview  # the same, to the preview address
bun run deploy:drafts   # the whole site with drafts shown, to the drafts preview address (public)
```

Other scripts:

- `bun run pictures` makes the pictures shown when a page is shared (`bun run pictures post-<name>` for one). `bun run check` fails when one is missing or out of date.
- `bun run photos` adds the pictures waiting in `photos/` (it also runs before `dev` and `build`).
- `bun run langs` (the language bar) and `bun run projects` (facts from GitHub) read from GitHub and write `src/data/`.
- `bun run wasm` builds the walking mini's engine from the Rust in `walker/`, after changing it.
- `bun run preview` serves `dist/`; `bun run clean` removes `dist/` and `.astro/`; `bun run cf:login` and `cf:whoami` sign in to Cloudflare.
- By hand: `python3 scripts/fraunces-soft.py` then `python3 scripts/trim-fonts.py` after changing a font; `bun scripts/dictionary.ts` remakes mdQuire's dictionary; `bun scripts/dictation-check.ts` runs the real speech models on the built site.

TypeScript stays on 6.x until `astro check` accepts 7.

## Where things are

| | |
| --- | --- |
| Posts | `src/content/blog/` (`kitchen-sink.mdx` uses everything a post can) |
| Projects | `src/content/projects/` |
| About, setup | `src/content/pages/` |
| Resume | `src/content/resume/resume.mdx`; its PDF is printed from the page at build time |
| Photos | drop pictures in `photos/` and run `bun run photos`; they land in `public/photos/` (see `scripts/photos.ts`) |
| Intro, contact, nav | `src/data/site.ts` |
| Colors | `src/data/theme.ts` |
| Typefaces | `src/styles/fonts.css` |
| Demos | `src/demos/`; the engine they run on is `src/mote/` |

Anything marked `draft: true` is left out of production builds. The drafts preview is Cloudflare's address for the `drafts` branch: it is not linked from anywhere, but it is public, and anyone who has or guesses the address can read what is on it. A post with `.hold` in its file name is shown by `bun run dev` only: it is never committed, and every build leaves it out, the drafts build too.

## License

The code is under an MIT-style license with three added conditions; see `LICENSE.md`. Everything on the pages (writing, photographs, resume) is under CC BY-NC 4.0.

Headings are in Torrens Serif, my cut of [Fraunces](https://github.com/undercasetype/Fraunces) by Undercase Type; text is Fraunces; code is Drafting* Mono by Owen Earl. All three are under the SIL Open Font License (`src/assets/fonts/OFL-*.txt`).
