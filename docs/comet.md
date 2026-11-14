# Comet

A draft mini at `/minis/comet/`: pull back, let go, and a comet curves round a few planets into a hole.
One motion, done carefully, and nothing else on screen. It is a game of the site's own in the
aim-and-fling kind.

It was made again from nothing on 13 Nov 2026. The owner played the version before (clouds, rings,
walls, rocks, sparks, pushers, wormholes, glows, labels and hints) and found it a pile of features that
looked generated and did not feel good. She settled the remake: one thing done beautifully; almost nothing
to look at, like a diagram; fields made by a generator from a seed.

## Where the code is

- `src/minis/comet.ts`: the scene: drawing, the pull, the arrival and the move to the next field.
- `src/minis/flight.ts`: the flight without its picture, in fixed steps of 1/120 s, the same on every
  machine for the same field and launch.
- `src/minis/fields.ts`: making fields from a seed and a level, and the search that proves each can be won.
  `fields.test.ts` prints the difficulty table and how long a field takes to make.
- `src/content/minis/comet.mdx`: its words; marked `draft: true`.
- `src/styles/minis.css`: its one line under the canvas.

## What is on screen, and why

- **The sky**: the site's own ground. Nothing drawn on it.
- **Planets**: flat circles in one dim color. The bigger, the stronger the pull; size says nothing else.
- **The hole**: a thin ring in the accent, the only colored thing. Its size is exactly where a comet
  counts as arrived, so the mark and the rule are the same.
- **The comet**: a point. **Its trail**: a thin line that fades toward its tail, the only decoration.
- **While aiming**: the line of the pull, from the comet back the way it is pulled. No path ahead is shown.
- **Missed shots**: the last three stay, faint and fainter, so each shot is aimed against the last.
- **Under the canvas**: one quiet line, "Field 4, 2 shots.", and the sound switch.

There is no text over the field, no score panel and no tutorial. Field 1 is one planet with the hole
behind it, so a straight shot strikes the planet and the first lesson is to curve.

## The feel

- **The pull.** The comet is held at the start. A drag anywhere pulls a line back from it, and the
  comet goes the other way. The pull's length is the strength, one to one up to 0.72 of a full pull,
  then giving less and less for each pixel, so the last part resists. A full pull is 0.42 of the
  canvas's shorter side, between 120 and 220 pixels. Under 8 pixels is a tap, which does nothing, even
  during a flight. Letting go launches at once. The keyboard does the same: arrows aim by half a degree
  (ten with Shift) and set the strength by 0.02, Enter or Space lets go, Escape puts the pull down.
- **The flight.** Full strength is 520 units a second on a field of 1600 by 1000: a winning flight takes
  about 2 to 4 seconds. A planet pulls by a mass of 1970 times its radius squared, over the distance squared, fading to nothing at 6 radii, so a planet bends what passes near it and a close pass
  slings it, and the far side of the field is left alone. The hole pulls a little within 160 units.
  The step is the leapfrog kind, so a pass round a planet keeps its speed.
- **Arriving.** Inside the ring the comet is caught: it slows at once, then spirals in over 0.95 s, the
  circle closing and the turning quickening, 1.6 turns, the way it was going round. Its trail is drawn in
  after it along its own path. As it goes, the ring gives a little inward and comes back, and a low note
  sounds. Then half a second of stillness. Then the ring closes, the comet rises out of it and glides to
  the next start, while the old planets shrink away and the new ones grow, nearest the start first. No
  button.
- **Missing.** Touching a planet, going 50 units past the field's edge, or flying 12 seconds is a miss.
  The trail stays, the comet is back at once. A pull begun during a flight gives that flight up.
- **Sound**, off until switched on: a soft tone on letting go whose pitch rises with the pull, and a low
  note on arriving.

## The fields

- The comet starts near one side and the hole is near the other, the sides swapping each level, so the
  hole just reached is near where the next field starts.
- One planet always stands across the straight way, so a shot aimed at the hole strikes it. The others
  stand where a curve to the hole would pass: beside the way, or guarding the hole.
- Difficulty grows by the way to the hole getting longer (760 units on field 1, up to 1160 by field 11)
  and by more planets (1, then 2 to field 4, 3 to field 12, then 3 or 4), never by new kinds of thing.
- **The search** flies a launch in every direction a degree apart at 21 strengths from the weakest to
  full. A field is kept only if aiming straight at the hole never wins, its widest way in is at least
  3 degrees (2 from field 9), and not too many launches win (170 on field 1, down to 42). The launch from
  the middle of the widest way in comes with the field; it must arrive within 5 seconds, so a field is never won only by waiting. A field takes a
  median of about 50 ms to make, in pieces of under 2 ms, and the next field is made while this one is
  played.
- Flights use only adding, multiplying, dividing and square roots, and directions come from a table made
  by turning one step at a time, so a field and its proof are the same in every browser.
- A field is a link, `?seed=…&field=…`. A visitor goes on where they left off. The run is kept under a new
  version, so what the old game kept is not read, and the old bests are removed.

### The difficulty table

From `fields.test.ts`, six seeds a level:

| level | planets | span | winning launches (median, least, most) | way in, degrees | winning flight, s |
|---|---|---|---|---|---|
| 1 | 1 | 760 | 127, 119, 131 | 5 | 2.0 |
| 2 | 2 | 800 | 103, 79, 105 | 4 | 2.3 |
| 4 | 2 | 880 | 88, 74, 92 | 4 | 1.9 |
| 6 | 3 | 960 | 68, 57, 71 | 3 | 2.0 |
| 8 | 3 | 1040 | 57, 55, 66 | 3 | 2.1 |
| 12 | 3 | 1160 | 48, 39, 50 | 2 | 3.0 |
| 20 | 4 | 1160 | 37, 28, 42 | 2 | 2.4 |
| 30 | 3 | 1160 | 39, 33, 41 | 2 | 3.1 |

## Decided

- One thing: a comet, planets, one hole. No other kind of body, nothing that moves, nothing that pushes.
  After forty fields of play nothing was clearly missing, so no second idea was added.
- Almost nothing to look at; no glow, gradient or icon. The trail is the only decoration.
- Fields are made by the generator from a seed, and each is proven winnable by the flight itself.
- One field shape for every screen, turned on its side on a tall one, so a seed is one puzzle everywhere.
- It stays a draft until the owner has played it.

## Open, for the owner to confirm

- The numbers of the feel: the comet's speed, the pull's length and where it starts to resist, the
  spiral's length and turns, the stillness, the move.
- Three missed trails kept, against one or all.
- No line showing the path ahead: the old trails are the only aid.
- The ring in the accent and everything else in greys and white.
- The ring's small give as the comet is swallowed.
- Field 1's way in (5 degrees) and the floor of 2 degrees from field 9: fine with a mouse, close work on a
  phone.
- The share picture: field 6 of the seed "lumen", most of the way through its winning shot.

## How to run and test

```sh
bun run dev                          # /minis/comet/ (drafts show on the dev server)
bun test src/minis/flight.test.ts    # the flight's rules, and one flight pinned to the digit
bun test src/minis/fields.test.ts    # every field winnable, never straight, the table, timing, kept state
```

## Known weak spots

- The difficulty has been played by a script with the solver's shots and by bad shots, not yet by people.
- The page's words (`comet.mdx`) still describe the game before this one.
