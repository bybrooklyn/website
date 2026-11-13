// Links in the writing. A web address pasted over selected words links them (surface.ts asks
// webAddress what counts as one). What counts is pure and tested.

/** The address, trimmed, when a pasted text is one web address and nothing else: http, https or mailto, never another scheme such as javascript:. */
export function webAddress(text: string): string | undefined {
    const address = text.trim();
    if (!/^(https?:\/\/|mailto:)[^\s<>"`]+$/i.test(address)) return undefined;
    const url = parse(address);
    if (!url) return undefined;
    return url.protocol === "mailto:" ? (/^[^@/]+@[^@/]+\.[^@/]+$/.test(url.pathname) ? address : undefined) : url.hostname ? address : undefined;
}

const parse = (href: string): URL | undefined => {
    try {
        return new URL(href);
    } catch {
        return undefined;
    }
};
