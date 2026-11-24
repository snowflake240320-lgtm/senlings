// 決まった住所の掲示板(11-17 船長「Bにしましょう」)。中身はすべて架空。掲示板(Global Config)は代役
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const handler = require('../web/api/michi.js');
const CONN = 'https://global-config.example/ecfg_kakuu?token=kakuu-token';
const CODE = 'zKAKUUkakuu_-0123456789';

async function call(query, opts = {}) {
  const { board = async () => new Response(JSON.stringify({ code: CODE }), { status: 200 }), method = 'GET' } = opts;
  const env = 'env' in opts ? opts.env : CONN; // 「つなぎ先が無い」(undefined)も試せるように
  const asked = [];
  const saved = { fetch: globalThis.fetch, env: process.env.SENLINGS_MICHI_CONFIG };
  globalThis.fetch = async (url, opts) => { asked.push({ url: String(url), auth: opts?.headers?.Authorization }); return board(url, opts); };
  if (env === undefined) delete process.env.SENLINGS_MICHI_CONFIG; else process.env.SENLINGS_MICHI_CONFIG = env;
  const res = { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
  try { await handler({ method, query }, res); } finally {
    globalThis.fetch = saved.fetch;
    if (saved.env === undefined) delete process.env.SENLINGS_MICHI_CONFIG; else process.env.SENLINGS_MICHI_CONFIG = saved.env;
  }
  return { res, asked };
}

test('掲示板:名前ひとつで、いちばん新しい地図の中身だけを返す。鍵は返さない。覚えさせない(no-store)', async () => {
  const { res, asked } = await call({ name: 'kakuu' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { code: CODE });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(asked, [{ url: 'https://global-config.example/ecfg_kakuu/item/michi_kakuu', auth: 'Bearer kakuu-token' }]);
  assert.ok(!JSON.stringify(res.body).includes('kakuu-token'));
  const plain = await call({ name: 'kakuu-2' }, { board: async () => new Response(JSON.stringify(CODE), { status: 200 }) });
  assert.deepEqual(plain.res.body, { code: CODE }, 'a bare string on the board is read too');
});

test('掲示板:決まりに合わない名前・読む以外・つなぎ先が無いときは、掲示板に聞かない', async () => {
  for (const name of ['', 'Kakuu', '../x', 'a b', 'x'.repeat(41), undefined]) {
    const { res, asked } = await call({ name });
    assert.equal(res.statusCode, 400, String(name)); assert.equal(asked.length, 0);
  }
  assert.equal((await call({ name: 'kakuu' }, { method: 'POST' })).res.statusCode, 405);
  for (const env of [undefined, '', 'not a url', 'https://global-config.example/ecfg_kakuu', 'http://global-config.example/ecfg_kakuu?token=t']) {
    const { res, asked } = await call({ name: 'kakuu' }, { env });
    assert.equal(res.statusCode, 503, String(env)); assert.equal(asked.length, 0);
  }
});

test('掲示板:無い名前は 404、掲示板が読めない・中身が封筒の形でないときは 502(当て推量で返さない)', async () => {
  assert.equal((await call({ name: 'kakuu' }, { board: async () => new Response('{}', { status: 404 }) })).res.statusCode, 404);
  assert.equal((await call({ name: 'kakuu' }, { board: async () => new Response('{}', { status: 500 }) })).res.statusCode, 502);
  assert.equal((await call({ name: 'kakuu' }, { board: async () => { throw new Error('offline'); } })).res.statusCode, 502);
  assert.equal((await call({ name: 'kakuu' }, { board: async () => new Response('not json', { status: 200 }) })).res.statusCode, 502);
  for (const code of ['', 'short', 'has space here x', '<script>alert(1)</script>', 'z'.repeat(6001), 42])
    assert.equal((await call({ name: 'kakuu' }, { board: async () => new Response(JSON.stringify({ code }), { status: 200 }) })).res.statusCode, 502, String(code).slice(0, 20));
});

test('決まった住所は /?m=<名>(転送は置かない)。公開のコードに、施設の地図の中身は無い', async () => {
  const src = await readFile(new URL('../web/api/michi.js', import.meta.url), 'utf8');
  assert.ok(!/#r=|\bz[A-Za-z0-9_-]{60,}/.test(src), 'web/api/michi.js holds no envelope');
});

// 11-24:リンクがどこかに貼られても、現場の地図が、探す所(Google など)に出ないように
test('探す所にのせない:掲示板の返事は、どの返事にも X-Robots-Tag: noindex。画面の頭には robots の noindex と nofollow', async () => {
  const replies = [
    await call({ name: 'kakuu' }),
    await call({ name: 'Kakuu' }),
    await call({ name: 'kakuu' }, { method: 'POST' }),
    await call({ name: 'kakuu' }, { env: undefined }),
    await call({ name: 'kakuu' }, { board: async () => new Response('{}', { status: 404 }) }),
  ];
  assert.deepEqual(replies.map(r => r.res.statusCode), [200, 400, 405, 503, 404]);
  for (const { res } of replies) assert.equal(res.headers['x-robots-tag'], 'noindex', String(res.statusCode));
  for (const page of ['../web/index.html', '../web/irai/index.html']) {
    const html = await readFile(new URL(page, import.meta.url), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes('<meta name="robots" content="noindex, nofollow">'), page);
  }
});
