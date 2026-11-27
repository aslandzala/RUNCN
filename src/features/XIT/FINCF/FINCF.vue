<script setup lang="ts">
import { accountingPeriods } from '@src/infrastructure/prun-api/data/accounting-periods';
import { cashBookingsStore } from '@src/infrastructure/prun-api/data/cash-bookings';
import { buildCashFlow, type CashFlowSection } from '@src/core/accounting/cash-flow';
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
// 未纳入明细的部分 = 整期净变动 − 明细三类合计。它既包含窗口之外的流水，
// 也包含本币折算带来的差额，所以不拆分归因，只在页脚说明。
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
    <div :class="$style.title">
      现金流量表（插件口径）
      <span v-if="coverage" :class="$style.sub">明细 {{ totalBookings }} 笔 · {{ coverage }}</span>
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
              <td :title="line.hint">{{ line.name }}</td>
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
      </tbody>
    </table>
    <div v-if="!hasDetail" :class="$style.note">
      还没收到现金流水明细。打开原生 <b>FIN</b>（近期现金转账）会触发一次下发。
    </div>
    <div v-else :class="$style.note">
      明细来自游戏下发的现金流水，一次只给最近一段（实测约 289 笔、1~2 天）；本页会累积保存，
      多打开几次 <b>FIN</b> 可把覆盖范围往后延伸。因此「未纳入明细的部分」＝ 整期净变动 −
      明细三类合计，里面既有窗口之外的流水，也有本币折算差额，不强行归因。没有明细的期间只给
      余额口径的净变动。
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
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  font-weight: 600;
}

.sub {
  font-weight: 400;
  opacity: 0.65;
  font-size: 0.9em;
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

.num {
  text-align: right;
}

.section td {
  padding-top: 4px;
  font-weight: 600;
  border-bottom: 1px solid rgba(128, 128, 128, 0.35);
}

.subtotal td {
  font-weight: 600;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
}

.net td {
  font-weight: 700;
  border-top: 1px solid rgba(128, 128, 128, 0.55);
  border-bottom: 1px solid rgba(128, 128, 128, 0.55);
}

.muted td {
  opacity: 0.6;
}

.note {
  opacity: 0.65;
  font-size: 0.9em;
  line-height: 1.35;
}
</style>
