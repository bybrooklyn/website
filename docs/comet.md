# Comet

A draft mini at `/minis/comet/`: pull back, let go, and a comet curves round a few planets into a hole.
One motion, done carefully, and nothing else on screen. It is a game of the site's own in the
aim-and-fling kind.

It was made again from nothing on 13 Nov 2026. The owner played the version before (clouds, rings,
walls, rocks, sparks, pushers, wormholes, glows, labels and hints) and found it a pile of features that
looked generated and did not feel good. She settled the remake: one thing done beautifully; almost nothing
to look at, like a diagram; fields made by a generator from a seed.

On 17 Nov 2026 she played the remake and found it too empty, and missed a sight of the flight while
aiming. Two choices of 13 Nov were reversed: the field is now worth looking at, and the first stretch
of the path is shown. She chose four things and only these: the first second of the path as dots; planets
with color, shading and a glow as wide as their pull; a still sky of stars; a comet with a tail, and a
hole that draws light in. More in each field (moons, busier fields sooner) was offered and not chosen.
The rules, the fields, the flight and the sounds did not change.

## Where the code is

- `src/minis/comet.ts`: the scene: drawing, the pull, the arrival and the move to the next field.
- `src/minis/flight.ts`: the flight without its picture, in fixed steps of 1/120 s, the same on every
  machine for the same field and launch.
- `src/minis/fields.ts`: making fields from a seed and a level, and the search that proves each can be won.
  `fields.test.ts` prints the difficulty table and how long a field takes to make.
- `src/minis/sky.ts`: what is drawn besides the game, worked out without a canvas: the path ahead, the
  planets' colors, the stars and the way the tail streams. `sky.test.ts` holds it.
- `src/content/minis/comet.mdx`: its words; marked `draft: true`.
- `src/styles/minis.css`: its one line under the canvas.

## What is on screen, and why

As of 17 Nov 2026:

- **The sky**: the site's own ground, with faint still stars over the whole canvas, about one for every
  1500 square pixels, and one in seventeen brighter with a small halo. They come from the seed, so a
  run keeps its sky from field to field. The nearer ones drift a few pixels against the comet as it
  moves, at most about 5, and settle when it stops, which gives the field depth. Nothing to play with.
- **Planets**: each its own color, lit from the top left of the screen (on a tall screen too), shaded
  to dark at the far side. The bigger, the stronger the pull. Each has a soft glow in its own color as
  wide as its pull reaches, 6 radii, faint to its very edge, so it is seen how far each one bends the
  comet. The colors are taken from eight soft ones (terracotta, ochre, sand, sage, teal, ice, slate blue,
  rose), in an order the seed and level shuffle, no two of a field near in hue, each nudged a little.
  None is near the violet of the ring, and evenly spread hues were not used, since they gave a chart's
  red, green and blue.
- **The hole**: a thin ring in the accent. Its size is exactly where a comet counts as arrived, so the
  mark and the rule are the same. Inside it is a little darker. Round it a faint glow in the accent is
  as wide as its own pull, 160 units, and streaks of light fall along three arms from that edge to the
  ring, turning as they fall and quicker as they near, one fall taking about 7 seconds.
- **The comet**: a bright point with a glow round it, and a tail of soft puffs that streams away from
  the planets: each planet counts by its size over its distance squared, so the nearest has the most
  say and the tail turns smoothly from one to the next. Near a planet the tail is longer and brighter,
  up to about 54 pixels. **Its trail**: a thin line that fades toward its end.
- **While aiming**: the line of the pull, from the comet back the way it is pulled, and dots along the
  first second of the flight that pull would give, 11 pixels apart, fading and shrinking toward the
  end. They are the flight's own first 120 steps, run by the same `advance`, so they are exactly where
  the comet goes, and they follow the pull by pointer and by the arrow keys. The launch and the first
  bend are seen; the rest is judged. A flight that strikes within the second shows its dots ending there.
- **Missed shots**: the last three stay, faint and fainter, so each shot is aimed against the last.
- **Under the canvas**: one quiet line, "Field 4, 2 shots.", and the sound switch.

There is no text over the field, no score panel and no tutorial. Field 1 is one planet with the hole
behind it, so a straight shot strikes the planet and the first lesson is to curve.

The stars' drift and the swirl move only while the stage runs for the game (aiming, a flight, an
arrival, the move); when it comes to rest they are drawn as they stand, and the stage stops. With less
motion asked for, the stars do not drift and the swirl stands still; the dots, colors, glows and tail
still show. Glows add light on a dark ground; on a light one they are laid over it, and the comet, its
dots and the stars are drawn in the page's ink.

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
  After forty fields of play nothing was clearly missing, so no second idea was added. On 17 Nov 2026
  moons and busier fields were offered again and not chosen.
- The look of 17 Nov 2026: the dotted first second, the colored and glowing planets, the stars, the
  comet's tail and the hole's swirl. Nothing else is drawn: no labels, hints, rings or new bodies.
- Fields are made by the generator from a seed, and each is proven winnable by the flight itself.
- One field shape for every screen, turned on its side on a tall one, so a seed is one puzzle everywhere.
- It stays a draft until the owner has played it.

## Open, for the owner to confirm

- The numbers of the feel: the comet's speed, the pull's length and where it starts to resist, the
  spiral's length and turns, the stillness, the move.
- Three missed trails kept, against one or all.
- The choices made without her on 17 Nov 2026: the eight planet colors; the dots 11 pixels apart, for
  one second; the light from the top left; the tail's puffs and length; the hole's glow, its three arms
  of falling streaks and its darker inside; the stars' number and drift.
- The ring's small give as the comet is swallowed.
- Field 1's way in (5 degrees) and the floor of 2 degrees from field 9: fine with a mouse, close work on a
  phone.
- The share picture: field 6 of the seed "lumen", most of the way through its winning shot. It was
  made before the look of 17 Nov 2026 and still shows the bare field until `bun run pictures mini-comet`
  makes it again.

## How to run and test

```sh
bun run dev                          # /minis/comet/ (drafts show on the dev server)
bun test src/minis/flight.test.ts    # the flight's rules, and one flight pinned to the digit
bun test src/minis/fields.test.ts    # every field winnable, never straight, the table, timing, kept state
bun test src/minis/sky.test.ts       # the dots are the flight's own first second; colors and stars from the seed
```

## Known weak spots

- The difficulty has been played by a script with the solver's shots and by bad shots, not yet by people.
- The page's words (`comet.mdx`) still describe the game before this one.
