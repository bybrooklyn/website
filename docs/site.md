# The site

bybrooklyn.dev itself: a static site built with Astro and Bun and hosted on Cloudflare Pages, with no
analytics, no accounts and hardly any JavaScript outside the minis and tools. This file covers the pages,
the rules for what goes on them, the policies sent with them, and deploying. Writing and publishing posts is
in `publishing.md`.

## Where the code is

`README.md` at the top has the table of where each kind of content lives. Beyond it:

- `src/pages/`: every route. `src/components/`: the pieces pages are made of. `src/lib/`: the helpers
  behind them (posts, projects, photos, share pictures, drafts).
- `src/styles/`: the styles, with `tokens.css` and the colours of `src/data/theme.ts`.
- `astro.config.ts`: the build, including the page policy (content security policy) written into each page.
- `public/_headers`: the headers Cloudflare sends, including caching.
- `integrations/`: build steps of the site's own: printing the resume's PDF, checking the page policy
  allows every inline script and style, failing on a link to a private repository, pruning generated files
  nothing uses (so a draft's cover is never put online).

## Built

- **The home page**: an intro, Playmatter's clip, playable in place.
- **About, setup and the license page** (`src/content/pages/`). The license page says each license in
  plain words; the footer's license link opens it.
- **The resume**, with its PDF printed from the page at build time so the two cannot drift apart.
- **Posts** with numbered sources, a timeline stepped through by scrolling, and RSS.
- **Projects**, with facts brought up to date from GitHub (`bun run projects`) and covers drawn in code for
  projects with no picture. Some open a page of their own: Spectrum, tone tags, mdQuire.
- **Photos**: shown one at a time over blurred previews; the order is shuffled and the shuffle remembered;
  a missing picture is skipped. A friend's photographs are credited to him. Memes and screenshots are shown
  under their own heading.
- **Minis** (`minis.md`).
- **On every page**: the picture viewer with its menu, link previews, a share picture, page changes that
  animate (in Firefox too), and Back returning to where a post was opened from. The footer links the commit
  the live site was built from.

## Decided

**The site stays static.** No accounts, no likes, no guestbook, no code on a server.

**What never goes on the site** is listed in `STYLE.md`. Among it: IP addresses, host names, ports other
than 80 and 443, user names and tokens; the owner's private email address; pictures made by a model; sexual
or political pictures; projects that have been taken off the site.

**Photos.** No sexual or political pictures. Nothing that points at where the owner lives. No AI-made
images. Queer memes are welcome among the memes. Pictures are stripped of everything the camera wrote
except the date (`scripts/photos.ts`); originals stay on the owner's computer and are never committed.

**The setup page** shows no addresses, host names, ports other than 80 and 443, provider or user names.

**The owner's pages are in the owner's voice** and are the owner's to write. Text written for them is plain
and short and is shown to the owner before it goes in. Nothing is said about the owner's life that the
owner did not say.

**LinkedIn** is mentioned on the about page only; the resume leaves it out.

**Deploying is done by hand, only when the owner says.** `bun run deploy` checks, builds and deploys from
the owner's computer; nothing deploys by itself. It refuses to run from a branch other than `main` or with
changes not committed (`scripts/guard.ts`), so that what is live is what is committed. `bun run edit` has a publish button
that does the same after showing what is about to go live and asking.

**Caching** (`public/_headers`): built files a year (their names carry a hash); photographs a week;
ONNX Runtime's files, the clip and poster, and the minis' WebAssembly a day, then checked again; the
resume's PDF an hour.

**Every interface moves the way the rest of the site does**: what opens grows from where it was pressed and
goes back there, and nothing simply appears (`STYLE.md`).

## Open

- **Photo caching.** A week made removed pictures linger in visitors' browsers after they were taken off. Proposed: a shorter time for `/photos/*`. Not decided.
- **Captions for photos.** Waiting.
- **The 404 page** with blocks that fall (`minis.md`). Waiting.
- **A public wiki** about the owner's projects and licensing, in the owner's words. Waiting.
- **Accent colours from the two flags** the site already shows, quiet enough to be noticed only on a look,
  optional and modular.
- **More of the owner in the words and pages.** The owner's to write.
- **A small project like pronouns.cc**, kept very simple.
- **More queer memes** among the memes on the photos page.
- **Three details on the resume**, still open.
- **One set of controls.** A single set of buttons, sliders, switches and fields, shown on an unlisted
  `/controls/` page, was made and kept in the git tag `controls-archive`; nothing on `main` uses it.
  Whether to adopt it is open.
- **An audit of the whole site** for bugs and consistency, including Mote's API and anything that does not
  move the way the site does. It is being written as `docs/AUDIT.md`.

## How to run and test

```sh
bun run dev # the dev server, drafts included
bun run check      # astro check, the share pictures, and the lint
bun run test       # every test under src and scripts
bun run build      # dist/, with the resume PDF printed and the policy checked
```

## Known weak spots

- The resume's PDF needs a Chromium on the machine that builds; it has not been checked by eye since the
  last changes.
- TypeScript stays on 6.x until `astro check` accepts 7.
- The page policy allows `blob:` for pictures and for reading them back, for mdQuire; it applies to every
  page.
