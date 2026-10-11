import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

// ============================================================
//  Cliente Supabase compartido para toda la memoria
//  (Reemplaza a SQLite para persistir entre deploys de Render)
// ============================================================

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// Verificar conexión al arrancar
(async () => {
  try {
    const { error } = await supabase
      .from('athena_messages')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.error('❌ Error conectando a Supabase:', error.message);
    } else {
      console.log('🗄️  Memoria: Supabase PostgreSQL conectado ✅');
    }
  } catch (err) {
    console.error('❌ Error inicializando memoria:', err.message);
  }
})();