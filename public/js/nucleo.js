/* =============== Painel hospitalar - prontuario eletronico =============== */
import {
  api, $, $$, esc, aviso, dadosDoFormulario, dataHora, cpfFormatado, titulo,
  etiquetaTriagem, montarTopo, ligarBotaoSair, exigirPapel, podeUsuario,
} from '/js/comum.js';

const sessao = exigirPapel(['medico', 'enfermeiro', 'recepcao', 'admin', 'auditor']);
if (sessao) iniciar();

let atendimentoAberto = null;
let pacienteAberto = null;

async function iniciar() {
  $('#topo').innerHTML = montarTopo({
    modulo: 'Prontuario Eletronico',
    trilha: 'nucleo',
    links: [
      { href: '/despacho.html', texto: 'Central de despacho' },
      { href: '/auditoria.html', texto: 'Auditoria' },
    ],
  });
  ligarBotaoSair();

  $('#abas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aba]');
    if (!b) return;
    $$('#abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    $('#painel-atendimentos').hidden = b.dataset.aba !== 'atendimentos';
    $('#painel-pacientes').hidden = b.dataset.aba !== 'pacientes';
    if (b.dataset.aba === 'pacientes') carregarPacientes();
  });

  // As permissoes do papel definem o que aparece na tela (espelho do RBAC do servidor).
  if (!podeUsuario('atendimento:abrir')) $('#cartao-abrir-atendimento').hidden = true;
  if (!podeUsuario('paciente:criar')) $('#cartao-novo-paciente').hidden = true;

  $('#filtro-status').addEventListener('change', carregarAtendimentos);
  $('#form-atendimento').addEventListener('submit', abrirAtendimento);
  $('#form-paciente').addEventListener('submit', cadastrarPaciente);
  $('#busca-paciente').addEventListener('input', debounce(carregarPacientes, 250));

  await Promise.all([carregarAtendimentos(), carregarSelectPacientes()]);
  setInterval(carregarAtendimentos, 15000);
}

// ---------------------------- atendimentos -----------------------------
async function carregarAtendimentos() {
  try {
    const lista = await api(`/api/nucleo/atendimentos?status=${$('#filtro-status').value}`);
    $('#lista-atendimentos').innerHTML = lista.length ? `
      <table>
        <thead><tr><th>Paciente</th><th>Risco</th><th>Queixa</th><th>Leito</th><th>Abertura</th></tr></thead>
        <tbody>${lista.map((a) => `
          <tr class="clicavel ${a.id === atendimentoAberto ? 'selecionada' : ''}" data-id="${a.id}">
            <td><strong>${esc(a.paciente_nome)}</strong><div class="discreto">${esc(titulo(a.tipo))} &middot; ${esc(titulo(a.origem))}</div></td>
            <td>${etiquetaTriagem(a.classificacao_risco)}</td>
            <td>${esc(a.queixa_principal.slice(0, 60))}${a.queixa_principal.length > 60 ? '...' : ''}</td>
            <td class="nowrap">${esc(a.leito ?? '-')}</td>
            <td class="nowrap discreto">${dataHora(a.aberto_em)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="vazio">Nenhum atendimento neste filtro.</p>';

    $$('#lista-atendimentos tr.clicavel').forEach((tr) =>
      tr.addEventListener('click', () => abrirProntuario(Number(tr.dataset.id))));
  } catch (erro) {
    aviso($('#aviso-global'), erro);
  }
}

async function abrirAtendimento(e) {
  e.preventDefault();
  try {
    const novo = await api('/api/nucleo/atendimentos', { method: 'POST', corpo: dadosDoFormulario(e.target) });
    e.target.reset();
    aviso($('#aviso-abrir'), `Atendimento #${novo.id} aberto.`, 'sucesso');
    await carregarAtendimentos();
    abrirProntuario(novo.id);
  } catch (erro) { aviso($('#aviso-abrir'), erro); }
}

async function abrirProntuario(id) {
  atendimentoAberto = id;
  $$('#lista-atendimentos tr').forEach((tr) => tr.classList.toggle('selecionada', Number(tr.dataset.id) === id));
  try {
    desenharProntuario(await api(`/api/nucleo/atendimentos/${id}`));
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

function desenharProntuario(a) {
  const encerrado = ['alta', 'obito', 'transferido'].includes(a.status);
  const ultimo = a.sinais_vitais[0];

  $('#detalhe-atendimento').innerHTML = `
    <div class="cartao">
      <div class="cabecalho">
        <div class="cresce">
          <h2 style="margin:0">${esc(a.paciente_nome)}, ${a.idade} anos</h2>
          <div class="discreto">
            Atendimento #${a.id} &middot; CPF ${cpfFormatado(a.paciente_cpf)}
            ${a.tipo_sanguineo ? `&middot; Sangue ${esc(a.tipo_sanguineo)}` : ''}
            ${a.chamado_id ? `&middot; <strong>Admitido via ambulancia (chamado #${a.chamado_id})</strong>` : ''}
          </div>
        </div>
        ${etiquetaTriagem(a.classificacao_risco)}
        <span class="etq neutro">${esc(titulo(a.status))}</span>
      </div>

      ${a.alergias.length ? `
        <div class="aviso erro mostrar" style="margin-bottom:.8rem">
          <strong>&#9888; Alergias:</strong>
          ${a.alergias.map((x) => `${esc(x.substancia)} (${esc(x.gravidade)})`).join(' &middot; ')}
        </div>` : ''}

      <p style="margin:.2rem 0"><span class="discreto">Queixa principal:</span> ${esc(a.queixa_principal)}</p>
      <p class="discreto" style="margin:.2rem 0">
        Aberto em ${dataHora(a.aberto_em)} &middot; Responsavel: ${esc(a.responsavel_nome ?? '-')}
        ${a.leito ? `&middot; Leito ${esc(a.leito)}` : ''}
      </p>
      ${a.desfecho ? `<div class="aviso sucesso mostrar" style="margin-top:.6rem"><strong>Desfecho:</strong> ${esc(a.desfecho)}</div>` : ''}
      <div id="aviso-prontuario" class="aviso" style="margin-top:.7rem"></div>
    </div>

    <div class="cartao">
      <div class="cabecalho"><h3 class="cresce">Sinais vitais</h3>
        <span class="discreto">${a.sinais_vitais.length} registro(s)</span></div>
      ${ultimo ? `
        <div class="metricas">
          ${metrica('PA', ultimo.pa_sistolica ? `${ultimo.pa_sistolica}/${ultimo.pa_diastolica}` : '-', 'mmHg')}
          ${metrica('FC', ultimo.fc ?? '-', 'bpm')}
          ${metrica('FR', ultimo.fr ?? '-', 'irpm')}
          ${metrica('Temp', ultimo.temperatura ?? '-', 'C')}
          ${metrica('SatO2', ultimo.saturacao ?? '-', '%')}
          ${metrica('Dor', ultimo.dor ?? '-', '/10')}
        </div>
        <p class="discreto" style="margin:.6rem 0 0">
          Ultimo registro por ${esc(ultimo.registrado_por_nome)} em ${dataHora(ultimo.criado_em)}</p>
      ` : '<p class="vazio">Nenhum sinal vital registrado.</p>'}

      ${podeUsuario('sinais:registrar') && !encerrado ? `
        <form id="form-sinais" style="margin-top:.8rem;border-top:1px solid var(--borda);padding-top:.6rem">
          <div class="linha3">
            <div><label>PA sistolica</label><input name="pa_sistolica" type="number" min="40" max="300"></div>
            <div><label>PA diastolica</label><input name="pa_diastolica" type="number" min="20" max="200"></div>
            <div><label>FC (bpm)</label><input name="fc" type="number" min="20" max="250"></div>
          </div>
          <div class="linha3">
            <div><label>FR (irpm)</label><input name="fr" type="number" min="4" max="80"></div>
            <div><label>Temperatura</label><input name="temperatura" type="number" step="0.1" min="30" max="45"></div>
            <div><label>SatO2 (%)</label><input name="saturacao" type="number" min="40" max="100"></div>
          </div>
          <div class="linha">
            <div><label>Glicemia (mg/dL)</label><input name="glicemia" type="number" min="10" max="900"></div>
            <div><label>Dor (0-10)</label><input name="dor" type="number" min="0" max="10"></div>
          </div>
          <button class="btn" type="submit">Registrar sinais vitais</button>
        </form>` : ''}
    </div>

    <div class="cartao">
      <div class="cabecalho"><h3 class="cresce">Prescricoes</h3></div>
      ${a.prescricoes.length ? `
        <table>
          <thead><tr><th>Medicamento</th><th>Posologia</th><th>Prescritor</th><th>Status</th></tr></thead>
          <tbody>${a.prescricoes.map((p) => `
            <tr>
              <td><strong>${esc(p.medicamento)}</strong>${p.observacao ? `<div class="discreto">${esc(p.observacao)}</div>` : ''}</td>
              <td>${esc(p.dose)} &middot; ${esc(p.via.toUpperCase())} &middot; ${esc(p.frequencia)}${p.duracao ? ` &middot; ${esc(p.duracao)}` : ''}</td>
              <td class="discreto">${esc(p.prescritor_nome)}<div>${esc(p.registro_prof ?? '')}</div></td>
              <td><span class="etq ${p.status === 'ativa' ? 'verde' : 'neutro'}">${esc(titulo(p.status))}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p class="vazio">Nenhuma prescricao.</p>'}

      ${podeUsuario('prescricao:criar') && !encerrado ? `
        <form id="form-prescricao" style="margin-top:.8rem;border-top:1px solid var(--borda);padding-top:.6rem">
          <label>Medicamento</label><input name="medicamento" required placeholder="Ex.: Dipirona 500mg">
          <div class="linha3">
            <div><label>Dose</label><input name="dose" required placeholder="1 comprimido"></div>
            <div>
              <label>Via</label>
              <select name="via"><option value="oral">Oral</option><option value="ev">Endovenosa</option>
                <option value="im">Intramuscular</option><option value="sc">Subcutanea</option>
                <option value="inalatoria">Inalatoria</option><option value="topica">Topica</option>
                <option value="retal">Retal</option></select>
            </div>
            <div><label>Frequencia</label><input name="frequencia" required placeholder="8/8h"></div>
          </div>
          <div class="linha">
            <div><label>Duracao</label><input name="duracao" placeholder="5 dias"></div>
            <div><label>Observacao</label><input name="observacao"></div>
          </div>
          <button class="btn" type="submit">Prescrever</button>
        </form>` : ''}
    </div>

    <div class="cartao">
      <div class="cabecalho"><h3 class="cresce">Registro clinico</h3>
        <span class="discreto">Somente inclusao &middot; correcoes por retificacao</span></div>
      ${a.evolucoes.length ? a.evolucoes.map((e) => `
        <div class="registro ${e.tipo === 'retificacao' ? 'retificacao' : ''}">
          <div class="meta">
            <strong>${esc(titulo(e.tipo))}</strong> &middot; ${esc(e.autor_nome)}
            ${e.registro_prof ? `(${esc(e.registro_prof)})` : ''} &middot; ${dataHora(e.criado_em)}
            ${e.retifica_id ? ` &middot; retifica o registro #${e.retifica_id}` : ''}
          </div>
          <div class="texto">${esc(e.texto)}</div>
          <div class="meta mono" style="margin-top:.3rem" title="Assinatura eletronica do registro">
            assinatura ${esc(e.assinatura.slice(0, 16))}...</div>
        </div>`).join('') : '<p class="vazio">Nenhum registro clinico.</p>'}

      ${podeUsuario('evolucao:registrar') ? `
        <form id="form-evolucao" style="margin-top:.8rem;border-top:1px solid var(--borda);padding-top:.6rem">
          <div class="linha">
            <div>
              <label>Tipo de registro</label>
              <select name="tipo" id="evo-tipo">
                ${sessao.usuario.papel === 'medico' || sessao.usuario.papel === 'admin'
                  ? '<option value="evolucao">Evolucao medica</option><option value="anamnese">Anamnese</option>' : ''}
                <option value="enfermagem">Evolucao de enfermagem</option>
                <option value="exame">Resultado de exame</option>
                <option value="retificacao">Retificacao</option>
              </select>
            </div>
            <div id="campo-retifica" hidden>
              <label>Retificar registro</label>
              <select name="retifica_id">
                ${a.evolucoes.filter((e) => e.tipo !== 'retificacao')
                  .map((e) => `<option value="${e.id}">#${e.id} - ${esc(titulo(e.tipo))} (${dataHora(e.criado_em)})</option>`).join('')}
              </select>
            </div>
          </div>
          <label>Texto do registro</label>
          <textarea name="texto" required minlength="10" placeholder="Descreva a evolucao, conduta e plano terapeutico..."></textarea>
          <button class="btn" type="submit">Assinar e registrar</button>
        </form>` : ''}
    </div>

    ${podeUsuario('atendimento:encerrar') && !encerrado ? `
      <div class="cartao">
        <div class="cabecalho"><h3 class="cresce">Encerrar atendimento</h3></div>
        <form id="form-encerrar">
          <label>Desfecho</label>
          <select name="status">
            <option value="alta">Alta</option>
            <option value="transferido">Transferido</option>
            <option value="obito">Obito</option>
          </select>
          <label>Descricao do desfecho e orientacoes</label>
          <textarea name="desfecho" required minlength="5" style="min-height:60px"></textarea>
          <button class="btn perigo" type="submit">Encerrar atendimento</button>
        </form>
      </div>` : ''}
  `;

  const recarregar = async () => { await carregarAtendimentos(); abrirProntuario(a.id); };
  const submeter = (seletor, caminho, sucesso) =>
    $(seletor)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(caminho, { method: 'POST', corpo: dadosDoFormulario(e.target) });
        aviso($('#aviso-prontuario'), sucesso, 'sucesso');
        await recarregar();
      } catch (erro) { aviso($('#aviso-prontuario'), erro); }
    });

  submeter('#form-sinais', `/api/nucleo/atendimentos/${a.id}/sinais-vitais`, 'Sinais vitais registrados.');
  submeter('#form-prescricao', `/api/nucleo/atendimentos/${a.id}/prescricoes`, 'Prescricao registrada.');
  submeter('#form-evolucao', `/api/nucleo/atendimentos/${a.id}/evolucoes`, 'Registro clinico assinado.');
  submeter('#form-encerrar', `/api/nucleo/atendimentos/${a.id}/encerrar`, 'Atendimento encerrado.');

  $('#evo-tipo')?.addEventListener('change', (e) => {
    $('#campo-retifica').hidden = e.target.value !== 'retificacao';
  });
}

const metrica = (rotulo, valor, unidade) => `
  <div class="metrica"><div class="rotulo">${esc(rotulo)}</div>
  <div class="valor">${esc(valor)}<span style="font-size:.7rem;color:var(--texto-2)"> ${esc(unidade)}</span></div></div>`;

// ------------------------------ pacientes ------------------------------
async function carregarSelectPacientes() {
  if (!podeUsuario('paciente:ler')) return;
  try {
    const lista = await api('/api/nucleo/pacientes');
    const select = $('#at-paciente');
    if (select) {
      select.innerHTML = lista.map((p) =>
        `<option value="${p.id}" ${p.atendimentos_abertos ? 'disabled' : ''}>
           ${esc(p.nome)} - ${cpfFormatado(p.cpf)}${p.atendimentos_abertos ? ' (ja em atendimento)' : ''}
         </option>`).join('');
    }
  } catch { /* select vazio e tratado pelo servidor na submissao */ }
}

async function carregarPacientes() {
  try {
    const lista = await api(`/api/nucleo/pacientes?busca=${encodeURIComponent($('#busca-paciente').value)}`);
    $('#lista-pacientes').innerHTML = lista.length ? `
      <table>
        <thead><tr><th>Nome</th><th>CPF</th><th>Nascimento</th><th></th></tr></thead>
        <tbody>${lista.map((p) => `
          <tr class="clicavel ${p.id === pacienteAberto ? 'selecionada' : ''}" data-id="${p.id}">
            <td><strong>${esc(p.nome)}</strong></td>
            <td class="mono">${cpfFormatado(p.cpf)}</td>
            <td class="nowrap">${esc(p.data_nascimento.split('-').reverse().join('/'))}</td>
            <td>${p.atendimentos_abertos ? '<span class="etq amarelo">Em atendimento</span>' : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="vazio">Nenhum paciente encontrado.</p>';

    $$('#lista-pacientes tr.clicavel').forEach((tr) =>
      tr.addEventListener('click', () => verPaciente(Number(tr.dataset.id))));
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

async function cadastrarPaciente(e) {
  e.preventDefault();
  try {
    const p = await api('/api/nucleo/pacientes', { method: 'POST', corpo: dadosDoFormulario(e.target) });
    e.target.reset();
    aviso($('#aviso-paciente'), `Paciente ${p.nome} cadastrado (#${p.id}).`, 'sucesso');
    await Promise.all([carregarPacientes(), carregarSelectPacientes()]);
    verPaciente(p.id);
  } catch (erro) { aviso($('#aviso-paciente'), erro); }
}

async function verPaciente(id) {
  pacienteAberto = id;
  try {
    const p = await api(`/api/nucleo/pacientes/${id}`);
    const atendimentos = await api(`/api/nucleo/atendimentos?status=&paciente_id=${id}`);

    $('#detalhe-paciente').innerHTML = `
      <div class="cartao">
        <div class="cabecalho"><h3 class="cresce">${esc(p.nome)}</h3>
          <span class="etq neutro">${p.idade} anos</span></div>
        <p class="discreto" style="margin:.2rem 0">
          CPF ${cpfFormatado(p.cpf)} &middot; ${esc(p.data_nascimento.split('-').reverse().join('/'))}
          ${p.tipo_sanguineo ? `&middot; Sangue ${esc(p.tipo_sanguineo)}` : ''}<br>
          ${esc(p.telefone ?? '')} ${p.endereco ? `&middot; ${esc(p.endereco)}` : ''}
        </p>

        <h3 style="margin-top:1rem">Alergias</h3>
        ${p.alergias.length
          ? p.alergias.map((a) => `<div style="margin-bottom:.3rem">
              <span class="etq ${a.gravidade === 'grave' ? 'vermelho' : a.gravidade === 'moderada' ? 'laranja' : 'amarelo'}">${esc(a.substancia)}</span>
              <span class="discreto">${esc(a.gravidade)}${a.observacao ? ` - ${esc(a.observacao)}` : ''}</span></div>`).join('')
          : '<p class="discreto">Nenhuma alergia registrada.</p>'}

        ${podeUsuario('alergia:registrar') ? `
          <form id="form-alergia" style="margin-top:.6rem">
            <div class="linha">
              <div><label>Substancia</label><input name="substancia" required></div>
              <div><label>Gravidade</label>
                <select name="gravidade"><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="grave">Grave</option></select></div>
            </div>
            <label>Observacao</label><input name="observacao">
            <button class="btn pequeno" style="margin-top:.6rem" type="submit">Registrar alergia</button>
          </form>
          <div id="aviso-alergia" class="aviso" style="margin-top:.5rem"></div>` : ''}

        <h3 style="margin-top:1rem">Historico de atendimentos</h3>
        ${atendimentos.length ? `
          <table><tbody>${atendimentos.map((a) => `
            <tr><td>${etiquetaTriagem(a.classificacao_risco)}</td>
              <td>${esc(a.queixa_principal.slice(0, 45))}<div class="discreto">${dataHora(a.aberto_em)}</div></td>
              <td><span class="etq neutro">${esc(titulo(a.status))}</span></td></tr>`).join('')}
          </tbody></table>` : '<p class="discreto">Sem atendimentos anteriores.</p>'}
      </div>`;

    $('#form-alergia')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/nucleo/pacientes/${id}/alergias`, { method: 'POST', corpo: dadosDoFormulario(e.target) });
        verPaciente(id);
      } catch (erro) { aviso($('#aviso-alergia'), erro); }
    });
  } catch (erro) { aviso($('#aviso-global'), erro); }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
