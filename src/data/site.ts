// The facts about the site and its owner that pages use: her name, where things are, the menu.
export const site = {
    name: "Charlotte",
    /** Shown on the resume. */
    lastName: "Halmstad",
    pronouns: "she/her",
    location: "New Jersey, USA",
    /** The languages she speaks, in her words (12 Nov 2026: "i speak english only, and i have plans to learn another language"). */
    speaks: "English only. I plan to learn another.",
    /** Why there is no LinkedIn, in her words (12 Nov 2026), on the about page; the first sentence alone is on the resume. */
    linkedin: {
        short: "I don't have a LinkedIn and won't make one.",
        why: "It's a monopoly, and it's trying to make people pay to get discovered. I think I should be hired for me, not because I have a glowing LinkedIn page that I pay for.",
    },
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
