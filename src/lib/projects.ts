// The projects, in order, and what was last read about each from GitHub.
import { getCollection, type CollectionEntry } from "astro:content";
import facts from "../data/project-facts.json";
import { visible } from "./drafts";

export type Project = CollectionEntry<"projects">;

export interface ProjectFacts {
    license: string | null;
    stars: number;
    forks: number;
    release: string | null;
    updated: string;
    public: boolean;
    /** What the repository is written in, as GitHub counts it: each language and its share of the code, largest first. */
    languages?: [name: string, share: number][];
}

/** In the order set by each project's `order`. Drafts are left out of production builds. */
export async function getProjects(): Promise<Project[]> {
    const projects = await getCollection("projects", visible);
    return projects.sort((a, b) => a.data.order - b.data.order);
}

/** What `bun run projects` last read from GitHub, if anything. */
export function projectFacts(project: Project): ProjectFacts | undefined {
    // (the data file gives each language as a plain list of two, which is what a name and a share are)
    return (facts as unknown as Record<string, ProjectFacts>)[project.id];
}
