import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/env.js';

// ---------- Clientes OpenAI-compatibles ----------

const groqClient = config.groqApiKey
  ? new OpenAI({
      apiKey: config.groqApiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;

const nvidiaClient = config.nvidiaApiKey
  ? new OpenAI({
      apiKey: config.nvidiaApiKey,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    })
  : null;

const openrouterClient = config.openrouterApiKey
  ? new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/athena-bot',
        'X-Title': 'Athena Bot WhatsApp',
      },
    })
  : null;

const geminiClient = config.geminiApiKey
  ? new GoogleGenAI({ apiKey: config.geminiApiKey })
  : null;

// ---------- Modelos por defecto ----------

const MODELS = {
  groq: 'openai/gpt-oss-120b', 
  nvidia: 'nvidia/nemotron-3-ultra-550b-a55b',
  openrouter: 'openrouter/free',
  gemini: 'gemini-3.5-flash-lite',
};

// ---------- Funciones de chat por proveedor ----------

export async function chatGroq(messages, model = MODELS.groq) {
  if (!groqClient) throw new Error('GROQ_API_KEY no configurada');
  const r = await groqClient.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  });
  return {
    text: r.choices[0]?.message?.content?.trim() || '',
    provider: 'groq',
    model,
    usage: r.usage,
  };
}

export async function chatNvidia(messages, model = MODELS.nvidia) {
  if (!nvidiaClient) throw new Error('NVIDIA_API_KEY no configurada');
  const r = await nvidiaClient.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  });
  return {
    text: r.choices[0]?.message?.content?.trim() || '',
    provider: 'nvidia',
    model,
    usage: r.usage,
  };
}

export async function chatOpenRouter(messages, model = MODELS.openrouter) {
  if (!openrouterClient) throw new Error('OPENROUTER_API_KEY no configurada');
  const r = await openrouterClient.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  });
  return {
    text: r.choices[0]?.message?.content?.trim() || '',
    provider: 'openrouter',
    model,
    usage: r.usage,
  };
}

export async function chatGemini(messages, model = MODELS.gemini) {
  if (!geminiClient) throw new Error('GEMINI_API_KEY no configurada');

  // Gemini usa "contents" con role: user | model
  const system = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const r = await geminiClient.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: system,
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });

  const text = r.text || r.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text: text.trim(), provider: 'gemini', model, usage: r.usageMetadata };
}

export const MODELS_DEFAULT = MODELS;