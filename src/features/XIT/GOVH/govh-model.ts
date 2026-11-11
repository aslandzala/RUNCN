// XIT GOVH 政府基建补给助手 — 固化系数与纯计算模型。
//
// 数据来源（仅开发期一次性查阅，运行时零网络）：
//   - 需求分层 / 封顶 / 幸福度：https://pct.fnar.net/population-infrastructure/
//   - 基建表 UPKEEP_BUILDINGS / 权重 HAPPINESS_WEIGHTS：oogcapitalmanagement.com/infra-data.js
//   - 求解算法 computeCheapestFulfillment：oogcapitalmanagement.com/governor-calc.js
//   - 计算示例：https://oogcapitalmanagement.com/governor-helper/?planet=EUU
// 抓取日期 2026-11-10，与 docs/game/governor-helper-plan.md 同步维护。
//
// 本文件只放纯数据与纯函数：不 import Vue / DOM / FIO / 游戏 store。
// 运行时输入全部由 govh-dom.ts（POPR / POPI / POPID DOM）与调用方
// （sitesStore 基地数、cxobStore 价格）从游戏本地补入。绝不回退外部价格源。
//
// 核心机制（与 oog 官方一致）：
//   - 每种物料独立提供其建筑需求贡献的 1/n（n=该建筑物料数）；
//   - fulfillment = provided / needed；满足度按 4 层封顶；
//   - 求解 = 维生按 POPR 现值固定封顶基线 + 已填满 30 天的设施存量自动计入，
//     再逐需求按「当前短板需求的每 credit 贡献」贪心选待采购物料，最后剔除冗余避免超买。
//     这是启发式近似，不是严格全局最优（见文档「求解流程」）。

// ── 六类需求 & 分层 ────────────────────────────────────────────────────
export const NEEDS = [
  'LIFE_SUPPORT',
  'SAFETY',
  'HEALTH',
  'COMFORT',
  'CULTURE',
  'EDUCATION',
] as const;
export type Need = (typeof NEEDS)[number];

// 参与基建求解的需求（维生不参与：肥沃恒 100%，非肥沃靠住房）。
export const INFRA_NEEDS = ['SAFETY', 'HEALTH', 'COMFORT', 'CULTURE', 'EDUCATION'] as const;
export type InfraNeed = (typeof INFRA_NEEDS)[number];

export const NEED_LABELS: Record<Need, string> = {
  LIFE_SUPPORT: '维生',
  SAFETY: '安全',
  HEALTH: '健康',
  COMFORT: '舒适',
  CULTURE: '文化',
  EDUCATION: '教育',
};

// 4 层封顶：高层不能超过其下一层最差的一项。
export const TIERS: readonly (readonly Need[])[] = [
  ['LIFE_SUPPORT'],
  ['SAFETY', 'HEALTH'],
  ['COMFORT', 'CULTURE'],
  ['EDUCATION'],
];

// ── 五类人口 ────────────────────────────────────────────────────────────
export const LEVELS = ['PIONEER', 'SETTLER', 'TECHNICIAN', 'ENGINEER', 'SCIENTIST'] as const;
export type WorkforceLevel = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<WorkforceLevel, string> = {
  PIONEER: '先驱者',
  SETTLER: '定居者',
  TECHNICIAN: '职技工',
  ENGINEER: '工程师',
  SCIENTIST: '科学家',
};

// 六类需求权重（每类人口对 6 项需求的权重，行和 = 1）。
export const HAPPINESS_WEIGHTS: Record<WorkforceLevel, Record<Need, number>> = {
  PIONEER: {
    LIFE_SUPPORT: 0.54,
    SAFETY: 0.25,
    HEALTH: 0.15,
    COMFORT: 0.03,
    CULTURE: 0.02,
    EDUCATION: 0.01,
  },
  SETTLER: {
    LIFE_SUPPORT: 0.41,
    SAFETY: 0.3,
    HEALTH: 0.2,
    COMFORT: 0.03,
    CULTURE: 0.03,
    EDUCATION: 0.03,
  },
  TECHNICIAN: {
    LIFE_SUPPORT: 0.15,
    SAFETY: 0.2,
    HEALTH: 0.3,
    COMFORT: 0.2,
    CULTURE: 0.1,
    EDUCATION: 0.05,
  },
  ENGINEER: {
    LIFE_SUPPORT: 0.1,
    SAFETY: 0.1,
    HEALTH: 0.15,
    COMFORT: 0.35,
    CULTURE: 0.2,
    EDUCATION: 0.1,
  },
  SCIENTIST: {
    LIFE_SUPPORT: 0.05,
    SAFETY: 0.1,
    HEALTH: 0.1,
    COMFORT: 0.2,
    CULTURE: 0.25,
    EDUCATION: 0.3,
  },
};

// 游戏显示的幸福度 = 最近 5 周加权平均（v1 展示游戏给定值，此表供参考）。
export const HAPPINESS_WEEK_WEIGHTS = [0.4, 0.25, 0.2, 0.1, 0.05] as const;

// ── 14 座基建建筑（实机 POPI 列表，顺序与游戏 / oog infra-data.js 一致）──
// qtyPerDay 是每 1 级日耗；needs 是全部物料供给时每 1 级提供的需求单位。
export interface UpkeepBuilding {
  ticker: string;
  name: string;
  enName: string;
  upkeep: Record<string, number>;
  needs: Partial<Record<InfraNeed, number>>;
}

export const UPKEEP_BUILDINGS: readonly UpkeepBuilding[] = [
  {
    ticker: 'SST',
    name: '安全站',
    enName: 'Safety Station',
    upkeep: { DW: 10, OFF: 10, SUN: 2 },
    needs: { SAFETY: 2500 },
  },
  {
    ticker: 'SDP',
    name: '安防无人机站',
    enName: 'Security Drone Post',
    upkeep: { POW: 1, RAD: 0.47, CCD: 0.07, SUD: 0.07 },
    needs: { SAFETY: 5000 },
  },
  {
    ticker: 'EMC',
    name: '应急中心',
    enName: 'Emergency Center',
    upkeep: { PK: 2, POW: 0.4, BND: 4, RED: 0.07, BSC: 0.07 },
    needs: { SAFETY: 1000, HEALTH: 1000 },
  },
  {
    ticker: 'INF',
    name: '医务室',
    enName: 'Infirmary',
    upkeep: { OFF: 10, TUB: 6.67, STR: 0.67 },
    needs: { HEALTH: 2500 },
  },
  {
    ticker: 'HOS',
    name: '医院',
    enName: 'Hospital',
    upkeep: { PK: 2, SEQ: 0.4, BND: 4, SDR: 0.07, RED: 0.07, BSC: 0.13 },
    needs: { HEALTH: 5000 },
  },
  {
    ticker: 'WCE',
    name: '健康中心',
    enName: 'Wellness Center',
    upkeep: { KOM: 4, OLF: 2, DW: 6, DEC: 0.67, PFE: 2.67, SOI: 6.67 },
    needs: { HEALTH: 1000, COMFORT: 1000 },
  },
  {
    ticker: 'PAR',
    name: '野生动物园',
    enName: 'Park',
    upkeep: { DW: 10, FOD: 6, PFE: 2, SOI: 3.33, DEC: 0.33 },
    needs: { COMFORT: 2500 },
  },
  {
    ticker: '4DA',
    name: '4D游乐中心',
    enName: '4D Arcades',
    upkeep: { POW: 2, MHP: 2, OLF: 4, BID: 0.2, HOG: 0.2, EDC: 0.2 },
    needs: { COMFORT: 5000 },
  },
  {
    ticker: 'ACA',
    name: '艺术餐厅',
    enName: 'Art Cafe',
    upkeep: { COF: 8, OLF: 2, VIT: 8, DW: 10, GL: 6.67, DEC: 0.67 },
    needs: { COMFORT: 1000, CULTURE: 1000 },
  },
  {
    ticker: 'ART',
    name: '画廊',
    enName: 'Art Gallery',
    upkeep: { MHP: 1, HOG: 1, UTS: 0.67, DEC: 0.67 },
    needs: { CULTURE: 2500 },
  },
  {
    ticker: 'VRT',
    name: 'VR剧院',
    enName: 'VR Theater',
    upkeep: { POW: 1.4, MHP: 2, HOG: 1.4, OLF: 4, BID: 0.33, DEC: 0.67 },
    needs: { CULTURE: 5000 },
  },
  {
    ticker: 'PBH',
    name: '行星广播站',
    enName: 'Planetary Broadcasting Hub',
    upkeep: { OFF: 10, MHP: 1, SP: 1.33, AAR: 0.67, EDC: 0.27, IDC: 0.13 },
    needs: { CULTURE: 1000, EDUCATION: 1000 },
  },
  {
    ticker: 'LIB',
    name: '图书馆',
    enName: 'Library',
    upkeep: { MHP: 1, HOG: 1, CD: 0.33, DIS: 0.33, BID: 0.2 },
    needs: { EDUCATION: 2500 },
  },
  {
    ticker: 'UNI',
    name: '大学',
    enName: 'University',
    upkeep: { COF: 10, REA: 10, TUB: 10, BID: 0.33, HD: 0.67, IDC: 0.2 },
    needs: { EDUCATION: 5000 },
  },
];

// 全部可补给物料（去重、按 ticker 排序）。
export const ALL_MATERIALS: readonly string[] = [
  ...new Set(UPKEEP_BUILDINGS.flatMap(b => Object.keys(b.upkeep))),
].sort();

const BUILDING_BY_TICKER = new Map(UPKEEP_BUILDINGS.map(b => [b.ticker, b]));
export function getBuilding(ticker: string): UpkeepBuilding | undefined {
  return BUILDING_BY_TICKER.get(ticker);
}

// ── 输入 / 输出类型 ──────────────────────────────────────────────────────
// 政府基建设施内部存量：来自 POPID 每个建筑的维护供给表，
// 不是基地仓库库存。两个字段分别对应「下一次消耗」「储备」列的 progress 当前值。
export interface FacilityStock {
  nextConsumption: number;
  reserve: number;
}

// 单座建筑内：物料 ticker -> 当前存量。
export type FacilityMaterialStocks = Record<string, FacilityStock>;
// 星球整体：建筑 ticker -> 物料 ticker -> 当前存量。
export type FacilityStocks = Record<string, FacilityMaterialStocks>;

export interface GovhInput {
  // 五类人口数量（来自 POPR 人口表）。
  population: Record<WorkforceLevel, number>;
  // 玩家在该星球自有的基地数（来自本地 sitesStore；每座提供 50 safety + 50 health）。
  siteCount: number;
  // 游戏已算好的六类需求满足度 0~1（来自 POPR 需求满足度表，含封顶）。仅用于展示「现状」。
  currentFulfillment: Record<Need, number>;
  // 游戏已算好的五类人口幸福度 0~1（来自 POPR 幸福行）。仅用于展示「现状」。
  currentHappiness: Record<WorkforceLevel, number>;
  // 各建筑已建造等级（来自 POPI 已建造列）：ticker -> level。
  levels: Record<string, number>;
  // 政府基建设施内部「下一次消耗 + 储备」当前存量（来自 POPID 维护供给表）。
  // 只扣减一次性待补量，不影响日耗 / 需求贡献；缺省视为 0。
  facilityStocks?: FacilityStocks;
  // 目标满足度 0~1（0.7 / 1.0）。
  target: number;
  // 物料单价（从 cxobStore 实时盘口读），无报价为 undefined。
  prices: Record<string, number | undefined>;
  // 用户显式勾选的 (building, material) 键集合 `TICKER.MATERIAL`。
  // 传入时按其预览，不传时由求解器给出推荐集合。
  selected?: Set<string>;
  // 一次性把所有已建建筑的物料填满（预览上限）。
  fillAll?: boolean;
  // 物料重量/体积（来自 materialsStore），用于汇总。
  materialsInfo?: Record<string, { weight: number; volume: number }>;
}

export interface NeedState {
  needed: number;
  // 施加选中物料后的原始提供量（未封顶，与 needed 同单位）。
  provided: number;
  // 现状满足度（POPR 原值，含封顶）。
  current: number;
  // 施加选中物料后的满足度（含封顶）。
  fulfillment: number;
  // 是否被下一层短板封顶。
  capped: boolean;
}

export interface SupplyOption {
  // 唯一键 `BUILDING.MATERIAL`。
  key: string;
  building: string;
  buildingName: string;
  ticker: string;
  // 每 1 级日耗。
  qtyPerDayPerLevel: number;
  builtLevel: number;
  // 覆盖的基建需求。
  needs: InfraNeed[];
  // 每 1 级、该物料贡献的各类需求单位（= needs[need] / n）。
  contribPerLevel: Partial<Record<InfraNeed, number>>;
  price: number | undefined;
  // 填满全部已建等级时的日耗 / 日成本。
  qtyPerDay: number;
  dailyCost: number;
  // 30 天毛填充量 / 毛成本（未扣政府基建设施内部存量）。
  grossFillAmount: number;
  grossFillCost: number;
  // 目标星球该建筑该物料在「下一次消耗 / 储备」两栏的当前存量，非基地仓库。
  stockNextConsumption: number;
  stockReserve: number;
  stockTotal: number;
  // 实际待补量 / 待补成本 = max(0, 30 天毛量 − 上述两项存量)。
  netFillAmount: number;
  netFillCost: number;
  // 表格「计算过程」列：30天填充 − 下一次消耗 − 储备 = 待补。
  calculation: string;
  // 该 option 全部覆盖需求在实际等级下的总贡献 / 日成本（排序用；免费=Infinity，无报价=-1）。
  // Phase2 用它做粗排；Phase1 用 needEfficiency(option, need) 按当前短板需求精排。
  efficiency: number;
  selected: boolean;
}

export interface GovhResult {
  needs: Record<Need, NeedState>;
  // 施加选中物料后的五类人口幸福度 0~1。
  happiness: Record<WorkforceLevel, number>;
  // 全部 (building, material) 选项（含未选中，供「列全部物料自选」）。
  options: SupplyOption[];
  selected: Set<string>;
  summary: {
    dailyCost: number;
    // 选中物料的净待补成本合计（已扣设施内部存量）。
    fillCost: number;
    weight: number;
    volume: number;
    missingPrices: number;
    achievable: boolean;
    // 封顶短板需求（目标不可达时）。
    limitingNeed?: Need;
  };
}

// ── 纯函数 ──────────────────────────────────────────────────────────────
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
};

// 计算过程列的数字口径：整数不带小数，非整数保留 2 位，与面板 fixed0/fixed2 一致。
const formatQuantity = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const safeStock = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;

// 五类人口对六类需求的「需求量」= Σ pop[level] × weight[level][need]。
export function computeNeeded(population: Record<WorkforceLevel, number>): Record<Need, number> {
  const result = {} as Record<Need, number>;
  for (const need of NEEDS) {
    result[need] = sum(
      LEVELS.map(level => (population[level] ?? 0) * HAPPINESS_WEIGHTS[level][need]),
    );
  }
  return result;
}

// 4 层封顶：高层不能超过其下一层最差的一项。
export function applyCapping(fulfillment: Record<Need, number>): {
  fulfillment: Record<Need, number>;
  capped: Record<Need, boolean>;
} {
  const result = { ...fulfillment } as Record<Need, number>;
  const capped = Object.fromEntries(NEEDS.map(need => [need, false])) as Record<Need, boolean>;
  for (let tier = 1; tier < TIERS.length; tier++) {
    const cap = Math.min(...TIERS[tier - 1].map(need => result[need]));
    for (const need of TIERS[tier]) {
      if (result[need] > cap) {
        result[need] = cap;
        capped[need] = true;
      }
    }
  }
  return { fulfillment: result, capped };
}

// 五类人口幸福度（needHappiness）= Σ weight[level][need] × fulfillment[need]。
export function computeHappiness(
  fulfillment: Record<Need, number>,
): Record<WorkforceLevel, number> {
  const result = {} as Record<WorkforceLevel, number>;
  for (const level of LEVELS) {
    result[level] = clamp01(
      sum(NEEDS.map(need => HAPPINESS_WEIGHTS[level][need] * fulfillment[need])),
    );
  }
  return result;
}

// 生成全部 (building, material) 选项（与 oog allOptions 对应）。
function buildOptions(input: GovhInput): SupplyOption[] {
  const options: SupplyOption[] = [];
  for (const building of UPKEEP_BUILDINGS) {
    const builtLevel = input.levels[building.ticker] ?? 0;
    if (builtLevel <= 0) {
      continue;
    }
    const n = Object.keys(building.upkeep).length;
    for (const [ticker, qtyPerDayPerLevel] of Object.entries(building.upkeep)) {
      const contribPerLevel: Partial<Record<InfraNeed, number>> = {};
      for (const [need, amount] of Object.entries(building.needs) as [InfraNeed, number][]) {
        if (amount > 0) {
          contribPerLevel[need] = amount / n;
        }
      }
      const needs = Object.keys(contribPerLevel) as InfraNeed[];
      if (needs.length === 0) {
        continue;
      }
      const price = input.prices[ticker];
      const qtyPerDay = qtyPerDayPerLevel * builtLevel;
      const grossFillAmount = qtyPerDay * 30; // reserve = 30 天量（pct 官方）
      const stock = input.facilityStocks?.[building.ticker]?.[ticker];
      const stockNextConsumption = safeStock(stock?.nextConsumption);
      const stockReserve = safeStock(stock?.reserve);
      const stockTotal = stockNextConsumption + stockReserve;
      // 政府基建设施内部已有的「下一次消耗 + 储备」直接抵扣一次性采购量。
      const netFillAmount = Math.max(0, grossFillAmount - stockTotal);
      const dailyCost = price !== undefined ? qtyPerDay * price : 0;
      const grossFillCost = price !== undefined ? grossFillAmount * price : 0;
      const netFillCost = price !== undefined ? netFillAmount * price : 0;
      // contribPerLevel 是「每 1 级」的贡献，dailyCost 已含 builtLevel；
      // 性价比必须把贡献乘回实际等级，否则高等级建筑会被按 1/level 低估。
      const totalContrib = sum(needs.map(need => contribPerLevel[need] ?? 0)) * builtLevel;
      const efficiency =
        price === undefined ? -1 : price === 0 ? Infinity : totalContrib / dailyCost;
      options.push({
        key: `${building.ticker}.${ticker}`,
        building: building.ticker,
        buildingName: building.name,
        ticker,
        qtyPerDayPerLevel,
        builtLevel,
        needs,
        contribPerLevel,
        price,
        qtyPerDay,
        dailyCost,
        grossFillAmount,
        grossFillCost,
        stockNextConsumption,
        stockReserve,
        stockTotal,
        netFillAmount,
        netFillCost,
        calculation: `30天填充 ${formatQuantity(grossFillAmount)} − 下一次消耗 ${formatQuantity(
          stockNextConsumption,
        )} − 储备 ${formatQuantity(stockReserve)} = 待补 ${formatQuantity(netFillAmount)}`,
        efficiency,
        selected: false,
      });
    }
  }
  return options;
}

// 计算某组「待采购」选项下，各需求的最终提供量。
// 基准：
//   - 基地给 safety / health 各 50×siteCount；
//   - 维生由住房 / 星球肥沃度决定，GOVH 的基建物料改变不了它，
//     必须用 POPR 当前原值作为固定基线，否则 4 层封顶会把全部需求误压成 0%；
//   - 已经填满 30 天（netFillAmount = 0）的物料不需要再买，但设施里已有，
//     始终计入提供量，不受勾选状态影响。
function computeProvided(
  input: GovhInput,
  options: SupplyOption[],
  active: Set<string>,
  needed: Record<Need, number>,
): Record<Need, number> {
  const provided = Object.fromEntries(NEEDS.map(need => [need, 0])) as Record<Need, number>;
  const base = 50 * input.siteCount;
  provided.SAFETY = base;
  provided.HEALTH = base;
  provided.LIFE_SUPPORT = needed.LIFE_SUPPORT * clamp01(input.currentFulfillment.LIFE_SUPPORT ?? 0);
  for (const option of options) {
    // 已填满的存量是免费基线；未填满时必须显式采购才计入。
    if (!active.has(option.key) && option.netFillAmount > 0) {
      continue;
    }
    for (const [need, contrib] of Object.entries(option.contribPerLevel) as [InfraNeed, number][]) {
      provided[need] += contrib * option.builtLevel;
    }
  }
  return provided;
}

// 由提供量算封顶后满足度。
function fulfillmentsFromProvided(
  needed: Record<Need, number>,
  provided: Record<Need, number>,
): Record<Need, number> {
  const raw = {} as Record<Need, number>;
  for (const need of NEEDS) {
    raw[need] = needed[need] > 0 ? clamp01(provided[need] / needed[need]) : 1;
  }
  return applyCapping(raw).fulfillment;
}

function allTargetsMet(
  needed: Record<Need, number>,
  provided: Record<Need, number>,
  target: number,
): boolean {
  const f = fulfillmentsFromProvided(needed, provided);
  return INFRA_NEEDS.every(need => f[need] >= target - 1e-9);
}

// 当前需求维度上的「每 credit 贡献」。Phase1 必须按当前短板需求排序，
// 而不是按跨需求合计排序，否则一个总贡献高但对本需求低效的物料会挤掉真正便宜的选项。
function needEfficiency(option: SupplyOption, need: InfraNeed): number {
  if (option.price === undefined) {
    return -1;
  }
  const contrib = (option.contribPerLevel[need] ?? 0) * option.builtLevel;
  if (contrib <= 0) {
    return -1;
  }
  return option.price === 0 ? Infinity : contrib / option.dailyCost;
}

function compareByEfficiency(a: number, b: number, direction: 'asc' | 'desc'): number {
  if (a === Infinity && b === Infinity) {
    return 0;
  }
  return direction === 'asc' ? a - b : b - a;
}

// ── 主求解 ──────────────────────────────────────────────────────────────
export function solve(input: GovhInput): GovhResult {
  const target = clamp01(input.target);
  const needed = computeNeeded(input.population);
  const options = buildOptions(input);
  const optionByKey = new Map(options.map(o => [o.key, o]));

  let selected: Set<string>;
  if (input.selected !== undefined) {
    // 用户显式选择：仅保留仍存在的键。
    selected = new Set([...input.selected].filter(key => optionByKey.has(key)));
  } else if (input.fillAll) {
    selected = new Set(options.map(o => o.key));
  } else {
    // ── Phase 1：逐需求贪心（沿用 oog 两阶段思路）──────────────────────
    // 免费基线（已填满 30 天的物料）由 computeProvided 自动计入，不需要采购，
    // 因此不进入 selected；selected 始终表示「这次真正要买的物料」。
    selected = new Set();
    for (const need of INFRA_NEEDS) {
      // 每轮按当前已选集合重算缺口：天然包含基地、维生基线、免费存量，
      // 以及之前需求选中的交叉贡献，避免重复采购。
      const providedNow = computeProvided(input, options, selected, needed);
      let remaining = needed[need] * target - providedNow[need];
      if (remaining <= 0) {
        continue;
      }
      const candidates = options
        .filter(
          o => o.netFillAmount > 0 && !selected.has(o.key) && (o.contribPerLevel[need] ?? 0) > 0,
        )
        // 按「当前短板需求」的每 credit 贡献降序；无报价排最后。
        .sort((a, b) =>
          compareByEfficiency(needEfficiency(a, need), needEfficiency(b, need), 'desc'),
        );
      for (const option of candidates) {
        if (remaining <= 0) {
          break;
        }
        selected.add(option.key);
        remaining -= (option.contribPerLevel[need] ?? 0) * option.builtLevel;
      }
    }

    // ── Phase 2：剔除冗余物料（避免超买）───────────────────────────────
    // 按总性价比从低到高尝试移除，移除后仍达标则永久移除。
    const removeOrder = [...selected].sort((a, b) =>
      compareByEfficiency(optionByKey.get(a)!.efficiency, optionByKey.get(b)!.efficiency, 'asc'),
    );
    for (const key of removeOrder) {
      selected.delete(key);
      if (!allTargetsMet(needed, computeProvided(input, options, selected, needed), target)) {
        selected.add(key);
      }
    }
  }

  // ── 预览结果 ──────────────────────────────────────────────────────────
  const provided = computeProvided(input, options, selected, needed);
  const rawFulfillment = {} as Record<Need, number>;
  for (const need of NEEDS) {
    rawFulfillment[need] = needed[need] > 0 ? provided[need] / needed[need] : 1;
  }
  const { fulfillment, capped } = applyCapping(rawFulfillment);
  const happiness = computeHappiness(fulfillment);

  const needs = {} as Record<Need, NeedState>;
  for (const need of NEEDS) {
    needs[need] = {
      needed: needed[need],
      provided: provided[need],
      current: clamp01(input.currentFulfillment[need] ?? 0),
      fulfillment: clamp01(fulfillment[need]),
      capped: capped[need],
    };
  }

  let dailyCost = 0;
  let fillCost = 0;
  let weight = 0;
  let volume = 0;
  let missingPrices = 0;
  for (const option of options) {
    option.selected = selected.has(option.key);
    if (!option.selected) {
      continue;
    }
    if (option.price === undefined) {
      // 已填满的物料不需要报价（待补量为 0），不算缺价。
      if (option.netFillAmount > 0) {
        missingPrices++;
      }
      continue;
    }
    dailyCost += option.dailyCost;
    fillCost += option.netFillCost;
    const info = input.materialsInfo?.[option.ticker];
    if (info) {
      weight += info.weight * option.netFillAmount;
      volume += info.volume * option.netFillAmount;
    }
  }

  const achievable = allTargetsMet(needed, provided, target);
  let limitingNeed: Need | undefined;
  for (let tier = 1; tier < TIERS.length; tier++) {
    const lower = TIERS[tier - 1];
    const worst = lower.reduce(
      (acc, need) => (clamp01(fulfillment[need]) < clamp01(fulfillment[acc]) ? need : acc),
      lower[0],
    );
    if (clamp01(fulfillment[worst]) < target) {
      limitingNeed = worst;
      break;
    }
  }

  return {
    needs,
    happiness,
    options,
    selected,
    summary: {
      dailyCost,
      fillCost,
      weight,
      volume,
      missingPrices,
      achievable,
      limitingNeed,
    },
  };
}
