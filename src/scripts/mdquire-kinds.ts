// The page with two kinds of document on one shelf (src/pages/mdquire-kinds.astro): the core's app
// given mdQuire and the plain note, with a database of its own so that nothing here mixes with the
// documents kept by /mdquire/.

import { accents } from "../data/theme";
import { css } from "../lib/color";
import { startApp } from "../quire/core/app";
import { markdown } from "../quire/md/kind";
import { note } from "../quire/note/note";

const host = document.querySelector<HTMLElement>("#quire");
const names: Record<string, string> = { violet: "Violet", pink: "Pink", blue: "Blue", mint: "Mint", amber: "Amber" };
const colors = Object.entries(accents).map(([key, value]) => ({ name: names[key] ?? key, value: css(value) }));

if (host) void startApp(host, { kinds: [markdown({ colors }), note()], database: "quire-kinds", top: document.querySelector<HTMLElement>(".quire-top") ?? undefined });
