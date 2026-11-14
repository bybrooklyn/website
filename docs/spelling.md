# Spelling in mdQuire

How mdQuire's spelling check works today, how well it does, what its word list holds and lacks, what
she decided about it on 13 November 2026 (American and on by default, a personal dictionary she can see,
her names known from the start, the spellings first in the right-click menu), and the questions still
open. The numbers were measured on 13 November 2026, on `main` as it was that night ("before") and after
that night's fixes ("after"); how is under "How it was measured".

## Where the code is

- `src/quire/check/dictionary.ts`: unpacks the word list, says whether a word is known, and suggests.
- `src/quire/check/spelling.ts`: the rule, the speller it asks, and what is never checked.
- `src/quire/check/text.ts`: where the words of a block are (Unicode's word boundaries).
- `src/quire/check/names.ts`: about sixty names of the site's (her name, her projects', tools, places): the
  small built-in list, known in every document from the start.
- `src/quire/check/withheld.ts`: words that stay known but are never suggested (slurs, explicit words).
- `scripts/dictionary.ts`: builds `public/quire/words-en.dat` and its licence from SCOWL, by hand.
- `src/quire/check/view.ts`: the underlines, the popover, "Add to dictionary" and "Ignore", the lines a
  misspelling puts first in the text's right-click menu, and the Personal dictionary dialog.
- `src/quire/check/findings.ts`: what is kept in the browser (whether checking is on, her own words, what
  is ignored), and the cleaning every word of her dictionary passes through.

## How it works now

**The word list.** One gzip file of sorted words, each with a letter for its size (SCOWL's frequency
band) and country (both, American only, British only), unpacked into one long string with an index when
spelling is first switched on: 18 to 26 ms, about 3.4 MB in memory. A lookup is a binary search, about
0.13 microseconds a word. It is fetched only when checking and spelling are on.

**A word is known** if it is in the list for the chosen country as written, or with its first letter
lowered, or in capitals; or as a possessive of a known word; or if each part of a hyphenated word is
known; or if it is one of the site's names, a word added to "her own dictionary" in this browser, or a
word ignored in this document. Accents typed as a letter and a combining mark are looked up as the one
letter they make.

**Never checked:** code and code blocks, maths, web addresses and emails, the frontmatter (so the title
and summary), the document title field, words with a digit or a full stop in them, words in a path or
after `#` or `@`, words in capitals (NASA) and words with a capital inside (TypeScript, iPhone).

**Suggestions** are every word within two weighted edits, scanned linearly (about 6 ms a word): a key
beside the one meant, a vowel for a vowel, one of seven sound-alike pairs, a doubled letter and two
letters swapped each cost less than an ordinary edit. They are ranked by that cost plus the word's
frequency band, with a cost for changing the first letter and for offering a name for a small-letter
word. Two words run together are offered apart only when both halves are among the commonest words.
Withheld words are never offered. Up to five are shown.

**The country** is American unless chosen otherwise in the checking settings; there is no "both" and no
per-document language.

**On from the start.** A writer who has never set checking has it on, with spelling alone (the other
kinds, Markdown tidiness, links and pictures, and writing, wait until she switches them on in the
settings), so a misspelling is underlined from the first document. Whoever switched checking off keeps
it off (`quire-check` kept with `on: false`), and for her nothing of checking loads until Tools, Checking.
The word list (230 KB, fetched once and then cached by the browser) is fetched when the editor opens.
While spelling is on, the browser's own checker is off for the document; if the word list does not load
the browser's checker is put back and the list of findings says so.

**The right-click menu.** A right-click on a misspelled word opens the text's own menu (`text-menu.ts`)
with, at the top as Docs and the browsers have them, its spellings in strong type (up to five, or "No
suggestions"), then Add to dictionary and Ignore in this document, a rule, and then Cut, Copy and the
rest. The menu key or Shift+F10 does the same at the caret. A right-click on any other finding still
opens its popover; Shift with the right-click is the browser's own menu.

**What she can teach it.** "Add to dictionary" (in the right-click menu and the popover) keeps a word in
this browser for good (`localStorage`, `quire-check-words`, every word read back cleaned: trimmed, one to
64 characters, no space or control character, at most 20,000). Tools, Personal dictionary (also a button
in the checking settings) is a dialog listing her words in order, each with Remove, with Download as text
(`dictionary.txt`, one word to a line) and Add from a text file (one word to a line, or parted by commas
or tabs; anything that is not a word is passed over, and it says how many were added). Her names and her
projects' (`names.ts`: Charlotte, bybrooklyn, mdQuire, imgQuire, Playmatter, Mote, Torrens and the rest)
are known from the start without being in her list. "Ignore in this document" keeps a word per document,
also for good and still unlisted. There is no "ignore once".

## The numbers

| Measure | Before | After |
|---|---|---|
| Ordinary misspellings (100, from an audit): caught | 100 | 100 |
| right word first / in the first three / absent | 91 / 98 / 1 | 92 / 98 / 1 |
| The repo's own fixture (184 pairs, also its tuning set): first / three / absent | 167 / 181 / 3 | 169 / 181 / 3 |
| Phonetic and sound-spelled (30: fone, nolej, enuff, bizness, skool...): first / three / absent | 14 / 20 / 10 | 14 / 20 / 10 |
| Keyboard slips (36: a neighbouring key, or two letters swapped, in words from her posts): first / three / absent | 36 / 36 / 0 | 36 / 36 / 0 |
| Her published posts and pages (6,876 words checked, drafts on hold left out), American: flags per thousand | 10.9 | 10.5 |
| the same, British | 12.5 | 12.1 |
| A slur or explicit word in the first three, over 5,963 two-letter swaps of 1,200 words from her pages | 13 times | 0 |
| A word run apart in the first three, same swaps | 307 times | 52 |
| Stress text of addresses, file names, emoji and accents (133 words): flags | 60 (4 of them lone emoji selectors) | 47 (all real words or non-English) |

**What it flags on her own writing** (American, after): 72 flags, nearly all of them right. By kind:

- Names (about 50): projects and tools she writes about (wgpu 3, iroh 2, gamescope 2, winit, kira, Ghostty,
  Neovim, Wayland, Btrfs, Bazzite, Limine, Ryzen, Ollama, Gitea, Komga, Tunarr, Gotify, Kuma, Sonarr, Radarr,
  Lidarr, Prowlarr, Seerr, Navidrome, Kodi, Deezer, Plex 2, Redux, moondream, onnx-community, cxx-qt),
  companies and games (Meta 3, Spotify, Minecraft), people (Asbury, Flavia, Zimbardi, Catto, Yunus, Seyhan,
  Dede), her own coinages (darkuss 4, terrustia, Olicorne, Undercase).
- Technology words (about 8): zs 4, zsh, pacman, ai 2, tf, nav.
- Real words the list lacks (about 6): letterforms, ragdolls, demigirl, shitposts, planck, metres (British).
- Real misspellings: 1 (`doesnt`).

In British spelling the same, plus her American spellings: color 4, catalog 2, colors, Color, Center,
neighbors, nearest-neighbor, totaling.

**On a few thousand words of ordinary modern prose** (the audit's stress texts, 1,547 words, American,
after): right words it flags, grouped:

- Names: Priya, Mohammed, Yuki, Liam, Skyler, Beyonce, Kahlo, Banksy, Meta, Nvidia, Wayland, Neovim,
  Minecraft, Zelda, Pokemon, Undertale, Stardew, Fortnite, Roblox, Tetris (26 in 215 words of names).
- Technology: systemd, Kubernetes, nginx, npm, webpack, Vite, Deno, mutex, tokenizer, lexer, monorepo,
  idempotent, failover, memoization, sharding, hotfix, linter, transpiler, bundler, polyfill, middleware,
  serverless, webhook, enum, struct, stdin, stdout (51 in 264 words).
- Recent words: wifi, offline, signup, ebook, webpage, livestream, upvote, doomscrolling, lockdown, covid,
  influencer, metaverse, chatbot, vlogs, bingewatch.
- Identity words: genderqueer, pansexual, aromantic, neurodivergent (and of 34 identity words tried, 17
  are missing: demisexual, genderfluid, misgender, deadname, lgbtq, enby, transmasculine, neopronouns...).
- British spellings, in American: 70 of 197 words of a British text (colour, centre, organise, travelled...);
  in British, 53 American ones flagged the other way.
- Contractions and slang: lol, tbh, aww, yay, mhm, cuz, y'know, 'cause, 'tis, y'all, ol', goin'.
- Accented and non-English: naïve, résumé, façade, crème brûlée, déjà vu, señor, über, Zoë, Chloë, Renée,
  José, João, Beyoncé, São Paulo, Kraków, Dvořák (all flagged even typed whole), and every word of Greek,
  Russian or Japanese.
- Hyphenated: pre-order, Wi-Fi (each part is looked up and "pre" and "Wi" are not words).

## What is in the word list

- **Where it came from:** SCOWL 2020.12.07 (Spell Checker Oriented Word Lists, by Kevin Atkinson), the
  lists the usual Hunspell dictionaries are made from: sizes 10 to 60 (60 is the size of the usual
  `en_US` dictionary), English plus American plus British with both -ise and -ize, kinds words, words
  with capitals, proper names, abbreviations and contractions; and 90 words of computing and identity
  added by hand (`EXTRA` in `scripts/dictionary.ts`: nonbinary, sapphic, transfeminine, codebase, repo...).
- **Its licence:** SCOWL's own, a permissive one: use, copy, change, share and sell, provided its
  copyright notice goes with every copy. The notice is shipped beside the file as
  `public/quire/words-en.LICENSE.txt`. It is not linked from the site's licence page or mdQuire's About.
- **Its size:** 126,414 entries; 234,766 bytes on the wire (it is already gzip, so no further compression
  is likely); 0.67 MB of text unpacked.
- **By country:** 121,628 shared, 1,670 American only, 3,116 British only.
- **By frequency band** (SCOWL size 10, 20, 35, 40, 50, 55, 60): 4,482; 8,311; 38,552; 7,572; 44,777;
  6,715; 16,005.
- **By kind:** 21,452 start with a capital (names and proper nouns); 34,655 hold an apostrophe (mostly
  possessives); 306 have a letter outside ASCII; none is hyphenated.
- **What it lacks, by kind:** see the lists above. In short: names (people beyond the commonest English
  ones, companies founded or renamed since about 2015, games, the open-source tools she writes about),
  technology words, words from the last ten years, most identity words beyond the handful added by hand,
  most accented loanwords and names, informal contractions and internet slang.

## Decided

1. **American, British or both?** American, as it was; British stays a choice in the checking settings.
   Both, and a choice per document, were not taken.
2. **On or off by default?** On, with spelling alone, for a writer who has never set checking; whoever
   switched it off keeps it off. The cost is the 230 KB word list fetched when mdQuire first opens a
   document in a browser, then cached.
3. **A personal dictionary.** Kept in the browser, listed in Personal dictionary with Remove, and exported
   and imported as a plain text file, one word to a line. It is not kept in the document or in the
   repository: a word she adds is known in every document in this browser, and another browser has its
   own (the text file carries it there).
4. **Names.** A small built-in list, `names.ts`, of her name, her projects' (mdQuire, imgQuire, Playmatter,
   Mote), the typefaces (Torrens, Fraunces) and the tools and places she writes about, known in every
   document from the start; add to it as she names new things. Names are not learned from the document.
5. **The browser's own checker alongside.** Settled by the two above: spelling being on from the start,
   the browser's checker is off in the document from the start too (two sets of underlines would
   disagree), and is put back only where the word list fails to load. It still checks the title and the
   fields (caption, alt text, components), which mdQuire's does not.

## Still open

Each with its options and what it would cost.

1. **"Ignore once" against "ignore in this document".** Today only the second exists and it is permanent
   and unlisted. "Ignore once" (forgotten when the document closes) is a button and a set kept in memory;
   a list of what is ignored, with undo, is a little more.
2. **A per-document language.** Read from frontmatter (`lang: en-GB`) or chosen in the document's
   settings; a document in another language could switch spelling off rather than flag every word.
   Small for English variants; another language needs another word list (below).
3. **A bigger or a second word list.** SCOWL's size 70 adds roughly 40,000 rarer words and size 80 roughly
   125,000 more (about 75 KB and 230 KB more on the wire, by the current file's bytes a word); each makes
   a misspelling more likely to be "a word" by accident. A second list of the site's own (names,
   technology, identity, recent words) is small (a few thousand words, a few KB) and is what the rebuild
   is meant to be; it could be built from the site's content at build time. Accented words: SCOWL has
   lists of them the build does not read today.
4. **More names.** Her posts name about fifty more than `names.ts` holds (the tools and people above):
   added by hand, or built from her content at build time. Learning them from the document (a capitalised
   word used three times taken as a name) hides real misspellings of names.
5. **Phonetic suggestions.** Today only seven sound-alike letter pairs: fone, nolej, enuff, bizness and
   skool get nothing (10 of 30 sound-spelled words absent). A phonetic key (a Metaphone written here)
   would add a second index of about the list's size in memory and a few ms a suggestion.
6. **Grammar beyond spelling.** Today: a word twice, long sentences and paragraphs, stock phrases, weak
   openings, the passive (off), adverbs piled up, quotation marks of two kinds, small first letters.
   More (agreement, its and it's, their and there, a and an) is rule by rule, each with false alarms to
   weigh.
7. **The other kinds by default.** A new writer has spelling alone; whether Markdown tidiness, links and
   pictures, or the writing rules should also start on.

Also to settle with the above: whether words in all capitals or with a capital inside should be checked
(RECIEVE, TEh are never flagged today), whether hyphenated words should be accepted when the joined form
is a word (pre-order, Wi-Fi), whether the title and frontmatter should be spelled, and the wording "This
row has 1 cells" in the Markdown rules (a plural she may want changed).

## How it was measured

Scripts kept outside the repository, run with `bun` on the night's tree and on a copy of `main`: the
audit's hundred misspellings (now `src/quire/check/misspellings-audit.fixture.txt`), the repo's fixture,
thirty sound-spelled words, keyboard slips made from her blog's words (a neighbouring QWERTY key, or two
letters swapped), her posts and pages through the real reader and the spelling rule (drafts on hold left
out; words counted outside frontmatter, code fences and imports), the audit's eight stress texts, and
5,963 two-letter swaps of 1,200 words from her pages for slurs and splits in the first three suggestions.
