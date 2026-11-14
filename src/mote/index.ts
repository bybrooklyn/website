// Mote: the tiny engine the minis on this site run on.
//
//   stage.ts    a canvas, a fixed-step loop, the pointer, keys, the page's colors
//   flat.ts     2D bodies, contacts and joints
//   solids.ts   the shapes of dice and other solids of flat faces, and a way to draw one on a 2D canvas
//   space.ts    3D bodies that fall, tumble and hit each other (import it by name: the dice tower does)
//   grid.ts     which pairs of bodies are near enough to look at, for both physics
//   gl.ts      3D drawing with depth, light, shadow and glow, on WebGL 2 (import it by name)
//   sound.ts    knocks and notes, with no files (import it by name)
//
// Nothing here depends on anything outside this folder.
//
// See README.md beside this file.

export * from "./stage";
export * from "./flat";
export * from "./solids";
