import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { erroNaoAutenticado } from './errors.js';

// --------------------------- senhas ---------------------------------
export function gerarHashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  const derivada = scryptSync(senha, sal, 64).toString('hex');
  return `scrypt$${sal}$${derivada}`;
}

export function senhaConfere(senha, hashArmazenado) {
  const [algoritmo, sal, esperado] = String(hashArmazenado).split('$');
  if (algoritmo !== 'scrypt' || !sal || !esperado) return false;
  const derivada = scryptSync(senha, sal, 64);
  const alvo = Buffer.from(esperado, 'hex');
  return derivada.length === alvo.length && timingSafeEqual(derivada, alvo);
}

// --------------------------- tokens ---------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function assinar(conteudo) {
  return createHmac('sha256', config.segredo).update(conteudo).digest('base64url');
}

/** Emite um token assinado (HS256) com validade de um turno. */
export function emitirToken(usuario) {
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64url(JSON.stringify({
    sub: usuario.id,
    nome: usuario.nome,
    papel: usuario.papel,
    paciente_id: usuario.paciente_id ?? null,
    iat: agora,
    exp: agora + config.tokenValidadeSegundos,
  }));
  return `${cabecalho}.${corpo}.${assinar(`${cabecalho}.${corpo}`)}`;
}

/** Verifica assinatura e expiracao; devolve o conteudo do token. */
export function verificarToken(token) {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 3) throw erroNaoAutenticado('Token malformado.');

  const [cabecalho, corpo, assinatura] = partes;
  const esperada = Buffer.from(assinar(`${cabecalho}.${corpo}`));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    throw erroNaoAutenticado('Assinatura do token invalida.');
  }

  const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  if (dados.exp < Math.floor(Date.now() / 1000)) throw erroNaoAutenticado('Sessao expirada. Faca login novamente.');
  return dados;
}

/** Assinatura eletronica do registro clinico (vinculo autor + conteudo). */
export function assinarRegistro({ autorId, texto, criadoEm }) {
  return createHmac('sha256', config.segredo)
    .update(`${autorId}|${criadoEm}|${texto}`)
    .digest('hex');
}
