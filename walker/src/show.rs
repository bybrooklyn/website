//! Walkers run in real time for the page to draw. `Show` is one brain in its own world, which a
//! visitor can push, with what it senses and thinks laid out for drawing its brain. `Crowd` is a whole
//! generation at once, each in a world of its own, laid out for drawing their bodies only.

use alloc::vec;
use alloc::vec::Vec;

use crate::body::Creature;
use crate::brain::{Brain, Layout};
use crate::math::Vec2;
use crate::physics::{STEP, World};

/// The most steps one call takes, so a page that was hidden a while does not freeze catching up.
const MOST_STEPS: u32 = 8;

pub struct Show {
    pub world: World,
    pub creature: Creature,
    pub weights: Vec<f32>,
    pub brain: Brain,
    pub senses: Vec<f32>,
    /// Six numbers for each body: x, y, angle, kind, and the two size numbers (see `Shape::size`).
    pub drawn: Vec<f32>,
    leftover: f32,
}

impl Show {
    pub fn new(start: &World, creature: &Creature, layout: Layout, weights: &[f32]) -> Show {
        let mut show = Show {
            world: start.clone(),
            creature: creature.clone(),
            weights: weights.to_vec(),
            brain: Brain::new(layout),
            senses: vec![0.0; layout.inputs],
            drawn: Vec::new(),
            leftover: 0.0,
        };
        show.creature.sense(&show.world, &mut show.senses);
        show.brain.think(&show.weights, &show.senses);
        show.draw();
        show
    }

    /// Moves on by `seconds` in whole steps, the brain thinking before each, and returns the steps.
    pub fn step(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS {
            self.creature.sense(&self.world, &mut self.senses);
            self.brain.think(&self.weights, &self.senses);
            self.creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            self.leftover -= STEP;
            taken += 1;
        }
        if taken == MOST_STEPS {
            self.leftover = 0.0;
        }
        self.draw();
        taken
    }

    /// Pushes the body nearest the point (x, y) at that point, and returns which body it was.
    pub fn push(&mut self, at: Vec2, impulse: Vec2) -> Option<u32> {
        let (index, _) = self.world.nearest_body(at)?;
        self.world.bodies[index as usize].push(at, impulse);
        self.draw();
        Some(index)
    }

    fn draw(&mut self) {
        self.drawn.clear();
        for body in &self.world.bodies {
            let (a, b) = body.shape.size();
            self.drawn.extend_from_slice(&[body.position.x, body.position.y, body.angle(), body.shape.kind() as f32, a, b]);
        }
    }
}

pub struct Crowd {
    pub worlds: Vec<World>,
    pub creature: Creature,
    /// Every brain's weights, one after another.
    pub weights: Vec<f32>,
    brain: Brain,
    senses: Vec<f32>,
    /// Three numbers for each body of each walker in turn: x, y and angle.
    pub drawn: Vec<f32>,
    leftover: f32,
}

impl Crowd {
    pub fn new(start: &World, creature: &Creature, layout: Layout, population: &[f32]) -> Crowd {
        let count = population.len() / layout.weights();
        let mut crowd = Crowd {
            worlds: vec![start.clone(); count],
            creature: creature.clone(),
            weights: population.to_vec(),
            brain: Brain::new(layout),
            senses: vec![0.0; layout.inputs],
            drawn: Vec::new(),
            leftover: 0.0,
        };
        crowd.draw();
        crowd
    }

    pub fn step(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let count = self.brain.layout.weights();
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS {
            for (i, world) in self.worlds.iter_mut().enumerate() {
                self.creature.sense(world, &mut self.senses);
                self.brain.think(&self.weights[i * count..(i + 1) * count], &self.senses);
                self.creature.drive(world, &self.brain.outputs);
                world.step();
            }
            self.leftover -= STEP;
            taken += 1;
        }
        if taken == MOST_STEPS {
            self.leftover = 0.0;
        }
        self.draw();
        taken
    }

    fn draw(&mut self) {
        self.drawn.clear();
        for world in &self.worlds {
            for body in &world.bodies {
                self.drawn.extend_from_slice(&[body.position.x, body.position.y, body.angle()]);
            }
        }
    }
}
