# bybrooklyn.dev

Charlotte's website: a homepage, a blog and a list of projects. Built with Astro and Bun, hosted on Cloudflare Pages. No analytics, and very little JavaScript: the direction of the page transition, the place marker in a page's contents, the email link in the footer, and any demo a post brings with it.

## Working on it

```sh
bun install
bun run dev        # http://localhost:4321, drafts included
bun run check      # types and post frontmatter
bun run build      # writes dist/
bun run preview
bun run langs      # recount the language bar (needs a logged-in `gh`)
bun run resume:pdf # print the resume to PDF
bun run projects   # refresh project facts from GitHub
bun run blog       # write a post and publish it
bun run edit       # edit any text on the site
```

TypeScript stays on 6.x: `astro check` does not accept TypeScript 7 yet.

## Writing and editing from the terminal

```sh
bun run blog   # start a post or carry on with a draft, then publish
bun run edit   # change any text: the intro, about, setup, resume, a project, a post
```

Both open the file in your editor (`$VISUAL`, then `$EDITOR`, then Neovim, VS Code or nano). When you close it, the script checks the site still builds, shows what would go live and what is still a draft, and asks before it commits, pushes and deploys to Cloudflare Pages. Add `--dry-run` to stop before the commit and the deploy.

## Version control

The repo is a git repo with [jujutsu](https://jj-vcs.github.io/jj/) set up alongside it (`jj git init --colocate`), so either tool works. With jj: `jj st`, `jj commit -m "..."`, `jj bookmark set main -r @-`, `jj git push`. Deleting the `.jj` folder goes back to plain git.

## Writing a post

Add an `.mdx` (or `.md`) file to `src/content/blog/`. The file name is the URL.

```mdx
---
title: Wiring machines
date: 2026-11-10
summary: One sentence for the index and the feed.
accent: pink
cover: ../../assets/covers/wiring.png
coverAlt: What the picture shows.
tags: [playmatter, rust]
draft: true
---
```

- `accent` is optional and changes the color of links and marks on that post: `violet` (the default), `pink`, `blue`, `mint` or `amber`. They are defined in `src/data/theme.ts`.
- `cover` is optional: a picture in `src/assets/` for the top of the post and the blog list. It needs `coverAlt`.
- `tags` is optional.
- `draft: true` keeps a post out of production builds and the feed.
- `##` and `###` headings become the post's table of contents.
- `Figure` is in `src/components/`. Import it at the top of the post.
- A post can hold demos and embeds; see "Demos and embeds" below.

`src/content/blog/kitchen-sink.mdx` is a draft that uses everything.

## How pages open

Home, about, blog, projects, setup and resume are main pages (`src/layouts/Base.astro`). A single post or project opens over the site (`src/layouts/Opened.astro`): the site slides away to a strip on the left that leads back, and the page sits in a lighter panel beside it. The movement is in `src/styles/motion.css`; a few lines of script in `src/layouts/Document.astro` tell it which way to go.

## Demos and embeds

A post or project page can hold interactive things.

- **A frame from elsewhere** (a game on itch.io, a pen, a page of your own):

  ```mdx
  import Embed from "../../components/Embed.astro";

  <Embed src="https://example.com/thing" title="What it is" ratio="4 / 3" caption="Optional line underneath." />
  ```

  It loads lazily and is sandboxed: it can run its own scripts and nothing else unless you pass `allow` (for example `allow="fullscreen"`) or extra `sandbox` tokens.

- **A demo of your own**: write a custom element in `src/demos/` and an `.astro` wrapper that imports it in a `<script>`, as `DropBox.astro` and `drop-box.ts` do. Only pages that use the wrapper load its script. `DropBox` is a pile of blocks you can stack and throw, running on `physics.ts`, a small engine written for this site, and `TypeTester` lets visitors try a typeface.

## Setup and about

`/setup/` and `/about/` are long-form pages in `src/content/pages/` (`title`, `summary`, `kicker`, `draft`), rendered by `src/pages/[page].astro` with numbered chapters and contents in the margin. A draft page is not built, and its nav link stays hidden.

## Projects

Each project is an `.mdx` file in `src/content/projects/`: `name`, `summary`, `language`, `status`, `repo`, an optional `link`, `cover` with `coverAlt`, a `gallery` of screenshots, and `order`. The body is the project's page. Images live in `src/assets/projects/`.

`bun run projects` reads each repository's license, stars and latest release through `gh` and writes `src/data/project-facts.json`, which is committed.

## Resume

One resume, written in `src/content/resume/resume.mdx` and served at `/resume/`. The name and contact line come from `src/data/site.ts`.

The web page is the full resume. Anything inside `<Web>...</Web>` is left out of the PDF.

`bun run resume:pdf` prints it to a one-page PDF with the Chromium on this machine, and fails if it runs onto a second page. While the resume is marked `draft: true` the PDF goes to `resume-preview/` (ignored by git) and the page is not built into the site; once published it goes to `public/resume/`, which is committed. Run it again after editing.

## Where things are

| | |
| --- | --- |
| Colors (dark only) | `src/data/theme.ts` |
| Typefaces | `src/styles/fonts.css` (the only place they are named) |
| Projects | `src/content/projects/` |
| Language bar | `scripts/languages.ts` writes `src/data/languages.json` |
| About text, contact details, nav | `src/data/site.ts` |

## Deploying

Cloudflare Pages runs `bun run build` and serves `dist/`. `just deploy` checks, builds and deploys by hand; `just deploy-preview` deploys a preview named after the current branch. `public/_redirects` is applied by Cloudflare, not by the local preview server.

## License

The code is under the MIT license; see `LICENSE`. That covers the site's layouts, components, styles and scripts.

My writing, the about page, the resume, my name, pictures of me and the Playmatter media are not part of it and are not licensed for reuse. If you fork this, replace them with your own.

The `LICENSE` file ends with a few requests: don't pretend to be me, don't suggest I endorse what you make, don't put words in my mouth, and don't use this to hurt people. They are requests, not conditions.

Headings are set in Torrens Serif, my cut of [Fraunces](https://github.com/undercasetype/Fraunces) by Undercase Type (Phaedra Charles and Flavia Zimbardi), and text in Fraunces itself; code is in Drafting* Mono by Owen Earl. All three are under the SIL Open Font License (`src/assets/fonts/OFL-*.txt`). The complete fonts are in `src/assets/fonts/full/`; pages load trimmed copies (Latin, weights 400 to 700) that `scripts/trim-fonts.py` makes from them.

This repository began as a fork of another site and was later rewritten from scratch.
