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
      const project = projects.find(p => p.project_id === card.dataset.projectId);
      if (project) goToHandover(project);
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

// ── 画面2: 申し送り ──────────────────────────────────────

const HANDOVER_CATEGORIES = [
  { key: 'entrance',         label: '現場アクセス' },
  { key: 'equipment',        label: '特殊装備・入場条件', alert: true },
  { key: 'parking',          label: '駐車場' },
  { key: 'toilet',           label: 'トイレ' },
  { key: 'morning_assembly', label: '朝礼' },
  { key: 'delivery',         label: '搬入' },
  { key: 'contact',          label: '連絡先' },
];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function renderHandover(project) {
  const siteInfo = project.site_info ?? {};
  const list = document.getElementById('handover-list');
  list.innerHTML = '';

  const items = HANDOVER_CATEGORIES.filter(c => siteInfo[c.key]);
  if (items.length === 0) {
    list.innerHTML = '<p class="handover-empty">申し送り情報はまだありません。</p>';
    return;
  }

  const alertColor = '#d95b29';
  items.forEach(cat => {
    const isAlert = cat.alert === true;
    const div = document.createElement('div');
    div.className = 'handover-item';
    div.innerHTML = `
      <button class="handover-header">
        <span class="handover-label"${isAlert ? ` style="color:${alertColor}"` : ''}>
          ${isAlert ? '⚠ ' : ''}${cat.label}
        </span>
        <span class="handover-chevron"${isAlert ? ` style="color:${alertColor}"` : ''}>›</span>
      </button>
      <div class="handover-body" hidden>
        <p class="handover-text">${esc(siteInfo[cat.key])}</p>
      </div>
    `;
    div.querySelector('.handover-header').addEventListener('click', () => {
      const body = div.querySelector('.handover-body');
      const isOpen = !body.hidden;
      body.hidden = isOpen;
      div.classList.toggle('open', !isOpen);
    });
    list.appendChild(div);
  });
}

function goToHandover(project) {
  document.getElementById('handover-site-name').textContent = project.project_slug;
  renderHandover(project);
  document.getElementById('btn-checkin').onclick = () => {
    goToWorking(project, new Date());
  };
  showScreen('screen-handover');
}

document.getElementById('btn-back-handover')?.addEventListener('click', () => {
  showScreen('screen-site-top');
});

document.getElementById('btn-back-working')?.addEventListener('click', () => {
  showScreen('screen-handover');
});

// ── 画面3: 作業中 ────────────────────────────────────────

function goToWorking(project, checkinTime) {
  document.getElementById('working-site-name').textContent = project.project_slug;
  const timeStr = checkinTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('working-checkin-time').textContent = `入場 ${timeStr}`;

  document.getElementById('btn-sos').onclick = () => {
    console.log('SOS:', project.project_id);
  };
  document.getElementById('btn-photo').onclick = () => {
    console.log('photo:', project.project_id);
  };
  document.getElementById('btn-return').onclick = () => {
    console.log('return:', project.project_id);
  };

  showScreen('screen-working');
}

// ── 初期化 ───────────────────────────────────────────────
renderSiteTop();
