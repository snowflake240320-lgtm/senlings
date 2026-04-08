/**
 * work.js — 勤怠ロジック
 * WORK_CALCULATION_SPEC に基づく
 *
 * - work_minutes = (check_out_at - check_in_at) - break_minutes（マイナスは0）
 * - 交通時間は勤務時間に含めない
 * - 日数カウント: work_minutes > 0 の日 = 1日
 * - 8時間超過は記録のみ（割増なし）
 * - 月次集計: YYYY/MM/01 00:00 〜 末日 23:59
 */

import { load, update } from "./storage.js";

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

/**
 * セッション単体の勤務時間を計算する（分）。
 * @param {object} session
 * @returns {number}
 */
export function calcWorkMinutes(session) {
  const elapsed = (session.check_out_at - session.check_in_at) / 60_000;
  return Math.max(0, elapsed - session.break_minutes);
}

/**
 * セッション単体の超過時間を計算する（時間）。
 * @param {object} session
 * @returns {number} overtime hours (0 if not exceeded)
 */
export function calcOvertimeHours(session) {
  const workHours = calcWorkMinutes(session) / 60;
  return workHours > 8 ? workHours - 8 : 0;
}

/**
 * 指定プロジェクト・年月の月次集計を返す。
 * @param {string} projectId
 * @param {number} year
 * @param {number} month - 1-indexed
 * @returns {{ total_work_minutes: number, total_days: number, total_overtime_hours: number, sessions: object[] }}
 */
export function monthlySummary(projectId, year, month) {
  const { work_sessions } = load();

  const periodStart = new Date(year, month - 1, 1).getTime();
  const periodEnd   = new Date(year, month, 0, 23, 59, 59, 999).getTime();

  const sessions = work_sessions.filter(
    (s) =>
      s.project_id === projectId &&
      s.check_in_at >= periodStart &&
      s.check_in_at <= periodEnd
  );

  let total_work_minutes  = 0;
  let total_days          = 0;
  let total_overtime_hours = 0;

  for (const s of sessions) {
    const mins = calcWorkMinutes(s);
    total_work_minutes += mins;
    if (mins > 0) total_days += 1;
    total_overtime_hours += calcOvertimeHours(s);
  }

  return { total_work_minutes, total_days, total_overtime_hours, sessions };
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

  const sessions = work_sessions.filter((s) => {
    const sessionDate = new Date(s.check_in_at).toISOString().slice(0, 10);
    return sessionDate === date;
  });

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
    const date = new Date(s.check_in_at).toISOString().slice(0, 10);
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
