# Audit of the pages, 17 November 2026

Asked for after the new interests page was found not to fit the rest of the site: every place where a
page, or a part of a page, departs from the design language the other pages share. The tools and minis
measured against each other are in [audit-17-november.md](audit-17-november.md) and are not repeated
here; this file is about the pages and the site's frame. Nothing was changed. Each finding is a choice
for the owner, with two or three ways it could go.

## How it was done

- Every kind of page was opened in a headless browser from a dev server at 1288 by 828 and at 390 by
  800, and photographed window by window. The pictures are in `notes/audit-pages-pictures/`, a folder on
  the owner's computer that is not in the repository; the file named under each finding is there.
- On each page the shared things were read from computed styles and boxes: the title, the line under it,
  section headings, the gap from the head to the content, the widest line, list rows, links, how a
  pressable thing answers hover and the keyboard, the trail, and where the page ends.
- Sizes are in pixels at 1288 wide, where 1rem is 16.35 pixels, unless a phone is named. A small dark
  pill at the foot of every picture is the dev server's own toolbar, not part of the site.

## What the rest of the site shares, measured

| Thing | The rest of the site |
| --- | --- |
| Page title | `h1`, 69.5 (40 on a phone), weight 520, ink, lowercase on main pages; top at 134 on list pages |
| Line under it | `.lede`, 23.9, muted, at most 44rem (719) |
| Head to content | 55.6 (two lines) on list pages, 41.7 (a line and a half) on long pages and opened pages |
| Section heading on a list page | `.label`: 16.35, weight 600, muted, lowercase (home, blog years, a post's sources) |
| List row | a rule between rows, a picture of 16:10 shown whole (`object-fit: contain`), radius 10.2 (8.2 on the home page), 1 pixel border in the rule color, the name in the heading face at weight 520 and 24.5 to 34.3, the summary muted, a meta line of small muted words joined by dots |
| Hover on a row | the name and the picture's border take the accent; nothing else moves |
| Keyboard on a row | the site's ring: 2 pixels of accent, 3 off, corner 3.7 |
| A link in text | accent, underlined at 45 percent |
| Something opened from a list | the opened panel: the page slides left leaving a strip with a chevron, the panel comes in from the right with a rounded left edge, a trail at its top with the site's name and flags, a big `h1`, and "previous / next" at its foot |
| Facts about a thing | `dl.facts`: rows with a rule under each, the label muted in a column of its own beside the value |
| Where to get it | `.get`: lowercase links a little larger than the text, the first with an arrow |
| End of a main page | the footer, under a rule |

## The interests page

`/interests/` and its sheets, most visible first. Pictures: `interests-desk-0.png`, `interests-desk-1.png`,
`interests-phone-0.png`, `interests-phone-3.png`, `sheet-pressed-desk.png`, `sheet-end-desk.png`,
`sheet-pressed-phone.png`, `sheet-end-phone.png`, `flight-desk-60.png`, `tile-focus-desk.png`.

1. **A wall of posters where every other list is quiet rows.** Each other list leads with words: a name
   in the heading face, a muted line, a small picture beside them, and a rule between rows. Here the
   covers lead: 152 by 228 each (323 by 484 for a favorite, a third of the page's width), in full color,
   seven to a row with no rule and no line about each. In the first screen the covers fill most of the
   window (`interests-desk-0.png`), where on the projects page the pictures are 180 by 112 beside their
   words (`projects-desk-0.png`). Ways it could go: rows like the projects list, cover small on the left
   and a line about each; keep tiles but make them the size of the home page's pictures (122 wide) with a
   rule between rows of tiles; or keep the wall as the one page that is a gallery, and say so in its
   head.
2. **It opens a thing in a sheet of its own, not in the opened panel.** Posts, projects, minis, Spectrum,
   tone tags and the small tools all open in the panel that comes in from the right beside a strip
   (`post-desk-0.png`). A tile opens a box in the middle of the window, 981 by 772, with a corner of 16.4,
   over the page darkened to 88 percent (`sheet-pressed-desk.png`). It does grow from the tile and shrink
   back into it (`flight-desk-60.png`), which keeps the rule that what opens grows from where it was
   pressed, but no other page opens a page this way. Ways it could go: open each thing in the opened panel
   as a project is, each at its own address as now; keep the sheet and make the panel's look its own (the
   panel's ground, its rounded left edge, its trail with the site's name); or keep the sheet as it is and
   accept a second way of opening.
3. **It closes three ways at once, one of them a word no other page has.** The sheet's bar has a word
   "close" at its right in the accent and underlined; the opened panel has no such word and is left by the
   strip's chevron or the trail, and the picture viewer by its dots that become a cross. Ways it could go:
   drop "close" and rely on the trail, Escape and a press outside, as the panel relies on its trail; give
   the opened panel the same word; or keep it here only.
4. **Its trail looks unlike the other trail.** The opened panel's trail is the site's name and flags, then
   the list's name muted with no underline, then the page's name in ink (`post-desk-0.png`). The sheet's
   trail has no site name, and "interests" is drawn as a link in text, in the accent and underlined
   (`sheet-pressed-desk.png`). Ways it could go: draw it as the panel's trail is; or add the site's name
   and keep the rest.
5. **The thing's name is a smaller heading than a page title.** In the sheet the name is an `h2` of 42.5
   (30.4 on a phone); a post, project or mini opened in the panel has an `h1` of 69.5 (40 on a phone). It
   also has no line under it, where every opened page has a lede. Ways it could go: set it as an opened
   page's title, with a meta line above (the kind and the year, as a mini's "toy · 3D") and a lede under;
   or keep it smaller because the sheet is smaller.
6. **Its part headings are a third kind of section heading.** "games", "movies and shows", "music",
   "hobbies" are `h2` at 28.6 in ink; the home page's and the blog's section headings are `.label` at
   16.35, weight 600, muted. "movies" and "shows" under them are a fourth kind: 18.4, weight 400, muted.
   Ways it could go: make the four parts `.label` headings as the home page's are; or keep larger
   headings and make "movies" and "shows" labels.
7. **The names under the tiles are in the text's weight.** 18.4 at weight 400 (16.2 on a phone), where
   every other list sets its names in the heading face at weight 520 and 24.5 to 34.3. Ways it could go:
   heading weight at the home page's 24.5; heading weight at a smaller size kept for tiles; or as now.
8. **The covers are cropped.** Tiles fill a 2:3 or a square frame with `object-fit: cover`, so a cover of
   another shape loses its edges; projects and the home page keep the whole picture (`contain`), with a
   comment saying a picture is never cropped. Ways it could go: `contain` on the surface color, as the
   projects list does; or keep the crop, since the covers are nearly all 2:3 already.
9. **The facts are laid out unlike a project's facts.** A project's facts are rows with a rule under each
   and the label in a column beside the value (`project-desk-0.png`). The sheet stacks a muted label of
   14.7 over each value with no rules, under a heading "The facts" (`sheet-end-desk.png`). Ways it could
   go: use the same `dl.facts`; or keep the stacked form, which suits the narrow column beside the words.
10. **Labels and links that begin with a capital.** "The facts" is a label over a block, and the lowercase
    rule gives it a small letter (a post's matching label is "sources"). The links under the facts begin
    with capitals where they are not names: "Official site" (7 times), "Soundtrack on Bandcamp", "The
    soundtrack on Bandcamp", "The Movie Database (first film)". A project's links are lowercase ("get it on
    itch.io", "play the demo"), first with an arrow, and placed before the facts. Ways it could go:
    lowercase them and place them as a project's are; or lowercase only.
11. **Keyboard focus lights more here than elsewhere.** On a tile reached by the keyboard the cover's
    border and the name both take the accent, as well as the ring. On the projects list, the home page,
    the blog and the tools list only the ring shows; on the minis list the picture's border lights and
    lifts but the name does not (measured; `focus-interests.png`, `focus-projects.png`, `focus-minis.png`).
    The ring's corner is 3.7 round a cover whose corner is 10.2 (`tile-focus-desk.png`). See the general
    finding on hover and focus below.
12. **A blurred copy of the cover behind the cover.** The top of a sheet shows the cover in front of
    itself blurred by 1.75rem, brightened by half and saturated (`sheet-pressed-desk.png`). No other page
    has a blurred, glowing ground; it is the nearest thing to a glow outside a mini. Ways it could go: the
    cover alone on the surface color, as the projects' covers are shown; a flat band in the cover's main
    color, as a photograph waits in its main color; or keep the blur.
13. **On a phone the sheet keeps a margin and a corner.** The opened panel takes the whole screen on a
    phone, with no border and no corner. The sheet is 8 pixels in from each side with a corner of 16
    and a border (`sheet-pressed-phone.png`). Ways it could go: the whole screen, as the panel; or as now.
14. **No previous and next at the foot of a sheet.** Posts, projects and minis end with the one before and
    the one after; a sheet ends with its facts (`sheet-end-desk.png`). Ways it could go: previous and next
    within the part; or none, since the tiles are one press away.
15. **No line under the title.** Projects and minis have a lede; interests has none (as the blog, photos
    and tools have none). See the general finding on ledes below.
16. **The part's words run narrower than other first paragraphs.** 38rem (621) where a lede and the long
    pages run to 44rem (719). Small.

Consistent with the rest: the title's size and place (69.5 at 134, the same as every list page), the gap
from the head (55.6), the tiles' radius (10.2) and border (1 pixel in the rule color), hover (the cover's
border and the name take the accent), the shade behind the sheet (the viewer's own, 88 percent), the play
line (the Playmatter demo's), the sheet growing from the tile and shrinking back into it, the keyboard
going back to the tile after closing, the footer, and the credit line in the muted small type of a note.

## Everything else, most visible first

### 1. Four frames for a page

Where: the whole site. Main pages have the header with the menu and the footer. Opened pages have the
strip and the panel, a trail, and no footer (`post-desk-0.png`). mdQuire and imgQuire have a third frame:
the site's name and a slash and the tool's name in the heading face at 1.3em, a rule across the whole
window, no menu, no strip, no footer, and the content starting 211 from the left
(`frame-mdquire-desk.png`, `frame-imgquire-desk.png`). The interests sheet is a fourth. The earlier audit
noted only that the editors' trail leaves out "tools" (its item 21).

Ways it could go: open the two editors in the opened panel as Convert, QR codes and Cut-out are, with the
editor filling it; keep their frame and make its trail the panel's (small and muted, with "tools"); or
accept three frames, one for reading, one for opened pages, one for working.

### 2. Lists drawn five ways

Where: `/projects/`, the home page, `/blog/`, `/tools/`, `/minis/` (and the interests tiles above).

| List | Width | Rule | Picture | Name |
| --- | --- | --- | --- | --- |
| projects | 1175, two columns | above each row | 180 by 112, left | `h2` 32.5 |
| home, working on and minis | 1175 or half | above each row | 122 by 76, left | `h3` 24.5 |
| home, writing | half | above the first and under each row | none | `h3` 24.5, date muted at the right |
| blog | 850 | above the first and under each row | none | `h2` 34.3, date in the accent in a column of its own |
| tools | 850 | above the first and under each row | none | `h2` 24.5 (the home page's short row) |
| minis | 1175, two columns | none: each preview is a box | the mini running, 568 wide, above | `h2` 34.1, meta at the right of the name |

On the home page the two halves sit side by side and show it: the writing list ends with a rule under its
last row and the minis list does not (`home-desk-1.png`, `home-desk-2.png`). The blog and tools lists stop
at 850 while every other list runs to 1175 (`blog-desk-0.png`, `tools-desk-0.png`).

Ways it could go: one rule pattern for every list (a rule above each row and under the last, or above each
row only); one width for lists of words (850) and one for lists with pictures (1175), as now but said in
one place; or bring the minis list into rows as projects are, keeping its running previews.

### 3. The title sits 21 pixels lower on bio, setup and license

Where: `/bio/`, `/setup/`, `/license/`. On every other main page the title's top is at 134 (195.6 on a
phone); on these three it is at 154.9 (216 on a phone), because their title takes the post's margin of
three quarters of a line meant for a meta line above it, and these pages have none. Moving along the menu
from blog to bio, or from photos to setup, the title drops by 21. The gap from their head to the text is
also 41.7 where list pages have 55.6. Pictures: `bio-desk-0.png` against `blog-desk-0.png`.

Ways it could go: take the margin off the title when no meta line is above it, so every main page's title
is at 134; or keep the long pages' rhythm and accept the step.

### 4. The same on opened pages: tone tags and the Playmatter demo sit 28 higher

Where: `/tonetags/` and `/projects/playmatter/demo/`. On opened pages with a meta line (date, language,
kind) the title's top is at 141.4; tone tags has no meta line and its title is at 113.6, and the demo's
page is written the same way. Moving from Spectrum to tone tags the title jumps up. Picture:
`tonetags-desk-0.png` against `spectrum-desk-0.png`.

Ways it could go: give both a meta line (tone tags has one in the projects list: its language and status);
or keep the room of a meta line when there is none.

### 5. A trail that names the page differently from its title

Where: `/spectrum/`: the trail says "Spectrum", the title "Gender & Sexuality Spectrum". `/tonetags/`: the
trail and the tab say "Tone tags", the title "tone tags". Every other opened page's trail repeats its
title. Ways it could go: one name in both places, as the project's name (Spectrum, Tone tags); or the
trail follows the title.

### 6. Hover and the keyboard say "press me" three ways

Where: every list. Measured on the first row of each:

| List | Hover | Keyboard |
| --- | --- | --- |
| projects, home, blog, tools, previous and next | name and picture border take the accent | ring only |
| minis | name and border take the accent, the preview lifts 3.3 | ring, border lit and lifted, name stays ink |
| interests | name and border take the accent | ring, border and name lit |

The minis list is also the only one where something moves on hover. Pictures: `focus-*.png`.

Ways it could go: make the keyboard light the same things as hover on every list (the CSS of four lists
names `:hover` only); keep the keyboard to the ring alone everywhere; and either give every picture the
minis' lift or take it from the minis.

### 7. Section headings in four styles

Where: the home page and the blog's years use `.label` (16.35, weight 600, muted, lowercase). The resume
uses 16.35, weight 600, in the accent, with a rule under, and capitalized ("Experience", "Skills",
`resume-desk-0.png`). Tone tags uses 16.35 at weight 520, muted ("the ones you will see most"). Interests
uses 28.6 in ink (above). The Dice mini's panel has a fifth, noted in the earlier audit (its item 8).

Ways it could go: one label style for every small heading over a section, lowercase; or keep the resume's
as its own because it is also printed.

### 8. Some list pages have a line under the title and some do not

Where: projects ("Things I've made...") and minis have a lede; blog, photos, tools and interests have none;
bio, setup, license and the 404 page have one. The gap from the title to the list is the same either way,
so on the four without one the list starts 64 higher (`projects-desk-0.png` against `blog-desk-0.png`).

Ways it could go: a lede on every list page (the words would be the owner's to write); none on any list
page; or as now.

### 9. Icons in the frame

Where: the strip's chevron on every opened page, the arrow of the button back to the top, the viewer's
three dots that become a cross, and the triangle before a folded contents list on a phone. The rule is
words, not icons; these are the frame's own and were not part of the earlier audit, which looked at the
toolbars. Pictures: `post-desk-0.png` (chevron), `home-desk-1.png` (arrow).

Ways it could go: words in their place ("back", "top", "more", "close"); keep these few as the frame's
marks and hold the rule for controls; or keep the strip's chevron alone, since the strip has no room for a
word.

### 10. Dates in two colors, drafts said two ways

Where: a post's date is in the accent on the blog list and on the post itself, and muted on the home
page's writing rows (`blog-desk-0.png`, `home-desk-1.png`). A draft is marked "Draft." in the accent at the
end of its summary on the home page, and "draft" as a muted meta word on the blog list and the post.

Ways it could go: one color for a date everywhere; one way to mark a draft.

### 11. The photos page is centered and its picture has no border

Where: `/photos/`. Everything else starts at the left edge (49); the photograph, its title, its date and
"another" are centered (`photos-desk-0.png`). Every other picture on the site has a 1 pixel border in the
rule color; the photograph has none (radius 10.2, as the rest). The chosen set ("photos" or "shitposts")
is marked by a 2 pixel accent underline, a fifth mark of the chosen beside the four the earlier audit
counted.

Ways it could go: keep it centered, as the one page that is a single picture, and give it the border; move
it to the left edge with the rest; and mark the chosen set with the site's dot.

### 12. Two page titles that are not their menu word

Where: `/setup/` is titled "how my setup works" and `/resume/` "Charlotte Halmstad" at 49 (32 on a
phone) with capitals; every other main page's title is its menu word (bio, interests, blog, projects,
minis, photos). The resume is also printed, which may be why.

Ways it could go: title both by their menu word and move the longer words into the lede; or keep them.

### 13. The 404 page

Where: the page for an address that does not exist. Its title "not found." is the only title with a full
stop; it has no page head around the title and lede, and its way on is a lone "back home" where the home
page's links on read "all posts →" (`notfound-desk-0.png`). The site's notes keep a page with falling
blocks waiting for it.

Ways it could go: "not found" with no stop, in a page head like the others; add the arrow; or leave it
until the falling blocks are built.

### 14. Picture corners in four sizes

Where: 10.2 for list pictures, photos and tiles; 8.2 for the home page's small pictures; 20.4 for a post's
or project's cover (`project-desk-0.png`); 16.4 for the interests sheet and 8.2 for the cover inside it.
Small, and seen only side by side.

Ways it could go: one corner for every picture, the panel's own larger corner kept for boxes that hold a
page; or as now.

## What the owner decided, and what is done

Asked by the question tool on 18 November 2026. The questions stopped after the eighth, at the owner's
word; items 9 to 14 are not decided.

| Item | Decided | State |
| --- | --- | --- |
| 1. The editors' frame | Keep their frame; their top line becomes the panel's own, small and muted, with "tools" | Not done: it changes mdQuire's bar, and wants its own tests |
| 2. List rules | A rule above each row only | Done: the blog list, the tools list and the home page's writing no longer end on a rule |
| 3. The title 21 lower on bio, setup, license | The same height everywhere | Done: every main page's title is at 134 |
| 4. Opened pages with no small line | Keep the room when there is no line | Done: tone tags and the Playmatter demo sit at 141.4 with the rest |
| 5. Names | The project's name in both places | Done for tone tags (its title is "Tone tags"). Not done for Spectrum: its title is translated into every language it speaks, so the change is to be shown first |
| 6. Hover and the keyboard | The keyboard lights what the mouse lights; nothing lifts | Done on every list; the minis' previews no longer lift |
| 7. Small headings | One label; the resume keeps its own | Done: tone tags uses the site's label |
| 8. A line under the title | Leave it | Nothing to do |

The interests page was rebuilt on the site's own pieces the same night ([interests.md](interests.md)), and
is to be looked at again with the owner.

## Checked and found consistent

- The header, its menu and its current page in the accent on every main page; the footer under a rule on
  every main page; no page scrolls sideways at either size.
- The title's size, weight and face on every page (69.5, or 40 on a phone, weight 520), but for the resume
  and the interests sheet.
- The opened panel's frame on posts, projects, minis, Spectrum, tone tags, QR codes and Convert: the same
  strip, trail place, title place (but for the two above), lede and gap.
- Links in text, the "all posts →" links, the play line on the Playmatter demo and the interests sheets.
- The ring for the keyboard: the same on every row, link and button measured.
- The shade behind the viewer and behind the sheet.
- Lowercase in the menu, page titles, labels and buttons, but for the places named above.

## Not checked

- The picture viewer was read from its code and its shade measured, not opened by a press in this audit.
- The sheet's video was not played: the headless browser is asked by YouTube to sign in.
- Sizes other than 1288 and 390, and browsers other than Chromium.
- Large covers on the interests page load only when scrolled to; one picture was taken before the
  favorite of the shows had arrived (`interests-phone-3.png`), so how a cover waits was not judged.
- The resume's printed form.
