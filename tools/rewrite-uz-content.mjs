import fs from 'node:fs';
import path from 'node:path';
import { newUzbekAlphabet as uz } from './uz-alphabet.mjs';

const content = process.argv[2] || 'content';
let changed = 0;

function rewrite(file, transform) {
  const filename = path.join(content, file);
  if (!fs.existsSync(filename)) return;
  const raw = fs.readFileSync(filename, 'utf8');
  const data = JSON.parse(raw);
  if (!transform(data)) return;
  const indent = raw.match(/\n( +)"/)?.[1] || ' ';
  const updated = JSON.stringify(data, null, indent) + (raw.endsWith('\n') ? '\n' : '');
  if (updated === raw) return;
  fs.writeFileSync(filename, updated);
  changed++;
}

// Only visit prose-bearing fields, leaving identifiers and the full English
// source untouched. Nested list items and tables have their own block text.
function fields(data, keys) {
  let dirty = false;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && keys.has(key)) {
      data[key] = uz(value);
      dirty = dirty || data[key] !== value;
    } else if (Array.isArray(value) && (keys.has(key) || Array.isArray(data))) {
      data[key] = value.map((item) => {
        if (typeof item !== 'string') {
          if (item && typeof item === 'object') dirty = fields(item, keys) || dirty;
          return item;
        }
        const converted = uz(item);
        dirty = dirty || converted !== item;
        return converted;
      });
    } else if (value && typeof value === 'object') {
      dirty = fields(value, keys) || dirty;
    }
  }
  return dirty;
}

const prose = new Set(['text', 'lead', 'caption', 'titleUz', 'termUz', 'contextUz', 'definitionUz', 'objectives', 'header', 'rows']);
for (const file of fs.readdirSync(path.join(content, 'lessons')).filter((name) => name.endsWith('.json'))) {
  rewrite(`lessons/${file}`, (lesson) => {
    const subtitle = lesson.subtitle;
    if (subtitle) {
      const suffix = subtitle.indexOf(' · ');
      if (suffix !== -1) lesson.subtitle = subtitle.slice(0, suffix) + uz(subtitle.slice(suffix));
    }
    const titleUz = lesson.titleUz;
    lesson.titleUz = uz(titleUz);
    const dirty = fields({ objectives: lesson.objectives, simple: lesson.blocks.simple, glossary: lesson.glossary }, prose);
    return dirty || titleUz !== lesson.titleUz || subtitle !== lesson.subtitle;
  });
}
rewrite('topics.json', ({ topics }) => topics.map((topic) => {
  const { bookUnit, ...uzbekFields } = topic;
  const dirty = fields(uzbekFields, new Set(['title', 'titleUz', 'description']));
  Object.assign(topic, uzbekFields);
  return dirty;
}).some(Boolean));
rewrite('glossary.json', (data) => fields(data, prose));
rewrite('books.json', (data) => fields(data, new Set(['usageNote'])));
rewrite('library.json', (data) => fields(data, new Set(['note', 'description', 'edition', 'language'])));
rewrite('figures/manifest.json', (data) => fields(data, new Set(['captionUz', 'altTextUz'])));
const questions = path.join(content, 'questions');
if (fs.existsSync(questions)) {
  for (const file of fs.readdirSync(questions).filter((name) => name.endsWith('.json'))) {
    rewrite(`questions/${file}`, (data) => fields(data, new Set(['origin', 'stem', 'text', 'explanation'])));
  }
}
console.log(`Özbekça yozuv: ${changed} ta kontent fayli yangilandi.`);
