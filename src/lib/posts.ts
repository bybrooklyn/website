// The blog's posts, newest first, and how a date and a reading time are written.
import { getCollection, type CollectionEntry } from "astro:content";
import { visible } from "./drafts";

export type Post = CollectionEntry<"blog">;

/** Newest first. Drafts are left out of production builds. */
export async function getPosts(): Promise<Post[]> {
    const posts = await getCollection("blog", visible);
    return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Whether there is anything to list: the blog page, its links and the feed wait for a first post. */
export const hasPosts = async (): Promise<boolean> => (await getPosts()).length > 0;

const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function formatDate(date: Date): string {
    return dateFormat.format(date);
}

/** Minutes to read a post, at 220 words a minute. */
export function readingTime(post: Post): string {
    const words = (post.body ?? "").split(/\s+/).filter(Boolean).length;
    return `${Math.max(1, Math.round(words / 220))} min read`;
}
