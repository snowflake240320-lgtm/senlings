// settings.js
// 請求書・ユーザー設定の localStorage 読み書き

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
  return localStorage.getItem(key) ?? SETTINGS_DEFAULTS[key] ?? null;
}

export function setSetting(key, value) {
  if (value === null || value === '') {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
}

export function getAllSettings() {
  return Object.fromEntries(
    Object.entries(SETTINGS_KEYS).map(([, key]) => [key, getSetting(key)])
  );
}

export function saveSettingsFromForm(formData) {
  for (const [key, value] of Object.entries(formData)) {
    setSetting(key, value);
  }
}
