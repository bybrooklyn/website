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

None yet beyond removing the source-map comments. Record each change below when it is made: what, why,
and the date.
