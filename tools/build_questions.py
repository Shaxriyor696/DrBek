#!/usr/bin/env python3
"""Build content/questions/topicNN-auto.json from the compact sources in tools/questions-src/.

Source format (one file per topic, e.g. tools/questions-src/topic01.txt):

    @ch01                       <- lesson the following questions belong to
    Q u3 m | Savol matni?       <- Q <simple-block suffix> <e|m|h> | stem
    + to'g'ri javob
    - noto'g'ri javob           (2-4 distractors)
    E Izoh: nima uchun shu javob to'g'ri.

The correct option's position is shuffled deterministically (stable across rebuilds), ids are
stable (q01-c01-01 ...), and every block reference is checked against the lesson file.

    python3 -I tools/build_questions.py            # all topics
    python3 -I tools/build_questions.py 01 02      # selected topics
"""
import hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'questions-src')
OUT = os.path.join(ROOT, 'content', 'questions')
ORIGIN = 'Claude (DrStudy sessiyasi) — kitobning özbekça izohlari (Guyton & Hall, 14-naşr) asosida, 2026-11-17. Ekspert tekşiruvi kerak.'
DIFF = {'e': 'easy', 'm': 'medium', 'h': 'hard'}


def lesson(ch, cache={}):
    if ch not in cache:
        with open(os.path.join(ROOT, 'content', 'lessons', f'{ch}.json'), encoding='utf-8') as f:
            cache[ch] = json.load(f)
    return cache[ch]


def parse(path):
    qs, ch, cur = [], None, None
    with open(path, encoding='utf-8') as f:
        for n, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            where = f'{os.path.basename(path)}:{n}'
            if line.startswith('@'):
                ch = line[1:].strip(); cur = None; lesson(ch); continue
            tag, rest = line[0], line[1:].strip()
            if tag == 'Q':
                m = re.match(r'^(u\d+)\s+([emh])\s*\|\s*(.+)$', rest)
                if not m or not ch:
                    sys.exit(f'{where}: bad Q line')
                cur = {'ch': ch, 'block': m.group(1), 'diff': DIFF[m.group(2)], 'stem': m.group(3), 'right': None, 'wrong': [], 'expl': '', 'where': where}
                qs.append(cur)
            elif tag in '+-E' and cur:
                if tag == '+':
                    if cur['right']: sys.exit(f'{where}: two correct answers')
                    cur['right'] = rest
                elif tag == '-':
                    cur['wrong'].append(rest)
                else:
                    cur['expl'] = rest
            else:
                sys.exit(f'{where}: unexpected line')
    return qs


def build(topic):
    src = os.path.join(SRC, f'topic{topic}.txt')
    out, per = [], {}
    for q in parse(src):
        L = lesson(q['ch'])
        if L['topicId'] != topic:
            sys.exit(f"{q['where']}: {q['ch']} belongs to topic {L['topicId']}, not {topic}")
        bid = f"{q['ch']}-{q['block']}"
        if not any(b.get('bid') == bid for b in L['blocks']['simple']):
            sys.exit(f"{q['where']}: block {bid} not found")
        if not q['right'] or not (2 <= len(q['wrong']) <= 4) or not q['expl']:
            sys.exit(f"{q['where']}: needs one '+', 2-4 '-', and 'E'")
        texts = [q['right']] + q['wrong']
        if len(set(t.lower() for t in texts)) != len(texts):
            sys.exit(f"{q['where']}: duplicate options")
        num = per[q['ch']] = per.get(q['ch'], 0) + 1
        qid = f"q{topic}-c{q['ch'][2:]}-{num:02d}"
        order = sorted(range(len(texts)), key=lambda i: hashlib.sha1(f'{qid}:{i}'.encode()).hexdigest())
        letters = 'abcde'
        options = [{'id': f'{qid}-{letters[k]}', 'text': texts[i]} for k, i in enumerate(order)]
        answer = options[order.index(0)]['id']
        out.append({
            'id': qid, 'version': 1, 'topicId': topic, 'lessonId': q['ch'], 'stem': q['stem'], 'options': options,
            'answerOptionId': answer, 'explanation': q['expl'], 'difficulty': q['diff'],
            'source': {'bookId': 'guyton-hall-14', 'lessonId': q['ch'], 'topicId': topic, 'blockId': bid,
                       'printedPage': L['printedPages'][0], 'pdfPage': L['pdfPages'][0], 'basis': 'summary_uz'},
            'status': 'needs_review',
        })
    dst = os.path.join(OUT, f'topic{topic}-auto.json')
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'origin': ORIGIN, 'questions': out}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'topic {topic}: {len(out)} savol ({", ".join(f"{k}:{v}" for k, v in per.items())}) -> {os.path.relpath(dst, ROOT)}')
    return len(out)


if __name__ == '__main__':
    topics = sys.argv[1:] or sorted(re.findall(r'topic(\d\d)\.txt', ' '.join(os.listdir(SRC))))
    print('jami:', sum(build(t) for t in topics))
