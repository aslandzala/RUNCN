import { onApiMessage } from '@src/infrastructure/prun-api/data/api-messages';
import { balancesStore } from '@src/infrastructure/prun-api/data/balances';
import { companyContextId } from '@src/infrastructure/prun-api/data/user-data';

// 游戏下发的**现金流水明细**（ACCOUNTING_CASH_BOOKINGS）——原生 FIN 里
// 「近期现金转账」那张表就是它，一笔一条，字段齐全：
//   type         业务代码（MATERIAL_SALE / PRODUCTION_FEE / LOAN_PAYOUT_PAID …）
//   debit        true = 现金流入，false = 流出
//   amount       原币金额，bookAmount 按记账本位币（ICA）折算
//   time/period  记账时间与所属会计期间
//
// 两个已知边界（实测 2026-11-27）：
//   1. 一次只推最近一段（约 289 笔、跨度 30 小时上下），不是整个会计期间的历史；
//   2. FIN 的「加载更多」纯前端渲染，不发请求，翻不到更早的流水。
// 所以这里做**累积**：每次收到就并进 map（按 period+number+account+item 去重），
// 并持久化到 localStorage。玩家多开几次 FIN，覆盖范围就会往后延伸；同一期间
// 内不会被重复计数。

// 只留现金流量表用得到的字段，持久化时体积更小。
// amount 是原币金额（可能是 AIC/CIS/NCC），bookAmount 是按发生当时汇率折成
// 记账本位币（通常是 ICA）的金额；本页统一用 bookAmount 汇总，原币留着备用。
export interface CashBooking {
  period: number;
  number: number;
  item: number;
  account: number;
  type: string;
  debit: boolean;
  amount: PrunApi.CurrencyAmount;
  bookAmount: PrunApi.CurrencyAmount;
  time: { timestamp: number };
}

interface RawBooking extends CashBooking {
  bookBalance?: PrunApi.CurrencyAmount;
  balance?: PrunApi.CurrencyAmount;
  cash?: boolean;
}

const STORAGE_PREFIX = 'rprun-cash-bookings-';
// 上限只是防止 localStorage 无限膨胀（每条 ~180 字节，5000 条约 0.9 MB）。
const MAX_ENTRIES = 5000;

const entries = ref<CashBooking[]>([]);
const fetchedAt = ref<number | undefined>(undefined);
const loadedForCompany = ref<string | undefined>(undefined);

function normalize(item: RawBooking): CashBooking {
  return {
    period: item.period,
    number: item.number,
    item: item.item,
    account: item.account,
    type: item.type,
    debit: item.debit,
    amount: item.amount,
    bookAmount: item.bookAmount,
    time: item.time,
  };
}

function keyOf(item: CashBooking) {
  return `${item.period}:${item.number}:${item.account}:${item.item}`;
}

function read(companyId: string): CashBooking[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + companyId);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as { items?: RawBooking[] };
    // 旧版本存的是完整对象：读回时统一裁成精简结构，下次写入就不会再带冗余字段。
    return Array.isArray(parsed?.items) ? parsed.items.map(normalize) : [];
  } catch {
    return [];
  }
}

function write(companyId: string, items: CashBooking[]) {
  try {
    localStorage.setItem(STORAGE_PREFIX + companyId, JSON.stringify({ items }));
  } catch {
    // 隐私模式 / 配额满：只影响跨会话累积，当前会话仍按内存里的数据显示。
  }
}

function merge(incoming: CashBooking[]) {
  const map = new Map<string, CashBooking>();
  for (const item of entries.value) {
    map.set(keyOf(item), item);
  }
  let added = 0;
  for (const item of incoming) {
    const key = keyOf(item);
    if (map.has(key)) {
      continue;
    }
    map.set(key, item);
    added++;
  }
  if (added === 0) {
    return;
  }
  const merged = [...map.values()].sort((a, b) => a.time.timestamp - b.time.timestamp);
  entries.value = merged.length > MAX_ENTRIES ? merged.slice(-MAX_ENTRIES) : merged;
  const companyId = companyContextId.value;
  if (companyId !== undefined) {
    write(companyId, entries.value);
  }
}

// 切账号 / 首次拿到公司身份时，把该公司的历史流水读回来。快照按公司分键，
// 避免同一浏览器切号后把上一个账号的流水算进本账号的现金流量表。
watch(
  companyContextId,
  id => {
    if (id === undefined || id === loadedForCompany.value) {
      return;
    }
    loadedForCompany.value = id;
    entries.value = read(id);
  },
  { immediate: true },
);

onApiMessage({
  ACCOUNTING_CASH_BOOKINGS(data: { items?: RawBooking[] }) {
    if (!Array.isArray(data?.items)) {
      return;
    }
    fetchedAt.value = Date.now();
    merge(data.items.map(normalize));
  },
});

export const cashBookingsStore = {
  all: computed(() => entries.value),
  fetchedAt,
  /** 已收到的流水覆盖到的最早时间 */
  earliest: computed(() => entries.value[0]?.time.timestamp),
  latest: computed(() => entries.value[entries.value.length - 1]?.time.timestamp),
  /**
   * 记账本位币代码（bookAmount 的币种），页面用它说明「单位是什么」。
   * 优先取流水自身的币种；还没有流水时退回服务器下发的 ownCurrency ——
   * 它是公司建国时选的国家（派系）对应的货币，不是插件猜的。
   */
  bookCurrency: computed(
    () =>
      entries.value[entries.value.length - 1]?.bookAmount.currency ||
      balancesStore.ownCurrency.value ||
      'ICA',
  ),
};
