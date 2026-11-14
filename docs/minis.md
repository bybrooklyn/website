# Minis

Small things to play with at `/minis/`, each opened in the same kind of panel as a post or a project. Each
mini is one scene file in `src/minis/` and a few lines of words in `src/content/minis/`, and most run on Mote
(`mote.md`). This file covers the minis page and the small minis; the Walker, the generalist and Comet have
files of their own (`walker.md`, `generalist.md`, `comet.md`, `sand.md`).

## Where the code is

- `src/pages/minis/`: the list and each mini's page. The list shows each mini running, small
  (`m.preview` in Mote is true there).
- `src/minis/`: one scene per mini, with the logic that can be tested kept in files of its own.
- `src/content/minis/*.mdx`: each mini's name, summary, `kind` (toy or game), `space` (2D or 3D),
  `controls`, `order`, `panel`, `draft`, and a few words.
- `src/scripts/mini.ts`: starts a mini in a page; a post can embed one with
  `<div class="mote" data-mini="<name>"></div>`.
- `src/components/Terminal.astro` and `src/scripts/terminal.ts`: the terminal player, with its recordings in
  `public/casts/`.

How to add a mini is in `src/mote/README.md`.

## Built

- **Blocks** (toy, 2D; `blocks.ts`): a pile of blocks with real physics. A piece can be dragged and thrown;
  a double click on an empty spot, or Space, drops a new block, now and then a ball or a wedge. After sixty
  pieces the oldest is taken away. It is also what posts embed.
- **Dice** (toy, 3D; first called Table; `dice.ts`, `tower.ts`, `rolls.ts`, `luck.ts`): a dice tower. Dice
  are picked from pictures of each seen from above, or typed as a roll (`2d6+3`, `4d6 drop lowest`,
  `d20 adv`, `d100`). They tumble down the ramps as real solids on Mote's 3D physics and roll into the tray;
  then the view rises over the tray and each die's number lifts off and joins a sorted row with the total.
  A four-sided die is read from its top corner. Where WebGL 2 is missing the tower is drawn on a 2D canvas.
  The tests roll each kind of die hundreds of times and check every face comes up as often as chance says.
- **Plinko** (toy, drawn with Mote's 3D drawing; `plinko.ts`, `board.ts`): a flat arcade board that makes a
  password. Each bin shows a character from the browser's secure random source; a ball landing sends its
  bin's character up to the password, so where a ball lands has nothing to do with what is drawn. The tests
  drop 6,400 balls on four boards to check every character is as likely as any other.
- **The terminal** (not part of Mote): plays back a recorded run of a command-line program (an asciinema
  `.cast` file) with its timing. Nothing runs. It is used on the mFetchy and Terrustia project pages, and
  opens the way a picture does, on the same opener as the picture viewer.
- The Walker, the generalist (a draft), Comet (a draft) and Sand (a draft, stage 4 of its plan measured:
  the page, with pride sand and its flags laid as poured sand, glow and links to worlds; sand that comes
  down to its angle promptly and lava that pools) are minis too.
- **Rolling** (a draft, 3D; `rolling.ts`, `course.ts`): not a mini of its own but a plain page for watching
  Mote's marbles roll, made for the marble run ([marbles](marbles.md)). Marbles go down a ramp, round a
  loop, along a banked spiral and through a funnel into a tray, one after another; a click lets another go
  and Space rides along with one. It stays a draft.
- **Marbles** (a draft, 3D; `marbles.ts` on `pieces.ts`, `run.ts`, `edit.ts`, `history.ts`, `ghost.ts`,
  `handles.ts`, `table.ts`, `supports.ts`, `checks.ts`, `orbit.ts`, `runs.ts`, `toolbar.ts`): the marble run,
  stages 2 and 3 of its plan ([marbles](marbles.md)). A box of pieces whose ends snap together, dragged up
  from a strip under the scene or pressed to go at the end of the run; pillars made by themselves; hoppers
  that let marbles go; an editor with a choice of many, handles to move, turn and lengthen, undo, copy,
  mirror, pieces of one's own and views straight on; a ghost marble showing where a marble would go, and
  quiet marks where marbles will fall off or stop. Touch first, with the mouse and keys as well.

## Decided

- **Removed minis stay removed.** Chain, Climb, Balance and Solid were taken off on 11 Nov 2026, so that
  there are a few minis that feel right in place of many that are fine. Their code is kept in the git tag
  `minis-archive` and is not on the site.
- **No more small minis for now**, beyond the ones in progress.
- Every mini is fluid in the site's manner: what opens grows from where it was pressed, as the rest of the
  site does (`STYLE.md`).
- Glow belongs inside minis only; the rest of the site has none.
- A mini's world can travel in a link's fragment, after `#`, so it is never sent to a server (Sand); a
  mini's state that is small goes in its query (`m.link`, Dice).
- Plinko as a table in real 3D, with a character on every ball, was built and taken back the same day: it
  looked wrong. The balls and round posts it needed are still in Mote's `space.ts`.

## Open

These are ideas, none of them decided.

1. The 404 page: blocks spelling 404 that fall when the page loads. Waiting.
2. The Blocks demo on the home page, beside the Playmatter clip.
3. A post about writing the physics (warm starting, why blocks sleep, what broke), with a mini at each step.
4. Minis on physics: a ragdoll, a tower to knock down, a seesaw, a marble run that is drawn.
5. Small games: something with the 3D solids, something for two people on one keyboard, a daily puzzle
   with the same layout for everyone that day.
6. For Dice (from when it was the Table): sharing a roll between two browsers, a spell-slot tracker,
   saving more than one character, loud dice. The fight and character views were taken out on 11 Nov 2026,
   so these would need a reason to come back.
7. For Climb, if it ever comes back: more of the mountain, a clock, a ghost of the best run.
8. For the terminal: recordings of full-screen menus.

## How to run and test

```sh
bun run dev                                   # the list is at /minis/
bun test src/minis                            # the logic of every mini
bun test src/scripts/terminal.test.ts         # the terminal's screen
```

`bun run test` runs all of these with the rest.

## Known weak spots

- Blocks, the list and the embed have no test of their own beyond Mote's; the scenes themselves are only
  checked by eye.
- The idea numbers in older commit messages and notes refer to the list as it was kept before
  13 Nov 2026; the numbers above are new.
