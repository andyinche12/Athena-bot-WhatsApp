import { createClient } from '@supabase/supabase-js';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { config } from '../../config/env.js';

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

/**
 * Auth state de Baileys con Supabase.
 * Usa batch upsert para evitar rate limiting.
 * Solo loguea categorías importantes (evita spam de lid-mapping).
 */
export async function useSupabaseAuthState() {
  // Variable externa para controlar el log silencioso de saveCreds
  let lastSaveLog = 0;

  // ----- Leer una key -----
  const readData = async (key) => {
    try {
      const { data, error } = await supabase
        .from('baileys_auth')
        .select('data')
        .eq('id', key)
        .maybeSingle();

      if (error) {
        console.error(`Error leyendo ${key}:`, error.message);
        return null;
      }
      if (!data) return null;

      return JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
    } catch (err) {
      console.error(`Fetch error leyendo ${key}:`, err.message);
      return null;
    }
  };

  // ----- Escribir UNA key con reintentos -----
  const writeSingle = async (key, value, attempt = 1) => {
    try {
      const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
      const { error } = await supabase
        .from('baileys_auth')
        .upsert(
          { id: key, data: serialized, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        );

      if (error) throw new Error(error.message);
    } catch (err) {
      console.error(`   ❌ ${key} falló (intento ${attempt}):`, err.message);
      if (attempt < 3) {
        const delay = attempt * 500;
        await new Promise((r) => setTimeout(r, delay));
        return writeSingle(key, value, attempt + 1);
      }
      console.error(`   ❌ ${key} → dio up después de 3 intentos`);
    }
  };

  // ----- Escribir MUCHAS keys en UN solo request -----
  const writeBatch = async (entries, verbose = false) => {
    if (entries.length === 0) return;

    try {
      const rows = entries.map(({ key, value }) => ({
        id: key,
        data: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
        updated_at: new Date().toISOString(),
      }));

      const { error, data } = await supabase
        .from('baileys_auth')
        .upsert(rows, { onConflict: 'id' })
        .select('id');

      if (error) {
        console.error(`❌ Batch upsert error:`, error.message);
        console.error(`   Código:`, error.code);
        console.error(`   Detalle:`, error.details);
        console.error(`   Hint:`, error.hint);
        for (const entry of entries) {
          await writeSingle(entry.key, entry.value);
          await new Promise((r) => setTimeout(r, 100));
        }
      } else if (verbose) {
        console.log(`   ✅ Batch upsert: ${data?.length || entries.length} filas`);
      }
    } catch (err) {
      console.error(`❌ Batch fetch error:`, err.message);
      console.error(err.stack);
      for (const entry of entries) {
        await writeSingle(entry.key, entry.value);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };

  // ----- Borrar una key -----
  const removeData = async (key) => {
    try {
      await supabase.from('baileys_auth').delete().eq('id', key);
    } catch (err) {
      console.error(`Error borrando ${key}:`, err.message);
    }
  };

  // ----- Cargar credenciales existentes -----
  const creds = (await readData('creds')) || initAuthCreds();
  const credsStatus = creds && creds.me ? 'existentes' : 'nuevos (initAuthCreds)';
  console.log(`🔐 [AuthState] Creds cargados: ${credsStatus}`);

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`key-${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = { ...value };
            }
            data[id] = value;
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
            'creds',
            'session',
            'pre-key',
            'sender-key',
            'sender-key-memory',
            'app-state-sync-key',
            'app-state-sync-version',
            'identity-key',
            'device-list',
            'tctoken',
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
      // Log silencioso usando variable externa (NO saveCreds._lastLog)
      const now = Date.now();
      if (now - lastSaveLog > 5000) {
        console.log('💾 [saveCreds] Guardando credenciales...');
        lastSaveLog = now;
      }
      await writeSingle('creds', creds);
    },
  };
}