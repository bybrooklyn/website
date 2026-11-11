// The photographs on /photos/. scripts/photos.ts writes the list
// (src/data/photos.json) and the pictures (public/photos/) from whatever is
// dropped into the photos/ folder.

import data from "../data/photos.json";

export interface Photo {
    /** The picture's file in public/photos/. */
    file: string;
    width: number;
    height: number;
    /** Its main color, shown in its place until it loads. */
    color: string;
    /** The date it was taken, if the picture said. */
    taken?: string;
    caption?: string;
}

/** Newest first; those without a date last. */
export const photos: Photo[] = (data.photos as Photo[]).toSorted((a, b) => (b.taken ?? "").localeCompare(a.taken ?? ""));
