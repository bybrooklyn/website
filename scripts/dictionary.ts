// Makes mdQuire's English dictionary, public/quire/words-en.dat, from SCOWL (Spell Checker Oriented
// Word Lists, by Kevin Atkinson: http://wordlist.aspell.net/), the lists the en_US and en_GB Hunspell
// dictionaries are made from. It is run by hand when the dictionary should change, with the
// unpacked SCOWL release's `final` folder:
//
//   curl -LO https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz
//   tar xzf scowl-2020.12.07.tar.gz
//   bun scripts/dictionary.ts scowl-2020.12.07/final
//
// SCOWL's own lists are used rather than the Hunspell files made from them, because they keep each
// word's size (10 holds the commonest words, 60 is the size of the usual Hunspell dictionary), which
// ranks spelling suggestions, and because they say which words are American and which British.
// Words of size up to 60 are taken from the English, American and British (both -ise and -ize)
// lists: words, words with capitals, names, abbreviations and contractions. Possessives are not
// listed; the speller takes "dog's" from "dog". A short list of words of computing and of identity
// that SCOWL's size 60 leaves out, and that her writing uses, is added at the largest size (EXTRA).
//
// The file is gzip of lines in sorted order (by UTF-16 code units, as JavaScript compares strings).
// Each line is one letter for the word's size and country (src/quire/check/dictionary.ts reads it),
// one for how many letters it shares with the word before, and the rest of the word. Its licence
// goes beside it as words-en.LICENSE.txt.

import { gzipSync } from "bun";
import { mkdir } from "node:fs/promises";
import { at } from "./lib";

const SIZES = [10, 20, 35, 40, 50, 55, 60];
const KINDS = ["words", "upper", "proper-names", "abbreviations", "contractions"];
/** Each list's country: 0 for both, 1 for American only, 2 for British only. */
const CLASSES: [string, "us" | "gb" | "both"][] = [["english", "both"], ["american", "us"], ["british", "gb"], ["british_z", "gb"]];

/** Words SCOWL's size 60 does not have that are ordinary in writing about computers, games and identity. */
const EXTRA = "agender async backend backends codebase codebases config configs Ctrl changelog changelogs crossfade dev devs distro distros dropdown dropdowns filesystem filesystems frontend frontends frontmatter gameplay gapless homeschooled hostname hostnames keybinding keybindings localhost lookup lookups metadata namespace namespaces nonbinary ok playtest playtests playtesting plugin plugins readme readmes refactor refactored refactoring reimplementation renderer renderers repo repos runtime runtimes sapphic screenshot screenshots sitewide subvolume subvolumes tarball tarballs toolchain toolchains trackpad trackpads transfeminine uptime username usernames viewport viewports webring webrings workflow workflows".split(" ");

const folder = process.argv[2];
if (!folder) throw new Error("Give the SCOWL release's final folder.");
const latin = new TextDecoder("latin1");
const found = new Map<string, { size: number; us: boolean; gb: boolean }>();
for (const [name, country] of CLASSES) {
    for (const kind of KINDS) {
        for (const [index, size] of SIZES.entries()) {
            const file = Bun.file(`${folder}/${name}-${kind}.${size}`);
            if (!(await file.exists())) continue;
            for (const word of latin.decode(await file.arrayBuffer()).split("\n")) {
                if (!word || /\s/.test(word)) continue;
                const was = found.get(word) ?? { size: index, us: false, gb: false };
                was.size = Math.min(was.size, index);
                if (country !== "gb") was.us = true;
                if (country !== "us") was.gb = true;
                found.set(word, was);
            }
        }
    }
}
for (const word of EXTRA) if (!found.has(word)) found.set(word, { size: SIZES.length - 1, us: true, gb: true });
const sorted = [...found.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
let last = "";
const lines: string[] = [];
for (const word of sorted) {
    const { size, us, gb } = found.get(word)!;
    const country = us && gb ? 0 : us ? 1 : 2;
    let shared = 0;
    while (shared < Math.min(word.length, last.length, 40) && word[shared] === last[shared]) shared++;
    lines.push(`${String.fromCharCode(65 + size * 3 + country)}${String.fromCharCode(48 + shared)}${word.slice(shared)}`);
    last = word;
}
const packed = gzipSync(new TextEncoder().encode(`${lines.join("\n")}\n`), { level: 9 });
await mkdir(at("public/quire"), { recursive: true });
await Bun.write(at("public/quire/words-en.dat"), packed);
await Bun.write(at("public/quire/words-en.LICENSE.txt"), `mdQuire's English dictionary (words-en.dat) is made from SCOWL 2020.12.07,\nhttp://wordlist.aspell.net/, by scripts/dictionary.ts. SCOWL's copyright notice follows.\n\n${await Bun.file(`${folder}/../Copyright`).text()}`);
console.log(`${sorted.length} words, ${packed.length} bytes`);
