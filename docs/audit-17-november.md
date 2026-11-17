# Audit of 17 November 2026

Asked for by the owner as four things at once: the pages rebuilt on the 16th to be used by hand and what
is broken in them put right; mdQuire's chosen list to be built; the tools and minis to be measured against
each other and every mismatch listed for her to choose from; and the site to go live. The Sand mini, which
she asked to be improved a lot the same day, is in [sand.md](sand.md). This file says what was done and
found, and what waits on her. The audit of 16 November is in [audit-16-november.md](audit-16-november.md).

## How it was done

- The whole test suite was run first on the tree as it stood: 2,335 passing, one failing, a timing test of
  the checker that fails only on a busy machine. Every kind of page was opened at 1288 and 390 pixels wide:
  no errors, no sideways scrolling, no dead link.
- Three testers used the rebuilt pages in a headless browser with real presses, drags and keys, at both
  sizes, saw each finding twice from a fresh page, then fixed the plain bugs, one commit each with a test.
  They changed no layout and no word a visitor reads; what is a matter of choice is listed below.
- A fourth measured every tool and mini from computed styles and boxes and changed nothing.
- Nothing was deployed.

## imgQuire, after its new layout: nine fixed

1. A click outside the crop frame made a crop of one pixel. The frame now stays as it was; a drag from
   outside still draws a new one.
2. After cut out's first dialog the keyboard was left on the bar's word, where the editor's keys are not
   heard. It goes back to the picture.
3. "hide all" on the reading page switched itself off while it held the keyboard, which fell to the page.
   Any control of the side panel switched off or folded away while it holds the keyboard now gives it back.
4. Resize's fields kept the size just undone. They follow undo and redo.
5. Mark up's thickness, and a lens's size, showed the pen's setting, not the picked mark's.
6. On a phone the commands button lay over the panel's last control.
7. The side panel scrolled past the end of its page into blank space (383 pixels on a desk, 733 on a phone).
8. Folds leapt open in a frame and shut late: the kit's fold glided toward a limit of 40rem, not its own
   height. It now glides over its own height. This is the shared kit, so the small tools' folds change too.
9. A page of the panel that gave its place stopped half faded, then vanished.

The picture never moved when a tool was chosen or a fold opened, at either size. Every format's "it will
be" matched the saved file.

Left for the owner: the home screen's right-click has no Paste; Help's keys list leaves out K and I; C
pressed again stays in crop where the word pressed again leaves and applies; I opens facts with the
caption field focused, so a second I types into it; a picked hide cover shows the export page; version
history lights no bar word and has a cross the other pages have not; with the keyboard on a bar word,
Ctrl+Z and Escape do nothing.

## Marbles and Blocks, after their new controls: six fixed

1. After a race no marble could be let go until the marbles were cleared.
2. A press on a faint word or a heading took the keyboard out of the mini, in Blocks too. A press in a mini
   that lands between its controls now leaves the keyboard where it was (Mote's stage; every mini). Text
   in a column that is not a control can no longer be selected by dragging.
3. Page Up and Page Down on a piece in hand were undone by the next move of the mouse.
4. A piece in hand stayed put while the view moved, then jumped back to the pointer.
5. Switching sound on moved the word after it by two pixels.
6. Blocks: after a resize the pile hung in the air, overlapping, until the pointer came over it.

Left for the owner, Marbles: a carry let go over the column sets the piece down out of sight; undo and
redo let go of what was chosen; a right click on the empty table keeps the choice, so its menu offers
turn and take away for nothing under the pointer; the first seven pixels of a right drag neither open the
menu nor turn the view; "sound: off" is drawn quiet where the column's other live words are in the accent;
choosing a piece is not said aloud. Blocks: its box is narrower than Sand's and Marbles' and ends just
under the first screen; "random" pressed again does nothing and does not say on or off.

## mdQuire's chosen list

The to-do list said none of the list chosen on 13 November was built. It was out of date: nine of the
audit's ten changes and nearly all the rest had been built on 14 to 16 November. Each was tried again by
the audit's own steps and found done. What was still missing, and is now built:

- An address typed with no scheme gets `https://` when it names a site.
- Ctrl+K, Insert, Link and the bar's Link open one link field, at the words, with the words still drawn as
  selected; the editor's second link field is gone.
- Every menu line has its sign: Tools' two lines and the tools folded into the three dots had none.
- The text's right-click menu offers Paste and Paste without formatting, and a table cell's menu the
  clipboard's four lines.
- On a phone the menu row was 18 pixels too wide at 390 and 48 at 360, cutting Help. All seven words fit.

Not built: the phone bar's order (it would mean touching the checking count or the dictation buttons).

## Where the tools and minis do not match

Measured on twelve pages at 1288 by 828 and 390 by 800. What already matches: the frame of every page
(the opened sheet, the trail, the title's size and place, the meta line), every box's border and radius,
the column's headings wherever there is a column, the look of a word to press, the focus ring, the round
dots, and lowercase labels. What does not, most visible first, each a choice for the owner:

1. **Six of twelve do not fit the first screen.** QR codes runs 821 pixels past it and Convert 1,650, every
   group laid open; the Walker 337; Dice, Plinko and Comet have every control below it. Fold groups shut
   behind their headings, let a column scroll inside its box as the Generalist's does, or accept it.
2. **Four ways to place the controls.** A column on the right (the tools, Walker, Blocks, Sand, Generalist);
   a panel under the scene (Dice, Plinko, Comet); a column and a row under the scene (Marbles); none
   (Rolling). Move the three into a column, or keep panels under for minis with few controls.
3. **Three box widths and two left edges.** 719 (Walker, Dice, Blocks, Plinko, Comet, Rolling), 1037 (Sand,
   Marbles, Generalist), 1029 (the tools); left edges at 183 and 179. One width, at one edge.
4. **A description of two lines pushes the box down 36 pixels** (Sand, Generalist, Rolling).
5. **Sand's box is on the surface color with a frame round its stage**, every other box on the ground.
6. **Seven column widths**: 278 (the bench), 294, 221, 272, 311, 343, and imgQuire's 319.
7. **Marbles' column is in smaller type** (14.4 pixels against 16.4) with closer lines, done to fit the
   first screen.
8. **The panels under a scene have the old headings** (Dice, Plinko): larger, muted, with no rule above.
9. **The Generalist's fold is a heading with a chevron**, where the Walker and Marbles open one by a word.
10. **Four marks for the one chosen**: a dot, a ring (the bench's swatches), an accent bar under an icon
    (QR's shape and corners), a rounded outline (Sand's materials, Marbles' pieces).
11. **On and off is said three ways**: a checkbox, a word that says which, and the sound word, drawn quiet.
12. **Some words change width when pressed, so the line moves**: the Walker's pause and resume by 11.5
    pixels, Sand's pause and go on by 2.7, Dice's sound by 2. Marbles keeps the room of the widest; that
    rule is now every column's and needs only to be asked for on each word.
13. **Sand's world words are all quiet**, where the Walker's are in the accent; Plinko and Dice add an
    arrow to their main word and no tool does.
14. **Sliders**: some show their value and some do not.
15. **"Cannot act now" has three strengths**, and the three small tools hide "paste" where it cannot act.
16. **imgQuire's "choose a picture" is a filled, boxed button**; Cut-out's is a word.
17. **QR's text box had the browser's own focus ring**: the site's rule named no `textarea`. Fixed (below).
18. **The same thing under different names**: resume, go on, play; clear, clear the marbles, clear the list,
    start over, forget these; copy link to this walker, roll or world, and copy link; remove and delete;
    JPEG XL and JXL; four wordings of "drop, paste or choose a picture"; open a world, start from, from a
    file.
19. **Tooltips are uneven**: none on the Walker, Plinko, Comet or the Generalist, all on QR and Blocks;
    Sand's begin lowercase where the rest begin with a capital.
20. **Two kinds of toolbar**: mdQuire's 29 icons, imgQuire's words.
21. **The editors' trail leaves out "tools"**, and the list of tools is plain lines where the list of minis
    is cards with pictures.
22. **On a phone** every column goes under and nothing scrolls sideways, but most things to press are 27 or
    28 pixels high, Marbles' 18; and Marbles' column kept its left rule there with no rule above. Fixed
    (below).

## Fixed from that list without waiting

Two were faults, not choices:

- `textarea` is named in the site's focus rule, so a text box has the same ring as every other control.
- On a phone Marbles' column has its rule above it and none at its left: the rule for a phone stood before
  the one it was meant to change, and lost to it.

## Left

- Every choice above, and the words a visitor reads that were added this day: Sand's column ("brush",
  "view", "zoom in", "zoom out", "see it all", "fill the window", "back to the page"), its controls line,
  and the names of its six new materials.
- Going live: the live site is as it was on 11 November. It waits on the owner's word.
- The two typing-speed tests and the checker's timing test fail only on a busy machine, and one model run
  in imgQuire's tests can run out of its 30 seconds there; each passes alone.
