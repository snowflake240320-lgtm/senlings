// 郵便受け(10-26):封をして出す。鍵はスマホの中だけ。郵便受けには封をした中身だけ。受け取ったら消す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, isKey, boxIdOf, seal, openSeal, put, peek, remove, markHome, hasHome, ITEM_DAYS } from '../web/src/pwa/yubin.js';
import { readArrival, withKey } from '../web/src/pwa/envelope.js';

// 郵便受けの代役(Firestore REST の形だけ真似る)
function fakeBox() {
  const docs = new Map(); let n = 0; const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url); calls.push(`${init.method} ${u.pathname}`);
    assert.equal(u.searchParams.get('key'), 'AIzaSyBNaj9bllnBSjlnL63smknkSK7T8SNnWZo');
    const path = u.pathname.split('/documents/')[1];
    const body = init.body ? JSON.parse(init.body) : null;
    const res = (status, obj) => ({ status, ok: status < 300, text: async () => obj === undefined ? '' : JSON.stringify(obj) });
    if (init.method === 'POST') { const id = `it${++n}`; docs.set(`${path}/${id}`, body.fields); return res(200, { name: `projects/p/databases/(default)/documents/${path}/${id}`, fields: body.fields }); }
    if (init.method === 'GET') {
      if (docs.has(path)) return res(200, { name: path, fields: docs.get(path) });
      const list = [...docs].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([k, f]) => ({ name: `projects/p/databases/(default)/documents/${k}`, fields: f }));
      return list.length ? res(200, { documents: list }) : path.includes('/items') ? res(200, {}) : res(404, { error: 'not found' });
    }
    if (init.method === 'DELETE') { docs.delete(path); return res(200, {}); }
    if (init.method === 'PATCH') { docs.set(path, { ...(docs.get(path) ?? {}), ...body.fields }); return res(200, { fields: body.fields }); }
    throw new Error(init.method);
  };
  return { fetch, docs, calls };
}

test('key: 22 chars of random; the box id is a hash of it, never the key itself', async () => {
  const k = makeKey(); assert.ok(isKey(k)); assert.notEqual(makeKey(), k);
  const id = await boxIdOf(k); assert.match(id, /^[A-Za-z0-9_-]{24}$/); assert.ok(!id.includes(k.slice(0, 8)));
  assert.equal(await boxIdOf(k), id);
  await assert.rejects(boxIdOf('short'), /鍵の形/);
});

test('seal: only the same key opens it; a changed byte or another key does not', async () => {
  const k = makeKey(), k2 = makeKey();
  const s = await seal(k, '【応援のお願い】架空の職人より\n電話:090-0000-0000');
  assert.doesNotMatch(s, /応援|090/); assert.notEqual(await seal(k, 'x'), await seal(k, 'x'), 'a fresh nonce every time');
  assert.equal(await openSeal(k, s), '【応援のお願い】架空の職人より\n電話:090-0000-0000');
  await assert.rejects(openSeal(k2, s), /開きません/);
  await assert.rejects(openSeal(k, s.slice(0, -2) + 'AA'), /開きません/);
  await assert.rejects(openSeal(k, 'AAAA'), /壊れて/);
});

test('box: put seals and posts with a 14-day limit; peek opens only what the key opens; remove deletes; home mark is content-free', async () => {
  const box = fakeBox(); const k = makeKey(), other = makeKey();
  const id = await put(k, 'r=zAAAA', { fetch: box.fetch });
  assert.match(id, /^it\d+$/);
  const stored = [...box.docs.values()][0];
  assert.deepEqual(Object.keys(stored).sort(), ['c', 't', 'x']); assert.doesNotMatch(stored.c.stringValue, /zAAAA/);
  assert.ok(Math.abs(new Date(stored.x.timestampValue) - (Date.now() + ITEM_DAYS * 86400000)) < 5000, 'expires in 14 days');
  await put(other, 'theirs', { fetch: box.fetch });
  const mine = await peek(k, { fetch: box.fetch });
  assert.deepEqual(mine.map(m => m.text), ['r=zAAAA'], 'another key\'s box is another box');
  assert.deepEqual(await peek(other, { fetch: box.fetch }).then(l => l.map(m => m.text)), ['theirs']);
  await remove(k, mine[0].id, { fetch: box.fetch });
  assert.deepEqual(await peek(k, { fetch: box.fetch }), []);
  assert.equal(await hasHome(k, { fetch: box.fetch }), false);
  await markHome(k, { fetch: box.fetch });
  assert.equal(await hasHome(k, { fetch: box.fetch }), true);
  const home = box.docs.get(`boxes/${await boxIdOf(k)}`); assert.deepEqual(Object.keys(home).sort(), ['home', 'x']);
  await assert.rejects(remove(k, '../x', { fetch: box.fetch }).then(() => { throw new Error('no'); }), /no/, 'a bad id is simply ignored');
});

test('box: when the post office is unreachable, put/peek throw a plain message', async () => {
  const k = makeKey();
  const down = async () => ({ status: 503, ok: false, text: async () => '' });
  await assert.rejects(put(k, 'x', { fetch: down }), /届きません\(503\)/);
  await assert.rejects(peek(k, { fetch: down }), /届きません/);
});

test('arrival: # carries r=, shisetsu= and k= joined by &; withKey adds or replaces the key', () => {
  const k = makeKey();
  assert.deepEqual(readArrival(`#r=zAAAA&k=${k}`), { request: 'zAAAA', key: k });
  assert.deepEqual(readArrival(`#k=${k}`), { key: k });
  assert.deepEqual(readArrival(`#shisetsu=%E6%96%BD%E8%A8%AD&k=${k}`), { shisetsu: '施設', key: k });
  assert.deepEqual(readArrival('#k=tooshort'), null);
  assert.equal(withKey('#r=zAAAA', k), `#r=zAAAA&k=${k}`);
  assert.equal(withKey(`#r=zAAAA&k=${makeKey()}`, k), `#r=zAAAA&k=${k}`);
  assert.equal(withKey('', k), `#k=${k}`);
  assert.equal(withKey('#r=zAAAA', ''), '#r=zAAAA');
});
