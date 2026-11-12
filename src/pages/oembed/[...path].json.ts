// A small file per post, project and mini that Discord reads for the line above an embed's title.
// Document.astro links to it from the page's head.

import type { APIRoute, GetStaticPaths } from "astro";
import { site } from "../../data/site";
import { getMinis } from "../../lib/minis";
import { getPosts } from "../../lib/posts";
import { getProjects } from "../../lib/projects";
import { miniFacts, postFacts, projectShare, type Fact } from "../../lib/share";

export const getStaticPaths = (async () => {
    const page = (path: string, facts: Fact[]) => ({ params: { path }, props: { facts } });
    return [
        page("site", []),
        ...(await getPosts()).map((post) => page(`blog/${post.id}`, postFacts(post))),
        ...(await getProjects()).map((project) => page(`projects/${project.id}`, projectShare(project))),
        ...(await getMinis()).map((mini) => page(`minis/${mini.id}`, miniFacts(mini))),
    ];
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ facts: Fact[] }> = ({ props, site: address }) =>
    Response.json({
        version: "1.0",
        type: "link",
        provider_name: site.name.toLowerCase(),
        provider_url: address,
        ...(props.facts.length > 0 && { author_name: props.facts.map(([, value]) => value).join(" · ") }),
    });
