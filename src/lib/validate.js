import { erroRequisicao } from './errors.js';

/**
 * Validacao declarativa de payloads.
 * Regra do nucleo regulado: nenhuma escrita entra sem esquema validado.
 */
export function validar(dados, esquema) {
  const erros = [];
  const saida = {};

  for (const [campo, regra] of Object.entries(esquema)) {
    const valor = dados?.[campo];
    const ausente = valor === undefined || valor === null || valor === '';

    if (ausente) {
      if (regra.obrigatorio) erros.push(`'${campo}' e obrigatorio`);
      else if (regra.padrao !== undefined) saida[campo] = regra.padrao;
      continue;
    }

    switch (regra.tipo) {
      case 'numero': {
        const n = Number(valor);
        if (Number.isNaN(n)) { erros.push(`'${campo}' deve ser numerico`); continue; }
        if (regra.min !== undefined && n < regra.min) erros.push(`'${campo}' deve ser >= ${regra.min}`);
        if (regra.max !== undefined && n > regra.max) erros.push(`'${campo}' deve ser <= ${regra.max}`);
        saida[campo] = n;
        break;
      }
      case 'booleano':
        saida[campo] = valor === true || valor === 'true' || valor === 1 ? 1 : 0;
        break;
      case 'data':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) erros.push(`'${campo}' deve estar no formato AAAA-MM-DD`);
        else saida[campo] = String(valor);
        break;
      default: {
        const s = String(valor).trim();
        if (regra.min && s.length < regra.min) erros.push(`'${campo}' deve ter ao menos ${regra.min} caracteres`);
        if (regra.max && s.length > regra.max) erros.push(`'${campo}' deve ter no maximo ${regra.max} caracteres`);
        if (regra.opcoes && !regra.opcoes.includes(s)) erros.push(`'${campo}' deve ser um de: ${regra.opcoes.join(', ')}`);
        if (regra.regex && !regra.regex.test(s)) erros.push(`'${campo}' esta em formato invalido`);
        saida[campo] = s;
      }
    }
  }

  if (erros.length) throw erroRequisicao('Dados invalidos.', erros);
  return saida;
}

/** Valida CPF pelos digitos verificadores (nao apenas formato). */
export function cpfValido(cpf) {
  const d = String(cpf).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(d.slice(0, 9), 10) === Number(d[9]) && digito(d.slice(0, 10), 11) === Number(d[10]);
}

export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
