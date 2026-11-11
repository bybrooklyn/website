import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { accentNames } from "./data/theme";

const blog = defineCollection({
    loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
    schema: ({ image }) =>
        z
            .object({
                title: z.string(),
                /** A date, or a date and time (2026-11-10T19:55Z, the clock time with a Z) so posts from one day keep their order. Only the date is shown. */
                date: z.coerce.date(),
                summary: z.string(),
                /** The color of links and marks on this post. Violet if left out. */
                accent: z.enum(accentNames).optional(),
                /** A picture for the top of the post and the blog list, as a path to a file in src/assets. */
                cover: image().optional(),
                /** What the cover shows, for people who cannot see it. */
                coverAlt: z.string().optional(),
                /** Short lowercase words, such as rust or self-hosting. */
                tags: z.array(z.string()).default([]),
                /** What the post draws on, listed beside it. */
                sources: z.array(z.object({ title: z.string(), href: z.url() })).default([]),
                /** Left out of production builds. */
                draft: z.boolean().default(false),
            })
            .refine((post) => !post.cover || post.coverAlt, { message: "A post with a cover needs coverAlt." }),
});

const resume = defineCollection({
    loader: glob({ base: "./src/content/resume", pattern: "*.mdx" }),
    schema: z.object({
        summary: z.string(),
        draft: z.boolean().default(false),
    }),
});

const projects = defineCollection({
    loader: glob({ base: "./src/content/projects", pattern: "*.mdx" }),
    schema: ({ image }) =>
        z
            .object({
                name: z.string(),
                /** One sentence, for the list and the top of the page. */
                summary: z.string(),
                language: z.string(),
                status: z.string().optional(),
                /** owner/name on GitHub. Linked even while the repository is private. Left out if there is no source to point at. */
                repo: z.string().optional(),
                /** Somewhere else worth sending people: a site, a beta, a download. */
                link: z.object({ href: z.url(), label: z.string() }).optional(),
                /** Where to get it. Shown as buttons at the top of the page. */
                get: z.array(z.object({ href: z.url(), label: z.string() })).default([]),
                cover: image().optional(),
                coverAlt: z.string().optional(),
                /** Pixel art: scale the cover without smoothing. */
                pixel: z.boolean().default(false),
                gallery: z.array(z.object({ src: image(), alt: z.string() })).default([]),
                /** Position in the list, lowest first. */
                order: z.number(),
                draft: z.boolean().default(false),
            })
            .refine((project) => !project.cover || project.coverAlt, { message: "A project with a cover needs coverAlt." }),
});

/** Standalone long-form pages: /setup/, /about/. The file name is the address. */
const pages = defineCollection({
    loader: glob({ base: "./src/content/pages", pattern: "*.mdx" }),
    schema: z.object({
        title: z.string(),
        summary: z.string(),
        /** Small text above the title. */
        kicker: z.string().optional(),
        /** Number the chapters, like a manual. */
        numbered: z.boolean().default(false),
        draft: z.boolean().default(false),
    }),
});

/** The tiny demos and games on /minis/. The file name is the address, and names the script in src/minis/ that runs it. */
const minis = defineCollection({
    loader: glob({ base: "./src/content/minis", pattern: "*.mdx" }),
    schema: z.object({
        name: z.string(),
        /** One sentence, for the list and the top of the page. */
        summary: z.string(),
        /** A toy has no goal; a game does. */
        kind: z.enum(["toy", "game"]),
        /** "2D" or "3D". */
        space: z.enum(["2D", "3D"]).default("2D"),
        /** How to play it, in a sentence. Shown under it. */
        controls: z.string(),
        /** Position in the list, lowest first. */
        order: z.number(),
        draft: z.boolean().default(false),
    }),
});

export const collections = { blog, minis, pages, projects, resume };
