// The facts about the site and its owner that pages use: her name, where things are, the menu.
export const site = {
    name: "Charlotte",
    /** Shown on the resume. */
    lastName: "Halmstad",
    pronouns: "she/her",
    location: "New Jersey, USA",
    /** The clock she keeps, for the about page. */
    time: "Eastern Time (New York)",
    description: "Charlotte's website: Playmatter, other projects, and a blog.",
    /** The paragraph under the name on the homepage. */
    about: "I'm a queer programmer in New Jersey who likes building things. Right now that's mostly Playmatter. The rest of the time I'm writing Rust, running my own servers, modding games and messing with emulators, all from Linux. Nearly everything I make is open source, and this site doesn't track you.",
    email: "you@bybrooklyn.dev",
    github: "https://github.com/bybrooklyn",
    /** Where this site's own code lives. */
    source: "https://github.com/bybrooklyn/website",
    discord: "https://discord.com/users/909082197712068619",
    playmatter: "https://playmatter.io",
    /** What she is working on now, for the homepage, in order: a project's file name, or "site" for this website. */
    working: ["playmatter", "mfetchy", "site", "yqt", "laude"],
} as const;

export const nav = [
    { href: "/about/", label: "about" },
    { href: "/blog/", label: "blog" },
    { href: "/projects/", label: "projects" },
    { href: "/minis/", label: "minis" },
    { href: "/photos/", label: "photos" },
    { href: "/setup/", label: "setup" },
    { href: "/resume/", label: "resume" },
] as const;
