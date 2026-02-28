const http = require('http');
const fs = require('fs');
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

const server = http.createServer((req, res) => {
    console.log(`[REQ] ${req.method} ${req.url}`);

    try {
        // Parse URL to ignore query strings
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let pathname = decodeURIComponent(parsedUrl.pathname);

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
