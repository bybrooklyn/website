// The site's own components in an MDX file, as cards: a raw block that is a single JSX tag of a
// component (a name with a capital, `<Figure ... />`, `<Moment when="2025">`, `</Moment>`) is shown
// as a card naming it and its properties, each a field. Changing a field changes only that
// property's value in the text; everything else in the tag stays as written. Nothing is rendered
// live. For the site's own blocks (Figure, Terminal, Timeline with its Moments, PlayHere) the card
// also offers the properties they take that are not yet given, and the slash menu makes them.

/** One property of a tag as written: its name, its value, and where the value sits in the text. */
export interface Prop {
    name: string;
    /** A string's text, an expression's inside (without its braces), or "" for a bare flag. */
    value: string;
    kind: "string" | "expression" | "flag";
    /** Where the whole property sits in the tag's text, from its name to the end of its value. */
    from: number;
    to: number;
}

/** A tag read from a raw block. */
export interface Tag {
    name: string;
    kind: "open" | "self" | "close";
    props: Prop[];
    /** Where the props end: the index of the `/>` or `>`. */
    end: number;
}

/** What each of the site's own components takes, in the order its card shows them, and which are flags. */
export const KNOWN: Record<string, { props: string[]; flags?: string[]; numbers?: string[]; about: string }> = {
    Figure: { props: ["src", "alt", "width", "height", "caption", "video", "pixel", "eager"], flags: ["pixel", "eager"], numbers: ["width", "height"], about: "A picture, or a short clip, with a caption" },
    Terminal: { props: ["cast", "title", "caption"], about: "A recording of a terminal, played back" },
    Timeline: { props: [], about: "Moments to step through, one at a time" },
    Moment: { props: ["when", "chapter"], about: "One moment of a timeline" },
    PlayHere: { props: ["src", "title", "from", "ratio", "label"], about: "A game from elsewhere, played in place when asked" },
};

/** Reads a raw block's text as one component tag, or gives undefined if it is anything else. */
export function readTag(text: string): Tag | undefined {
    const source = text.trimEnd();
    const close = /^<\/([A-Z][\w.]*)\s*>$/.exec(source);
    if (close) return { name: close[1]!, kind: "close", props: [], end: source.length - 1 };
    const open = /^<([A-Z][\w.]*)/.exec(source);
    if (!open) return undefined;
    const props: Prop[] = [];
    let at = open[0].length;
    for (;;) {
        const space = /^\s*/.exec(source.slice(at))![0];
        at += space.length;
        if (source.startsWith("/>", at)) return at + 2 === source.length ? { name: open[1]!, kind: "self", props, end: at } : undefined;
        if (source[at] === ">") return at + 1 === source.length ? { name: open[1]!, kind: "open", props, end: at } : undefined;
        if (space === "") return undefined;
        const name = /^[A-Za-z_][\w-]*/.exec(source.slice(at))?.[0];
        if (!name) return undefined;
        const from = at;
        at += name.length;
        if (source[at] !== "=") {
            props.push({ name, value: "", kind: "flag", from, to: at });
            continue;
        }
        at++;
        const quote = source[at];
        if (quote === '"' || quote === "'") {
            const end = source.indexOf(quote, at + 1);
            if (end < 0) return undefined;
            props.push({ name, value: source.slice(at + 1, end), kind: "string", from, to: end + 1 });
            at = end + 1;
        } else if (quote === "{") {
            let depth = 0;
            let end = at;
            for (; end < source.length; end++) {
                if (source[end] === "{") depth++;
                else if (source[end] === "}" && --depth === 0) break;
            }
            if (end >= source.length) return undefined;
            props.push({ name, value: source.slice(at + 1, end), kind: "expression", from, to: end + 1 });
            at = end + 1;
        } else return undefined;
    }
}

/** How a property is written: a string in double quotes, an expression in braces, a flag as its name. */
function written(name: string, value: string, kind: Prop["kind"]): string {
    if (kind === "flag") return name;
    if (kind === "expression") return `${name}={${value}}`;
    return `${name}="${value.replace(/"/g, "&quot;")}"`;
}

/**
 * Sets one property of the tag in a raw block's text and gives the new text. A string or expression
 * keeps its kind; true sets a flag and false takes it away; a property not there is added before the
 * tag's end. Only that property's text changes.
 */
export function setProp(text: string, name: string, value: string | boolean): string {
    const tag = readTag(text);
    if (!tag || tag.kind === "close") return text;
    const found = tag.props.find((prop) => prop.name === name);
    if (value === false) {
        if (!found) return text;
        // the property goes with the space before it
        let from = found.from;
        while (from > 0 && /\s/.test(text[from - 1]!)) from--;
        return text.slice(0, from) + text.slice(found.to);
    }
    if (found) {
        if (value === true) return text;
        return text.slice(0, found.from) + written(name, value, found.kind === "flag" ? "string" : found.kind) + text.slice(found.to);
    }
    if (value === "") return text;
    const numbers = KNOWN[tag.name]?.numbers ?? [];
    const piece = value === true ? name : written(name, value, numbers.includes(name) && /^-?\d+(\.\d+)?$/.test(value) ? "expression" : "string");
    // before the end, with a space after the last property unless the tag already has one there
    let end = tag.end;
    while (end > 0 && /\s/.test(text[end - 1]!)) end--;
    const after = text.slice(end, tag.end);
    return `${text.slice(0, end)} ${piece}${after === "" && tag.kind === "self" ? " " : after}${text.slice(tag.end)}`;
}

/** The fields a card shows: every property given, then those a site component takes that are not given yet. */
export function fieldsOf(tag: Tag): { name: string; value: string; kind: Prop["kind"] | "missing"; flag: boolean }[] {
    const known = KNOWN[tag.name];
    const given = tag.props.map((prop) => ({ name: prop.name, value: prop.value, kind: prop.kind as Prop["kind"] | "missing", flag: prop.kind === "flag" || !!known?.flags?.includes(prop.name) }));
    const missing = (known?.props ?? []).filter((name) => !tag.props.some((prop) => prop.name === name)).map((name) => ({ name, value: "", kind: "missing" as const, flag: !!known?.flags?.includes(name) }));
    const order = known?.props ?? [];
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    return [...given, ...missing].sort((a, b) => rank(a.name) - rank(b.name));
}

/** What a new site component is written as when the slash menu makes it: the tags, one raw block each, with paragraphs to write in between. */
export const TEMPLATES: Record<string, (string | null)[]> = {
    Figure: ['<Figure src="" alt="" width={960} height={540} />'],
    Terminal: ['<Terminal cast="" title="" />'],
    Timeline: ["<Timeline>", '<Moment when="">', null, "</Moment>", "</Timeline>"],
    PlayHere: ['<PlayHere src="" title="" from="">', null, "</PlayHere>"],
};

/** The import line a site component needs in a post, from src/content/<collection>/. */
export function importFor(name: string): string {
    const path = `../../components/${name}.astro`;
    return `import ${name} from ${JSON.stringify(path)};`;
}
