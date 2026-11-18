// What each kind of content on the site is made of: posts, minis, pages, projects, the resume, and what she likes.
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { accentNames } from "./data/theme";

/**
 * A post being held back has `.hold` in its file name. It is never committed and is shown on the
 * dev server only: every build leaves it out, the drafts build too, whether it is a draft or not.
 */
const HELD = "!**/*.hold.{md,mdx}";

const blog = defineCollection({
    loader: glob({ base: "./src/content/blog", pattern: import.meta.env.DEV ? "**/*.{md,mdx}" : ["**/*.{md,mdx}", HELD] }),
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
                /**
                 * A page of the site that is the project itself, such as /spectrum/. The list and the
                 * links between projects go there, no page is built at /projects/<name>/, and the page
                 * named here shows this file's words under the thing.
                 */
                opens: z
                    .string()
                    .regex(/^\/[a-z0-9-]+\/$/, "A site path such as /spectrum/.")
                    .optional(),
                draft: z.boolean().default(false),
            })
            .refine((project) => !project.cover || project.coverAlt, { message: "A project with a cover needs coverAlt." }),
});

/** Standalone long-form pages: /setup/, /bio/. The file name is the address. */
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
        /** It puts buttons and text under itself, so room is kept for them while it loads. */
        panel: z.boolean().default(false),
        /** Position in the list, lowest first. */
        order: z.number(),
        draft: z.boolean().default(false),
    }),
});

/**
 * What she likes, on /interests/: a game, a film, a show, or music. The file name is its address
 * under /interests/, and the words in the file are hers: why she loves it and her history with it.
 * The facts are looked up and kept here beside them.
 */
const interests = defineCollection({
    loader: glob({ base: "./src/content/interests", pattern: "*.mdx" }),
    schema: ({ image }) =>
        z.object({
            name: z.string(),
            /** One line of hers, for the list and the top of its page. */
            summary: z.string(),
            section: z.enum(["games", "movies", "shows", "music"]),
            /** What it is, in a word, for the small line above its name: game, film, show, artist. */
            kind: z.string(),
            /** When it came out or ran, for the same small line. Left out for an artist. */
            when: z.string().optional(),
            /** Position in its section, lowest first: the order she listed them in. */
            order: z.number(),
            /** A favorite comes first in its section and says so in its small line; an honorable mention comes last. */
            rank: z.enum(["favorite", "honorable mention"]).optional(),
            /** The game's cover, the film's poster, the album's sleeve. */
            cover: image(),
            /** What the cover shows, for people who cannot see it. */
            coverAlt: z.string(),
            /**
             * Its trailer. A copy plays on the page when one has been made: the copies are kept on the
             * owner's computer in public/videos/interests/<name>.mp4 and are not in the repository.
             */
            video: z
                .object({
                    /** What the video is, in words that finish "play …": "the launch trailer". */
                    what: z.string(),
                    /** Where the original is, linked under the player. The label finishes "The original is on …". */
                    source: z.object({ href: z.url(), label: z.string() }),
                })
                .optional(),
            /** For music: where a piece of it can be heard, in its maker's own place. */
            listen: z.object({ what: z.string(), href: z.url(), label: z.string() }).optional(),
            /** Who made it, when, where it runs or aired, each a label and what it is. */
            facts: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
            /** Where to find it: its store page, the artist's own page. */
            links: z.array(z.object({ href: z.url(), label: z.string() })).default([]),
        }),
});

/**
 * The parts of /interests/: games, movies and shows, music, hobbies. Each file is a heading and, under
 * it, her own words for that part; a part with `groups` then shows the tiles of those kinds, and one
 * without (hobbies) is its words alone.
 */
const interestParts = defineCollection({
    loader: glob({ base: "./src/content/interests/parts", pattern: "*.mdx" }),
    schema: z.object({
        title: z.string(),
        /** Position on the page, lowest first. */
        order: z.number(),
        /** Which kinds of thing are tiled under the words, in order. With more than one, each is labelled. */
        groups: z.array(z.enum(["games", "movies", "shows", "music"])).default([]),
    }),
});

export const collections = { blog, interestParts, interests, minis, pages, projects, resume };
