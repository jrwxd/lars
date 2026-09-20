const http = require('http');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// We're using 8081 because 8080 was already occupied
const PORT = 8081;

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
};

// Start from the directory the script runs in (scripts/) and go back out a level to look inside public/
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function readRequestBody(req, maximumBytes) {
    return new Promise((resolve, reject) => {
        let body = '';
        let byteLength = 0;

        req.setEncoding('utf8');
        req.on('data', chunk => {
            byteLength += Buffer.byteLength(chunk);
            if (byteLength > maximumBytes) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }
            body += chunk;
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function renderLilypond(req, res) {
    const maximumSourceBytes = 2 * 1024 * 1024;
    let temporaryDirectory;

    try {
        const body = JSON.parse(await readRequestBody(req, maximumSourceBytes));
        if (typeof body.source !== 'string' || body.source.trim() === '') {
            sendJson(res, 400, { error: 'A non-empty LilyPond source string is required.' });
            return;
        }

        temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lars-lilypond-'));
        const sourcePath = path.join(temporaryDirectory, 'ring.ly');
        const outputBase = path.join(temporaryDirectory, 'ring');
        await fs.promises.writeFile(sourcePath, body.source, 'utf8');

        const lilypond = childProcess.spawn(
            'lilypond',
            ['--pdf', '--output', outputBase, sourcePath],
            { cwd: temporaryDirectory }
        );
        let stderr = '';
        lilypond.stderr.setEncoding('utf8');
        lilypond.stderr.on('data', chunk => {
            stderr += chunk;
        });

        const exitCode = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                lilypond.kill();
                reject(new Error('LilyPond timed out after 30 seconds.'));
            }, 30000);
            lilypond.on('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
            lilypond.on('close', code => {
                clearTimeout(timeout);
                resolve(code);
            });
        });

        if (exitCode !== 0) {
            sendJson(res, 422, {
                error: 'LilyPond could not compile the transcription.',
                details: stderr.slice(-4000)
            });
            return;
        }

        const [pdf, midi] = await Promise.all([
            fs.promises.readFile(`${outputBase}.pdf`),
            fs.promises.readFile(`${outputBase}.midi`)
        ]);
        sendJson(res, 200, {
            pdfBase64: pdf.toString('base64'),
            midiBase64: midi.toString('base64')
        });
    } catch (error) {
        console.error(`  -> LilyPond render failed: ${error.message}`);
        sendJson(res, 500, { error: error.message || 'LilyPond render failed.' });
    } finally {
        if (temporaryDirectory) {
            await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
        }
    }
}

const server = http.createServer((req, res) => {
    console.log(`[REQ] ${req.method} ${req.url}`);

    try {
        // Parse URL to ignore query strings
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let pathname = decodeURIComponent(parsedUrl.pathname);

        if (pathname === '/api/render-lilypond') {
            if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'Method Not Allowed' });
                return;
            }
            void renderLilypond(req, res);
            return;
        }

        // Normalize path to prevent directory traversal
        // path.normalize() resolves '..' and '.' segments
        let safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');

        // Remove leading slash to ensure path.join works correctly with __dirname
        if (safeSuffix.startsWith('/') || safeSuffix.startsWith('\\')) {
            safeSuffix = safeSuffix.substring(1);
        }

        let filePath = path.join(PUBLIC_DIR, safeSuffix);

        // Security Check: verify the resolved physical path is inside PUBLIC_DIR
        if (!filePath.startsWith(PUBLIC_DIR)) {
            console.error(`  -> 403 Forbidden: Directory traversal attempt to ${filePath}`);
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('403 Forbidden');
        }

        // Default route to index.html
        if (filePath === PUBLIC_DIR || filePath === PUBLIC_DIR + path.sep) {
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        // TypeScript compilation to ES2020 sometimes requests extensionless modules.
        const ext = path.extname(filePath);
        if (!ext && !filePath.endsWith(path.sep)) {
            filePath += '.js';
        }

        const finalExt = String(path.extname(filePath)).toLowerCase();
        const contentType = MIME_TYPES[finalExt] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    console.error(`  -> 404 Not Found`);
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('404 Not Found');
                } else {
                    console.error(`  -> 500 Server Error: ${error.code}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('500 Internal Server Error');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    } catch (err) {
        console.error(`  -> Bad Request: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('400 Bad Request');
    }
});

server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 CA Visualizer Server running (Secure Mode)`);
    console.log(`👉 http://localhost:${PORT}/`);
    console.log(`===============================================`);
});
