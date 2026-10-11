/**
 * Parser de gastos.
 * Formatos aceptados:
 *   "25 almuerzo"
 *   "25.50 taxi"
 *   "25 almuerzo | comida"  ← categoría explícita
 */

const CATEGORIES = {
  comida: ['comida', 'almuerzo', 'cena', 'desayuno', 'restaurante', 'menu', 'menú',
           'pollo', 'hamburguesa', 'cafe', 'café', 'snack', 'pan', 'mercado',
           'bodega', 'pizza', 'chifa', 'helado', 'gaseosa', 'agua'],
  transporte: ['transporte', 'taxi', 'bus', 'combi', 'pasaje', 'uber', 'colectivo',
               'movilidad', 'gasolina', 'grifo', 'moto'],
  estudio: ['estudio', 'libro', 'cuaderno', 'lapicero', 'impresion', 'impresión',
            'fotocopia', 'copias', 'matricula', 'matrícula', 'pension', 'pensión',
            'curso', 'cuadernillo', 'folder', 'fotocopias'],
  ocio: ['ocio', 'cine', 'juego', 'netflix', 'spotify', 'salida', 'cerveza',
         'trago', 'bar', 'fiesta', 'heladeria', 'heladería'],
  salud: ['salud', 'farmacia', 'medicina', 'doctor', 'consulta', 'pastilla',
          'clinica', 'clínica'],
  hogar: ['hogar', 'alquiler', 'luz', 'agua', 'internet', 'gas', 'recibo'],
};

export const EXPENSE_CATEGORIES = Object.keys(CATEGORIES);

export function parseExpense(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return { error: 'texto vacío' };

  let descriptionPart = trimmed;
  let explicitCategory = null;

  if (trimmed.includes('|')) {
    const [left, right] = trimmed.split('|');
    descriptionPart = left.trim();
    const cat = right.trim().toLowerCase();
    if (cat && EXPENSE_CATEGORIES.includes(cat)) {
      explicitCategory = cat;
    }
  }

  const match = descriptionPart.match(/^(\d+(?:[.,]\d{1,2})?)\s+(.+)$/);
  if (!match) {
    return { error: 'formato inválido. Uso: !gasto <monto> <descripción>' };
  }

  const amount = parseFloat(match[1].replace(',', '.'));
  if (isNaN(amount) || amount <= 0) {
    return { error: 'monto inválido' };
  }

  const description = match[2].trim();
  if (!description) return { error: 'falta la descripción' };

  let category = explicitCategory;
  if (!category) {
    const words = description.toLowerCase().split(/\s+/);
    for (const word of words) {
      for (const [cat, keywords] of Object.entries(CATEGORIES)) {
        if (keywords.includes(word)) {
          category = cat;
          break;
        }
      }
      if (category) break;
    }
  }
  if (!category) category = 'otros';

  return { amount, description, category };
}

export function formatAmount(amount) {
  return `S/ ${Number(amount).toFixed(2)}`;
}

export function formatCategory(cat) {
  const icons = {
    comida: '🍔', transporte: '🚕', estudio: '📚',
    ocio: '🎮', salud: '💊', hogar: '🏠', otros: '📦',
  };
  return `${icons[cat] || '📦'} ${cat}`;
}