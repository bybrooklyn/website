# bybrooklyn.dev

Charlotte's personal homepage: a short introduction, a Playmatter section with one gameplay image, and contact links.
Built with Astro and Bun. Static HTML and CSS, with no client-side JavaScript or analytics.

## Development

```sh
bun install
bun run dev
bun run check
bun run build
bun run preview
```

TypeScript stays on the latest 6.x release because `astro check` does not support TypeScript 7.0.

The homepage is in `src/pages/index.astro`, contact details in `src/data/site.ts`,
and shared styles in `src/styles/main.css`. The gameplay still is stored locally
at `public/assets/playmatter.webp`; it came from the Playmatter site's `02-tower` poster.

The homepage and custom 404 page share the same layout. The former projects,
blog, credits, and privacy URLs redirect home through Cloudflare Pages' `public/_redirects` file.
The starter blog and RSS feed have been removed.

## Hosting

The existing Cloudflare Pages setup uses `bun run build` and the `dist` output directory.
`just deploy` checks, builds, and deploys; `just deploy-preview` deploys to a preview branch.
Neither is needed to work on the site locally. Redirects are applied by Cloudflare Pages,
not Astro's local preview server.

## Credits

Originally forked from [Darkuss/twoexem](https://darkuss.twoexem.com), credited under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). See `LICENSE` for the
existing license. The current layout is inspired by Charlotte's [Playmatter site](https://playmatter.io);
the gameplay image is from Playmatter.
