/* ============ Central de regulacao e despacho de ambulancias ============ */
import {
  api, $, $$, esc, aviso, dadosDoFormulario, dataHora, somenteHora, titulo,
  etiquetaTriagem, montarTopo, ligarBotaoSair, exigirPapel, podeUsuario,
  ROTULO_STATUS_CHAMADO,
} from '/js/comum.js';

const sessao = exigirPapel(['operador_despacho', 'socorrista', 'admin', 'medico', 'enfermeiro', 'auditor']);
if (sessao) iniciar();

let chamadoAberto = null;
let estado = { chamados: [], frota: [] };

async function iniciar() {
  $('#topo').innerHTML = montarTopo({
    modulo: 'Central de Despacho',
    trilha: 'nucleo',
    links: [{ href: '/nucleo.html', texto: 'Prontuario' }, { href: '/auditoria.html', texto: 'Auditoria' }],
  });
  ligarBotaoSair();

  if (!podeUsuario('chamado:abrir')) $('#cartao-novo-chamado').hidden = true;
  $('#filtro-chamados').addEventListener('change', atualizar);
  $('#form-chamado').addEventListener('submit', abrirChamado);

  await atualizar();
  setInterval(atualizar, 10000);
}

async function atualizar() {
  try {
    const [chamados, frota, indicadores] = await Promise.all([
      api(`/api/nucleo/chamados?status=${$('#filtro-chamados').value}`),
      api('/api/nucleo/ambulancias'),
      api('/api/nucleo/indicadores'),
    ]);
    estado = { chamados, frota };
    desenharIndicadores(indicadores);
    desenharChamados(chamados);
    desenharFrota(frota);
    desenharMapa(chamados, frota);
    $('#atualizado').textContent = `atualizado as ${new Date().toLocaleTimeString('pt-BR')}`;
    if (chamadoAberto) verChamado(chamadoAberto, { silencioso: true });
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

function desenharIndicadores(i) {
  const cartao = (rotulo, valor, sufixo = '') => `
    <div class="metrica"><div class="rotulo">${esc(rotulo)}</div>
      <div class="valor">${valor ?? '-'}<span style="font-size:.7rem;color:var(--texto-2)"> ${esc(sufixo)}</span></div></div>`;

  $('#indicadores').innerHTML = [
    cartao('Chamados ativos', i.chamados_ativos),
    cartao('Aguardando', i.por_status?.aguardando ?? 0),
    cartao('Ambulancias livres', i.frota?.disponivel ?? 0),
    cartao('Tempo medio ate despacho', i.tempo_medio_despacho_min, 'min'),
    cartao('Tempo medio ate o local', i.tempo_medio_resposta_min, 'min'),
    cartao('P1/P2 fora do alvo', i.prioridade_alta_fora_do_alvo),
  ].join('');
}

function desenharChamados(lista) {
  $('#lista-chamados').innerHTML = lista.length ? `
    <table>
      <thead><tr><th>Protocolo</th><th>Risco</th><th>Ocorrencia</th><th>Situacao</th><th class="direita">Espera</th></tr></thead>
      <tbody>${lista.map((c) => `
        <tr class="clicavel ${c.id === chamadoAberto ? 'selecionada' : ''}" data-id="${c.id}">
          <td class="mono nowrap">${esc(c.protocolo)}
            <div class="discreto">${c.canal === 'app_paciente' ? 'via app' : 'central'}</div></td>
          <td>${etiquetaTriagem(c.cor_triagem)}<div class="discreto">P${c.prioridade}</div></td>
          <td>${esc(c.endereco)}<div class="discreto">${esc(titulo(c.natureza))} &middot; ${esc(c.solicitante_nome)}</div></td>
          <td><span class="etq ${c.status === 'aguardando' ? 'laranja' : c.status === 'concluido' ? 'verde' : 'azul'}">
                ${esc(ROTULO_STATUS_CHAMADO[c.status] ?? c.status)}</span>
            ${c.ambulancia_prefixo ? `<div class="discreto mono">${esc(c.ambulancia_prefixo)}</div>` : ''}</td>
          <td class="direita nowrap ${c.status === 'aguardando' && c.prioridade <= 2 && c.espera_min > 10 ? '' : 'discreto'}">
            ${c.espera_min} min</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p class="vazio">Nenhum chamado neste filtro.</p>';

  $$('#lista-chamados tr.clicavel').forEach((tr) =>
    tr.addEventListener('click', () => verChamado(Number(tr.dataset.id))));
}

function desenharFrota(frota) {
  // Uma unidade que terminou a missao no hospital so volta a fila depois que a
  // equipe sinaliza disponibilidade - por isso a liberacao e manual.
  const liberavel = (a) => a.status === 'no_hospital' && !a.chamado_protocolo;

  $('#lista-frota').innerHTML = `
    <table>
      <tbody>${frota.map((a) => `
        <tr>
          <td class="mono nowrap"><span class="ponto ${esc(a.status)}"></span><strong>${esc(a.prefixo)}</strong>
            <span class="etq neutro">${esc(a.tipo)}</span></td>
          <td>${esc(titulo(a.status))}
            ${a.chamado_protocolo ? `<div class="discreto mono">${esc(a.chamado_protocolo)}</div>` : `<div class="discreto">${esc(a.base)}</div>`}</td>
          <td class="discreto" style="font-size:.76rem">${esc(a.equipe ?? '')}</td>
          <td class="direita">
            ${liberavel(a) && podeUsuario('ambulancia:atualizar_status')
              ? `<button class="btn pequeno secundario" data-liberar="${a.id}">Liberar</button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  $$('#lista-frota button[data-liberar]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/nucleo/ambulancias/${b.dataset.liberar}`,
        { method: 'PATCH', corpo: { status: 'disponivel' } });
      await atualizar();
    } catch (erro) { aviso($('#aviso-global'), erro); }
  }));
}

// ------------------------------- mapa ---------------------------------
/** Projecao linear simples dos pontos sobre o viewBox do SVG. */
function desenharMapa(chamados, frota) {
  const pontos = [
    ...frota.map((a) => ({ lat: a.lat, lng: a.lng })),
    ...chamados.map((c) => ({ lat: c.lat, lng: c.lng })),
  ];
  if (!pontos.length) return;

  const lats = pontos.map((p) => p.lat), lngs = pontos.map((p) => p.lng);
  const margem = 0.012;
  const min = { lat: Math.min(...lats) - margem, lng: Math.min(...lngs) - margem };
  const max = { lat: Math.max(...lats) + margem, lng: Math.max(...lngs) + margem };
  const x = (lng) => 20 + ((lng - min.lng) / (max.lng - min.lng || 1)) * 560;
  const y = (lat) => 320 - ((lat - min.lat) / (max.lat - min.lat || 1)) * 300;

  const grade = Array.from({ length: 7 }, (_, i) =>
    `<line class="grade" x1="${20 + i * 93}" y1="10" x2="${20 + i * 93}" y2="330"/>
     <line class="grade" x1="10" y1="${20 + i * 50}" x2="590" y2="${20 + i * 50}"/>`).join('');

  const linhas = chamados.filter((c) => c.ambulancia_prefixo && c.status === 'despachado').map((c) => {
    const amb = frota.find((a) => a.prefixo === c.ambulancia_prefixo);
    return amb ? `<line x1="${x(amb.lng)}" y1="${y(amb.lat)}" x2="${x(c.lng)}" y2="${y(c.lat)}"
                        stroke="var(--amarelo)" stroke-width="1.5" stroke-dasharray="4 3" opacity=".7"/>` : '';
  }).join('');

  const COR = { vermelho: '#e5484d', laranja: '#f76b15', amarelo: '#ffb224', verde: '#30a46c', azul: '#5b8def' };
  const ocorrencias = chamados.filter((c) => !['concluido', 'cancelado'].includes(c.status)).map((c) => `
    <g>
      <polygon points="${x(c.lng)},${y(c.lat) - 8} ${x(c.lng) - 7},${y(c.lat) + 5} ${x(c.lng) + 7},${y(c.lat) + 5}"
               fill="${COR[c.cor_triagem] ?? '#888'}" stroke="#000" stroke-width=".5"/>
      <text x="${x(c.lng)}" y="${y(c.lat) + 17}" text-anchor="middle">${esc(c.protocolo.slice(-4))}</text>
    </g>`).join('');

  const ambulancias = frota.map((a) => `
    <g>
      <rect x="${x(a.lng) - 8}" y="${y(a.lat) - 6}" width="16" height="12" rx="2"
            fill="${a.status === 'disponivel' ? '#30a46c' : a.status === 'indisponivel' ? '#5a6b7d' : '#ffb224'}"
            stroke="#000" stroke-width=".5"/>
      <text x="${x(a.lng)}" y="${y(a.lat) - 10}" text-anchor="middle"
            style="font-weight:600;fill:var(--texto)">${esc(a.prefixo)}</text>
    </g>`).join('');

  $('#mapa').innerHTML = grade + linhas + ocorrencias + ambulancias;
}

// ---------------------------- detalhe do chamado -----------------------
async function verChamado(id, { silencioso = false } = {}) {
  chamadoAberto = id;
  if (!silencioso) $$('#lista-chamados tr').forEach((tr) =>
    tr.classList.toggle('selecionada', Number(tr.dataset.id) === id));

  try {
    const c = await api(`/api/nucleo/chamados/${id}`);
    let sugestao = null;
    if (c.status === 'aguardando' && podeUsuario('chamado:despachar')) {
      sugestao = await api(`/api/nucleo/chamados/${id}/sugestao`).catch(() => null);
    }
    desenharDetalhe(c, sugestao);
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

const PROXIMA_ETAPA = {
  despachado: 'Confirmar chegada ao local',
  no_local: 'Confirmar embarque e transporte',
  transportando: 'Confirmar chegada ao hospital',
};

function desenharDetalhe(c, sugestao) {
  const ativo = !['concluido', 'cancelado'].includes(c.status);

  $('#detalhe-chamado').innerHTML = `
    <div class="cartao">
      <div class="cabecalho">
        <div class="cresce">
          <h3 style="margin:0">Chamado <span class="mono">${esc(c.protocolo)}</span></h3>
          <div class="discreto">Aberto ${dataHora(c.aberto_em)} via ${c.canal === 'app_paciente' ? 'app do paciente' : 'central 192'}</div>
        </div>
        ${etiquetaTriagem(c.cor_triagem)}
      </div>

      <div id="aviso-detalhe" class="aviso"></div>

      <table style="margin-bottom:.6rem">
        <tbody>
          <tr><td class="discreto">Situacao</td><td><strong>${esc(ROTULO_STATUS_CHAMADO[c.status] ?? c.status)}</strong></td></tr>
          <tr><td class="discreto">Classificacao</td>
              <td>${esc(c.classificacao.rotulo)} (P${c.prioridade}) &middot; alvo de resposta ${c.classificacao.tempoAlvoMin} min
                  ${c.classificacao.exigeUSA ? '&middot; <strong>exige USA</strong>' : ''}</td></tr>
          <tr><td class="discreto">Local</td><td>${esc(c.endereco)}</td></tr>
          <tr><td class="discreto">Natureza</td><td>${esc(titulo(c.natureza))}</td></tr>
          <tr><td class="discreto">Solicitante</td><td>${esc(c.solicitante_nome)} ${esc(c.solicitante_telefone ?? '')}</td></tr>
          ${c.paciente_nome ? `<tr><td class="discreto">Paciente</td><td>${esc(c.paciente_nome)} (cadastrado)</td></tr>` : ''}
          ${c.ambulancia_prefixo ? `<tr><td class="discreto">Ambulancia</td>
            <td class="mono">${esc(c.ambulancia_prefixo)} (${esc(c.ambulancia_tipo)})
              ${c.eta_min ? `<span class="discreto"> &middot; ${c.distancia_km} km, ETA ${c.eta_min} min</span>` : ''}
              <div class="discreto" style="font-size:.76rem">${esc(c.ambulancia_equipe ?? '')}</div></td></tr>` : ''}
          ${c.atendimento_id ? `<tr><td class="discreto">Prontuario</td>
            <td><a href="/nucleo.html">Atendimento #${c.atendimento_id} aberto</a></td></tr>` : ''}
          ${c.motivo_cancelamento ? `<tr><td class="discreto">Cancelamento</td><td>${esc(c.motivo_cancelamento)}</td></tr>` : ''}
        </tbody>
      </table>

      ${c.descricao ? `<p style="margin:.3rem 0"><span class="discreto">Relato:</span> ${esc(c.descricao)}</p>` : ''}

      ${sugestao?.escolhida ? `
        <div class="cartao" style="background:var(--fundo-3);margin-top:.8rem">
          <strong>Sugestao do sistema:</strong>
          <span class="mono">${esc(sugestao.escolhida.prefixo)}</span> (${esc(sugestao.escolhida.tipo)}) &middot;
          ${sugestao.escolhida.distancia_km} km &middot; ETA ${sugestao.escolhida.eta_min} min
          ${!sugestao.escolhida.adequada ? `
            <div class="aviso erro mostrar" style="margin-top:.5rem">
              <strong>&#9888; Recurso abaixo do indicado.</strong>
              Este chamado exige Unidade de Suporte Avancado, mas nenhuma USA esta disponivel.
              Despachar a USB apenas como recurso de primeira resposta e acionar apoio avancado.
            </div>` : ''}
          <div class="discreto" style="margin-top:.4rem">Demais unidades disponiveis:
            ${sugestao.candidatas.slice(1).map((a) => `${esc(a.prefixo)} (${a.distancia_km} km)`).join(', ') || 'nenhuma'}</div>
          <form id="form-despacho" style="margin-top:.6rem">
            <label>Unidade a despachar</label>
            <select name="ambulancia_id">
              ${sugestao.candidatas.map((a) => `
                <option value="${a.id}" ${a.id === sugestao.escolhida.id ? 'selected' : ''}>
                  ${esc(a.prefixo)} - ${esc(a.tipo)} - ${a.distancia_km} km - ETA ${a.eta_min} min
                  ${!a.adequada ? '(abaixo do recurso indicado)' : ''}
                </option>`).join('')}
            </select>
            <button class="btn" type="submit">Despachar</button>
          </form>
        </div>` : ''}

      ${ativo && PROXIMA_ETAPA[c.status] && podeUsuario('chamado:atualizar') ? `
        <button class="btn" id="btn-avancar">${esc(PROXIMA_ETAPA[c.status])}</button>` : ''}

      ${c.status === 'transportando' && !c.atendimento_id && !podeUsuario('atendimento:abrir') ? `
        <div class="aviso mostrar" style="margin-top:.8rem;border-color:var(--borda);color:var(--texto-2)">
          Paciente a caminho do hospital. A admissao no prontuario e um ato clinico:
          deve ser feita pela equipe assistencial (medico, enfermagem ou recepcao).
        </div>` : ''}

      ${c.status === 'transportando' && !c.atendimento_id && podeUsuario('atendimento:abrir') ? `
        <form id="form-admitir" style="margin-top:.8rem;border-top:1px solid var(--borda);padding-top:.6rem">
          <strong>Admissao no pronto-socorro</strong>
          <p class="discreto" style="margin:.2rem 0">
            Abre o atendimento no prontuario ja com a classificacao de risco definida em campo.</p>
          ${!c.paciente_id ? `<label>ID do paciente identificado</label>
            <input name="paciente_id" type="number" required placeholder="cadastre o paciente no prontuario primeiro">` : ''}
          <label>Queixa principal para o prontuario</label>
          <input name="queixa_principal" placeholder="${esc(c.natureza)}: ${esc((c.descricao ?? '').slice(0, 50))}">
          <button class="btn" type="submit">Admitir e abrir prontuario</button>
        </form>` : ''}

      ${ativo && podeUsuario('chamado:cancelar') ? `
        <form id="form-cancelar" style="margin-top:.8rem;border-top:1px solid var(--borda);padding-top:.6rem">
          <label>Motivo do cancelamento</label>
          <input name="motivo" required minlength="5" placeholder="Ex.: trote confirmado, paciente recusou remocao">
          <button class="btn perigo pequeno" style="margin-top:.5rem" type="submit">Cancelar chamado</button>
        </form>` : ''}
    </div>

    <div class="cartao">
      <div class="cabecalho"><h3 class="cresce">Linha do tempo</h3></div>
      <ul class="linha-tempo">
        ${c.eventos.map((e) => `
          <li><div class="quando">${somenteHora(e.criado_em)} &middot; ${esc(e.autor_nome ?? 'sistema')}</div>
            <div>${esc(e.descricao)}</div></li>`).join('')}
      </ul>
    </div>`;

  const acao = async (fn) => {
    try { await fn(); chamadoAberto = c.id; await atualizar(); }
    catch (erro) { aviso($('#aviso-detalhe'), erro); }
  };

  $('#form-despacho')?.addEventListener('submit', (e) => {
    e.preventDefault();
    acao(() => api(`/api/nucleo/chamados/${c.id}/despachar`,
      { method: 'POST', corpo: dadosDoFormulario(e.target) }));
  });

  $('#btn-avancar')?.addEventListener('click', () =>
    acao(() => api(`/api/nucleo/chamados/${c.id}/avancar`, { method: 'POST', corpo: {} })));

  $('#form-admitir')?.addEventListener('submit', (e) => {
    e.preventDefault();
    acao(() => api(`/api/nucleo/chamados/${c.id}/admitir`,
      { method: 'POST', corpo: dadosDoFormulario(e.target) }));
  });

  $('#form-cancelar')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!confirm('Confirma o cancelamento deste chamado?')) return;
    acao(() => api(`/api/nucleo/chamados/${c.id}/cancelar`,
      { method: 'POST', corpo: dadosDoFormulario(e.target) }));
  });
}

async function abrirChamado(e) {
  e.preventDefault();
  try {
    const novo = await api('/api/nucleo/chamados', { method: 'POST', corpo: dadosDoFormulario(e.target) });
    aviso($('#aviso-chamado'),
      `Chamado ${novo.protocolo} aberto. Triagem: ${novo.cor_triagem.toUpperCase()} (P${novo.prioridade}). ` +
      `Motivos: ${novo.triagem.motivos.join('; ')}`, 'sucesso');
    e.target.reset();
    chamadoAberto = novo.id;
    await atualizar();
  } catch (erro) { aviso($('#aviso-chamado'), erro); }
}
