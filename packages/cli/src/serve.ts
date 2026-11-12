import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { BUILD_INFO } from '@raisedline/core';
import {
  liblouisAvailable,
  liblouisTables,
  liblouisTranslate,
  liblouisVersion,
} from './liblouis.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Serve the bundled web app on localhost, plus a small API that lets the browser use the
 * machine's liblouis for contracted (Grade 2) braille.
 */
export function serve(
  webRoot: string,
  port: number,
  host = '127.0.0.1',
): Promise<{ url: string; close: () => void }> {
  const root = resolve(webRoot);
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`The web app is not bundled at ${root}. Build it with "npm run build".`);
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/info') {
        return json(res, 200, {
          version: BUILD_INFO,
          liblouis: liblouisAvailable()
            ? { version: liblouisVersion(), tables: liblouisTables() }
            : null,
        });
      }
      if (url.pathname === '/api/braille') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        if (!liblouisAvailable())
          return json(res, 503, { error: 'liblouis is not installed on this machine' });
        const body = JSON.parse(await readBody(req)) as { table?: string; texts?: unknown };
        const table = String(body.table ?? 'en-ueb-g2.ctb');
        if (!Array.isArray(body.texts) || body.texts.length > 2000)
          return json(res, 400, { error: 'texts must be an array (max 2000)' });
        const braille = body.texts.map((t) => liblouisTranslate(table, String(t)));
        return json(res, 200, { table, braille });
      }
      // Static files, with an SPA fallback.
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!path || path.endsWith(sep) || path.endsWith('/')) path += 'index.html';
      let file = resolve(root, path);
      if (file !== root && !file.startsWith(root + sep))
        return json(res, 403, { error: 'Forbidden' });
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(readFileSync(file));
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolvePromise({
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${p}/`,
        close: () => server.close(),
      });
    });
  });
}
