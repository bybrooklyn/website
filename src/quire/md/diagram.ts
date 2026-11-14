// Diagrams, drawn by mdQuire's own code as SVG in the site's colors: a modest part of Mermaid's
// flowchart language, from a `mermaid` fence. What it reads:
//
//   the first line   `flowchart TD` or `graph TD`, with TD or TB (top down), LR (left to right),
//                    BT (bottom up) or RL (right to left)
//   nodes            A, A[box], A(rounded), A([pill]), A((circle)), A{diamond}; a label may be in
//                    double quotes, and a node's label is set where it is first given
//   arrows           A --> B, A --- B (a line), A -.-> B (dotted), A ==> B (thick), each with a
//                    label as A -->|label| B or A -- label --> B; and chains, A --> B --> C
//   lines            one statement to a line or several split by `;`; `%%` starts a comment
//
// Anything else (subgraphs, styles, classes, clicks, `&`, other diagram kinds) is not drawn: `diagram`
// gives back null and the surface shows the code as it is. The code is always what is saved.

/** A node's shape. */
export type Shape = "box" | "round" | "pill" | "circle" | "diamond";

/** A node as read: its name, its label and its shape. */
export interface Node {
    id: string;
    label: string;
    shape: Shape;
}

/** An arrow or line as read. */
export interface Edge {
    from: string;
    to: string;
    label: string;
    arrow: boolean;
    line: "solid" | "dotted" | "thick";
}

/** A flowchart as read. */
export interface Flowchart {
    direction: "TD" | "LR" | "BT" | "RL";
    nodes: Node[];
    edges: Edge[];
}

const SHAPES: [string, string, Shape][] = [
    ["((", "))", "circle"],
    ["([", "])", "pill"],
    ["[", "]", "box"],
    ["(", ")", "round"],
    ["{", "}", "diamond"],
];

/** Reads a flowchart, or gives null for anything outside the subset. */
export function readFlowchart(code: string): Flowchart | null {
    const lines = code
        .split(/\r?\n/)
        .map((line) => line.replace(/%%.*$/, "").trim())
        .filter((line) => line !== "");
    const head = /^(?:graph|flowchart)(?:\s+(TD|TB|LR|RL|BT))?\s*;?$/i.exec(lines[0] ?? "");
    if (!head) return null;
    const way = (head[1] ?? "TD").toUpperCase();
    const chart: Flowchart = { direction: way === "TB" ? "TD" : (way as Flowchart["direction"]), nodes: [], edges: [] };
    const known = new Map<string, Node>();
    const node = (id: string, label?: string, shape?: Shape) => {
        let found = known.get(id);
        if (!found) {
            found = { id, label: label ?? id, shape: shape ?? "box" };
            known.set(id, found);
            chart.nodes.push(found);
        } else if (label !== undefined) {
            found.label = label;
            found.shape = shape ?? found.shape;
        }
        return found;
    };
    for (const statement of lines.slice(1).flatMap((line) => line.split(";"))) {
        let rest = statement.trim();
        if (rest === "") continue;
        const first = readNode(rest);
        if (!first) return null;
        node(first.id, first.label, first.shape);
        rest = rest.slice(first.length).trim();
        let from = first.id;
        while (rest !== "") {
            const edge = readEdge(rest);
            if (!edge) return null;
            rest = rest.slice(edge.length).trim();
            const next = readNode(rest);
            if (!next) return null;
            node(next.id, next.label, next.shape);
            chart.edges.push({ from, to: next.id, label: edge.label, arrow: edge.arrow, line: edge.line });
            rest = rest.slice(next.length).trim();
            from = next.id;
        }
    }
    return chart.nodes.length ? chart : null;
}

function readNode(text: string): { id: string; label?: string; shape?: Shape; length: number } | null {
    const name = /^[A-Za-z0-9_]+/.exec(text);
    if (!name) return null;
    let at = name[0].length;
    for (const [open, close, shape] of SHAPES) {
        if (!text.startsWith(open, at)) continue;
        const end = text.indexOf(close, at + open.length);
        if (end < 0) return null;
        let label = text.slice(at + open.length, end).trim();
        if (/^".*"$/.test(label)) label = label.slice(1, -1);
        // a bracket inside a label belongs to some other shape than these
        if (/[[\](){}|]/.test(label)) return null;
        at = end + close.length;
        return { id: name[0], label, shape, length: at };
    }
    // a name standing alone ends at a space, an arrow or the end
    if (at < text.length && !/[\s-=.]/.test(text[at]!)) return null;
    return { id: name[0], length: at };
}

function readEdge(text: string): { label: string; arrow: boolean; line: Edge["line"]; length: number } | null {
    const kinds: [RegExp, boolean, Edge["line"]][] = [
        [/^-->(?:\|([^|]*)\|)?/, true, "solid"],
        [/^---(?:\|([^|]*)\|)?/, false, "solid"],
        [/^-\.->(?:\|([^|]*)\|)?/, true, "dotted"],
        [/^-\.-(?:\|([^|]*)\|)?/, false, "dotted"],
        [/^==>(?:\|([^|]*)\|)?/, true, "thick"],
        [/^===(?:\|([^|]*)\|)?/, false, "thick"],
        [/^--\s+([^-|]+?)\s+-->/, true, "solid"],
        [/^--\s+([^-|]+?)\s+---/, false, "solid"],
        [/^-\.\s+([^.|]+?)\s+\.->/, true, "dotted"],
        [/^==\s+([^=|]+?)\s+==>/, true, "thick"],
    ];
    for (const [pattern, arrow, line] of kinds) {
        const match = pattern.exec(text);
        if (match) return { label: (match[1] ?? "").trim().replace(/^"(.*)"$/, "$1"), arrow, line, length: match[0].length };
    }
    return null;
}

// ---- laying out ----

/** A node with its place and size, its centre at x and y. */
export interface Placed extends Node {
    x: number;
    y: number;
    width: number;
    height: number;
    rank: number;
}

/** How wide a line of label text is drawn, near enough, at the diagram's size. */
const textWidth = (text: string) => Math.max(1, text.length) * 7.4;

/** Gives each node a rank (its step along the flow) and a place in its rank, then a position. */
export function layout(chart: Flowchart): { nodes: Placed[]; width: number; height: number } {
    const index = new Map(chart.nodes.map((node, k) => [node.id, k]));
    // ranks: the longest way in from a node with nothing coming in, arrows that loop back ignored
    const forward: number[][] = chart.nodes.map(() => []);
    const state = chart.nodes.map(() => 0);
    const back = new Set<Edge>();
    const visit = (k: number) => {
        state[k] = 1;
        for (const edge of chart.edges) {
            if (index.get(edge.from) !== k) continue;
            const to = index.get(edge.to)!;
            if (state[to] === 1) back.add(edge);
            else {
                forward[k]!.push(to);
                if (state[to] === 0) visit(to);
            }
        }
        state[k] = 2;
    };
    chart.nodes.forEach((_, k) => state[k] === 0 && visit(k));
    const rank = chart.nodes.map(() => 0);
    for (let pass = 0; pass < chart.nodes.length; pass++) {
        let moved = false;
        forward.forEach((targets, k) => {
            for (const to of targets) if (rank[to]! < rank[k]! + 1) ((rank[to] = rank[k]! + 1), (moved = true));
        });
        if (!moved) break;
    }
    // order in each rank: as they were first named, then by where their neighbours sit, a few times over
    const ranks: number[][] = [];
    chart.nodes.forEach((_, k) => (ranks[rank[k]!] ??= []).push(k));
    const place = new Map<number, number>();
    const reorder = (row: number[], neighbours: (k: number) => number[]) => {
        const weight = (k: number) => {
            const near = neighbours(k).filter((other) => place.has(other));
            return near.length ? near.reduce((sum, other) => sum + place.get(other)!, 0) / near.length : place.get(k)!;
        };
        row.sort((a, b) => weight(a) - weight(b));
        row.forEach((k, at) => place.set(k, at));
    };
    ranks.forEach((row) => row.forEach((k, at) => place.set(k, at)));
    const up = (k: number) => chart.edges.filter((edge) => index.get(edge.to) === k && !back.has(edge)).map((edge) => index.get(edge.from)!);
    const down = (k: number) => chart.edges.filter((edge) => index.get(edge.from) === k && !back.has(edge)).map((edge) => index.get(edge.to)!);
    for (let pass = 0; pass < 4; pass++) {
        for (let r = 1; r < ranks.length; r++) reorder(ranks[r]!, up);
        for (let r = ranks.length - 2; r >= 0; r--) reorder(ranks[r]!, down);
    }
    // sizes, then positions: ranks along the flow, nodes side by side across it, each rank centred
    const sized = chart.nodes.map((node): Placed => {
        const text = textWidth(node.label);
        let width = Math.max(48, text + 28);
        let height = 38;
        if (node.shape === "circle") width = height = Math.max(48, text + 20);
        if (node.shape === "diamond") ((width = Math.max(64, text * 1.35 + 36)), (height = Math.max(52, width * 0.5)));
        return { ...node, x: 0, y: 0, width, height, rank: 0 };
    });
    const across = chart.direction === "TD" || chart.direction === "BT";
    const gap = 28;
    const step = 64;
    const along = (node: Placed) => (across ? node.height : node.width);
    const side = (node: Placed) => (across ? node.width : node.height);
    const spans = ranks.map((row) => row.reduce((sum, k) => sum + side(sized[k]!), 0) + gap * (row.length - 1));
    const widest = Math.max(...spans);
    const depths = ranks.map((row) => Math.max(...row.map((k) => along(sized[k]!))));
    let position = 0;
    ranks.forEach((row, r) => {
        let cross = (widest - spans[r]!) / 2;
        for (const k of row) {
            const node = sized[k]!;
            const middle = position + depths[r]! / 2;
            const centre = cross + side(node) / 2;
            node.rank = r;
            if (across) ((node.x = centre), (node.y = middle));
            else ((node.x = middle), (node.y = centre));
            cross += side(node) + gap;
        }
        position += depths[r]! + step;
    });
    const length = position - step;
    let width = across ? widest : length;
    let height = across ? length : widest;
    // bottom up and right to left are top down and left to right turned round
    if (chart.direction === "BT") for (const node of sized) node.y = height - node.y;
    if (chart.direction === "RL") for (const node of sized) node.x = width - node.x;
    const pad = 4;
    for (const node of sized) ((node.x += pad), (node.y += pad));
    width += pad * 2;
    height += pad * 2;
    return { nodes: sized, width, height };
}

// ---- drawing ----

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Where a line from a node's centre towards a point leaves the node's outline. */
function edgeOf(node: Placed, toward: { x: number; y: number }): { x: number; y: number } {
    const dx = toward.x - node.x;
    const dy = toward.y - node.y;
    if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
    const w = node.width / 2;
    const h = node.height / 2;
    let scale: number;
    if (node.shape === "circle") scale = w / Math.hypot(dx, dy);
    else if (node.shape === "diamond") scale = 1 / (Math.abs(dx) / w + Math.abs(dy) / h);
    else scale = Math.min(dx ? w / Math.abs(dx) : Infinity, dy ? h / Math.abs(dy) : Infinity);
    return { x: node.x + dx * scale, y: node.y + dy * scale };
}

function shapeOf(node: Placed): string {
    const { x, y, width: w, height: h } = node;
    const left = x - w / 2;
    const top = y - h / 2;
    switch (node.shape) {
        case "circle":
            return `<circle cx="${x}" cy="${y}" r="${w / 2}"/>`;
        case "diamond":
            return `<polygon points="${x},${top} ${x + w / 2},${y} ${x},${top + h} ${left},${y}"/>`;
        case "pill":
            return `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${h / 2}"/>`;
        case "round":
            return `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="10"/>`;
        default:
            return `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="3"/>`;
    }
}

/** Draws Mermaid flowchart code as SVG, or gives null for code outside the subset. */
export function diagram(code: string): string | null {
    const chart = readFlowchart(code);
    if (!chart) return null;
    const { nodes, width, height } = layout(chart);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const round = (value: number) => Math.round(value * 10) / 10;
    // a bent arrow or a label can reach past the nodes: the picture grows to hold them
    const bounds = { left: 0, top: 0, right: width, bottom: height };
    const reach = (x: number, y: number, pad: number) => {
        bounds.left = Math.min(bounds.left, x - pad);
        bounds.right = Math.max(bounds.right, x + pad);
        bounds.top = Math.min(bounds.top, y - 12);
        bounds.bottom = Math.max(bounds.bottom, y + 12);
    };
    const lines = chart.edges.map((edge) => {
        const from = byId.get(edge.from)!;
        const to = byId.get(edge.to)!;
        const start = edgeOf(from, to);
        const end = edgeOf(to, from);
        // an arrow between nodes of one rank, or back up the flow, bends out to the side
        const bend = from === to || from.rank >= to.rank;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        // far enough out to the side to pass the nodes between, with a little more the longer it is
        const length = Math.hypot(dx, dy) || 1;
        const push = 0.3 * length + Math.max(from.width, to.width) * 0.6;
        const control = { x: (start.x + end.x) / 2 - (dy / length) * push, y: (start.y + end.y) / 2 + (dx / length) * push };
        const d = bend ? `M${round(start.x)},${round(start.y)} Q${round(control.x)},${round(control.y)} ${round(end.x)},${round(end.y)}` : `M${round(start.x)},${round(start.y)} L${round(end.x)},${round(end.y)}`;
        const middle = bend ? { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 } : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        reach(middle.x, middle.y, edge.label ? textWidth(edge.label) / 2 + 8 : 4);
        const label = edge.label
            ? `<g class="qd-label"><rect x="${round(middle.x - textWidth(edge.label) / 2 - 4)}" y="${round(middle.y - 10)}" width="${round(textWidth(edge.label) + 8)}" height="20" rx="4"/><text x="${round(middle.x)}" y="${round(middle.y)}">${escape(edge.label)}</text></g>`
            : "";
        return `<path class="qd-edge qd-${edge.line}" d="${d}"${edge.arrow ? ' marker-end="url(#qd-arrow)"' : ""}/>${label}`;
    });
    const shapes = nodes.map((node) => `<g class="qd-node qd-${node.shape}">${shapeOf(node)}<text x="${round(node.x)}" y="${round(node.y)}">${escape(node.label)}</text></g>`);
    const marker = '<defs><marker id="qd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="qd-head"/></marker></defs>';
    const wide = bounds.right - bounds.left;
    const high = bounds.bottom - bounds.top;
    return `<svg class="quire-diagram" viewBox="${round(bounds.left)} ${round(bounds.top)} ${round(wide)} ${round(high)}" width="${round(wide)}" height="${round(high)}" role="img" aria-label="A flowchart of ${nodes.length} ${nodes.length === 1 ? "step" : "steps"}">${marker}${lines.join("")}${shapes.join("")}</svg>`;
}
