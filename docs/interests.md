# The interests page

`/interests/` lists what the owner likes: games, movies, shows, music, and hobbies. It was asked for on
17 November 2026, together with renaming the about page to bio. It is a draft, and since 24 November it is
also hidden, as the owner chose: no build makes it, not even the dev server or a drafts build, and the menu
does not link to it, until the owner says so. Its words are still to be read by her before it goes out.

## Built twice

The first build, on 17 November, was a wall of covers that opened into a sheet of its own over the page,
with each maker's video framed from YouTube. The owner found that it did not fit the rest of the site,
and that the videos did not play. Both were true: every other list on the site is ruled rows, every
other thing opens in the site's panel, and YouTube was refusing the owner's connection (a wall asking
for a sign-in, which a frame from its no-cookie host can never pass; two of the videos were also
age-restricted, which no site may frame). The audit that followed is
[audit-pages-17-november.md](audit-pages-17-november.md).

The page was rebuilt the same night out of the site's own pieces. The lesson is kept: a new page is made
from the patterns the other pages share, and a pattern is only added when none of them fits.

## What the owner chose

All by the question tool, on 17 and 18 November 2026.

- The page is called interests. Its parts are games, movies, shows, music and hobbies, each under a small
  label as the home page's sections are, and the title has a line under it.
- The lists are rows as the projects are: a small cover, the name, one line of the owner's, and a small
  line saying what it is and when. A favorite comes first and says so in that line (Just Cause 3, The
  Boondocks); an honorable mention comes last (Raising Dion). Otherwise the order is the one the owner
  listed them in.
- A thing's page is laid out exactly as a project's page: the small line, the name, the one line, the
  cover with a line under it that plays the trailer, the links, the facts as the ruled table, then the
  owner's words under "Why I love it" and "My history with it".
- How a thing opens is not settled. The owner asked for both to be built: the site's own panel, and the
  sheet. Both are there (below) until one is chosen.
- The trailers are the owner's own copies, as first asked for, encoded as AV1 to be small, kept on the
  owner's computer and not in the repository. A browser that cannot play AV1 (Safari on older Apple
  devices) is told so.
- Music is heard from the artist's own player, not from a copy.
- Films and shows are to show their scores on Rotten Tomatoes, IMDb, Metacritic and Letterboxd.
- Music pages are to show a card for each song the owner named, what each samples, and whole albums track
  by track.
- Hobbies are a few plain paragraphs.
- The covers were downloaded with the owner's yes: Steam's library covers, posters from The Movie
  Database, album covers from Bandcamp, the Cover Art Archive and Deezer's catalog, Minecraft's poster
  from Microsoft's store, and the first episode's thumbnail for the Backrooms series.
- What may be said: the year of birth, the line about past and present loves, and that films and shows
  are streamed from a Jellyfin server. One thing the owner said in the interview is kept off the page.
- Kanye West's page carries one line of the owner's own about the man, and the records.
- MF DOOM's page states the facts of his death and nothing more.

## How it is made

- `src/content/interests/<name>.mdx` is one thing: its name, one-line summary, part, kind, year, order,
  rank, cover, the trailer's source and the facts in the head, and under them the owner's words, under the
  headings "Why I love it" and "My history with it". The second is left out where nothing has been said.
- `src/content/interests/parts/*.mdx` are the parts of the page: a title, the owner's few words for the
  part, and which kind of thing is listed under them.
- `src/pages/interests/[...index].astro` is the list, built from the projects list's own classes
  (`project-list`, `project-thumb`, `post-meta`), with a narrower column for a cover.
- `src/pages/interests/[slug].astro` is a thing's page, in the `Opened` layout with the post's header, the
  project's links row and facts table, the contents beside the words, and previous and next at the foot.
  The page-change script and the layout know `/interests/<name>/` as an opened page, so it opens and
  closes as a project does.
- `src/lib/interests.ts` holds the two switches, `HIDDEN` (built nowhere) and `DRAFT` (built only where drafts show), the small line (`metaOf`) and `videoOf`, which
  says whether a copy of a thing's trailer exists.

### The trailers

- A copy lives at `public/videos/interests/<name>.mp4`. Git ignores `public/videos/`: the files are other
  people's videos and stay out of the public repository. They are on the owner's computer only, and go to
  the live site with a deploy made from it. Where a file is missing, the page shows the cover and the
  line to press is faint and inert; the link to the original is always there.
- Each is 720p AV1 (SVT-AV1, quality 42, 10 bit) with Opus sound, and comes to roughly 5 MB a minute, so
  that every file is under the 25 MiB Cloudflare Pages allows. A 2 minute trailer that was 39.6 MB as
  fetched is 9 to 16 MB.
- Games' trailers come from Steam's own store pages (yt-dlp reads them). The rest come from YouTube, which
  from the owner's connection needs a signed-in session: the owner allowed yt-dlp to borrow Chromium's.
- The trailer is fetched only when the line under the cover, or the cover, is pressed. It plays in the
  browser's own player in the cover's place, and the box grows from the cover's size to the video's.
- The Backrooms web series has no trailer: its copy is the first ninety seconds of the first episode.

### The two ways to open, kept for comparing

- The site's panel is the page above. It is what a row links to.
- The sheet is `src/components/InterestSheet.astro`, run by `src/scripts/interests.ts`, and is used only
  when the list's address ends in `?sheet`. One `<dialog>` holds every thing's screen. To open, it is laid
  out at rest, then drawn scaled and moved so that its cover lies exactly on the row's cover, cut to that
  shape, and let go from there; closing runs backwards. The address changes as it opens and closes.
- Whichever the owner does not choose is to be removed: the component, the script and the second half of
  `interests.css` for the sheet; or, should the sheet win, it is to be dressed as the panel is.

## To add a thing

Put its cover in `src/assets/interests/`, and write `src/content/interests/<name>.mdx` like its
neighbours. For a trailer, give `video` what it is and where the original is, then make the copy with
yt-dlp and ffmpeg as the settings above say and put it in `public/videos/interests/`. The owner's words are
the owner's: ask, and write only what was said.

## Decided without the owner

- The Backrooms is two things: the film among the movies, the web series among the shows.
- gabemtnz and the album COMPUTER ANGELS are one thing.
- Which of Steam's trailers stands for each game (the release or launch trailer where there is one).
- Lupe Fiasco's piece is Mural, the song the owner named.
- A line at the foot of the list says the covers and trailers belong to their makers.
- The line under the title, and each thing's one line, are drafts made from the owner's answers.

## Still open

- Every word on the page is a draft made from the owner's answers, to be read and approved. Some lines
  are the owner's own words, some are the choices offered and ticked, joined into sentences.
- Panel or sheet.
- Scores, song cards and albums are being looked up and are not on the pages yet. Pluribus is to be added
  to the shows, and whether Half-Life 2 joins the games is to be asked.
- Thin pages, where the owner has given a reason and little history: most of the films and shows, and
  Lupe Fiasco, Michael Wyckoff, MF DOOM, Portal 2's soundtrack.
- Swearing is kept where the owner swore (Pronoun Palace, Portal 2 and its soundtrack); whether it stays
  is the owner's call.
- The link to Novean's repository will not open for visitors until the repository is public.
- A thing's page has no picture of its own for link previews.
