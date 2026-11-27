<script setup lang="ts">
import { accountingPeriods } from '@src/infrastructure/prun-api/data/accounting-periods';
import { cashBookingsStore } from '@src/infrastructure/prun-api/data/cash-bookings';
import { buildCashFlow, type CashFlowSection } from '@src/core/accounting/cash-flow';
import Tooltip from '@src/components/Tooltip.vue';
import { formatCurrency } from '@src/utils/format';

// 现金流量表（直接法）：数据来自游戏下发的现金流水明细 ACCOUNTING_CASH_BOOKINGS。
// 已知边界：一次只推最近一段（约 289 笔、1~2 天），所以本页对「有明细的期间」给出
// 三类活动拆分，对「只有余额的期间」只给现金净变动（期末 − 期初）。
const COLUMNS = 3;
const SECTION_NAMES: Record<CashFlowSection, string> = {
  operating: '经营活动',
  investing: '投资活动',
  financing: '筹资活动',
};
const SECTION_ORDER: CashFlowSection[] = ['operating', 'investing', 'financing'];

// recent 返回升序，反转后按「本期 → 上期 → 上上期」排列。
const columns = computed(() => [...accountingPeriods.recent(COLUMNS)].reverse());
const periodNumbers = computed(() => columns.value.map(p => p.period));

const cashFlow = computed(() => buildCashFlow(cashBookingsStore.all.value, periodNumbers.value));

// 每期期末现金（本币）：流动资产科目 type 1800 的账面余额合计。
const closingCash = computed(() => {
  const map = new Map<number, number>();
  for (const period of accountingPeriods.all.value) {
    let sum = 0;
    for (const account of period.accounts) {
      if (account.type === 1800) {
        sum += account.bookBalance.amount;
      }
    }
    map.set(period.period, sum);
  }
  return map;
});

// 期初 = 上一期的期末；缺上一期时留空（显示「—」）。
const openingCash = computed(() =>
  columns.value.map(period => closingCash.value.get(period.period - 1)),
);
const closingCashColumns = computed(() =>
  columns.value.map(period => closingCash.value.get(period.period)),
);

// 有明细的期间才有三类活动；没有明细的期间用「期末 − 期初」给出净变动。
const detailTotals = computed(() =>
  columns.value.map((_, i) => {
    const totals = SECTION_ORDER.map(s => cashFlow.value.sectionTotals[s][i]);
    if (totals.every(t => t === undefined)) {
      return undefined;
    }
    return totals.reduce<number>((sum, t) => sum + (t ?? 0), 0);
  }),
);
// 整期现金净变动只有余额口径是完整的（期末 − 期初）；明细只是其中最近一段。
const balanceChanges = computed(() =>
  columns.value.map((_, i) => {
    const open = openingCash.value[i];
    const close = closingCashColumns.value[i];
    if (open === undefined || close === undefined) {
      return undefined;
    }
    return close - open;
  }),
);
// 未纳入明细的部分 = 整期净变动 − 明细三类合计。它来自两处：窗口之外没下发的流水、
// 以及外币折算差额。先把「本币」那部分单独抠出来——本币账户没有折算，缺口就是纯流水，
// 剩下的是外币（窗口外流水 + 折算，二者无法只用余额分开）。
const uncovered = computed(() =>
  columns.value.map((_, i) => {
    const balance = balanceChanges.value[i];
    const detail = detailTotals.value[i];
    if (balance === undefined || detail === undefined) {
      return undefined;
    }
    return balance - detail;
  }),
);

const cashByCurrency = (period: number) => {
  const map = new Map<string, { original: number; book: number }>();
  const entry = accountingPeriods.all.value.find(x => x.period === period);
  for (const account of entry?.accounts ?? []) {
    if (account.type !== 1800) {
      continue;
    }
    const code = account.currencyBalance.currency;
    const acc = map.get(code) ?? { original: 0, book: 0 };
    acc.original += account.currencyBalance.amount;
    acc.book += account.bookBalance.amount;
    map.set(code, acc);
  }
  return map;
};

// 明细按「原币」分组的本币净额，用来与本币账户的余额变动对齐。
const detailBookByCurrency = computed(() => {
  const period = columns.value[0]?.period;
  const map = new Map<string, number>();
  if (period === undefined) {
    return map;
  }
  for (const booking of cashBookingsStore.all.value) {
    if (booking.period !== period) {
      continue;
    }
    const code = (booking.amount ?? booking.bookAmount).currency;
    const signed = booking.debit ? booking.bookAmount.amount : -booking.bookAmount.amount;
    map.set(code, (map.get(code) ?? 0) + signed);
  }
  return map;
});

const uncoveredSplit = computed(() => {
  const index = 0;
  const period = columns.value[index]?.period;
  const total = uncovered.value[index];
  if (period === undefined || total === undefined) {
    return { local: undefined, foreign: undefined };
  }
  const open = cashByCurrency(period - 1);
  const close = cashByCurrency(period);
  const own = cashBookingsStore.bookCurrency.value;
  const codes = new Set([...open.keys(), ...close.keys()]);
  let local = 0;
  let foreign = 0;
  for (const code of codes) {
    const delta = (close.get(code)?.book ?? 0) - (open.get(code)?.book ?? 0);
    const gap = delta - (detailBookByCurrency.value.get(code) ?? 0);
    if (code === own) {
      local += gap;
    } else {
      foreign += gap;
    }
  }
  // 期初/期末币种集合对不上时（换汇导致账户变动）差额并入外币侧，保证两行加起来等于总额。
  const residual = total - local - foreign;
  return { local, foreign: foreign + residual };
});

const rowsBySection = computed(() => {
  const map: Record<CashFlowSection, typeof cashFlow.value.lines> = {
    operating: [],
    investing: [],
    financing: [],
  };
  for (const line of cashFlow.value.lines) {
    map[line.section].push(line);
  }
  return map;
});

const ownCurrency = computed(() => cashBookingsStore.bookCurrency.value);

// 「交易所买入付款」这笔钱有没有还挂着？看资产端「挂单冻结资金」(1350) 的余额：
// 下单即出账、成交转库存、撤单退回，只有尚未成交的部分才留在该科目上。
const frozenDeposit = computed(() => {
  const latest = accountingPeriods.all.value.at(-1);
  let sum = 0;
  for (const account of latest?.accounts ?? []) {
    if (account.type === 1350) {
      sum += account.bookBalance.amount;
    }
  }
  return sum;
});

// 交易所那行带上实时余额，避免被读成「押金还挂着」。
function lineHint(line: { key: string; hint?: string }) {
  if (!line.key.startsWith('operating:交易所买入付款')) {
    return line.hint;
  }
  return `${line.hint}。当前仍挂单未成交：${formatCurrency(frozenDeposit.value)}`;
}
const hasData = computed(() => columns.value.length > 0);
const hasDetail = computed(() => cashFlow.value.lines.length > 0);
const totalBookings = computed(() => cashBookingsStore.all.value.length);
const coverage = computed(() => {
  const from = cashBookingsStore.earliest.value;
  const to = cashBookingsStore.latest.value;
  if (from === undefined || to === undefined) {
    return undefined;
  }
  const fmt = (ms: number) => new Date(ms).toLocaleString('sv-SE').slice(5, 16);
  return `${fmt(from)} → ${fmt(to)}`;
});

const headers = computed(() => {
  const labels = ['本期', '上期', '上上期'];
  return labels.map((label, i) => {
    const period = columns.value[i];
    return period === undefined ? label : `${label}（P${period.period}）`;
  });
});

function cell(value: number | undefined) {
  return value === undefined ? '—' : formatCurrency(value);
}
</script>

<template>
  <div :class="$style.root">
    <div :class="$style.title">现金流量表（插件口径）</div>
    <div :class="$style.sub">
      单位 {{ cashBookingsStore.bookCurrency.value }}（各笔按发生时汇率折算）
      <template v-if="coverage"> · 明细 {{ totalBookings }} 笔 · {{ coverage }}</template>
    </div>
    <div v-if="!hasData" :class="$style.empty">
      还没有收到会计数据。打开一次 <b>FIN</b> 或 <b>FINLA</b> 后回来即可看到。
    </div>
    <table v-else :class="$style.table">
      <thead>
        <tr>
          <th>项目</th>
          <th v-for="h in headers" :key="h" :class="$style.num">{{ h }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="section in SECTION_ORDER" :key="section">
          <template v-if="rowsBySection[section].length > 0">
            <tr :class="$style.section">
              <td colspan="4">{{ SECTION_NAMES[section] }}</td>
            </tr>
            <tr v-for="line in rowsBySection[section]" :key="line.key">
              <td :title="lineHint(line)" :class="$style.lineRow">{{ line.name }}</td>
              <td v-for="(v, i) in line.values" :key="i" :class="$style.num">{{ cell(v) }}</td>
            </tr>
            <tr :class="$style.subtotal">
              <td>{{ SECTION_NAMES[section] }}净额</td>
              <td v-for="(v, i) in cashFlow.sectionTotals[section]" :key="i" :class="$style.num">
                {{ cell(v) }}
              </td>
            </tr>
          </template>
        </template>

        <tr :class="$style.gap"><td colspan="4"></td></tr>
        <tr :class="$style.net">
          <td>现金净变动（期末 − 期初）</td>
          <td v-for="(v, i) in balanceChanges" :key="i" :class="$style.num">{{ cell(v) }}</td>
        </tr>
        <tr>
          <td>期初现金</td>
          <td v-for="(v, i) in openingCash" :key="i" :class="$style.num">{{ cell(v) }}</td>
        </tr>
        <tr>
          <td>期末现金</td>
          <td v-for="(v, i) in closingCashColumns" :key="i" :class="$style.num">{{ cell(v) }}</td>
        </tr>
        <tr :class="$style.muted">
          <td>未纳入明细的部分</td>
          <td v-for="(v, i) in uncovered" :key="i" :class="$style.num">{{ cell(v) }}</td>
        </tr>
        <tr :class="$style.muted">
          <td :class="$style.indent">其中：{{ ownCurrency }} 窗口外流水</td>
          <td :class="$style.num">{{ cell(uncoveredSplit.local) }}</td>
          <td :class="$style.num">—</td>
          <td :class="$style.num">—</td>
        </tr>
        <tr :class="$style.muted">
          <td :class="$style.indent">其中：外币（含折算差）</td>
          <td :class="$style.num">{{ cell(uncoveredSplit.foreign) }}</td>
          <td :class="$style.num">—</td>
          <td :class="$style.num">—</td>
        </tr>
      </tbody>
    </table>
    <div v-if="!hasDetail" :class="$style.note">
      还没收到现金流水明细。打开原生 <b>FIN</b>（近期现金转账）会触发一次下发。
    </div>
    <div v-else :class="$style.note">
      金额为记账本位币（{{ ownCurrency }}），按每笔发生时的汇率折算。
      <Tooltip
        :class="$style.help"
        tooltip="游戏每次只下发最近一段现金流水（实测约 289 笔、1~2 天），本页会累积保存，多开几次 FIN 覆盖范围会往后延伸。没覆盖到的部分就是「未纳入明细」：其中本币那一行是纯流水缺口（本币不涉及折算）；外币那行还混着汇率变动带来的账面差，无法只凭余额拆开。没有明细的期间只显示期末减期初。"
        position="top"
        :max-width="300" />
    </div>
  </div>
</template>

<style module>
.root {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: calc(1em + 1px);
}

.title {
  font-weight: 600;
}

/* 窄磁贴里标题和说明别挤在一行：说明单独占一行，允许折行。 */
.sub {
  margin-top: -2px;
  opacity: 0.65;
  font-size: 0.9em;
  line-height: 1.3;
}

.empty {
  opacity: 0.75;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 1px 6px;
  white-space: nowrap;
  text-align: left;
}

/* 金额列右对齐；带 .table 前缀才能压过 `.table td { text-align: left }`。 */
.table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 大组之间的半行留白：用空行（表格行不吃 margin），行高归零后靠 height 撑。 */
.gap td {
  height: 6px;
  padding: 0;
  border: none;
  font-size: 0;
  line-height: 0;
}

/* 明细科目与一级科目同一缩进基准：一级 6px、明细 22px、活动净额 14px。
   必须带 .table 前缀 —— `.table td { padding: 1px 6px }` 特异性更高，
   光写 .lineRow 会被压回 6px（和 .num 是同一个坑）。 */
.table .lineRow {
  padding-left: 22px;
}

/* 一级科目（经营 / 投资 / 筹资活动）：整行加底色、字号放大、上下都有边框，
   和明细明显分开。底色用中性灰，深浅主题都不会被主题引擎改花。 */
.section td {
  padding-top: 6px;
  padding-bottom: 2px;
  font-size: 1.12em;
  font-weight: 700;
  letter-spacing: 0.02em;
  /* 用背景图而不是 background-color：主题引擎会把带色背景改写成面板色，
     底色会整块消失；背景图不在它的重写范围内。 */
  background-image: linear-gradient(rgba(128, 128, 128, 0.25), rgba(128, 128, 128, 0.25));
  border-top: 1px solid rgba(128, 128, 128, 0.45);
  border-bottom: 1px solid rgba(128, 128, 128, 0.45);
}

.subtotal td {
  padding-left: 14px;
  font-weight: 600;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
}

/* 现金净变动是这张表的结论：比一级科目再重一档。 */
.net td {
  font-size: 1.12em;
  font-weight: 700;
  letter-spacing: 0.02em;
  background-image: linear-gradient(rgba(128, 128, 128, 0.38), rgba(128, 128, 128, 0.38));
  border-top: 2px solid rgba(128, 128, 128, 0.6);
  border-bottom: 2px solid rgba(128, 128, 128, 0.6);
}

.muted td {
  opacity: 0.6;
}

.indent {
  padding-left: 14px;
}

.help {
  margin-left: 4px;
  font-size: 0.95em;
  opacity: 0.8;
}

.note {
  opacity: 0.65;
  font-size: 0.9em;
  line-height: 1.35;
}
</style>
