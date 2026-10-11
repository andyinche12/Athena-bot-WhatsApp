/**
 * Quiz manager — mantiene quizzes activos en memoria.
 * Un quiz tiene N preguntas. Athena pregunta una a la vez y espera respuesta.
 *
 * Estado:
 *   - chatId
 *   - flashcards: array de {id, question, answer}
 *   - currentIndex: índice actual
 *   - results: array de {id, correct}
 *   - awaitingAnswer: bool (esperando respuesta del usuario)
 */

const activeQuizzes = new Map(); // jid → quiz

export function hasActiveQuiz(jid) {
  return activeQuizzes.has(jid);
}

export function getActiveQuiz(jid) {
  return activeQuizzes.get(jid) || null;
}

export function startQuiz(jid, flashcards) {
  const quiz = {
    jid,
    flashcards,
    currentIndex: 0,
    results: [],
  };
  activeQuizzes.set(jid, quiz);
  return quiz;
}

export function endQuiz(jid) {
  const quiz = activeQuizzes.get(jid);
  activeQuizzes.delete(jid);
  return quiz;
}

/**
 * Verifica la respuesta del usuario.
 * Compara en modo flexible: sin acentos, minúsculas, sin puntuación.
 * @returns {{ correct: boolean, similarity: number, expected: string }}
 */
export function checkAnswer(userAnswer, expectedAnswer) {
  const normalize = (s) => {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quitar acentos
      .replace(/[.,;:!?¡¿"()]/g, '')   // quitar puntuación
      .replace(/\s+/g, ' ')
      .trim();
  };

  const user = normalize(userAnswer);
  const expected = normalize(expectedAnswer);

  if (!user || !expected) {
    return { correct: false, similarity: 0, expected: expectedAnswer };
  }

  // Match exacto o contenido
  if (user === expected) {
    return { correct: true, similarity: 1, expected: expectedAnswer };
  }

  // Si la respuesta esperada contiene la respuesta del usuario (y es suficientemente larga)
  if (user.length >= 3 && expected.includes(user)) {
    return { correct: true, similarity: 0.8, expected: expectedAnswer };
  }

  // Si la respuesta del usuario contiene la esperada (y es suficientemente larga)
  if (expected.length >= 3 && user.includes(expected)) {
    return { correct: true, similarity: 0.8, expected: expectedAnswer };
  }

  // Calcular similitud por palabras compartidas
  const userWords = new Set(user.split(' ').filter((w) => w.length > 3));
  const expWords = new Set(expected.split(' ').filter((w) => w.length > 3));

  if (userWords.size === 0 || expWords.size === 0) {
    return { correct: false, similarity: 0, expected: expectedAnswer };
  }

  const intersection = [...userWords].filter((w) => expWords.has(w));
  const similarity = intersection.length / Math.max(userWords.size, expWords.size);

  // Considerar correcto si comparten al menos 60% de palabras clave
  return {
    correct: similarity >= 0.6,
    similarity,
    expected: expectedAnswer,
  };
}

export function nextQuestion(jid) {
  const quiz = activeQuizzes.get(jid);
  if (!quiz) return null;

  if (quiz.currentIndex >= quiz.flashcards.length) {
    return null; // ya no hay más
  }

  const flashcard = quiz.flashcards[quiz.currentIndex];
  return {
    flashcard,
    index: quiz.currentIndex + 1,
    total: quiz.flashcards.length,
  };
}

export function recordAnswer(jid, correct) {
  const quiz = activeQuizzes.get(jid);
  if (!quiz) return;

  const current = quiz.flashcards[quiz.currentIndex];
  quiz.results.push({ id: current.id, correct });
  quiz.currentIndex++;
}

export function getQuizSummary(jid) {
  const quiz = activeQuizzes.get(jid);
  if (!quiz) return null;

  const correct = quiz.results.filter((r) => r.correct).length;
  const total = quiz.results.length;

  return {
    correct,
    total,
    percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
    wrongIds: quiz.results.filter((r) => !r.correct).map((r) => r.id),
  };
}