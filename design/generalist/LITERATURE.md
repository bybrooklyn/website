# The generalist: what already exists

A literature search, 12 Nov 2026, before anything is built or called new. The plan is a safe base
with one risky bet, and a proper literature search first. The decisions are in `docs/generalist.md`.

## How to read this

- **[opened]** means I fetched the paper or page myself and read the part I quote.
- **[search]** means I saw the title, authors, venue and abstract only through a search engine's
  summary of the page. I did not open the paper. Treat its details as less certain.
- "I found no work that does X" always means: in the searches listed, not that it cannot exist.
  Search engines miss things, especially workshop papers and 2026 preprints.
- What a paper claims is reported as a claim. What I infer is marked "my reading".

The engine today, for scale (from `walker/src/generalist/`): brains of 2 to 64 hidden neurons in 1 to 4
layers with up to 16 memories, populations of 5 to 500, 16 distance rays, evolution and PPO written by
hand in Rust, run in a browser tab. Every result below should be read against that scale: most of the
literature uses a GPU or a cluster.

---

## 1. Neurons that are evolved programs

The aim: each neuron's rule is found, not designed, and new kinds of neuron can be built by the model
itself.

### What has been done

1. **"Structurally Flexible Neural Networks: Evolving the Building Blocks for General Agents"**,
   Pedersen, Plantec, Nisioti, Montero, Risi. GECCO 2024. https://arxiv.org/abs/2404.15193 **[opened]**
   The closest work to this aim. Three neuron types (small linear layers with tanh, parameters shared
   within a type) and three synapse types (GRUs acting as plasticity rules, gates shared within a type,
   each synapse with its own state). Only the building blocks are optimised, by CMA-ES (population 128),
   never by gradients. 32 neurons, 565 evolved parameters, random sparse wiring each lifetime. One agent
   learns CartPole, Acrobot and MountainCar inside its lifetime without being told which. Claim: "Only
   the SFNN approach made significant progress on all three environments at once"; a one-type version
   made only modest progress. Limits they state: discrete actions, three small tasks, continuous control
   untested. Scale: tiny networks, but an evolution budget far above a browser tab.
2. **"Network of evolvable neural units can learn synaptic learning rules and spiking dynamics"**
   (preprint title "Network of Evolvable Neural Units: Evolving to Learn at a Synaptic Level"),
   Bertens and Lee. Nature Machine Intelligence 2020. https://arxiv.org/abs/1912.07589 **[search]**
   Each neuron and each synapse is a small gated recurrent unit found by evolution. The units come to
   mimic integrate-and-fire spiking and spike-timing plasticity, and a network of them learns a T-maze.
   The author said only a handful of units could be simulated efficiently.
3. **"Meta Learning Backpropagation And Improving It"** (VSML), Kirsch and Schmidhuber. NeurIPS 2021.
   https://arxiv.org/abs/2012.14905 **[opened, abstract only]** Every weight is replaced by a tiny LSTM
   whose parameters are shared everywhere. The shared rule can implement backpropagation in forward mode
   and can be meta-learned into rules that learn "through fast association". Supervised tasks.
   Follow-up for RL: **"Introducing Symmetries to Black Box Meta Reinforcement Learning"** (SymLA),
   Kirsch, Flennerhag, van Hasselt, Friesen, Oh, Chen. AAAI 2022. https://arxiv.org/abs/2109.10781
   **[search]** Claims the shared-rule symmetry helps generalise to unseen action and observation spaces.
4. **"Meta-Learning Bidirectional Update Rules"** (BLUR), Sandler et al. ICML 2021.
   https://arxiv.org/abs/2104.04657 **[search]** Neurons and synapses carry several states; a shared
   low-dimensional "genome" sets how they update. Genomes found by gradient or CMA-ES train networks
   without gradients and transfer to new datasets and shapes. Supervised.
5. **"Learning to Act through Evolution of Neural Diversity in Random Neural Networks"**, Pedersen and
   Risi. GECCO 2023. https://arxiv.org/abs/2305.15945 **[search]** Synapses stay random; only
   per-neuron parameters are evolved, giving diverse neurons. Claims RL tasks are solved this way
   "competitive with simple baselines".
6. **"Evolving and Merging Hebbian Learning Rules: Increasing Generalization by Decreasing the Number of
   Rules"**, Pedersen and Risi. GECCO 2021. https://arxiv.org/abs/2104.07959 **[search]** Hebbian rules
   are clustered during evolution so many synapses share one rule: 12,288 connections end up governed by
   384 rules, and robustness to 30 unseen quadruped bodies rises as rules fall. My reading: this is
   "kinds of synapse emerging by merging", the nearest thing to emergent types I found.
7. **"Meta-Learning through Hebbian Plasticity in Random Networks"**, Najarro and Risi. NeurIPS 2020.
   https://arxiv.org/abs/2007.02686 **[search]** Evolves a Hebbian rule per synapse, weights start
   random each life. A quadruped learns to walk and adapts to damage it never saw "in less than 100
   timesteps". A reviewer noted fixed weights did better in two of three tasks.
8. **"Evolving interpretable plasticity for spiking networks"**, Jordan, Schmidt, Senn, Petrovici. eLife
   2021. https://elifesciences.org/articles/66273 **[search]** Cartesian genetic programming evolves
   plasticity rules as readable formulas; recovers known rules and finds new reward-driven ones. Also
   **"A meta-learning approach to (re)discover plasticity rules that carve a desired function into a
   neural network"**, Confavreux, Zenke, Agnes, Lillicrap, Vogels. NeurIPS 2020
   https://proceedings.neurips.cc/paper/2020/file/bdbd5ebfde4934142c8a88e7a3796cd5-Paper.pdf
   **[search]**: rules as Volterra expansions, fitted by CMA-ES; recovers Oja's rule; a reviewer said it
   stays "at the level of just a few neurons".
9. **"Discovering Parametric Activation Functions"** (PANGAEA), Bingham and Miikkulainen. Neural
   Networks 2022. https://arxiv.org/abs/2006.03179 **[search]** Exactly the split wanted here, but
   for activation functions only: evolution finds the shape of the function as a small graph, gradient
   descent tunes the numbers inside. Claims this beats gradient-only learnable activations. Image
   classification, not RL. For RL there is **"Evolving RL: Discovering New Activation Functions using
   LLMs"**, Nadimpalli et al., ICLR 2025 workshop https://iclr.cc/virtual/2025/33143 **[search]**:
   claims +37% on MinAtar and +28% on Brax over ReLU and tanh.
10. **"Discovering Adaptable Symbolic Algorithms from Scratch"** (AutoRobotics-Zero), Kelly et al. IROS
    2023. https://arxiv.org/abs/2307.16890 **[search]** AutoML-Zero style: whole policies evolved as
    small register-machine programs. A quadruped keeps walking after a leg fails; beats MLP and LSTM
    baselines with fewer parameters.
11. Older roots, all **[search]**: neuromodulatory neurons that turn plasticity up or down evolve and help
    learning (**"Evolutionary advantages of neuromodulated plasticity in dynamic, reward-based
    scenarios"**, Soltoggio, Bullinaria, Mattiussi, Dürr, Floreano, ALIFE 2008,
    https://infoscience.epfl.ch/record/121548); the same trained by gradient (**"Backpropamine: training
    self-modifying neural networks with differentiable neuromodulated plasticity"**, Miconi, Rawal,
    Clune, Stanley, ICLR 2019, https://arxiv.org/abs/2002.10585); learning rules painted across a
    network by geometry (**"Indirectly Encoding Neural Plasticity as a Pattern of Local Rules"**, Risi
    and Stanley, SAB 2010, adaptive HyperNEAT); the sensory neuron as a small shared network talking by
    attention (**"The Sensory Neuron as a Transformer"**, Tang and Ha, NeurIPS 2021,
    https://arxiv.org/abs/2109.02869). Recent and close: **"Hebbian Attractor Networks for Robot
    Locomotion"**, Dittrich, van Diggelen, Floreano, arXiv March 2026,
    https://arxiv.org/abs/2603.22512 **[opened, abstract]**.

### What has NOT been done, as far as I can find

- I found no work where **the form of each neuron's rule is evolved as a small program or graph while
  PPO (or any policy gradient) tunes the numbers inside it, in an embodied RL agent**. PANGAEA does this
  split for activation functions in supervised learning. SFNN, ENU, BLUR and VSML find neuron or synapse
  rules, but optimise everything by evolution or by meta-gradients, not "evolution outside, PPO inside".
- I found no work showing **distinct kinds of neuron emerging** (rather than being given a number of
  types) in a locomotion agent. SFNN fixes three types; Evolve-and-Merge merges synapse rules but they
  are all Hebbian of one form.
- Searches: "evolve plasticity rule structure genetic programming then gradient descent tunes
  coefficients reinforcement learning agent" (extended); "evolving neuron models neuron type discovered
  evolution gradient hybrid learned neuron meta-learning 2024 2025" (extended); "meta-learned neuron
  model shared tiny network per neuron reinforcement learning locomotion" (extended); "cell types emerge
  evolved neural network genome neuron types meta-learning artificial agent 2025 2026" (extended); plus
  title searches for each paper above.

### Strongest prior result we would be compared against

SFNN (Pedersen et al. 2024) for "evolved kinds of neuron", and Najarro and Risi (2020) for "a learned
rule that adapts to a broken leg". A reviewer would also ask why not simply use PPO with a GRU.

### Why it is hard

- Two nested loops: every candidate neuron rule needs a PPO run to be scored. SFNN and LNDP ran CMA-ES
  with populations of 128 for thousands of generations. A browser tab has perhaps one core's worth.
- PPO is sensitive to how a network behaves; odd neurons can make gradients explode or vanish.
- Neuron rules tend to collapse to one type unless something forces diversity (Nisioti et al., below,
  report diversity "can destabilize optimization").
- Results on toy tasks (CartPole, T-maze) have not shown a clear win over plain recurrent nets.

### A small first experiment in this engine

- Build: one shared "neuron program" per type, as a tiny expression graph (inputs: weighted sum, own
  previous output, a rhythm phase, a mood signal; 4 to 8 nodes, a few constants). Two to four types.
  PPO trains the weights and the constants. An outer loop, run slowly across visitor sessions, mutates
  the graphs and keeps those whose PPO runs score best on unseen worlds.
- Measure: score on held-out worlds after a fixed PPO budget, against tanh neurons and against GRU
  memory; whether the kept graphs differ from each other (do kinds emerge?).
- Interesting: any evolved neuron program that beats tanh at the same budget and is readable on the
  page.
- Failure: evolved graphs no better than tanh, or all types converge to one.
- Risk: high (the outer loop is costly; signal is noisy at this scale). Newness: real but narrow;
  the split itself is PANGAEA's.

---

## 2. Learning passed down like culture

The idea: creatures do not inherit brains; a newborn watches the previous one's best runs, then
practises; skills accumulate without copying weights.

### What has been done

1. **"Artificial Generational Intelligence: Cultural Accumulation in Reinforcement Learning"**, Cook,
   Lu, Hughes, Leibo, Foerster. NeurIPS 2024. https://arxiv.org/abs/2406.00392 **[opened, full text]**
   This is the idea, already done. Its "in-weights accumulation" (Algorithm 3) starts each generation
   from fresh random parameters, puts the previous generation's best agent into the same environment,
   lets the newborn see it with a probability that falls linearly to zero over training, and trains with
   ordinary PPO and no imitation loss. "We do not assume that the new learner has access to the policies
   of experts or past generations, but only observations of their behaviour." Claim: generations beat a
   single agent trained for the same total experience, and "in-weights accumulation effectively
   mitigates primacy bias and is further improved by network resets". Tasks: Memory Sequence, Goal
   Sequence (grid navigation), TSP. Compute: one to four A40 GPUs, 8 to 30 minutes. Also an in-context
   version where accumulation happens within episodes. Their table of prior work is a good map.
2. **"Learning few-shot imitation as cultural transmission"**, Bhoopchand et al. (DeepMind). Nature
   Communications 2023. https://www.nature.com/articles/s41467-023-42875-2 **[search]** RL agents in a
   3D world learn to imitate an expert in real time and remember it after the expert leaves; no human
   data.
3. **"Emergent Social Learning via Multi-agent Reinforcement Learning"**, Ndousse, Eck, Levine, Jaques.
   ICML 2021. https://arxiv.org/abs/2010.00581 **[search]** Plain model-free agents mostly ignore
   experts; with environment constraints and a model-based auxiliary loss, they learn socially and keep
   the skills when alone.
4. **"Kickstarting Deep Reinforcement Learning"**, Schmitt et al. 2018. https://arxiv.org/abs/1803.03835
   **[search]** A new student learns from trained teachers by a distillation term that fades; with
   several teachers it matched from-scratch performance in almost 10 times fewer steps.
5. **"Open-Ended Learning Leads to Generally Capable Agents"**, Open-Ended Learning Team (DeepMind),
   2021. https://arxiv.org/abs/2107.12808 **[search]** Five generations, each distilling from the best
   agent of the one before, in procedurally generated XLand worlds.
6. ALIFE roots, all **[search]**: **"How Learning Can Guide Evolution"**, Hinton and Nowlan, Complex
   Systems 1987, https://www.cs.toronto.edu/~hinton/absps/evolution.htm (the Baldwin effect model);
   Borg and Channon's work on imitation and social information in evolving agents (ECAL 2011, Artificial
   Life 2021, https://eprints.keele.ac.uk/8780/); McQuesten and Miikkulainen, "Culling and Teaching in
   Neuro-Evolution", ICGA 1997, where parents teach offspring
   (https://www.cs.utexas.edu/ftp/AI-Lab/tech-reports/UT-AI-TR-02-295.pdf); Heinerman, Rango, Eiben,
   "Evolution, individual learning, and social learning in a swarm of real robots", SSCI 2015;
   Yaman, Bredeche et al., "Meta-control of social learning strategies", PLoS Computational Biology
   2022, https://arxiv.org/abs/2106.10015. Beppu and Griffiths, "Iterated Learning and the Cultural
   Ratchet" (https://cocosci.princeton.edu/tom/papers/ratchet1.pdf) for the theory.

### What has NOT been done, as far as I can find

- Cultural accumulation of **locomotion skill in procedurally generated physical worlds**, with each
  newborn watching recorded best runs (rather than a live ancestor). Cook et al. use grid and sequence
  tasks.
- Doing it **in a browser tab**, live, where a visitor sees the ancestor's ghost and the newborn's
  practice.
- These gaps are about setting, not mechanism. The mechanism is published.
- Searches: "cultural ratchet reinforcement learning generations agents learn from previous generation
  demonstrations no weight inheritance skill accumulation" (extended); "iterated learning reinforcement
  learning agents generations behavioural cloning iterated imitation policy"; "cultural evolution of
  learning rules agents transmit plasticity rules socially rather than genetically artificial life"
  (extended); title searches above.

### Strongest prior result

Cook et al. 2024. Any article claim here must cite it and say what differs.

### Why it is hard

- Ndousse et al.: model-free agents ignore the expert unless forced. Cook et al.: oracles that are too
  good impede accumulation; too noisy, nothing is learned. The fade schedule matters.
- Without weight copying, each generation pays the full cost of learning again; at browser compute the
  gain must outrun that.

### A small first experiment

- Build: the previous generation's best three runs are stored as traces. The newborn sees the
  ancestor's position as extra rays ("a ghost"), seen with a probability that falls to zero over its
  practice, as in Cook et al. Same PPO, no imitation loss. A second arm adds a small behaviour-cloning
  loss on the traces.
- Measure: score on held-out worlds after N generations against one agent trained for N times as long.
- Interesting: generations beat the single long learner on hard worlds (gaps, boxes) where exploration
  fails.
- Failure: newborns ignore the ghost, or the single long learner wins.
- Risk: low to medium. Newness: low. It would be a reproduction in a new setting, worth showing, not
  worth calling new.

---

## 3. A brain that rewires, with a budget

The aim: a brain with a most number of neurons, which changes its synapses and connections as it
lives. Connections are added, cut and moved while it lives, each costing energy from the food
it finds.

### What has been done

1. **"Evolving Self-Assembling Neural Networks: From Spontaneous Activity to Experience-Dependent
   Learning"** (LNDP), Plantec, Pedersen, Montero, Nisioti, Risi. arXiv 2024.
   https://arxiv.org/abs/2406.09787 **[opened]** The closest prior. Fixed number of nodes (32 or 64).
   During life a learned MLP gives the chance of adding an edge between two nodes, another the chance
   of removing one, and a shared GRU updates each edge from activity and reward. Everything evolved by
   CMA-ES (population 128, 10,000 generations). Tasks: CartPole, Acrobot, Pendulum, a 5-cell foraging
   grid. Without structural plasticity CartPole models "completely fail". **No cost, energy or budget on
   connections**; the paper mentions none.
2. **"Deep Rewiring: Training very sparse deep networks"** (DEEP R), Bellec, Kappel, Maass,
   Legenstein. ICLR 2018. https://arxiv.org/abs/1711.05136 **[search]** Rewires during training with a
   hard cap on connection count; works at about 2% connectivity on MNIST. Supervised.
3. **"Rigging the Lottery: Making All Tickets Winners"** (RigL), Evci et al. ICML 2020.
   https://arxiv.org/abs/1911.11134 **[search]** Fixed parameter count; prune by magnitude, regrow by
   occasional gradients. SET (Mocanu et al. 2018) is the earlier random-regrow version (not opened).
4. **"The State of Sparse Training in Deep Reinforcement Learning"**, Graesser, Evci, Elsen, Castro.
   ICML 2022. https://arxiv.org/abs/2206.10369 **[search]** Sparse beats dense at equal parameters in
   RL; dynamic sparse beats static; "gradient based growth ... seems to have a limited effect".
5. **"Dynamic Sparse Training for Deep Reinforcement Learning"**, Sokar, Mocanu, Mocanu, Pechenizkiy,
   Stone. IJCAI 2022. https://arxiv.org/abs/2106.04217 **[search]** Topology changes during training on
   continuous control; about half the parameters, fewer steps to dense performance. Also RLx2 (Tan et
   al., https://arxiv.org/abs/2205.15043, [search]; venue reported inconsistently, I did not confirm it).
6. **"Energy Costs and Neural Complexity Evolution in Changing Environments"**, Heesom-Green, Shock,
   Nitschke. ALIFE 2025. https://arxiv.org/abs/2511.20018 **[search]** Evolves RL agents' networks with
   and without energy costs. With costs, seasonal change shrank networks; without costs, environment had
   no effect on size. Structure is set by evolution, not changed during life.
7. **PolyWorld**, Yaeger (from 1994). https://shinyverse.org/larryy/PolyWorld.html **[search]** Agents
   in an ecology spend energy on everything including neural activity, normally with per-neuron and
   per-synapse costs; 50 to 200 neurons with Hebbian synapses; structure is genetic.
8. **"The evolutionary origins of modularity"**, Clune, Mouret, Lipson. Proc. R. Soc. B 2013.
   https://arxiv.org/abs/1207.2743 **[search]** A cost on connections, applied by selection, makes
   evolved networks modular and more evolvable.
9. Neuroscience of the cost, **[search]**: **"Energy efficient synaptic plasticity"**, Li and van
   Rossum, eLife 2020, https://elifesciences.org/articles/50804 (naive plasticity is very costly;
   "synaptic caching" saves up to 10 times); "Competitive plasticity to reduce the energetic costs of
   learning" (bioRxiv 2023, https://www.biorxiv.org/content/10.1101/2023.04.04.535544v1, not opened).
10. **"Growing Artificial Neural Networks for Control: the Role of Neuronal Diversity"**, Nisioti et
    al. arXiv 2024. https://arxiv.org/abs/2405.08510 **[opened, abstract]** Grows networks for
    locomotion; diversity destabilises optimisation unless neurons keep an inherited state and growth is
    paced by lateral inhibition.

### What has NOT been done, as far as I can find

- I found no work where **an embodied agent rewires its own connections during its life and pays for
  each connection (to make and to keep) out of an energy store that it fills by foraging**, so that
  thinking and moving draw on the same food.
- LNDP has lifetime rewiring with no cost. Heesom-Green et al. and PolyWorld have energy costs on brains
  whose structure is fixed for life. Sparse RL training has a hard cap but no economy.
- Searches: "embodied agent neural network metabolic cost synapses energy budget foraging food pays for
  connections evolution artificial life" (extended); "reinforcement learning agent structural
  plasticity energy cost of synapses during lifetime grow prune connections budget 2024 2025"
  (extended); "metabolic cost neural activity regularization reinforcement learning agent energy
  constraint embodied RL" (extended); "structural plasticity energy cost agent lifetime synapse creation
  neuroevolution ALIFE 2024 2025 2026 foraging developmental program" (extended).

### Strongest prior result

LNDP (structure changing in life) and Graesser et al. 2022 (sparse RL can match dense). A reviewer
would ask: is the energy economy doing anything a plain L1 penalty or a fixed cap does not?

### Why it is hard

- At 32 to 64 neurons, sparse and dense nets may differ little; the effect may be too small to see.
- Rewiring under PPO disturbs the optimiser's state (Adam moments, the value function); Graesser et
  al. found gradient-based regrowth gave little.
- A creature that must pay for its brain can learn to starve it. The cost has to be tuned so that a
  bigger brain pays for itself in food.
- "Moves connections" needs a rule for where new ones go; random regrowth (SET) is simple, gradient
  regrowth (RigL) needs dense gradients now and then.

### A small first experiment

- Build: a fixed cap of neurons (say 48, recurrent links allowed) and a cap of synapse slots. PPO trains
  weights. Every K updates: cut the weakest or least used synapses, grow new ones (try random, then
  RigL-style by gradient, then Hebbian by co-activity). Each live synapse costs a little energy per
  second; each new one a lump. Energy comes only from food and is shared with muscles.
- Arms: dense fixed; static sparse with the same count; rewiring with no cost; rewiring with energy
  cost.
- Measure: score on held-out worlds; food eaten; synapses alive over a life; recovery after a leg is
  broken mid-life; where the synapses go (rays, legs, memory, rhythm).
- Interesting: the costed brain matches dense on score with far fewer synapses, and visibly re-routes
  after damage or when hazards appear (more wires from the forward rays, say).
- Failure: no difference from static sparse, or the creature starves its brain, or PPO becomes
  unstable.
- Risk: medium. Newness: narrow but real, if the energy economy turns out to matter.

---

## 4. More than linear: small non-feedforward controllers

The aim: a brain that is more than a plain stack of layers, as a generalist should have.
Everything here is well established; it belongs in the safe base, not in a novelty claim.

- **Continuous-time recurrent networks.** Beer and Gallagher, "Evolving dynamical neural networks for
  adaptive behavior", Adaptive Behavior 1992, https://doi.org/10.1177/105971239200100105 **[search]**:
  CTRNNs evolved for chemotaxis and walking. Liquid and closed-form descendants: "Closed-form
  continuous-time neural networks", Hasani et al., Nature Machine Intelligence 2022,
  https://arxiv.org/abs/2106.13898 **[search]** (claims 1 to 5 orders of magnitude faster than ODE-based
  versions); "Neural circuit policies enabling auditable autonomy", Lechner et al., Nature Machine
  Intelligence 2020, https://github.com/mlech26l/ncps **[search]**: 19 neurons and 253 synapses steer a
  car. I could not confirm the AAAI 2021 "Liquid Time-constant Networks" paper by search.
- **Recurrent policies under partial view.** "Recurrent Model-Free RL Can Be a Strong Baseline for Many
  POMDPs", Ni, Eysenbach, Salakhutdinov, ICML 2022, https://arxiv.org/abs/2110.05038 **[search]**: a
  tuned recurrent PPO-family agent beats specialised methods on 18 of 21 tasks. Rays see only part of
  the world, so memory matters here.
- **Rhythm generators under a learned conductor.** "CPG-RL: Learning Central Pattern Generators for
  Quadruped Locomotion", Bellegarda and Ijspeert, RA-L 2022, https://arxiv.org/abs/2211.00458
  **[search]**: the policy sets oscillator amplitude and frequency; transfers to a real robot carrying
  115% of its mass. This is exactly the idea of rhythm neurons the brain conducts.
- **Modular and graph policies.** "One Policy to Control Them All", Huang, Mordatch, Pathak, ICML 2020,
  https://arxiv.org/abs/2007.04976 **[search]**: one small shared network per actuator, messages
  between them; 20+ planar bodies. "My Body is a Cage", Kurin et al., ICLR 2021,
  https://arxiv.org/abs/2010.01856 **[search]**: removing body structure does not hurt graph policies;
  a transformer (AMORPHEUS) does better. NerveNet (ICLR 2018) and MetaMorph (ICLR 2022) not opened.
- **Attention over sensory tokens.** Tang and Ha 2021 (above); each ray could be a token.
- **World models and curiosity.** "Mastering diverse control tasks through world models" (DreamerV3),
  Hafner et al., Nature 2025, https://danijar.com/project/dreamerv3/ **[search]**; "Curiosity-driven
  Exploration by Self-supervised Prediction" (ICM), Pathak et al., ICML 2017,
  https://arxiv.org/abs/1705.05363 **[search]**; "Exploration by Random Network Distillation" (RND),
  Burda et al., ICLR 2019, https://arxiv.org/abs/1810.12894 **[search]**. RND is the cheapest: one
  fixed random net and one trained to match it.
- **Reservoirs.** I found reservoirs used as forward models and sensors beside CPGs on a hexapod
  (Manoonpong, Dasgupta and others), not as the gait generator itself. Weak evidence for locomotion.

What has not been done: nothing here is open in general. What might be unusual is the *combination on a
visitor-editable page*: a builder where layers of rhythm, memory, mood and plain neurons are wired by
hand and trained by PPO in the tab. That is a page feature, not research novelty.

Strongest prior: a recurrent PPO agent (GRU) is the baseline every one of these must beat. Hard parts:
recurrent PPO needs sequence batching and truncated backpropagation, which the hand-written backward
pass must support; CPGs help gait but can fight a reward that wants hops removed.

First experiment (safe base, low risk, no newness): on the same worlds and budget, compare MLP, GRU
memory, CTRNN-style leaky neurons, and MLP plus four oscillators the policy conducts. Measure score on
held-out worlds, effort per metre, and time airborne with nothing to clear (evolution's creature moves only by hopping, which this is meant to avoid).

---

## 5. Claims the article might make

| Claim | Verdict | Evidence |
|---|---|---|
| RL locomotion trained live in a browser | **False** as a first | `rlsim` (https://github.com/SamuelReeder/rlsim, [opened]): MuJoCo 3.16 WASM physics, PPO in TensorFlow.js 4.22 on WebGPU or CPU, ONNX Runtime Web for inference, training in the tab with IndexedDB checkpoints, a balance-to-walk curriculum; no procedural terrain mentioned. `rl-forge` (https://github.com/HowdyMoto/rl-forge, [opened]): Rapier2D WASM physics, PPO in TensorFlow.js in a Web Worker, a biped "on procedural terrain". |
| ...with no ML library and its own physics | **Unclear, probably true, narrowly** | I found none for locomotion. REINFORCEjs (Karpathy, https://cs.stanford.edu/people/karpathy/reinforcejs/, [search]) did DQN in plain JavaScript with no library, years ago, but not locomotion. Evolved walkers in the browser with hand-written networks are common (Keiwan's "Evolution", made with Unity, https://keiwan.itch.io/evolution, [search]; many NEAT walkers). So only "PPO written from scratch, own physics, in a tab" may be new. |
| Web-Gewu trains in the browser | **False** | https://arxiv.org/abs/2604.17050 [opened]: "offloads all physics simulation and reinforcement learning (RL) training to the edge node"; the browser only streams. |
| An open-ended curriculum (POET/PAIRED/PLR/ACCEL/OMNI) running entirely in a tab | **Unclear, probably true** | I found no live in-browser trainer. The Neuroevolution Book demo page (https://neuroevolutionbook.com/demos/, [opened]) links POET only to blog posts and videos. The ACCEL code is Python (facebookresearch/dcd, JaxUED). I could not open the ACCEL project page (the fetch failed), which may run pretrained agents. |
| "Evolution alone (POET) needed a cluster" | **True** | Enhanced POET: 40 agents, 60,000 iterations, 12 days on 750 cores (VentureBeat report of https://arxiv.org/abs/2003.08536, [search]; not confirmed in the paper text). Original POET compute I did not verify. |
| "Hard 2D parkour is still open (TeachMyAgent)" | **True as of 2021; no later solve found** | Romac et al., ICML 2021, https://arxiv.org/abs/2103.09815 [search]: "The Parkour environment remains an open problem"; best teacher masters about 26% of tasks, climber near 0%. I found no 2022 to 2026 paper solving it, but also few that tried. Say "was reported open". |
| Same-engine, same-compute comparison of evolution, PPO and hybrids | **False in general; unclear for procedurally generated locomotion with a teacher** | Many exist: Salimans et al. 2017 (https://arxiv.org/abs/1703.03864, not opened); "Efficacy of Modern Neuro-Evolutionary Strategies for Continuous Control Optimization", Pagliuca, Milano, Nolfi, 2020 (https://arxiv.org/abs/1912.05239, [search]); "Qualitative Differences Between Evolutionary Strategies and Reinforcement Learning Methods for Control of Autonomous Agents", Milano and Nolfi 2022 (https://arxiv.org/abs/2205.07592, [opened]): reward design changes which wins, so rewards must be tuned per method; the survey "Deep Reinforcement Learning Versus Evolution Strategies", Majid et al., TNNLS 2024 (https://arxiv.org/abs/2110.01411, [search]); hybrids ERL (Khadka and Tumer, NeurIPS 2018), CEM-RL (Pourchot and Sigaud, ICLR 2019), PBT. I found no controlled comparison on procedurally generated worlds with a teacher, at equal compute, in one engine. |

The honest form of the article's context claim: "As far as we found, this is the first time PPO, evolution
and an ACCEL-style teacher, all written from scratch with their own physics, run and are compared in a
browser tab." Even that should carry "as far as we found".

---

## Combinations, searched

- **Evolved neuron rules whose plasticity is paid from energy (1 + 3).** Searched "evolved plasticity
  rule metabolic energy cost of synaptic change meta-learning agent energy penalty learning rule
  evolution" (extended) and the structural-plasticity searches in section 3. Found the parts (LNDP's
  learned grow and prune rules; Li and van Rossum on the energy of plasticity; Heesom-Green et al. on
  energy and brain size) but no work joining them. My reading: this is the most original combination,
  and it can be made small, because the "rule" need only be the few numbers that decide what to grow
  and cut.
- **A culture that passes on neuron rules, not behaviour (1 + 2).** Searched "agents socially transmit
  learning rules or plasticity parameters instead of behaviour; cultural transmission of meta-learned
  update rule population" (extended) and Heyes's "cognitive gadgets". Found no computational work; the
  nearest is a 2001 model where agents passed on evaluation criteria
  (http://cfpm.org/jom-emit/2001/vol4/baldassarre_g.html, [search]). My reading: it is muddled.
  Copying a rule directly is genetic inheritance under another name (population-based training already
  copies hyperparameters); learning a rule by watching is hard to define. Not recommended.

---

## Recommendation

### The risky bet: a brain that rewires on a budget (idea 3), with the rewiring rule found by evolution

Why this one:

- **Newness.** The gap is narrow but clean and checked: lifetime rewiring paid from foraged energy, in
  an embodied learner, has no direct prior that I found. Ideas 2 and 4 are published; idea 1's best
  version is too costly to test here.
- **Chance it works at this scale.** The mechanics are simple and cheap (prune, regrow, an energy
  ledger). Sparse RL is known to work (Graesser et al.). The risk is only whether the energy economy
  produces something worth seeing, and either answer is reportable.
- **On the page.** It shows better than anything else: the brain's picture with wires appearing and
  dying, an energy bar split between muscles and mind, a visitor breaking a leg and watching wires
  re-route. It fits a builder in which the neuron cap and the price of a synapse are set by hand.
- **Fit.** It is the limit wanted (a most number of neurons, with the synapses and connections
  changing), it uses the needs and food already planned, and a generalist that budgets its own
  mind is a story an article can tell.
- **How it takes in idea 1, cheaply.** Make the grow and cut rule a tiny formula with three or four
  evolved coefficients (how much to weigh weight size, recent use, co-activity and gradient), evolved
  slowly across generations while PPO trains weights. This is "neurons whose rules are found", in a form
  a tab can afford. Do not claim "new neuron types" from it.

What would make it fail early: the costed arm no better than static sparse after a fair sweep of the
price. Then the result is "energy budgets do not matter at this size", which is still honest and
publishable as a negative, but not exciting.

Runner-up: idea 1 in the PANGAEA form (evolved neuron programs, PPO inside). Higher newness, much lower
chance of a clear result in a tab.

### The safe base

1. PPO as built, plus a recurrent memory (GRU or leaky CTRNN neurons) and an MLP baseline.
2. Rhythm neurons as in CPG-RL: oscillators whose amplitude and frequency the policy sets.
3. Mood neurons as neuromodulation (Soltoggio; Backpropamine) gating plasticity or gain.
4. Hebbian neurons with a learned rule (Najarro and Risi) and the broken-leg test.
5. Curiosity by RND, plus needs (energy, food).
6. The ACCEL-style teacher, with the evolution baseline, and numbers kept from the start, with rewards
   tuned fairly for each method (Milano and Nolfi).
7. Optionally the ghost of the ancestor (Cook et al.) as a visible feature, credited as a reproduction.

### Well-trodden, so the article must not claim them

- Neurons that learn while living with a learned rule; mood neurons; rhythm neurons; memory and timing
  neurons; recovering from a broken leg (Najarro and Risi 2020; AutoRobotics-Zero 2023).
- Culture without weight copying (Cook et al. 2024 did this with PPO).
- RL locomotion trained in the browser (rlsim, rl-forge).
- Evolution against RL comparisons in general, and ERL/CEM-RL style hybrids.
- Shared neuron rules and a few neuron types found by evolution (SFNN 2024, ENU 2020, VSML 2021).

## Not opened, or uncertain

- The ACCEL project page (fetch failed). Original POET compute. The AAAI 2021 LTC paper (not confirmed
  by search). RLx2 venue. SET, NerveNet, MetaMorph, Plan2Explore, Salimans 2017: cited from memory of
  their identifiers, not opened in this search; check before citing in the article.
