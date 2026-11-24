// kao.js — 顔(どこまで見せるか)。消さずに、隠すだけ。
//
// 2026-11-15〜16 船長:「完成までは、じっくり。公開は［施設の名前］にしぼる。請求などの機能や質問も省略」(施設の名前は、公開のコードには書かない)
// - この枝(fukuoka/…)の既定は「現場だけ」(genba)。施設・仕舞い・調査・ホームのタブと、請求・撮影・メモ・帰還の口を隠す。
// - 隠すだけ。定時の記録は、これまでどおり端末に積もる。あとで顔を開けば、請求書までつながる。
// - 全部の顔(zenbu)は、この端末に覚えさせたときだけ(試験と、育てる人の端末)。
// - 既定は index.html の頭の一行と同じ値にする(描く前に当てて、ちらつかせない)。試験で突き合わせる。

export const KAO_KEY = 'senlings_kao';
export const KAO_DEFAULT = 'genba';
export const KAO = Object.freeze(['genba', 'zenbu']);

/** 覚えている値から、顔を決める。知らない値は既定に倒す。 */
export function kaoOf(stored, fallback = KAO_DEFAULT) {
  return KAO.includes(stored) ? stored : fallback;
}

export function readKao() {
  try { return kaoOf(localStorage.getItem(KAO_KEY)); } catch { return KAO_DEFAULT; }
}

/** 現場だけの顔か。 */
export const genbaDake = () => readKao() === 'genba';
