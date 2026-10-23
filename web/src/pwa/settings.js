// settings.js
// 請求書・ユーザー設定の localStorage 読み書き
import { load, update } from './storage.js';

export const SETTINGS_KEYS = {
  USER_NAME:             'senlings_user_name',
  WORK_UNIT_PRICE:       'senlings_work_unit_price',
  TAX_RATE:              'senlings_tax_rate',
  INVOICE_CLOSING_DAY:   'senlings_invoice_closing_day',
  INVOICE_PAYMENT_DAYS:  'senlings_invoice_payment_days',
  BANK_NAME:             'senlings_bank_name',
  BANK_BRANCH:           'senlings_bank_branch',
  BANK_ACCOUNT_TYPE:     'senlings_bank_account_type',
  BANK_ACCOUNT_NUMBER:   'senlings_bank_account_number',
  BANK_ACCOUNT_HOLDER:   'senlings_bank_account_holder',
  INVOICE_NUMBER_PREFIX: 'senlings_invoice_number_prefix',
  REGISTRATED_NUMBER:    'senlings_registrated_number',
};

export const SETTINGS_DEFAULTS = {
  [SETTINGS_KEYS.WORK_UNIT_PRICE]:      '25000',
  [SETTINGS_KEYS.TAX_RATE]:             '0.10',
  [SETTINGS_KEYS.INVOICE_CLOSING_DAY]:  'end',
  [SETTINGS_KEYS.INVOICE_PAYMENT_DAYS]: 'end_of_next_month',
  [SETTINGS_KEYS.BANK_ACCOUNT_TYPE]:    '普通',
  [SETTINGS_KEYS.INVOICE_NUMBER_PREFIX]: 'INV-',
};

export function getSetting(key) {
  const settings = load().settings;
  const value = settings && Object.hasOwn(settings, key) ? settings[key] : localStorage.getItem(key);
  return value ?? SETTINGS_DEFAULTS[key] ?? null;
}

export function setSetting(key, value) {
  saveSettingsFromForm({ [key]: value });
}

export function getAllSettings() {
  return Object.fromEntries(
    Object.entries(SETTINGS_KEYS).map(([, key]) => [key, getSetting(key)])
  );
}

export function saveSettingsFromForm(formData) {
  const allowed = Object.values(SETTINGS_KEYS);
  if (Object.entries(formData).some(([key, value]) => !allowed.includes(key) ||
      (value !== null && (typeof value !== 'string' || value.length > 500)))) throw new Error('設定の内容を確認してください。');
  for (const key of [SETTINGS_KEYS.WORK_UNIT_PRICE, SETTINGS_KEYS.TAX_RATE]) {
    const value = formData[key];
    if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 ||
        (key === SETTINGS_KEYS.TAX_RATE && Number(value) > 1))) throw new Error('単価・税率を確認してください。税率は0〜1で指定します。');
  }
  // 旧キーは保持。現行画面の設定を一回で保存し、全データJSONにも含める。
  const existing = getAllSettings();
  update(data => {
    data.settings = { ...existing, ...data.settings };
    for (const [key, value] of Object.entries(formData)) data.settings[key] = value === '' ? null : value;
    return data;
  });
}
