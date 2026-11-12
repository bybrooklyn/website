// The three mock-ups of mdQuire's writing screen (design/mdquire/a.html, b.html, c.html), served at
// /mdquire-lab/a.html and so on so that she can open them on her dev server from the lab page. Each
// file is kept standalone on the disk; here its two stylesheets are put inside it and its fonts are
// pointed at the site's own copies. Unlisted, as the lab is.
import type { APIRoute, GetStaticPaths } from "astro";
import a from "../../../design/mdquire/a.html?raw";
import b from "../../../design/mdquire/b.html?raw";
import c from "../../../design/mdquire/c.html?raw";
import lab from "../../../design/mdquire/lab.css?raw";
import mock from "../../../design/mdquire/mock.css?raw";
import drafting from "../../assets/fonts/drafting-mono.woff2?url";
import italic from "../../assets/fonts/torrens-serif-italic.woff2?url";
import torrens from "../../assets/fonts/torrens-serif.woff2?url";

const pages: Record<string, string> = { a, b, c };

export const getStaticPaths = (() => Object.keys(pages).map((mock) => ({ params: { mock } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
    const fonts = mock
        .replace("../../src/assets/fonts/torrens-serif.woff2", torrens)
        .replace("../../src/assets/fonts/torrens-serif-italic.woff2", italic)
        .replace("../../src/assets/fonts/drafting-mono.woff2", drafting);
    const page = (pages[params.mock ?? ""] ?? "")
        .replace('<link rel="stylesheet" href="mock.css" />', () => `<style>${fonts}</style>`)
        .replace('<link rel="stylesheet" href="lab.css" />', () => `<style>${lab}</style>`);
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
