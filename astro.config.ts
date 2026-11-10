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
