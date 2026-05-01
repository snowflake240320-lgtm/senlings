// app_v2.js
// Senlings 新UI メインJS

// ── データ読み込み ────────────────────────────────────────
function getAllData() {
  const raw = localStorage.getItem('senlings_v0');
  return raw ? JSON.parse(raw) : {};
}

// ── 画面1: 現場トップ ────────────────────────────────────
function renderSiteTop() {
  const projects = (getAllData().projects ?? [])
    .filter(p => !p.archive);

  const list = document.getElementById('site-list');
  if (!list) return;

  if (projects.length === 0) {
    list.innerHTML = '<p class="site-empty">現場が登録されていません。</p>';
    return;
  }

  list.innerHTML = projects.map(p => `
    <button class="site-card" data-project-id="${esc(p.project_id)}">
      <span class="site-slug">${esc(p.project_slug)}</span>
      <span class="site-address">${esc(p.address ?? '')}</span>
    </button>
  `).join('');

  list.querySelectorAll('.site-card').forEach(card => {
    card.addEventListener('click', () => {
      const projectId = card.dataset.projectId;
      console.log('selected project:', projectId);
      // 画面2への遷移は後日実装
    });
  });
}

function esc(val) {
  if (!val) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── 初期化 ───────────────────────────────────────────────
renderSiteTop();
