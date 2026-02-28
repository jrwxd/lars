import { HexagonalGameOfLife, findHexGlider } from './cellular_automaton.js';
import { SparseConfiguration } from './cellular_automaton.js';
import * as fs from 'fs';

async function main() {
    console.log("Initializing Lars-Compatible Spaceship Searcher...");
    console.log("Target: Hexagonal Grid (Moore bounds, B2/S34)");

    const engine = new HexagonalGameOfLife([3, 4], [2], null, 0, 'moore');

    let attempts = 0;
    const globalEdges = new Map<string, string>();
    const knownCycles = new Set<string>();
    const skippedRef = { count: 0 };

    while (true) {
        attempts++;
        if (globalEdges.size > 10000000) {
            globalEdges.clear();
        }

        if (attempts % 100 === 0) {
            process.stdout.write(`\rSearching... Attempt ${attempts} | Edges cache: ${globalEdges.size} | Known Cycles: ${knownCycles.size} | Skipped: ${skippedRef.count}`);
        }

        if (globalEdges.size >= 1000) {
            console.log(`\n\n[!] Collected 1000 edges! Dumping to edges.json...`);

            const edgesObj: Record<string, string> = {};
            let count = 0;
            for (const [k, v] of globalEdges.entries()) {
                edgesObj[k] = v;
                count++;
                if (count >= 1000) break;
            }

            fs.writeFileSync('edges.json', JSON.stringify(edgesObj, null, 2));
            console.log("Successfully wrote edges.json. Exiting.");
            process.exit(0);
        }

        const glider = await findHexGlider(engine, 200, globalEdges, knownCycles, skippedRef);

        if (glider !== null) {
            console.log(`\n\n[!] GLIDER FOUND on Attempt ${attempts}!`);
            console.log(`Coordinates:`, JSON.stringify(glider));

            // Format for easy import into the Lars Seed Box mapping a standard Toroidal[64,64] Center.
            const exportObj = {
                generation: 0,
                cells: glider.map(pt => [pt[0], pt[1], 1])
            };
            const b64 = Buffer.from(JSON.stringify(exportObj)).toString('base64');
            console.log(`\nImport String: STATE:${b64}`);
            break;
        }
    }
}

main().catch(console.error);
