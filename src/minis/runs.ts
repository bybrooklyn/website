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
];
