#!/bin/sh
# Every run behind the comparison in README.md ("Evolution against practice"): both methods, both
# bodies, four difficulties, seeds 1 to 5, each to 20 million steps of the physics on one core, four
# at a time; then the transfer runs, practice that spends its first 10 million steps in worlds of
# difficulty 0.1 before worlds of 0.8. Prints one line per mark, as examples/compare.rs says; sort
# and average them as the README does.
#
#     sh examples/compare.sh > compare.txt

# a failed build stops here, rather than running a binary left from before
cargo build --release --example compare || exit 1
{
    for method in practice evolution; do
        for legs in 2 4; do
            for difficulty in 0.1 0.3 0.5 0.8; do
                for seed in 1 2 3 4 5; do
                    echo "method=$method legs=$legs difficulty=$difficulty seed=$seed steps=20000000"
                done
            done
        done
    done
    for legs in 2 4; do
        for seed in 1 2 3 4 5; do
            echo "method=practice legs=$legs difficulty=0.8 seed=$seed steps=20000000 easy=0.1 switch=10000000"
        done
    done
} | xargs -P 4 -L 1 ./target/release/examples/compare
