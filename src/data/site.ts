export const site = {
    name: "Charlotte",
    pronouns: "she/her",
    location: "New Jersey, USA",
    description: "Charlotte's website: Playmatter, other projects, and a blog.",
    /** The paragraph under the name on the homepage. */
    about: "I'm a queer programmer in New Jersey who likes building things. Right now that's mostly Playmatter. The rest of the time I'm writing Rust, running my own servers, modding games and messing with emulators, all from Linux. Nearly everything I make is open source, and this site doesn't track you.",
    email: "you@bybrooklyn.dev",
    github: "https://github.com/bybrooklyn",
    /** Where this site's own code lives. */
    source: "https://github.com/bybrooklyn/website",
    discord: "https://discord.com/users/909082197712068619",
    playmatter: "https://playmatter.io",
} as const;

export const nav = [
    { href: "/about/", label: "about" },
    { href: "/blog/", label: "blog" },
    { href: "/projects/", label: "projects" },
    { href: "/setup/", label: "setup" },
    { href: "/resume/", label: "resume" },
] as const;
