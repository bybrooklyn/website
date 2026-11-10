import { getCollection, type CollectionEntry } from "astro:content";
import { showDrafts } from "./drafts";

export type Post = CollectionEntry<"blog">;

/** Newest first. Drafts are left out of production builds. */
export async function getPosts(): Promise<Post[]> {
    const posts = await getCollection("blog", ({ data }) => showDrafts || !data.draft);
    return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function formatDate(date: Date): string {
    return dateFormat.format(date);
}

/** Whole minutes to read a post, at an unhurried pace. */
export function readingTime(post: Post): string {
    const words = (post.body ?? "").split(/\s+/).filter(Boolean).length;
    return `${Math.max(1, Math.round(words / 220))} min read`;
}
