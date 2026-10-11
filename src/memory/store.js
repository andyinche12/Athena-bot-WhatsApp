import { db } from './db.js';
import { config } from '../config/env.js';

// ---------- MENSAJES ----------

/**
 * Guarda un mensaje en el historial.
 */
export function saveMessage(chatId, role, content, meta = {}) {
  const stmt = db.prepare(`
    INSERT INTO messages (chat_id, role, content, provider, model, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    chatId,
    role,
    content,
    meta.provider || null,
    meta.model || null,
    Date.now()
  );
}

/**
 * Devuelve los últimos N mensajes de un chat (en orden cronológico).
 * Ideal para pasarlos al LLM como contexto.
 */
export function getRecentMessages(chatId, limit = config.memoryMaxShortTerm) {
  const stmt = db.prepare(`
    SELECT role, content FROM messages
    WHERE chat_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  const rows = stmt.all(chatId, limit);
  return rows.reverse(); // orden cronológico ascendente
}

/**
 * Cuántos mensajes tiene un chat.
 */
export function countMessages(chatId) {
  const stmt = db.prepare(`SELECT COUNT(*) as n FROM messages WHERE chat_id = ?`);
  return stmt.get(chatId).n;
}

/**
 * Borra el historial de un chat (útil para !reset).
 */
export function clearHistory(chatId) {
  const stmt = db.prepare(`DELETE FROM messages WHERE chat_id = ?`);
  return stmt.run(chatId).changes;
}

// ---------- HECHOS ----------

export function saveFact(chatId, fact, category = 'general') {
  const stmt = db.prepare(`
    INSERT INTO facts (chat_id, fact, category, created_at)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(chatId, fact, category, Date.now());
}

export function getFacts(chatId) {
  const stmt = db.prepare(`
    SELECT fact, category FROM facts
    WHERE chat_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(chatId);
}

// ---------- TAREAS ----------

export function createTask(chatId, { title, description = null, course = null, dueDate = null }) {
  const stmt = db.prepare(`
    INSERT INTO tasks (chat_id, title, description, course, due_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(chatId, title, description, course, dueDate, Date.now());
  return result.lastInsertRowid;
}

export function getPendingTasks(chatId) {
  const stmt = db.prepare(`
    SELECT id, title, description, course, due_date, created_at
    FROM tasks
    WHERE chat_id = ? AND status = 'pending'
    ORDER BY
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
      due_date ASC,
      created_at DESC
  `);
  return stmt.all(chatId);
}

export function completeTask(taskId) {
  const stmt = db.prepare(`
    UPDATE tasks SET status = 'done', completed_at = ?
    WHERE id = ?
  `);
  return stmt.run(Date.now(), taskId).changes;
}

// ---------- RECORDATORIOS ----------

export function createReminder(chatId, text, remindAt) {
  const stmt = db.prepare(`
    INSERT INTO reminders (chat_id, text, remind_at, created_at)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(chatId, text, remindAt, Date.now()).lastInsertRowid;
}

export function getPendingReminders() {
  const stmt = db.prepare(`
    SELECT id, chat_id, text, remind_at
    FROM reminders
    WHERE sent = 0 AND remind_at <= ?
    ORDER BY remind_at ASC
  `);
  return stmt.all(new Date().toISOString());
}

export function markReminderSent(id) {
  const stmt = db.prepare(`UPDATE reminders SET sent = 1 WHERE id = ?`);
  return stmt.run(id).changes;
}

// ---------- ESTADÍSTICAS ----------

export function getStats(chatId) {
  return {
    messages: countMessages(chatId),
    facts: db.prepare(`SELECT COUNT(*) as n FROM facts WHERE chat_id = ?`).get(chatId).n,
    pendingTasks: db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE chat_id = ? AND status = 'pending'`).get(chatId).n,
  };
}

// ---------- CONFIRMACIONES DE ESTUDIO ----------

export function createStudyConfirmation(chatId, courseKey, studyDate) {
  const stmt = db.prepare(`
    INSERT INTO study_confirmations (chat_id, course_key, study_date, asked_at)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(chatId, courseKey, studyDate, Date.now()).lastInsertRowid;
}

export function getPendingStudyConfirmation(chatId) {
  const stmt = db.prepare(`
    SELECT id, course_key, study_date
    FROM study_confirmations
    WHERE chat_id = ? AND responded_at IS NULL
    ORDER BY asked_at DESC
    LIMIT 1
  `);
  return stmt.get(chatId);
}

export function answerStudyConfirmation(id, studied) {
  const stmt = db.prepare(`
    UPDATE study_confirmations
    SET responded_at = ?, studied = ?
    WHERE id = ?
  `);
  return stmt.run(Date.now(), studied ? 1 : 0, id).changes;
}

export function getStudyStats(chatId, days = 30) {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN studied = 1 THEN 1 ELSE 0 END) as studied
    FROM study_confirmations
    WHERE chat_id = ?
      AND responded_at IS NOT NULL
      AND asked_at >= ?
  `);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return stmt.get(chatId, since) || { total: 0, studied: 0 };
}