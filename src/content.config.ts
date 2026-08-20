import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
// astro:content's `z` re-export is deprecated in Astro 7; import zod directly.
import { z } from "zod/v4";

const blog = defineCollection({
    loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        published: z.coerce.date(),
        updated: z.coerce.date().optional(),
        draft: z.boolean().default(false),
    }),
});

export const collections = { blog };
