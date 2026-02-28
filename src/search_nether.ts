import { GameOfLife, SparseConfiguration, ToroidalDomain, Coordinate } from './cellular_automaton.js';

function getTranslationInvariantHash(cells: Coordinate<2>[], width: number, height: number): string {
    if (cells.length === 0) return "empty";
    let minX = Infinity, minY = Infinity;
    for (const [x, y] of cells) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
    }
    const normalized = cells.map(([x, y]) => [x - minX, y - minY]).sort((a, b) => {
        if (a[0] !== b[0]) return a[0] - b[0];
        return a[1] - b[1];
    });
    return normalized.map(p => p.join(',')).join('|');
}

async function main() {
    const survival = { aliveTarget: new Set([2]), netherTarget: new Set([0]) };
    const birth = { aliveTarget: new Set([2]), netherTarget: new Set([0]) };
    const nether = { aliveTarget: new Set([2]), netherTarget: new Set([0]) };

    // Testing B2.0/S2.0/N2.0
    // Try to find a pattern that reaches period > 1 and includes State 2
    console.log("Searching for working Nether configurations...");

    const domain = new ToroidalDomain<2>([100, 100] as unknown as Coordinate<2>);

    for (let attempts = 0; attempts < 10000; attempts++) {
        // Fix S23.0 and B3.0. Vary N between 1, 2, 3
        let nTarget = 1 + (attempts % 3);
        const anyNether = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);

        const engine = new GameOfLife(
            { aliveTarget: new Set([2, 3]), netherTarget: anyNether },
            { aliveTarget: new Set([3]), netherTarget: anyNether },
            { aliveTarget: new Set([nTarget]), netherTarget: anyNether },
            0,
            'moore',
            true
        );

        let currentConfig = new SparseConfiguration<2, number>(0);

        for (let dx = 0; dx < 5; dx++) {
            for (let dy = 0; dy < 5; dy++) {
                if (Math.random() < 0.3) {
                    currentConfig.setState([50 + dx, 50 + dy] as unknown as Coordinate<2>, 1);
                }
            }
        }

        const pathTracker = new Map<string, number>();
        let died = false;

        let hasNether = false;
        const initialConfigCache = currentConfig;

        for (let g = 0; g < 150; g++) {
            let nextConfig = new SparseConfiguration<2, number>(0);
            engine.evolve(currentConfig, currentConfig.getActiveCoordinates(), nextConfig, domain, g);
            currentConfig = nextConfig;

            const activeCoords = Array.from(currentConfig.getActiveCoordinates());
            if (activeCoords.length === 0) {
                died = true;
                break;
            }
            if (activeCoords.length > 500) {
                died = true; // Exploded
                break;
            }

            let currentHasNether = false;
            for (const c of activeCoords) {
                if (currentConfig.getState(c) === 2) {
                    hasNether = true;
                    currentHasNether = true;
                    break;
                }
            }

            // Simple hash (ignoring state types for a moment, just finding repeating bounds)
            const hash = getTranslationInvariantHash(activeCoords, 100, 100) + ":" + currentHasNether;

            if (pathTracker.has(hash)) {
                const period = g - pathTracker.get(hash)!;
                if (period > 1 && hasNether && g > 10) {
                    console.log(`\n\n[!] FOUND NETHER OSCILLATOR/GLIDER! Period ${period}`);
                    console.log(`Rule S23.0 / B3.0 / N${nTarget}.0`);

                    // Found a cool sequence. Output the initial B64 seed.
                    const exportObj = {
                        generation: 0,
                        cells: Array.from(initialConfigCache.getActiveCoordinates()).map(c => [c[0], c[1], initialConfigCache.getState(c)])
                    };
                    const b64 = Buffer.from(JSON.stringify(exportObj)).toString('base64');
                    console.log(`Seed: STATE:${b64}`);
                    process.exit(0);
                }
            }
            pathTracker.set(hash, g);
        }
    }

    console.log("No cool Nether examples found after attempts.");
}

main().catch(console.error);
