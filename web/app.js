/**
 * app.js — Senlings v0.8.0
 * src/pwa/ モジュールとUIを接続する
 */

import { saveSession, monthlySummary, dailySummary } from "./src/pwa/work.js";
import { transition, getMode, getProjectId, Mode } from "./src/pwa/state.js";
import { generateSnapshot, UnconfirmedExpenseError } from "./src/pwa/invoice.js";
import { saveExpense, setClaimStatus, ClaimStatus } from "./src/pwa/expense.js";
import { monthlyExpenseSummary } from "./src/pwa/expenseQuery.js";
import { ensureContactSeed, getActiveContacts, getAllContacts, updateContact } from "./src/pwa/contact.js";
import { saveProject, listProjects, getProject, buildProjectId, validateSlug } from "./src/pwa/project.js";
import { update as storageUpdate } from "./src/pwa/storage.js";
import { saveProjectToFirestore, syncProjectsFromFirestore, pushAllProjectsToFirestore } from "./src/pwa/firebase.js";
import { buildPhotoFilename, savePhotoMeta, listPhotos } from "./src/pwa/photo.js";

// --- 初期化 ---
ensureContactSeed();

const now   = new Date();
const YEAR  = now.getFullYear();
const MONTH = now.getMonth() + 1;

// --- 内部状態 ---
let checkInAt       = null;
let activeProjectId = null;  // 作業フロー外でも保持（サマリー・請求用）

// --- DOM: カメラオーバーレイ ---
const cameraOverlay    = document.getElementById("camera-overlay");
const cameraVideo      = document.getElementById("camera-video");
const cameraThumbnail  = document.getElementById("camera-thumbnail");
const cameraProjectLbl = document.getElementById("camera-project-label");
const cameraCount      = document.getElementById("camera-count");
const cameraAtmosphere = document.getElementById("camera-atmosphere");
const btnShutter          = document.getElementById("btn-shutter");
const btnCameraClose      = document.getElementById("btn-camera-close");
const btnOpenCameraMove   = document.getElementById("btn-open-camera-move");
const btnOpenCameraOnsite = document.getElementById("btn-open-camera-onsite");
const moveCameraError     = document.getElementById("move-camera-error");
const onsiteCameraError   = document.getElementById("onsite-camera-error");
const photoList           = document.getElementById("photo-list");

// --- DOM: 移動モード・現場モード ---
const movePanel          = document.getElementById("move-panel");
const onsitePanel        = document.getElementById("onsite-panel");
const moveInfo           = document.getElementById("move-info");
const onsiteInfo         = document.getElementById("onsite-info");
const btnNav             = document.getElementById("btn-nav");
const btnArrive          = document.getElementById("btn-arrive");
const btnExitSite        = document.getElementById("btn-exit-site");
const btnGoHome          = document.getElementById("btn-go-home");
const btnDailySummary    = document.getElementById("btn-daily-summary");
const dailySummaryDisplay = document.getElementById("daily-summary-display");

// --- DOM: ContactMaster ---
const btnToggleContacts = document.getElementById("btn-toggle-contacts");
const contactEditor     = document.getElementById("contact-editor");
const contactRows       = document.getElementById("contact-rows");

// --- DOM: 経費 ---
const fExpCategory = document.getElementById("f-exp-category");
const fExpAmount   = document.getElementById("f-exp-amount");
const fExpMemo     = document.getElementById("f-exp-memo");
const btnAddExpense = document.getElementById("btn-add-expense");
const expenseList  = document.getElementById("expense-list");
const expenseTotal = document.getElementById("expense-total");
const expenseMsg   = document.getElementById("expense-msg");

// --- DOM: 月次サマリー ---
const summaryProjectSelect = document.getElementById("summary-project-select");
const summaryYearInput     = document.getElementById("summary-year");
const summaryMonthInput    = document.getElementById("summary-month");
const btnSummary           = document.getElementById("btn-summary");

// --- DOM: 請求下書き ---
const invoiceProjectSelect = document.getElementById("invoice-project-select");
const invoiceYearInput     = document.getElementById("invoice-year");
const invoiceMonthInput    = document.getElementById("invoice-month");

// --- DOM: 勤怠 ---
const statusDisplay  = document.getElementById("status-display");
const btnCheckin     = document.getElementById("btn-checkin");
const btnCheckout    = document.getElementById("btn-checkout");

const summaryDisplay = document.getElementById("summary-display");
const btnInvoice     = document.getElementById("btn-invoice");
const btnSkip        = document.getElementById("btn-skip-expense");
const invoiceDisplay = document.getElementById("invoice-display");

// --- セレクターの初期値（当月）---
summaryYearInput.value  = now.getFullYear();
summaryMonthInput.value = now.getMonth() + 1;
invoiceYearInput.value  = now.getFullYear();
invoiceMonthInput.value = now.getMonth() + 1;

// --- DOM: プロジェクト登録フォーム ---
const projectList      = document.getElementById("project-list");
const btnNewProject    = document.getElementById("btn-new-project");
const registrationForm = document.getElementById("registration-form");
const btnCancelProject = document.getElementById("btn-cancel-project");
const formResult       = document.getElementById("form-result");
const fStartDate       = document.getElementById("f-start-date");
const fSlug            = document.getElementById("f-slug");
const fAddress         = document.getElementById("f-address");
const fProjectCode     = document.getElementById("f-project-code");
const fContact         = document.getElementById("f-contact");
const projectIdPreview = document.getElementById("project-id-preview");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function updateStatus() {
  statusDisplay.textContent = `状態: ${getMode()}`;
}

// ================================================================
// ContactMaster 編集画面
// ================================================================
btnToggleContacts.addEventListener("click", () => {
  const isOpen = contactEditor.classList.toggle("open");
  btnToggleContacts.textContent = isOpen ? "閉じる" : "編集";
  if (isOpen) renderContactRows();
});

function renderContactRows() {
  const contacts = getAllContacts();
  contactRows.innerHTML = "";

  contacts.forEach((c) => {
    const row = document.createElement("div");
    row.className = "cm-row" + (c.active ? "" : " cm-inactive");
    row.dataset.id = c.contact_id;

    row.innerHTML = `
      <span>${c.contact_id}</span>
      <input type="text" class="cm-name"    value="${esc(c.name)}"    placeholder="氏名" />
      <input type="text" class="cm-phone"   value="${esc(c.phone)}"   placeholder="電話" />
      <input type="text" class="cm-company" value="${esc(c.company)}" placeholder="会社" />
      <input type="checkbox" class="cm-active" ${c.active ? "checked" : ""} />
      <button class="cm-save-btn">保存</button>
      <span class="cm-saved"></span>
    `;

    const btn   = row.querySelector(".cm-save-btn");
    const saved = row.querySelector(".cm-saved");

    btn.addEventListener("click", () => {
      const patch = {
        name:    row.querySelector(".cm-name").value.trim()    || "",
        phone:   row.querySelector(".cm-phone").value.trim()   || null,
        company: row.querySelector(".cm-company").value.trim() || null,
        active:  row.querySelector(".cm-active").checked,
      };

      try {
        updateContact(c.contact_id, patch);
        saved.textContent = "✓";
        row.className = "cm-row" + (patch.active ? "" : " cm-inactive");
        setTimeout(() => { saved.textContent = ""; }, 2000);
      } catch (err) {
        saved.textContent = "✗";
        saved.style.color = "#c00";
        console.error(err);
      }
    });

    contactRows.appendChild(row);
  });
}

function esc(val) {
  if (!val) return "";
  return String(val).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ================================================================
// サマリー・請求セレクターにプロジェクト一覧を描画する
// ================================================================
function renderSectionSelects(autoSelectId = null) {
  const projects = listProjects();
  const makeOptions = (currentVal) => {
    const base = '<option value="">— 現場を選択 —</option>';
    return base + projects.map((p) =>
      `<option value="${esc(p.project_id)}" ${p.project_id === currentVal ? "selected" : ""}>${esc(p.project_id)}</option>`
    ).join("");
  };

  const targetId = autoSelectId ?? activeProjectId;
  summaryProjectSelect.innerHTML = makeOptions(targetId);
  invoiceProjectSelect.innerHTML = makeOptions(targetId);

  if (targetId) activeProjectId = targetId;
}

// ================================================================
// 現場選択 → 移動モード遷移
// ================================================================
function selectProject(projectId) {
  const project = getProject(projectId);
  if (!project) return;

  const contacts = getAllContacts();
  const contact  = contacts.find((c) => c.contact_id === project.site_contact_id);

  // IDLE → MOVING
  transition(Mode.MOVING, projectId);
  activeProjectId = projectId;
  renderSectionSelects(projectId);
  updateStatus();

  // Google Maps URL（住所ベース）
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`;

  // 移動モードパネルを表示
  const contactLabel = contact
    ? [contact.name, contact.phone].filter(Boolean).join("　") || contact.contact_id
    : project.site_contact_id;

  moveInfo.innerHTML = [
    `<strong>現場</strong>${esc(project.project_id)}`,
    `<strong>住所</strong>${esc(project.address)}`,
    `<strong>窓口</strong>${esc(contactLabel)}`,
  ].join("<br>");

  btnNav.onclick = () => window.open(mapsUrl, "_blank");

  movePanel.classList.add("active");
  btnNewProject.disabled = true;
}

// ================================================================
// [到着] → ON_SITE 遷移
// ================================================================
btnArrive.addEventListener("click", () => {
  const projectId = getProjectId();
  const project   = getProject(projectId);

  // MOVING → ON_SITE
  transition(Mode.ON_SITE);
  updateStatus();

  // event_log に ARRIVED_ON_SITE を記録
  storageUpdate((data) => {
    data.event_log.push({
      type:       "ARRIVED_ON_SITE",
      project_id: projectId,
      at:         Date.now(),
    });
    return data;
  });

  movePanel.classList.remove("active");

  onsiteInfo.innerHTML = [
    `<strong>現場</strong>${esc(project?.project_id ?? projectId)}`,
    `<strong>住所</strong>${esc(project?.address ?? "")}`,
  ].join("<br>");

  onsitePanel.classList.add("active");
  renderExpenseList(projectId);
  renderPhotoList(projectId);
});

// ================================================================
// [帰宅] → MOVING → IDLE + 日次サマリー自動表示
// ================================================================
btnGoHome.addEventListener("click", () => {
  // MOVING → IDLE
  transition(Mode.IDLE);
  updateStatus();

  movePanel.classList.remove("active");
  btnNewProject.disabled = false;

  const today = new Date().toISOString().slice(0, 10);
  renderDailySummary(today);
  dailySummaryDisplay.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ================================================================
// 日次サマリー描画
// ================================================================
function renderDailySummary(date) {
  const result = dailySummary(date);
  const { expenses } = monthlyExpenseSummary(
    result.sessions[0]?.project_id ?? activeProjectId ?? "",
    new Date(date).getFullYear(),
    new Date(date).getMonth() + 1
  );

  const workH  = Math.floor(result.total_work_minutes / 60);
  const workM  = result.total_work_minutes % 60;
  const transH = Math.floor(result.total_transport_minutes / 60);
  const transM = result.total_transport_minutes % 60;
  const activeH = Math.floor(result.total_active_minutes / 60);
  const activeM = result.total_active_minutes % 60;

  // 当日経費（全現場）
  const todayExpenses = expenses.filter((e) => e.expense_date === date);
  const expenseTotal  = todayExpenses.reduce((s, e) => s + e.amount, 0);

  const projectIds = [...new Set(result.sessions.map((s) => s.project_id))];

  const lines = [
    `日付:         ${date}`,
    `現場数:       ${projectIds.length} 件（${projectIds.join(", ") || "なし"}）`,
    `勤務時間:     ${workH}時間${workM}分`,
    `移動時間:     ${transH}時間${transM}分`,
    `総稼働時間:   ${activeH}時間${activeM}分`,
    `セッション:   ${result.session_count} 件`,
    `当日経費:     ¥${expenseTotal.toLocaleString()}`,
  ];

  dailySummaryDisplay.textContent = lines.join("\n");
  dailySummaryDisplay.classList.add("active");
}

btnDailySummary.addEventListener("click", () => {
  const today = new Date().toISOString().slice(0, 10);
  renderDailySummary(today);
});

// ================================================================
// [終了] → MOVING 遷移（ON_SITE_MODE → MOVE_MODE）
// ================================================================
btnExitSite.addEventListener("click", () => {
  const projectId = getProjectId();

  // ON_SITE → MOVING
  transition(Mode.MOVING);
  updateStatus();

  // event_log に EXIT_SITE を記録
  storageUpdate((data) => {
    data.event_log.push({
      type:       "EXIT_SITE",
      project_id: projectId,
      at:         Date.now(),
    });
    return data;
  });

  onsitePanel.classList.remove("active");

  // 移動モードパネルを再表示
  selectProjectPanel(projectId);
});

function selectProjectPanel(projectId) {
  const project  = getProject(projectId);
  const contacts = getAllContacts();
  const contact  = contacts.find((c) => c.contact_id === project?.site_contact_id);
  const mapsUrl  = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project?.address ?? "")}`;

  const contactLabel = contact
    ? [contact.name, contact.phone].filter(Boolean).join("　") || contact.contact_id
    : project?.site_contact_id ?? "";

  moveInfo.innerHTML = [
    `<strong>現場</strong>${esc(project?.project_id ?? projectId)}`,
    `<strong>住所</strong>${esc(project?.address ?? "")}`,
    `<strong>窓口</strong>${esc(contactLabel)}`,
  ].join("<br>");

  btnNav.onclick = () => window.open(mapsUrl, "_blank");
  movePanel.classList.add("active");
}

// ================================================================
// プロジェクト一覧を描画する
// ================================================================
function renderProjectList() {
  const projects = listProjects();
  if (projects.length === 0) {
    projectList.innerHTML = "<li>（登録なし）</li>";
    return;
  }
  projectList.innerHTML = projects
    .map((p) => `
      <li>
        <strong>${esc(p.project_id)}</strong>　${esc(p.address)}
        <button class="project-select-btn" data-id="${esc(p.project_id)}">選択</button>
      </li>`)
    .join("");

  projectList.querySelectorAll(".project-select-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (getMode() !== Mode.IDLE) return;
      selectProject(btn.dataset.id);
    });
  });

  renderSectionSelects();
}

// ================================================================
// Firestore 一括同期ボタン
// ================================================================
const btnPushFirestore      = document.getElementById("btn-push-firestore");
const pushFirestoreResult   = document.getElementById("push-firestore-result");

btnPushFirestore.addEventListener("click", async () => {
  const projects = listProjects();
  if (projects.length === 0) {
    pushFirestoreResult.textContent = "同期する現場がありません。";
    pushFirestoreResult.style.color = "#888";
    return;
  }

  btnPushFirestore.disabled       = true;
  pushFirestoreResult.textContent = "同期中…";
  pushFirestoreResult.style.color = "#555";

  try {
    const { count } = await pushAllProjectsToFirestore(projects);
    pushFirestoreResult.textContent = `✓ ${count}件をFirestoreに同期しました`;
    pushFirestoreResult.style.color = "#080";
  } catch (err) {
    pushFirestoreResult.textContent = `エラー: ${err.message}`;
    pushFirestoreResult.style.color = "#c00";
    console.error("Firestore一括同期失敗:", err);
  } finally {
    btnPushFirestore.disabled = false;
    setTimeout(() => { pushFirestoreResult.textContent = ""; }, 4000);
  }
});

// ================================================================
// 現場窓口プルダウンを描画する
// ================================================================
function renderContactOptions() {
  const contacts = getActiveContacts();
  fContact.innerHTML = '<option value="">— 選択してください —</option>';
  contacts.forEach((c) => {
    const label = [c.role, c.name, c.phone].filter(Boolean).join("｜") || c.contact_id;
    const opt   = document.createElement("option");
    opt.value       = c.contact_id;
    opt.textContent = `${c.contact_id}：${label}`;
    fContact.appendChild(opt);
  });
}

// ================================================================
// project_id プレビュー（リアルタイム更新）
// ================================================================
function updateIdPreview() {
  const date = fStartDate.value;
  const slug = fSlug.value.trim();
  if (date && slug) {
    projectIdPreview.textContent = `project_id: ${buildProjectId(date, slug)}`;
  } else {
    projectIdPreview.textContent = "";
  }
}

fStartDate.addEventListener("input", updateIdPreview);
fSlug.addEventListener("input", updateIdPreview);

// ================================================================
// フォーム 開閉
// ================================================================
btnNewProject.addEventListener("click", () => {
  registrationForm.classList.add("open");
  renderContactOptions();
  formResult.textContent = "";
  formResult.className   = "";
  btnNewProject.disabled = true;
});

btnCancelProject.addEventListener("click", () => {
  registrationForm.classList.remove("open");
  registrationForm.reset();
  projectIdPreview.textContent = "";
  formResult.textContent       = "";
  formResult.className         = "";
  btnNewProject.disabled       = false;
  clearErrors();
});

// ================================================================
// バリデーションヘルパー
// ================================================================
function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearErrors() {
  ["err-start-date", "err-slug", "err-address", "err-contact"].forEach((id) =>
    setError(id, "")
  );
  [fStartDate, fSlug, fAddress, fContact].forEach((el) => el.classList.remove("error"));
}

// ================================================================
// フォーム送信 → saveProject()
// ================================================================
registrationForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearErrors();

  const startDate   = fStartDate.value;
  const slug        = fSlug.value.trim();
  const address     = fAddress.value.trim();
  const projectCode = fProjectCode.value.trim() || null;
  const contactId   = fContact.value;

  // --- バリデーション ---
  let hasError = false;

  if (!startDate) {
    setError("err-start-date", "工期開始日は必須です");
    fStartDate.classList.add("error");
    hasError = true;
  }

  const slugError = validateSlug(slug);
  if (slugError) {
    setError("err-slug", slugError);
    fSlug.classList.add("error");
    hasError = true;
  }

  if (!address) {
    setError("err-address", "住所は必須です");
    fAddress.classList.add("error");
    hasError = true;
  }

  if (!contactId) {
    setError("err-contact", "現場窓口を選択してください");
    fContact.classList.add("error");
    hasError = true;
  }

  if (hasError) return;

  // --- 攻略情報 ---
  const siteInfo = {
    entrance:         document.getElementById("f-entrance").value.trim()  || null,
    parking:          document.getElementById("f-parking").value.trim()   || null,
    delivery:         document.getElementById("f-delivery").value.trim()  || null,
    morning_assembly: document.getElementById("f-morning-assembly").value === ""
                        ? null
                        : document.getElementById("f-morning-assembly").value === "true",
    equipment:        document.getElementById("f-equipment").value.trim() || null,
    toilet:           document.getElementById("f-toilet").value.trim()    || null,
    smoking:          document.getElementById("f-smoking").value.trim()   || null,
  };

  const project_id = buildProjectId(startDate, slug);

  try {
    const projectData = {
      project_id,
      project_slug:    slug.toUpperCase(),
      start_date:      startDate,
      address,
      project_code:    projectCode,
      site_contact_id: contactId,
      site_info:       siteInfo,
      created_at:      Date.now(),
      archive:         false,
    };

    saveProject(projectData);

    // Firestore にも保存（失敗してもローカル保存は有効）
    saveProjectToFirestore(projectData).catch((err) =>
      console.warn("Firestore保存失敗（ローカルには保存済み）:", err.message)
    );

    formResult.textContent = `✓ 登録完了: ${project_id}`;
    formResult.className   = "success";
    renderProjectList();

    setTimeout(() => {
      registrationForm.classList.remove("open");
      registrationForm.reset();
      projectIdPreview.textContent = "";
      formResult.textContent       = "";
      formResult.className         = "";
      btnNewProject.disabled       = false;
    }, 1500);

  } catch (err) {
    formResult.textContent = `エラー: ${err.message}`;
    formResult.className   = "error";
  }
});

// ================================================================
// カメラ機能（PHOTO_CAPTURE_SPEC 準拠）
// ================================================================
let cameraStream    = null;
let captureCanvas   = null;
let sessionPhotoCount = 0;

async function openCamera(errorEl) {
  const projectId = getProjectId();
  if (!projectId) return;

  errorEl.textContent = "";

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });

    cameraVideo.srcObject = cameraStream;
    cameraProjectLbl.textContent = projectId;
    sessionPhotoCount = listPhotos(projectId).length;
    cameraCount.textContent = `${sessionPhotoCount} 枚`;
    cameraAtmosphere.value = "";
    cameraThumbnail.classList.remove("flash");
    cameraOverlay.classList.add("active");

    if (!captureCanvas) captureCanvas = document.createElement("canvas");

  } catch (err) {
    errorEl.textContent = "📵 カメラがブロックされています。\n① アドレスバー（画面上部のURL欄）の左端のアイコンをタップ\n② カメラを「許可」に変更\n③ ページを再読み込み（リロード）してください。";
    storageUpdate((data) => {
      data.event_log.push({ type: "CAMERA_ERROR", error: err.message, at: Date.now() });
      return data;
    });
  }
}

btnOpenCameraMove.addEventListener("click",   () => openCamera(moveCameraError));
btnOpenCameraOnsite.addEventListener("click", () => openCamera(onsiteCameraError));

btnShutter.addEventListener("click", () => {
  const projectId = getProjectId();
  if (!cameraStream || !projectId) return;

  const { filename, takenAt } = buildPhotoFilename(projectId);
  const atmosphere = cameraAtmosphere.value.trim().slice(0, 100) || null;

  // キャプチャ
  const vw = cameraVideo.videoWidth  || 1280;
  const vh = cameraVideo.videoHeight || 720;
  captureCanvas.width  = vw;
  captureCanvas.height = vh;
  const ctx = captureCanvas.getContext("2d");
  ctx.drawImage(cameraVideo, 0, 0, vw, vh);

  // サムネイル（64px）
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbCanvas.height = 128;
  const tctx = thumbCanvas.getContext("2d");
  const scale = Math.min(128 / vw, 128 / vh);
  tctx.drawImage(cameraVideo, 0, 0, vw * scale, vh * scale);
  const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.6);

  // JPEG としてダウンロード保存
  captureCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, "image/jpeg", 0.92);

  // メタデータ保存
  savePhotoMeta({
    id:         uid(),
    project_id: projectId,
    filename,
    atmosphere,
    thumbnail,
    taken_at:   takenAt,
  });

  // サムネイルフラッシュ（1秒）
  cameraThumbnail.src = thumbnail;
  cameraThumbnail.classList.add("flash");
  setTimeout(() => cameraThumbnail.classList.remove("flash"), 1000);

  sessionPhotoCount++;
  cameraCount.textContent   = `${sessionPhotoCount} 枚`;
  cameraAtmosphere.value    = "";

  renderPhotoList(projectId);
});

btnCameraClose.addEventListener("click", () => closeCamera());

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraOverlay.classList.remove("active");
}

function renderPhotoList(projectId) {
  const photos = listPhotos(projectId);
  if (photos.length === 0) {
    photoList.innerHTML = "";
    return;
  }
  // 直近10枚を新しい順に表示
  photoList.innerHTML = photos
    .slice(-10)
    .reverse()
    .map((p) => p.thumbnail
      ? `<img src="${p.thumbnail}" title="${esc(p.filename)}" />`
      : `<span style="font-size:0.75rem;color:#888">${esc(p.filename)}</span>`
    ).join("");
}

// ================================================================
// 経費追加 → expense.js の saveExpense()
// ================================================================
const CATEGORY_LABEL = {
  parking:        "駐車場",
  toll:           "高速代",
  fuel:           "燃料",
  material_small: "軽微材料",
  tool_rental:    "道具レンタル",
  other:          "その他",
};

btnAddExpense.addEventListener("click", () => {
  const projectId = getProjectId();
  const category  = fExpCategory.value;
  const amount    = parseInt(fExpAmount.value, 10);
  const memo      = fExpMemo.value.trim() || null;

  if (!amount || amount <= 0) {
    expenseMsg.textContent = "金額を入力してください。";
    expenseMsg.style.color = "#c00";
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  saveExpense({
    id:           uid(),
    project_id:   projectId,
    expense_date: today,
    category,
    amount,
    memo,
    created_at:   Date.now(),
  });

  fExpAmount.value = "";
  fExpMemo.value   = "";
  expenseMsg.textContent = `✓ 追加しました（¥${amount.toLocaleString()}）`;
  expenseMsg.style.color = "#080";
  setTimeout(() => { expenseMsg.textContent = ""; }, 2000);

  renderExpenseList(projectId);
});

function renderExpenseList(projectId) {
  const { expenses, total } = monthlyExpenseSummary(projectId, YEAR, MONTH);

  if (expenses.length === 0) {
    expenseList.innerHTML = "";
    expenseTotal.textContent = "";
    return;
  }

  expenseList.innerHTML = expenses.map((e) => `
    <li>
      <span class="exp-label">${esc(CATEGORY_LABEL[e.category] ?? e.category)}${e.memo ? `　${esc(e.memo)}` : ""}</span>
      <span class="exp-amount">¥${e.amount.toLocaleString()}</span>
    </li>
  `).join("");

  expenseTotal.textContent = `合計: ¥${total.toLocaleString()}`;
}

// ================================================================
// 出勤ボタン → ON_SITE → WORKING（選択中の現場に紐づけ）
// ================================================================
btnCheckin.addEventListener("click", () => {
  // ON_SITE → WORKING
  transition(Mode.WORKING);
  checkInAt = Date.now();
  btnCheckin.disabled  = true;
  btnCheckout.disabled = false;
  updateStatus();
});

// ================================================================
// 退勤ボタン → work.js saveSession() + WORKING → ON_SITE
// ================================================================
btnCheckout.addEventListener("click", () => {
  const projectId  = getProjectId();
  const checkOutAt = Date.now();

  saveSession({
    id:            uid(),
    project_id:    projectId,
    check_in_at:   checkInAt,
    check_out_at:  checkOutAt,
    break_minutes: 0,
  });

  // WORKING → ON_SITE（現場モードに留まる）
  transition(Mode.ON_SITE);
  checkInAt = null;
  btnCheckin.disabled  = false;
  btnCheckout.disabled = true;
  updateStatus();
});

// ================================================================
// 月次サマリー → work.js の monthlySummary()（セレクター連動）
// ================================================================
btnSummary.addEventListener("click", () => {
  const projectId = summaryProjectSelect.value;
  const year      = parseInt(summaryYearInput.value, 10);
  const month     = parseInt(summaryMonthInput.value, 10);

  if (!projectId) { summaryDisplay.textContent = "現場を選択してください。"; return; }
  if (!year || !month) { summaryDisplay.textContent = "年月を入力してください。"; return; }

  const result  = monthlySummary(projectId, year, month);
  const hours   = Math.floor(result.total_work_minutes / 60);
  const minutes = result.total_work_minutes % 60;

  summaryDisplay.textContent = [
    `現場: ${projectId}`,
    `期間: ${year}/${String(month).padStart(2, "0")}`,
    `勤務日数: ${result.total_days} 日`,
    `勤務時間: ${hours}時間${minutes}分`,
    `超過時間: ${result.total_overtime_hours.toFixed(2)}時間`,
    `セッション数: ${result.sessions.length} 件`,
  ].join("\n");
});

// ================================================================
// 請求下書き → invoice.js の generateSnapshot()（セレクター連動）
// ================================================================
btnInvoice.addEventListener("click", () => {
  const projectId = invoiceProjectSelect.value;
  const year      = parseInt(invoiceYearInput.value, 10);
  const month     = parseInt(invoiceMonthInput.value, 10);

  if (!projectId) { invoiceDisplay.textContent = "現場を選択してください。"; return; }
  if (!year || !month) { invoiceDisplay.textContent = "年月を入力してください。"; return; }
  const project = getProject(projectId);
  invoiceDisplay.textContent = "";
  invoiceDisplay.className   = "";
  btnSkip.style.display      = "none";
  btnSkip.dataset.projectId  = projectId;
  btnSkip.dataset.year       = year;
  btnSkip.dataset.month      = month;

  try {
    const snapshot = generateSnapshot({
      snapshot_id:  uid(),
      project_id:   projectId,
      project_code: project?.project_code ?? null,
      year,
      month,
    });

    invoiceDisplay.textContent = formatSnapshot(snapshot);

  } catch (err) {
    if (err instanceof UnconfirmedExpenseError) {
      invoiceDisplay.className   = "warn";
      invoiceDisplay.textContent = "⚠ 経費が未確定です。\n" + err.message;
      btnSkip.style.display      = "inline-block";
    } else {
      invoiceDisplay.textContent = `エラー: ${err.message}`;
    }
  }
});

btnSkip.addEventListener("click", () => {
  const projectId = btnSkip.dataset.projectId;
  const year      = parseInt(btnSkip.dataset.year, 10);
  const month     = parseInt(btnSkip.dataset.month, 10);
  const project   = getProject(projectId);

  setClaimStatus(projectId, year, month, ClaimStatus.SKIPPED);
  btnSkip.style.display = "none";

  const snapshot = generateSnapshot({
    snapshot_id:  uid(),
    project_id:   projectId,
    project_code: project?.project_code ?? null,
    year,
    month,
  });

  invoiceDisplay.className   = "";
  invoiceDisplay.textContent = formatSnapshot(snapshot);
});

function formatSnapshot(s) {
  const hours   = Math.floor(s.total_work_minutes / 60);
  const minutes = s.total_work_minutes % 60;

  return [
    `[Invoice Snapshot]`,
    `snapshot_id:   ${s.snapshot_id}`,
    `period:        ${s.period_start} 〜 ${s.period_end}`,
    `勤務日数:      ${s.total_work_days} 日`,
    `勤務時間:      ${hours}時間${minutes}分`,
    `超過時間:      ${s.total_overtime_hours.toFixed(2)}時間`,
    `経費合計:      ¥${s.total_expense_amount.toLocaleString()}`,
    `経費状態:      ${s.expense_claim_status}`,
    `source_hash:   ${s.source_hash}`,
    `generated_at:  ${new Date(s.generated_at).toLocaleString()}`,
    ``,
    `[日別内訳]`,
    ...s.daily_breakdown.map(
      (d) => `  ${d.date}  ${d.work_minutes}分  ${d.session_count}件`
    ),
  ].join("\n");
}

// --- 初期描画 ---
renderProjectList();
updateStatus();
console.log("Senlings v0.10.0 loaded");

// --- Firestore 同期（バックグラウンド） ---
syncProjectsFromFirestore()
  .then(({ added }) => {
    if (added > 0) {
      renderProjectList();
      console.log(`Firestore: ${added}件の現場を同期しました`);
    }
  })
  .catch((err) => console.warn("Firestore同期失敗:", err.message));
