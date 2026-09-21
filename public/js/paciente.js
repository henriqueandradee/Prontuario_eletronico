/* ================== App do paciente (trilha DevOps) ==================
 * Cada bloco da tela e controlado por uma feature flag: o que estiver
 * desligado no servidor simplesmente nao e renderizado, permitindo
 * desligar uma funcionalidade em producao sem novo deploy.
 * ==================================================================== */
import {
  api, $, esc, aviso, dadosDoFormulario, dataHora, titulo,
  etiquetaTriagem, montarTopo, ligarBotaoSair, exigirPapel, ROTULO_STATUS_CHAMADO,
} from '/js/comum.js';

const sessao = exigirPapel(['paciente']);
let flags = {};
let temporizador = null;
let chamadoEmAndamento = false;

if (sessao) iniciar();

async function iniciar() {
  $('#topo').innerHTML = montarTopo({ modulo: 'Meu Hospital', trilha: 'devops' });
  ligarBotaoSair();
  flags = await api('/api/app/flags');
  $('#rodape-flags').textContent =
    'Funcionalidades ativas: ' + Object.entries(flags).filter(([, v]) => v).map(([k]) => k.replace('app.', '')).join(', ');
  await Promise.all([carregarPerfil(), carregarAtendimentos(), carregarChamado()]);
}

async function carregarPerfil() {
  try {
    const p = await api('/api/app/perfil');
    $('#perfil').innerHTML = `
      <div class="cartao">
        <div class="cabecalho"><h2 class="cresce">Ola, ${esc(p.nome.split(' ')[0])}</h2>
          <span class="etq neutro">${esc(p.tipo_sanguineo ?? '-')}</span></div>
        <p class="discreto" style="margin:.2rem 0">
          CPF ${esc(p.cpf)} &middot; Cartao SUS ${esc(p.cartao_sus ?? '-')}<br>
          ${esc(p.telefone ?? '')} ${p.endereco ? `&middot; ${esc(p.endereco)}` : ''}
        </p>
        ${p.alergias.length ? `
          <div class="aviso erro mostrar" style="margin:.7rem 0 0">
            <strong>&#9888; Suas alergias registradas:</strong>
            ${p.alergias.map((a) => `${esc(a.substancia)} (${esc(a.gravidade)})`).join(' &middot; ')}
          </div>` : ''}
      </div>`;
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

async function carregarAtendimentos() {
  try {
    const lista = await api('/api/app/atendimentos');
    $('#atendimentos').innerHTML = `
      <div class="cartao">
        <div class="cabecalho"><h3 class="cresce">Meus atendimentos</h3>
          ${!flags['app.historico_completo'] ? '<span class="discreto">ultimos 5</span>' : ''}</div>
        ${lista.length ? lista.map((a) => `
          <div class="registro" style="cursor:pointer" data-id="${a.id}">
            <div class="meta">${dataHora(a.aberto_em)} &middot; ${esc(titulo(a.tipo))}
              ${a.origem === 'ambulancia' ? '&middot; chegada por ambulancia' : ''}</div>
            <div><strong>${esc(a.queixa_principal)}</strong></div>
            <div style="margin-top:.35rem">
              ${etiquetaTriagem(a.classificacao_risco)}
              <span class="etq ${['alta'].includes(a.status) ? 'verde' : 'azul'}">${esc(titulo(a.status))}</span>
              ${a.leito ? `<span class="etq neutro">Leito ${esc(a.leito)}</span>` : ''}
            </div>
            ${a.desfecho ? `<div class="discreto" style="margin-top:.4rem">${esc(a.desfecho)}</div>` : ''}
            <div id="detalhe-${a.id}"></div>
          </div>`).join('') : '<p class="vazio">Voce ainda nao possui atendimentos registrados.</p>'}
      </div>`;

    $('#atendimentos').querySelectorAll('[data-id]').forEach((el) =>
      el.addEventListener('click', () => verDetalhe(Number(el.dataset.id))));
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

async function verDetalhe(id) {
  const alvo = $(`#detalhe-${id}`);
  if (!alvo || alvo.innerHTML) { if (alvo) alvo.innerHTML = ''; return; }
  try {
    const a = await api(`/api/app/atendimentos/${id}`);
    alvo.innerHTML = `
      <div style="margin-top:.7rem;border-top:1px solid var(--borda);padding-top:.6rem">
        ${a.prescricoes ? `
          <strong style="font-size:.85rem">Medicamentos prescritos</strong>
          ${a.prescricoes.length ? a.prescricoes.map((p) => `
            <div style="margin:.4rem 0;font-size:.86rem">
              <strong>${esc(p.medicamento)}</strong> - ${esc(p.dose)}, ${esc(p.via.toUpperCase())}, ${esc(p.frequencia)}
              ${p.duracao ? ` por ${esc(p.duracao)}` : ''}
              <div class="discreto">${esc(p.prescritor)} ${esc(p.registro_prof ?? '')}
                &middot; <span class="etq ${p.status === 'ativa' ? 'verde' : 'neutro'}">${esc(titulo(p.status))}</span></div>
            </div>`).join('') : '<p class="discreto">Nenhuma prescricao.</p>'}
        ` : '<p class="discreto">Visualizacao de prescricoes indisponivel no momento.</p>'}

        ${a.evolucoes ? `
          <strong style="font-size:.85rem;display:block;margin-top:.6rem">Registros clinicos</strong>
          ${a.evolucoes.map((e) => `
            <div class="discreto" style="margin-top:.35rem;font-size:.82rem">
              <em>${esc(titulo(e.tipo))}</em> - ${esc(e.autor)} (${dataHora(e.criado_em)})<br>${esc(e.texto)}
            </div>`).join('')}` : ''}
      </div>`;
  } catch (erro) { alvo.innerHTML = `<p class="discreto">${esc(erro.message)}</p>`; }
}

// ------------------------- solicitar ambulancia ------------------------
function desenharSolicitacao() {
  // Com um chamado em andamento nao faz sentido oferecer outro: o servidor
  // rejeitaria (409) e o paciente so veria um erro.
  if (chamadoEmAndamento) {
    $('#solicitar').innerHTML = `
      <div class="cartao"><p class="vazio">
        Voce ja tem uma solicitacao em andamento, acompanhada acima.
        Se a situacao piorar, ligue <strong>192</strong>.</p></div>`;
    return;
  }

  if (!flags['app.solicitar_ambulancia']) {
    $('#solicitar').innerHTML = `
      <div class="cartao"><p class="vazio">
        A solicitacao de ambulancia pelo aplicativo esta temporariamente indisponivel.
        Em caso de emergencia ligue <strong>192</strong>.</p></div>`;
    return;
  }

  $('#solicitar').innerHTML = `
    <div class="cartao">
      <div class="cabecalho"><h3 class="cresce">Solicitar ambulancia</h3>
        <span class="etq vermelho">Emergencia: 192</span></div>
      <div id="aviso-solicitar" class="aviso"></div>
      <form id="form-solicitar">
        <label>Endereco onde voce esta</label>
        <input name="endereco" required placeholder="Rua, numero - bairro">
        <div class="linha">
          <div><label>Latitude</label><input name="lat" type="number" step="any" value="-26.3045" required></div>
          <div><label>Longitude</label><input name="lng" type="number" step="any" value="-48.8487" required></div>
        </div>
        <label>O que esta acontecendo?</label>
        <select name="natureza">
          <option value="clinico">Mal estar geral</option>
          <option value="trauma">Queda ou acidente</option>
          <option value="cardiaco">Dor no peito</option>
          <option value="respiratorio">Falta de ar</option>
          <option value="obstetrico">Gestante / parto</option>
          <option value="intoxicacao">Intoxicacao</option>
        </select>
        <label>Descreva a situacao</label>
        <textarea name="descricao" required minlength="10" style="min-height:70px"
          placeholder="Conte o que esta acontecendo. Quanto mais detalhes, melhor a classificacao do risco."></textarea>
        <input type="hidden" name="prioridade" value="4">
        <button class="btn" type="submit" style="width:100%">Solicitar ambulancia</button>
        <p class="discreto" style="margin:.6rem 0 0">
          Use o botao localizar para preencher sua posicao automaticamente.
          <button type="button" class="btn secundario pequeno" id="btn-local">Usar minha localizacao</button>
        </p>
      </form>
    </div>`;

  $('#btn-local').addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        $('[name=lat]').value = pos.coords.latitude.toFixed(6);
        $('[name=lng]').value = pos.coords.longitude.toFixed(6);
      },
      () => aviso($('#aviso-solicitar'), 'Nao foi possivel obter a localizacao. Preencha o endereco manualmente.'));
  });

  $('#form-solicitar').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Confirmar o envio da solicitacao de ambulancia?')) return;
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      await api('/api/app/ambulancia', { method: 'POST', corpo: dadosDoFormulario(e.target) });
      await carregarChamado();
    } catch (erro) { aviso($('#aviso-solicitar'), erro); }
    finally { botao.disabled = false; }
  });
}

// ------------------------ acompanhar o chamado -------------------------
async function carregarChamado() {
  // Sem acompanhamento nao ha como saber se existe chamado ativo: a tela cai
  // no fluxo normal de solicitacao e o servidor barra a duplicidade.
  if (!flags['app.acompanhar_chamado']) { desenharSolicitacao(); return; }
  try {
    const c = await api('/api/app/ambulancia');
    if (!c) {
      $('#chamado-ativo').innerHTML = '';
      clearInterval(temporizador); temporizador = null;
      chamadoEmAndamento = false;
      desenharSolicitacao();
      return;
    }
    chamadoEmAndamento = true;
    desenharSolicitacao();

    $('#chamado-ativo').innerHTML = `
      <div class="cartao" style="border-color:var(--acento)">
        <div class="cabecalho">
          <h2 class="cresce">Ambulancia solicitada</h2>
          ${etiquetaTriagem(c.cor_triagem)}
        </div>
        <p class="mono discreto" style="margin:.2rem 0">Protocolo ${esc(c.protocolo)}</p>
        <div class="metricas" style="margin:.7rem 0">
          <div class="metrica"><div class="rotulo">Situacao</div>
            <div class="valor" style="font-size:1rem">${esc(ROTULO_STATUS_CHAMADO[c.status] ?? c.status)}</div></div>
          ${c.ambulancia ? `<div class="metrica"><div class="rotulo">Unidade</div>
            <div class="valor" style="font-size:1rem">${esc(c.ambulancia.prefixo)}</div></div>` : ''}
          ${c.eta_min ? `<div class="metrica"><div class="rotulo">Chegada estimada</div>
            <div class="valor">${c.eta_min}<span style="font-size:.7rem"> min</span></div></div>` : ''}
          ${c.distancia_km ? `<div class="metrica"><div class="rotulo">Distancia</div>
            <div class="valor">${c.distancia_km}<span style="font-size:.7rem"> km</span></div></div>` : ''}
        </div>
        <p class="discreto" style="margin:.2rem 0">Atendimento classificado como
          <strong>${esc(c.classificacao.rotulo)}</strong>. Tempo alvo de resposta: ${c.classificacao.tempoAlvoMin} min.</p>
        <h3 style="margin-top:.9rem">Acompanhamento</h3>
        <ul class="linha-tempo">
          ${c.linha_do_tempo.map((e) => `
            <li><div class="quando">${dataHora(e.em)}</div><div>${esc(e.descricao)}</div></li>`).join('')}
        </ul>
      </div>`;

    if (!temporizador) temporizador = setInterval(carregarChamado, 8000);
  } catch (erro) {
    if (String(erro.message).includes('indisponivel')) {
      chamadoEmAndamento = false;
      desenharSolicitacao();
    } else {
      aviso($('#aviso-global'), erro);
    }
  }
}
