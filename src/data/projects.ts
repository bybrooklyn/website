export type ProjectStatus = "active" | "paused" | "archived";

export interface Project {
    name: string;
    license: string;
    url: string;
    description: string;
    /** Omitted where the project's main language isn't settled — fill these in. */
    language?: string;
    /** Omitted means "nothing worth flagging"; rendered as a tag when set. */
    status?: ProjectStatus;
}

export const projects: Project[] = [
    {
        name: "OpenBitDo",
        license: "BSD 3",
        url: "https://github.com/bybrooklyn/openbitdo",
        description: "8BitDo controller and keyboard utility for GNU/Linux and macOS",
    },
    {
        name: "Wavry",
        license: "AGPL 3",
        url: "https://github.com/bybrooklyn/wavry",
        description: "Open source low-latency remote desktop designed with Linux and Wayland in mind",
    },
    {
        name: "Oopsies",
        license: "Apache 2.0",
        url: "https://github.com/bybrooklyn/Oopsies",
        description: "Web framework for backend developers to build frontends without writing HTML or CSS",
        language: "TypeScript",
    },
    {
        name: "Alchemist",
        license: "GPL 3",
        url: "https://github.com/bybrooklyn/alchemist",
        description: "Open-source video transcoding system",
    },
    {
        name: "Breeze",
        license: "MIT",
        url: "https://github.com/bybrooklyn/breeze",
        description: "Incredibly lightweight strictly typed and compiled programming language",
    },
    {
        name: "Nx86",
        license: "GPL 3+",
        url: "https://github.com/nx86-emu/nx86",
        description: "The wet dream of Switch emulators, compiling software ahead of time",
    },
    {
        name: "ExtraStimulantsPlus",
        license: "MIT",
        url: "https://github.com/bybrooklyn/ExtraStimulantsPlus",
        description: "Modloader, level editor, and optimizations for the game Sensory Overload",
        status: "paused",
    },
    {
        name: "Bybrooklyn.dev",
        license: "CC-BY-SA 4",
        url: "https://github.com/bybrooklyn/website",
        description: "The website you're reading right now!",
        language: "Astro",
    },
];
