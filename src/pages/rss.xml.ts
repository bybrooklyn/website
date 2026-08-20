import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import { site } from "../data/site";

export async function GET(context: APIContext) {
    const posts = await getCollection("blog", ({ data }) => !data.draft);

    return rss({
        title: site.title,
        description: site.description,
        site: context.site!,
        items: posts
            .sort((a, b) => b.data.published.valueOf() - a.data.published.valueOf())
            .map((post) => ({
                title: post.data.title,
                description: post.data.description,
                pubDate: post.data.published,
                link: `/blog/${post.id}/`,
            })),
    });
}
