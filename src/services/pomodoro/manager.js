/**
 * Pomodoro manager — mantiene sesiones activas en memoria.
 * Si el bot reinicia, las sesiones se pierden (aceptable para uso personal).
 *
 * Una sesión de Pomodoro tiene:
 *   - workMinutes: minutos de foco (default 25)
 *   - breakMinutes: minutos de descanso (default 5)
 *   - rounds: cuántas rondas trabajo+descanso (default 4)
 *   - currentRound: ronda actual (1, 2, ...)
 *   - type: 'work' | 'break'
 *   - endTime: timestamp de cuándo termina el bloque actual
 *   - timeoutId: handle del setTimeout activo
 */

import { sendText } from '../whatsapp/client.js';

const sessions = new Map(); // jid → session

export function isInPomodoro(jid) {
  return sessions.has(jid);
}

export function getPomodoro(jid) {
  const s = sessions.get(jid);
  if (!s) return null;

  const remainingMs = Math.max(0, s.endTime - Date.now());
  const remainingMin = Math.ceil(remainingMs / 60000);

  return {
    type: s.type,
    currentRound: s.currentRound,
    totalRounds: s.rounds,
    remainingMin,
    workMinutes: s.workMinutes,
    breakMinutes: s.breakMinutes,
  };
}

export async function startPomodoro(jid, workMinutes = 25, breakMinutes = 5, rounds = 4) {
  if (sessions.has(jid)) {
    return { error: 'ya-activa', existing: getPomodoro(jid) };
  }

  const session = {
    jid,
    workMinutes,
    breakMinutes,
    rounds,
    currentRound: 1,
    type: 'work',
    endTime: Date.now() + workMinutes * 60 * 1000,
    timeoutId: null,
  };

  sessions.set(jid, session);
  scheduleEnd(jid);

  return { started: true, session: getPomodoro(jid) };
}

export function stopPomodoro(jid) {
  const s = sessions.get(jid);
  if (!s) return false;
  if (s.timeoutId) clearTimeout(s.timeoutId);
  sessions.delete(jid);
  return true;
}

/* ============================================================
 *  Interno
 * ============================================================ */

function scheduleEnd(jid) {
  const s = sessions.get(jid);
  if (!s) return;

  const delay = Math.max(0, s.endTime - Date.now());

  s.timeoutId = setTimeout(async () => {
    try {
      await handleEnd(jid);
    } catch (err) {
      console.error('❌ Error en pomodoro:', err.message);
      stopPomodoro(jid);
    }
  }, delay);
}

async function handleEnd(jid) {
  const s = sessions.get(jid);
  if (!s) return;

  if (s.type === 'work') {
    // Terminó un bloque de foco
    if (s.currentRound >= s.rounds) {
      await sendText(
        jid,
        `🎉 *¡Terminaste tus ${s.rounds} rondas!*\n\nTotal: ${s.rounds * s.workMinutes} min de estudio. Descansa bien, te lo mereces 💪`
      );
      stopPomodoro(jid);
      return;
    }

    // Pasar a descanso
    s.type = 'break';
    s.endTime = Date.now() + s.breakMinutes * 60 * 1000;
    await sendText(
      jid,
      `✅ Ronda ${s.currentRound}/${s.rounds} completada.\n\n☕ Descansa ${s.breakMinutes} min. Te aviso cuando toque la siguiente.`
    );
    scheduleEnd(jid);
    return;
  }

  // Terminó el descanso → siguiente ronda
  s.currentRound++;
  s.type = 'work';
  s.endTime = Date.now() + s.workMinutes * 60 * 1000;
  await sendText(
    jid,
    `⏱️ *Ronda ${s.currentRound}/${s.rounds}* — ${s.workMinutes} min de foco. ¡Vamos! 💪`
  );
  scheduleEnd(jid);
}