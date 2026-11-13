# bybrooklyn.dev

Charlotte's website. Astro and Bun, hosted on Cloudflare Pages. No analytics, hardly any JavaScript.

```sh
bun install
bun run dev      # http://localhost:4321, drafts included
bun run check
bun run build    # writes dist/
bun run edit     # write and edit in the browser, then publish
bun run deploy   # check, build, deploy
bun run deploy:drafts   # the whole site with drafts shown, to a preview address only
```

Other scripts: `langs` (language bar), `projects` (facts from GitHub), and `python3 scripts/trim-fonts.py` after changing a font. TypeScript stays on 6.x until `astro check` accepts 7.

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

Anything marked `draft: true` is left out of production builds.

## Docs

Each project's notes (what is built, what is decided, what is open) are in [`docs/`](docs/README.md). What changed, by day, is in [`CHANGELOG.md`](CHANGELOG.md), and what is still to do in [`TODO.md`](TODO.md).

## License

The code is under an MIT-style license with three added conditions; see `LICENSE.md`. Everything on the pages (writing, photographs, resume) is under CC BY-NC 4.0.

Headings are in Torrens Serif, my cut of [Fraunces](https://github.com/undercasetype/Fraunces) by Undercase Type; text is Fraunces; code is Drafting* Mono by Owen Earl. All three are under the SIL Open Font License (`src/assets/fonts/OFL-*.txt`).
