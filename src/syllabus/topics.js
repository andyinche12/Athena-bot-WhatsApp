import { readFileSync } from 'fs';
import { join } from 'path';

const syllabusPath = join(process.cwd(), 'data', 'syllabus.json');
const syllabus = JSON.parse(readFileSync(syllabusPath, 'utf-8'));

/**
 * Devuelve la semana académica actual (1-17).
 * SEM-01: 24/08 al 28/08
 * Cada semana = 7 días desde el 24/08.
 */
export function getCurrentWeek() {
  const startDate = new Date('2026-08-24T00:00:00-05:00'); // hora Perú
  const now = new Date();
  const diffMs = now - startDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(17, week));
}

/**
 * Devuelve el tema de un curso para una semana específica.
 */
export function getTopicForWeek(courseKey, week) {
  const course = syllabus.courses[courseKey];
  if (!course) return null;

  const topic = course.topics[String(week)];
  if (!topic) return null;

  return {
    courseKey,
    courseName: course.name,
    week,
    weekRange: syllabus.weeks[String(week)] || '',
    topic: topic.topic,
  };
}

/**
 * Devuelve el tema del próximo lunes para todos los cursos.
 * Útil para el recordatorio del domingo.
 */
export function getNextWeekTopics() {
  const nextWeek = getCurrentWeek() + 1;
  const result = [];

  for (const [key, course] of Object.entries(syllabus.courses)) {
    const topic = course.topics[String(nextWeek)];
    if (topic) {
      result.push({
        courseKey: key,
        courseName: course.name,
        week: nextWeek,
        topic: topic.topic,
      });
    }
  }

  return { week: nextWeek, range: syllabus.weeks[String(nextWeek)], courses: result };
}

/**
 * Devuelve info del curso + tema de la semana actual.
 */
export function getCourseWithTopic(courseKey) {
  const week = getCurrentWeek();
  return getTopicForWeek(courseKey, week);
}

export { syllabus };