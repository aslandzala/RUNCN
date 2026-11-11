// XIT GOVH 的本地 DOM 取数层。
//
// 数据来源全部是游戏原生窗口，无任何外部请求：
//   - POPR <星球>：五类人口、五类幸福度、六类需求满足度（游戏已算好，含封顶）。
//   - POPI <星球>：14 座基建建筑的「已建造」等级。
//   - POPID p-<星球> t-<建筑>：各建筑维护供给表里的「下一次消耗 / 储备」当前存量。
//
// 取数机制与底栏换汇 / BPC/BMAT 一致：用 showBuffer 开一个 hidden 窗口
// （buffers.ts 会隐藏窗口与 dock 按钮，不闪），等原生表格 DOM 出现后解析，
// closeWhen 满足时窗口自动关闭。不切视图、不抢前台、不下单。
//
// 解析只用语义类（C.Population.table / container）与表头/行首文本，不写死
// CSS module hash；解析失败给出明确错误，由面板层降级提示，绝不连 FIO。

import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { sleep } from '@src/utils/sleep';
import {
  LEVELS,
  NEEDS,
  LEVEL_LABELS,
  NEED_LABELS,
  UPKEEP_BUILDINGS,
  type FacilityMaterialStocks,
  type FacilityStocks,
  type Need,
  type WorkforceLevel,
} from './govh-model';

// 中英双语表头标签：游戏语言可能是中文或英文，表头文本用任一命中即可。
const LEVEL_HEADERS: Record<WorkforceLevel, string[]> = {
  PIONEER: [LEVEL_LABELS.PIONEER, 'Pioneer'],
  SETTLER: [LEVEL_LABELS.SETTLER, 'Settler'],
  TECHNICIAN: [LEVEL_LABELS.TECHNICIAN, 'Technician', '职技工'],
  ENGINEER: [LEVEL_LABELS.ENGINEER, 'Engineer'],
  SCIENTIST: [LEVEL_LABELS.SCIENTIST, 'Scientist'],
};
const NEED_HEADERS: Record<Need, string[]> = {
  LIFE_SUPPORT: [NEED_LABELS.LIFE_SUPPORT, 'Life Support'],
  SAFETY: [NEED_LABELS.SAFETY, 'Safety'],
  HEALTH: [NEED_LABELS.HEALTH, 'Health'],
  COMFORT: [NEED_LABELS.COMFORT, 'Comfort'],
  CULTURE: [NEED_LABELS.CULTURE, 'Culture'],
  EDUCATION: [NEED_LABELS.EDUCATION, 'Education'],
};
// 行首标签：中文 / 英文（POPR 行首是「人口」「幸福」「需求满足度」）。
const ROW_POPULATION = ['人口', 'Population'];
const ROW_HAPPINESS = ['幸福', 'Happiness'];
const ROW_FULFILLMENT = ['需求满足度', 'Needs Fulfillment', 'Need Fulfillment'];
// POPID 维护供给表表头。只取「下一次消耗 / 储备」两个进度条的 value，
// 不读「库存」或「贡献」，那两列不是用户要求扣除的设施内部存量。
const STOCK_NEXT_HEADERS = ['下一次消耗', 'Next Consumption'];
const STOCK_RESERVE_HEADERS = ['储备', 'Reserve'];

// 本期 POPR 报告的一行明细，保留游戏原生显示文本（含 "-- / -1" 与 "%"）。
export interface PopulationReportRow {
  label: string;
  values: Record<WorkforceLevel, string>;
}

// POPR 底部的管理方项目（可选，部分星球没有）。
export interface GovernanceProject {
  name: string;
  description: string;
}

export interface GovhSnapshot {
  planet: string;
  // 五类人口数量。
  population: Record<WorkforceLevel, number>;
  // 五类人口幸福度 0~1（POPR 游戏值）。
  happiness: Record<WorkforceLevel, number>;
  // 六类需求满足度 0~1（POPR 游戏值，含封顶）。
  fulfillment: Record<Need, number>;
  // 六类需求满足度的原生显示文本（含 "--"），面板直接展示本期原值。
  fulfillmentText: Record<Need, string>;
  // POPR 报告明细：人口 / 变更 / 移民 / 教育（增/减）/ 幸福 / 失业 / 待聘。
  reportRows: PopulationReportRow[];
  // 报告编号与时间，如 "报告#43/3天 13小时前"。
  reportLabel?: string;
  // 管理方项目，POPR 底部可选区块。
  project?: GovernanceProject;
  // 14 座建筑的已建造等级：ticker -> level。
  levels: Record<string, number>;
  // 各已建建筑内，每种物料的「下一次消耗 + 储备」当前存量。
  facilityStocks: FacilityStocks;
}

const POPR_TIMEOUT = 12000;
const POPI_TIMEOUT = 12000;
const POPID_TIMEOUT = 9000;

// 把 "1,995" / "86.0%" / "--" 解析为数字；无法解析返回 undefined。
function parseNumber(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const cleaned = text.trim().replace(/[,%\s]/g, '');
  if (cleaned === '' || cleaned === '--' || cleaned === '-') {
    return undefined;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

// 去掉 ⓘ 等提示图标与空白。
function cleanLabel(text: string | undefined): string {
  return (text ?? '').replace(/[ⓘ\u200b]/g, '').trim();
}

// 在窗口内找原生 Population 表格。
// POPR / POPI 的表格带 `Population__table` 语义类，但 POPID 的维护供给表只是
// 普通 <table>（实测没有该类）。优先用语义类，找不到时回退到原生 table，
// 表头判断仍由各解析器负责，不会误把其它表格当数据。
function populationTables(window: HTMLElement): HTMLTableElement[] {
  const container = C.Population.container ? _$(window, C.Population.container) : undefined;
  const scope = container ?? window;
  const semantic = C.Population.table ? (_$$(scope, C.Population.table) as HTMLTableElement[]) : [];
  return semantic.length > 0 ? semantic : (_$$(scope, 'table') as HTMLTableElement[]);
}

function rowsOf(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll('tr'));
}

function cellsOf(row: HTMLTableRowElement): string[] {
  return Array.from(row.children).map(cell => cleanLabel(cell.textContent ?? ''));
}

// 找本次 showBuffer 新建的窗口。
// buffers.ts 在 autoClose 下会先释放串行队列再真正关闭旧窗口；如果只按 command
// 文本找，新窗口在命令标题尚未写入时会拿到空标题并被错过。先锁定「本次新增」的
// 窗口元素，再优先按命令匹配，匹配不到就直接用新增的那个（它一定属于本次调用）。
function findCreatedWindow(command: string, before: Set<HTMLElement>): HTMLElement | undefined {
  const candidates = _$$(document, C.Window.window).filter(window => !before.has(window));
  const normalized = command.trim().toUpperCase();
  return (
    candidates.find(window => {
      const cmd = _$(window, C.TileFrame.cmd)?.textContent?.trim().toUpperCase() ?? '';
      return cmd === normalized;
    }) ??
    candidates.find(window => {
      const cmd = _$(window, C.TileFrame.cmd)?.textContent?.trim() ?? '';
      return cmd === '';
    }) ??
    candidates[0]
  );
}

// 等待窗口出现且表格数据就绪，然后解析；超时返回 undefined。
async function withBuffer<T>(
  command: string,
  timeout: number,
  parse: (window: HTMLElement) => T | undefined,
): Promise<T | undefined> {
  const ready = ref(false);
  const deadline = Date.now() + timeout;
  // 先记下已有窗口，之后只认本次新增的那一个。
  const before = new Set(_$$(document, C.Window.window));
  void showBuffer(command, {
    force: true,
    autoClose: true,
    closeWhen: computed(() => ready.value),
  });
  try {
    while (Date.now() < deadline) {
      const window = findCreatedWindow(command, before);
      if (window) {
        // 游戏把无法识别的指令渲染成空标题的「无效指令」窗口。快速失败，
        // 否则逐建筑读取时每座都要空等整个超时，面板会长时间停在「读取中…」。
        const text = window.textContent ?? '';
        if (text.includes('无效指令') || /invalid command/i.test(text)) {
          return undefined;
        }
        const result = parse(window);
        if (result !== undefined) {
          return result;
        }
      }
      await sleep(150);
    }
    return undefined;
  } finally {
    // 无论成功超时都让 hidden 窗口关闭，避免残留。
    ready.value = true;
    // buffers.ts 的 processWindow 只 `void closeWhenDone()`，showBuffer 会在真正的
    // 关闭动画完成前就释放串行队列。必须等本次新增窗口从 DOM 断开，
    // 否则下一个 POPID 窗口会抢到正在关闭的壳，命令标题是空的（实测会卡住）。
    const created = _$$(document, C.Window.window).filter(window => !before.has(window));
    for (const window of created) {
      for (let i = 0; i < 30 && window.isConnected; i++) {
        await sleep(50);
      }
    }
    // 窗口 DOM 断开后，PrUn 内部的 tile id → 窗口映射还会晚一拍更新。
    // 连续开多个 hidden 窗口时留一个短暂 settle 窗口给游戏自己收敛
    // （不抢前台、不额外开窗）。实测 250ms 足够，避免逐建筑读取累加等待。
    if (created.length > 0) {
      await sleep(250);
    }
  }
}

// 解析 POPR 人口报告。
function parsePopr(window: HTMLElement, planet: string): GovhSnapshot | undefined {
  const tables = populationTables(window);
  if (tables.length < 2) {
    return undefined;
  }
  // 人口表：表头含先驱者标签；需求表：表头含维生标签。
  const hasHeader = (table: HTMLTableElement, labels: string[]) =>
    labels.some(label => (rowsOf(table)[0]?.textContent ?? '').includes(label));
  const popTable = tables.find(t => hasHeader(t, LEVEL_HEADERS.PIONEER));
  const needTable = tables.find(t => hasHeader(t, NEED_HEADERS.LIFE_SUPPORT));
  if (!popTable || !needTable) {
    return undefined;
  }

  // 人口表：表头行给出列顺序（本地化标签 → LEVELS）。
  const header = cellsOf(rowsOf(popTable)[0]);
  const levelColumns = new Map<WorkforceLevel, number>();
  for (let i = 1; i < header.length; i++) {
    const label = header[i];
    const level = LEVELS.find(l => LEVEL_HEADERS[l].includes(label));
    if (level) {
      levelColumns.set(level, i);
    }
  }
  if (levelColumns.size !== LEVELS.length) {
    return undefined;
  }

  const population = Object.fromEntries(LEVELS.map(l => [l, 0])) as Record<WorkforceLevel, number>;
  const happiness = Object.fromEntries(LEVELS.map(l => [l, 0])) as Record<WorkforceLevel, number>;
  // 本期报告明细：逐行保留游戏原生显示文本，直接给面板展示，不二次格式化。
  const reportRows: PopulationReportRow[] = [];
  let hasPopulation = false;
  for (const row of rowsOf(popTable).slice(1)) {
    const cells = cellsOf(row);
    const label = cells[0] ?? '';
    if (label !== '') {
      const values = Object.fromEntries(
        LEVELS.map(level => [level, cells[levelColumns.get(level) ?? -1] ?? '—']),
      ) as Record<WorkforceLevel, string>;
      reportRows.push({ label, values });
    }
    if (matchesRow(label, ROW_POPULATION)) {
      for (const [level, col] of levelColumns) {
        population[level] = parseNumber(cells[col]) ?? 0;
      }
      hasPopulation = true;
    } else if (matchesRow(label, ROW_HAPPINESS)) {
      for (const [level, col] of levelColumns) {
        const pct = parseNumber(cells[col]);
        happiness[level] = pct === undefined ? 0 : pct / 100;
      }
    }
  }
  if (!hasPopulation) {
    return undefined;
  }

  // 需求表：表头给出六类列，数据行「需求满足度」。
  const needHeader = cellsOf(rowsOf(needTable)[0]);
  const needColumns = new Map<Need, number>();
  for (let i = 1; i < needHeader.length; i++) {
    const label = needHeader[i];
    const need = NEEDS.find(n => NEED_HEADERS[n].includes(label));
    if (need) {
      needColumns.set(need, i);
    }
  }
  const fulfillment = Object.fromEntries(NEEDS.map(n => [n, 0])) as Record<Need, number>;
  const fulfillmentText = Object.fromEntries(NEEDS.map(n => [n, '--'])) as Record<Need, string>;
  let hasFulfillment = false;
  for (const row of rowsOf(needTable).slice(1)) {
    if (!matchesRow(cellsOf(row)[0] ?? '', ROW_FULFILLMENT)) {
      continue;
    }
    const cells = cellsOf(row);
    for (const [need, col] of needColumns) {
      const pct = parseNumber(cells[col]);
      fulfillment[need] = pct === undefined ? 0 : pct / 100;
      fulfillmentText[need] = cells[col] ?? '--';
    }
    hasFulfillment = true;
  }
  if (!hasFulfillment) {
    return undefined;
  }

  return {
    planet,
    population,
    happiness,
    fulfillment,
    fulfillmentText,
    reportRows,
    reportLabel: parseReportLabel(window),
    project: parseGovernanceProject(window),
    levels: {},
    facilityStocks: {},
  };
}

// 行首标签匹配（去掉 ⓘ 后，中英任一前缀命中）。
function matchesRow(label: string, candidates: string[]): boolean {
  return candidates.some(candidate => label.startsWith(candidate));
}

// 从 POPR 顶部控制条读取「报告#43/3天 13小时前」，不读折线图日期轴。
function parseReportLabel(window: HTMLElement): string | undefined {
  const controls = C.Population.controls ? _$(window, C.Population.controls) : undefined;
  if (!controls) {
    return undefined;
  }
  const text = _$$(controls, 'span')
    .map(span => cleanLabel(span.textContent ?? undefined))
    .find(value => /报告\s*#|Report\s*#/i.test(value));
  return text || undefined;
}

// 从 POPR 底部「管理方项目」读取项目名与说明（没有该区块时返回 undefined）。
function parseGovernanceProject(window: HTMLElement): GovernanceProject | undefined {
  const header = (_$$(window, 'div') as HTMLElement[]).find(
    element =>
      element.children.length === 0 &&
      /^(管理方项目|Governor Project)$/i.test(cleanLabel(element.textContent ?? undefined)),
  );
  if (!header) {
    return undefined;
  }
  let name = '';
  let description = '';
  let node = header.nextElementSibling;
  while (node) {
    const label = cleanLabel(_$(node, 'label')?.textContent ?? '');
    const value = cleanLabel(_$(node, '[class*="StaticInput__static"]')?.textContent ?? '');
    if (/^(项目|Project)$/i.test(label)) {
      name = value;
    } else if (/^(说明|Description)$/i.test(label)) {
      description = value;
    }
    node = node.nextElementSibling;
  }
  return name ? { name, description } : undefined;
}

// 建筑名 -> ticker（中文名 + 英文名双映射到固化表）。
const NAME_TO_TICKER = new Map<string, string>(
  UPKEEP_BUILDINGS.flatMap(
    b =>
      [
        [b.name, b.ticker],
        [b.enName, b.ticker],
        [b.enName.toUpperCase(), b.ticker],
      ] as [string, string][],
  ),
);

// 解析 POPI 基建列表（已建造等级）。
function parsePopi(window: HTMLElement): Record<string, number> | undefined {
  const tables = populationTables(window);
  const table = tables.find(t => {
    const header = rowsOf(t)[0]?.textContent ?? '';
    return (
      (header.includes('已建造') || header.includes('Built')) &&
      (header.includes('名称') || header.includes('Name'))
    );
  });
  if (!table) {
    return undefined;
  }
  const levels: Record<string, number> = {};
  const rows = rowsOf(table);
  let parsed = 0;
  for (const row of rows.slice(1)) {
    const cells = cellsOf(row);
    if (cells.length < 2) {
      continue;
    }
    const ticker = NAME_TO_TICKER.get(cells[0]);
    if (!ticker) {
      continue;
    }
    levels[ticker] = parseNumber(cells[1]) ?? 0;
    parsed++;
  }
  return parsed > 0 ? levels : undefined;
}

// 读取 POPID 维护供给表中某一列 progress 的当前 value。
// 「下一次消耗」单元格内还有倒计时文本，必须取 progress 而不是整格数字。
function parseProgressValue(cell: Element | undefined): number {
  const progress = cell?.querySelector('progress');
  if (!progress) {
    return 0;
  }
  const raw = progress.getAttribute('value') ?? (progress as HTMLProgressElement).value;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// 物料 ticker：优先语义类，回退到原生 ColoredIcon 类与首格文本（如 "DW315" → "DW"）。
function materialTicker(row: HTMLTableRowElement): string {
  const bySemantic = C.ColoredIcon.label
    ? (_$(row, C.ColoredIcon.label)?.textContent?.trim() ?? '')
    : '';
  if (/^[A-Za-z0-9]{1,8}$/.test(bySemantic)) {
    return bySemantic;
  }
  const byClass = _$(row, '[class*="ColoredIcon__label"]')?.textContent?.trim() ?? '';
  if (/^[A-Za-z0-9]{1,8}$/.test(byClass)) {
    return byClass;
  }
  const firstCell = cleanLabel(row.children[0]?.textContent ?? '');
  return firstCell.match(/^([A-Za-z]{1,8})/)?.[1] ?? '';
}

// 解析 `POPID p-<planet> t-<building>` 的维护供给表。
// 只读「下一次消耗 / 储备」两个进度条的当前值，不读「库存 / 贡献」。
function parsePopidStock(window: HTMLElement): FacilityMaterialStocks | undefined {
  const table = populationTables(window).find(t => {
    const header = rowsOf(t)[0]?.textContent ?? '';
    return (
      STOCK_NEXT_HEADERS.some(label => header.includes(label)) &&
      STOCK_RESERVE_HEADERS.some(label => header.includes(label))
    );
  });
  if (!table) {
    return undefined;
  }
  const header = cellsOf(rowsOf(table)[0]);
  const nextCol = header.findIndex(cell => STOCK_NEXT_HEADERS.some(label => cell.includes(label)));
  const reserveCol = header.findIndex(cell =>
    STOCK_RESERVE_HEADERS.some(label => cell.includes(label)),
  );
  if (nextCol < 0 || reserveCol < 0) {
    return undefined;
  }

  const stocks: FacilityMaterialStocks = {};
  let parsed = 0;
  for (const row of rowsOf(table).slice(1)) {
    // 物料 ticker 在 ColoredIcon 的 label 里；td.textContent 还混着库存角标数字。
    const ticker = materialTicker(row);
    if (ticker === '') {
      continue;
    }
    const cells = Array.from(row.children);
    stocks[ticker] = {
      nextConsumption: parseProgressValue(cells[nextCol]),
      reserve: parseProgressValue(cells[reserveCol]),
    };
    parsed++;
  }
  return parsed > 0 ? stocks : undefined;
}

// 从游戏本地 DOM 读取某星球的治理现状。
// 依次打开 POPR / POPI 与每个已建建筑的 POPID hidden 窗口；
// 关键数据失败返回 undefined（面板降级提示），绝不按 0 存量静默给出偏大清单。
export async function readGovernanceSnapshot(planet: string): Promise<GovhSnapshot | undefined> {
  // 星球编码保留玩家输入的原样（PrUn natural ID 大小写敏感，如 VH-192b）。
  const target = planet.trim();
  if (target === '') {
    return undefined;
  }
  const popr = await withBuffer(`POPR ${target}`, POPR_TIMEOUT, window =>
    parsePopr(window, target),
  );
  if (!popr) {
    return undefined;
  }
  const levels = await withBuffer(`POPI ${target}`, POPI_TIMEOUT, parsePopi);
  if (!levels) {
    return undefined;
  }

  // 逐建筑打开 POPID 详情窗口。汇总命令 `POPID p-<planet>` 不带维护供给表，
  // 必须带 `t-<ticker>`；只读取已建建筑，避免无谓窗口。
  const facilityStocks: FacilityStocks = {};
  const built = UPKEEP_BUILDINGS.filter(b => (levels[b.ticker] ?? 0) > 0);
  for (const building of built) {
    const stocks = await withBuffer(
      // POPID 必须带 `p-` 星球前缀；不带前缀会被游戏判为「无效指令」。
      `POPID p-${target} t-${building.ticker}`,
      POPID_TIMEOUT,
      parsePopidStock,
    );
    if (stocks) {
      facilityStocks[building.ticker] = stocks;
    }
  }
  // 有已建建筑却一个维护表都没读到时宁可报错，也不能按 0 存量给出偏大的采购量。
  if (built.length > 0 && Object.keys(facilityStocks).length === 0) {
    return undefined;
  }
  return { ...popr, levels, facilityStocks };
}
