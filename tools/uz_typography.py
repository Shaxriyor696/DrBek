#!/usr/bin/env python3
"""Uzbek typography for the Uzbek-language content fields (as Microsoft Word writes them).

  o‘ g‘ O‘ G‘  -> U+2018 (‘)
  tutuq belgisi -> U+2019 (’)   ma’lumot, ta’sir
  "..."         -> “...”
  " - "         -> " — "

Only Uzbek fields are touched (lesson summaries, titles, objectives, glossary, topics); the English
book text is left as it is. Idempotent.

    python3 -I tools/uz_typography.py            # normalise content/ in place
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def uz(t):
    if not isinstance(t, str):
        return t
    t = re.sub(r"([oOgG])[’'`ʻʼ´]", r"\1‘", t)          # o‘ g‘
    t = re.sub(r"(?<=[A-Za-z])['`ʼ´](?=[a-z])", "’", t)  # tutuq: ta'sir -> ta’sir
    t = re.sub(r'"([^"\n]{1,200})"', r"“\1”", t)          # “quotes”
    t = t.replace(" - ", " — ")
    return t


def deep(x, keys=None):
    """Apply uz() to every string (or only to the given keys of dicts)."""
    if isinstance(x, list):
        return [deep(v, keys) for v in x]
    if isinstance(x, dict):
        if keys is None:
            return {k: deep(v) for k, v in x.items()}
        return {k: (deep(v) if k in keys else deep(v, keys) if isinstance(v, (dict, list)) else v) for k, v in x.items()}
    return uz(x) if keys is None else x


def block(b):
    b = dict(b)
    for k in ('text', 'caption'):
        if k in b:
            b[k] = uz(b[k])
    for k in ('items', 'rows', 'header'):
        if k in b:
            b[k] = deep(b[k])
    return b


def lesson(d):
    for k in ('titleUz', 'subtitle'):
        if k in d:
            d[k] = uz(d[k])
    d['objectives'] = deep(d.get('objectives', []))
    d['blocks']['simple'] = [block(b) for b in d['blocks']['simple']]
    d['glossary'] = [{**g, **{k: uz(g[k]) for k in ('termUz', 'contextUz', 'definitionUz', 'original') if k in g}} for g in d.get('glossary', [])]
    return d


def rewrite(path, fn):
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    new = json.dumps(fn(json.loads(raw)), ensure_ascii=False, indent=1) + '\n'
    if new != raw:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new)
        return 1
    return 0


def topics(d):
    for topic in d['topics']:
        for key in ('title', 'description'):
            topic[key] = uz(topic[key])
        for section in topic['sections']:
            section['titleUz'] = uz(section['titleUz'])
    return d


def run(content=os.path.join(ROOT, 'content')):
    n = 0
    ldir = os.path.join(content, 'lessons')
    for f in sorted(os.listdir(ldir)):
        if f.endswith('.json'):
            n += rewrite(os.path.join(ldir, f), lesson)
    n += rewrite(os.path.join(content, 'topics.json'), topics)
    g = os.path.join(content, 'glossary.json')
    if os.path.exists(g):
        n += rewrite(g, lambda d: deep(d, {'termUz', 'contextUz', 'definitionUz', 'uz', 'titleUz'}))
    print(f'uz_typography: {n} ta fayl yangilandi')


if __name__ == '__main__':
    run(*sys.argv[1:])
