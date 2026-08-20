export type ProjectStatus = "active" | "paused" | "archived";

export interface Project {
    name: string;
    license: string;
    url: string;
    description: string;
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
        language: "Rust",
    },
    {
        name: "Wavry",
        license: "AGPL 3",
        url: "https://github.com/bybrooklyn/wavry",
        description: "Open source low-latency remote desktop designed with Linux and Wayland in mind",
        language: "Rust",
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
        license: "AGPL 3",
        url: "https://github.com/bybrooklyn/alchemist",
        description: "Open-source video transcoding system",
        language: "Rust",
    },
    {
        name: "Breeze",
        license: "MIT",
        url: "https://github.com/bybrooklyn/breeze",
        description: "Incredibly lightweight strictly typed and compiled programming language",
        language: "Rust",
    },
    {
        name: "Nx86",
        license: "GPL 3",
        url: "https://github.com/nx86-emu/nx86",
        description: "The wet dream of Switch emulators, compiling software ahead of time",
        language: "Rust",
    },
    {
        name: "ExtraStimulantsPlus",
        license: "MIT",
        url: "https://github.com/bybrooklyn/ExtraStimulantsPlus",
        description: "Modloader, level editor, and optimizations for the game Sensory Overload",
        language: "GDScript",
        status: "paused",
    },
    {
        name: "Bybrooklyn.dev",
        license: "CC-BY-SA 4",
        url: "https://github.com/bybrooklyn/website",
        description: "The website you're reading right now!",
        language: "Astro",
    },
    {
        name: "Meridian",
        license: "MPL 2.0",
        url: "https://github.com/bybrooklyn/meridian",
        description: "A Rust engine for games and interactive applications",
        language: "Rust",
    },
    {
        name: "crushfs",
        license: "AGPL 3",
        url: "https://github.com/bybrooklyn/crushfs",
        description: "Transparent, general-purpose, user-space compressed filesystem and storage optimizer for macOS",
        language: "Rust",
    },
    {
        name: "sloc",
        license: "Apache 2.0",
        url: "https://github.com/bybrooklyn/sloc",
        description: "Fast project line counter powered by tokei",
        language: "Rust",
    },
    {
        name: "minha",
        license: "Apache 2.0",
        url: "https://github.com/bybrooklyn/minha",
        description: "Token-conscious multi-agent coding harness for ChatGPT Codex and DeepSeek",
        language: "Rust",
        status: "archived",
    },
    {
        name: "VelaChat",
        license: "MIT",
        url: "https://github.com/bybrooklyn/VelaChat",
        description: "A refreshing SwiftUI AI app, inspired by unsloth's",
        language: "Swift",
    },
    {
        name: "malab",
        license: "MIT",
        url: "https://github.com/bybrooklyn/malab",
        description: "Disposable Debian testing ARM64 malware-analysis VM for Apple Silicon",
        language: "Shell",
    },
    {
        name: "SmoothCeleste",
        license: "MIT",
        url: "https://github.com/bybrooklyn/SmoothCeleste",
        description: "Celeste mod that properly unlocks the framerate, built on Motion Smoothing",
        language: "C#",
    },
];
