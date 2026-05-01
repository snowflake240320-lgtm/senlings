/**
 * firebase.js — Firestore 連携
 *
 * CDN ESM 版（type="module" から直接 import 可能）
 * 読み込みは app.js から行う。
 *
 * 公開 API:
 *   saveProjectToFirestore(project)       → Promise<void>
 *   syncProjectsFromFirestore()           → Promise<{ added: number }>
 */

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, setDoc, doc, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { update as storageUpdate } from "./storage.js";

// ── Firebase 初期化 ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBNaj9bllnBSjlnL63smknkSK7T8SNnWZo",
  authDomain:        "senlings-7e838.firebaseapp.com",
  projectId:         "senlings-7e838",
  storageBucket:     "senlings-7e838.firebasestorage.app",
  messagingSenderId: "521527151570",
  appId:             "1:521527151570:web:7b13a05fa23b3377f6d60b",
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Firestore への保存 ───────────────────────────────────
/**
 * 現場データを Firestore の projects/{project_id} に保存する。
 * ローカル保存が成功した後に呼ぶこと（ローカルが正）。
 *
 * @param {object} project - storage.js の projects 配列の要素と同形
 * @returns {Promise<void>}
 */
export async function saveProjectToFirestore(project) {
  await setDoc(doc(db, "projects", project.project_id), project);
}

// ── Firestore からの同期 ─────────────────────────────────
/**
 * Firestore の全現場を取得し、ローカル localStorage に存在しないものを追記する。
 * 既存の project_id はスキップ（ローカルが常に正）。
 *
 * @returns {Promise<{ added: number }>}
 */
/**
 * localStorage の全現場を Firestore に一括保存する。
 * 既存ドキュメントは上書き（setDoc）。
 *
 * @param {object[]} projects - listProjects() の戻り値
 * @returns {Promise<{ count: number }>}
 */
export async function pushAllProjectsToFirestore(projects) {
  await Promise.all(
    projects.map((p) => setDoc(doc(db, "projects", p.project_id), p))
  );
  return { count: projects.length };
}

export async function syncProjectsFromFirestore() {
  const snapshot = await getDocs(collection(db, "projects"));
  const remoteProjects = snapshot.docs.map((d) => d.data());

  let added = 0;

  storageUpdate((data) => {
    const existingIds = new Set(data.projects.map((p) => p.project_id));
    for (const rp of remoteProjects) {
      if (!existingIds.has(rp.project_id)) {
        data.projects.push(rp);
        added++;
      }
    }
    return data;
  });

  return { added };
}

// ── users コレクション ───────────────────────────────────

export async function saveUserToFirestore(uid, data) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, {
    displayName:  data.displayName  ?? null,
    phoneNumber:  data.phoneNumber  ?? null,
    email:        data.email        ?? null,
    role:         data.role         ?? 'hunter',
    updatedAt:    serverTimestamp(),
  }, { merge: true });
}

export async function getUserFromFirestore(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// ── users/{uid}/assignments サブコレクション ────────────

export async function saveUserAssignment(uid, projectId, data) {
  const ref = doc(db, 'users', uid, 'assignments', projectId);
  await setDoc(ref, {
    projectId:  data.projectId,
    propertyId: data.propertyId  ?? null,
    role:       data.role        ?? 'hunter',
    status:     data.status      ?? 'active',
    joinedAt:   data.joinedAt    ?? serverTimestamp(),
  }, { merge: true });
}

export async function getUserAssignments(uid) {
  const ref = collection(db, 'users', uid, 'assignments');
  const q = query(ref, where('status', '==', 'active'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// ── properties コレクション ──────────────────────────────

export async function saveProperty(data) {
  const ref = data.propertyId
    ? doc(db, 'properties', data.propertyId)
    : doc(collection(db, 'properties'));
  await setDoc(ref, {
    displayName:  data.displayName  ?? null,
    address:      data.address      ?? null,
    coords:       data.coords       ?? null,
    handoverBase: data.handoverBase ?? {
      specialEquipment: null,
      parking:          null,
      toilet:           null,
      morningBriefing:  null,
      delivery:         null,
      access:           null,
      workHours:        null,
      contact:          null,
    },
    createdBy:    data.createdBy    ?? null,
    createdAt:    data.createdAt    ?? serverTimestamp(),
    updatedAt:    serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

export async function getProperty(propertyId) {
  const snap = await getDoc(doc(db, 'properties', propertyId));
  return snap.exists() ? { propertyId: snap.id, ...snap.data() } : null;
}

// ── workSessions コレクション ────────────────────────────

export async function saveWorkSession(data) {
  const ref = data.sessionId
    ? doc(db, 'workSessions', data.sessionId)
    : doc(collection(db, 'workSessions'));
  await setDoc(ref, {
    projectId:             data.projectId             ?? null,
    propertyId:            data.propertyId            ?? null,
    hunterUid:             data.hunterUid             ?? null,
    date:                  data.date                  ?? null,
    status:                data.status                ?? 'working',
    startedAt:             data.startedAt             ?? serverTimestamp(),
    returnedAt:            data.returnedAt            ?? null,
    coords:                data.coords                ?? null,
    relatedHelpSignalIds:  data.relatedHelpSignalIds  ?? [],
    relatedPhotoIds:       data.relatedPhotoIds        ?? [],
    createdAt:             data.createdAt             ?? serverTimestamp(),
    updatedAt:             serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

export async function getWorkSession(sessionId) {
  const snap = await getDoc(doc(db, 'workSessions', sessionId));
  return snap.exists() ? { sessionId: snap.id, ...snap.data() } : null;
}

// ── helpSignals コレクション ─────────────────────────────

export async function saveHelpSignal(data) {
  const ref = data.signalId
    ? doc(db, 'helpSignals', data.signalId)
    : doc(collection(db, 'helpSignals'));
  await setDoc(ref, {
    sessionId:   data.sessionId   ?? null,
    projectId:   data.projectId   ?? null,
    propertyId:  data.propertyId  ?? null,
    fieldKey:    data.fieldKey    ?? 'other',
    fieldLabel:  data.fieldLabel  ?? '',
    description: data.description ?? null,
    photoIds:    data.photoIds    ?? [],
    moodKey:     data.moodKey     ?? null,
    moodLabel:   data.moodLabel   ?? null,
    status:      data.status      ?? 'open',
    resolvedAt:  data.resolvedAt  ?? null,
    createdBy:   data.createdBy   ?? null,
    notifyTo:    data.notifyTo    ?? [],
    createdAt:   data.createdAt   ?? serverTimestamp(),
    updatedAt:   serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

// ── siteAliases コレクション ─────────────────────────────

export async function saveSiteAlias(data) {
  const aliasKey = (data.siteLabel ?? '')
    .replace(/\s/g, '')
    .normalize('NFKC')
    .toLowerCase();

  const ref = data.aliasId
    ? doc(db, 'siteAliases', data.aliasId)
    : doc(collection(db, 'siteAliases'));
  await setDoc(ref, {
    siteLabel:      data.siteLabel      ?? null,
    aliasKey:       aliasKey,
    normalizedName: data.normalizedName ?? null,
    propertyId:     data.propertyId     ?? null,
    projectId:      data.projectId      ?? null,
    sourceUid:      data.sourceUid      ?? null,
    confidence:     data.confidence     ?? null,
    status:         data.status         ?? 'unmatched',
    createdAt:      data.createdAt      ?? serverTimestamp(),
    updatedAt:      serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

// ── invoiceDrafts コレクション ───────────────────────────

export async function saveInvoiceDraft(data) {
  const ref = data.invoiceId
    ? doc(db, 'invoiceDrafts', data.invoiceId)
    : doc(collection(db, 'invoiceDrafts'));
  await setDoc(ref, {
    projectId:        data.projectId        ?? null,
    propertyId:       data.propertyId       ?? null,
    hunterUid:        data.hunterUid        ?? null,
    billingMonth:     data.billingMonth      ?? null,
    workSessionIds:   data.workSessionIds    ?? [],
    expenseRefs:      data.expenseRefs       ?? [],
    status:           data.status           ?? 'draft',
    version:          data.version          ?? 1,
    taxRate:          data.taxRate          ?? 0.10,
    subtotalWork:     data.subtotalWork      ?? 0,
    subtotalExpense:  data.subtotalExpense   ?? 0,
    subtotal:         data.subtotal          ?? 0,
    taxAmount:        data.taxAmount         ?? 0,
    total:            data.total             ?? 0,
    exportedAt:       data.exportedAt        ?? null,
    exportFileName:   data.exportFileName    ?? null,
    pdfExportedAt:    data.pdfExportedAt     ?? null,
    pdfFileName:      data.pdfFileName       ?? null,
    createdAt:        data.createdAt         ?? serverTimestamp(),
    updatedAt:        serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

export async function getInvoiceDraft(invoiceId) {
  const snap = await getDoc(doc(db, 'invoiceDrafts', invoiceId));
  return snap.exists() ? { invoiceId: snap.id, ...snap.data() } : null;
}
