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
