/**
 * Definición del "día de estudio" lógico de CrossedArts.
 *
 * ANTES: las consultas de "hoy" y de racha usaban `date('now')`, que en SQLite
 * significa UTC. Para un usuario en un huso horario negativo, una sesión de las
 * 23:30 locales se habría contabilizado en el día equivocado, y la racha podía
 * romperse o saltar un día justo en el límite de medianoche.
 *
 * AHORA (estrategia elegida y explícita): el día de estudio es el día calendario
 * LOCAL del reloj del usuario. No se introduce ningún framework de zonas
 * horarias: se deriva la fecha `YYYY-MM-DD` local en JavaScript y se pasa como
 * parámetro a consultas SQLite parametrizadas.
 *
 * Consecuencias deliberadas y documentadas:
 *  - Las marcas de tiempo persistidas (`datetime('now')`) siguen siendo UTC. No
 *    se migra ninguna fila existente: solo cambia cómo se las etiqueta al día.
 *  - El cálculo es determinista para una zona horaria dada y reproducible en
 *    tests (el offset se puede inyectar explícitamente).
 *  - No hay ambigüedad navegador/servidor: el backend no participa en estos KPI.
 */

/** Resultado de resolver el día calendario local a partir de un instante UTC. */
export interface LocalDayResolution {
  /** Día local en formato `YYYY-MM-DD`. */
  day: string;
  /**
   * Desplazamiento aplicado a la marca UTC para obtener el día local, como
   * modificador aceptado por las funciones de fecha de SQLite (p. ej. `'-240 minutes'`).
   */
  utcOffsetModifier: string;
}

/** Formatea un número de minutos como modificador de fecha de SQLite. */
function formatUtcOffsetModifier(offsetMinutes: number): string {
  if (offsetMinutes === 0) return '';
  const sign = offsetMinutes > 0 ? '+' : '-';
  return `${sign}${Math.abs(offsetMinutes)} minutes`;
}

/**
 * Normaliza un desfase por hora en formato `±HH:MM` (el que devuelve la API de
 * zonas horarias) a minutos con signo respecto a UTC.
 */
export function parseUtcOffsetToMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!match) throw new Error(`Desfase horario inválido: "${offset}" (se esperaba ±HH:MM).`);
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * Convierte un instante UTC a su día calendario local.
 *
 * El algoritmo es intencionadamente simple y determinista: se calcula el
 * desfase local en ese instante concreto (`getTimezoneOffset`), se aplica a la
 * marca UTC y se lee la parte de fecha. Aplicar el desfase en el instante (y no
 * un offset fijo del "ahora") mantiene el resultado correcto también a mitad de
 * un cambio de horario de verano.
 */
export function resolveLocalDay(now: Date = new Date(), utcOffset?: string): LocalDayResolution {
  let offsetMinutes: number;
  if (utcOffset !== undefined) {
    // Offset explícito: ruta determinista para tests y para entornos sin reloj local fiable.
    offsetMinutes = parseUtcOffsetToMinutes(utcOffset);
  } else {
    // `getTimezoneOffset()` devuelve minutos A RESTAR de la hora local, por eso el signo invertido.
    offsetMinutes = -now.getTimezoneOffset();
  }

  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const day = shifted.toISOString().slice(0, 10);
  return { day, utcOffsetModifier: formatUtcOffsetModifier(offsetMinutes) };
}

/**
 * Desplaza un día calendario `YYYY-MM-DD` un número de días, en UTC puro.
 *
 * Se trabaja sobre la cadena, no sobre un `Date` local, para que el cambio de
 * día no dependa del huso horario del proceso que ejecuta el test.
 */
export function shiftIsoDay(day: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Día inválido: "${day}" (se esperaba YYYY-MM-DD).`);
  }
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Día inválido: "${day}".`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Calcula la racha activa contando días consecutivos hacia atrás desde `today`.
 *
 * Función pura y determinista: recibe el conjunto de días de estudio y el día
 * local actual, y devuelve el número de días consecutivos. Si no hay actividad
 * hoy, se comprueba ayer (para que una racha abierta siga viva hasta que
 * termine el día); si tampoco hay actividad ayer, la racha es cero.
 */
export function computeActiveStreak(studyDays: Iterable<string>, today: string): number {
  const days = studyDays instanceof Set ? studyDays : new Set(studyDays);
  if (days.has(today)) {
    return countBackwards(days, today);
  }
  // Sin actividad hoy la racha sigue viva si hubo actividad ayer, y cuenta desde
  // ayer (no se le suma un día artificial).
  const yesterday = shiftIsoDay(today, -1);
  if (!days.has(yesterday)) return 0;
  return countBackwards(days, yesterday);
}

function countBackwards(days: Set<string>, fromDay: string): number {
  let streak = 0;
  let cursor = fromDay;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftIsoDay(cursor, -1);
  }
  return streak;
}