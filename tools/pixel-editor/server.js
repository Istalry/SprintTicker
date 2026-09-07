/**
 * Standalone 16x16 Pixel Art Editor Node.js HTTP Server.
 * Serves the interactive Web UI and exposes REST APIs to read/write pixel-bitmaps.ts.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 39124;
const BITMAPS_PATH = path.resolve(__dirname, '../../packages/desktop-app/src/shared/pixel-bitmaps.ts');
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * Parses all 16x16 export matrix arrays from pixel-bitmaps.ts.
 */
function parseBitmapsFromTS() {
  const content = fs.readFileSync(BITMAPS_PATH, 'utf8');
  const icons = {};

  // Extract top-level helper constants (N = null, W_DB, W_LB, W_WT, W_BK, etc.)
  const constDefs = [];
  const constRegex = /^const\ ([A-Za-z0-9_]+)\ =\ ([^;]+);/gm;
  let constMatch;
  while ((constMatch = constRegex.exec(content)) !== null) {
    constDefs.push(`const ${constMatch[1]} = ${constMatch[2]};`);
  }
  const evalHeader = constDefs.join('\n');

  const regex = /export\ const\ ([A-Z0-9_]+_16X16_BITMAP):\ \(string\ \|\ null\)\[\]\[\]\ =\ (\[[\s\S]*?\]);/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const rawArrayStr = match[2];
    try {
      const matrix = new Function(`${evalHeader}\nreturn ${rawArrayStr};`)();
      icons[key] = matrix;
    } catch (err) {
      console.error(`Failed to parse matrix ${key}:`, err.message);
    }
  }

  return icons;
}

/**
 * Formats a 16x16 JS matrix into clean TypeScript code.
 */
function matrixToTS(exportName, matrix) {
  const lines = [];
  lines.push(`export const ${exportName}: (string | null)[][] = [`);
  matrix.forEach((row, idx) => {
    const rowStr = row.map(val => (val === null || val === 'null' ? 'null' : `'${val}'`)).join(', ');
    const isLast = idx === matrix.length - 1;
    lines.push(`  [${rowStr}]${isLast ? '' : ','}`);
  });
  lines.push(`];`);
  return lines.join('\n');
}

/**
 * Saves updated 16x16 matrices back into pixel-bitmaps.ts.
 */
function saveBitmapsToTS(updatedIcons) {
  let content = fs.readFileSync(BITMAPS_PATH, 'utf8');

  Object.entries(updatedIcons).forEach(([key, matrix]) => {
    const newTS = matrixToTS(key, matrix).trim();
    const targetHeader = `export const ${key}: (string | null)[][] = [`;
    const startIdx = content.indexOf(targetHeader);

    if (startIdx !== -1) {
      const endIdx = content.indexOf('];', startIdx);
      if (endIdx !== -1) {
        content = content.slice(0, startIdx) + newTS + content.slice(endIdx + 2);
      } else {
        console.warn(`[PixelEditorServer] Could not find closing ]; for ${key}`);
      }
    } else {
      const insertPos = content.indexOf('export function getBitmapById');
      if (insertPos !== -1) {
        content = content.slice(0, insertPos) + `${newTS}\n\n` + content.slice(insertPos);
      } else {
        content += `\n${newTS}\n`;
      }
    }
  });

  fs.writeFileSync(BITMAPS_PATH, content, 'utf8');
  console.log(`[PixelEditorServer] Successfully saved ${Object.keys(updatedIcons).join(', ')} to ${BITMAPS_PATH}`);
}

/**
 * HTTP Request Handler for static files and REST API endpoints.
 */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // API 1: GET /api/icons
  if (req.method === 'GET' && url === '/api/icons') {
    try {
      const icons = parseBitmapsFromTS();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, icons }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // API 2: POST /api/save
  if (req.method === 'POST' && url === '/api/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.icons) {
          saveBitmapsToTS(payload.icons);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: 'Bitmaps saved successfully to pixel-bitmaps.ts!' }));
        } else if (payload.key && payload.matrix) {
          saveBitmapsToTS({ [payload.key]: payload.matrix });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: `Bitmap ${payload.key} saved successfully!` }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Invalid payload.' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Static File Server
  let filePath = path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

// Checked at startup rather than on the first request. The path was left
// pointing at src/main/hardware/ after the bitmaps moved to src/shared/, so
// every request 500d on ENOENT and the editor opened to an empty palette --
// which reads as "no icons yet" rather than as a broken tool. Failing here
// names the file it could not find.
if (!fs.existsSync(BITMAPS_PATH)) {
  console.error(`[PixelEditorServer] Bitmap module not found at ${BITMAPS_PATH}`);
  console.error(`[PixelEditorServer] It has probably moved. Update BITMAPS_PATH in ${__filename}.`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(` 🎨 BUSY Bar Standalone 16x16 Pixel Art Editor Running`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Target File: ${BITMAPS_PATH}`);
  console.log(`========================================================`);
});
