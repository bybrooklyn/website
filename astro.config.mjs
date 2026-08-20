// @ts-check
import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
    site: "https://bybrooklyn.dev",
    trailingSlash: "always",
    build: {
        format: "directory",
    },
    // hovering a nav link warms the page before the click lands
    prefetch: {
        prefetchAll: true,
        defaultStrategy: "hover",
    },
    integrations: [sitemap()],
    markdown: {
        // Sätteri is Astro's default processor; smart punctuation is off unless asked for.
        processor: satteri({
            features: { smartPunctuation: true },
        }),
        shikiConfig: {
            theme: "vitesse-dark",
            wrap: false,
        },
    },
});
