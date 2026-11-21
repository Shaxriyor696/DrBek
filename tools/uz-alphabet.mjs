// Uzbek translation spelling described in the project's alphabet guide.
const letters = { o: 'ö', O: 'Ö', g: 'ğ', G: 'Ğ', sh: 'ş', Sh: 'Ş', ch: 'ç', Ch: 'Ç' };
const foreign = /\b(?:Renshou|Geschwind|Giebisch|Rosbash|Schwartz|Wuchereria|Chassin|Schistosoma|AChE?|Ach|[Pp]atch|Arch|[Ss]hock|[Ss]hunt|[Ss]tretch|[Cc]hannels?|[Cc]hapter|[Cc]hain|[Ee]xchange|[Ee]nglish|[Ss]hifts?|[Cc]holesterol|[Aa]cetylcholine|Charles|[Ss]hivering|Washington|MacNichol|Ishihara|Harukicho|Hutchinson|Escherichia|Vishnu|Publishing)(?=$|[^\p{L}]|ning\b|ni\b|ga\b|da\b|dan\b)/gu;

function convert(text) {
  return text.normalize('NFC')
    .replace(/([oOgG])[‘’ʻʼ'`´]/g, (_, letter) => letters[letter])
    .replace(/(?<=[\p{L}])['‘ʻʼ`´](?=[\p{L}])/gu, '’')
    .replace(/sh|Sh|ch|Ch/g, (pair) => letters[pair]);
}

export function newUzbekAlphabet(text) {
  let result = '';
  let start = 0;
  for (const match of text.matchAll(foreign)) {
    result += convert(text.slice(start, match.index)) + match[0];
    start = match.index + match[0].length;
  }
  return result + convert(text.slice(start));
}
