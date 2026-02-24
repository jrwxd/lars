/**
 * Formal Definition of a Cellular Automaton (CA)
 *
 * A cellular automaton is defined as a tuple A = (L, S, N, f) where:
 * - L is a regular, discrete lattice of cells (represented here by its dimensionality).
 * - S is a finite set of states (represented by the generic type parameter S).
 * - N is a finite set of neighborhood offset vectors.
 * - f is a local transition function mapping S^{|N|} -> S.
 */

/**
 * Represents a discrete coordinate vector in the d-dimensional lattice L.
 * e.g., [x] for 1D, [x, y] for 2D, [x, y, z] for 3D.
 */
export type Coordinate<D extends number> = number[] & { length: D };

/**
 * Represents the neighborhood N.
 * N is a finite ordered sequence of displacement vectors.
 * For a central cell c, its neighbors are c + v_i for each v_i in N.
 */
export type Neighborhood<D extends number> = ReadonlyArray<Coordinate<D>>;

/**
 * Represents the state assignment of a specific neighborhood.
 * This is an element of S^{|N|}.
 * The length of this array strictly matches the length of the Neighborhood array.
 */
export type NeighborhoodConfiguration<S> = ReadonlyArray<S>;

/**
 * Abstract implementation of a global configuration C.
 * A global configuration maps every cell in the lattice to a state (C: L -> S).
 * Since L is infinite, derived implementations manage this storage (e.g., hash maps, arrays, sparse matrices).
 */
export abstract class GlobalConfiguration<D extends number, S> {
    /**
     * @param quiescentState The default state for uninitialized bounds of the lattice.
     */
    constructor(public readonly quiescentState: S) { }

    /**
     * Evaluates C(c) -> s
     * Retrieves the state of the cell at a given coordinate.
     * If a cell is not explicitly tracked, it usually returns the `quiescentState`.
     * 
     * @param coord The coordinate c ∈ L
     * @returns The state s ∈ S
     */
    abstract getState(coord: Coordinate<D>): S;

    /**
     * Updates C(c) = s
     * Sets the state of a cell at a given coordinate.
     * 
     * @param coord The coordinate c ∈ L
     * @param state The state s ∈ S
     */
    abstract setState(coord: Coordinate<D>, state: S): void;
}

/**
 * A finite domain D ⊂ L that enforces boundary conditions on coordinates.
 * This is essential for converting an infinite lattice L into an explicitly
 * computable framework (like a torus or bounded rectangle).
 */
export abstract class LatticeDomain<D extends number> {
    /**
     * Resolves a potentially out-of-bounds coordinate `c ∈ L` back into the finite domain `D`.
     * Returns `null` if the coordinate falls completely outside the simulated scope (e.g., strict finite bounds).
     * Returns the `Coordinate<D>` if it dynamically wraps (e.g., periodic/toroidal boundary).
     */
    abstract resolveBoundary(coord: Coordinate<D>): Coordinate<D> | null;
}

/**
 * A finite toroidal domain (periodic boundary conditions).
 * Maps coordinates continuously by wrapping them modulo the size of the dimension.
 */
export class ToroidalDomain<D extends number> extends LatticeDomain<D> {
    constructor(public readonly dimensions: Coordinate<D>) {
        super();
    }

    resolveBoundary(coord: Coordinate<D>): Coordinate<D> {
        const wrapped = Array(coord.length) as Coordinate<D>;
        for (let i = 0; i < coord.length; i++) {
            const size = this.dimensions[i];
            // Javascript handle modulo for negative numbers (e.g., -1 % 10 = -1 -> 9)
            wrapped[i] = ((coord[i] % size) + size) % size;
        }
        return wrapped;
    }
}

/**
 * A Strict Lattice Domain that enforces a hard border constraint in all dimensions.
 * Evaluates to vacuum (null) if coordinates exceed structural bounds.
 */
export class StrictDomain<D extends number> extends LatticeDomain<D> {
    constructor(public readonly dimensions: Coordinate<D>) {
        super();
    }

    resolveBoundary(coord: Coordinate<D>): Coordinate<D> | null {
        for (let i = 0; i < coord.length; i++) {
            if (coord[i] < 0 || coord[i] >= this.dimensions[i]) {
                return null;
            }
        }
        return coord;
    }
}

/**
 * A Cylindrical Domain (2D).
 * Wraps periodically along the X-axis (Dimension 0), but enforces hard boundaries on the Y-axis.
 */
export class CylindricalDomain extends LatticeDomain<2> {
    constructor(public readonly dimensions: Coordinate<2>) {
        super();
    }

    resolveBoundary(coord: Coordinate<2>): Coordinate<2> | null {
        const [x, y] = coord;
        const [sizeX, sizeY] = this.dimensions;

        if (y < 0 || y >= sizeY) return null; // Strict Y boundary

        const wrappedX = ((x % sizeX) + sizeX) % sizeX;
        return [wrappedX, y] as Coordinate<2>;
    }
}

/**
 * A Mobius Strip Domain (2D).
 * Wraps periodically along the X-axis with a topological twist (inverts Y).
 * Enforces strict hard boundaries on the Y-axis.
 */
export class MobiusDomain extends LatticeDomain<2> {
    constructor(public readonly dimensions: Coordinate<2>) {
        super();
    }

    resolveBoundary(coord: Coordinate<2>): Coordinate<2> | null {
        let [x, y] = coord;
        const [sizeX, sizeY] = this.dimensions;

        if (y < 0 || y >= sizeY) return null; // Strict Y boundary

        if (x < 0 || x >= sizeX) {
            const wraps = Math.floor(x / sizeX);
            x = ((x % sizeX) + sizeX) % sizeX;

            // Twist the Y axis if we wrapped an odd number of times
            if (Math.abs(wraps) % 2 === 1) {
                y = sizeY - 1 - y;
            }
        }

        return [x, y] as Coordinate<2>;
    }
}

/**
 * A Klein Bottle Domain (2D).
 * Wraps periodically along both axes, but the X-axis wrap contains a Mobius twist (inverts Y).
 */
export class KleinBottleDomain extends LatticeDomain<2> {
    constructor(public readonly dimensions: Coordinate<2>) {
        super();
    }

    resolveBoundary(coord: Coordinate<2>): Coordinate<2> | null {
        let [x, y] = coord;
        const [sizeX, sizeY] = this.dimensions;

        y = ((y % sizeY) + sizeY) % sizeY; // Toroidal Y wrap

        if (x < 0 || x >= sizeX) {
            const wraps = Math.floor(x / sizeX);
            x = ((x % sizeX) + sizeX) % sizeX;

            // Twist the Y axis if we wrapped an odd number of times across X
            if (Math.abs(wraps) % 2 === 1) {
                y = sizeY - 1 - y;
            }
        }

        return [x, y] as Coordinate<2>;
    }
}

/**
 * Abstract mathematical structure for the Cellular Automaton A = (L, S, N, f).
 */
export abstract class CellularAutomaton<D extends number, S> {
    /**
     * @param dimensions The dimensionality of the regular lattice L (e.g., 1, 2, 3).
     * @param states The finite set of possible states S.
     * @param neighborhood The finite set of relative neighborhood vectors N.
     * @param quiescentState The quiescent state q ∈ S.
     */
    constructor(
        public readonly dimensions: D,
        public readonly states: ReadonlySet<S>,
        public readonly neighborhood: Neighborhood<D>,
        public readonly quiescentState: S
    ) {
        if (!this.states.has(quiescentState)) {
            throw new Error("Initialization constraint failed: The quiescent state must belong to the state set S.");
        }
    }

    /**
     * The local transition function f: S^{|N|} -> S.
     * Maps the states of a cell's neighborhood to the new state of the central cell.
     * Derived classes must implement the specific ruleset here.
     * 
     * @param config The assigned states of the neighborhood S^{|N|}.
     * @returns The newly evaluated state s ∈ S.
     */
    abstract transition(config: NeighborhoodConfiguration<S>): S;

    /**
     * Utility mathematical constraint: Validates if the given CA has a valid quiescent state.
     * f(q, q, ..., q) = q must mathematically hold true.
     */
    isQuiescentStateRigorous(): boolean {
        const quiescentConfig: NeighborhoodConfiguration<S> = this.neighborhood.map(() => this.quiescentState);
        return this.transition(quiescentConfig) === this.quiescentState;
    }

    /**
     * Retrieves the structural neighborhood offsets for a given absolute coordinate.
     * Most regular CAs have constant neighborhood offsets, but crystalline lattices (like Hex or Tri) 
     * use coordinate parity to determine the basis offsets.
     * 
     * @param coord The absolute target coordinate
     * @returns Array of relative topological offsets
     */
    getNeighborhoodOffsets(coord: Coordinate<D>): Neighborhood<D> {
        return this.neighborhood; // Default: structurally invariant
    }

    /**
     * The global transition function G: C -> C'.
     * Evolves the specified domain of the configuration by one time step synchronously.
     * 
     * @param currentConfig The global configuration C at time t.
     * @param targetCells The finite sequence of cell coordinates to inherently simulate.
     * @param nextConfig The targeted global configuration C' at time t+1 to structurally mutate.
     * @param domain The finite lattice domain resolving arbitrary physical boundaries.
     */
    evolve(
        currentConfig: GlobalConfiguration<D, S>,
        targetCells: Iterable<Coordinate<D>>,
        nextConfig: GlobalConfiguration<D, S>,
        domain: LatticeDomain<D>
    ): void {
        for (const targetCoord of targetCells) {
            // 1. Construct the neighborhood vector mappings for target cell `c`: c + n_i
            // Dynamically query offsets to support non-rectangular topologies (Hex/Tri)
            const offsets = this.getNeighborhoodOffsets(targetCoord);

            const neighborStates: S[] = offsets.map((offset) => {
                const absoluteCoord = targetCoord.map((c_val, i) => c_val + offset[i]) as Coordinate<D>;

                // Resolve physical boundary (e.g. toroidal wrap limit)
                const resolvedCoord = domain.resolveBoundary(absoluteCoord);

                if (resolvedCoord === null) {
                    // Absolute boundary constraint exceeded. Default to quiescent "vacuum" state.
                    return this.quiescentState;
                }

                return currentConfig.getState(resolvedCoord);
            });

            // 2. Evaluate f(S^{|N|}) -> s'
            const nextState = this.transition(neighborStates);

            // 3. Mathematical domain enforcement
            if (!this.states.has(nextState)) {
                throw new Error(`State violation: Transition output ${String(nextState)} is not an element of S.`);
            }

            // 4. Update C'(c) = s' (Applying boundary limits to mutate the underlying storage map)
            const mappedTargetCoord = domain.resolveBoundary(targetCoord);
            if (mappedTargetCoord !== null) {
                nextConfig.setState(mappedTargetCoord, nextState);
            }
        }
    }
}

/**
 * Totalistic Cellular Automaton Base Class
 * 
 * A Totalistic CA is a specific type of cellular automaton where the state space S 
 * is a subset of real numbers (typically integers, S ⊂ Z).
 * 
 * The local transition function f does not depend on the exact arrangement of 
 * states in the neighborhood, but solely on their sum:
 * f(s_1, s_2, ..., s_n) = g(Σ s_i)
 * 
 * Or for outer-totalistic: f(s_center, Σ s_neighbors)
 */
export abstract class TotalisticCellularAutomaton<D extends number> extends CellularAutomaton<D, number> {
    /**
     * The evaluation function `g(sum)` for a totalistic CA.
     * 
     * @param configurationSum The sum of all states in the neighborhood configuration.
     * @returns The updated state s' ∈ S.
     */
    abstract evaluateSum(configurationSum: number): number;

    /**
     * Overrides the general transition function to use the totalistic sum reduction.
     */
    transition(config: NeighborhoodConfiguration<number>): number {
        const sum = config.reduce((acc, curr) => acc + curr, 0);
        return this.evaluateSum(sum);
    }
}

/**
 * Outer-Totalistic Cellular Automaton Base Class
 * 
 * In an Outer-Totalistic CA (like Conway's Game of Life), the transition depends on:
 * 1. The state of the central cell itself.
 * 2. The sum of the states of the outer neighbors.
 * 
 * We assume by convention that the LAST element in the neighborhood `N` is the central cell `(0,0,...,0)`.
 */
export abstract class OuterTotalisticCellularAutomaton<D extends number> extends CellularAutomaton<D, number> {
    constructor(
        dimensions: D,
        states: ReadonlySet<number>,
        neighborhood: Neighborhood<D>,
        quiescentState: number,
        public readonly frequencyDomain: number = 0
    ) {
        super(dimensions, states, neighborhood, quiescentState);
    }

    /**
     * The evaluation function `g(s_center, sum_outer)` for an outer-totalistic CA.
     * 
     * @param centerState The state of the central cell.
     * @param outerSum The sum of the remaining outer neighbors in the neighborhood.
     * @returns The updated state s' ∈ S.
     */
    abstract evaluateOuterSum(centerState: number, outerSum: number): number;

    /**
     * Overrides the general transition function.
     * It partitions the configuration into the center state and the remaining outer states.
     * 
     * Assumes the central cell is the designated `centerIndex` (defaults to the last item in the neighborhood).
     * 
     * @param config The full neighborhood configuration.
     */
    transition(config: NeighborhoodConfiguration<number>): number {
        // By convention, if not overridden, assume the last element is the center cell [0, ..., 0]
        const centerIndex = config.length - 1;

        const centerStateRaw = config[centerIndex];
        let centerStateBase = centerStateRaw;
        let outerSum = 0;

        if (this.frequencyDomain > 0) {
            // Frequency Domain > 0 constraint:
            // 2N states (N = frequencyDomain). 
            // 1 to N are alive states (1 = a0, N = stable alive)
            // N+1 to 2N-1 are dead states (N+1 = d0), 0 is strictly dead
            centerStateBase = (centerStateRaw > 0 && centerStateRaw <= this.frequencyDomain) ? 1 : 0;

            for (let i = 0; i < config.length; i++) {
                if (i !== centerIndex) {
                    const isAlive = (config[i] > 0 && config[i] <= this.frequencyDomain) ? 1 : 0;
                    outerSum += isAlive;
                }
            }
        } else {
            for (let i = 0; i < config.length; i++) {
                if (i !== centerIndex) {
                    outerSum += config[i];
                }
            }
        }

        const nextStateBase = this.evaluateOuterSum(centerStateBase, outerSum);

        if (this.frequencyDomain > 0) {
            if (centerStateBase === 0) {
                // Was logically dead
                if (nextStateBase === 1) return 1; // Dead -> Alive (a0=1)

                // Dead -> Dead
                if (centerStateRaw === 0) return 0; // Strictly dead stays 0
                const nextDead = centerStateRaw + 1;
                return nextDead >= 2 * this.frequencyDomain ? 0 : nextDead;
            } else {
                // Was logically alive
                if (nextStateBase === 1) {
                    // Alive -> Alive
                    if (centerStateRaw === this.frequencyDomain) return this.frequencyDomain; // Stable alive
                    return centerStateRaw + 1;
                } else {
                    // Alive -> Dead
                    return this.frequencyDomain + 1; // (d0)
                }
            }
        }

        return nextStateBase;
    }
}

/**
 * Concrete Implementation: Conway's Game of Life
 * 
 * - Dimensions D = 2
 * - States S = {0, 1}
 * - Neighborhood N = Moore Neighborhood (8 outer + 1 inner)
 * - f = B3/S23 (Birth on 3, Survival on 2 or 3).
 * - Quiescent State q = 0
 */
export class GameOfLife extends OuterTotalisticCellularAutomaton<2> {
    private readonly survivalRules: Set<number>;
    private readonly birthRules: Set<number>;

    /**
     * @param survival Array of neighbor counts required to survive (default [2, 3])
     * @param birth Array of neighbor counts required to be born (default [3])
     */
    constructor(survival: number[] = [2, 3], birth: number[] = [3], frequencyDomain: number = 0) {

        const states = new Set<number>([0, 1]);
        if (frequencyDomain > 0) {
            for (let i = 2; i < 2 * frequencyDomain; i++) {
                states.add(i);
            }
        }

        super(
            2, // D = 2 dimensions
            states, // S
            [
                // N = Moore Neighborhood. Last element is the center [0,0].
                [-1, -1], [0, -1], [1, -1],
                [-1, 0], [1, 0],
                [-1, 1], [0, 1], [1, 1],
                [0, 0]  // Convention: Center cell must be the final index.
            ] as Coordinate<2>[],
            0, // q = 0 (Dead state by default)
            frequencyDomain
        );

        this.survivalRules = new Set(survival);
        this.birthRules = new Set(birth);
    }

    /**
     * The rigorous transition function f(s_center, outerSum).
     * Evaluates dynamically against the initialized ruleset (e.g. B3/S23, B36/S23).
     * 
     * @param centerState The current state of the cell (0 or 1).
     * @param outerSum The sum of its 8 Moore neighbors (0 to 8).
     * @returns Next state.
     */
    evaluateOuterSum(centerState: number, outerSum: number): number {
        if (centerState === 1) {
            return this.survivalRules.has(outerSum) ? 1 : 0;
        } else {
            return this.birthRules.has(outerSum) ? 1 : 0;
        }
    }
}

/**
 * Hexagonal Game of Life defined on an Odd-R Hexagonal Lattice mapped to Z^2.
 * The structural neighborhood vectors vary mathematically based on row parity (y % 2).
 */
export class HexagonalGameOfLife extends OuterTotalisticCellularAutomaton<2> {
    private readonly survivalRules: Set<number>;
    private readonly birthRules: Set<number>;

    /**
     * @param survival Array of neighbor counts required to survive (default [3, 4])
     * @param birth Array of neighbor counts required to be born (default [2])
     */
    constructor(survival: number[] = [3, 4], birth: number[] = [2], frequencyDomain: number = 0) {

        const states = new Set<number>([0, 1]);
        if (frequencyDomain > 0) {
            for (let i = 2; i < 2 * frequencyDomain; i++) {
                states.add(i);
            }
        }

        super(
            2,
            states,
            [], // Dynamic evaluation overrides Neighborhood instantiation 
            0,
            frequencyDomain
        );

        this.survivalRules = new Set(survival);
        this.birthRules = new Set(birth);
    }

    getNeighborhoodOffsets(coord: Coordinate<2>): Neighborhood<2> {
        // Hexagonal mapped to "odd-r" Cartesian indices.
        const isOddRow = Math.abs(coord[1]) % 2 === 1;

        if (isOddRow) {
            return [
                [-1, 0], [1, 0], // W, E
                [0, -1], [1, -1], // NW, NE
                [0, 1], [1, 1], // SW, SE
                [0, 0] // Center
            ] as unknown as Neighborhood<2>;
        } else {
            return [
                [-1, 0], [1, 0], // W, E
                [-1, -1], [0, -1], // NW, NE
                [-1, 1], [0, 1], // SW, SE
                [0, 0] // Center
            ] as unknown as Neighborhood<2>;
        }
    }

    evaluateOuterSum(centerState: number, outerSum: number): number {
        if (centerState === 1) {
            return this.survivalRules.has(outerSum) ? 1 : 0;
        } else {
            return this.birthRules.has(outerSum) ? 1 : 0;
        }
    }
}

/**
 * Triangular Cellular Automaton defined on a structural 2D triangular mesh.
 * Nodes resolve mathematically based on structural orientation (UP vs DOWN triangles).
 * Orientation is strictly determined by the parity of (x + y).
 */
export class TriangularGameOfLife extends OuterTotalisticCellularAutomaton<2> {
    private readonly survivalRules: Set<number>;
    private readonly birthRules: Set<number>;

    /**
     * @param survival Array of neighbor counts required to survive (default [1, 2])
     * @param birth Array of neighbor counts required to be born (default [2])
     */
    constructor(survival: number[] = [1, 2], birth: number[] = [2], frequencyDomain: number = 0) {

        const states = new Set<number>([0, 1]);
        if (frequencyDomain > 0) {
            for (let i = 2; i < 2 * frequencyDomain; i++) {
                states.add(i);
            }
        }

        super(
            2,
            states,
            [], // Dynamic evaluation overrides Neighborhood instantiation 
            0,
            frequencyDomain
        );

        this.survivalRules = new Set(survival);
        this.birthRules = new Set(birth);
    }

    getNeighborhoodOffsets(coord: Coordinate<2>): Neighborhood<2> {
        // (x + y) even = UP Triangle. Shares bottom edge.
        // (x + y) odd = DOWN Triangle. Shares top edge.
        const isUpTriangle = Math.abs(coord[0] + coord[1]) % 2 === 0;

        if (isUpTriangle) {
            return [
                [-1, 0], [1, 0], [0, 1], // Left, Right, Bottom
                [0, 0] // Center
            ] as unknown as Neighborhood<2>;
        } else {
            return [
                [-1, 0], [1, 0], [0, -1], // Left, Right, Top
                [0, 0] // Center
            ] as unknown as Neighborhood<2>;
        }
    }

    evaluateOuterSum(centerState: number, outerSum: number): number {
        if (centerState === 1) {
            return this.survivalRules.has(outerSum) ? 1 : 0;
        } else {
            return this.birthRules.has(outerSum) ? 1 : 0;
        }
    }
}

/**
 * A Sparse Configuration C mapping explicitly active cells to states.
 * Ideal for infinite lattices or configurations where only a small subset of cells
 * deviate from the quiescent state (e.g., gliders traveling outward forever).
 * Uses stringified coordinates 'x,y,z' as hash map keys.
 */
export class SparseConfiguration<D extends number, S> extends GlobalConfiguration<D, S> {
    private readonly stateMap: Map<string, S> = new Map();

    /**
     * Serializes a Coordinate<D> into a unique string key.
     * e.g., [-1, 5] -> "-1,5"
     */
    private hashKey(coord: Coordinate<D>): string {
        return coord.join(",");
    }

    getState(coord: Coordinate<D>): S {
        const key = this.hashKey(coord);
        const state = this.stateMap.get(key);
        return state !== undefined ? state : this.quiescentState;
    }

    setState(coord: Coordinate<D>, state: S): void {
        const key = this.hashKey(coord);
        if (state === this.quiescentState) {
            // Memory optimization: Erase explicit tracking of cells returning to quiescence.
            // This enforces the mathematical concept that quiescent cells don't "exist" computationally.
            this.stateMap.delete(key);
        } else {
            this.stateMap.set(key, state);
        }
    }

    /**
     * Returns an iterator of all explicitly tracked non-quiescent coordinates.
     * This is extremely useful for calculating the "active bound box" of the simulation.
     */
    *getActiveCoordinates(): IterableIterator<Coordinate<D>> {
        for (const key of this.stateMap.keys()) {
            yield key.split(",").map(Number) as Coordinate<D>;
        }
    }
}

/**
 * A Dense Configuration C mapping a finite lattice strictly into contiguous memory.
 * Ideal for bounded, heavily populated grids (e.g., standard game rendering grids).
 * Resolves D-dimensional mathematical coordinates into a flattened 1D array computing dimensional strides.
 */
export class DenseConfiguration<D extends number, S> extends GlobalConfiguration<D, S> {
    private readonly buffer: S[];
    private readonly strides: number[];
    public readonly totalVolume: number;

    /**
     * @param dimensions The finite size constraints of the array representation.
     * @param quiescentState The natural vacuum background state.
     */
    constructor(public readonly dimensions: Coordinate<D>, quiescentState: S) {
        super(quiescentState);

        // Compute exact memory block footprint and multi-dimensional index strides
        this.strides = new Array(dimensions.length).fill(0);

        let currentStride = 1;
        // Iterate from innermost dimension outward
        for (let i = dimensions.length - 1; i >= 0; i--) {
            this.strides[i] = currentStride;
            currentStride *= dimensions[i];
        }

        this.totalVolume = currentStride;

        // Allocate the contiguous memory block, flooded with the quiescent parameter
        this.buffer = new Array<S>(this.totalVolume).fill(quiescentState);
    }

    /**
     * Flattens a vector `c ∈ L` into the 1D physical memory buffer index mathematically.
     */
    private getIndex(coord: Coordinate<D>): number {
        let index = 0;
        for (let i = 0; i < coord.length; i++) {
            // Enforce physical boundary safety within the buffer.
            // It is assumed coordinates passed have ALREADY been validated by a `LatticeDomain` wrapper map.
            if (coord[i] < 0 || coord[i] >= this.dimensions[i]) {
                throw new RangeError(`Out of bounds tensor evaluation: index ${coord[i]} at dimension ${i}`);
            }
            index += coord[i] * this.strides[i];
        }
        return index;
    }

    getState(coord: Coordinate<D>): S {
        try {
            const idx = this.getIndex(coord);
            return this.buffer[idx];
        } catch {
            // Fallback constraint: The configuration acts as a black box that yields vacuum 
            // if read outside its explicitly allocated tensor size bounds.
            return this.quiescentState;
        }
    }

    setState(coord: Coordinate<D>, state: S): void {
        const idx = this.getIndex(coord);
        this.buffer[idx] = state;
    }
}
