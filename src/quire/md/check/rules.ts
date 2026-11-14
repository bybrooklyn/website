// Every checking rule in one list, in the order the settings show them. view.ts checks with it, and
// rules.test.ts holds every rule in it to never throwing, never taking long and offering only fixes
// that change exactly what they say.

import type { Rule } from "./engine";
import { LINKS } from "./links";
import { MARKDOWN } from "./markdown";
import { PROSE } from "./prose";
import { SPELLING } from "./spelling";
import { WRITING } from "./writing";

/** Every rule, in the order the settings list them. */
export const RULES: Rule[] = [...SPELLING, ...MARKDOWN, ...LINKS, ...WRITING, ...PROSE];
