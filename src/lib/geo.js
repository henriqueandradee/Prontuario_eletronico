const RAIO_TERRA_KM = 6371;
const rad = (g) => (g * Math.PI) / 180;

/** Distancia em km entre dois pontos (formula de Haversine). */
export function distanciaKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return RAIO_TERRA_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimativa de tempo de chegada em minutos.
 * Velocidade media urbana com sirene: 45 km/h, mais 1,5 min de acionamento.
 */
export function etaMinutos(km) {
  return Math.max(1, Math.round((km / 45) * 60 + 1.5));
}
