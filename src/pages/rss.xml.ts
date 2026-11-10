import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { site } from "../data/site";
import { getPosts } from "../lib/posts";

export const GET: APIRoute = async (context) => {
    const posts = await getPosts();
    return rss({
        title: `${site.name}'s blog`,
        description: site.description,
        site: context.site!,
        items: posts
            .filter((post) => !post.data.draft)
            .map((post) => ({
                title: post.data.title,
                description: post.data.summary,
                pubDate: post.data.date,
                link: `/blog/${post.id}/`,
            })),
    });
};
