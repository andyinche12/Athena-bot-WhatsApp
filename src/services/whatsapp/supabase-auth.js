import { createClient } from '@supabase/supabase-js';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { config } from '../../config/env.js';

const supabase = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// Timeout para operaciones de red
const NETWORK_TIMEOUT_MS = 8000;
// Reintentos para lecturas críticas
const READ_RETRIES = 3;

/**
 * Envuelve una promesa con timeout.
 */
function withTimeout(promise, ms, label = 'operación') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT en ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

export async function useSupabaseAuthState() {
  let lastSaveLog = 0;

  // ----- Leer una key con reintentos -----
  const readData = async (key, attempt = 1) => {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('baileys_auth')
          .select('data')
          .eq('id', key)
          .maybeSingle(),
        NETWORK_TIMEOUT_MS,
        `readData(${key})`
      );

      if (error) throw new Error(error.message);
      if (!data) return null;

      return JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
    } catch (err) {
      console.error(`   ⚠️  readData(${key}) intento ${attempt} falló:`, err.message);

      if (attempt < READ_RETRIES) {
        // Backoff exponencial: 500ms, 1000ms
        await new Promise((r) => setTimeout(r, attempt * 500));
        return readData(key, attempt + 1);
      }

      // Falló todos los intentos → LANZAR error (NO devolver null)
      throw new Error(`readData(${key}) falló después de ${READ_RETRIES} intentos: ${err.message}`);
    }
  };

  // ----- Escribir una key con reintentos -----
  const writeSingle = async (key, value, attempt = 1) => {
    try {
      const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
      const { error } = await withTimeout(
        supabase
          .from('baileys_auth')
          .upsert(
            { id: key, data: serialized, updated_at: new Date().toISOString() },
            { onConflict: 'id' }
          ),
        NETWORK_TIMEOUT_MS,
        `writeSingle(${key})`
      );

      if (error) throw new Error(error.message);
    } catch (err) {
      if (attempt < READ_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 500));
        return writeSingle(key, value, attempt + 1);
      }
      console.error(`   ❌ writeSingle(${key}) dio up después de ${READ_RETRIES} intentos`);
    }
  };

  // ----- Escribir varias keys en un batch -----
  const writeBatch = async (entries, verbose = false) => {
    if (entries.length === 0) return;

    try {
      const rows = entries.map(({ key, value }) => ({
        id: key,
        data: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
        updated_at: new Date().toISOString(),
      }));

      const { error, data } = await withTimeout(
        supabase
          .from('baileys_auth')
          .upsert(rows, { onConflict: 'id' })
          .select('id'),
        NETWORK_TIMEOUT_MS * 2,
        `writeBatch(${entries.length} filas)`
      );

      if (error) {
        console.error(`❌ Batch upsert error:`, error.message);
        // Fallback: uno por uno
        for (const entry of entries) {
          await writeSingle(entry.key, entry.value);
          await new Promise((r) => setTimeout(r, 100));
        }
      } else if (verbose) {
        console.log(`   ✅ Batch upsert: ${data?.length || entries.length} filas`);
      }
    } catch (err) {
      console.error(`❌ Batch falló:`, err.message);
      // Fallback
      for (const entry of entries) {
        await writeSingle(entry.key, entry.value);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };

  // ----- Borrar una key -----
  const removeData = async (key) => {
    try {
      await withTimeout(
        supabase.from('baileys_auth').delete().eq('id', key),
        NETWORK_TIMEOUT_MS,
        `removeData(${key})`
      );
    } catch (err) {
      console.error(`   ⚠️  removeData(${key}) falló:`, err.message);
    }
  };

  // ----- Cargar credenciales con lógica segura -----
  let creds;
  let credsStatus;

  try {
    const stored = await readData('creds');

    if (stored) {
      creds = stored;
      credsStatus = 'existentes';
    } else {
      // No hay creds guardadas → es la primera vez
      creds = initAuthCreds();
      credsStatus = 'nuevos (primera vez)';
    }
  } catch (err) {
    // 🔴 ERROR DE RED CRÍTICO: no podemos leer Supabase
    // NO caemos a initAuthCreds porque eso BORRARÍA la sesión
    console.error('❌ No se pudo leer creds de Supabase tras reintentos');
    console.error('   Detalle:', err.message);
    console.error('   Abortando inicialización para NO perder la sesión.');
    throw new Error('No se pudo leer la sesión de Supabase. Reintenta en unos segundos.');
  }

  console.log(`🔐 [AuthState] Creds cargados: ${credsStatus}`);

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            try {
              let value = await readData(`key-${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = { ...value };
              }
              data[id] = value;
            } catch (err) {
              // Si falla leer una key individual, devolvemos null sin tirar todo
              console.error(`   ⚠️  keys.get(${type}, ${id}) falló:`, err.message);
              data[id] = null;
            }
          }
          return data;
        },
        set: async (data) => {
          const toWrite = [];
          const toDelete = [];

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `key-${category}-${id}`;
              if (value) {
                toWrite.push({ key, value });
              } else {
                toDelete.push(key);
              }
            }
          }

          const categories = Object.keys(data);
          const importantCategories = [
            'creds', 'session', 'pre-key', 'sender-key', 'sender-key-memory',
            'app-state-sync-key', 'app-state-sync-version',
            'identity-key', 'device-list', 'tctoken',
          ];
          const isImportant = categories.some((c) =>
            importantCategories.includes(c)
          );

          if (isImportant && toWrite.length > 0) {
            console.log(
              `\n🔑 [keys.set] ${categories.join(', ')} → ${toWrite.length} escrituras`
            );
          }

          if (toWrite.length > 0) {
            await writeBatch(toWrite, isImportant);
          }

          if (toDelete.length > 0) {
            await Promise.all(toDelete.map((k) => removeData(k)));
          }
        },
      },
    },
    saveCreds: async () => {
      const now = Date.now();
      if (now - lastSaveLog > 5000) {
        console.log('💾 [saveCreds] Guardando credenciales...');
        lastSaveLog = now;
      }
      await writeSingle('creds', creds);
    },
  };
}