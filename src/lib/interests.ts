// What she likes, for /interests/: the games, films, shows and music, in the order she listed them.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCollection, type CollectionEntry } from "astro:content";
import { showDrafts } from "./drafts";

export type Interest = CollectionEntry<"interests">;
export type Section = Interest["data"]["section"];

/**
 * The page is a draft: it is shown on the dev server and in a build made with SHOW_DRAFTS=1, and no
 * other build makes it or links to it. Every word on it is to be read by the owner first; when she
 * has, this becomes false and the page goes out with the next build.
 */
const DRAFT = true;

/** Whether /interests/ and the screens under it are built. */
export const interestsShown: boolean = showDrafts || !DRAFT;

/** A favorite first, an honorable mention last, and between them the order she gave. */
const place = (interest: Interest): number => (interest.data.rank === "favorite" ? -1 : interest.data.rank === "honorable mention" ? 1 : 0);

/** Everything she likes that has a screen, each section in its order. */
export async function getInterests(): Promise<Interest[]> {
    if (!interestsShown) return [];
    const all = await getCollection("interests");
    return all.sort((a, b) => place(a) - place(b) || a.data.order - b.data.order);
}

/** One section's things, in order. */
export const inSection = (all: Interest[], section: Section): Interest[] => all.filter((interest) => interest.data.section === section);

export type Part = CollectionEntry<"interestParts">;

/** The parts of the page, in order: each a heading, her words, and the kinds of thing tiled under them. */
export async function getParts(): Promise<Part[]> {
    const parts = await getCollection("interestParts");
    return parts.sort((a, b) => a.data.order - b.data.order);
}

/**
 * The address of a thing's own copy of its trailer, if one has been made. The copies are other people's
 * videos, encoded small, kept in public/videos/interests/ on the owner's computer and never committed
 * (docs/interests.md): where the file is missing, the page shows the cover and a link to the original.
 */
export function videoOf(interest: Interest): string | undefined {
    const made = existsSync(join(process.cwd(), "public", "videos", "interests", `${interest.id}.mp4`));
    return made && interest.data.video ? `/videos/interests/${interest.id}.mp4` : undefined;
}

/** The small line above a thing's name: what it is, when, and its rank if it has one. */
export const metaOf = (interest: Interest): string[] => [interest.data.kind, interest.data.when, interest.data.rank].filter((word): word is string => Boolean(word));
