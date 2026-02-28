# LARS Visualizer

A modular and configurable web-based Cellular Automaton visualization platform, originally starting with Conway's Game of Life. 

## Features
- **Topologies**: Square, Hexagonal, and Triangular grids.
- **Domains**: Strict boundaries, Toroidal wraps, Cylindrical twists, and Klein Bottles.
- **Storage**: Dense (Array Buffer) or Sparse (Hash Map) configuration engines based on density.
- **Color Generation**: Customizable time-history spectral rendering.

## Project Structure
```text
lars/
├── public/                 # Static web files served to the browser
│   ├── index.html          # Main application entry point
│   └── dist/               # Compiled TypeScript files (generated automatically)
├── src/                    # Primary TypeScript source code
│   ├── visualizer.ts       # Three.js rendering and DOM logic
│   └── cellular_automaton.ts # Core mathematical topology simulation engine
└── scripts/                # Auxiliary backend scripts and data
    ├── server.js           # Local development server (HTTP 8081)
    └── visualize_graph.py  # Standalone data visualizer
```

## Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Build & Run
To run the project locally with live-recompilation of TypeScript files:
```bash
npm run dev
```

The visualizer will be available at [http://localhost:8081](http://localhost:8081). 

If you just want to run the server without recompiling:
```bash
npm run start
```

### 3. Build Production
If you need to compile the output to `public/dist` manually:
```bash
npm run build
```

## GitHub Pages Deployment
This repository is pre-configured with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds and deploys the visualizer to GitHub Pages whenever you push to the `main` or `master` branch.

**To enable this:**
1. Go to your repository **Settings** on GitHub.
2. Select **Pages** from the left-hand sidebar.
3. Under **Build and deployment > Source**, select **GitHub Actions**.
4. The next time you push to `main` (or trigger it manually from the Actions tab), GitHub will build the site and provide a live URL!

