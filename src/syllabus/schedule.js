import { readFileSync } from 'fs';
import { join } from 'path';

const schedulePath = join(process.cwd(), 'data', 'schedule.json');
const schedule = JSON.parse(readFileSync(schedulePath, 'utf-8'));

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DAYS_LABEL = {
  lunes: 'Lunes',
  martes: 'Martes',
  miercoles: 'Miércoles',
  jueves: 'Jueves',
  viernes: 'Viernes',
};

/**
 * Obtiene las clases de un día específico (0=domingo, 1=lunes...).
 */
export function getClassesForDay(dayIndex) {
  const dayKey = DAYS_ES[dayIndex];
  const blocks = schedule.week[dayKey] || [];
  return blocks.map((b) => ({
    ...b,
    course: schedule.courses[b.courseKey],
    dayKey,
    dayLabel: DAYS_LABEL[dayKey] || dayKey,
  }));
}

/**
 * Devuelve las clases de hoy.
 */
export function getToday() {
  return getClassesForDay(new Date().getDay());
}

/**
 * Devuelve las clases de mañana.
 */
export function getTomorrow() {
  return getClassesForDay((new Date().getDay() + 1) % 7);
}

/**
 * Devuelve toda la semana.
 */
export function getWeek() {
  return ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].map((dayKey) => ({
    dayKey,
    dayLabel: DAYS_LABEL[dayKey],
    classes: getClassesForDay(DAYS_ES.indexOf(dayKey)),
  }));
}

/**
 * Devuelve la siguiente clase desde ahora.
 */
export function getNextClass() {
  const now = new Date();
  const today = new Date().getDay();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Buscar en hoy
  const todayClasses = getClassesForDay(today);
  for (const c of todayClasses) {
    if (c.end > currentTime) return { ...c, when: 'hoy' };
  }

  // Buscar en los días siguientes (hasta 7 días)
  for (let i = 1; i <= 7; i++) {
    const nextDay = (today + i) % 7;
    const classes = getClassesForDay(nextDay);
    if (classes.length > 0) {
      return {
        ...classes[0],
        when: i === 1 ? 'mañana' : DAYS_LABEL[DAYS_ES[nextDay]],
      };
    }
  }

  return null;
}

export { schedule };