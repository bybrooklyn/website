# bybrooklyn.dev

My personal website. Originally forked from [darkuss/twoexem](https://darkuss.twoexem.com); the design is still theirs, the plumbing is not.

Built with [Astro](https://astro.build) and [Bun](https://bun.sh).

## Running it

```sh
bun install
bun run dev      # http://localhost:4321
bun run build    # -> dist/
bun run check    # type-check + validate post frontmatter
bun run preview  # serve the built site
```

There's a `justfile` wrapping the same commands (`just serve`, `just build`, `just check`) if you prefer.

## Layout

| path                  | what's in it                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `src/pages/`          | routes — `.md` for prose pages, `.astro` for pages with logic        |
| `src/content/blog/`   | blog posts (`.md`), schema enforced by `src/content.config.ts`       |
| `src/layouts/`        | `BaseLayout.astro`, the page shell                                   |
| `src/components/`     | `Nav.astro`, `Footer.astro`                                          |
| `src/data/`           | `site.ts` (title, email, nav) and `projects.ts` (the projects list)   |
| `src/styles/`         | CSS, bundled by Astro                                                |
| `public/`             | copied verbatim — fonts, favicon, `_headers`                         |

### Adding a project

Append to the `projects` array in `src/data/projects.ts`. It's typed, so `bun run check`
catches a bad `status` or a missing field.

### Adding a post

Drop a `.md` file in `src/content/blog/`. See `hello-world.md` for the frontmatter —
`title`, `description` and `published` are required. Posts with `draft: true` show up in
`bun run dev` but are excluded from the build and the RSS feed.

The blog isn't linked from the nav yet. Add `{ title: "blog", url: "/blog/" }` to the `nav`
array in `src/data/site.ts` once you've published a real post.

## Layout system

Pages are built on a two-column axis: a narrow mono **margin column** for metadata and
sidenotes, and a **prose column** held to a readable measure. The tokens live at the top of
`src/styles/main.css`:

```css
--margin-col: 16ch;   /* the margin gutter */
--gutter: 2.5ch;      /* space between margin and prose */
--measure: 68ch;      /* prose line length */
```

Put a sidenote in the margin from any markdown page with a plain `<aside>`:

```md
<aside>elsewhere</aside>

- email — [...](mailto:...)
```

It floats into the gutter and aligns with the block that follows it. Below `78ch` the whole
thing collapses to one column and asides become normal blocks.

Listings (projects, posts) use `.entries` / `.entry` / `.entry-meta` / `.entry-body`, which
pull back across the gutter so metadata sits in the margin column. Note that `.entries` is
deliberately excluded from the plain-prose list rules via `:not(.entries)` — `.page > ul`
outranks `.entries` on specificity and would otherwise override the grid with flex.

Chrome (nav, footer, metadata) is set in Aporetic Mono; prose is Aporetic sans. That split is
the core of the typographic idea — keep it.

## Fonts

The Aporetic `.woff2` files in `public/assets/fonts/` are **subset** to Latin plus punctuation,
arrows, box drawing and braille (~68 KB each, down from ~1.4 MB). If you need glyphs outside
that range, re-subset from the upstream release rather than dropping the full files back in:

```sh
uvx --from "fonttools[woff]" pyftsubset FONT.woff2 \
  --unicodes="U+0000-00FF,U+0100-017F,U+2000-206F,U+20A0-20BF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2500-257F,U+2580-259F,U+25A0-25FF,U+2600-26FF,U+2800-28FF" \
  --flavor=woff2 --output-file=FONT.woff2
```

## Deploying

Static output, so any host works. Cloudflare Pages:

- **Build command:** `bun run build`
- **Output directory:** `dist`
- **Environment:** set `BUN_VERSION` if you want to pin it

`public/_headers` sets long cache lifetimes on fonts and hashed assets; Netlify uses the same
format. `dist/404.html` is picked up automatically as the not-found page on both.

## License

Content and design are under CC-BY-SA 4.0. The original design was forked from Darkuss/twoexem —
see [/credits](https://bybrooklyn.dev/credits/).
