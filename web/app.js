/**
 * app.js — Senlings v0.6.0
 * src/pwa/ モジュールとUIを接続する
 */

import { saveSession, monthlySummary } from "../src/pwa/work.js";
import { transition, getMode, getProjectId, Mode } from "../src/pwa/state.js";
import { generateSnapshot, UnconfirmedExpenseError } from "../src/pwa/invoice.js";
import { setClaimStatus, ClaimStatus } from "../src/pwa/expense.js";
import { ensureContactSeed, getActiveContacts, getAllContacts, updateContact } from "../src/pwa/contact.js";
import { saveProject, listProjects, getProject, buildProjectId, validateSlug } from "../src/pwa/project.js";
import { update as storageUpdate } from "../src/pwa/storage.js";

// --- 初期化 ---
ensureContactSeed();

const now   = new Date();
const YEAR  = now.getFullYear();
const MONTH = now.getMonth() + 1;

// --- 内部状態 ---
let checkInAt = null;

// --- DOM: 移動モード・現場モード ---
const movePanel   = document.getElementById("move-panel");
const onsitePanel = document.getElementById("onsite-panel");
const moveInfo    = document.getElementById("move-info");
const onsiteInfo  = document.getElementById("onsite-info");
const btnNav      = document.getElementById("btn-nav");
const btnArrive   = document.getElementById("btn-arrive");
const btnExitSite = document.getElementById("btn-exit-site");

// --- DOM: ContactMaster ---
const btnToggleContacts = document.getElementById("btn-toggle-contacts");
const contactEditor     = document.getElementById("contact-editor");
const contactRows       = document.getElementById("contact-rows");

// --- DOM: 勤怠・請求 ---
const statusDisplay  = document.getElementById("status-display");
const btnCheckin     = document.getElementById("btn-checkin");
const btnCheckout    = document.getElementById("btn-checkout");
const btnSummary     = document.getElementById("btn-summary");

const summaryDisplay = document.getElementById("summary-display");
const btnInvoice     = document.getElementById("btn-invoice");
const btnSkip        = document.getElementById("btn-skip-expense");
const invoiceDisplay = document.getElementById("invoice-display");

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
// 現場選択 → 移動モード遷移
// ================================================================
function selectProject(projectId) {
  const project = getProject(projectId);
  if (!project) return;

  const contacts = getAllContacts();
  const contact  = contacts.find((c) => c.contact_id === project.site_contact_id);

  // IDLE → MOVING
  transition(Mode.MOVING, projectId);
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
}

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
    saveProject({
      project_id,
      project_slug:    slug.toUpperCase(),
      start_date:      startDate,
      address,
      project_code:    projectCode,
      site_contact_id: contactId,
      site_info:       siteInfo,
      created_at:      Date.now(),
    });

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
// 月次サマリー → work.js の monthlySummary()（選択中の現場）
// ================================================================
btnSummary.addEventListener("click", () => {
  const projectId = getProjectId();
  if (!projectId) {
    summaryDisplay.textContent = "現場を選択してください。";
    return;
  }

  const result  = monthlySummary(projectId, YEAR, MONTH);
  const hours   = Math.floor(result.total_work_minutes / 60);
  const minutes = result.total_work_minutes % 60;

  summaryDisplay.textContent = [
    `現場: ${projectId}`,
    `期間: ${YEAR}/${String(MONTH).padStart(2, "0")}`,
    `勤務日数: ${result.total_days} 日`,
    `勤務時間: ${hours}時間${minutes}分`,
    `超過時間: ${result.total_overtime_hours.toFixed(2)}時間`,
    `セッション数: ${result.sessions.length} 件`,
  ].join("\n");
});

// ================================================================
// 請求下書き → invoice.js の generateSnapshot()（選択中の現場）
// ================================================================
btnInvoice.addEventListener("click", () => {
  const projectId = getProjectId();
  if (!projectId) {
    invoiceDisplay.textContent = "現場を選択してください。";
    return;
  }

  const project = getProject(projectId);
  invoiceDisplay.textContent = "";
  invoiceDisplay.className   = "";
  btnSkip.style.display      = "none";

  transition(Mode.INVOICE_REVIEW);

  try {
    transition(Mode.SNAPSHOT_READY);

    const snapshot = generateSnapshot({
      snapshot_id:  uid(),
      project_id:   projectId,
      project_code: project?.project_code ?? null,
      year:         YEAR,
      month:        MONTH,
    });

    transition(Mode.CONFIRMED);
    transition(Mode.IDLE);
    updateStatus();
    invoiceDisplay.textContent = formatSnapshot(snapshot);

  } catch (err) {
    if (err instanceof UnconfirmedExpenseError) {
      transition(Mode.WARNING);
      updateStatus();
      invoiceDisplay.className   = "warn";
      invoiceDisplay.textContent = "⚠ 経費が未確定です。\n" + err.message;
      btnSkip.style.display      = "inline-block";
    } else {
      transition(Mode.IDLE);
      updateStatus();
      invoiceDisplay.textContent = `エラー: ${err.message}`;
    }
  }
});

btnSkip.addEventListener("click", () => {
  const projectId = getProjectId();
  const project   = getProject(projectId);

  setClaimStatus(projectId, YEAR, MONTH, ClaimStatus.SKIPPED);
  btnSkip.style.display = "none";

  const snapshot = generateSnapshot({
    snapshot_id:  uid(),
    project_id:   projectId,
    project_code: project?.project_code ?? null,
    year:         YEAR,
    month:        MONTH,
  });

  transition(Mode.CONFIRMED);
  transition(Mode.IDLE);
  updateStatus();
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
console.log("Senlings v0.6.0 loaded");
