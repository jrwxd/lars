import { GameOfLife, DenseConfiguration, SparseConfiguration, ToroidalDomain, LatticeDomain, Coordinate, GlobalConfiguration, CylindricalDomain, MobiusDomain, KleinBottleDomain, HexagonalGameOfLife, TriangularGameOfLife, OuterTotalisticCellularAutomaton } from './cellular_automaton.js';
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CANVAS_SIZE = 800; // Physical pixels
let GRID_WIDTH = 100;
let GRID_HEIGHT = 100;
let CELL_WIDTH = Math.floor(CANVAS_SIZE / GRID_WIDTH);
let CELL_HEIGHT = Math.floor(CANVAS_SIZE / GRID_HEIGHT);
const FPS = 15;
let isPaused = false;
let globalGeneration = 0;

interface ColorStrategy {
    getColor(state: number, frequencyDomain: number): string | null;
}

class CyclicalGenesisColorStrategy implements ColorStrategy {
    getColor(state: number, frequencyDomain: number): string | null {
        if (state === 0) return null; // strictly dead background (Black)

        if (state === 2) return '#dd00aa'; // Nether Purple

        if (frequencyDomain > 0) {
            // Alive states: 1 to N
            const ratio = frequencyDomain === 1 ? 0 : (state - 1) / (frequencyDomain - 1);
            const hue = Math.floor(ratio * 360);
            return `hsl(${hue}, 100%, 50%)`;
        }

        return '#0f0'; // Default Vibrant Green
    }
}

class MonochromeColorStrategy implements ColorStrategy {
    getColor(state: number, frequencyDomain: number): string | null {
        if (state === 0) return null; // strictly dead background (Black)
        if (state === 2) return '#dd00aa'; // Nether Purple
        return '#0f0'; // Default Vibrant Green
    }
}

let activeColorStrategy: ColorStrategy = new CyclicalGenesisColorStrategy();

/**
 * A Strict Lattice Domain that enforces a hard border constraint.
 * If a coordinate extends past [0, GRID_WIDTH-1], it resolves to mathematical `null` (Vacuum).
 */
export class StrictDomain<D extends number> extends LatticeDomain<D> {
    constructor(public readonly dimensions: Coordinate<D>) {
        super();
    }

    resolveBoundary(coord: Coordinate<D>): Coordinate<D> | null {
        for (let i = 0; i < coord.length; i++) {
            if (coord[i] < 0 || coord[i] >= this.dimensions[i]) {
                return null; // Out of bounds evaluates to vacuum
            }
        }
        return coord;
    }
}

// Generate the specific finite block subset of `L` to formally simulate.
function createSimulationBounds(width: number, height: number): Coordinate<2>[] {
    const coords: Coordinate<2>[] = [];
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            coords.push([x, y] as unknown as Coordinate<2>);
        }
    }
    return coords;
}

let simulationBounds: Coordinate<2>[] = [];
let dimensions: Coordinate<2>;
let ca: OuterTotalisticCellularAutomaton<2> = new GameOfLife([2, 3], [3], null, 0, 'moore');

let currentConfig: GlobalConfiguration<2, number>;
let nextConfig: GlobalConfiguration<2, number>;
let domain: LatticeDomain<2>;
let intervalId: number | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let offscreenCanvas: HTMLCanvasElement | null = null;

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let mesh: THREE.Mesh | null = null;
let texture: THREE.CanvasTexture | null = null;

function updateGeometry(domainType: string) {
    if (!mesh || !scene) return;
    const oldGeom = mesh.geometry;

    if (domainType === 'strict') {
        mesh.geometry = new THREE.PlaneGeometry(2, 2);
    } else if (domainType === 'toroidal') {
        mesh.geometry = new THREE.TorusGeometry(0.7, 0.3, 32, 100);
    } else if (domainType === 'cylindrical') {
        mesh.geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 64, 1, true);
    } else if (domainType === 'mobius') {
        mesh.geometry = new THREE.TorusKnotGeometry(0.6, 0.2, 100, 16, 1, 2);
    } else if (domainType === 'klein') {
        mesh.geometry = new THREE.TorusKnotGeometry(0.6, 0.2, 100, 16, 2, 3);
    } else {
        mesh.geometry = new THREE.PlaneGeometry(2, 2);
    }

    if (oldGeom) oldGeom.dispose();
}

// -- PRNG Utilities for reproducible states --
function xmur3(str: string) {
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = h << 13 | h >>> 19;
    }
    return function () {
        h = Math.imul(h ^ h >>> 16, 2246822507);
        h = Math.imul(h ^ h >>> 13, 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }
}

function mulberry32(a: number) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

let rng = Math.random;
let loadedState: any = null;

export function exportStateToSeed() {
    const activeCells: [number, number, number][] = [];
    if (currentConfig instanceof SparseConfiguration) {
        for (const coord of currentConfig.getActiveCoordinates()) {
            activeCells.push([coord[0], coord[1], currentConfig.getState(coord)]);
        }
    } else {
        for (const coord of simulationBounds) {
            const state = currentConfig.getState(coord);
            if (state !== 0) {
                activeCells.push([coord[0], coord[1], state]);
            }
        }
    }

    const exportObj = {
        generation: globalGeneration,
        cells: activeCells
    };

    const jsonStr = JSON.stringify(exportObj);
    const b64 = btoa(jsonStr);
    const stateString = `STATE:${b64}`;

    const seedEl = document.getElementById('seedInput') as HTMLInputElement;
    if (seedEl) {
        seedEl.value = stateString;
        seedEl.style.backgroundColor = '#053005';
        setTimeout(() => seedEl.style.backgroundColor = '', 300);
    }
    console.log(`Exported Board State (Generation ${globalGeneration}):`, stateString);
}

function seedEcosystem() {
    if (loadedState && loadedState.cells) {
        globalGeneration = loadedState.generation || 0;
        for (const cell of loadedState.cells) {
            if (cell.length >= 3) {
                if (cell[0] >= 0 && cell[0] < GRID_WIDTH && cell[1] >= 0 && cell[1] < GRID_HEIGHT) {
                    currentConfig.setState([cell[0], cell[1]] as unknown as Coordinate<2>, cell[2]);
                }
            }
        }
        return;
    }

    for (let x = 0; x < GRID_WIDTH; x++) {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            // Distribute seed uniformly over entire domain, 15% density
            const state = (rng() < 0.15) ? 1 : 0;
            currentConfig.setState([x, y] as unknown as Coordinate<2>, state);
        }
    }
}

export function initializeSimulation() {
    globalGeneration = 0; // Reset temporal state
    const configType = (document.getElementById('configType') as HTMLSelectElement).value;
    const domainType = (document.getElementById('domainType') as HTMLSelectElement).value;
    const topologyType = (document.getElementById('topologyType') as HTMLSelectElement).value;
    const colorStrategyType = (document.getElementById('colorStrategy') as HTMLSelectElement)?.value || 'cyclical';

    let seedInputEl = document.getElementById('seedInput') as HTMLInputElement;
    let seedStringFromInput = seedInputEl?.value?.trim() || '';

    let isStateLoad = false;
    loadedState = null;

    if (seedStringFromInput.startsWith('STATE:')) {
        try {
            const jsonStr = atob(seedStringFromInput.substring(6));
            loadedState = JSON.parse(jsonStr);
            isStateLoad = true;
        } catch (e) {
            console.error("Failed to parse board state from seed input", e);
        }
    }

    if (!isStateLoad && !seedStringFromInput) {
        seedStringFromInput = Math.random().toString(36).substring(2, 10);
        if (seedInputEl) seedInputEl.value = seedStringFromInput;
    }

    const seedString = seedStringFromInput || 'default-seed';
    const seedFunc = xmur3(seedString);
    rng = mulberry32(seedFunc());

    if (colorStrategyType === 'monochrome') {
        activeColorStrategy = new MonochromeColorStrategy();
    } else {
        activeColorStrategy = new CyclicalGenesisColorStrategy();
    }

    const neighborhoodType = (document.getElementById('neighborhoodType') as HTMLSelectElement).value as 'moore' | 'vonNeumann';
    const frequencyDomainRaw = (document.getElementById('frequencyDomain') as HTMLSelectElement)?.value || '0';

    const frequencyDomain = parseInt(frequencyDomainRaw) || 0;

    const rawSurvival = (document.getElementById('survivalRules') as HTMLInputElement).value;
    const rawBirth = (document.getElementById('birthRules') as HTMLInputElement).value;

    // Filter safely limits it precisely into mathematically valid parsed numbers up to C (12).
    const parseBaseRules = (str: string) => str.split('').filter(c => /[0-9a-c]/i.test(c)).map(c => parseInt(c, 36));

    const parseNetherRuleObjects = (rawPattern: string) => {
        const parts = rawPattern.split('.');
        const baseRule = parseBaseRules(parts[0] || "");
        const netherExt = parts.length > 1 ? parseBaseRules(parts[1] || "") : [0];

        return {
            aliveTarget: new Set(baseRule),
            netherTarget: new Set(netherExt)
        };
    };

    const useNetherstate = (document.getElementById('useNetherstate') as HTMLInputElement).checked;

    let survivalRules: any;
    let birthRules: any;
    let netherRules: any = null;

    if (useNetherstate) {
        survivalRules = parseNetherRuleObjects(rawSurvival);
        birthRules = parseNetherRuleObjects(rawBirth);
        const rawNether = (document.getElementById('netherRules') as HTMLInputElement).value;
        netherRules = parseNetherRuleObjects(rawNether);
    } else {
        survivalRules = parseBaseRules(rawSurvival);
        birthRules = parseBaseRules(rawBirth);
    }

    GRID_WIDTH = parseInt((document.getElementById('gridWidth') as HTMLInputElement).value) || 100;
    GRID_HEIGHT = parseInt((document.getElementById('gridHeight') as HTMLInputElement).value) || 100;

    // Dimension Constraints for seamless 3D wrapping
    if (domainType !== 'strict') { // If the surface wraps...
        if (topologyType === 'hexagonal' && GRID_HEIGHT % 2 !== 0) {
            GRID_HEIGHT += 1; // Hex odd-r row parity requires even total height to stitch vertical wrap 
            (document.getElementById('gridHeight') as HTMLInputElement).value = GRID_HEIGHT.toString();
        }
        if (topologyType === 'triangular' && GRID_WIDTH % 2 !== 0) {
            GRID_WIDTH += 1; // Triangle alternating up/down faces require even width to stitch horizontal wrap
            (document.getElementById('gridWidth') as HTMLInputElement).value = GRID_WIDTH.toString();
        }
    }

    // Recalculate physical rendering sizes based on chosen topology
    if (topologyType === 'triangular') {
        CELL_WIDTH = (CANVAS_SIZE * 2) / (GRID_WIDTH + 1);
        CELL_HEIGHT = CANVAS_SIZE / GRID_HEIGHT;
    } else if (topologyType === 'hexagonal') {
        CELL_WIDTH = CANVAS_SIZE / (GRID_WIDTH + 0.5);
        CELL_HEIGHT = CANVAS_SIZE / GRID_HEIGHT;
    }

    const configData = {
        seed: seedString,
        topology: topologyType,
        storage: configType,
        domain: domainType,
        frequencyDomain: frequencyDomain,
        birthRules: useNetherstate ? rawBirth : birthRules.join(''),
        survivalRules: useNetherstate ? rawSurvival : survivalRules.join(''),
        netherRules: useNetherstate ? (document.getElementById('netherRules') as HTMLInputElement).value : null,
        useNetherstate: useNetherstate,
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        colorStrategy: colorStrategyType,
        neighborhood: neighborhoodType
    };
    console.log(`Re-initializing Simulation with Config:\n`, JSON.stringify(configData, null, 2));

    simulationBounds = createSimulationBounds(GRID_WIDTH, GRID_HEIGHT);
    dimensions = [GRID_WIDTH, GRID_HEIGHT] as unknown as Coordinate<2>;

    // 0. Resolve Mathematical Totalistic Ruleset based on Topology
    if (topologyType === 'triangular') {
        ca = new TriangularGameOfLife(survivalRules, birthRules, netherRules, frequencyDomain, neighborhoodType, useNetherstate);
    } else if (topologyType === 'hexagonal') {
        ca = new HexagonalGameOfLife(survivalRules, birthRules, netherRules, frequencyDomain, neighborhoodType, useNetherstate);
    } else {
        ca = new GameOfLife(survivalRules, birthRules, netherRules, frequencyDomain, neighborhoodType, useNetherstate);
    }

    // 1. Resolve State Storage Model
    if (configType === 'sparse') {
        currentConfig = new SparseConfiguration<2, number>(ca.quiescentState);
        nextConfig = new SparseConfiguration<2, number>(ca.quiescentState);
    } else {
        currentConfig = new DenseConfiguration<2, number>(dimensions, ca.quiescentState);
        nextConfig = new DenseConfiguration<2, number>(dimensions, ca.quiescentState);
    }

    // 2. Resolve Topological Physics Boundary
    if (domainType === 'strict') {
        domain = new StrictDomain<2>(dimensions);
        updateGeometry('strict');
    } else if (domainType === 'cylindrical') {
        domain = new CylindricalDomain(dimensions);
        updateGeometry('cylindrical');
    } else if (domainType === 'mobius') {
        domain = new MobiusDomain(dimensions);
        updateGeometry('mobius');
    } else if (domainType === 'klein') {
        domain = new KleinBottleDomain(dimensions);
        updateGeometry('klein');
    } else {
        domain = new ToroidalDomain<2>(dimensions);
        updateGeometry('toroidal');
    }

    seedEcosystem();
}

export function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#000'; // Black stable aesthetics
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.fillStyle = '#0f0'; // Vibrant green life (default)

    const topologyType = (document.getElementById('topologyType') as HTMLSelectElement).value;
    const frequencyDomainRaw = (document.getElementById('frequencyDomain') as HTMLInputElement)?.value || '0';
    const frequencyDomain = parseInt(frequencyDomainRaw) || 0;

    const drawCell = (x: number, y: number, state: number) => {
        if (!ctx) return;

        const color = activeColorStrategy.getColor(state, frequencyDomain);
        if (!color) return; // Background void (0)

        ctx.fillStyle = color;

        if (topologyType === 'hexagonal') {
            const isOddRow = Math.abs(y) % 2 === 1;
            const xOffset = isOddRow ? CELL_WIDTH * 0.5 : 0;
            const px = x * CELL_WIDTH + xOffset;
            const py = y * CELL_HEIGHT;

            // Draw a hexagon
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 3 * i + Math.PI / 6;
                const hx = px + CELL_WIDTH / 2 + (CELL_WIDTH / 2) * Math.cos(angle) * 1.05; // 1.05 to lightly overlap edges
                const hy = py + CELL_HEIGHT / 2 + (CELL_HEIGHT / 2) * Math.sin(angle) * 1.05;
                if (i === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.fill();
        } else if (topologyType === 'triangular') {
            const isUpTriangle = Math.abs(x + y) % 2 === 0;
            const px = x * (CELL_WIDTH / 2);
            const py = y * CELL_HEIGHT;

            ctx.beginPath();
            if (isUpTriangle) {
                ctx.moveTo(px + CELL_WIDTH / 2, py);
                ctx.lineTo(px, py + CELL_HEIGHT);
                ctx.lineTo(px + CELL_WIDTH, py + CELL_HEIGHT);
            } else {
                ctx.moveTo(px, py);
                ctx.lineTo(px + CELL_WIDTH, py);
                ctx.lineTo(px + CELL_WIDTH / 2, py + CELL_HEIGHT);
            }
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(x * CELL_WIDTH, y * CELL_HEIGHT, Math.ceil(CELL_WIDTH), Math.ceil(CELL_HEIGHT));
        }
    };

    if (currentConfig instanceof SparseConfiguration) {
        // High-performance explicit-only render loop utilizing mathematical mapping
        for (const coord of currentConfig.getActiveCoordinates()) {
            // Visual check to not draw sparse elements permanently offscreen 
            // (e.g. if boundary is Strict and a glider shoots off into infinite vacuum)
            if (coord[0] >= 0 && coord[0] < GRID_WIDTH && coord[1] >= 0 && coord[1] < GRID_HEIGHT) {
                // FD map guarantees sparse returns {1,2,3} not 0
                drawCell(coord[0], coord[1], currentConfig.getState(coord));
            }
        }
    } else {
        // Standard full-sweep block dense bounding render
        for (const coord of simulationBounds) {
            const state = currentConfig.getState(coord);
            if (state !== 0) {
                drawCell(coord[0], coord[1], state);
            }
        }
    }

    if (texture) {
        texture.needsUpdate = true;
    }
}

export function update() {
    // Math: G: C -> C' 
    // Uses the selected topological domain constraint map and the selected storage array math.
    ca.evolve(currentConfig, simulationBounds, nextConfig, domain, globalGeneration);
    globalGeneration++;

    // Swap buffers (C' becomes C)
    const temp = currentConfig;
    currentConfig = nextConfig;
    nextConfig = temp;

    // Clear C' back to quiescence for the next evaluation pass
    if (nextConfig instanceof SparseConfiguration) {
        // Erasing the hash map entirely is O(1)
        nextConfig = new SparseConfiguration(ca.quiescentState);
    } else {
        for (const coord of simulationBounds) {
            nextConfig.setState(coord, ca.quiescentState);
        }
    }
}

if (typeof window !== 'undefined') {
    window.onload = () => {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = CANVAS_SIZE;
        offscreenCanvas.height = CANVAS_SIZE;
        ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

        // Init three.js
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050505);

        camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        camera.position.z = 2.5;

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(CANVAS_SIZE, CANVAS_SIZE);
        renderer.domElement.style.border = '2px solid #333';
        renderer.domElement.style.boxShadow = '0 0 20px #0f05';
        renderer.domElement.style.borderRadius = '4px';

        document.getElementById('canvas-container')?.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        texture = new THREE.CanvasTexture(offscreenCanvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide
        });

        mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        if (scene) scene.add(mesh);

        // Connect UI Buttons
        document.getElementById('resetBtn')?.addEventListener('click', () => {
            initializeSimulation();
        });
        document.getElementById('exportStateBtn')?.addEventListener('click', exportStateToSeed);

        document.getElementById('randomRuleBtn')?.addEventListener('click', () => {
            const topologyType = (document.getElementById('topologyType') as HTMLSelectElement).value;
            const neighborhoodType = (document.getElementById('neighborhoodType') as HTMLSelectElement).value;

            let maxNeighbors = 8;
            if (topologyType === 'hexagonal') {
                maxNeighbors = neighborhoodType === 'moore' ? 12 : 6;
            } else if (topologyType === 'triangular') {
                maxNeighbors = neighborhoodType === 'moore' ? 12 : 3;
            } else {
                maxNeighbors = neighborhoodType === 'moore' ? 8 : 4;
            }

            const generateRandomRule = () => {
                const rule = [];
                for (let i = 0; i <= maxNeighbors; i++) {
                    if (Math.random() > 0.5) rule.push(i.toString(36).toUpperCase());
                }
                return rule.join('');
            };

            (document.getElementById('survivalRules') as HTMLInputElement).value = generateRandomRule();
            (document.getElementById('birthRules') as HTMLInputElement).value = generateRandomRule();
            initializeSimulation();
        });

        document.getElementById('colorStrategy')?.addEventListener('change', initializeSimulation);
        document.getElementById('neighborhoodType')?.addEventListener('change', initializeSimulation);
        document.getElementById('frequencyDomain')?.addEventListener('change', initializeSimulation);
        document.getElementById('topologyType')?.addEventListener('change', initializeSimulation);
        document.getElementById('configType')?.addEventListener('change', initializeSimulation);
        document.getElementById('domainType')?.addEventListener('change', initializeSimulation);
        document.getElementById('survivalRules')?.addEventListener('change', initializeSimulation);
        document.getElementById('birthRules')?.addEventListener('change', initializeSimulation);
        document.getElementById('netherRules')?.addEventListener('change', initializeSimulation);
        document.getElementById('useNetherstate')?.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            const netherGroup = document.getElementById('netherRulesGroup');
            if (netherGroup) {
                netherGroup.style.display = isChecked ? 'flex' : 'none';
            }
            initializeSimulation();
        });
        document.getElementById('gridWidth')?.addEventListener('change', initializeSimulation);
        document.getElementById('gridHeight')?.addEventListener('change', initializeSimulation);

        // Global Keyboard Listeners
        window.addEventListener('keydown', (e) => {
            // Ignore if typing in an input field natively
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;

            switch (e.key.toLowerCase()) {
                case ' ':
                    isPaused = !isPaused;
                    e.preventDefault();
                    break;
                case 'r':
                    initializeSimulation();
                    break;
                case 't':
                    document.getElementById('randomRuleBtn')?.click();
                    break;
            }
        });

        // Immersive Menu Handlers
        let hasStarted = false;

        const startSimulation = () => {
            if (hasStarted) {
                initializeSimulation();
                return;
            }
            hasStarted = true;
            document.getElementById('intro-layer')?.classList.add('hidden');

            initializeSimulation();

            intervalId = window.setInterval(() => {
                draw();
                if (!isPaused) {
                    update();
                }
                if (controls) controls.update();
                if (renderer && scene && camera) {
                    renderer.render(scene, camera);
                }
            }, 1000 / FPS);
        };

        document.getElementById('startBtn')?.addEventListener('click', () => {
            const introSeed = (document.getElementById('introSeedInput') as HTMLInputElement).value;
            if (introSeed) {
                (document.getElementById('seedInput') as HTMLInputElement).value = introSeed;
            } else {
                (document.getElementById('seedInput') as HTMLInputElement).value = '';
            }
            startSimulation();
        });

        document.getElementById('presetRandomBtn')?.addEventListener('click', () => {
            (document.getElementById('introSeedInput') as HTMLInputElement).value = '';
            (document.getElementById('seedInput') as HTMLInputElement).value = '';
            startSimulation();
        });

        document.getElementById('presetOscillatorBtn')?.addEventListener('click', () => {
            (document.getElementById('topologyType') as HTMLSelectElement).value = 'hexagonal';
            (document.getElementById('neighborhoodType') as HTMLSelectElement).value = 'moore';
            (document.getElementById('survivalRules') as HTMLInputElement).value = '34';
            (document.getElementById('birthRules') as HTMLInputElement).value = '2';

            const oscillatorBase64 = "STATE:eyJnZW5lcmF0aW9uIjowLCJjZWxscyI6W1s0OSw0NCwxXSxbNDgsNDQsMV0sWzUwLDQ1LDFdLFs0OCw1MSwxXSxbNTAsNTAsMV0sWzUyLDQ3LDFdXX0=";
            (document.getElementById('introSeedInput') as HTMLInputElement).value = oscillatorBase64;
            (document.getElementById('seedInput') as HTMLInputElement).value = oscillatorBase64;
            startSimulation();
        });
    };
}
