import { load, StorageReadError, StorageWriteError } from './storage.js';

// Shared boundary for both UIs. Storage throws before callers can report success.
export function startApp(moduleURL) {
  const dialog = document.createElement('dialog');
  dialog.id = 'storage-error';
  dialog.setAttribute('aria-label', '保存データのエラー');
  dialog.style.cssText = 'margin:auto;width:calc(100% - 32px);max-width:32rem;box-sizing:border-box;padding:24px;background:#fff;color:#222;border:2px solid #a33;border-radius:8px;line-height:1.6;';
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.style.marginBottom = '16px';
  const retry = document.createElement('button');
  retry.textContent = '保存データを再読取';
  retry.type = 'button';
  retry.style.cssText = 'padding:10px 16px;border:1px solid #555;border-radius:4px;font:inherit;cursor:pointer;';
  dialog.append(message, retry);
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => event.preventDefault());

  function report(error) {
    message.textContent = error.message;
    if (!dialog.open) dialog.showModal();
  }
  window.addEventListener('senlings-storage-error', event => report(event.detail));
  for (const type of ['error', 'unhandledrejection']) {
    window.addEventListener(type, event => {
      const error = event.error ?? event.reason;
      if (error instanceof StorageReadError || error instanceof StorageWriteError) {
        event.preventDefault();
        report(error);
      }
    });
  }
  // Recheck even actions based on previously rendered/cached data (including exports).
  for (const type of ['click', 'submit']) {
    document.addEventListener(type, event => {
      if (dialog.contains(event.target)) return;
      try {
        if (dialog.open) throw new StorageReadError();
        load();
      } catch (error) {
        event.preventDefault();
        event.stopImmediatePropagation();
        report(error);
      }
    }, true);
  }

  let started = false;
  async function start() {
    retry.disabled = true;
    try {
      load();
      dialog.close();
      if (!started) {
        await import(moduleURL);
        started = true;
      } else {
        window.dispatchEvent(new Event('senlings-storage-ready'));
      }
    } catch (error) {
      report(error instanceof StorageReadError || error instanceof StorageWriteError
        ? error : new Error('画面を読み込めませんでした。再読取を試してください。'));
    } finally {
      retry.disabled = false;
    }
  }
  retry.addEventListener('click', start);
  start();
}
