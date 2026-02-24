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

const server = http.createServer((req, res) => {
    console.log(`[REQ] ${req.method} ${req.url}`);

    let filePath = '.' + req.url;

    // Default route to index.html
    if (filePath === './') {
        filePath = './index.html';
    }

    // TypeScript compilation to ES2020 sometimes requests extensionless modules.
    // We check if the file path lacks an extension, and we proactively append '.js'.
    const ext = path.extname(filePath);
    if (!ext && !filePath.endsWith('/')) {
        filePath += '.js';
    }

    const finalExt = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[finalExt] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                console.error(`  -> 404 Not Found: ${filePath}`);
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                console.error(`  -> 500 Server Error: ${error.code}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Server Error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 CA Visualizer Server running`);
    console.log(`👉 http://localhost:${PORT}/`);
    console.log(`===============================================`);
});
