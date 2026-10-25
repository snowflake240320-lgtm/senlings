/**
 * work.js — 勤怠ロジック
 * WORK_CALCULATION_SPEC に基づく
 *
 * - work_minutes = (check_out_at - check_in_at) - break_minutes（マイナスは0）
 * - 交通時間は勤務時間に含めない
 * - 日数カウント: work_minutes > 0 の日 = 1日
 * - 8時間超過は記録のみ（割増なし）
 * - 月次集計: YYYY/MM/01 00:00 〜 末日 23:59
 *
 * 2026-10-25(維新・今日の現場と定時):
 * - 出勤は押さない。今日の現場が決まった時点で「定時の一日」(kind: 'teiji')を端末に置く。
 *   時刻は現場の決まり(project.teiji)、無ければ 8:00〜17:00。押した時刻は使わない。早出を測らない。
 * - 残業は「残業おつかれさま」を押した日だけ。押した時刻から終業を過ぎた分を30分刻み(切り上げ)で置く。
 *   Senlings から見つけにいかない。押さなければ残業は無し。
 * - 日数は日付で数える(同じ日に二つ記録があっても一日)。日付は端末の暦(ローカル)で切る。
 * - これまでの入った/出たの記録(kind なし)は消さず、そのまま数える。
 */

import { load, save, update, StorageWriteError } from "./storage.js";

export const TEIJI_DEFAULT = Object.freeze({ start: "08:00", end: "17:00" });
export const TEIJI_BREAK_MINUTES = 60; // 昼の一時間。稼働時間の表示にだけ効く(請求は日数で数える)
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HALF_HOUR = 30 * 60_000;

export function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + n).getTime());
}

function at(date, hhmm) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}

export const isTeiji = s => s?.kind === "teiji";

/** 現場の定時。決まりが無ければ 8:00〜17:00。 */
export function teijiOf(project) {
  const t = project?.teiji;
  if (t && HM.test(t.start) && HM.test(t.end) && t.start < t.end) return { start: t.start, end: t.end, rule: true };
  return { ...TEIJI_DEFAULT, rule: false };
}

export function formatTeiji(t) {
  const strip = s => s.replace(/^0/, "");
  return `${strip(t.start)}〜${strip(t.end)}`;
}

export function formatMinutes(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}時間${m}分` : h ? `${h}時間` : `${m}分`;
}

/** その日の定時の一日(無ければ null)。 */
export function teijiOn(data, date) {
  return (data.work_sessions ?? []).find(s => isTeiji(s) && s.date === date) ?? null;
}

function teijiSession(project, date, prev) {
  const t = teijiOf(project);
  return {
    id: prev?.id ?? `teiji:${date}`,
    kind: "teiji",
    date,
    project_id: project.project_id,
    check_in_at: at(date, t.start),
    check_out_at: at(date, t.end),
    break_minutes: TEIJI_BREAK_MINUTES,
    overtime_minutes: prev && prev.project_id === project.project_id ? prev.overtime_minutes ?? 0 : 0,
    placed_at: prev?.placed_at ?? Date.now(),
  };
}

/**
 * その日の現場を置く(定時の一日)。同じ日にもう置いてあれば、その現場に置き直す。一日は一つ。
 * 別の現場に置き直したときは、残業は前の現場のものなので持ち越さない。
 */
export function placeTeiji(projectId, date) {
  if (!DATE.test(date ?? "")) throw new Error("日付を確かめてください。");
  let placed;
  update(data => {
    const project = data.projects.find(p => p.project_id === projectId);
    if (!project) throw new Error("現場が見つかりません。");
    const i = data.work_sessions.findIndex(s => isTeiji(s) && s.date === date);
    placed = teijiSession(project, date, i >= 0 ? data.work_sessions[i] : null);
    if (i >= 0) data.work_sessions[i] = placed; else data.work_sessions.push(placed);
    return data;
  });
  return placed;
}

/** その日の現場を外す(行かなかった日)。 */
export function removeTeiji(date) {
  update(data => {
    data.work_sessions = data.work_sessions.filter(s => !(isTeiji(s) && s.date === date));
    return data;
  });
}

/**
 * 残業おつかれさま。押した時刻から終業を過ぎた分を30分刻み(切り上げ)で置く。
 * もう一度押したら、長いほうを残す。終業の前は置かない。
 * @returns {number} 置いた残業(分)
 */
export function markOvertime(date, now = Date.now()) {
  let minutes = 0;
  update(data => {
    const s = data.work_sessions.find(x => isTeiji(x) && x.date === date);
    if (!s) throw new Error("今日の現場がありません。");
    if (now <= s.check_out_at) throw new Error("終業のあとに押せます。");
    minutes = Math.min(Math.ceil((now - s.check_out_at) / HALF_HOUR) * 30, 12 * 60);
    s.overtime_minutes = Math.max(s.overtime_minutes ?? 0, minutes);
    minutes = s.overtime_minutes;
    return data;
  });
  return minutes;
}

/** 残業を直す(30分刻み)。0 で取り消し。 */
export function setOvertime(date, minutes) {
  const m = Number(minutes);
  if (!Number.isSafeInteger(m) || m < 0 || m > 12 * 60 || m % 30) throw new Error("残業は30分刻みで入れてください。");
  update(data => {
    const s = data.work_sessions.find(x => isTeiji(x) && x.date === date);
    if (!s) throw new Error("その日の現場がありません。");
    s.overtime_minutes = m;
    return data;
  });
}

/** 現場の定時を直す。今日からあとに置いてある日も、新しい定時に置き直す(残業はそのまま)。 */
export function setProjectTeiji(projectId, start, end, today = localDate(Date.now())) {
  if (!HM.test(start ?? "") || !HM.test(end ?? "") || !(start < end)) throw new Error("始業と終業を確かめてください。");
  update(data => {
    const project = data.projects.find(p => p.project_id === projectId);
    if (!project) throw new Error("現場が見つかりません。");
    project.teiji = { start, end };
    data.work_sessions = data.work_sessions.map(s =>
      isTeiji(s) && s.project_id === projectId && s.date >= today ? teijiSession(project, s.date, s) : s);
    return data;
  });
}

/**
 * 残業の金額。時間単価×1.25 を基本にする(時間単価は日当の8分の1)。
 * 元請けと別の約束があるときは、たたき台の行を直す。
 */
export const OVERTIME_RATE = 1.25;
export function overtimePay(minutes, dailyPrice) {
  return Math.round((dailyPrice / 8) * OVERTIME_RATE * (minutes / 60));
}

/**
 * 帰りの一言(自分だけ)。定時の一日は帰りに閉じなくていいので、残すのはこれだけ。
 * 同じ画面からもう一度送っても、書き込まない。
 */
export function saveReturnNote({ id, project_id, note, at: createdAt }) {
  const data = load();
  if (!data.projects.some(p => p.project_id === project_id)) throw new Error("現場が見つかりません。");
  if ((data.local_records ?? []).some(r => r.id === id)) return false;
  data.local_records ??= [];
  data.local_records.push({ id, project_id, kind: "memo", text: note.text, personal_note: note, created_at: createdAt,
    visibility: "private", delivery_status: "not_sent" });
  save(data);
  return true;
}

/** 記録の日付(端末の暦)。 */
export const sessionDate = s => (isTeiji(s) ? s.date : localDate(s.check_in_at));

/**
 * WorkSession を保存する。
 * @param {object} session
 * @param {string} session.id
 * @param {string} session.project_id
 * @param {number} session.check_in_at   - timestamp (ms)
 * @param {number} session.check_out_at  - timestamp (ms)
 * @param {number} session.break_minutes
 * @param {number} [session.travel_start_at]
 * @param {number} [session.travel_end_at]
 */
export function saveSession(session) {
  update((data) => {
    data.work_sessions.push(session);
    return data;
  });
}

export class SessionCompletionError extends StorageWriteError {
  constructor(message) {
    super();
    this.name = "SessionCompletionError";
    this.message = message;
  }
}

/**
 * 新UIの退勤。勤怠の追加と入場解除を同じ保存に含める。
 * 旧版の途中保存は現場ID・入場時刻で照合し、保存済み勤怠を変更しない。
 * 複数の候補や画面と保存状態の食い違いは、自動修復せず書込みを止める。
 */
export function completeSession(session) {
  const data = load();
  const sameEntry = entry => entry.project_id === session.project_id &&
    entry.check_in_at === session.check_in_at;
  const matches = data.work_sessions.filter(sameEntry);
  if (matches.length > 1) {
    throw new SessionCompletionError('同じ入場の勤怠が複数あります。データを変更せず停止しました。JSONを出力し、記録を照合してください。');
  }
  const current = data.current_session;
  if (current == null) {
    if (matches.length === 1) return matches[0]; // 完了済みの同じ操作は書き込まない。
    throw new SessionCompletionError('対象の入場記録がありません。現場画面に戻って確認してください。');
  }
  if (!sameEntry(current)) {
    throw new SessionCompletionError('入場記録が画面の内容と変わっています。現場画面に戻って確認してください。');
  }
  if (matches.length === 0) data.work_sessions.push(session);
  if (matches.length === 1 && session.personal_note && !matches[0].personal_note) {
    data.local_records ??= [];
    const id = `return:${session.project_id}:${session.check_in_at}`;
    if (!data.local_records.some(r => r.id === id)) data.local_records.push({
      id, project_id: session.project_id, kind: 'memo', text: session.personal_note.text,
      personal_note: session.personal_note, created_at: session.check_out_at,
      visibility: 'private', delivery_status: 'not_sent', recovered_entry_at: session.check_in_at,
    });
  }
  data.current_session = null;
  save(data); // 失敗時は勤怠も入場も更新されない。一時的な画面内フラグに依存しない。
  return matches[0] ?? session;
}

/**
 * セッション単体の勤務時間を計算する（分）。
 * @param {object} session
 * @returns {number}
 */
export function calcWorkMinutes(session) {
  const elapsed = (session.check_out_at - session.check_in_at) / 60_000;
  return Math.max(0, elapsed - session.break_minutes) + (isTeiji(session) ? session.overtime_minutes ?? 0 : 0);
}

/**
 * セッション単体の超過時間を計算する（時間）。
 * @param {object} session
 * @returns {number} overtime hours (0 if not exceeded)
 */
export function calcOvertimeHours(session) {
  if (isTeiji(session)) return (session.overtime_minutes ?? 0) / 60; // 押した日だけ
  const workHours = calcWorkMinutes(session) / 60;
  return workHours > 8 ? workHours - 8 : 0;
}

/**
 * 指定プロジェクト・年月の月次集計を返す。
 * @param {string} projectId
 * @param {number} year
 * @param {number} month - 1-indexed
 * overtime_minutes は「残業おつかれさま」を押した分だけ(請求に載せる残業)。
 * total_overtime_hours は以前からの記録用(8時間を超えた分も含む)。
 * @returns {{ total_work_minutes: number, total_days: number, total_overtime_hours: number, overtime_minutes: number, sessions: object[] }}
 */
export function monthlySummary(projectId, year, month) {
  const { work_sessions } = load();
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  const sessions = work_sessions.filter(
    (s) => s.project_id === projectId && sessionDate(s).startsWith(ym)
  );

  let total_work_minutes  = 0;
  let total_overtime_hours = 0;
  let overtime_minutes    = 0;
  const days = new Set();

  for (const s of sessions) {
    const mins = calcWorkMinutes(s);
    total_work_minutes += mins;
    if (mins > 0) days.add(sessionDate(s)); // 同じ日は一日
    total_overtime_hours += calcOvertimeHours(s);
    if (isTeiji(s)) overtime_minutes += s.overtime_minutes ?? 0;
  }

  return { total_work_minutes, total_days: days.size, total_overtime_hours, overtime_minutes, sessions };
}

/**
 * 指定日の全現場を横断した日次サマリーを返す（DAILY_TOTAL_SPEC 準拠）。
 * @param {string} date - YYYY-MM-DD
 * @returns {{
 *   date: string,
 *   total_work_minutes: number,
 *   total_transport_minutes: number,
 *   total_active_minutes: number,
 *   session_count: number,
 *   sessions: object[]
 * }}
 */
export function dailySummary(date) {
  const { work_sessions } = load();

  const sessions = work_sessions.filter((s) => sessionDate(s) === date);

  let total_work_minutes      = 0;
  let total_transport_minutes = 0;

  for (const s of sessions) {
    total_work_minutes += calcWorkMinutes(s);
    if (s.travel_start_at && s.travel_end_at) {
      total_transport_minutes += (s.travel_end_at - s.travel_start_at) / 60_000;
    }
  }

  return {
    date,
    total_work_minutes,
    total_transport_minutes,
    total_active_minutes: total_work_minutes + total_transport_minutes,
    session_count:        sessions.length,
    sessions,
  };
}

/**
 * 日別内訳を返す（Invoice Snapshot の daily_breakdown 用）。
 * @param {object[]} sessions
 * @returns {object[]} - { date, work_minutes, transport_minutes, session_count }
 */
export function buildDailyBreakdown(sessions) {
  const map = new Map();

  for (const s of sessions) {
    const date = sessionDate(s);
    if (!map.has(date)) {
      map.set(date, { date, work_minutes: 0, transport_minutes: 0, session_count: 0 });
    }
    const entry = map.get(date);
    entry.work_minutes += calcWorkMinutes(s);
    entry.session_count += 1;

    if (s.travel_start_at && s.travel_end_at) {
      entry.transport_minutes += (s.travel_end_at - s.travel_start_at) / 60_000;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
