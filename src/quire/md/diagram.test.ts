// What the diagrams are held to: the flowchart subset is read into nodes and arrows exactly; nodes
// are laid out along the flow in ranks without overlapping; and anything outside the subset gives
// null, so the surface shows the code.

import { expect, test } from "bun:test";
import { diagram, layout, readFlowchart } from "./diagram";

test("nodes, shapes, labels and every kind of arrow are read", () => {
    const chart = readFlowchart('flowchart LR\n  A[Start] --> B(Think)\n  B -.-> C{"Is it done?"}\n  C ==>|yes| D((End))\n  C -- no --> B\n  D --- E([Pill])\n')!;
    expect(chart.direction).toBe("LR");
    expect(chart.nodes.map((node) => [node.id, node.label, node.shape])).toEqual([
        ["A", "Start", "box"],
        ["B", "Think", "round"],
        ["C", "Is it done?", "diamond"],
        ["D", "End", "circle"],
        ["E", "Pill", "pill"],
    ]);
    expect(chart.edges.map((edge) => [edge.from, edge.to, edge.label, edge.arrow, edge.line])).toEqual([
        ["A", "B", "", true, "solid"],
        ["B", "C", "", true, "dotted"],
        ["C", "D", "yes", true, "thick"],
        ["C", "B", "no", true, "solid"],
        ["D", "E", "", false, "solid"],
    ]);
});

test("chains, semicolons, comments, graph instead of flowchart, and a node named before it is labelled", () => {
    const chart = readFlowchart("graph TD\n%% a comment\nA --> B --> C; C --> A\nB[Middle]")!;
    expect(chart.direction).toBe("TD");
    expect(chart.edges.map((edge) => `${edge.from}${edge.to}`)).toEqual(["AB", "BC", "CA"]);
    expect(chart.nodes.find((node) => node.id === "B")!.label).toBe("Middle");
    expect(readFlowchart("graph\nA")!.direction).toBe("TD");
});

test("anything outside the subset gives null rather than a wrong picture", () => {
    for (const code of ["sequenceDiagram\nA->>B: hi", "flowchart TD\nsubgraph one\nA-->B\nend", "flowchart TD\nA --> B & C", "flowchart TD\nstyle A fill:#f9f", "flowchart TD\nclassDef x fill:red", "flowchart TD\nA[open --> B", "flowchart TD\nA ~~> B", "", "flowchart TD"]) {
        expect({ code, chart: readFlowchart(code) }).toEqual({ code, chart: null });
        expect(diagram(code)).toBeNull();
    }
});

test("top down puts each step below the last; left to right puts it to the right; nothing overlaps", () => {
    for (const direction of ["TD", "LR", "BT", "RL"]) {
        const { nodes } = layout(readFlowchart(`flowchart ${direction}\nA[One] --> B[Two]\nA --> C[Three]\nB --> D[Four]\nC --> D\nD --> A`)!);
        const at = (id: string) => nodes.find((node) => node.id === id)!;
        const step = direction === "TD" ? at("B").y - at("A").y : direction === "BT" ? at("A").y - at("B").y : direction === "LR" ? at("B").x - at("A").x : at("A").x - at("B").x;
        expect({ direction, forward: step > 0 }).toEqual({ direction, forward: true });
        expect(at("D").rank).toBe(2);
        for (const a of nodes)
            for (const b of nodes) {
                if (a === b) continue;
                const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
                expect({ direction, pair: a.id + b.id, apart }).toEqual({ direction, pair: a.id + b.id, apart: true });
            }
    }
});

test("the drawing is SVG with a shape and a label for each node, a path for each arrow, and labels escaped", () => {
    const svg = diagram('flowchart TD\nA["a < b"] -->|go & see| B')!;
    expect(svg.startsWith('<svg class="quire-diagram"')).toBe(true);
    expect(svg.match(/<g class="qd-node/g)!.length).toBe(2);
    expect(svg.match(/<path class="qd-edge/g)!.length).toBe(1);
    expect(svg).toContain("a &lt; b");
    expect(svg).toContain("go &amp; see");
    expect(svg).toContain('marker-end="url(#qd-arrow)"');
});
