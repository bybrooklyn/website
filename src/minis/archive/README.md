# Archived minis

Chain, Climb, Balance and Solid, taken off the site on 11 Nov 2026. Only Blocks and Table are shown.
The code still builds against Mote and Climb's tests still run (`bun run test`), so none of it rots.

Each mini is two files here: `<name>.ts`, the scene, and `<name>.mdx`, its name and description.

To put one back:

1. Move `<name>.ts` to `src/minis/` and change its import from `../../mote` to `../mote`.
2. Move `<name>.mdx` to `src/content/minis/`.

It then has its page at `/minis/<name>/` and its place in the list again.
