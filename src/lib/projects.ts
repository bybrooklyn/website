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
}

/** In the order set by each project's `order`. Drafts are left out of production builds. */
export async function getProjects(): Promise<Project[]> {
    const projects = await getCollection("projects", visible);
    return projects.sort((a, b) => a.data.order - b.data.order);
}

/** Where a project's page is: the page it opens, if it has one, and otherwise its page under /projects/. */
export const projectPage = (project: Project): string => project.data.opens ?? `/projects/${project.id}/`;

/** The pages that projects open, which are opened pages like a project's own. */
export async function openedPages(): Promise<string[]> {
    return (await getProjects()).flatMap((project) => (project.data.opens ? [project.data.opens] : []));
}

/** What `bun run projects` last read from GitHub, if anything. */
export function projectFacts(project: Project): ProjectFacts | undefined {
    return (facts as Record<string, ProjectFacts>)[project.id];
}
