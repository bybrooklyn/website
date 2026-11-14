// Bias toward the user's own words: shallow fusion while decoding. Each custom word is split into
// the pieces the model writes with, and the splits are kept as a trie. While the decoder runs, the
// trie remembers how far into a boosted word the last pieces got, and any piece that would go one
// step further (or begin a boosted word) has a bonus added to its logit before the best piece is
// chosen. So a rare name the model half-hears can win over the common word it sounds like.
//
// Falling off the trie costs nothing. In the usual formulations (context biasing for transducers,
// as in icefall and NeMo's boosting tree) the bonus given on a path is taken back when the path
// breaks, but that only matters when hypotheses are kept and compared, as in beam search. Greedy
// decoding has one path and cannot revise it, so there is nothing to take back, and the bonus is
// just a nudge that is paid while a boosted word is being matched.
//
// With no words the booster has no candidates, and decoding is exactly what it was without it.

import type { Vocabulary } from "./tokens";

/** What the decoder asks of a booster: where in the trie it is, which pieces would continue a boosted word, and the bonus for them. */
export interface Booster {
    /** The logit added to a piece that continues a boosted word. */
    readonly strength: number;
    /** How many words are in the trie. */
    readonly words: number;
    /** The trie position at the start of a sentence. */
    start(): number;
    /** The pieces that would continue a boosted word from a position: its children and those of the start. */
    candidates(at: number): readonly number[];
    /** The position after the decoder wrote a piece. */
    advance(at: number, piece: number): number;
}

/** One position in the trie: where each piece leads. */
interface Node {
    next: Map<number, number>;
    /** The pieces to offer here, filled in once the trie is built. */
    offer: number[];
}

/**
 * Builds a booster from the user's words. `strength` is the bonus in logits (the scale the joint
 * network speaks in: a clear winner leads by 5 to 15), 4 by default (measured on two real models: 2 barely moves anything, 4 to 6 mends names, 8 starts to damage the words around a name), and 0 turns it off.
 */
export function booster(words: string[], vocab: Vocabulary, strength = 4): Booster {
    const nodes: Node[] = [{ next: new Map(), offer: [] }];
    let count = 0;
    // A phrase such as a full name is kept whole and each of its words is kept alone too, so a first name said without the surname is still helped.
    for (const word of new Set(words.flatMap((phrase) => (/\s/.test(phrase.trim()) ? [phrase, ...phrase.trim().split(/\s+/)] : [phrase])))) {
        const splits = vocab.encode(word);
        if (splits.length === 0) continue;
        count++;
        for (const split of splits) {
            let at = 0;
            for (const piece of split) {
                let to = nodes[at]!.next.get(piece);
                if (to === undefined) {
                    to = nodes.length;
                    nodes.push({ next: new Map(), offer: [] });
                    nodes[at]!.next.set(piece, to);
                }
                at = to;
            }
        }
    }
    const root = nodes[0]!;
    for (const node of nodes) node.offer = [...new Set([...node.next.keys(), ...root.next.keys()])];
    const none: readonly number[] = [];
    return {
        strength,
        words: count,
        start: () => 0,
        candidates: (at) => (strength === 0 ? none : (nodes[at]?.offer ?? none)),
        advance(at, piece) {
            const node = nodes[at] ?? root;
            const inside = node.next.get(piece);
            const to = inside ?? root.next.get(piece) ?? 0;
            // A position with nowhere further to go is the end of a word, so the next piece starts afresh.
            return nodes[to]!.next.size === 0 ? 0 : to;
        },
    };
}
