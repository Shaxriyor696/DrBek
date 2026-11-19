export function normalizeSearchText(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[‘’ʻʼ`']/g, '')
    .replace(/[öğşç]/g, (letter) => ({ ö: 'o', ğ: 'g', ş: 'sh', ç: 'ch' })[letter]);
}
