# Comet

A draft mini at `/minis/comet/`: an aim-and-fling gravity game. Pull back and let go, and a comet flies
through a field of stars that pull, pushers that push and pairs of wormholes, into a black hole. It is a
game in the spirit of small, polished browser toys, and the one gravity game wanted on the site.

## Where the code is

- `src/minis/comet.ts`: the game, drawn (with glow) and played.
- `src/minis/flight.ts`: the flight without its picture: the pull of everything on the comet, in fixed
  steps of 1/120 s, the same on every machine for the same field and launch.
- `src/minis/fields.ts`: making fields and the solver that proves each can be won. `fields.test.ts` prints
  the difficulty table.
- `src/content/minis/comet.mdx`: its words; marked `draft: true`.

## Built

- Pull back from anywhere and let go; the dotted line shows the first second of the flight. Or aim with the
  arrow keys and launch with Enter or Space; R tries the field again.
- Every launch is a shot. Leaving the field, hitting anything or flying for twelve seconds is a miss: the
  scene shakes and the comet goes back to the start. Swallowed, the comet opens the next field, a little
  harder.
- Each field comes from a seed and a level (`?seed=&field=`), so a link opens the same field for anyone. A
  field is kept only once the solver has found a winning launch with room around it, and no field is won by
  aiming straight at the hole. If a level's tries all fail, the field is made again with fewer things in it.
- Levels ask for more stars, then pushers, then wormholes, a smaller hole, stars across the straight way in,
  and a narrower span of winning directions. The two mouths of a wormhole pair turn opposite ways.
- A share picture.

## Decided

- It stays a draft until the owner has seen and played it.
- Glow is allowed inside minis; this is one.

## Open

- Whether it is what was wanted. It was built from a short description (pull back, fling, planets bend the
  path toward a target), and its look and feel have not been reviewed.
- When it leaves draft.

## How to run and test

```sh
bun run dev                          # /minis/comet/ (drafts show on the dev server)
bun test src/minis/fields.test.ts    # every field winnable, and the difficulty table
bun test src/minis/flight.test.ts    # the flight
```

## Known weak spots

- The difficulty curve is set by the solver's table and has not been tried by people.
