# Comet

A draft mini at `/minis/comet/`: an aim-and-fling gravity game. Pull back and let go, and a comet flies
through a field into a black hole. Stars pull it and pushers push it, each only within the glow drawn
round it; clouds slow it, rings speed it up, walls bounce it, wormholes carry it across, and sparks can be
picked up on the way. Planets, moons, rocks and, later, the hole itself move. It is a game of the site's
own, the one gravity game wanted on the site.

## Where the code is

- `src/minis/comet.ts`: the game, drawn (with glow) and played.
- `src/minis/flight.ts`: the flight without its picture: the pull of everything on the comet and the rule of
  each kind of thing, in fixed steps of 1/120 s, the same on every machine for the same field and launch.
- `src/minis/fields.ts`: making fields round ideas, and the solver that proves each can be won.
  `fields.test.ts` prints the difficulty table and the time it takes to make a field.
- `src/content/minis/comet.mdx`: its words; marked `draft: true`.
- `src/styles/minis.css`: its stage, and the stage filling the whole window.

## Built

- **The field** is one shape, 1600 by 1000 units, fitted whole to the canvas and turned on its side on a
  tall screen, so a seed is the same puzzle on a phone and on a desktop. A button under the field, or F,
  lifts the stage out of the page to fill the window, growing from where it was; Escape or the button puts
  it back.
- **The pull.** Every star, pusher and the hole pulls by its mass over the distance squared, softened at its
  middle, and brought smoothly down to nothing at a reach of its own (the pull is multiplied by
  (1 - d²/reach²)²). What is drawn is what is felt: each glow fades as the pull does and ends at a dotted
  ring where the pull ends. Stars reach 4.5 of their radii and pushers 4.
- **The hole** has mass 3e7, a reach of 220 units and a grip of 90: within the grip it takes speed away
  (up to 5 parts in each second at its middle), so a comet that comes near spirals in. Its mouth, where a
  comet is swallowed, is 26 units on the first fields and 22 by field 12. A comet aimed 70 units to one side
  of it is taken; one passing 240 units wide is not bent at all. Before, its pull had no edge (150 units/s²
  at 400 units away across a field of 1000) and its mouth was 17 to 28 units.
- **The comet** sets off at up to 600 units a second (720 before, on a field of 1000): a few seconds across
  the field at a middle strength. Time slows as it nears the hole, so the capture can be watched. A flight
  that has not ended after 20 seconds is a miss.
- **The kinds of thing**, each with one rule and one look: a star (gold) pulls; a pusher (blue rim) pushes;
  a rock (grey lump) does neither and stops the comet; a cloud (soft teal, dotted edge) takes away speed for
  each unit crossed, 1.2 times the distance; a ring (green hoop) multiplies the speed by 1.4 each time the
  comet goes in, up to 1000; a wall (pale bar) bounces it as a mirror would; a wormhole sends it out of its
  twin at the same speed and heading; a spark (four points) is picked up and changes nothing.
- **Things that move** do so by the flight's clock, which starts at the launch, so each try is the same
  puzzle and the solver's launch always wins. Planets and moons go round on circles, rocks drift to and fro,
  and from field 12 the hole may wander. While aiming, each moving thing is drawn where it is at the
  launch, with its way dotted and a dot for each of its first eight seconds; a missed shot's ghost marks its
  seconds too, so the two can be compared. Places on a circle are taken from the same table of directions
  as the aim, so nothing uses a sine or a cosine.
- **Fields are made round one idea**: go round a big star; sling round a giant; a row of pushers; a star
  with a cloud round one side and a pusher round the other; a ring for the speed to pass pushers by the
  hole; a wall across the way to bank off; the hole walled in on four sides, reached only through a
  wormhole; a planet going round a star; rocks drifting across both ways round a star; a moon going round
  its star; a relay of stars past a pusher; a hole that wanders. Each idea puts something solid across the
  straight way. The first twelve fields bring in one new kind each, in that order (the eleventh brings
  none), and the field where a kind is first met names its rule beside it. Past twelve the ideas come round
  again in an order the seed picks, never the same idea twice running, with more round them.
- **The solver** flies launches over 300 degrees of directions round the hole and seven strengths, the moving
  things included, and keeps a field only if a launch wins with room either side and a notch either way,
  and aiming straight at the hole does not win. It pauses every two flights; the page makes the next field
  in what is left of each frame while this one is played, and the first one with most of each frame. A field
  takes a median of 35 ms to make, the slowest 275 ms, and no piece between pauses takes more than about
  5 ms.
- **Sparks** are laid along a second, harder way in when the solver found one, so picking them all up is a
  choice; the count shows over the field and is said when the field is won.
- **Feel**: the dotted line shows the first 0.8 s of the flight, with a larger dot at each half second, and
  stops where the comet first goes into or off something. Every launch is a shot. A miss shakes the scene
  and the comet is back at the start at once; a press during a flight gives it up at once and starts the
  next pull, and so do Enter and R. Arrow keys aim and set strength; Enter or Space launches.
- Each field comes from a seed and a level (`?seed=&field=`), so a link opens the same field for anyone.
- A share picture.

### The difficulty table

From `fields.test.ts`, 30 seeds a level:

| level | idea | new | things | mouth | way in asked (degrees) | way in, median | winning flight, median (s) | straight wins | in band |
|---|---|---|---|---|---|---|---|---|---|
| 1 | bend | star | 3.0 | 26 | 3.0 to 24 | 3.5 | 3.2 | 0% | 100% |
| 2 | slingshot | spark | 4.0 | 26 | 2.9 to 22 | 3.0 | 2.4 | 0% | 100% |
| 3 | push | pusher | 6.9 | 25 | 2.7 to 20 | 4.5 | 4.1 | 0% | 100% |
| 4 | cloud | cloud | 7.0 | 25 | 2.5 to 19 | 5.5 | 4.5 | 0% | 100% |
| 5 | ring | ring | 8.0 | 25 | 2.4 to 17 | 3.5 | 2.5 | 0% | 100% |
| 6 | bounce | wall | 7.0 | 24 | 2.3 to 15 | 10.0 | 6.3 | 0% | 100% |
| 7 | wormhole | wormhole | 11.0 | 24 | 2.1 to 13 | 4.5 | 3.0 | 0% | 100% |
| 8 | orbit | planet | 8.0 | 24 | 1.9 to 11 | 3.0 | 2.9 | 0% | 100% |
| 9 | gap | rock | 9.0 | 23 | 1.8 to 10 | 3.0 | 3.7 | 0% | 100% |
| 10 | moon | moon | 10.0 | 23 | 1.7 to 8 | 4.5 | 3.9 | 0% | 100% |
| 11 | relay | | 11.0 | 23 | 1.5 to 6 | 1.5 | 3.8 | 0% | 100% |
| 12 | wander | wandering hole | 9.0 | 22 | 1.5 to 5 | 3.0 | 4.1 | 0% | 97% |

## Decided

- It stays a draft until the owner has seen and played it.
- Glow is allowed inside minis; this is one.
- The owner found the first version weak: the hole too weak and felt across the whole field, the comet too
  fast, the fields too small and alike. She settled that a field is one big screen seen whole, with more in
  it, and that fields differ by things that move and by more kinds of thing.
- One field shape for every screen, turned on a tall one, so a seed is one puzzle everywhere.
- The flight's clock starts at the launch: the puzzle is aim and strength, and the same on every try.
- The bests are kept under a new version: those from before were for other fields of the same name.

## Open, for the owner to confirm

- The numbers of the feel: the hole's reach and grip, the comet's speed, how strongly clouds brake and rings
  push, and how much of the path the aiming line shows.
- Clock from the launch, against a clock that runs while aiming so that the timing of the release matters.
- Whole window as a button, against the stage simply being larger on its page.
- Sparks as the name for the stars to pick up, since gold stars already pull.
- Ways in are narrower than before on the first fields (3 degrees, where it was 5): going round anything
  from across a big field narrows them. The pull is longer (up to 240 pixels) to aim finely by hand.
- The wall field is the easiest of the twelve (a 10 degree way in).
- When it leaves draft.

## Old links and kept runs

A seed and a field number still open a field, but not the same one as before: the generator changed what
they mean. A kept run is read back as before (its seed and field), so a returning visitor goes on at the
same number in the new fields. Anything damaged, or a field number past any played, still opens a field at
once; past 24 the fields ask no more.

## How to run and test

```sh
bun run dev                          # /minis/comet/ (drafts show on the dev server)
bun test src/minis/fields.test.ts    # every field winnable, its idea and kinds, sparks, timing, the difficulty table
bun test src/minis/flight.test.ts    # the flight and each kind's rule
```

## Known weak spots

- The difficulty curve is set by the solver's table and has not been tried by people.
- The page's words (`comet.mdx`) still describe the first version.
