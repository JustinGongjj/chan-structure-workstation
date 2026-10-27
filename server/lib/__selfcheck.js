"use strict";
/**
 * 自检脚本：校验 gua-data.js
 * 运行：node /home/node/default/chanlun-station/server/lib/__selfcheck.js
 */
const path = require("path");

let DATA;
try {
  DATA = require(path.join(__dirname, "gua-data.js"));
  console.log("[5] require() 成功，无语法错误");
} catch (e) {
  console.log("[5] require() 失败：" + e.message);
  process.exit(1);
}

const { TRIGRAMS, HEXAGRAMS, PALACES, PALACE_ELEMENT, NAJIA, SHI_YING, ZHI_ELEMENT, ZHI_ANIMAL, LIU_SHEN } = DATA;
let fail = 0;
const bad = (m) => { fail++; console.log("  ✗ " + m); };

/* ---------------- 1. TRIGRAMS ---------------- */
console.log("\n[1] TRIGRAMS 校验");
const EXP = {
  "乾": ["☰", "天", "金", [1, 1, 1]], "兑": ["☱", "泽", "金", [1, 1, 0]],
  "离": ["☲", "火", "火", [1, 0, 1]], "震": ["☳", "雷", "木", [1, 0, 0]],
  "巽": ["☴", "风", "木", [0, 1, 1]], "坎": ["☵", "水", "水", [0, 1, 0]],
  "艮": ["☶", "山", "土", [0, 0, 1]], "坤": ["☷", "地", "土", [0, 0, 0]]
};
TRIGRAMS.length === 8 || bad("length=" + TRIGRAMS.length);
const nums = TRIGRAMS.map(t => t.num).sort((a, b) => a - b).join(",");
nums === "1,2,3,4,5,6,7,8" || bad("num 集合=" + nums);
const TRI2NATURE = {};   // 卦名 -> 自然象
const NATURE2TRI = {};   // 自然象 -> 卦名
for (const t of TRIGRAMS) {
  const e = EXP[t.name];
  if (!e) { bad("未知卦名 " + t.name); continue; }
  TRI2NATURE[t.name] = t.nature;
  NATURE2TRI[t.nature] = t.name;
  JSON.stringify(t.lines) === JSON.stringify(e[3]) || bad(t.name + " lines=" + JSON.stringify(t.lines) + " 期望 " + JSON.stringify(e[3]));
  t.symbol === e[0] || bad(t.name + " symbol=" + t.symbol);
  t.nature === e[1] || bad(t.name + " nature=" + t.nature);
  t.element === e[2] || bad(t.name + " element=" + t.element);
}
for (const t of TRIGRAMS) console.log("  " + t.symbol + " " + t.num + " " + t.name + " lines=[" + t.lines.join(",") + "] " + t.nature + "/" + t.element);
console.log("  卦符↔三爻一致性：" + (fail === 0 ? "全部通过" : "有错误"));

/* ---------------- 2. HEXAGRAMS ---------------- */
console.log("\n[2] HEXAGRAMS 校验");
HEXAGRAMS.length === 64 || bad("length=" + HEXAGRAMS.length);
const ids = HEXAGRAMS.map(h => h.id).sort((a, b) => a - b);
(ids.length === 64 && ids[0] === 1 && ids[63] === 64 && new Set(ids).size === 64)
  ? console.log("  id 集合 = 1..64，共 64 个、无重复")
  : bad("id 集合异常");
const pairs = new Set();
for (const h of HEXAGRAMS) {
  const key = h.upper + "/" + h.lower;
  if (pairs.has(key)) bad("上下卦组合重复：" + key);
  pairs.add(key);
}
pairs.size === 64 ? console.log("  upper/lower 组合唯一且覆盖 8×8 = 64 种") : bad("组合数=" + pairs.size);

const pairsSeen = new Set();
let pureBug = 0;
for (const h of HEXAGRAMS) {
  if (!TRI2NATURE[h.lower] || !TRI2NATURE[h.upper]) { bad("id " + h.id + " upper/lower 非八卦名"); continue; }
  pairsSeen.add(h.upper + "/" + h.lower);
  // 八纯卦：「X为Y」，X 为卦名、Y 为其自然象，且上下同卦
  if (h.upper === h.lower) {
    const t = TRIGRAMS.find(x => x.name === h.upper);
    if (h.name !== h.upper + "为" + t.nature) { bad("id " + h.id + " 八纯卦名=" + h.name + " 期望 " + h.upper + "为" + t.nature); pureBug++; }
    continue;
  }
  // 其余：「上卦自然象 + 下卦自然象 + 卦名」
  const upN = TRIGRAMS.find(x => x.name === h.upper).nature;
  const loN = TRIGRAMS.find(x => x.name === h.lower).nature;
  if (h.name.slice(0, 1) !== upN || h.name.slice(1, 2) !== loN) {
    bad("id " + h.id + " name=" + h.name + " 与 upper(" + h.upper + "=" + upN + ")/lower(" + h.lower + "=" + loN + ") 不符");
    pureBug++;
  }
  if (h.name.length < 3) bad("id " + h.id + " name 过短");
}
console.log("  name 与「上卦自然象+下卦自然象」一致性：" + (pureBug === 0 ? "64/64 全部通过" : pureBug + " 处不符"));
// 其他字段
const emptyField = HEXAGRAMS.filter(h => !h.guaCi || !h.baiHua || !h.trade || !h.dun);
emptyField.length === 0 ? console.log("  guaCi/baiHua/trade/dun 字段：64 卦全部非空") : bad("字段缺失 " + emptyField.map(h => h.id).join(","));
const longBai = HEXAGRAMS.filter(h => h.baiHua.length > 40 || h.trade.length > 40 || h.dun.length > 8);
longBai.length === 0 ? console.log("  长度约束（baiHua/trade≤40字，dun≤8字）：全部通过") : bad("超长 " + longBai.map(h => h.id + ":" + (h.baiHua.length > 40 ? "baiHua=" + h.baiHua.length : "trade/dun")).join(","));

/* ---------------- 3. PALACES ---------------- */
console.log("\n[3] PALACES 校验");
const palaceNames = Object.keys(PALACES);
let total = 0, palBug = 0;
const allPal = [];
for (const p of palaceNames) {
  const arr = PALACES[p];
  total += arr.length;
  arr.length === 8 || bad(p + "宫卦数=" + arr.length);
  arr.forEach(n => allPal.push(n));
  const self = HEXAGRAMS.find(h => h.name === arr[0]);
  if (!self) { bad(p + "宫本宫卦名不存在：" + arr[0]); continue; }
  if (self.upper !== p || self.lower !== p) bad(p + "宫本宫卦不是八纯卦：" + arr[0]);
  // 用京房卦变法独立复算该宫 8 卦，与给定顺序比对
  const LINES = TRIGRAMS.find(t => t.name === p).lines;
  const base = [...LINES, ...LINES]; // 初..上
  const toLines = (ls) => ls.slice(0, 3).join(",") + "|" + ls.slice(3).join(",");
  const nameOf = (key) => { const h = HEXAGRAMS.find(x => { const u = TRIGRAMS.find(t => t.name === x.upper).lines, l = TRIGRAMS.find(t => t.name === x.lower).lines; return toLines([...l, ...u]) === key; }); return h ? h.name : "?"; };
  const expectNames = [];
  for (let gen = 0; gen <= 5; gen++) {
    const ls = [...base];
    for (let i = 0; i < gen; i++) ls[i] = 1 - ls[i];
    expectNames.push(nameOf(toLines(ls)));
  }
  // 游魂：五世再变四爻；归魂：游魂之内卦复归本宫
  const base5 = [...base];
  for (let i = 0; i < 5; i++) base5[i] = 1 - base5[i];
  const yh = [...base5]; yh[3] = 1 - yh[3];
  const gh = [...yh]; gh[0] = LINES[0]; gh[1] = LINES[1]; gh[2] = LINES[2];
  expectNames.push(nameOf(toLines(yh)));
  expectNames.push(nameOf(toLines(gh)));
  const okOrder = JSON.stringify(expectNames) === JSON.stringify(arr);
  if (!okOrder) { palBug++; bad(p + "宫顺序与京房卦变不符\n     实测：" + arr.join("、") + "\n     推算：" + expectNames.join("、")); }
  console.log("  " + p + "宫(" + PALACE_ELEMENT[p] + ")：" + arr.join("、"));
}
total === 64 ? console.log("  八宫合计卦数 = 64") : bad("八宫合计=" + total);
new Set(allPal).size === 64 ? console.log("  八宫 64 卦名无重复") : bad("重复卦名 " + (allPal.length - new Set(allPal).size) + " 个");
const hexNames = new Set(HEXAGRAMS.map(h => h.name));
const missing = [...hexNames].filter(n => !allPal.includes(n));
const extra = allPal.filter(n => !hexNames.has(n));
(missing.length === 0 && extra.length === 0)
  ? console.log("  八宫卦名与 HEXAGRAMS.name 严格一一对应（64↔64，无遗漏无多余）")
  : bad("遗漏=" + missing.join(",") + " 多余=" + extra.join(","));
Object.keys(PALACE_ELEMENT).length === 8 ? console.log("  PALACE_ELEMENT 8 宫齐全") : bad("PALACE_ELEMENT 键数=" + Object.keys(PALACE_ELEMENT).length);
const peKeys = Object.keys(PALACE_ELEMENT).sort(), triKeys = TRIGRAMS.map(t => t.name).sort();
JSON.stringify(peKeys) === JSON.stringify(triKeys) ? console.log("  PALACE_ELEMENT 键集合与八卦一致：" + Object.keys(PALACE_ELEMENT).join("、")) : bad("PALACE_ELEMENT 键：" + peKeys.join(""));
// 游魂/归魂 位置说明（各宫第 7、8 卦）
console.log("  每宫第 7 卦为游魂、第 8 卦为归魂：" + palaceNames.map(p => p + "→" + PALACES[p][6] + "/" + PALACES[p][7]).join(" "));

/* ---------------- 4. NAJIA ---------------- */
console.log("\n[4] NAJIA 校验");
const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const EXP_NAJIA = {
  "乾": [["子", "寅", "辰"], ["午", "申", "戌"], "甲/壬"],
  "坎": [["寅", "辰", "午"], ["申", "戌", "子"], "戊"],
  "艮": [["辰", "午", "申"], ["戌", "子", "寅"], "丙"],
  "震": [["子", "寅", "辰"], ["午", "申", "戌"], "庚"],
  "巽": [["丑", "亥", "酉"], ["未", "巳", "卯"], "辛"],
  "离": [["卯", "丑", "亥"], ["酉", "未", "巳"], "己"],
  "坤": [["未", "巳", "卯"], ["丑", "亥", "酉"], "乙/癸"],
  "兑": [["巳", "卯", "丑"], ["亥", "酉", "未"], "丁"]
};
Object.keys(NAJIA).length === 8 ? console.log("  NAJIA 8 卦齐全：" + Object.keys(NAJIA).join("、")) : bad("NAJIA 键数=" + Object.keys(NAJIA).length);
for (const g of Object.keys(EXP_NAJIA)) {
  const n = NAJIA[g];
  if (!n) { bad("缺 " + g + " 纳甲"); continue; }
  if (!Array.isArray(n.inner) || n.inner.length !== 3) bad(g + " inner 非 3 地支");
  if (!Array.isArray(n.outer) || n.outer.length !== 3) bad(g + " outer 非 3 地支");
  const all = [...n.inner, ...n.outer];
  const illegal = all.filter(z => !ZHI.includes(z));
  illegal.length ? bad(g + " 含非法地支 " + illegal.join(",")) : null;
  JSON.stringify([n.inner, n.outer, n.stem]) === JSON.stringify(EXP_NAJIA[g])
    ? console.log("  " + g + "纳" + n.stem + "：内 " + n.inner.join("") + " 外 " + n.outer.join("") + "  ✓")
    : bad(g + " 纳甲不符传统（内" + n.inner.join("") + " 外" + n.outer.join("") + " 干" + n.stem + "）");
}
// 地支→五行 / 生肖 覆盖
Object.keys(ZHI_ELEMENT).length === 12 ? console.log("  ZHI_ELEMENT 12 地支齐全") : bad("ZHI_ELEMENT 键数=" + Object.keys(ZHI_ELEMENT).length);
Object.keys(ZHI_ANIMAL).length === 12 ? console.log("  ZHI_ANIMAL 12 生肖齐全") : bad("ZHI_ANIMAL 键数=" + Object.keys(ZHI_ANIMAL).length);
ZHI.every(z => ZHI_ELEMENT[z] && ZHI_ANIMAL[z]) ? console.log("  12 地支均有五行与生肖映射") : bad("地支映射有缺失");
LIU_SHEN.length === 6 ? console.log("  LIU_SHEN：" + LIU_SHEN.join("→") + "（6 个）") : bad("LIU_SHEN 长度=" + LIU_SHEN.length);
SHI_YING.length === 8 && JSON.stringify(SHI_YING) === JSON.stringify([6, 1, 2, 3, 4, 5, 4, 3])
  ? console.log("  SHI_YING = [" + SHI_YING.join(",") + "]（本宫..归魂世爻位）") : bad("SHI_YING 异常：" + JSON.stringify(SHI_YING));

/* ---------------- 汇总 ---------------- */
console.log("\n[5] 模块导出键：" + Object.keys(DATA).join(", "));
console.log("\n===== 结果：" + (fail === 0 ? "全部通过 ✅（0 处错误）" : fail + " 处错误 ❌") + " =====");
process.exit(fail === 0 ? 0 : 1);
