/* =============== utilitarios compartilhados pelas telas =============== */

export const guardarSessao = (s) => localStorage.setItem('sessao', JSON.stringify(s));
export const lerSessao = () => { try { return JSON.parse(localStorage.getItem('sessao')); } catch { return null; } };
export const encerrarSessao = () => { localStorage.removeItem('sessao'); location.href = '/'; };

/** Cliente da API: injeta o token e normaliza o tratamento de erro. */
export async function api(caminho, opcoes = {}) {
  const sessao = lerSessao();
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(sessao?.token ? { Authorization: `Bearer ${sessao.token}` } : {}),
      ...opcoes.headers,
    },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : opcoes.body,
  });

  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401) { encerrarSessao(); throw new Error(dados.erro ?? 'Sessao expirada.'); }
  if (!resposta.ok) {
    const erro = new Error(dados.erro ?? `Erro ${resposta.status}`);
    erro.detalhes = dados.detalhes;
    throw erro;
  }
  return dados.dados;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Escapa texto antes de inserir no HTML (defesa contra XSS). */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function aviso(elemento, mensagem, tipo = 'erro') {
  if (!elemento) return;
  const lista = Array.isArray(mensagem?.detalhes) ? mensagem.detalhes : null;
  elemento.className = `aviso mostrar ${tipo}`;
  elemento.innerHTML = esc(mensagem?.message ?? mensagem) +
    (lista ? `<ul>${lista.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '');
  if (tipo === 'sucesso') setTimeout(() => elemento.classList.remove('mostrar'), 4000);
}
export const limparAviso = (el) => el?.classList.remove('mostrar');

/** Coleta os campos de um formulario, descartando os vazios. */
export function dadosDoFormulario(form) {
  const saida = {};
  for (const [chave, valor] of new FormData(form).entries()) {
    const v = String(valor).trim();
    if (v !== '') saida[chave] = v;
  }
  return saida;
}

// ----------------------------- formatacao ----------------------------
export const dataHora = (s) => s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'))
  .toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

export const somenteHora = (s) => s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'))
  .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';

export const cpfFormatado = (c) => String(c ?? '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

export const titulo = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const etiquetaTriagem = (cor) =>
  cor ? `<span class="etq ${esc(cor)}">${esc(titulo(cor))}</span>` : '<span class="etq neutro">Sem triagem</span>';

export const ROTULO_STATUS_CHAMADO = {
  aguardando: 'Aguardando despacho', despachado: 'Ambulancia a caminho',
  no_local: 'Equipe no local', transportando: 'Em transporte',
  concluido: 'Concluido', cancelado: 'Cancelado',
};

/** Monta a barra superior comum a todas as telas. */
export function montarTopo({ modulo, trilha, links = [] }) {
  const sessao = lerSessao();
  const selo = trilha === 'devops'
    ? '<span class="selo devops">Trilha DevOps</span>'
    : '<span class="selo nucleo">Nucleo regulado / Cascata</span>';

  return `
    <header class="topo">
      <span class="marca">&#9877; ${esc(modulo)}</span>
      ${selo}
      <span class="cresce"></span>
      ${links.map((l) => `<a href="${l.href}" class="discreto">${esc(l.texto)}</a>`).join('')}
      <span class="discreto">${esc(sessao?.usuario?.nome ?? '')} &middot; ${esc(titulo(sessao?.usuario?.papel ?? ''))}</span>
      <button class="btn secundario pequeno" id="btn-sair">Sair</button>
    </header>`;
}

export function ligarBotaoSair() {
  $('#btn-sair')?.addEventListener('click', encerrarSessao);
}

/** Redireciona para o portal se o papel nao pertencer a esta tela. */
export function exigirPapel(papeisPermitidos) {
  const sessao = lerSessao();
  if (!sessao?.token) { location.href = '/'; return null; }
  if (papeisPermitidos && !papeisPermitidos.includes(sessao.usuario.papel)) {
    alert(`Seu papel (${sessao.usuario.papel}) nao tem acesso a esta tela.`);
    location.href = '/';
    return null;
  }
  return sessao;
}

export const podeUsuario = (permissao) => {
  const s = lerSessao();
  return s?.permissoes?.includes(permissao) ?? false;
};
