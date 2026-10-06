const state = new Set(['image', 'status', 'revision', 'baseRevision', 'check', 'review', 'operation', 'error', 'parts', 'draft'])
export const cardContent = node => ({ items: node.items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !state.has(key)))) })
