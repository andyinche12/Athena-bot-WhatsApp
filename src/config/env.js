import 'dotenv/config';

const required = [
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`⚠️  Faltan variables de entorno: ${missing.join(', ')}`);
}

/**
 * Convierte "51914443022,51933169038" → ["51914443022@s.whatsapp.net", ...]
 */
function parseOwners(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.includes('@') ? n : `${n}@s.whatsapp.net`));
}

/**
 * Convierte "3389215797354,123456789" → ["3389215797354@lid", ...]
 */
function parseLids(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.includes('@') ? n : `${n}@lid`));
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  timezone: process.env.TZ || 'America/Lima',

  // LLMs
  groqApiKey: process.env.GROQ_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
  defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'groq',
  defaultModel: process.env.DEFAULT_LLM_MODEL || 'openai/gpt-oss-120b',

  // Bot
  owners: parseOwners(process.env.OWNER_NUMBER),
  ownerLids: parseLids(process.env.OWNER_LID),
  replyDelayMin: parseInt(process.env.REPLY_DELAY_MIN || '3', 10),
  replyDelayMax: parseInt(process.env.REPLY_DELAY_MAX || '12', 10),

  // Memoria
  memoryDbPath: process.env.MEMORY_DB_PATH || './data/athena.db',
  memoryMaxShortTerm: parseInt(process.env.MEMORY_MAX_SHORT_TERM || '20', 10),

  // 🆕 Supabase (persistencia de sesión)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
};

// Delay anti-baneo con jitter
export function humanDelay() {
  const min = config.replyDelayMin * 1000;
  const max = config.replyDelayMax * 1000;
  return new Promise((resolve) =>
    setTimeout(resolve, min + Math.random() * (max - min))
  );
}

/**
 * Verifica si un JID es uno de los owners.
 * Acepta tanto @s.whatsapp.net (formato antiguo) como @lid (nuevo).
 */
export function isOwner(jid) {
  if (!jid) return false;
  return config.owners.includes(jid) || config.ownerLids.includes(jid);
}