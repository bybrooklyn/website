# The interests page

`/interests/` lists what the owner likes: games, movies and shows, music, and hobbies. It was asked for
on 17 November 2026, together with renaming the about page to bio. It is a draft: no ordinary build
makes it, and the menu does not link to it, until the owner has read every word on it.

## What the owner chose

All by the question tool on 17 November 2026.

- The page is called interests, and has four parts: games, movies and shows, music, hobbies.
- Games, films, shows and music are tiles: the cover, and the name in words under it.
- A favorite's tile is twice the size and first in its row, with the word favorite under the name
  (Just Cause 3, The Boondocks). An honorable mention is last, with those words (Raising Dion).
- The tiles go in the order the owner listed them in.
- A tile pressed swells into a sheet over the page and shrinks back into the tile when closed. Each
  sheet has an address of its own.
- A sheet holds a video at the top, then why the owner loves the thing, the owner's history with it,
  and the facts.
- The video is the maker's own, played from YouTube only when pressed. Nothing is stored on the site.
  Six of the videos are not on the maker's own channel (press uploads and people close to the maker);
  the owner said to use them, and the sheet names the channel each plays from.
- Hobbies are a few plain paragraphs, with no tiles and no sheets.
- The covers were downloaded with the owner's yes: Steam's library covers, posters from The Movie
  Database, album covers from Bandcamp, the Cover Art Archive and Deezer's catalog, Minecraft's poster
  from Microsoft's store, and the first episode's thumbnail for the Backrooms series.
- What may be said: the year of birth, the line about past and present loves, and that films and shows
  are streamed from a Jellyfin server. One thing the owner said in the interview is kept off the page.
- Kanye West's sheet carries one line of the owner's own about the man, and the records.
- MF DOOM's sheet states the facts of his death and nothing more.

## How it is made

- `src/content/interests/<name>.mdx` is one thing: its name, part, order, rank, cover, video and facts
  in the head, and under them the owner's words, under the headings "Why I love it" and "My history
  with it". The second heading is left out where the owner has not said anything yet.
- `src/content/interests/parts/*.mdx` are the four parts of the page: a title, the owner's words for
  the part, and which kinds of thing are tiled under them.
- `src/pages/interests/[...item].astro` builds `/interests/` and one address for each thing. Every
  address is the same page; a thing's own address has its sheet open before any script runs, so a
  sheet can be linked, and read with scripts off.
- `src/scripts/interests.ts` opens and closes the sheet. The sheet is one `<dialog>` holding every
  screen, with only the open one shown. To open, it is laid out at rest, then drawn scaled and moved
  so that its cover lies exactly on the tile's cover, and cut to the tile's shape, and let go from
  there. Closing runs backwards to wherever the tile is. With less motion asked for it fades.
- The address changes as sheets open and close (`history.pushState`), and Back and Forward follow it.
  A link from one sheet to another changes the screen in place. Close always returns to the list:
  each step taken from the list is counted in the history entry, and close goes back that many.
- The video is a frame from `www.youtube-nocookie.com`, made on press and removed on close. The page
  policy in `astro.config.ts` allows that host to be framed. The frame is told the site's name and no
  more of the address, since YouTube refuses to play for a page that says nothing of where it is.
- `src/lib/interests.ts` holds the draft switch (`DRAFT`). While it is true the page is built only on
  the dev server and in a build with `SHOW_DRAFTS=1`, and the header leaves its link out.

## To add a thing

Put its cover in `src/assets/interests/`, and write `src/content/interests/<name>.mdx` like its
neighbours. The video's `id` is the eleven letters after `watch?v=` in its address. `what` finishes the
sentence "Loads …" and `from` finishes "It plays from …". The owner's words are the owner's: ask, and
write only what was said.

## Decided without the owner

- The Backrooms is two tiles: the film among the movies, the web series among the shows, placed first
  after the favorite.
- gabemtnz and the album COMPUTER ANGELS are one tile.
- Before the video is pressed, the top of a sheet shows the cover in front of a blurred copy of itself,
  not a still from the video. Stills would be 42 more downloads.
- Each video is named in plain words (the launch trailer, a song's name), not by its uploader's title.
- Lupe Fiasco's video is Mural, the song the owner named, not the single the research had picked.
- A line at the foot of the page says the covers belong to their makers.

## Still open

- Every word on the page is a draft made from the owner's answers, to be read and approved. Some lines
  are the owner's own words, some are the choices offered and ticked, joined into sentences.
- Thin sheets, where the owner has given a reason and no history, or little of either: Substrate:
  Emergence, Buckshot Roulette, Boneworks, Minecraft, Terraria, Portal, Portal 2, most of the films and
  shows, and Lupe Fiasco, Michael Wyckoff, MF DOOM, Portal 2's soundtrack.
- Swearing is kept where the owner swore (Pronoun Palace, Portal 2 and its soundtrack); whether it
  stays is the owner's call.
- The link to Novean's repository will not open for visitors until the repository is public.
- The videos were not watched playing: the headless browser used for testing is asked by YouTube to
  sign in. The frame's address and its loading on press were checked.
- A sheet's own address is not given a picture of its own for link previews.
