import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './db/index.js';
import { criarAuditoria } from './lib/audit.js';
import { criarServicoProntuario } from './nucleo/prontuario.service.js';
import { criarServicoDespacho } from './nucleo/despacho.service.js';
import { criarServicoPaciente } from './app-paciente/paciente.service.js';
import { criarFlags } from './app-paciente/flags.js';
import { montarRotas } from './rotas.js';
import { lerJson, falha, json } from './http/respond.js';
import { servirEstatico } from './http/static.js';
import { verificarToken } from './lib/auth.js';
import { ErroHttp, erroNaoAutenticado } from './lib/errors.js';
import { config } from './config.js';

const RAIZ_PUBLICA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Monta todos os servicos sobre um banco. Reutilizado pelos testes. */
export function criarAplicacao({ caminhoBanco = config.dbPath } = {}) {
  const db = abrirBanco(caminhoBanco);
  const auditoria = criarAuditoria(db);
  const flags = criarFlags(db);
  const prontuario = criarServicoProntuario(db, auditoria);
  const despacho = criarServicoDespacho(db, auditoria);
  const paciente = criarServicoPaciente(db, auditoria, flags, despacho);
  const rotas = montarRotas({ prontuario, despacho, paciente, flags, auditoria, db });

  return { db, auditoria, flags, prontuario, despacho, paciente, rotas };
}

export function criarServidor(app = criarAplicacao()) {
  const servidor = createServer(async (req, res) => {
    const inicio = Date.now();
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    // Cabecalhos de seguranca aplicados a toda resposta.
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      if (!url.pathname.startsWith('/api/')) {
        const servido = await servirEstatico(RAIZ_PUBLICA, url.pathname, res);
        if (servido) return;
        return json(res, 404, { ok: false, erro: 'Pagina nao encontrada.' });
      }

      const resolucao = app.rotas.resolver(req.method, url.pathname);
      if (!resolucao) return json(res, 404, { ok: false, erro: `Rota ${req.method} ${url.pathname} nao existe.` });
      if (resolucao.metodoInvalido) return json(res, 405, { ok: false, erro: `Metodo ${req.method} nao permitido nesta rota.` });

      const { rota, params } = resolucao;
      const ip = req.socket.remoteAddress ?? null;

      let ator = null;
      if (!rota.publica) {
        const cabecalho = req.headers.authorization ?? '';
        if (!cabecalho.startsWith('Bearer ')) throw erroNaoAutenticado('Envie o cabecalho Authorization: Bearer <token>.');
        ator = verificarToken(cabecalho.slice(7));
      }

      const corpo = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await lerJson(req) : null;
      await rota.manipulador({ req, res, params, query: url.searchParams, corpo, ator, ip });
    } catch (erro) {
      falha(res, erro);
    } finally {
      if (config.ambiente !== 'test') {
        console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - inicio}ms)`);
      }
    }
  });

  return servidor;
}

export { ErroHttp };
