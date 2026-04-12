/**
 * contact.js — ContactMaster 管理
 * CONTACT_MASTER_SPEC に基づく
 *
 * - CM01〜CM10 固定（追加不可・削除不可）
 * - active=false で無効化のみ
 * - 変更は event_log に記録
 */

import { load, update } from "./storage.js";

const SEED_CONTACTS = [
  { contact_id: "CM01", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM02", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM03", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM04", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM05", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM06", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM07", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM08", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM09", name: "", role: "", phone: null, company: null, active: true },
  { contact_id: "CM10", name: "", role: "", phone: null, company: null, active: true },
];

/**
 * ContactMaster が未初期化なら CM01〜CM10 をシードする。
 * アプリ起動時に1回呼ぶ。
 */
export function ensureContactSeed() {
  update((data) => {
    if (data.contacts.length === 0) {
      const now = Date.now();
      data.contacts = SEED_CONTACTS.map((c) => ({
        ...c,
        created_at: now,
        updated_at: now,
      }));
    }
    return data;
  });
}

/**
 * 全連絡先を返す（編集画面用・active 問わず）。
 * @returns {object[]}
 */
export function getAllContacts() {
  const { contacts } = load();
  return contacts;
}

/**
 * active な連絡先を返す（フォームのプルダウン用）。
 * @returns {object[]}
 */
export function getActiveContacts() {
  const { contacts } = load();
  return contacts.filter((c) => c.active);
}

/**
 * 連絡先を更新する（event_log に記録）。
 * @param {string} contactId - CM01〜CM10
 * @param {object} patch
 */
export function updateContact(contactId, patch) {
  const now = Date.now();
  update((data) => {
    const idx = data.contacts.findIndex((c) => c.contact_id === contactId);
    if (idx === -1) throw new Error(`Contact not found: ${contactId}`);

    const before = { ...data.contacts[idx] };
    data.contacts[idx] = { ...before, ...patch, updated_at: now };

    data.event_log.push({
      event_type:     "CONTACT_MASTER_UPDATED",
      contact_id:     contactId,
      updated_fields: Object.keys(patch),
      timestamp:      new Date(now).toISOString(),
    });
    return data;
  });
}
