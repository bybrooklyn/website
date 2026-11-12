# mdQuire's writing screen: an audit, three mock-ups, and a lab

For choosing before anything is built. Nothing in `src/quire/` or `src/styles/quire.css` was changed.

- The lab: `/mdquire-lab/` (src/pages/mdquire-lab.astro, design/mdquire/lab.ts and lab.css).
- The mock-ups: `/mdquire-lab/a.html`, `b.html`, `c.html` (design/mdquire/a.html and so on; each also opens from the disk).
- Pictures of each at 2560, 1765, 1300 and 390 wide, and one sheet per width with the three side by side, were made in a scratch folder; they are not in the repository.

Sizes below are in rem and px. The site's rem grows with the window: 16px at 390 wide, 16.4px at 1300, 18.26px at 1765, 18.88px from about 2000 up.

## How real writing tools lay out the writing screen

Web editors were loaded in headless Chromium at 1440x900 and 1920x1080 (some at 390x844) and measured with the page's own boxes and styles. Desktop apps come from official help pages, theme files and support threads. **M** = measured live, **R** = read (sources below), **I** = inferred or common knowledge not verified here.

Not measurable: Google Docs (every public link went to sign-in, so its numbers are R or I); public HackMD and HedgeDoc notes (404 or a landing page); the CKEditor and Tiptap marketing demos (cross-origin frames, so their docs and template pages were used); Craft (no layout docs found).

| Tool | Page or column | Ground and edge | Body text | Menus and toolbar | Status, outline, comments | Dark mode |
| --- | --- | --- | --- | --- | --- | --- |
| Google Docs, pages | US Letter, 816px at 100%, 1in margins, a 624px text column, centred (I) | White page on a pale grey-blue ground, thin shadow, square corners (I); the 2023 redesign made the toolbar a pill and gave bar and ground one colour (R) | 11pt Arial (I) | Title row, menus beside it, a pill toolbar of about 40px below (I) | Outline in a left panel, comments in the right margin, zoom in the toolbar (I) | Web: none (I). Android: the page goes dark, with a "view in light theme" switch (R) |
| Google Docs, pageless | No page. Column narrow, medium or wide (View, Text width), reflowing with the window, chosen per viewer (R) | The same ground; the column is not a sheet (I) | The same | The same | No headers or footers (R) | The same |
| Word | A page on a canvas (I) | | | Ribbon; Focus hides it, hovering the top brings it back (R) | Word count and zoom in a bottom status bar (I) | The Black theme makes the page itself dark; Switch Modes turns it white (R) |
| Apple Pages | A page on a canvas (I) | The page stays white in macOS Dark Mode (R) | | | | Light page on dark chrome (R) |
| LibreOffice Writer | A page on a grey canvas (I) | White page in dark mode unless colours are changed; the bug asking for a dark page is open (R) | | Menu bar and toolbar, 2 to 3 rows (I) | Bottom status bar (I) | Light page by default (R) |
| CKEditor 5 document editor | Page 680px at 1440, 882 at 1920, 300 at 390, fluid in its frame, centred with equal gutters; padding 1cm top, 2cm sides (M) | White on #f7f7f7, 1px #c9d1dc border, shadow 0 0 5px 10% black, 4px corners, 24px below the toolbar (M) | 16px on 25.6px, Helvetica; text 527px at 1440, 729 at 1920 (M) | One 40px toolbar, groups split by thin rules (M) | None | None on its docs site (M) |
| TinyMCE full demo | No page; the body fills the frame with 16px margins, 539px of text at 1440 (M) | White inside a 10px-cornered, 2px-bordered demo frame (M) | 16px on 22.4px (M) | Menu row 39px and toolbar row 39px: 88px (M) | Sidebar at right (M) | Not tested |
| Tiptap simple editor | Pageless. Column 648px with 48px padding, 552px of text, centred at both sizes; edge to edge at 390 (M) | White everywhere, no edge (M) | 16px on 25.6px, DM Sans (M) | One 44px row across the window, groups split by thin rules, centred; at 390 it moves to the bottom (M) | Search and theme at the row's right end (M) | The whole canvas #0e0e11, text #f5f5f5, column unchanged, no page (M) |
| Notion, public page | 720px column, at x=360 in 1440 and x=600 in 1920: centred whatever the window (M) | White, no edge (M) | About 16px on 24px (M, from a picture) | 44px top bar (M) | Title an h1 of about 40px inside the column, icon above (M) | Not measured |
| Lexical playground | Card up to 1128px, a 1036px text column (M) | White card on #eee, 10px top corners (M) | 16px on 27.2px (M) | One 48px row (M) | Debug tree under it (M) | No change under dark (M) |
| ProseMirror example | 720px box, centred (M) | 2px border, 4px corners (M) | 16px on 19.2px (M) | One 28px menu bar (M) | None | A code example, not an app |
| StackEdit | Editor and preview 50/50; editor text at the left, 25px in, 707px at 1440 (M) | White editor, grey preview (M) | 18px on 30px, Lato (M) | Dark 44px row: tools left, file name right (M) | 20px status bar at the bottom: bytes, words, line and column (M) | Not tested |
| Dillinger | 270px sidebar, then editor and preview (M) | White and #fafbfc (M) | 16px on 24px; preview 14px Georgia (M) | Dark 56px bar (M) | | Not tested |
| Typora (GitHub theme) | Column 860px, 1024 from 1400px windows, 1200 from 1800, centred, 30px padding (R) | No page, no edge (R) | 16px on 1.6 (R) | The system's menus, no toolbar (I) | | Dark themes darken everything (I) |
| Obsidian | Readable line length: 700px, centred (R) | No page | | Tabs and a title row (I) | Outline in a sidebar, status bottom right (I) | Whole canvas dark (I) |
| iA Writer | Line length 64, 72 or 80 characters (R) | No page | | Very little chrome (I) | | Light or dark canvas, no page (R) |
| Bear | Line width in em steps; the widest is about 1040px (R, forum) | No page | | | | Canvas dark (I) |
| Ulysses | Line width set in characters (R) | No page | | | Typewriter mode in View (R) | Canvas dark (I) |

Sources: support.google.com/docs/answer/11528737 (pages and pageless); support.google.com/docs/answer/9955476 and gsuiteupdates.googleblog.com/2020/07 (Docs dark theme); 9to5google.com/2023/03/06 (Docs redesign); techcommunity.microsoft.com "Try dark mode in Word"; support.microsoft.com "Bring focus to your words"; discussions.apple.com/thread/253044463 (Pages); libreoffice.org bug 153334 and itsfoss.com/libreoffice-dark-mode; typora-default-themes github.css and support.typora.io/Width-of-Writing-Area; forum.obsidian.md (line width 700px); ia.net/writer/support/basics/settings; community.bear.app (line width); help.ulysses.app (editor customization). Measured live: playground.lexical.dev, prosemirror.net/examples/basic, the CKEditor 5 document editor example, the TinyMCE full featured demo, template.tiptap.dev simple template, stackedit.io/app, dillinger.io, a public notion.site page.

### What the well-loved tools share

1. **The text column is about 550 to 720px, whatever the window.** Tiptap 552, Notion 720, Obsidian 700, Docs 624 inside its page, iA 64 to 80 characters. On a wider window the gutters grow, not the lines. (Typora alone widens, in steps.)
2. **The column or the page is centred, with equal gutters.** Only split editors put text at the left, and only because a preview fills the other half.
3. **Pageless or a real page, never between.** Pageless has no edge at all: the text sits on the same ground as the bar. A page is 800 to 880px, plainly different from its ground, with square corners (or 4px at most), a soft shadow or a fine line, 12 to 24px under the toolbar.
4. **The toolbar runs the full width, 40 to 48px, its groups split by thin rules.** Menus get a line of their own only in the big tools, and then beside the title (Docs).
5. **Status lives at an edge:** a bottom bar, or a corner of the top row. The outline is at the left, comments at the right of the page.
6. **The title is the first thing in the column, large,** not a separate box.
7. **In dark mode,** pageless tools darken everything and keep the column; page tools darken the page itself (Word, Docs on Android) or keep a light page (Pages, LibreOffice). None shows a faintly tinted sheet on a nearly identical ground.
8. **Rounded frames round the editor belong to demos** embedded in marketing pages (Lexical 10px, TinyMCE 10px). That is the widget look.

### Why each of mdQuire's three attempts read as wrong

1. **The rounded card** ("it feels very empty and incomplete"). A rounded box round the text is the demo widget's look: a component sitting on a page, so the window round it reads as unused. It was neither pageless (which has no edge) nor a page (square, full sized, on a contrasting ground), and it lacked what makes a screen feel whole: a bar across the window, the title inside the column, status at an edge.
2. **The A4 sheet** ("not rounded", "far less rounded and wider", "i really dont like the placement or look of the paper"). Its width was right (794px against Docs' 816) but it did not read as paper: a barely lighter purple with a thin outline reads as one more panel, and real sheets stand out from their ground by a clear step and a shadow. It sat in a site column under a bar that did not line up with it, so it looked placed rather than centred. And at real size it never grew: on a 1765 or 2560 window a 794px sheet looks small.
3. **The full-width slab with the text at its left** ("looks WORSE"). It broke the one rule every tool keeps: a centred column of 550 to 720px. Text hugging the left of a window-wide slab looks like a bare text box, with a dead field to its right; and the slab's edge to edge ground gave the eye nothing to rest the page on.

B answers all three: no rounded frame; a sheet a clear step up (`--panel-raised` on `--ground`, with a lighter edge and a shadow); centred under a row that is centred on the same axis; growing with the window (943px at 1765, 1049 at 2560) but never a slab.

## The top row, and why it changed

What she said: the top bar "is close and looks good, it just needs further polish"; "merge file edit into the thing so scrolling down everything looks intentional and not fragmented AND IT NEEDS TO BE ALIGNED AND CENTRED RIGHT. the "charlotte." right now isnt".

What was wrong, measured on `/mdquire/` at 1765 wide:

- The menu words float in a line of their own above the bar, held there by `position: absolute`. They are not part of the bar's box, so nothing lines them up with anything.
- The name's middle sits 6px above the bar's middle (name 39 to 70, bar 52 to 89), and well below the menu words. It belongs to neither line.
- The bar ends 16px short of the column's right edge, and the rule under the row ends at the scrollbar.
- On scrolling, the name's line goes up out of sight and the bar stays, so the row breaks in two.

What the lab does instead:

- **One grid, two lines, one column.** Columns: the name, then everything else, then the status. Lines: 2.3rem for the menu words, 2.6rem for the bar. Padding 0.45rem above and 0.4rem below. About 106px tall at 1765, near Google Docs' two-line header.
- **The name spans both lines and sits in their middle.** Measured: the name's middle and the piece's middle differ by 0.5px.
- **Everything starts on one edge.** "File" and the document's name begin at the same x; each control gives back its inner space (0.5rem) at the row's edge, so the letters line up, not the boxes. On the right, "Saved · 7 words" and the microphone end on the same x.
- **Centred on the window.** The row is the site's column (72rem and the gutters), centred; the text below is centred on the same axis. At 1765: column 218 to 1532, text 528 to 1222, both centred on 875.
- **The whole row stays when scrolled,** on the ground, with one rule under the full width. Nothing in it moves or hides.
- **The name:** "mdQuire" in the heading face, leading to the shelf; "by" small, italic and muted; "charlotte" exactly as the site's name; the flags after it. On one line when there is room. When the row is under 76rem (16px rem, so about 1216px) the name stands on two lines, "mdQuire" over "by charlotte" and the flags, still in the middle of the two lines. At 390 it wraps the same way and the status sits beside it.
- **The bar:** document name, Paragraph, then B I U S and link, then lists, + and the Text button, then undo, redo and find, each group parted by a 1px rule with 0.4rem each side; the three dots and the microphone at the right end. Buttons are 2.1rem square with 0.5rem corners: far less round than the 1.05rem pills she has now.
- **At 390:** the name and status on the first line, the menu words on the second, the bar on the third. The bar slides sideways under a finger; the dots and microphone stay pinned at its end. No sideways scroll of the page at any width.

## The menus: the button becomes the menu

How the picture viewer does it (`viewer.ts`, `viewer.css`), and why it feels good: one box grows from the dots' own circle to the menu's size; only its width, height and corners move, so nothing inside is stretched; what is inside is pinned to the corner it grows from, so the words are still while the edge sweeps over them; it springs a little past its size on opening and draws back plainly on closing; the lines arrive one after another, 45ms apart.

The lab does the same for every menu, by one piece of code:

- A box is laid over the pressed control at exactly its place, size, corners, ground and edge. Then its edges move out to the menu's place. What is inside is laid out where it will end and held there while the edges pass over it, so nothing slides or stretches.
- The control's label is drawn again in the same place and stays as the menu's title. The three dots run together into a cross, which closes the menu.
- Closing runs back and ends exactly on the control.
- A menu opens upward when there is more room above, and leftward when there is no room to the right (the zoom at the lower right does both). A submenu grows out of its line, to the right or, without room, to the left.
- Along the row of words, an open menu slides to the next word when the pointer reaches it, and becomes its menu, without closing.
- Keys: arrows move through lines; a letter jumps to the next line starting with it; Right opens a submenu or slides to the next word; Left closes a submenu or slides back; Escape closes the innermost menu and gives focus back; Tab goes round the open menu and nowhere else. A press anywhere outside closes all of it; so does scrolling the page.
- Under reduced motion every menu is simply open or shut.

Checked in headless Chromium:

| Check | Result |
| --- | --- |
| Frames while a menu opens | 16 frames in 250ms, the longest gap 16.8ms: 60 a second, at 1765 and at 390 |
| Anything outside the menu moving | Nothing: 0 of every control and paragraph on the page moved |
| First frame against the control | The same box to 0.01px for all six kinds; the same pixels for five, the sixth (zoom) within 1/255 at its corners |
| Last closing frame | The same box to 0.01px for all six |
| Sideways scroll | None at 2560, 1765, 1300 or 390, with every menu opened in turn |
| Reduced motion | Open at full size at once, every line shown |

Starting values (tunable in the lab, "Copy these settings" writes them out): open 200ms on a spring with bounce 0.14; close 140ms on the site's `--ease`, no bounce; lines one after another, 14ms apart, starting at a fifth of the opening; corners of an open menu 10px; the label stays as the title; the Outline look.

Three looks are shown side by side on the lab page:

- **Outline:** `--surface` ground, a 1px line of `--rule` with 32% accent. Closest to what she has; reads as part of the bar.
- **Raised:** `--panel-raised` ground, no line, a soft dark shadow (no glow). Floats most clearly over text.
- **Quiet:** `--ground` itself, a 1px line of ink at 30%. The flattest.

## The three mock-ups

All three use the lab's top row, the site's own fonts and tokens, the same sample document (title, two paragraphs, a heading, a list, a quotation, a caret), the zoom at the lower right (hidden on a phone, where there is nothing to zoom) and the status in the top row. Body text 1.125rem on a 1.7rem line, as her blog. Title clamp(2.25rem, 1.5rem + 2vw, 3.4rem).

| | A, pageless | B, dark page on a desk | C, light paper |
| --- | --- | --- | --- |
| Text column | 38rem (blog measure): 717px at 2560, 694 at 1765, 623 at 1300, 335 at 390 | the same 38rem, inside the page | the same |
| Page | none | 38rem + 2 × margin, margin clamp(3rem, 2rem + 5vw, 9.5rem): 1049px at 2560 (41% of the window), 943 at 1765 (53%), 819 at 1300 (63%), window less 24px at 390 | the same |
| Page colour | the ground, `--ground` | `--panel-raised` on `--ground` | paper oklch(0.965 0.009 300) on `--ground` |
| Edge | none | 1px `--panel-edge` 80% into the ground; a dark shadow under it, 0 1.5rem 3rem -1.5rem | a 1px dark line and the same shadow |
| Corners | none | 0.1875rem (3px) | 3px |
| Gap from the top row | 2.5 lines | 1.5 lines (about 2.55rem) | the same |
| Inner padding | none | top margin × 0.7 + 1rem, sides the margin, bottom margin + 2rem | the same |
| Text colours | site ink, muted, accent | the same | ink oklch(0.24 0.04 300), muted oklch(0.47 0.045 300), accent oklch(0.52 0.19 300) |
| Outline | left margin, starting under the name, 13rem at most, from 64rem up | left of the page, under the name where there is room, 12rem at most, from 80rem up | the same |
| Right margin | file, length and where it is kept, 13rem, set right | the desk | the desk |
| At 390 | the text with a 20px gutter | the page 12px from each side, 1.25rem inside | the same |

What each is for:

- **A** is the blog post being written. The calmest and the most like her site. Its risk is the first rejection: with nothing round the text it can read as empty, which the outline and the details in the margins are there to answer.
- **B** is a page, but a normal one: centred, square, a step up from the desk with a clear edge, never small (it grows with the window) and never a slab (it stops at 1049px however wide the window). It keeps the site's dark.
- **C** is B on light paper. Familiar from every word processor; a strong contrast with the dark site.

I would choose **B** for her. She asked three times for "a page", "normal", "not rounded", "wider"; B is all four, keeps her site's dark purple, and the margins grow so it fills a wide screen without becoming the edge to edge slab she disliked. Page view in View can still give real paper sizes for print.

## What building B would change

In `src/styles/quire.css`:

- `.quire-top` and `.quire-top-row` become the lab's grid (`.lab-top-in`): name spanning two lines, menu words on the first, the bar on the second, status at the first line's right. The absolute placing of `.quire-menu-row` and the sticky offsets that hide the name's line go.
- `.quire-button`, `.quire-row-word`, `.quire-menu`, `.quire-menu-line` take 0.5rem, 0.45rem, 10px and 0.3rem corners in place of the 1.05rem pills.
- `.quire-paper` stops being millimetres times zoom. Its width becomes `calc(var(--measure) + var(--margin) * 2)` with `--margin: clamp(3rem, 2rem + 5vw, 9.5rem)`, capped at the window less the gutters; ground `--panel-raised`, edge 1px `--panel-edge` mixed into the ground, corners 0.1875rem, the shadow above. The repeating line marking each sheet goes from the writing view.
- `.quire-column` padding becomes 1.5 lines above the page; the outline column sits left of the page under the name.
- `.quire-menu`'s open and close transitions are replaced by the lab's: the box animated from the control's box with the content held still.

In `src/quire/paper.ts`: the writing view no longer sets the sheet's size from the paper. Paper size, margins and zoom apply to page view and print only; in the writing view zoom changes the text's size (and so the page with it), as Docs' pageless view does.

In `src/quire/ui.ts`: `flowMenu` becomes the lab's `openMenu`, `closeMenu` and `slide`: measure the control, lay the box over it, lay the menu out at its end, animate the box's edges and hold the content with an opposite move on the same curve, end on the control. The menu row's sliding (`onSide`) uses `slide`. The settings she chooses in the lab become its constants. `bar.ts` keeps its groups, minus the menu row's own placement.
