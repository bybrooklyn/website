// Runs made to start from, in the run's own text form (run.ts), each tested to carry every marble
// from its hopper to its tray and to have nothing marked (table.test.ts, checks.test.ts).

/** A run to load: what it is called, and the run as text. */
export interface Made {
    name: string;
    text: string;
}

/** The made runs, shortest first. */
export const RUNS: Made[] = [
    { name: "a first run", text: "v1.h0_0_8_0.s2_0_1_8_2.d2_1_-2_1_8_2.c1_1_-4_1_7_2.d2_2_-5_0_7_3.c1_1_-5_-2_5_7.s1_-5_-2_5_2.t-6_-2_5_2" },
    {
        name: "every kind of piece",
        text: "v1.h0_0_26_0.s1_0_1_26_2.d2_2_-1_1_26_2.v4_-3_1_24_2.x2_6_-4_1_20_2.d2_1_-7_1_14_2.l-9_1_13_2.c1_1_-11_0_13_2.s2_-12_-1_13_3.z2_1_-12_-3_13_3.c1_2_-11_-5_13_3.c3_1_-9_-5_13_5.f-8_-4_13_0.s1_-5_-3_5_0.t-4_-3_5_0",
    },
    {
        name: "twenty pieces",
        text: "v1.h0_0_33_0.s1_0_1_33_2.d2_2_-1_1_33_2.v4_-3_1_31_2.x2_6_-4_1_27_2.d2_1_-7_1_21_2.l-9_1_20_2.z2_1_-11_0_20_6.c3_1_-13_1_20_2.c1_1_-15_-1_20_7.c1_1_-15_-1_20_2.c3_1_-16_-2_20_3.d2_1_-14_-4_20_0.s3_-12_-4_19_0.s2_-9_-4_19_0.c1_2_-7_-4_19_4.x2_6_-7_-4_19_2.f-10_-4_13_2.s1_-13_-5_5_2.t-14_-5_5_2",
    },
    // A funnel fed by the hopper turns marbles out into a lift; up it they go, back round over the funnel
    // and into it again, for as long as they are watched.
    { name: "a lift that loops", text: "v3.f0_0_11_0.d1_1_3_1_3_0.u11_4_1_2_0.c1_2_6_1_13_0.s2_6_3_13_2.d2_1_4_3_13_2.h0_1_11_2" },
    // Eight chime bars down a line, each marble playing G5 C6 E6 D6 B5 G5 A5 C6, a note a second.
    {
        name: "a tune on chime bars",
        text: "v3.h0_0_34_2.s1_0_-1_34_0.m4_1_-1_34_0.s1_2_-1_31_0.m7_3_-1_31_0.s1_4_-1_28_0.m9_5_-1_28_0.s1_6_-1_25_0.m8_7_-1_25_0.s1_8_-1_22_0.m6_9_-1_22_0.s1_10_-1_19_0.m4_11_-1_19_0.s1_12_-1_16_0.m5_13_-1_16_0.s1_14_-1_13_0.m7_15_-1_13_0.s1_16_-1_10_0.t17_-1_10_0",
    },
    // The switch sends marbles left and right in turn: those to the left wait in a seesaw until there
    // are three, those to the right on a trapdoor until there are two, and each tips them into a tray.
    { name: "sorting by switch and seesaw", text: "v3.h0_0_22_2.s2_0_-1_22_0.w2_-1_22_0.d1_1_2_-2_17_3.e3_2_-3_16_3.t2_-6_12_3.d1_1_3_1_17_1.j3_2_16_1.s1_3_4_10_1.t3_5_10_1" },
];
