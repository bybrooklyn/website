# Forks

Three libraries copied into Mote on 11 Nov 2026, to be changed here as Mote needs. They are no longer
fetched from anywhere: these files are what the site runs. Each is under the MIT license, which asks
that its notice stay with it, so each folder keeps its `LICENSE`.

| Folder | What Mote uses it for | Forked from |
|---|---|---|
| `planck/` | 2D bodies, contacts and joints: Blocks, Chain, Climb | planck.js 1.5.1, a port of Box2D. © Erin Catto, Ali Shakiba |
| `cannon/` | 3D bodies: the dice in the tower | cannon-es 0.20.0. © cannon.js authors |
| `three/` | Drawing in 3D with depth, light and shadow | three.js r187. © three.js authors |

The `.d.ts` file beside each says what is in it, by pointing at the types the original publishes
(a development dependency only; nothing from it is shipped).

## Changes made here

Record each change here when it is made: what, why, and the date.

- **All three, 11 Nov 2026.** The source-map comments at the end of each file are removed.
- **cannon, 11 Nov 2026: friction.** In `createFrictionEquationsFromContact` the limit on the rub is now
  multiplied by the length of the step. It was a force being used as a per-step push, so a friction of
  0.3 held like one of 30 and nothing slid down a ramp: a box on a 31-degree slope did not move until
  friction was below 0.002. With the change, 0.25 behaves as 0.25 does. Mote also turns on
  `enableFrictionReduction`, so that a die lying on a face is rubbed once, not once for every corner
  that touches.
