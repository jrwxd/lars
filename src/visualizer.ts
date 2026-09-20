import { GameOfLife, DenseConfiguration, SparseConfiguration, ToroidalDomain, LatticeDomain, Coordinate, GlobalConfiguration, CylindricalDomain, MobiusDomain, KleinBottleDomain, HexagonalGameOfLife, TriangularGameOfLife, OuterTotalisticCellularAutomaton } from './cellular_automaton.js';
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CANVAS_SIZE = 800; // Physical pixels
let GRID_WIDTH = 100;
let GRID_HEIGHT = 100;
let CELL_WIDTH = CANVAS_SIZE / GRID_WIDTH;
let CELL_HEIGHT = CANVAS_SIZE / GRID_HEIGHT;
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
let audioContext: AudioContext | null = null;
let torusPlaybackTimeout: number | null = null;
let torusPlaybackRings: Array<Array<{ x: number; y: number; state: number }>> = [];
let torusPlaybackIndex = -1;
let torusSecondaryPlaybackIndex = -1;
let torusRhythmTick = 0;
let torusPrimaryPulseCount = 0;
let latestLilypondTranscription = '';

const TORUS_ROOT_FREQUENCY = 261.625565; // C4: a fixed, deterministic root
const TORUS_STEP_MS = 180;
const MUSIC_SCALES: Record<string, number[]> = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9]
};
const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
const TORUS_PROGRESSIONS: Record<string, number[]> = {
    static: [0],
    bittersweet: [0, -3, 3, -2],
    modal: [0, 2, -1, 5, 3],
    descending: [0, -2, -4, -7]
};

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
    stopTorusMusic();
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
    } else {
        CELL_WIDTH = CANVAS_SIZE / GRID_WIDTH;
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
            const left = Math.floor(x * CELL_WIDTH);
            const top = Math.floor(y * CELL_HEIGHT);
            const right = Math.ceil((x + 1) * CELL_WIDTH);
            const bottom = Math.ceil((y + 1) * CELL_HEIGHT);
            ctx.fillRect(left, top, right - left, bottom - top);
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

    const playbackRing = torusPlaybackRings[torusPlaybackIndex];
    const secondaryPlaybackRing = torusPlaybackRings[torusSecondaryPlaybackIndex];
    if (ctx) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        for (const ring of [playbackRing, secondaryPlaybackRing]) {
            if (!ring) continue;
            for (const cell of ring) {
                ctx.strokeRect(
                    cell.x * CELL_WIDTH + 1,
                    cell.y * CELL_HEIGHT + 1,
                    Math.max(1, CELL_WIDTH - 2),
                    Math.max(1, CELL_HEIGHT - 2)
                );
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

function setTorusPlaybackStatus(message: string) {
    const status = document.getElementById('torusPlaybackStatus');
    if (status) status.textContent = message;
}

function updatePlayButton() {
    const button = document.getElementById('togglePlayBtn');
    if (button) {
        button.textContent = isPaused ? 'Play Evolution' : 'Pause Evolution';
        button.setAttribute('aria-label', isPaused ? 'Play cellular automaton evolution' : 'Pause cellular automaton evolution');
    }
}

function getMusicNumber(id: string, fallback: number, minimum: number, maximum: number): number {
    const value = Number((document.getElementById(id) as HTMLInputElement | null)?.value);
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function getTorusFrequency(cellPosition: number, ringIndex = 0): number {
    const scale = (document.getElementById('musicScale') as HTMLSelectElement | null)?.value || 'nTet';
    const tuning = (document.getElementById('musicTuning') as HTMLSelectElement | null)?.value || 'equal';
    const progression = (document.getElementById('musicProgression') as HTMLSelectElement | null)?.value || 'static';
    const root = getMusicNumber('musicRoot', TORUS_ROOT_FREQUENCY, 20, 2000);
    const rawSemitones = (cellPosition / GRID_WIDTH) * 12;
    let semitones = rawSemitones;

    if (scale !== 'nTet') {
        const intervals = MUSIC_SCALES[scale] || MUSIC_SCALES.chromatic;
        const octave = Math.floor(rawSemitones / 12);
        const semitoneInOctave = rawSemitones - octave * 12;
        const nearestInterval = intervals.reduce((nearest, interval) =>
            Math.abs(interval - semitoneInOctave) < Math.abs(nearest - semitoneInOctave) ? interval : nearest
        );
        semitones = octave * 12 + nearestInterval;
    }

    if (tuning === 'just' && scale !== 'nTet') {
        const octave = Math.floor(semitones / 12);
        const pitchClass = Math.round(semitones - octave * 12);
        const ratio = JUST_RATIOS[Math.min(11, Math.max(0, pitchClass))] || 2;
        return root * Math.pow(2, octave) * ratio;
    }

    const progressionOffsets = TORUS_PROGRESSIONS[progression] || TORUS_PROGRESSIONS.static;
    const progressionOffset = progressionOffsets[Math.floor(ringIndex / 4) % progressionOffsets.length];
    return root * Math.pow(2, (semitones + progressionOffset) / 12);
}

function getTorusStepMs(): number {
    const tempo = getMusicNumber('musicTempo', 120, 40, 300);
    return 30000 / tempo;
}

function getPolyrhythm(): [number, number] {
    const value = (document.getElementById('musicRhythm') as HTMLSelectElement | null)?.value || '1:1';
    const [primary, secondary] = value.split(':').map(Number);
    return [
        Number.isFinite(primary) && primary > 0 ? primary : 1,
        Number.isFinite(secondary) && secondary > 0 ? secondary : 1
    ];
}

function greatestCommonDivisor(a: number, b: number): number {
    while (b !== 0) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }
    return a;
}

function leastCommonMultiple(a: number, b: number): number {
    return Math.abs(a * b) / greatestCommonDivisor(a, b);
}

function getStateVoice(state: number, cellPosition: number) {
    const mode = (document.getElementById('musicStateMode') as HTMLSelectElement | null)?.value || 'harmonic';
    const stateInfluence = getMusicNumber('musicStateInfluence', 1, 0, 4);
    const statePitchStep = getMusicNumber('musicStatePitchStep', 1, 0, 24);
    const stateLevel = Math.min(12, Math.max(0, state - 1));
    const voice = {
        frequency: getTorusFrequency(cellPosition),
        level: 1,
        decayMultiplier: 1,
        waveform: ((document.getElementById('musicWaveform') as HTMLSelectElement | null)?.value || 'sine') as OscillatorType
    };

    if (mode === 'harmonic') {
        if (state === 2) {
            voice.frequency *= 1 + 0.5 * stateInfluence;
            voice.waveform = 'triangle';
            voice.level = 0.9 - 0.15 * stateInfluence;
        } else if (state > 2) {
            const partial = 1 + stateLevel * stateInfluence;
            voice.frequency *= partial;
            voice.level = 1 / Math.sqrt(partial);
        }
    } else if (mode === 'energy') {
        voice.frequency *= Math.pow(2, Math.min(3, stateLevel * stateInfluence / 3));
        voice.level = 0.55 + stateLevel * 0.06 * stateInfluence;
        voice.decayMultiplier = 1 + stateLevel * 0.08 * stateInfluence;
    } else if (mode === 'melodic') {
        voice.frequency *= Math.pow(2, stateLevel * statePitchStep * stateInfluence / 12);
        voice.level = 0.8 + stateLevel * 0.04 * stateInfluence;
    } else if (mode === 'texture') {
        const textures: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
        voice.waveform = textures[Math.floor(stateLevel * stateInfluence) % textures.length];
        voice.frequency *= 1 + (Math.floor(stateLevel * stateInfluence) % 5) * 0.01;
        voice.level = 0.8;
        voice.decayMultiplier = 1;
    } else if (mode === 'spectral') {
        const partial = Math.max(1, 1 + stateLevel * stateInfluence);
        voice.frequency *= partial;
        voice.waveform = state % 2 === 0 ? 'triangle' : 'sine';
        voice.level = 1 / Math.sqrt(partial);
        voice.decayMultiplier = 0.8 + Math.min(2, partial / 4);
    } else {
        const density = Math.min(1, stateLevel * stateInfluence / 8);
        voice.frequency *= Math.pow(2, stateLevel * statePitchStep * stateInfluence / 24);
        voice.waveform = state % 2 === 0 ? 'square' : 'sawtooth';
        voice.level = 0.65 + density * 0.35;
        voice.decayMultiplier = Math.max(0.15, 1 - density * 0.8);
    }

    return voice;
}

function selectRingVoices(ring: Array<{ x: number; y: number; state: number }>) {
    const activeCells = ring.filter(cell => cell.state > 0);
    const mode = (document.getElementById('musicPolyphony') as HTMLSelectElement | null)?.value || 'full';
    const maxVoices = Math.floor(getMusicNumber('musicMaxVoices', 8, 1, 32));

    if (mode === 'full' || activeCells.length <= maxVoices) {
        return activeCells.map(cell => ({ cell, octaveOffset: 0 }));
    }

    if (mode === 'state') {
        return [...activeCells]
            .sort((left, right) => right.state - left.state || left.y - right.y)
            .slice(0, maxVoices)
            .map(cell => ({ cell, octaveOffset: 0 }));
    }

    const ordered = [...activeCells].sort((left, right) => left.y - right.y);
    const selected = mode === 'four'
        ? Array.from({ length: maxVoices }, (_, index) =>
            ordered[Math.floor(index * ordered.length / maxVoices)]
        ).filter((cell, index, cells) => cell && cells.indexOf(cell) === index)
        : ordered.slice(0, maxVoices);

    return selected.map((cell, index) => ({
        cell,
        octaveOffset: mode === 'drop2' && index === 1 ? -1 : 0
    }));
}

interface LilypondPitch {
    notation: string;
    centsDeviation: number;
}

function frequencyToLilypondPitch(frequency: number): LilypondPitch {
    const exactMidi = 69 + 12 * Math.log2(frequency / 440);
    const quarterToneMidi = Math.min(108, Math.max(24, Math.round(exactMidi * 2) / 2));
    const pitchClasses = ['c', 'cis', 'd', 'dis', 'e', 'f', 'fis', 'g', 'gis', 'a', 'ais', 'b'];
    const midi = Math.floor(quarterToneMidi);
    const octave = Math.floor(midi / 12) - 1;
    const octaveMarks = octave - 3;
    const marks = octaveMarks >= 0
        ? "'".repeat(octaveMarks)
        : ",".repeat(-octaveMarks);
    const quarterToneSuffix = quarterToneMidi % 1 === 0 ? '' : 'ih';
    return {
        notation: `${pitchClasses[midi % 12]}${quarterToneSuffix}${marks}`,
        centsDeviation: Math.round((exactMidi - quarterToneMidi) * 100)
    };
}

function formatCentsDeviation(centsDeviation: number): string {
    return `${centsDeviation >= 0 ? '+' : ''}${centsDeviation}c`;
}

function getEngravingStyle(): 'clean' | 'cage' {
    return ((document.getElementById('musicEngravingStyle') as HTMLSelectElement | null)?.value || 'cage') as 'clean' | 'cage';
}

function generateLilypondRingToken(
    ring: Array<{ x: number; y: number; state: number }>
): string {
    const engravingStyle = getEngravingStyle();
    const voices = selectRingVoices(ring);
    if (voices.length === 0) return 'r8';

    const pitchDetails = voices
        .map(({ cell, octaveOffset }) => {
            const voice = getStateVoice(cell.state, cell.y);
            return frequencyToLilypondPitch(voice.frequency * Math.pow(2, octaveOffset));
        })
        .filter((pitch, index, allPitches) =>
            allPitches.findIndex(candidate => candidate.notation === pitch.notation) === index
        )
        .sort((left, right) => left.notation.localeCompare(right.notation));

    const pitches = pitchDetails.map(pitch => pitch.notation);
    const cents = pitchDetails
        .map(pitch => pitch.centsDeviation)
        .filter(centsDeviation => Math.abs(centsDeviation) >= 10)
        .map(formatCentsDeviation);
    const microtonalMarkup = cents.length > 0
        ? `^\\markup { \\tiny "${cents.join(' ')}" }`
        : '';

    if (engravingStyle === 'clean') {
        return pitches.length === 1
            ? `${pitches[0]}8${microtonalMarkup}`
            : `<${pitches.join(' ')}>8${microtonalMarkup}`;
    }

    const activeStates = ring.filter(cell => cell.state > 0).map(cell => cell.state);
    const weight = activeStates.reduce((total, state) => total + state, 0);
    const maximumState = Math.max(...activeStates, 1);
    const noteheadStyles = ['default', 'cross', 'diamond', 'triangle', 'xcircle'];
    const noteheadStyle = noteheadStyles[Math.min(noteheadStyles.length - 1, maximumState % noteheadStyles.length)];
    const fontSize = Math.min(5, Math.max(-2, Math.round(weight / Math.max(1, activeStates.length)) - 1));
    const stemLength = 2 + Math.min(8, weight);
    const dynamics = ['pppp', 'ppp', 'pp', 'mp', 'mf', 'f', 'ff', 'fff'];
    const dynamic = dynamics[Math.min(dynamics.length - 1, weight)];
    const weightMarkup = `^\\markup { \\tiny \\box "W${weight}" }`;
    const stylePrefix = [
        `\\once \\override NoteHead.style = #'${noteheadStyle}`,
        `\\once \\override NoteHead.font-size = #${fontSize}`,
        `\\once \\override Stem.length = #${stemLength}`
    ].join(' ');
    const note = pitches.length === 1
        ? `${pitches[0]}8${microtonalMarkup}${weightMarkup}\\${dynamic}`
        : `<${pitches.join(' ')}>8${microtonalMarkup}${weightMarkup}\\${dynamic}`;
    return `${stylePrefix} ${note}`;
}

function generateLilypondVoice(
    rings: Array<Array<{ x: number; y: number; state: number }>>,
    pulses: number,
    cycleLength: number,
    initialRest = false
): string {
    const engravingStyle = getEngravingStyle();
    const tokens = rings.map(generateLilypondRingToken);
    const scale = `${pulses}/${cycleLength}`;
    const groups: string[] = [];
    if (initialRest) {
        groups.push(`\\scaleDurations ${scale} { r8 }`);
    }
    for (let index = 0; index < tokens.length; index += 8) {
        const ringGroup = rings.slice(index, index + 8);
        const groupWeight = ringGroup.reduce(
            (total, ring) => total + ring.reduce((ringTotal, cell) => ringTotal + Math.max(0, cell.state), 0),
            0
        );
        const groupMaximum = ringGroup.reduce(
            (maximum, ring) => Math.max(maximum, ...ring.map(cell => cell.state)),
            0
        );
        const directive = [
            'WEIGHT IS A LIE',
            'DO NOT RESOLVE',
            'LISTEN SIDEWAYS',
            'THE REST IS LOUD',
            'COUNT WRONG',
            'PREPARE THE ABSENCE',
            'THIS IS NOT A THEME',
            'DENSITY DENIES'
        ][(index / 8 + groupWeight + groupMaximum) % 8];
        const marginalia = engravingStyle === 'cage'
            ? `\\mark \\markup { \\box \\column { \\tiny "${directive}" \\tiny "W${groupWeight} / MAX${groupMaximum}" } } `
            : '';
        groups.push(`${marginalia}\\scaleDurations ${scale} { ${tokens.slice(index, index + 8).join(' ')} }`);
    }
    return groups.join('\n      \\bar "||"\n      ');
}

    function generateLilypondTranscription(rings: Array<Array<{ x: number; y: number; state: number }>>): string {
        const tempo = Math.round(getMusicNumber('musicTempo', 120, 40, 300));
        const scale = (document.getElementById('musicScale') as HTMLSelectElement | null)?.value || 'nTet';
        const tuning = (document.getElementById('musicTuning') as HTMLSelectElement | null)?.value || 'equal';
        const rhythm = (document.getElementById('musicRhythm') as HTMLSelectElement | null)?.value || '1:1';
        const engravingStyle = getEngravingStyle();
        const [primaryPulses, secondaryPulses] = getPolyrhythm();
        const cycleLength = leastCommonMultiple(primaryPulses, secondaryPulses);
        const primaryVoice = generateLilypondVoice(rings, primaryPulses, cycleLength);
        const secondaryVoice = generateLilypondVoice(
            rings,
            secondaryPulses,
            cycleLength,
            primaryPulses !== secondaryPulses
        );

        return `% Generated by LARS from the selected toroidal ring
    % Scale: ${scale}; tuning: ${tuning}; playback polyrhythm: ${rhythm}; engraving: ${engravingStyle}
    % Each ring is a note or chord. Empty rings are rests.
    % Scale-duration blocks encode the exact pulse durations for the selected polyrhythm.
    % The secondary staff includes the same initial phase offset as Web Audio playback.
    % Quarter-tone suffixes encode the nearest 50-cent pitch; labels show deviations
    % of at least 10 cents from that written pitch.
    \\version "2.24.0"
    \\language "nederlands"

\\header {
      title = "${engravingStyle === 'cage' ? 'LARS: Weight Studies for Prepared Toroid' : 'LARS Toroidal Ring'}"
      subtitle = "${engravingStyle === 'cage' ? 'post-ironic Cage score' : `${rhythm} polyrhythm · ${scale} · ${tuning}`}"
      composer = "${engravingStyle === 'cage' ? 'The Cellular Automaton' : 'LARS'}"
      tagline = ##f
}

\\score {
  <<
    \\new Staff \\with { instrumentName = "Primary ${primaryPulses}" } {
      \\clef treble
      \\tempo 4 = ${tempo}
      \\cadenzaOn
      ${primaryVoice}
      \\bar "|."
    }
${primaryPulses === secondaryPulses ? '' : `    \\new Staff \\with { instrumentName = "Secondary ${secondaryPulses}" } {
      \\clef treble
      \\cadenzaOn
      ${secondaryVoice}
      \\bar "|."
    }
`}
  >>
  \\layout {
    \\context {
      \\Score
      \\override BarNumber.break-visibility = ##(#f #f #f)
    }
  }
  \\midi { }
}

\\paper {
  indent = 0\\mm
  ragged-last = ##t
}
`;
}

function showLilypondTranscription(transcription: string) {
    latestLilypondTranscription = transcription;
    const output = document.getElementById('lilypondOutput') as HTMLTextAreaElement | null;
    const panel = document.getElementById('transcription-panel');
    if (output) output.value = transcription;
    panel?.classList.remove('hidden');
}

function downloadLilypondTranscription() {
    if (!latestLilypondTranscription) return;
    const blob = new Blob([latestLilypondTranscription], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `lars-ring-${new Date().toISOString().replace(/[:.]/g, '-')}.ly`);
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function base64ToBlob(base64: string, type: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type });
}

async function renderLilypondArtifacts() {
    if (!latestLilypondTranscription) return;

    const button = document.getElementById('renderLilypondBtn') as HTMLButtonElement | null;
    if (button) {
        button.disabled = true;
        button.textContent = 'Rendering...';
    }
    setTorusPlaybackStatus('Rendering LilyPond PDF and MIDI...');

    try {
        const response = await fetch('/api/render-lilypond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: latestLilypondTranscription })
        });
        const result = await response.json() as {
            pdfBase64?: string;
            midiBase64?: string;
            error?: string;
            details?: string;
        };
        if (!response.ok || !result.pdfBase64 || !result.midiBase64) {
            throw new Error(result.details || result.error || `HTTP ${response.status}`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        downloadBlob(base64ToBlob(result.pdfBase64, 'application/pdf'), `lars-ring-${timestamp}.pdf`);
        downloadBlob(base64ToBlob(result.midiBase64, 'audio/midi'), `lars-ring-${timestamp}.midi`);
        setTorusPlaybackStatus('LilyPond PDF and MIDI generated.');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown rendering error';
        setTorusPlaybackStatus(`LilyPond render failed: ${message}`);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Render PDF + MIDI';
        }
    }
}

function stopTorusMusic() {
    if (torusPlaybackTimeout !== null) {
        window.clearTimeout(torusPlaybackTimeout);
        torusPlaybackTimeout = null;
    }

    torusPlaybackIndex = -1;
    torusSecondaryPlaybackIndex = -1;
    torusRhythmTick = 0;
    torusPrimaryPulseCount = 0;
    torusPlaybackRings = [];
    if (audioContext) {
        void audioContext.close();
        audioContext = null;
    }
    setTorusPlaybackStatus('');
    draw();
}

function playTorusCell(
    state: number,
    cellPosition: number,
    ringIndex: number,
    activeCellsInRing: number,
    octaveOffset: number
) {
    if (!audioContext || state <= 0) return;

    const voice = getStateVoice(state, cellPosition);
    const baseFrequency = getTorusFrequency(cellPosition);
    const progressedFrequency = getTorusFrequency(cellPosition, ringIndex);
    voice.frequency *= progressedFrequency / baseFrequency;
    voice.frequency *= Math.pow(2, octaveOffset);
    const attack = getMusicNumber('musicAttack', 10, 1, 500) / 1000;
    const stateSustain = 1 + Math.min(12, Math.max(0, state - 1)) * 0.12;
    const decay = getMusicNumber('musicDecay', 140, 10, 1000) / 1000 * voice.decayMultiplier * stateSustain;
    const resonance = getMusicNumber('musicResonance', 0.7, 0.1, 30);
    const volume = getMusicNumber('musicVolume', 0.7, 0, 1);
    const gate = getMusicNumber('musicGate', 80, 10, 100) / 100;
    const spread = getMusicNumber('musicSpread', 0.35, 0, 1);
    const filterFrequency = Math.min(
        getMusicNumber('musicFilter', 4000, 100, 20000),
        audioContext.sampleRate / 2 - 100
    );
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const panner = audioContext.createStereoPanner();
    const now = audioContext.currentTime;
    const stepMs = getTorusStepMs();
    const releaseTime = Math.max(attack + decay, stepMs / 1000 * gate);
    const ringPosition = GRID_WIDTH > 1 ? ringIndex / (GRID_WIDTH - 1) : 0.5;

    oscillator.type = voice.waveform;
    oscillator.frequency.setValueAtTime(voice.frequency, now);
    filter.type = ((document.getElementById('musicFilterType') as HTMLSelectElement | null)?.value || 'lowpass') as BiquadFilterType;
    filter.frequency.setValueAtTime(filterFrequency, now);
    filter.Q.setValueAtTime(resonance, now);
    panner.pan.setValueAtTime((ringPosition * 2 - 1) * spread, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, 0.08 * volume * voice.level / Math.sqrt(Math.max(1, activeCellsInRing))),
        now + attack
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
    oscillator.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + releaseTime + 0.02);
}

function playNextTorusRing() {
    if (!audioContext) {
        return;
    }

    const [primaryPulses, secondaryPulses] = getPolyrhythm();
    const cycleLength = leastCommonMultiple(primaryPulses, secondaryPulses);
    const primaryInterval = cycleLength / primaryPulses;
    const secondaryInterval = cycleLength / secondaryPulses;

    if (torusRhythmTick % primaryInterval === 0 && torusPrimaryPulseCount < torusPlaybackRings.length) {
        torusPlaybackIndex = torusPrimaryPulseCount;
        const primaryRing = torusPlaybackRings[torusPlaybackIndex];
        const voices = selectRingVoices(primaryRing);
        for (const voice of voices) {
            playTorusCell(
                voice.cell.state,
                voice.cell.y,
                torusPlaybackIndex,
                voices.length,
                voice.octaveOffset
            );
        }
        torusPrimaryPulseCount++;
    }

    const isDistinctSecondaryPulse = primaryPulses !== secondaryPulses ||
        torusRhythmTick % primaryInterval !== 0;
    if (isDistinctSecondaryPulse &&
        torusRhythmTick % secondaryInterval === 0 &&
        torusSecondaryPlaybackIndex < torusPlaybackRings.length - 1) {
        torusSecondaryPlaybackIndex++;
        const secondaryRing = torusPlaybackRings[torusSecondaryPlaybackIndex];
        const voices = selectRingVoices(secondaryRing);
        for (const voice of voices) {
            playTorusCell(
                voice.cell.state,
                voice.cell.y,
                torusSecondaryPlaybackIndex,
                voices.length,
                voice.octaveOffset
            );
        }
    }

    const primaryComplete = torusPrimaryPulseCount >= torusPlaybackRings.length;
    const secondaryComplete = primaryPulses === secondaryPulses ||
        torusSecondaryPlaybackIndex >= torusPlaybackRings.length - 1;
    setTorusPlaybackStatus(
        `Polyrhythm ${primaryPulses}:${secondaryPulses} | ` +
        `primary ${Math.min(torusPrimaryPulseCount, torusPlaybackRings.length)}/${torusPlaybackRings.length} | ` +
        `secondary ${Math.min(torusSecondaryPlaybackIndex + 1, torusPlaybackRings.length)}/${torusPlaybackRings.length}`
    );
    draw();

    torusRhythmTick++;
    if (primaryComplete && secondaryComplete) {
        torusPlaybackIndex = -1;
        torusSecondaryPlaybackIndex = -1;
        torusRhythmTick = 0;
        torusPrimaryPulseCount = 0;
        torusPlaybackTimeout = null;
        setTorusPlaybackStatus('');
        draw();
        return;
    }

    torusPlaybackTimeout = window.setTimeout(
        playNextTorusRing,
        getTorusStepMs() * primaryPulses / cycleLength
    );
}

function startTorusMusic() {
    if ((document.getElementById('domainType') as HTMLSelectElement).value !== 'toroidal') {
        setTorusPlaybackStatus('Select Toroidal domain first.');
        return;
    }

    stopTorusMusic();
    audioContext = new AudioContext();
    torusPlaybackRings = Array.from({ length: GRID_WIDTH }, (_, x) =>
        Array.from({ length: GRID_HEIGHT }, (_, y) => ({
            x,
            y,
            state: currentConfig.getState([x, y] as unknown as Coordinate<2>)
        }))
    );
    showLilypondTranscription(generateLilypondTranscription(torusPlaybackRings));
    setTorusPlaybackStatus(`Root: C4 | ${GRID_WIDTH}-TET`);
    playNextTorusRing();
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
        document.getElementById('togglePlayBtn')?.addEventListener('click', () => {
            isPaused = !isPaused;
            updatePlayButton();
        });
        document.getElementById('rerollAnnihilationBtn')?.addEventListener('click', () => {
            const seed = `annihilation-of-joy-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            (document.getElementById('seedInput') as HTMLInputElement).value = seed;
            (document.getElementById('introSeedInput') as HTMLInputElement).value = seed;
            initializeSimulation();
            startTorusMusic();
        });
        document.getElementById('toggleMusicBtn')?.addEventListener('click', () => {
            document.getElementById('music-controls')?.classList.toggle('hidden');
        });
        document.getElementById('resetBtn')?.addEventListener('click', () => {
            stopTorusMusic();
            isPaused = false;
            updatePlayButton();
            initializeSimulation();
        });
        document.getElementById('exportStateBtn')?.addEventListener('click', exportStateToSeed);
        document.getElementById('playTorusBtn')?.addEventListener('click', startTorusMusic);
        document.getElementById('downloadLilypondBtn')?.addEventListener('click', downloadLilypondTranscription);
        document.getElementById('renderLilypondBtn')?.addEventListener('click', renderLilypondArtifacts);

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
                    updatePlayButton();
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

            isPaused = false;
            updatePlayButton();
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

        document.getElementById('presetAnnihilationBtn')?.addEventListener('click', () => {
            const setValue = (id: string, value: string) => {
                const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
                if (element) element.value = value;
            };

            setValue('seedInput', 'annihilation-of-joy');
            setValue('configType', 'dense');
            setValue('topologyType', 'square');
            setValue('neighborhoodType', 'moore');
            setValue('domainType', 'toroidal');
            setValue('gridWidth', '24');
            setValue('gridHeight', '12');
            setValue('survivalRules', '23');
            setValue('birthRules', '3');
            setValue('netherRules', '2');
            setValue('frequencyDomain', '0');
            setValue('colorStrategy', 'monochrome');
            (document.getElementById('useNetherstate') as HTMLInputElement).checked = true;

            setValue('musicScale', 'minor');
            setValue('musicTuning', 'just');
            setValue('musicRoot', '110');
            setValue('musicAttack', '40');
            setValue('musicResonance', '4');
            setValue('musicDecay', '600');
            setValue('musicFilter', '900');
            setValue('musicFilterType', 'bandpass');
            setValue('musicWaveform', 'sawtooth');
            setValue('musicTempo', '54');
            setValue('musicRhythm', '5:4');
            setValue('musicVolume', '0.65');
            setValue('musicGate', '95');
            setValue('musicSpread', '0.8');
            setValue('musicPolyphony', 'full');
            setValue('musicMaxVoices', '12');
            setValue('musicStateMode', 'harmonic');

            const netherGroup = document.getElementById('netherRulesGroup');
            if (netherGroup) netherGroup.style.display = 'flex';
            (document.getElementById('introSeedInput') as HTMLInputElement).value = 'annihilation-of-joy';
            startSimulation();
            startTorusMusic();
        });

        document.getElementById('presetScenicBtn')?.addEventListener('click', () => {
            const setValue = (id: string, value: string) => {
                const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
                if (element) element.value = value;
            };

            setValue('seedInput', 'scenic-world-study');
            setValue('configType', 'dense');
            setValue('topologyType', 'square');
            setValue('neighborhoodType', 'moore');
            setValue('domainType', 'toroidal');
            setValue('gridWidth', '24');
            setValue('gridHeight', '12');
            setValue('survivalRules', '23');
            setValue('birthRules', '3');
            setValue('frequencyDomain', '0');
            setValue('colorStrategy', 'cyclical');
            (document.getElementById('useNetherstate') as HTMLInputElement).checked = false;

            setValue('musicScale', 'minor');
            setValue('musicProgression', 'bittersweet');
            setValue('musicTuning', 'equal');
            setValue('musicRoot', '146.83');
            setValue('musicAttack', '55');
            setValue('musicResonance', '1.2');
            setValue('musicDecay', '420');
            setValue('musicFilter', '2400');
            setValue('musicFilterType', 'lowpass');
            setValue('musicWaveform', 'triangle');
            setValue('musicTempo', '84');
            setValue('musicRhythm', '3:2');
            setValue('musicVolume', '0.58');
            setValue('musicGate', '88');
            setValue('musicSpread', '0.55');
            setValue('musicPolyphony', 'four');
            setValue('musicMaxVoices', '6');
            setValue('musicStateMode', 'harmonic');

            const netherGroup = document.getElementById('netherRulesGroup');
            if (netherGroup) netherGroup.style.display = 'none';
            (document.getElementById('introSeedInput') as HTMLInputElement).value = 'scenic-world-study';
            startSimulation();
            startTorusMusic();
        });
    };
}
