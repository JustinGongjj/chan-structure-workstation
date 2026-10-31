'use strict';
/**
 * 商品板块（Sector）目录
 * ------------------------------------------------------------------
 * 把期货品种按产业链分组，用于「板块页」浏览。分组依据是交易所主流分类：
 *   有色金属 / 贵金属 / 黑色系 / 能源化工 / 农产品 / 金融期货 / 指数与汇率（外盘）
 * 每个品种标注：代码、中文名、交易所、是否主力连续、有没有实测数据。
 * 数据可用性由 matrixcheck / srcaudit 定期复核，这里只做目录。
 */

const FUTURES_META = {
  // ===== 上期所 SHFE =====
  CU0: { name: '沪铜', ex: 'SHFE', sector: 'base' },
  AL0: { name: '沪铝', ex: 'SHFE', sector: 'base' },
  ZN0: { name: '沪锌', ex: 'SHFE', sector: 'base' },
  PB0: { name: '沪铅', ex: 'SHFE', sector: 'base' },
  NI0: { name: '沪镍', ex: 'SHFE', sector: 'base' },
  SN0: { name: '沪锡', ex: 'SHFE', sector: 'base' },
  AU0: { name: '沪金', ex: 'SHFE', sector: 'precious' },
  AG0: { name: '沪银', ex: 'SHFE', sector: 'precious' },
  RB0: { name: '螺纹钢', ex: 'SHFE', sector: 'ferrous' },
  WR0: { name: '线材', ex: 'SHFE', sector: 'ferrous' },
  HC0: { name: '热卷', ex: 'SHFE', sector: 'ferrous' },
  SS0: { name: '不锈钢', ex: 'SHFE', sector: 'ferrous' },
  BU0: { name: '沥青', ex: 'SHFE', sector: 'energy' },
  RU0: { name: '橡胶', ex: 'SHFE', sector: 'energy' },
  SP0: { name: '纸浆', ex: 'SHFE', sector: 'light' },
  FU0: { name: '燃油', ex: 'SHFE', sector: 'energy' },

  // ===== 能源中心 INE =====
  SC0: { name: '原油', ex: 'INE', sector: 'energy' },
  LU0: { name: '低硫燃油', ex: 'INE', sector: 'energy' },
  NR0: { name: '20号胶', ex: 'INE', sector: 'energy' },
  BC0: { name: '国际铜', ex: 'INE', sector: 'base' },

  // ===== 大商所 DCE =====
  M0: { name: '豆粕', ex: 'DCE', sector: 'agri' },
  Y0: { name: '豆油', ex: 'DCE', sector: 'agri' },
  P0: { name: '棕榈油', ex: 'DCE', sector: 'agri' },
  A0: { name: '豆一', ex: 'DCE', sector: 'agri' },
  B0: { name: '豆二', ex: 'DCE', sector: 'agri' },
  C0: { name: '玉米', ex: 'DCE', sector: 'agri' },
  CS0: { name: '淀粉', ex: 'DCE', sector: 'agri' },
  JD0: { name: '鸡蛋', ex: 'DCE', sector: 'agri' },
  LH0: { name: '生猪', ex: 'DCE', sector: 'agri' },
  RR0: { name: '粳米', ex: 'DCE', sector: 'agri' },
  L0: { name: '塑料', ex: 'DCE', sector: 'energy' },
  V0: { name: 'PVC', ex: 'DCE', sector: 'energy' },
  PP0: { name: '聚丙烯', ex: 'DCE', sector: 'energy' },
  EG0: { name: '乙二醇', ex: 'DCE', sector: 'energy' },
  EB0: { name: '苯乙烯', ex: 'DCE', sector: 'energy' },
  PG0: { name: 'LPG', ex: 'DCE', sector: 'energy' },
  J0: { name: '焦炭', ex: 'DCE', sector: 'ferrous' },
  JM0: { name: '焦煤', ex: 'DCE', sector: 'ferrous' },
  I0: { name: '铁矿石', ex: 'DCE', sector: 'ferrous' },
  FB0: { name: '纤维板', ex: 'DCE', sector: 'light' },
  BB0: { name: '胶合板', ex: 'DCE', sector: 'light' },

  // ===== 郑商所 CZCE =====
  SR0: { name: '白糖', ex: 'CZCE', sector: 'agri' },
  CF0: { name: '棉花', ex: 'CZCE', sector: 'agri' },
  CY0: { name: '棉纱', ex: 'CZCE', sector: 'agri' },
  RM0: { name: '菜粕', ex: 'CZCE', sector: 'agri' },
  OI0: { name: '菜油', ex: 'CZCE', sector: 'agri' },
  AP0: { name: '苹果', ex: 'CZCE', sector: 'agri' },
  CJ0: { name: '红枣', ex: 'CZCE', sector: 'agri' },
  PK0: { name: '花生', ex: 'CZCE', sector: 'agri' },
  TA0: { name: 'PTA', ex: 'CZCE', sector: 'energy' },
  MA0: { name: '甲醇', ex: 'CZCE', sector: 'energy' },
  FG0: { name: '玻璃', ex: 'CZCE', sector: 'energy' },
  SA0: { name: '纯碱', ex: 'CZCE', sector: 'energy' },
  UR0: { name: '尿素', ex: 'CZCE', sector: 'energy' },
  PF0: { name: '短纤', ex: 'CZCE', sector: 'energy' },
  SH0: { name: '烧碱', ex: 'CZCE', sector: 'energy' },
  PX0: { name: '对二甲苯', ex: 'CZCE', sector: 'energy' },
  SF0: { name: '硅铁', ex: 'CZCE', sector: 'ferrous' },
  SM0: { name: '锰硅', ex: 'CZCE', sector: 'ferrous' },
  ZC0: { name: '动力煤', ex: 'CZCE', sector: 'ferrous' },

  // ===== 中金所 CFFEX =====
  IF0: { name: '沪深300', ex: 'CFFEX', sector: 'fin' },
  IC0: { name: '中证500', ex: 'CFFEX', sector: 'fin' },
  IH0: { name: '上证50', ex: 'CFFEX', sector: 'fin' },
  IM0: { name: '中证1000', ex: 'CFFEX', sector: 'fin' },
  TS0: { name: '2年国债', ex: 'CFFEX', sector: 'fin' },
  TF0: { name: '5年国债', ex: 'CFFEX', sector: 'fin' },
  T0: { name: '10年国债', ex: 'CFFEX', sector: 'fin' },
  TL0: { name: '30年国债', ex: 'CFFEX', sector: 'fin' },

  // ===== 外盘 CME/COMEX/NYMEX/CBOT =====
  ES: { name: '标普500', ex: 'CME', sector: 'index' },
  NQ: { name: '纳指100', ex: 'CME', sector: 'index' },
  YM: { name: '道指', ex: 'CBOT', sector: 'index' },
  RTY: { name: '罗素2000', ex: 'CME', sector: 'index' },
  NKD: { name: '日经225', ex: 'CME', sector: 'index' },
  GC: { name: '黄金', ex: 'COMEX', sector: 'precious' },
  SI: { name: '白银', ex: 'COMEX', sector: 'precious' },
  HG: { name: '铜', ex: 'COMEX', sector: 'base' },
  CL: { name: 'WTI原油', ex: 'NYMEX', sector: 'energy' },
  NG: { name: '天然气', ex: 'NYMEX', sector: 'energy' },
  HO: { name: '取暖油', ex: 'NYMEX', sector: 'energy' },
  QM: { name: '迷你原油', ex: 'NYMEX', sector: 'energy' },
  BZ: { name: '布伦特原油', ex: 'NYMEX', sector: 'energy' },
  KC: { name: '咖啡', ex: 'ICE', sector: 'agri' },
  CC: { name: '可可', ex: 'ICE', sector: 'agri' },
  SB: { name: '原糖', ex: 'ICE', sector: 'agri' },
  CT: { name: '棉花', ex: 'ICE', sector: 'agri' },
  OJ: { name: '橙汁', ex: 'ICE', sector: 'agri' },
  LE: { name: '活牛', ex: 'CME', sector: 'agri' },
  GF: { name: '育肥牛', ex: 'CME', sector: 'agri' },
};

const SECTORS = [
  { id: 'base', name: '有色金属', desc: '铜铝锌铅镍锡，跟宏观与库存周期走', color: '#c08a3e' },
  { id: 'precious', name: '贵金属', desc: '金银，避险与实际利率驱动', color: '#d4af37' },
  { id: 'ferrous', name: '黑色系', desc: '螺纹热卷铁矿焦炭焦煤，地产与基建链条', color: '#8a8f9c' },
  { id: 'energy', name: '能源化工', desc: '原油燃料油聚烯烃芳烃，最贴近成本推动', color: '#4a8fd4' },
  { id: 'agri', name: '农产品', desc: '油脂油料软商品养殖，天气与库存驱动', color: '#5fa564' },
  { id: 'fin', name: '金融期货', desc: '股指与国债，直接对应 A 股 beta 与利率', color: '#a06fd4' },
  { id: 'index', name: '外盘指数', desc: '美股与日经期货，夜盘风向标', color: '#d4685f' },
  { id: 'light', name: '林木轻工', desc: '纸浆板材，成交清淡、样本少', color: '#9a9a9a' },
];

/** 某市场下的全部品种（按板块分组） */
function bySector(market) {
  const out = new Map();
  for (const [code, meta] of Object.entries(FUTURES_META)) {
    // 国内代码以 0 结尾，外盘不是
    const mk = code.endsWith('0') ? 'CNF' : 'USF';
    if (market && mk !== market) continue;
    const sector = meta.sector;
    if (!out.has(sector)) out.set(sector, []);
    out.get(sector).push({ market: mk, code, name: meta.name, ex: meta.ex });
  }
  return out;
}

/** 完整目录：板块 → 品种，附带每个板块的品种数 */
function catalog() {
  const groups = bySector();
  return SECTORS.map((s) => ({
    ...s,
    items: (groups.get(s.id) || []).sort((a, b) => a.code.localeCompare(b.code)),
    count: (groups.get(s.id) || []).length,
  })).filter((s) => s.count > 0);
}

module.exports = { FUTURES_META, SECTORS, bySector, catalog };
