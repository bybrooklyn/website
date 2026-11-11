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
}

/** In the order set by each project's `order`. Drafts are left out of production builds. */
export async function getProjects(): Promise<Project[]> {
    const projects = await getCollection("projects", visible);
    return projects.sort((a, b) => a.data.order - b.data.order);
}

/** What `bun run projects` last read from GitHub, if anything. */
export function projectFacts(project: Project): ProjectFacts | undefined {
    return (facts as Record<string, ProjectFacts>)[project.id];
}
