'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../server/lib/chan-lessons.js');

test('108 课索引：课号 1-108 齐全且唯一', () => {
  assert.equal(K.LESSONS.length, 108);
  const nos = K.LESSONS.map((l) => l.no);
  assert.deepEqual(nos, Array.from({ length: 108 }, (_, i) => i + 1));
});

test('108 课索引：14 个专题覆盖全部课次且不重复', () => {
  assert.equal(K.THEMES.length, 14);
  const seen = new Set();
  for (const t of K.THEMES) {
    assert.ok(t.id && t.name && t.desc);
    for (const n of t.lessons) {
      assert.ok(n >= 1 && n <= 108, '专题 ' + t.id + ' 课号越界: ' + n);
      assert.equal(seen.has(n), false, '课次 ' + n + ' 被重复归类');
      seen.add(n);
    }
  }
  assert.equal(seen.size, 108, '未覆盖全部课次');
});

test('108 课索引：已知标题与要点数量合理，不编造空标题', () => {
  const withTitle = K.LESSONS.filter((l) => l.title);
  const withGist = K.LESSONS.filter((l) => l.gist);
  assert.ok(withTitle.length >= 40, '已知标题数量 ' + withTitle.length);
  assert.ok(withGist.length >= 20, '要点数量 ' + withGist.length);
  for (const l of withTitle) assert.ok(l.title.length >= 4, l.no + ' 标题过短');
  assert.equal(K.COVERAGE.total, 108);
});

test('言论集：字段齐全、来源合法、必须标注转述口径', () => {
  assert.ok(K.LORE.length >= 20, '言论数量 ' + K.LORE.length);
  for (const x of K.LORE) {
    for (const k of ['era', 'source', 'kind', 'text', 'insight', 'link']) assert.ok(x[k], '缺少 ' + k);
    assert.ok(['天涯论坛', '新浪博客'].includes(x.source), '来源非法: ' + x.source);
    assert.ok(x.text.length >= 8);
  }
  assert.ok(K.LORE_META.note.includes('转述'), '必须标注转述口径');
});
