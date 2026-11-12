// What a page gives a link preview beyond its title and summary: its own picture, and two facts.
// The pictures in src/assets/share/ are made by `bun run pictures`.

import { formatDate, readingTime, type Post } from "./posts";
import type { Mini } from "./minis";
import type { Project } from "./projects";

/** A label and what it says: "Language", "Rust". Slack shows up to two; Discord shows them as one line. */
export type Fact = [label: string, value: string];

const pictures = import.meta.glob<{ default: ImageMetadata }>("../assets/share/*.png", { eager: true });

/** The picture made for a page, by name: `site`, `mini-dice`, `project-yqt`, `post-colophon`. */
export const sharePicture = (name: string): ImageMetadata | undefined => pictures[`../assets/share/${name}.png`]?.default;

export const postFacts = (post: Post): Fact[] => [
    ["Published", formatDate(post.data.date)],
    ["Reading time", readingTime(post)],
];

export const projectShare = (project: Project): Fact[] => [["Language", project.data.language], ...(project.data.status ? [["Status", project.data.status] as Fact] : [])];

export const miniFacts = (mini: Mini): Fact[] => [
    ["Kind", mini.data.kind],
    ["Space", mini.data.space],
];
