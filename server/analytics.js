// Study statistics. Instants are stored in UTC; grouping uses the user's time zone.
// Active reading time = union of heartbeat intervals, so retried heartbeats and
// parallel tabs never count the same second twice.

export function dayKey(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function mergeIntervals(rows) {
  const iv = rows.map((r) => [r.start_ms, r.end_ms]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// seconds per local day; an interval crossing midnight is split at the boundary
export function secondsByDay(intervals, tz) {
  const map = new Map();
  for (const [a, b] of intervals) {
    let s = a;
    while (s < b) {
      const k = dayKey(s, tz);
      // find end of this local day by stepping (intervals are short, so step in 1 min max)
      let e = Math.min(b, s + 60000);
      while (e < b && dayKey(e, tz) === k) e = Math.min(b, e + 60000);
      if (dayKey(e - 1, tz) !== k) {
        // binary search the boundary inside (s, e)
        let lo = s; let hi = e;
        while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (dayKey(mid, tz) === k) lo = mid; else hi = mid; }
        e = hi;
      }
      map.set(k, (map.get(k) || 0) + (e - s) / 1000);
      s = e;
    }
  }
  return map;
}

function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekStart(key) { // Monday
  const d = new Date(key + 'T12:00:00Z');
  const wd = (d.getUTCDay() + 6) % 7;
  return addDays(key, -wd);
}

export function computeAnalytics(db, content, user, profile, { range = 'week', now = Date.now() } = {}) {
  const tz = profile.timezone || 'Asia/Tashkent';
  const today = dayKey(now, tz);
  const intervals = mergeIntervals(db.prepare('SELECT start_ms, end_ms FROM activity_intervals WHERE user_id=?').all(user.id));
  const secByDay = secondsByDay(intervals, tz);
  const completions = db.prepare('SELECT lesson_id, completed_at FROM lesson_progress WHERE user_id=? AND completed_at IS NOT NULL').all(user.id);
  const attempts = db.prepare(`SELECT id, scope_type, scope_id, correct, total, unanswered, submitted_at FROM quiz_attempts WHERE user_id=? AND status='submitted'`).all(user.id);

  const bucketOf = (key) => (range === 'day' ? key : range === 'week' ? weekStart(key) : key.slice(0, 7));
  const buckets = [];
  if (range === 'day') for (let i = 13; i >= 0; i--) buckets.push(addDays(today, -i));
  else if (range === 'week') for (let i = 11; i >= 0; i--) buckets.push(weekStart(addDays(today, -7 * i)));
  else {
    const [y, m] = today.split('-').map(Number);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); buckets.push(d.toISOString().slice(0, 7)); }
  }
  const series = new Map(buckets.map((b) => [b, { bucket: b, activeMinutes: 0, lessonsCompleted: 0, quizzes: 0, correct: 0, questions: 0 }]));
  for (const [k, sec] of secByDay) { const b = series.get(bucketOf(k)); if (b) b.activeMinutes += sec / 60; }
  for (const c of completions) { const b = series.get(bucketOf(dayKey(Date.parse(c.completed_at), tz))); if (b) b.lessonsCompleted++; }
  for (const a of attempts) {
    const b = series.get(bucketOf(dayKey(Date.parse(a.submitted_at), tz)));
    if (b) { b.quizzes++; b.correct += a.correct; b.questions += a.total; }
  }
  const rows = [...series.values()].map((r) => ({ ...r, activeMinutes: Math.round(r.activeMinutes * 10) / 10, accuracy: r.questions ? Math.round((r.correct / r.questions) * 1000) / 10 : null }));
  const current = rows[rows.length - 1];
  const totals = rows.reduce((t, r) => ({ activeMinutes: t.activeMinutes + r.activeMinutes, lessonsCompleted: t.lessonsCompleted + r.lessonsCompleted, quizzes: t.quizzes + r.quizzes, correct: t.correct + r.correct, questions: t.questions + r.questions }), { activeMinutes: 0, lessonsCompleted: 0, quizzes: 0, correct: 0, questions: 0 });
  totals.activeMinutes = Math.round(totals.activeMinutes * 10) / 10;
  totals.accuracy = totals.questions ? Math.round((totals.correct / totals.questions) * 1000) / 10 : null;

  // streak: consecutive local days with a completed lesson or a submitted test
  const activeDays = new Set([
    ...completions.map((c) => dayKey(Date.parse(c.completed_at), tz)),
    ...attempts.map((a) => dayKey(Date.parse(a.submitted_at), tz)),
  ]);
  let streak = 0;
  let k = activeDays.has(today) ? today : addDays(today, -1);
  while (activeDays.has(k)) { streak++; k = addDays(k, -1); }

  // progress over topics/lessons (denominator = lessons a student can open)
  const done = new Set(completions.map((c) => c.lesson_id));
  const topics = content.topicList(user).map((t) => {
    const visible = t.sections.filter((s) => content.canSee(s.status, user));
    const read = visible.filter((s) => done.has(s.id)).length;
    const ta = attempts.filter((a) => (a.scope_type === 'topic' && a.scope_id === t.id) || (a.scope_type === 'lesson' && content.lessonIndex.get(a.scope_id)?.topicId === t.id));
    const tc = ta.reduce((x, a) => x + a.correct, 0); const tq = ta.reduce((x, a) => x + a.total, 0);
    return { id: t.id, title: t.title, cardImage: t.cardImage, lessons: visible.length, read, complete: visible.length > 0 && read === visible.length, percent: visible.length ? Math.round((read / visible.length) * 100) : null, quizAccuracy: tq ? Math.round((tc / tq) * 100) : null, quizzes: ta.length };
  });
  const goal = profile.daily_goal_min || 30;
  const todayMin = (secByDay.get(today) || 0) / 60;
  return {
    timezone: tz, today, range,
    series: rows,
    current, totals,
    todayMinutes: Math.round(todayMin * 10) / 10,
    dailyGoal: goal,
    goalPercent: Math.min(100, Math.round((todayMin / goal) * 100)),
    streak,
    topicsRead: topics.filter((t) => t.complete).length,
    topicsTotal: 15,
    lessonsRead: done.size,
    lessonsTotal: topics.reduce((s, t) => s + t.lessons, 0),
    topics,
    allTimeAccuracy: (() => { const c = attempts.reduce((s, a) => s + a.correct, 0); const q = attempts.reduce((s, a) => s + a.total, 0); return q ? Math.round((c / q) * 1000) / 10 : null; })(),
    attemptsCount: attempts.length,
  };
}
