// Runs made to start from, in the run's own text form (run.ts), each tested to carry every marble
// from its hopper to its tray and to have nothing marked (table.test.ts, checks.test.ts).

/** A run to load: what it is called, and the run as text. */
export interface Made {
    name: string;
    text: string;
}

/** The made runs, shortest first. */
export const RUNS: Made[] = [
    { name: "a first run", text: "v1_h.0.0.8.0_s.2.0.1.8.2_d.2.1.-2.1.8.2_c.1.1.-4.1.7.2_d.2.2.-5.0.7.3_c.1.1.-5.-2.5.7_s.1.-5.-2.5.2_t.-6.-2.5.2" },
    {
        name: "every kind of piece",
        text: "v1_h.0.0.26.0_s.1.0.1.26.2_d.2.2.-1.1.26.2_v.4.-3.1.24.2_x.2.6.-4.1.20.2_d.2.1.-7.1.14.2_l.-9.1.13.2_c.1.1.-11.0.13.2_s.2.-12.-1.13.3_z.2.1.-12.-3.13.3_c.1.2.-11.-5.13.3_c.3.1.-9.-5.13.5_f.-8.-4.13.0_s.1.-5.-3.5.0_t.-4.-3.5.0",
    },
    {
        name: "twenty pieces",
        text: "v1_h.0.0.33.0_s.1.0.1.33.2_d.2.2.-1.1.33.2_v.4.-3.1.31.2_x.2.6.-4.1.27.2_d.2.1.-7.1.21.2_l.-9.1.20.2_z.2.1.-11.0.20.6_c.3.1.-13.1.20.2_c.1.1.-15.-1.20.7_c.1.1.-15.-1.20.2_c.3.1.-16.-2.20.3_d.2.1.-14.-4.20.0_s.3.-12.-4.19.0_s.2.-9.-4.19.0_c.1.2.-7.-4.19.4_x.2.6.-7.-4.19.2_f.-10.-4.13.2_s.1.-13.-5.5.2_t.-14.-5.5.2",
    },
];
