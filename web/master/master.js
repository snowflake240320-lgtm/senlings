// master.js
// 発注側の工事台帳（マスターの入口）
// 職人のUIとは独立。共有するのは src/pwa/ のモジュール import のみ。

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  saveProjectToFirestore,
  listProjectsFromFirestore,
} from '../src/pwa/firebase.js';

const viewLogin = document.getElementById('view-login');
const viewMain  = document.getElementById('view-main');

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── ログイン ─────────────────────────────────────────────

const loginMsg = document.getElementById('login-msg');

document.getElementById('btn-login').addEventListener('click', async () => {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  loginMsg.textContent = '';
  loginMsg.className = 'msg';
  try {
    await signInWithEmailAndPassword(email, password);
    // 画面切替は onAuthStateChanged に任せる
  } catch {
    loginMsg.textContent = 'メールアドレスかパスワードが違います';
    loginMsg.className = 'msg error';
  }
});

document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

document.getElementById('btn-logout').addEventListener('click', () => {
  signOut();
});

onAuthStateChanged((user) => {
  if (user) {
    viewLogin.hidden = true;
    viewMain.hidden  = false;
    renderList();
  } else {
    viewLogin.hidden = false;
    viewMain.hidden  = true;
  }
});

// ── 工事の登録 ───────────────────────────────────────────

const registerMsg = document.getElementById('register-msg');
const btnRegister = document.getElementById('btn-register');

btnRegister.addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    document.getElementById('f-name').focus();
    return;
  }
  const address = document.getElementById('f-address').value.trim() || null;
  const code    = document.getElementById('f-code').value.trim()    || null;
  const contact = document.getElementById('f-contact').value.trim() || null;

  const now = Date.now();
  const d = new Date();
  const YYYYMMDD =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  const project_id = `${YYYYMMDD}_${now}`;

  // ローカル projects の形に揃える（杭）。
  // master_id は自分自身 = 職人のローカル project がここへ紐を結ぶときの宛先。
  const project = {
    project_id,
    project_slug:    name,
    address,
    start_date:      null,
    project_code:    code,
    site_contact_id: null,
    contact_name:    contact,
    master_id:       project_id,
    site_info:       { raw: null },
    created_at:      now,
    archive:         false,
    origin:          'master',
    audience:        null,
  };

  btnRegister.disabled = true;
  registerMsg.textContent = '';
  registerMsg.className = 'msg';
  try {
    await saveProjectToFirestore(project);
    registerMsg.textContent = '登録しました';
    registerMsg.className = 'msg ok';
    document.getElementById('f-name').value    = '';
    document.getElementById('f-address').value = '';
    document.getElementById('f-code').value    = '';
    document.getElementById('f-contact').value = '';
    renderList();
  } catch {
    registerMsg.textContent = '保存できませんでした。電波を確かめて、もう一度。';
    registerMsg.className = 'msg error';
  } finally {
    btnRegister.disabled = false;
  }
});

// ── 登録済み一覧 ─────────────────────────────────────────

async function renderList() {
  const listEl = document.getElementById('project-list');
  let projects;
  try {
    projects = await listProjectsFromFirestore();
  } catch {
    listEl.innerHTML = '<p class="list-empty">一覧を読み込めませんでした。</p>';
    return;
  }

  const rows = projects
    .filter(p => p.origin === 'master')
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

  if (rows.length === 0) {
    listEl.innerHTML = '<p class="list-empty">まだ登録はありません。</p>';
    return;
  }

  listEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>工事名</th><th>住所</th><th>工事コード</th><th>担当者</th><th>登録日</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(p => {
          const dt = p.created_at ? new Date(p.created_at) : null;
          const dateStr = dt ? `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}` : '';
          return `<tr>
            <td>${esc(p.project_slug)}</td>
            <td>${esc(p.address ?? '')}</td>
            <td>${esc(p.project_code ?? '')}</td>
            <td>${esc(p.contact_name ?? '')}</td>
            <td>${esc(dateStr)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}
