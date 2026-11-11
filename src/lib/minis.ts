import { getCollection, type CollectionEntry } from "astro:content";
import { visible } from "./drafts";

export type Mini = CollectionEntry<"minis">;

/** In the order set by each mini's `order`. Drafts are left out of production builds. */
export async function getMinis(): Promise<Mini[]> {
    const minis = await getCollection("minis", visible);
    return minis.sort((a, b) => a.data.order - b.data.order);
}
