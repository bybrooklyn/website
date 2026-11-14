// The names the site is full of, which no dictionary holds: her projects, her name, the tools and
// places she writes about. The spelling check knows them, and the browser's own spelling, which
// cannot be taught a word, is told to leave them alone where they are drawn (surface.ts marks each
// with spellcheck off) and in the title (title.ts). Gathered from the site's posts, projects and
// pages; add to it as she names new things.

/** Every name, as it is written. */
export const NAMES: readonly string[] = [
    // hers and her projects'
    "charlotte", "Charlotte", "bybrooklyn", "mdQuire", "imgQuire", "Quire", "Mote", "Plinko", "Celeste", "SmoothCeleste", "Spectrum", "Flummox", "Playmatter", "OpenBitDo", "SwiftyV", "TypeTester", "TypeSpecimen", "tonetags",
    // the typefaces the site sets
    "Torrens", "Fraunces",
    // tools and places she writes about
    "Astro", "Bun", "TypeScript", "JavaScript", "Rust", "Luau", "Zola", "Kirigami", "Cloudflare", "Tailscale", "Jellyfin", "Homebrew", "CachyOS", "Ubuntu", "Linux", "GitHub", "YouTube", "Bandcamp", "LinkedIn", "DropBox", "Dropbox", "Terraria", "SwiftUI", "Oklch", "OKLCH", "Markdown", "Wrangler", "Portainer", "Mermaid", "KaTeX", "Parakeet", "Whisper", "WebGPU", "WebAssembly", "Chromium",
];

const lower = new Set(NAMES.map((name) => name.toLowerCase()));

/** True for a word that is one of the names, whatever its capitals. */
export function isName(word: string): boolean {
    return lower.has(word.replace(/['’]s$/, "").toLowerCase());
}

/** Where the names are in some text, as ranges of it, whole words only. */
export function namesIn(text: string): [number, number][] {
    const found: [number, number][] = [];
    for (const match of text.matchAll(/[\p{L}][\p{L}\p{N}]*/gu)) if (isName(match[0])) found.push([match.index, match.index + match[0].length]);
    return found;
}
