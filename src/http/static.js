import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/** Serve arquivos de public/ bloqueando path traversal. */
export async function servirEstatico(raiz, caminhoUrl, res) {
  const relativo = normalize(caminhoUrl === '/' ? '/index.html' : caminhoUrl).replace(/^(\.\.[/\\])+/, '');
  if (relativo.includes('..')) return false;

  const arquivo = join(raiz, relativo);
  if (!arquivo.startsWith(raiz)) return false;

  try {
    const info = await stat(arquivo);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(arquivo).pipe(res);
    return true;
  } catch {
    return false;
  }
}
