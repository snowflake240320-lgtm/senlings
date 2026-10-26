// 受け口(10-26):職人が元請けに渡す。箱の番号 + その相手だけの鍵。外せば、その鍵のものは開かず消える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listUkeguchi, addUkeguchi, removeUkeguchi, ukeguchiLink, parseUkeguchi, ukeguchiText } from '../web/src/pwa/ukeguchi.js';
import { makeKey, boxIdOf, putSealed, peek, isKey } from '../web/src/pwa/yubin.js';
import { read, load, StorageReadError } from '../web/src/pwa/storage.js';

function storage(data = { projects: [], work_sessions: [], expenses: [] }) {
  const mock = { raw: JSON.stringify(data), getItem(key) { return key === 'senlings_v0' ? this.raw : null; }, setItem(key, raw) { assert.equal(key, 'senlings_v0'); this.raw = raw; } };
  globalThis.localStorage = mock; return mock;
}
function fakeBox() {
  const docs = new Map(); let n = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(url); const path = u.pathname.split('/documents/')[1]; const body = init.body ? JSON.parse(init.body) : null;
    const res = (status, obj) => ({ status, ok: status < 300, text: async () => obj === undefined ? '' : JSON.stringify(obj) });
    if (init.method === 'POST') { const id = `it${++n}`; docs.set(`${path}/${id}`, body.fields); return res(200, { name: `projects/p/databases/(default)/documents/${path}/${id}`, fields: body.fields }); }
    if (init.method === 'GET') { const list = [...docs].filter(([k]) => k.startsWith(`${path}/`)).map(([k, f]) => ({ name: `projects/p/databases/(default)/documents/${k}`, fields: f })); return res(200, list.length ? { documents: list } : {}); }
    if (init.method === 'DELETE') { docs.delete(path); return res(200, {}); }
    throw new Error(init.method);
  };
  return { fetch, docs };
}

test('add/remove: one key per counterpart; the link carries box.key and the name; parse reads it back; bad shapes are null', async () => {
  storage();
  assert.throws(() => addUkeguchi({ label: ' ' }), /相手の名前/);
  const u = addUkeguchi({ label: ' 架空建装 ' });
  assert.match(u.id, /^uk[0-9a-f]{12}$/); assert.equal(u.label, '架空建装'); assert.ok(isKey(u.key));
  const u2 = addUkeguchi({ label: '別の元請け' }); assert.notEqual(u2.key, u.key); assert.equal(listUkeguchi().length, 2);
  const box = await boxIdOf(makeKey());
  const link = ukeguchiLink('https://example.test', box, u.key, '架空の職人');
  assert.equal(link, `https://example.test/irai/?openExternalBrowser=1#u=${box}.${u.key}&n=%E6%9E%B6%E7%A9%BA%E3%81%AE%E8%81%B7%E4%BA%BA`);
  assert.deepEqual(parseUkeguchi(new URL(link).hash), { box, key: u.key, name: '架空の職人' });
  assert.equal(parseUkeguchi('#u=short.x'), null); assert.equal(parseUkeguchi('#r=zAAAA'), null); assert.equal(parseUkeguchi(''), null);
  assert.throws(() => ukeguchiLink('https://example.test', 'bad', u.key), /受け口の形/);
  assert.match(ukeguchiText({ name: '架空の職人', label: '架空建装', link }), /^架空建装 ご担当の方\n架空の職人です。現場の依頼を、私の Senlings に直接届けられる受け口です。\n/);
  removeUkeguchi(u.id); assert.deepEqual(listUkeguchi().map(x => x.id), [u2.id]);
});

test('delivery: the counterpart seals with the port key into the box; the house opens it with its port keys; after removing the port, such items are swept', async () => {
  storage();
  const mine = makeKey(); const box = await boxIdOf(mine);
  const u = addUkeguchi({ label: '架空建装' });
  const post = fakeBox();
  await putSealed(box, u.key, 'r=zFROMGENBA', { fetch: post.fetch });
  await putSealed(box, makeKey(), 'r=zSTRANGER', { fetch: post.fetch });
  const got = await peek(mine, { fetch: post.fetch, keys: listUkeguchi().map(x => x.key) });
  assert.deepEqual(got.map(g => [g.text, g.via === u.key]), [['r=zFROMGENBA', true]]);
  assert.equal([...post.docs.keys()].length, 1, 'the stranger\'s envelope (no matching key) is swept');
  removeUkeguchi(u.id);
  assert.deepEqual(await peek(mine, { fetch: post.fetch, keys: [] }), []);
  assert.equal([...post.docs.keys()].length, 0, 'once the port is removed, its envelopes are swept too');
  await assert.rejects(putSealed('nope', u.key, 'x', { fetch: post.fetch }), /受け口の形/);
});

test('guard: a broken port record makes the store unreadable', () => {
  storage({ projects: [], work_sessions: [], expenses: [], ukeguchi: [{ id: 'uk', label: 'x' }] });
  assert.equal(read().status, 'unreadable'); assert.throws(() => load(), StorageReadError);
});
