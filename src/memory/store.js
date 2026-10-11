import { supabase } from './db.js';
import { config } from '../config/env.js';

// ============================================================
//  MENSAJES
// ============================================================

export async function saveMessage(chatId, role, content, meta = {}) {
  const { error } = await supabase.from('athena_messages').insert({
    chat_id: chatId,
    role,
    content,
    provider: meta.provider || null,
    model: meta.model || null,
    timestamp: Date.now(),
  });
  if (error) console.error('saveMessage error:', error.message);
}

export async function getRecentMessages(chatId, limit = config.memoryMaxShortTerm) {
  const { data, error } = await supabase
    .from('athena_messages')
    .select('role, content, timestamp')
    .eq('chat_id', chatId)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getRecentMessages error:', error.message);
    return [];
  }

  return (data || []).reverse().map(({ role, content }) => ({ role, content }));
}

export async function countMessages(chatId) {
  const { count, error } = await supabase
    .from('athena_messages')
    .select('*', { count: 'exact', head: true })
    .eq('chat_id', chatId);

  if (error) return 0;
  return count || 0;
}

export async function clearHistory(chatId) {
  const { error } = await supabase
    .from('athena_messages')
    .delete()
    .eq('chat_id', chatId);

  if (error) return 0;
  return 1; // no podemos saber cuántas se borraron exactamente sin un select previo
}

// ============================================================
//  HECHOS
// ============================================================

export async function saveFact(chatId, fact, category = 'general') {
  const { error } = await supabase.from('athena_facts').insert({
    chat_id: chatId,
    fact,
    category,
    created_at: Date.now(),
  });
  if (error) console.error('saveFact error:', error.message);
}

export async function getFacts(chatId) {
  const { data, error } = await supabase
    .from('athena_facts')
    .select('fact, category')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

// ============================================================
//  TAREAS
// ============================================================

export async function createTask(chatId, { title, description = null, course = null, dueDate = null }) {
  const { data, error } = await supabase
    .from('athena_tasks')
    .insert({
      chat_id: chatId,
      title,
      description,
      course,
      due_date: dueDate,
      created_at: Date.now(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('createTask error:', error.message);
    return null;
  }
  return data?.id;
}

export async function getPendingTasks(chatId) {
  const { data, error } = await supabase
    .from('athena_tasks')
    .select('id, title, description, course, due_date, created_at')
    .eq('chat_id', chatId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function completeTask(taskId) {
  const { error } = await supabase
    .from('athena_tasks')
    .update({ status: 'done', completed_at: Date.now() })
    .eq('id', taskId);

  if (error) return 0;
  return 1;
}

// ============================================================
//  RECORDATORIOS
// ============================================================

export async function createReminder(chatId, text, remindAt) {
  const { data, error } = await supabase
    .from('athena_reminders')
    .insert({
      chat_id: chatId,
      text,
      remind_at: remindAt,
      created_at: Date.now(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('createReminder error:', error.message);
    return null;
  }
  return data?.id;
}

export async function getPendingReminders() {
  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from('athena_reminders')
    .select('id, chat_id, text, remind_at')
    .eq('sent', 0)
    .lte('remind_at', nowISO)
    .order('remind_at', { ascending: true });

  if (error) return [];
  return data || [];
}

export async function markReminderSent(id) {
  const { error } = await supabase
    .from('athena_reminders')
    .update({ sent: 1 })
    .eq('id', id);

  if (error) return 0;
  return 1;
}

// ============================================================
//  CONFIRMACIONES DE ESTUDIO
// ============================================================

export async function createStudyConfirmation(chatId, courseKey, studyDate) {
  const { data, error } = await supabase
    .from('athena_study_confirmations')
    .insert({
      chat_id: chatId,
      course_key: courseKey,
      study_date: studyDate,
      asked_at: Date.now(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('createStudyConfirmation error:', error.message);
    return null;
  }
  return data?.id;
}

export async function getPendingStudyConfirmation(chatId) {
  const { data, error } = await supabase
    .from('athena_study_confirmations')
    .select('id, course_key, study_date')
    .eq('chat_id', chatId)
    .is('responded_at', null)
    .order('asked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function answerStudyConfirmation(id, studied) {
  const { error } = await supabase
    .from('athena_study_confirmations')
    .update({
      responded_at: Date.now(),
      studied: studied ? 1 : 0,
    })
    .eq('id', id);

  if (error) return 0;
  return 1;
}

export async function getStudyStats(chatId, days = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const { data, error } = await supabase
    .from('athena_study_confirmations')
    .select('studied')
    .eq('chat_id', chatId)
    .not('responded_at', 'is', null)
    .gte('asked_at', since);

  if (error) return { total: 0, studied: 0 };

  const total = data?.length || 0;
  const studied = (data || []).filter((r) => r.studied === 1).length;

  return { total, studied };
}

// ============================================================
//  ESTADÍSTICAS
// ============================================================

export async function getStats(chatId) {
  const [messages, factsRes, tasksRes] = await Promise.all([
    countMessages(chatId),
    supabase
      .from('athena_facts')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId),
    supabase
      .from('athena_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('status', 'pending'),
  ]);

  return {
    messages,
    facts: factsRes.count || 0,
    pendingTasks: tasksRes.count || 0,
  };
}

/* ============================================================
 *  FLASHCARDS
 * ============================================================ */

export async function createFlashcard(chatId, question, answer, course = null) {
  const { data, error } = await supabase
    .from('athena_flashcards')
    .insert({
      chat_id: chatId,
      question,
      answer,
      course,
      created_at: Date.now(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('createFlashcard error:', error.message);
    return null;
  }
  return data?.id;
}

export async function getFlashcards(chatId) {
  const { data, error } = await supabase
    .from('athena_flashcards')
    .select('id, question, answer, course, times_shown, times_right, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function getRandomFlashcards(chatId, count = 5) {
  // Traer todas y elegir aleatoriamente en cliente
  // (Supabase no tiene ORDER BY RANDOM() nativo por API, pero con
  //  <1000 flashcards el costo es mínimo)
  const all = await getFlashcards(chatId);
  if (all.length === 0) return [];

  // Mezclar
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, all.length));
}

export async function updateFlashcardStats(id, wasCorrect) {
  // Incrementar contadores
  const { data: current, error: err1 } = await supabase
    .from('athena_flashcards')
    .select('times_shown, times_right')
    .eq('id', id)
    .single();

  if (err1 || !current) return false;

  const { error } = await supabase
    .from('athena_flashcards')
    .update({
      times_shown: (current.times_shown || 0) + 1,
      times_right: (current.times_right || 0) + (wasCorrect ? 1 : 0),
      last_shown: Date.now(),
    })
    .eq('id', id);

  return !error;
}

export async function deleteFlashcard(id) {
  const { error } = await supabase
    .from('athena_flashcards')
    .delete()
    .eq('id', id);

  return !error;
}

export async function getFlashcardStats(chatId) {
  const all = await getFlashcards(chatId);
  const total = all.length;
  const mastered = all.filter(
    (c) => c.times_shown >= 3 && c.times_right / c.times_shown >= 0.8
  ).length;

  return { total, mastered, toReview: total - mastered };
}

/* ============================================================
 *  GASTOS
 * ============================================================ */

export async function createExpense(chatId, { amount, description, category }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('athena_expenses')
    .insert({
      chat_id: chatId,
      amount,
      description,
      category,
      date: today,
      created_at: Date.now(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('createExpense error:', error.message);
    return null;
  }
  return data?.id;
}

export async function getExpenses(chatId, filter = {}) {
  let query = supabase
    .from('athena_expenses')
    .select('id, amount, description, category, date, created_at')
    .eq('chat_id', chatId);

  if (filter.date) query = query.eq('date', filter.date);
  if (filter.fromDate) query = query.gte('date', filter.fromDate);
  if (filter.toDate) query = query.lte('date', filter.toDate);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function getExpensesSum(chatId, filter = {}) {
  const exps = await getExpenses(chatId, filter);
  const total = exps.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCategory = {};
  for (const e of exps) {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  }
  return { total, count: exps.length, byCategory, expenses: exps };
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('athena_expenses').delete().eq('id', id);
  return !error;
}