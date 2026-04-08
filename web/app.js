/**
 * app.js — Senlings v0.3.0
 * src/pwa/ モジュールとUIを接続する
 */

import { saveSession, monthlySummary } from "../src/pwa/work.js";
import { transition, getMode, Mode } from "../src/pwa/state.js";
import { generateSnapshot, UnconfirmedExpenseError } from "../src/pwa/invoice.js";
import { setClaimStatus, ClaimStatus } from "../src/pwa/expense.js";
import { ensureContactSeed, getActiveContacts, getAllContacts, updateContact } from "../src/pwa/contact.js";
import { saveProject, listProjects, buildProjectId, validateSlug } from "../src/pwa/project.js";

// --- 初期化 ---
ensureContactSeed();

// --- デモ用固定値（勤怠・請求） ---
const PROJECT_ID   = "20250201_SHIBUYA";
const PROJECT_CODE = null;
const now          = new Date();
const YEAR         = now.getFullYear();
const MONTH        = now.getMonth() + 1;

// --- 内部状態 ---
let checkInAt = null;

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
// プロジェクト一覧を描画する
// ================================================================
function renderProjectList() {
  const projects = listProjects();
  if (projects.length === 0) {
    projectList.innerHTML = "<li>（登録なし）</li>";
    return;
  }
  projectList.innerHTML = projects
    .map((p) => `<li><strong>${p.project_id}</strong>　${p.address}</li>`)
    .join("");
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
// 出勤ボタン → work.js の saveSession() への接続起点
// ================================================================
btnCheckin.addEventListener("click", () => {
  transition(Mode.MOVING,  PROJECT_ID);
  transition(Mode.ON_SITE, PROJECT_ID);
  transition(Mode.WORKING, PROJECT_ID);

  checkInAt = Date.now();
  btnCheckin.disabled  = true;
  btnCheckout.disabled = false;
  updateStatus();
});

// ================================================================
// 退勤ボタン → state.js の transition() + work.js の saveSession()
// ================================================================
btnCheckout.addEventListener("click", () => {
  const checkOutAt = Date.now();

  saveSession({
    id:            uid(),
    project_id:    PROJECT_ID,
    check_in_at:   checkInAt,
    check_out_at:  checkOutAt,
    break_minutes: 0,
  });

  transition(Mode.ON_SITE);
  transition(Mode.MOVING);
  transition(Mode.IDLE);

  checkInAt = null;
  btnCheckin.disabled  = false;
  btnCheckout.disabled = true;
  updateStatus();
});

// ================================================================
// 月次サマリー → work.js の monthlySummary()
// ================================================================
btnSummary.addEventListener("click", () => {
  const result  = monthlySummary(PROJECT_ID, YEAR, MONTH);
  const hours   = Math.floor(result.total_work_minutes / 60);
  const minutes = result.total_work_minutes % 60;

  summaryDisplay.textContent = [
    `期間: ${YEAR}/${String(MONTH).padStart(2, "0")}`,
    `勤務日数: ${result.total_days} 日`,
    `勤務時間: ${hours}時間${minutes}分`,
    `超過時間: ${result.total_overtime_hours.toFixed(2)}時間`,
    `セッション数: ${result.sessions.length} 件`,
  ].join("\n");
});

// ================================================================
// 請求下書き → invoice.js の generateSnapshot()
// ================================================================
btnInvoice.addEventListener("click", () => {
  invoiceDisplay.textContent = "";
  invoiceDisplay.className   = "";
  btnSkip.style.display      = "none";

  transition(Mode.INVOICE_REVIEW);

  try {
    transition(Mode.SNAPSHOT_READY);

    const snapshot = generateSnapshot({
      snapshot_id:  uid(),
      project_id:   PROJECT_ID,
      project_code: PROJECT_CODE,
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
  setClaimStatus(PROJECT_ID, YEAR, MONTH, ClaimStatus.SKIPPED);
  btnSkip.style.display = "none";

  const snapshot = generateSnapshot({
    snapshot_id:  uid(),
    project_id:   PROJECT_ID,
    project_code: PROJECT_CODE,
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
console.log("Senlings v0.3.0 loaded");
