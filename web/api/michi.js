// 決まった住所の掲示板(2026-11-17 船長「ホーム画面に登録するには？」→「Bにしましょう」)。
// /m/<名> は /?m=<名> になる(web/vercel.json。Vercel の Root Directory は web)。アプリはここから、その名のいちばん新しい施設の地図
// (現場案内の封筒のリンクの中身)を一つ読む。
// - 中身は公開のコードには置かない。Vercel の Global Config(Edge Config)の michi_<名> に置く
//   (藍か船長が差し替える)。つなぐ先は環境変数 SENLINGS_MICHI_CONFIG(https://…/<id>?token=…)。
// - 置くのは施設の地図(場所の点と、その現場の案内)だけ。人の記録・依頼は置かない。読むだけで、書く口は無い。
// - 誰が読んだか、どこから読んだかは残さない。返すのは中身だけ(鍵は返さない)。
const NAME = /^[a-z0-9-]{1,40}$/;
const CODE = /^[A-Za-z0-9_-]{8,6000}$/;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'method' });
  const name = typeof req.query?.name === 'string' ? req.query.name : '';
  if (!NAME.test(name)) return res.status(400).json({ error: 'name' });

  let base;
  try { base = new URL(process.env.SENLINGS_MICHI_CONFIG ?? ''); } catch { return res.status(503).json({ error: 'board' }); }
  const token = base.searchParams.get('token');
  if (!token || base.protocol !== 'https:') return res.status(503).json({ error: 'board' });

  let r;
  try {
    r = await fetch(`${base.origin}${base.pathname.replace(/\/$/, '')}/item/michi_${name}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch { return res.status(502).json({ error: 'board' }); }
  if (r.status === 404) return res.status(404).json({ error: 'none' });
  if (!r.ok) return res.status(502).json({ error: 'board' });

  let value;
  try { value = await r.json(); } catch { return res.status(502).json({ error: 'board' }); }
  const code = typeof value === 'string' ? value : value?.code;
  if (typeof code !== 'string' || !CODE.test(code)) return res.status(502).json({ error: 'board' });
  return res.status(200).json({ code });
};
