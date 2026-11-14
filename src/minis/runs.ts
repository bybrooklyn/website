// Runs made to start from, in the run's own text form (run.ts), each tested to carry every marble
// from its hopper to its tray (table.test.ts).

/** A run to load: what it is called, and the run as text. */
export interface Made {
    name: string;
    text: string;
}

/** The made runs, shortest first. */
export const RUNS: Made[] = [
    { name: "a first run", text: "v1_h.0.0.8.0_s.2.0.1.8.2_d.2.1.-2.1.8.2_c.1.1.-4.1.7.2_d.2.2.-5.0.7.3_c.1.1.-5.-2.5.7_s.1.-5.-2.5.2_t.-6.-2.5.2" },
    {
        name: "every piece once",
        text: "v1_h.0.0.26.0_s.1.0.1.26.2_d.2.2.-1.1.26.2_v.4.-3.1.24.2_x.2.6.-4.1.20.2_d.2.1.-7.1.14.2_l.-9.1.13.2_c.1.1.-11.0.13.2_s.2.-12.-1.13.3_z.2.1.-12.-3.13.3_c.1.2.-11.-5.13.3_c.3.1.-9.-5.13.5_f.-8.-4.13.0_s.1.-5.-3.5.0_t.-4.-3.5.0",
    },
    {
        name: "twenty pieces",
        text: "v1_h.0.0.33.0_s.1.0.1.33.2_d.2.2.-1.1.33.2_v.4.-3.1.31.2_x.2.6.-4.1.27.2_d.2.1.-7.1.21.2_l.-9.1.20.2_s.3.-11.0.20.2_c.1.2.-14.0.20.6_c.1.1.-14.0.20.0_s.2.-13.1.20.1_z.2.1.-13.3.20.5_d.2.1.-12.5.20.1_c.3.1.-12.7.19.5_c.1.1.-11.8.19.0_c.3.1.-10.9.19.5_x.2.6.-9.10.19.0_f.-6.10.13.0_s.1.-3.11.5.0_t.-2.11.5.0",
    },
];
