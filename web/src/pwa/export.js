import { readOrThrow } from './storage.js';

export function exportAllDataAsJSON() {
  const result = readOrThrow();
  if (result.status === 'absent') throw new Error('データが見つかりません（senlings_v0）');
  const data = JSON.parse(result.raw);

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const filename = `senlings_export_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
