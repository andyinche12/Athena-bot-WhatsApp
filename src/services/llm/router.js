import pino from 'pino';
import { config } from '../../config/env.js';
import {
  chatGroq,
  chatGemini,
  chatNvidia,
  chatOpenRouter,
} from './providers.js';

const logger = pino({ level: config.logLevel });

// Orden de intentos: rápido → respaldo → último recurso
const CHAIN = [
  { name: 'groq', fn: chatGroq },
  { name: 'nvidia', fn: chatNvidia },
  { name: 'gemini', fn: chatGemini },
  { name: 'openrouter', fn: chatOpenRouter },
];

/**
 * Envía mensajes al primer proveedor disponible.
 * Si falla, prueba el siguiente de la cadena.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {Object} opts
 *   - preferred?: 'groq' | 'nvidia' | 'gemini' | 'openrouter'
 *   - model?: string  (override del modelo por defecto del provider)
 *   - jsonMode?: boolean  (fuerza response_format=json_object)
 *   - maxTokens?: number
 *   - temperature?: number
 * @returns {Promise<{text:string, provider:string, model:string, usage:object}>}
 */
export async function askLLM(messages, opts = {}) {
  let chain = [...CHAIN];

  // Si el usuario pide un proveedor concreto, se pone primero
  if (opts.preferred) {
    const idx = chain.findIndex((p) => p.name === opts.preferred);
    if (idx > 0) {
      const [first] = chain.splice(idx, 1);
      chain.unshift(first);
    }
  }

  const errors = [];

  for (const provider of chain) {
    try {
      const t0 = Date.now();
      logger.info(`🤖 Intentando ${provider.name}...`);

      // Pasa opts completo al provider (jsonMode, maxTokens, temperature)
      const result = await provider.fn(messages, opts.model, opts);

      const ms = Date.now() - t0;
      logger.info(
        `✅ ${provider.name} respondió en ${ms}ms (modelo: ${result.model})`
      );
      return result;
    } catch (err) {
      const msg = err?.message || String(err);
      logger.warn(`⚠️  ${provider.name} falló: ${msg}`);
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  logger.error('❌ Todos los proveedores fallaron');
  throw new Error(`Todos los LLMs fallaron:\n${errors.join('\n')}`);
}

/**
 * Prueba un proveedor específico con un prompt simple.
 * Útil para el comando !ping
 */
export async function pingProvider(name) {
  const provider = CHAIN.find((p) => p.name === name);
  if (!provider) throw new Error(`Proveedor desconocido: ${name}`);

  const t0 = Date.now();
  const r = await provider.fn(
    [{ role: 'user', content: 'Responde solo: OK' }],
    undefined,
    { maxTokens: 20, temperature: 0 }
  );
  const ms = Date.now() - t0;
  return { provider: name, model: r.model, ms, text: r.text };
}

export const PROVIDERS_AVAILABLE = CHAIN.map((p) => p.name);