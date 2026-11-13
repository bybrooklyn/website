// After a build, checks that every inline script and style on every page is
// one the page's own content security policy allows. Astro works the policy
// out by itself, but it can miss a style that comes from a component used
// inside Markdown, or a script written `is:inline`; the browser would then
// block it without a word. Better that the build stops and says which.

import type { AstroIntegration } from "astro";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

function pages(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? pages(join(folder, entry.name)) : entry.name.endsWith(".html") ? [join(folder, entry.name)] : [],
    );
}

const unescape = (text: string) => text.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * What in one built page its policy would block. A page with no policy at all is let through only if
 * it runs no script (the mdQuire lab's mock-ups are plain pages of markup and style); one that runs
 * script without a policy has lost it somewhere, and that is a problem too.
 */
export function problemsIn(html: string): string[] {
    const problems: string[] = [];
    const policy = /http-equiv="content-security-policy" content="([^"]*)"/.exec(html)?.[1];
    if (!policy) return /<script(?![^>]*application\/(ld\+)?json)[^>]*>/.test(html) ? ["a page with script and no content security policy"] : [];
    const allowed = new Set([...unescape(policy).matchAll(/'sha256-([^']+)'/g)].map((match) => match[1]));
    for (const [, tag, attributes = "", body = ""] of html.matchAll(/<(style|script)([^>]*)>([\s\S]*?)<\/\1>/g)) {
        if (tag === "script" && /\ssrc=|application\/(ld\+)?json/.test(attributes)) continue;
        if (!body.trim()) continue;
        const hash = createHash("sha256").update(body).digest("base64");
        if (!allowed.has(hash)) problems.push(`a <${tag}> starting "${body.trim().slice(0, 60)}"`);
    }
    return problems;
}

export default function cspCheck(): AstroIntegration {
    return {
        name: "csp-check",
        hooks: {
            "astro:build:done": ({ dir }) => {
                const built = fileURLToPath(dir);
                const problems: string[] = [];
                for (const page of pages(built)) {
                    for (const problem of problemsIn(readFileSync(page, "utf8"))) problems.push(`${relative(built, page)}: ${problem}`);
                }
                if (problems.length > 0) {
                    throw new Error(
                        `These would be blocked by the page's content security policy:\n  ${problems.join("\n  ")}\n` +
                            "A style from a component used inside Markdown has to be imported by the page that renders it; " +
                            "an inline script needs its hash in astro.config.ts.",
                    );
                }
            },
        },
    };
}
