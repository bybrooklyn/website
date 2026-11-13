# Tone tags

A page at `/tonetags/` that says what tone tags mean: the short marks after a message, behind a slash, that
say how it is meant (`/j` for a joke, `/srs` for serious). It opens like a project from the projects page.

## Where the code is

- `src/pages/tonetags.astro`: the page. `src/scripts/tonetags.ts`: the search and copying.
- `src/tonetags/tags.ts`: the list of tags (77 entries, each with every way it is written, what it means,
  and the words it is found by) and the search; `tags.test.ts` beside it.
- `src/content/projects/tone-tags.mdx`: its project entry.

## Built

- The everyday tags in a strip, then all of them from A to Z in tight columns.
- A search by a tag's letters or by what is meant ("not angry at you"), on a small dictionary written by
  hand: each typed word is brought to its stem and matched against each tag's own words. No model and
  nothing to download. Tags that do not answer fold away; the closest come first.
- Pressing a tag copies it; `/` goes to the search; a tag named after `#` in the address is lit.

## Decided

- Tags for sexual intent are left out, as the site leaves that subject out.
- No copy button for the page's link, no language badge, and no explanation above the list.

## Open

Nothing recorded.

## How to run and test

```sh
bun run dev                          # /tonetags/
bun test src/tonetags                # the list and the search
```

## Known weak spots

- Not yet checked by eye at phone width.
