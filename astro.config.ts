import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
    site: "https://bybrooklyn.dev",
    trailingSlash: "always",
    build: {
        format: "directory",
        // The stylesheets are small, and a page that carries its own styles
        // can be drawn after one round trip instead of three.
        inlineStylesheets: "always",
    },
    // Start fetching a page as soon as a link to it is hovered, focused or
    // touched. Astro holds back by itself on data-saving or very slow connections.
    prefetch: {
        prefetchAll: true,
        defaultStrategy: "hover",
    },
    integrations: [
        mdx(),
        sitemap(),
    ],
    markdown: {
        processor: satteri({
            features: { smartPunctuation: true },
        }),
        shikiConfig: {
            // Code takes its colors from the theme; see tokens.css.
            theme: "css-variables",
            wrap: false,
        },
    },
});
