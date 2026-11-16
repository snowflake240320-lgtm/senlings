// navi.js — 車の印。Googleマップを、声の道案内で開く(Maps URLs。無料、API キー無し)。
//
// 2026-11-16 船長:「ほぼ文字を見ない前提」「運転してる人、みても、全然わかんない」
// - 運転中は、目ではなく耳。Senlings は行き先を渡すだけで、道は Googleマップの声に任せる。
// - 行き先は、現場の案内の「住所」。住所の文でも、緯度と経度(例:35.5,135.25)でもいい。
// - 位置や移動の履歴は取りにいかない。出発地は入れない(Googleマップが、いま居る所から始める)。

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const LATLNG = /^(-?\d{1,2}(?:\.\d{1,7})?)\s*[,、 ]\s*(-?\d{1,3}(?:\.\d{1,7})?)$/;

/** 緯度と経度として読めれば「緯度,経度」に揃える。読めなければ null。 */
export function latLng(text) {
  const m = line(text, 60).match(LATLNG);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? `${lat},${lng}` : null;
}

/** 声の道案内を開くリンク。行き先が無ければ null。 */
export function naviLink(destination) {
  const d = latLng(destination) ?? line(destination, 300);
  return d ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d)}&travelmode=driving&dir_action=navigate` : null;
}
