import { ErroHttp } from '../lib/errors.js';

export function json(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(dados),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(dados);
}

export const ok = (res, corpo) => json(res, 200, { ok: true, dados: corpo });
export const criado = (res, corpo) => json(res, 201, { ok: true, dados: corpo });

export function falha(res, erro) {
  if (erro instanceof ErroHttp) {
    return json(res, erro.status, { ok: false, erro: erro.message, detalhes: erro.detalhes });
  }
  console.error('[erro-interno]', erro);
  return json(res, 500, { ok: false, erro: 'Erro interno do servidor.' });
}

/** Le e faz o parse do corpo JSON, com limite de tamanho. */
export function lerJson(req, limiteBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limiteBytes) {
        reject(new ErroHttp(413, 'Corpo da requisicao muito grande.'));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      const bruto = Buffer.concat(partes).toString('utf8');
      if (!bruto) return resolve({});
      try { resolve(JSON.parse(bruto)); }
      catch { reject(new ErroHttp(400, 'JSON invalido no corpo da requisicao.')); }
    });
    req.on('error', reject);
  });
}
