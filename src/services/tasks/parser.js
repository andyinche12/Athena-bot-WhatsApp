/**
 * Parser simple de fechas en español.
 * Acepta frases como:
 *   "para el viernes", "para mañana", "para el lunes", "para el 15",
 *   "para el 15 de noviembre", "para hoy"
 */

const DAYS_ES = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

const MONTHS_ES = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

/**
 * Extrae la fecha de un texto.
 * @returns {{ cleanTitle: string, dueDate: string|null }}
 *   - cleanTitle: texto sin la parte de fecha
 *   - dueDate: ISO string YYYY-MM-DD o null
 */
export function parseTaskInput(input) {
  const original = input.trim();
  let work = original;
  let dueDate = null;

  const now = new Date();

  // Patrón: "para el X", "para X", "el X"
  const patterns = [
    // para el 15 de noviembre
    { re: /\bpara\s+el\s+(\d{1,2})\s+de\s+([a-záéíóú]+)/i, handler: (m) => {
      const day = parseInt(m[1], 10);
      const month = MONTHS_ES[m[2].toLowerCase()];
      if (month === undefined) return null;
      let year = now.getFullYear();
      // Si el mes ya pasó, usar el siguiente año
      if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) {
        year++;
      }
      return new Date(year, month, day);
    }},
    // para el lunes
    { re: /\bpara\s+el\s+([a-záéíóú]+)/i, handler: (m) => {
      const dayName = m[1].toLowerCase();
      const targetDay = DAYS_ES[dayName];
      if (targetDay === undefined) return null;
      const result = new Date(now);
      const diff = (targetDay - result.getDay() + 7) % 7 || 7;
      result.setDate(result.getDate() + diff);
      return result;
    }},
    // para mañana
    { re: /\bpara\s+mañana\b/i, handler: () => {
      const result = new Date(now);
      result.setDate(result.getDate() + 1);
      return result;
    }},
    // para hoy
    { re: /\bpara\s+hoy\b/i, handler: () => new Date(now) },
    // el 15 (día del mes actual)
    { re: /\bel\s+(\d{1,2})\b/, handler: (m) => {
      const day = parseInt(m[1], 10);
      if (day < 1 || day > 31) return null;
      const result = new Date(now);
      result.setDate(day);
      // Si ya pasó este mes, siguiente mes
      if (result < now) result.setMonth(result.getMonth() + 1);
      return result;
    }},
  ];

  for (const { re, handler } of patterns) {
    const m = work.match(re);
    if (m) {
      const date = handler(m);
      if (date) {
        dueDate = formatISO(date);
        work = work.replace(re, '').replace(/\s+/g, ' ').trim();
        break;
      }
    }
  }

  return { cleanTitle: work, dueDate };
}

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formatea una fecha ISO a algo legible.
 */
export function formatDueDate(isoDate) {
  if (!isoDate) return null;

  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  return `${days[date.getDay()]} ${d} de ${months[m - 1]}`;
}