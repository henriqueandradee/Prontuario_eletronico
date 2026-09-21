import { env } from 'node:process';

export const config = {
  porta: Number(env.PORT ?? 3000),
  segredo: env.APP_SECRET ?? 'segredo-de-desenvolvimento-nao-usar-em-producao',
  dbPath: env.DB_PATH ?? './data/hospital.db',
  ambiente: env.NODE_ENV ?? 'development',
  // Versao do baseline de configuracao (docs/00-documento-de-contexto.md)
  baseline: 'CTX-1.0',
  versao: '1.0.0',
  tokenValidadeSegundos: 8 * 60 * 60, // turno de 8h
};

if (config.ambiente === 'production' && config.segredo.includes('desenvolvimento')) {
  throw new Error('APP_SECRET deve ser definido em producao.');
}
