'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../server/lib/metaphysics.js');

test('命理知识库：五套体系结构完整', () => {
  assert.equal(M.SYSTEMS.length, 5);
  const ids = M.SYSTEMS.map((s) => s.id).sort();
  assert.deepEqual(ids, ['ganzhi', 'liuyao', 'meihua', 'qimen', 'ziwei']);
  for (const s of M.SYSTEMS) {
    for (const k of ['id', 'name', 'school', 'oneLine', 'principle', 'rules', 'howTo', 'code', 'pitfalls']) {
      assert.ok(s[k] != null, `${s.id} 缺少 ${k}`);
    }
    assert.ok(Array.isArray(s.rules) && s.rules.length >= 3, `${s.id} 规则太少`);
    assert.ok(Array.isArray(s.howTo) && s.howTo.length >= 2, `${s.id} 缺少操作指引`);
    assert.ok(Array.isArray(s.pitfalls) && s.pitfalls.length >= 2, `${s.id} 缺少常见误解`);
    assert.ok(s.code.module && s.code.api, `${s.id} 缺少代码/接口指向`);
  }
});

test('命理知识库：书目覆盖每个体系且字段齐全', () => {
  assert.ok(M.BOOKS.length >= 12, '书目数量 ' + M.BOOKS.length);
  const domains = new Set(M.BOOKS.map((b) => b.domain));
  for (const d of ['缠论', '干支', '紫微', '奇门', '卦象', '六爻']) assert.ok(domains.has(d), '缺少书目：' + d);
  for (const b of M.BOOKS) {
    for (const k of ['title', 'domain', 'era', 'attributed', 'note']) assert.ok(b[k], `${b.title} 缺少 ${k}`);
  }
  const titles = M.BOOKS.map((b) => b.title);
  assert.equal(new Set(titles).size, titles.length, '书目标题重复');
});

test('命理知识库：get() 能按体系取到对应书目', () => {
  const z = M.get('ziwei');
  assert.ok(z && z.books.length >= 2);
  assert.ok(z.books.every((b) => b.domain === '紫微'));
  assert.equal(M.get('nope'), null);
});
