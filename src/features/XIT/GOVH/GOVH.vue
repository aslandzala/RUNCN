<script setup lang="ts">
// XIT GOVH 政府基建补给助手主面板。
// 数据全部来自游戏本地：POPR / POPI / POPID 原生窗口 DOM（govh-dom）+ cxobStore
// 实时订单簿（复用 BPC/BMAT/CBUY 的 bp-utils）+ sitesStore 基地数 + materialsStore
// 重量体积。零外部请求。求解模型见 govh-model.ts（固化 oog 系数与算法，运行时零网络）。

import Header from '@src/components/Header.vue';
import ActionBar from '@src/components/ActionBar.vue';
import SectionHeader from '@src/components/SectionHeader.vue';
import PrunButton from '@src/components/PrunButton.vue';
import MaterialIcon from '@src/components/MaterialIcon.vue';
import Active from '@src/components/forms/Active.vue';
import TextInput from '@src/components/forms/TextInput.vue';
import SearchInput from '@src/components/forms/SearchInput.vue';
import { useXitParameters } from '@src/hooks/use-xit-parameters';
import { useTileState } from '@src/store/user-data-tiles';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { getEntityNaturalIdFromAddress } from '@src/infrastructure/prun-api/data/addresses';
import { sitesStore } from '@src/infrastructure/prun-api/data/sites';
import { materialsStore } from '@src/infrastructure/prun-api/data/materials';
import { getMaterialName } from '@src/infrastructure/prun-ui/i18n';
import { fixed0, fixed2, percent1 } from '@src/utils/format';
import { readGovernanceSnapshot, type GovhSnapshot } from './govh-dom';
import { readCachedSnapshot, writeCachedSnapshot } from './govh-cache';
import { useManagedGovernments } from './govh-governments';
import { setGovhQuote } from './govh-quote';
import { readPrices, subscribePrices, GOVH_EXCHANGES } from './govh-prices';
import { solve, LEVELS, LEVEL_LABELS, NEEDS, NEED_LABELS, UPKEEP_BUILDINGS } from './govh-model';

const parameters = useXitParameters();
const planetInput = useTileState('govh-planet', '');
const target = useTileState<0.7 | 1>('govh-target', 0.7);
// 命令参数 `XIT GOVH VH-192b` 预填星球（保留玩家输入的大小写）。
if (parameters[0] && parameters[0].trim() !== '') {
  planetInput.value = parameters[0].trim();
}

// 游戏本地「视图」菜单里，我作为管理者的政府 → 星球编码。零外部请求、零硬编码账号数据。
const { governments, loaded: governmentsLoaded } = useManagedGovernments();
// 自定义兜底：仅当菜单尚未就绪或需要查非管理星球时使用，默认不显示输入框。
const CUSTOM_PLANET = '__custom__';
const customMode = ref(false);
const customPlanet = ref('');
const mounted = ref(false);
let loadSeq = 0;

const snapshot = shallowRef<GovhSnapshot | undefined>(undefined);
const loading = ref(false);
const error = ref<string | undefined>(undefined);
const info = ref<string | undefined>(undefined);
const disposed = ref(false);
const search = ref('');
// 用户显式勾选集合；undefined = 用求解器推荐。
const userSelected = shallowRef<Set<string> | undefined>(undefined);
// 额外 additive 价格刷新 nonce：订单簿推送会触发 computed 重算，这里只用于手动刷新提示。
const priceNonce = ref(0);

// 下拉数据：只用 userDataStore 的 GOVERNMENT 上下文过滤「视图」菜单里的星球链接。
function findGovernment(value: string) {
  const needle = value.trim().toLowerCase();
  return governments.value.find(
    g => g.planet.toLowerCase() === needle || g.name.toLowerCase() === needle,
  );
}

// 命令参数 / 旧存档可能是 VH-192B 这类大小写，命中本地政府时回正到服务端 naturalId。
function canonicalPlanet(value: string): string {
  return findGovernment(value)?.planet ?? value.trim();
}

interface GovernmentOption {
  label: string;
  value: string;
}

const governmentOptions = computed<GovernmentOption[]>(() => {
  const options = governments.value.map(g => ({
    label: `${g.name} (${g.planet})`,
    value: g.planet,
  }));
  const current = planetInput.value.trim();
  // 命令参数或旧存档里的星球可能不在政府列表中，仍保留为可选项避免丢失上下文。
  if (current && !options.some(o => o.value.toLowerCase() === current.toLowerCase())) {
    options.unshift({ label: `自定义：${current}`, value: current });
  }
  return options;
});

const governmentPlaceholder = computed(() => {
  if (governments.value.length > 0) {
    return `选择我管理的政府（${governments.value.length} 个）`;
  }
  if (!governmentsLoaded.value) {
    return '正在读取我管理的政府…';
  }
  return '未在「视图」菜单中检测到政府';
});

const governmentStatus = computed(() => {
  if (governments.value.length > 0) {
    return `已从游戏本地「视图」菜单预设 ${governments.value.length} 个我管理的政府：${governments.value
      .map(g => g.planet)
      .join(' / ')}`;
  }
  if (!governmentsLoaded.value) {
    return '正在从游戏本地「视图」菜单读取我管理的政府…';
  }
  return '未检测到管理的政府；可选「自定义编码…」输入星球编码。';
});

const selectedGovernment = computed<string>({
  get: () => (customMode.value ? CUSTOM_PLANET : planetInput.value.trim()),
  set: value => {
    if (value === CUSTOM_PLANET) {
      customMode.value = true;
      const current = planetInput.value.trim();
      customPlanet.value = current && !findGovernment(current) ? current : '';
      planetInput.value = '';
      snapshot.value = undefined;
      error.value = undefined;
      info.value = undefined;
      return;
    }
    customMode.value = false;
    const canonical = canonicalPlanet(value);
    planetInput.value = canonical;
    userSelected.value = undefined;
    if (mounted.value && canonical !== '') {
      void refreshData();
    }
  },
});

// 政府列表就绪后：空选自动落到第一个政府；已有选择则只回正大小写。
watch(
  governments,
  list => {
    if (list.length === 0 || customMode.value) {
      return;
    }
    const current = planetInput.value.trim();
    if (current === '') {
      planetInput.value = list[0].planet;
      if (mounted.value) {
        void refreshData();
      }
      return;
    }
    const canonical = canonicalPlanet(current);
    if (canonical !== current) {
      planetInput.value = canonical;
      if (mounted.value) {
        void refreshData();
      }
    }
  },
  { immediate: true },
);

watch(customPlanet, value => {
  if (customMode.value) {
    planetInput.value = value.trim();
  }
});

function applyCustomPlanet() {
  if (!customMode.value) {
    return;
  }
  // 手填也走一次本地政府表回正大小写，避免 VH-192B 这类输入打不开 POPR。
  const canonical = canonicalPlanet(customPlanet.value.trim());
  customPlanet.value = canonical;
  planetInput.value = canonical;
  userSelected.value = undefined;
  void refreshData();
}

// 该星球玩家自有基地数（本地 sitesStore，按 planet naturalId 统计）。
const siteCount = computed(() => {
  const planet = (snapshot.value?.planet ?? planetInput.value).trim().toUpperCase();
  if (planet === '') {
    return 0;
  }
  return (sitesStore.all.value ?? []).filter(
    site => (getEntityNaturalIdFromAddress(site.address) ?? '').toUpperCase() === planet,
  ).length;
});

// 全部参与补给的物料 ticker（来自已建建筑，去重）。
const tickers = computed(() => {
  if (!snapshot.value) {
    return [] as string[];
  }
  const set = new Set<string>();
  for (const building of UPKEEP_BUILDINGS) {
    if ((snapshot.value.levels[building.ticker] ?? 0) > 0) {
      for (const ticker of Object.keys(building.upkeep)) {
        set.add(ticker);
      }
    }
  }
  return [...set].sort();
});

// 单价统一走 BPC/BMAT/CBUY 同一套本地订单簿价格源，不提供手填覆盖。
const prices = computed<Record<string, number | undefined>>(() => {
  void priceNonce.value; // 依赖：手动刷新时强制重算
  const live = readPrices(tickers.value);
  return Object.fromEntries(tickers.value.map(ticker => [ticker, live[ticker]?.price]));
});
const priceExchanges = computed<Record<string, string>>(() => {
  const live = readPrices(tickers.value);
  return Object.fromEntries(tickers.value.map(ticker => [ticker, live[ticker]?.exchange ?? '—']));
});

// 物料重量/体积（本地 materialsStore）。
const materialsInfo = computed<Record<string, { weight: number; volume: number }>>(() => {
  const result: Record<string, { weight: number; volume: number }> = {};
  for (const ticker of tickers.value) {
    const material = materialsStore.getByTicker(ticker);
    result[ticker] = { weight: material?.weight ?? 0, volume: material?.volume ?? 0 };
  }
  return result;
});

// 主求解：每次输入 / 价格 / 勾选变化都实时重算。
const result = computed(() => {
  const snap = snapshot.value;
  if (!snap) {
    return undefined;
  }
  return solve({
    population: snap.population,
    siteCount: siteCount.value,
    currentFulfillment: snap.fulfillment,
    currentHappiness: snap.happiness,
    levels: snap.levels,
    facilityStocks: snap.facilityStocks,
    target: target.value,
    prices: prices.value,
    selected: userSelected.value,
    materialsInfo: materialsInfo.value,
  });
});

// 已建建筑列表（14 座中等级 > 0 的）。
const builtBuildings = computed(() =>
  UPKEEP_BUILDINGS.filter(b => (snapshot.value?.levels[b.ticker] ?? 0) > 0),
);

// 物料表（可搜索），按性价比降序（solve 已排序，显式选择时按原价序）。
const filteredOptions = computed(() => {
  const options = result.value?.options ?? [];
  const query = search.value.trim().toLowerCase();
  if (query === '') {
    return options;
  }
  return options.filter(option => {
    const material = materialsStore.getByTicker(option.ticker);
    const name = getMaterialName(material) ?? '';
    return `${option.ticker} ${option.buildingName} ${option.building} ${name}`
      .toLowerCase()
      .includes(query);
  });
});

function materialName(ticker: string): string {
  return getMaterialName(materialsStore.getByTicker(ticker)) ?? ticker;
}

// 模板内百分比：0.86 → "86.0%"，与 fixed0/fixed2 同一本地化口径。
function formatPercent(value: number): string {
  return percent1(value);
}

// 会话内缓存年龄文案：避免切回面板时重复开 POPR / POPI / 逐建筑 POPID hidden 窗口。
function cacheAge(savedAt: number): string {
  const minutes = Math.floor((Date.now() - savedAt) / 60_000);
  return minutes < 1 ? '刚刚' : `${minutes} 分钟前`;
}

function snapshotInfo(snap: GovhSnapshot, suffix: string): string {
  const population = LEVELS.reduce((n, l) => n + snap.population[l], 0);
  const stocked = Object.keys(snap.facilityStocks).length;
  return `已读取 ${snap.planet}：${population.toLocaleString()} 人口 · ${siteCount.value} 座自有基地 · ${builtBuildings.value.length} 类已建基建 · ${stocked} 座设施的「下一次消耗/储备」已计入待补量 · ${suffix}`;
}

// 会话快照在 setup 阶段同步恢复，而不是等 onMounted 再异步读缓存。
// 原因：切换政府 / 公司视图会重建 XIT 磁贴，组件重新挂载。若 snapshot 初始为
// undefined，首绘先渲染空态，随后 refreshData 命中缓存给 snapshot 赋新引用，
// 触发 result 重算 + 20 行 × 11 列整表（含计算过程长文本）二次重建，用户感知为
// 「每次激活 GOVH 都要重新载入计算过程」。在首次渲染前把快照就位即可避免这一次重建。
// 只恢复纯 DOM 快照，价格仍走 cxobStore 实时源；「刷新数据」按钮仍强制重读。
const restoredFromCache = ref(false);
function restoreFromCache(): boolean {
  const planet = planetInput.value.trim();
  if (planet === '') {
    return false;
  }
  const cached = readCachedSnapshot(planet);
  if (!cached) {
    return false;
  }
  snapshot.value = cached.snapshot;
  info.value = snapshotInfo(
    cached.snapshot,
    `本地缓存（${cacheAge(cached.savedAt)}，点「刷新数据」重读）`,
  );
  restoredFromCache.value = true;
  return true;
}
restoreFromCache();

// 读取 POPR / POPI / POPID 快照。loadSeq 保证快速切换政府时只认最后一次结果。
// force=true（「刷新数据」按钮）绕过会话缓存并覆写；普通打开 / 切回直接复用。
async function refreshData(force = false) {
  const planet = planetInput.value.trim();
  if (planet === '') {
    error.value = customMode.value
      ? '请先输入自定义星球编码（例如 VH-192b）'
      : '请先从表头下拉菜单选择我作为管理者的政府';
    info.value = undefined;
    return;
  }
  const seq = ++loadSeq;
  loading.value = true;
  error.value = undefined;
  info.value = undefined;
  userSelected.value = undefined;
  if (snapshot.value && snapshot.value.planet !== planet) {
    snapshot.value = undefined;
  }
  try {
    const cached = force ? undefined : readCachedSnapshot(planet);
    if (cached) {
      snapshot.value = cached.snapshot;
      info.value = snapshotInfo(
        cached.snapshot,
        `本地缓存（${cacheAge(cached.savedAt)}，点「刷新数据」重读）`,
      );
      void subscribePrices(
        tickers.value,
        ticker => prices.value[ticker] !== undefined,
        () => disposed.value,
      );
      return;
    }
    const snap = await readGovernanceSnapshot(planet);
    if (seq !== loadSeq || disposed.value) {
      return;
    }
    if (!snap) {
      error.value = `读取 ${planet} 的 POPR / POPI / POPID 失败：请确认星球编码正确、游戏原生窗口可正常打开，且已建建筑的维护供给表可读。`;
      snapshot.value = undefined;
      return;
    }
    snapshot.value = snap;
    writeCachedSnapshot(planet, snap);
    info.value = snapshotInfo(snap, '刚刚从本地窗口读取');
    // 本地订单簿按需订阅（hidden CXOB，零外部请求）。
    void subscribePrices(
      tickers.value,
      ticker => prices.value[ticker] !== undefined,
      () => disposed.value,
    );
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
    }
  }
}

// 手动更新价格：重新订阅缺失报价的物料，订阅结束后必须回收提示。
async function refreshPrices() {
  if (!snapshot.value) {
    return;
  }
  priceNonce.value++;
  info.value = '正在从本地订单簿更新价格（不会连接任何外部网站）…';
  await subscribePrices(
    tickers.value,
    ticker => prices.value[ticker] !== undefined,
    () => disposed.value,
    true,
  );
  if (disposed.value) {
    return;
  }
  const available = tickers.value.filter(t => prices.value[t] !== undefined).length;
  info.value = `本地订单簿已更新：${available} / ${tickers.value.length} 种物料有实时买一价（零外部请求）`;
}

// 勾选 / 取消某物料（含同一 ticker 的多建筑条目独立）。
function toggleOption(key: string) {
  const current = new Set(result.value?.selected ?? []);
  if (current.has(key)) {
    current.delete(key);
  } else {
    current.add(key);
  }
  userSelected.value = current;
}

function isSelected(key: string): boolean {
  return result.value?.selected.has(key) ?? false;
}

// 全选 / 清空 / 恢复推荐。
function selectAll() {
  userSelected.value = new Set(result.value?.options.map(o => o.key) ?? []);
}
function selectNone() {
  userSelected.value = new Set();
}
function resetToRecommended() {
  userSelected.value = undefined;
}

// 目标切换。
function setTarget(value: 0.7 | 1) {
  target.value = value;
  userSelected.value = undefined; // 切换目标重新求解
}

// 汇总清单：按 ticker 合并选中物料扣除基建内部存量后的待补量。
function buildCartItems(): { ticker: string; amount: number }[] {
  if (!result.value) {
    return [];
  }
  const byTicker = new Map<string, number>();
  for (const option of result.value.options) {
    if (!option.selected) {
      continue;
    }
    byTicker.set(option.ticker, (byTicker.get(option.ticker) ?? 0) + option.netFillAmount);
  }
  return [...byTicker]
    .map(([ticker, amount]) => ({ ticker, amount: Math.ceil(amount) }))
    .filter(x => x.amount > 0)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// 联动 XIT CBUY 比价（临时清单，不写购物车）。
function openCbuy() {
  if (!result.value || !snapshot.value) {
    return;
  }
  const items = buildCartItems().map(x => ({ ticker: x.ticker, name: x.ticker, amount: x.amount }));
  if (items.length === 0) {
    info.value = '当前没有选中的补给物料。';
    return;
  }
  setGovhQuote({ planet: snapshot.value.planet, target: target.value, items });
  showBuffer('XIT CBUY GOVH');
}

// 复制 XIT JSON（购物车可直接识别的格式），便于分享 / 导入。
async function copyJson() {
  const items = buildCartItems();
  if (items.length === 0) {
    info.value = '当前没有选中的补给物料。';
    return;
  }
  const payload = {
    name: `GOVH ${snapshot.value?.planet ?? ''} ${Math.round(target.value * 100)}%`,
    materials: Object.fromEntries(items.map(x => [x.ticker, x.amount])),
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    info.value = `已复制 ${items.length} 种物料的 XIT JSON 到剪贴板。`;
  } catch {
    info.value = '复制失败：浏览器拒绝了剪贴板权限。';
  }
}

// 需求满足度条的颜色类（用现有 game ColoredValue 语义，不引入裸色值）。
function needClass(state: { fulfillment: number; current: number }): string {
  if (state.fulfillment >= 1) {
    return C.ColoredValue.positive;
  }
  if (state.fulfillment < target.value) {
    return C.ColoredValue.negative;
  }
  return '';
}

function targetPercent(): string {
  return `${Math.round(target.value * 100)}%`;
}

onMounted(() => {
  mounted.value = true;
  if (restoredFromCache.value) {
    // 首绘已由 setup 同步恢复的快照填充，无需再走 onMounted → refreshData 的路径：
    // 那条路会给 snapshot 赋新引用，导致整表二次重建。这里只补订本地订单簿价格。
    void subscribePrices(
      tickers.value,
      ticker => prices.value[ticker] !== undefined,
      () => disposed.value,
    );
    return;
  }
  if (planetInput.value.trim() !== '') {
    void refreshData();
  }
});
onUnmounted(() => {
  disposed.value = true;
});
</script>

<template>
  <div :class="$style.root" :data-govh-restored="restoredFromCache ? 'cache' : 'cold'">
    <div :class="$style.titleRow">
      <Header>政府基建补给助手</Header>
      <span :class="$style.hint">六类需求 × 五类人口 · 本地数据 · 零外部请求</span>
    </div>

    <div :class="$style.controls">
      <Active label="管理的政府">
        <select
          v-model="selectedGovernment"
          :class="$style.governmentSelect"
          data-govh-government-select>
          <option value="" disabled>{{ governmentPlaceholder }}</option>
          <option v-for="option in governmentOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
          <option :value="CUSTOM_PLANET">自定义编码…</option>
        </select>
      </Active>
      <Active v-if="customMode" label="自定义星球">
        <TextInput
          v-model="customPlanet"
          :class="$style.planetInput"
          placeholder="VH-192b"
          data-govh-custom-planet
          @change="applyCustomPlanet" />
      </Active>
      <Active label="目标满足度">
        <div :class="$style.targetGroup">
          <PrunButton
            :primary="target === 0.7"
            :dark="target !== 0.7"
            inline
            @click="setTarget(0.7)"
            >70%</PrunButton
          >
          <PrunButton :primary="target === 1" :dark="target !== 1" inline @click="setTarget(1)"
            >100%</PrunButton
          >
        </div>
      </Active>
      <PrunButton primary :disabled="loading || planetInput === ''" @click="refreshData(true)">
        {{ loading ? '读取中…' : '刷新数据' }}
      </PrunButton>
      <PrunButton dark :disabled="!snapshot" @click="refreshPrices">更新价格</PrunButton>
    </div>

    <div :class="$style.governmentHint">{{ governmentStatus }}</div>
    <div v-if="error" :class="$style.error">{{ error }}</div>
    <div v-else-if="info" :class="$style.info">{{ info }}</div>

    <template v-if="snapshot && result">
      <!-- ① 现状：本期 POPR 报告明细（无折线图） + 六类需求现状/预览，左右两栏 -->
      <div :class="$style.card">
        <SectionHeader>现状与目标预览 · {{ targetPercent() }}</SectionHeader>
        <div :class="$style.sectionMeta">
          本期人口报告明细（POPR 原生值，不含折线图） · 六类需求现状 → 补足后预览（含封顶）
        </div>
        <div :class="$style.summaryGrid">
          <div
            v-for="level in LEVELS"
            :key="level"
            :class="$style.statCell"
            data-govh-population-stat>
            <div :class="$style.statLabel">{{ LEVEL_LABELS[level] }}</div>
            <div :class="$style.statValue">{{ formatPercent(snapshot.happiness[level]) }}</div>
          </div>
        </div>
        <div :class="$style.reportGrid">
          <div :class="$style.reportColumn">
            <div :class="$style.subTitle">
              本期人口报告{{
                snapshot.reportLabel ? ' · ' + snapshot.reportLabel : ' · POPR 原生明细'
              }}
            </div>
            <div :class="$style.tableWrap">
              <table :class="[$style.table, $style.miniTable]">
                <thead>
                  <tr>
                    <th>项目</th>
                    <th v-for="level in LEVELS" :key="level" :class="$style.numCol">
                      {{ LEVEL_LABELS[level] }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in snapshot.reportRows" :key="row.label">
                    <td>{{ row.label }}</td>
                    <td v-for="level in LEVELS" :key="level" :class="$style.numCell">
                      {{ row.values[level] || '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              v-if="snapshot.project"
              :class="$style.projectLine"
              :title="snapshot.project.name + '：' + snapshot.project.description">
              项目：{{ snapshot.project.name }} · {{ snapshot.project.description }}
            </div>
          </div>
          <div :class="$style.reportColumn">
            <div :class="$style.subTitle">六类需求 · 现状 → 补足后预览</div>
            <div :class="$style.tableWrap">
              <table :class="[$style.table, $style.miniTable]">
                <thead>
                  <tr>
                    <th>需求</th>
                    <th title="需求量">需要</th>
                    <th title="现状满足度">现状</th>
                    <th title="补足后预览">预览</th>
                    <th title="提供量">提供</th>
                    <th title="是否封顶">封顶</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="need in NEEDS" :key="need">
                    <td>{{ NEED_LABELS[need] }}</td>
                    <td :class="$style.numCell">{{ fixed0(result.needs[need].needed) }}</td>
                    <td :class="$style.numCell">{{ snapshot.fulfillmentText[need] }}</td>
                    <td :class="[$style.numCell, needClass(result.needs[need])]">
                      <strong>{{ formatPercent(result.needs[need].fulfillment) }}</strong>
                    </td>
                    <td :class="$style.numCell">{{ fixed0(result.needs[need].provided) }}</td>
                    <td :class="$style.numCell">
                      <span v-if="result.needs[need].capped" :class="$style.cappedTag">已封顶</span>
                      <span v-else>—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div v-if="!result.summary.achievable && result.summary.limitingNeed" :class="$style.warn">
          目标 {{ targetPercent() }} 在分层封顶下不可达：短板需求「{{
            NEED_LABELS[result.summary.limitingNeed]
          }}」被下一层限制。 请先提升低层需求，否则高层物料属于无效超买。
        </div>
      </div>

      <!-- ② 已建造等级（来自 POPI） -->
      <div :class="$style.card">
        <SectionHeader>已建造基建等级 · {{ builtBuildings.length }} / 14 类</SectionHeader>
        <div :class="$style.buildingGrid">
          <div
            v-for="building in UPKEEP_BUILDINGS"
            :key="building.ticker"
            :class="$style.buildingCell">
            <span :class="$style.buildingName" :title="building.enName">{{ building.name }}</span>
            <span :class="$style.buildingLevel">{{ snapshot.levels[building.ticker] ?? 0 }}</span>
          </div>
        </div>
      </div>

      <!-- ③ 补给方案：全部物料自选 -->
      <div :class="$style.card">
        <SectionHeader>补给方案 · 全部物料自选</SectionHeader>
        <div :class="$style.sectionMeta">
          勾选物料即并入方案。待补量 = 30 天填充量 − 目标星球该建筑「下一次消耗 + 储备」内部存量；
          已填满存量的物料自动计入，不再采购。推荐勾选 =
          本地实时价格下的逐需求贪心近似（非严格全局最优），可手动调整。
          单价统一来自本地订单簿实时买一价（与 BPC/BMAT/CBUY
          同一口径），无报价显示「—」，可点「更新价格」订阅。
        </div>
        <div :class="$style.materialToolbar">
          <SearchInput
            v-model="search"
            name="govh-search"
            :class="$style.search"
            placeholder="搜索 ticker / 物料名 / 建筑" />
          <PrunButton dark inline @click="selectAll">全选</PrunButton>
          <PrunButton dark inline @click="selectNone">清空</PrunButton>
          <PrunButton dark inline @click="resetToRecommended">恢复推荐</PrunButton>
          <span :class="$style.selectedCount">
            已选 {{ result.selected.size }} / {{ result.options.length }} 项
          </span>
        </div>
        <div :class="$style.tableWrap">
          <table :class="$style.table">
            <thead>
              <tr>
                <th :class="$style.checkCol">选</th>
                <th>物料</th>
                <th>建筑</th>
                <th>覆盖需求</th>
                <th :class="$style.numCol">日耗</th>
                <th :class="$style.numCol">30天填充</th>
                <th :class="$style.numCol">待补量(30天)</th>
                <th>计算过程</th>
                <th :class="$style.numCol">单价</th>
                <th>来源</th>
                <th :class="$style.numCol">日成本</th>
                <th :class="$style.numCol">待补成本</th>
                <th :class="$style.numCol">性价比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredOptions.length === 0">
                <td colspan="13" :class="$style.empty">该星球没有已建基建，或没有匹配的物料。</td>
              </tr>
              <tr
                v-for="option in filteredOptions"
                :key="option.key"
                :class="[option.selected ? $style.rowSelected : '']">
                <td :class="$style.checkCol">
                  <input
                    type="checkbox"
                    :checked="isSelected(option.key)"
                    :class="$style.checkbox"
                    @change="toggleOption(option.key)" />
                </td>
                <td>
                  <div :class="$style.materialCell">
                    <MaterialIcon :ticker="option.ticker" size="medium" />
                    <span :title="materialName(option.ticker)">{{ option.ticker }}</span>
                  </div>
                </td>
                <td :class="$style.nameCell" :title="option.buildingName">
                  {{ option.buildingName }}
                  <span :class="$style.dim">Lv{{ option.builtLevel }}</span>
                </td>
                <td>
                  <div :class="$style.needsCell">
                    <span v-for="need in option.needs" :key="need" :class="$style.needTag">
                      {{ NEED_LABELS[need] }}
                    </span>
                  </div>
                </td>
                <td :class="$style.numCell">{{ fixed2(option.qtyPerDay) }}</td>
                <td :class="$style.numCell">{{ fixed0(option.grossFillAmount) }}</td>
                <td :class="$style.numCell">{{ fixed0(option.netFillAmount) }}</td>
                <td :class="$style.calcCell">{{ option.calculation }}</td>
                <td :class="$style.numCell">{{
                  option.price === undefined ? '—' : fixed2(option.price)
                }}</td>
                <td :class="$style.sourceCell">{{ priceExchanges[option.ticker] }}</td>
                <td :class="$style.numCell">{{
                  option.price === undefined ? '—' : fixed0(option.dailyCost)
                }}</td>
                <td :class="$style.numCell">{{
                  option.price === undefined ? '—' : fixed0(option.netFillCost)
                }}</td>
                <td :class="$style.numCell">
                  {{
                    option.efficiency < 0
                      ? '—'
                      : option.efficiency === Infinity
                        ? '免费'
                        : fixed2(option.efficiency * 1000)
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ④ 汇总 + 联动 -->
      <div :class="$style.card">
        <SectionHeader>汇总与采购联动</SectionHeader>
        <div :class="$style.summaryGrid">
          <div :class="$style.statCell">
            <div :class="$style.statLabel">日成本</div>
            <div :class="$style.statValue"
              >{{ result.summary.missingPrices > 0 ? '≈' : ''
              }}{{ fixed0(result.summary.dailyCost) }}</div
            >
          </div>
          <div :class="$style.statCell">
            <div :class="$style.statLabel">待补成本(30天)</div>
            <div :class="$style.statValue"
              >{{ result.summary.missingPrices > 0 ? '≈' : ''
              }}{{ fixed0(result.summary.fillCost) }}</div
            >
          </div>
          <div :class="$style.statCell">
            <div :class="$style.statLabel">总重量</div>
            <div :class="$style.statValue">{{ fixed0(result.summary.weight) }} t</div>
          </div>
          <div :class="$style.statCell">
            <div :class="$style.statLabel">总体积</div>
            <div :class="$style.statValue">{{ fixed0(result.summary.volume) }} m³</div>
          </div>
        </div>
        <div v-if="result.summary.missingPrices > 0" :class="$style.warn">
          有
          {{ result.summary.missingPrices }}
          种物料没有本地报价，成本被低估。可点「更新价格」订阅本地订单簿；单价不接受手填，避免脱离统一价格口径。
        </div>
        <div :class="$style.metaLine">
          主交易所：{{ GOVH_EXCHANGES.map(x => x.code).join(' / ') }} · 价格 1:1 不换算汇率
        </div>
        <ActionBar>
          <PrunButton primary @click="openCbuy">CBUY 比价</PrunButton>
          <PrunButton dark @click="copyJson">复制 JSON</PrunButton>
        </ActionBar>
      </div>
    </template>

    <div v-else-if="!error" :class="$style.emptyState">
      从表头下拉菜单选择我作为管理者的政府；需要查其它星球时可选「自定义编码…」。数据从游戏本地 POPR
      / POPI / POPID 读取，零外部请求。
    </div>
  </div>
</template>

<style module>
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 12px;
  box-sizing: border-box;
  min-width: 0;
}
.titleRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.hint {
  color: rgb(148, 158, 166);
  font-size: 11px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.governmentSelect {
  width: 240px;
  max-width: 100%;
  color: var(--rp-skin-ink, currentColor);
}
.planetInput {
  width: 160px;
}
.governmentHint {
  color: rgb(148, 158, 166);
  font-size: 11px;
  margin-top: -2px;
}
.targetGroup {
  display: inline-flex;
  gap: 2px;
}
.error {
  padding: 6px 8px;
  border: 1px solid rgb(var(--rp-skin-danger-rgb, 217, 83, 79));
  background: rgba(217, 83, 79, 0.12);
  color: rgb(229, 115, 115);
  font-size: 11px;
  border-radius: 2px;
}
.info {
  padding: 5px 8px;
  background: rgba(var(--rp-accent-rgb), 0.1);
  color: rgb(200, 208, 214);
  font-size: 11px;
  border-radius: 2px;
}
.card {
  border: 1px solid rgb(61, 74, 84);
  background: rgba(0, 0, 0, 0.12);
  padding: 6px 8px 8px;
  border-radius: 3px;
  min-width: 0;
}
.sectionMeta {
  color: rgb(148, 158, 166);
  font-size: 11px;
  margin: 2px 0 6px;
}
.summaryGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}
.statCell {
  border: 1px solid rgb(61, 74, 84);
  border-radius: 3px;
  padding: 4px 6px;
  background: rgba(var(--rp-accent-rgb), 0.05);
  min-width: 0;
}
.statLabel {
  color: rgb(167, 176, 183);
  font-size: 11px;
}
.statValue {
  /* 强调色只做卡片底纹（statCell 的 rgba 底），不当文字色：warm paper /
     ceramic 下 accent 偏浅，配同色浅底只有 3.77~3.95:1（R02）。正文走 ink。 */
  color: var(--rp-skin-ink, currentColor);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
/* 本期 POPR 明细与六类需求并排：面板宽度由游戏窗口决定，不能用 viewport 媒体查询。
   auto-fit + minmax 让窄面板自动落回单栏；每列表格各自横向滚动，不挤压列宽（R29）。 */
.reportGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr));
  gap: 10px;
  align-items: start;
  margin-bottom: 6px;
}
.reportColumn {
  min-width: 0;
}
.subTitle {
  color: var(--rp-skin-ink, currentColor);
  font-size: 11px;
  font-weight: 600;
  margin: 0 0 4px;
}
.projectLine {
  color: var(--rp-skin-ink, currentColor);
  font-size: 11px;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tableWrap {
  min-width: 0;
  overflow-x: auto;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.table th,
.table td {
  padding: 3px 6px;
  border-bottom: 1px solid rgb(48, 58, 66);
  white-space: nowrap;
  text-align: left;
}
.table th {
  color: rgb(200, 208, 214);
  font-weight: 600;
  border-bottom-color: rgb(61, 74, 84);
}
/* 双栏内的表格收紧内边距；.table.miniTable 特异性 (0,2,1) 高于 .table th/td 的 (0,1,1)。 */
.table.miniTable th,
.table.miniTable td {
  padding: 2px 4px;
}
.table tbody tr:hover {
  background: rgba(var(--rp-accent-rgb), 0.08);
}
.rowSelected {
  background: rgba(var(--rp-accent-rgb), 0.1);
}
/* 必须带 .table 前缀：`.table th, .table td` 是 (0,1,1)，
   裸 .numCell / .checkCol 只有 (0,1,0)，会被左对齐覆盖（R28）。 */
.table .numCol,
.table .numCell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.table .checkCol {
  text-align: center;
  width: 28px;
}
.calcCell {
  color: var(--rp-skin-ink, currentColor);
  font-variant-numeric: tabular-nums;
}
.checkbox {
  cursor: pointer;
  accent-color: rgb(var(--rp-accent-rgb));
}
.materialCell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nameCell {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dim {
  color: rgb(148, 158, 166);
  margin-left: 4px;
}
.needsCell {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}
.needTag {
  display: inline-block;
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(var(--rp-accent-rgb), 0.14);
  color: rgb(200, 208, 214);
  font-size: 11px;
}
.sourceCell {
  color: rgb(148, 158, 166);
}
.cappedTag {
  color: rgb(229, 115, 115);
}
.warn {
  padding: 5px 8px;
  border: 1px solid rgb(247, 166, 0);
  background: rgba(247, 166, 0, 0.1);
  color: rgb(230, 180, 60);
  font-size: 11px;
  border-radius: 2px;
  margin: 6px 0;
}
.materialToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.search {
  width: 180px;
}
.selectedCount {
  color: rgb(167, 176, 183);
  font-size: 11px;
  margin-left: auto;
}
.buildingGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 4px;
}
.buildingCell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 6px;
  border: 1px solid rgb(48, 58, 66);
  border-radius: 2px;
  font-size: 11px;
}
.buildingName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.buildingLevel {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--rp-skin-ink, currentColor);
}
.metaLine {
  color: rgb(148, 158, 166);
  font-size: 11px;
  margin: 6px 0;
}
.table .empty {
  text-align: center;
  padding: 16px 8px;
  color: rgb(167, 176, 183);
}
.emptyState {
  padding: 24px 12px;
  text-align: center;
  color: rgb(167, 176, 183);
  font-size: 12px;
}
.emptyState code {
  color: var(--rp-skin-ink, currentColor);
  font-weight: 600;
}
</style>
