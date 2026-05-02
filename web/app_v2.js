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
    goToSos(project);
  };
  document.getElementById('btn-photo').onclick = () => {
    console.log('photo:', project.project_id);
  };
  document.getElementById('btn-rest').onclick = () => {
    goToRest(project);
  };
  document.getElementById('btn-return').onclick = () => {
    goToReturn(project);
  };

  showScreen('screen-working');
}

// ── 画面4: SOS ──────────────────────────────────────────

const SOS_OPTIONS = [
  { fieldKey: 'access_delivery', label: '入れない・搬入できない',      alert: false },
  { fieldKey: 'drawing_diff',    label: '図面と違う',                  alert: false },
  { fieldKey: 'fit_unknown',     label: '納まりがわからない',           alert: false },
  { fieldKey: 'contact_unknown', label: '誰に聞けばいいかわからない',   alert: false },
  { fieldKey: 'danger',          label: '危ない',                      alert: true  },
];

let selectedSosKey = null;

function renderSosOptions() {
  const list = document.getElementById('sos-options-list');
  list.innerHTML = '';
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:16px 20px 0;';

  SOS_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'sos-option' + (opt.alert ? ' danger' : '');
    btn.dataset.key = opt.fieldKey;
    btn.innerHTML = `<span>${opt.label}</span><span class="sos-check">✓</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sos-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSosKey = opt.fieldKey;
      document.getElementById('btn-sos-send').disabled = false;
    });
    list.appendChild(btn);
  });
}

function showSosComplete(project, isDanger) {
  const modal = document.getElementById('sos-complete-modal');
  const callBtn = document.getElementById('btn-sos-call');

  callBtn.hidden = !isDanger;

  callBtn.onclick = () => {
    window.location.href = 'tel:';
  };

  document.getElementById('btn-sos-wait').onclick = () => {
    modal.hidden = true;
    showScreen('screen-working');
  };

  document.getElementById('btn-sos-again').onclick = () => {
    modal.hidden = true;
    showScreen('screen-sos');
  };

  modal.hidden = false;
}

function goToSos(project) {
  selectedSosKey = null;
  document.getElementById('sos-site-name').textContent = project.project_slug;
  document.getElementById('sos-memo').value = '';
  document.getElementById('btn-sos-send').disabled = true;
  renderSosOptions();

  document.getElementById('btn-back-sos').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-sos-send').onclick = () => {
    if (!selectedSosKey) return;
    const memo = document.getElementById('sos-memo').value;
    const isDanger = selectedSosKey === 'danger';
    console.log('SOS sent:', {
      projectId: project.project_id,
      fieldKey: selectedSosKey,
      description: memo,
    });
    showSosComplete(project, isDanger);
  };

  showScreen('screen-sos');
}

// ── 画面3-B: 休憩 ────────────────────────────────────────

function goToRest(project) {
  document.getElementById('rest-site-name').textContent = project.project_slug;

  document.getElementById('btn-back-rest').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-resume').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-sos-rest').onclick = () => {
    goToSos(project);
  };

  document.querySelectorAll('.rest-cat-btn').forEach(btn => {
    btn.onclick = () => {
      console.log('map category:', btn.textContent.trim());
    };
  });

  showScreen('screen-rest');
}

// ── 画面5: 山返し（帰還） ────────────────────────────────

const RETURN_MOOD = [
  { key: 'positive',    label: 'また入りたい' },
  { key: 'conditional', label: '複雑な気持ち' },
];

const RETURN_CATEGORIES = [
  { key: 'anzen',     label: '危なかったこと',   managementKey: '安全' },
  { key: 'hinshitsu', label: '仕上がり・納まり', managementKey: '品質' },
  { key: 'koutei',    label: '段取り・待ち時間', managementKey: '工程' },
  { key: 'genka',     label: '追加・材料・経費', managementKey: '原価' },
];

let selectedMood = null;
let selectedCategories = new Set();

function goToReturn(project) {
  selectedMood = null;
  selectedCategories = new Set();
  document.getElementById('return-site-name').textContent = project.project_slug;
  document.getElementById('return-memo').value = '';

  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.classList.remove('selected');
    btn.onclick = () => {
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMood = btn.dataset.mood;
    };
  });

  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.remove('selected');
    btn.onclick = () => {
      btn.classList.toggle('selected');
      const cat = btn.dataset.cat;
      if (btn.classList.contains('selected')) {
        selectedCategories.add(cat);
      } else {
        selectedCategories.delete(cat);
      }
    };
  });

  document.getElementById('btn-back-return').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-return-send').onclick = () => {
    const memo = document.getElementById('return-memo').value;
    console.log('yamagaeshi:', {
      projectId: project.project_id,
      mood: selectedMood,
      categories: [...selectedCategories],
      message: memo,
    });
    showReturnComplete();
  };

  showScreen('screen-return');
}

function showReturnComplete() {
  const modal = document.getElementById('return-complete-modal');

  document.getElementById('btn-return-complete').onclick = () => {
    modal.hidden = true;
    showScreen('screen-site-top');
  };

  document.getElementById('btn-return-to-shimai').onclick = () => {
    modal.hidden = true;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="shimai"]').classList.add('active');
    showScreen('screen-shimai');
  };

  modal.hidden = false;
}

// ── 初期化 ───────────────────────────────────────────────
renderSiteTop();
