# Minis and Mote

Written 11 Nov 2026.

## What this is

- **Mote** (`src/mote/`): a small engine so that small demos and games do not each rewrite the loop, the
  canvas and the input. A stage, 2D physics, 3D physics and 3D drawing, all its own: no dependencies.
  (For the night of 10 Nov it stood on forks of planck, cannon and three. They were taken out on
  11 Nov and what was needed was written into Mote.) MIT, free to copy.
- **Minis** (`/minis/`): tiny things to play with, each opened in the same kind of panel as a post or a
  project. Each is one file in `src/minis/` and a few lines in `src/content/minis/`.

How to add one is in `src/mote/README.md`.

## Built

- **Blocks** (toy): a pile of blocks. Double-click an empty spot, or press Space, for a new piece. Also what posts embed.
- **Dice** (toy, 3D; was Table): a dice tower with real tumbling dice (Mote's own 3D physics and drawing). Dice are picked from pictures of each seen from above, or typed. When they land the eye goes up over the tray and each die's number lights. The D&D helper (fight and character views) was taken out on 11 Nov.
- **Plinko** (toy): a flat arcade board that makes a password, drawn with Mote's 3D drawing so the balls are shaded spheres. Each ball that lands sends its bin's character up to the password.
- **Archived on 11 Nov** (in `src/minis/archive/`, off the site, still building): Chain, Climb, Balance, Solid. Two that feel right were wanted over six that are fine. How to put one back is in the README there.
- Mote has a project page at `/projects/mote/`, a logo (a speck in a beam of light) and tests (`bun run test`).
- The list on `/minis/` shows each mini running, small.
- A terminal player (`src/components/Terminal.astro`) for command-line projects. It is not part of Mote.

## Ideas, not built

From the conversation on 10 and 11 Nov:

1. The 404 page: blocks spelling 404 that fall when the page loads.
2. The blocks demo on the home page, beside the Playmatter clip.
3. A post about writing the physics: warm starting, why blocks sleep, what broke. With a mini at each step.
4. More minis on the physics: a ragdoll, a tower to knock over, a seesaw, a marble run you draw.
5. More tiny games: something with the 3D solids, something for two people on one keyboard.
6. More for Mote when a mini needs it:
   - sound: short synthesized blips, no files
   - a camera that pans and zooms
   - particles
   - sprites and a tile grid
   - springs and motors between bodies
   - one-way platforms, and sensors that notice a body without stopping it
   - saving a run and playing it back
   - a debug view that draws contacts, joints and which bodies are asleep
   - a frame-time meter
   - touch with two fingers
   - text input
7. Its own repository, if anyone else wants to use it.
8. For the 3D side: smooth shading across faces, a shadow under each solid, pictures drawn onto faces,
   loading a simple model from a file, a wireframe view, dice that hit each other corner to corner
   and not as balls, a camera you can move.
9. More minis: a marble run you draw, a ragdoll, a seesaw, a tower to knock down, something for two
   people on one keyboard, a daily puzzle with the same layout for everyone that day.
10. For the Table: sharing a fight between two browsers, a spell-slot tracker, saving more than one
    character, loud dice.
11. For Climb: more of the mountain, a clock, a ghost of your best run.
12. For the terminal: recordings of the full-screen menus, made with asciinema.

From the conversation on 11 Nov, later:

13. A word processor, as a project opened from the projects page (not a mini). Rich text like Word,
    working from Markdown files, dead simple and fun to write in. Tables and images, find and
    replace, a word count, print and PDF, several documents. Kept in the browser, files opened and
    downloaded, real files edited in place where the browser can. Own code only. Made from the
    site's own editor (`scripts/editor/`), which it replaces, and open for anyone to use.
    Decided so far (11 Nov):
    - The file is Markdown. What Markdown cannot hold (color, size, centering) is allowed, and is
      kept as small pieces of HTML inside the file.
    - It looks like the site: the dark page, her typefaces, text in a centered column, the
      document's name and a word count at the top.
    - Formatting four ways: a pill at the top, "simple like google docs, but with nice features";
      a bar that appears over selected text; Markdown typed as you go (`# `, `**bold**`, `- `); and
      a slash menu on an empty line. The pill and the menus move the way the picture viewer's three
      dots do, flowing from one shape to the next.
    - `bun run edit` stays for her own posts, on the same editor code, with its small local server.
    - The bar at the top runs the full width of the document, as in Google Docs, and holds text
      style (paragraph, headings, quote, code, bold, italic, underline, strike), lists and blocks
      (lists, checklist, table, image, link, divider), and the document's name, word count, undo
      and redo.
    - A picture put in a document is saved beside the file and linked the usual Markdown way; for
      a document kept in the browser it is kept in the browser with it.
    - First version also has an outline of the headings and a version history kept in the browser.
    - Its name is mdQuire ("because md").
    - Of the present editor she said all four things are wrong: typing feels broken, formatting is
      awkward, it looks bad, and files and saving. What is kept is saving as you type, the plain
      Markdown view and the real page beside it. Everything else that is seen is built again.
    - To be built in one go, not in stages. Opus 5.5 subagents may be used for research and light
      tasks.
    - Writing from the browser (11 Nov): the site stays as files in git. A private write area
      that only she can log into, with a passkey, saves posts and photos into the repository. The
      board and likes are a small separate piece on a server.
    - Deploys stay as they are (12 Nov): "i dont feel like making a cloudflare token, and i will
      not. can we just keep our current system?" So there is no publish workflow. mdQuire saves
      into the repository, and she runs `bun run deploy` at home when she wants it live.
    - The board: a name and a message, a small drawing, both waiting for her approval before they
      show; and likes on photos.
14. A mini where a person learns to walk in the browser, with the person to set up. In Rust
    compiled to WebAssembly, a couple of crates allowed, made as small as it can be and under
    512 KiB.
    Decided so far (11 Nov):
    - Seen from the side, in 2D.
    - The person is set up by how many legs it has.
    - Learning is shown three ways: the best one so far, walking; a whole generation at once, most
      of them falling over; and its brain, drawn as it decides.
    - A visitor can change the ground, push it around, and save and share a trained walker as a
      link.
    - "this entire demo thing needs to be fluid, fun to use, looking really good, and the UI
      intelligently designed. like the controls for the floor in the bottom and some on the side".
15. A small physics engine in Rust, 50 KiB or less, first for the walking mini. Whether Dice and
    Blocks move onto it is a later question.
16. A game where something is pulled back and flung, and planets bend its path toward a target.
17. Likes on photos, and a guestbook where entries wait to be approved. Both need the site's first
    code on a server.
18. A licensing page of the site's own, in plain words, that the footer's license link opens,
    in place of Creative Commons' page. Maybe as part of a public wiki about her, her projects and
    licensing.
19. More queer memes among the shitposts.
20. Plinko as a table in real 3D with a character on every ball was built and taken back the same
    day: it looked weird. The balls and round posts it needed are still in `space.ts`.

## Next, as she chose on 11 Nov

1. Plan the word processor (idea 13), with questions.
2. Plan the walking mini and its Rust physics engine (ideas 14 and 15).
3. The 404 page with falling blocks (idea 1), and the post about the physics (idea 3).
4. Still open from before: the locked wiki (`password.md`), captions for photos, and three details
   on the resume.
5. After all of that, a bug and consistency audit of the whole site. It should include Mote's own
   API, which is written to be read by a person but is uneven between its parts: `flat.ts` counts in
   pixels with y down and `space.ts` in units with y up, `flat.still` is a value where
   `space.still()` is a call, and a few calls take a row of bare numbers.
6. No more minis for now.
7. A rule for all of it, hers: "everyTHING, needs to be fluid", as the page transitions already
   are. Nothing is to be rewritten for it; what is added should move that way, and the audit
   should look for what does not.

- scriptc (vercel-labs): it compiles TypeScript to native programs and WASI modules. It does not draw to a
  browser canvas, so it is no use for minis on the site. It could matter later for a desktop build.
