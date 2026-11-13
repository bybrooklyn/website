# Spectrum

A page at `/spectrum/`: nine sliders for where someone is on the gender and sexuality spectrum, and a link
that carries every value. Nothing is stored; the values live in the address. It is a rewrite, for this site,
of Andrea Vos's Spectrum, which was a SvelteKit app, and it opens like a project from the projects page.

## Where the code is

- `src/pages/spectrum.astro`: the page. `src/scripts/spectrum.ts`: reads `?c=` (the values) and `?l=` (the
  language), sets the sliders and keeps the address in step. `src/styles/spectrum.css`: its look.
- `src/spectrum/`: the logic, each file with a test: `axes.ts` (the sliders), `code.ts` (share codes),
  `languages.ts` (the words in every language), `slider.ts` (how a slider moves).
- `src/spectrum/LICENSE.md`: where it comes from and what was changed.
- `src/content/projects/spectrum.mdx`: its project entry.

## Built

- Nine sliders, each with seventeen positions where the original has nine. The slider moves smoothly and
  settles on the nearest position; keys move it too.
- The original's eleven sliders less two, "Kink role" and "Sexual exploration", taken out in every language.
- Words in English, Polish, German, Portuguese and Arabic (right to left), with the translators' credits.
- Share codes of eight characters. The original app's seven-character codes still open, at the same places
  and without the two sliders taken out; an older six-character form opens too.
- No words under the sliders.

## Decided

- It is a rewrite in the site's own code and design, credited to the original under the Opinionated Queer
  License v1.1, and not endorsed by its author.
- The two sliders above stay out.

## Open

- Where the credit the license asks for is shown to a visitor. It was moved from under the sliders to a row
  of the license page, and then that row was taken off; today it is in the source (`src/spectrum/LICENSE.md`
  and file comments) only.

## How to run and test

```sh
bun run dev                  # /spectrum/
bun test src/spectrum        # sliders, codes, languages, movement
```

## Known weak spots

- The credit, above.
