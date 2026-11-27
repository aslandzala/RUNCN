<script setup lang="ts">
import { accountingPeriods } from '@src/infrastructure/prun-api/data/accounting-periods';
import { labelOf } from '@src/core/accounting/account-labels';
import { formatCurrency } from '@src/utils/format';

// 利润表：收入/支出类科目的当期余额就是当期发生额（每期结转到利润），
// 所以直接读会计期间余额即可，无需对流水做差。
const COLUMNS = 3;

// recent 返回升序，反转后按「本期 → 上期 → 上上期」排列。
const ordered = computed(() => [...accountingPeriods.recent(COLUMNS)].reverse());

interface Row {
  type: number;
  name: string;
  hint?: string;
  values: (number | undefined)[];
  total: number;
}

function buildRows(section: 'revenue' | 'expense'): Row[] {
  const list = ordered.value;
  const map = new Map<number, (number | undefined)[]>();
  for (let i = 0; i < list.length; i++) {
    for (const account of list[i].accounts) {
      if (account.category !== (section === 'revenue' ? 'REVENUE' : 'EXPENSES')) {
        continue;
      }
      const amount = account.bookBalance.amount;
      const values = map.get(account.type) ?? Array.from({ length: COLUMNS }, () => undefined);
      values[i] = (values[i] ?? 0) + amount;
      map.set(account.type, values);
    }
  }
  const rows: Row[] = [];
  for (const [type, values] of map) {
    const label = labelOf(type);
    const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    // 全零科目（例如当期未发生的收入类型）不占行，避免一屏都是 0
    if (values.every(v => (v ?? 0) === 0)) {
      continue;
    }
    rows.push({ type, name: label.name, hint: label.hint, values, total });
  }
  rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return rows;
}

const revenueRows = computed(() => buildRows('revenue'));
const expenseRows = computed(() => buildRows('expense'));

const revenueTotals = computed(() =>
  Array.from({ length: COLUMNS }, (_, i) =>
    revenueRows.value.reduce((s, r) => s + (r.values[i] ?? 0), 0),
  ),
);
const expenseTotals = computed(() =>
  Array.from({ length: COLUMNS }, (_, i) =>
    expenseRows.value.reduce((s, r) => s + (r.values[i] ?? 0), 0),
  ),
);
const netTotals = computed(() =>
  Array.from(
    { length: COLUMNS },
    (_, i) => (revenueTotals.value[i] ?? 0) - (expenseTotals.value[i] ?? 0),
  ),
);

const hasData = computed(() => ordered.value.length > 0);
const headers = computed(() => {
  const labels = ['本期', '上期', '上上期'];
  const list = ordered.value;
  return labels.map((label, i) => {
    const period = list[i];
    return period === undefined ? label : `${label}（P${period.period}）`;
  });
});

function cell(value: number | undefined) {
  return value === undefined ? '—' : formatCurrency(value);
}
</script>

<template>
  <div :class="$style.root">
    <div :class="$style.title">利润表（插件口径）</div>
    <div v-if="!hasData" :class="$style.empty">
      还没有收到会计期间数据。打开一次 <b>FIN</b> 或 <b>FINIS</b> 后回来即可看到。
    </div>
    <table v-else :class="$style.table">
      <thead>
        <tr>
          <th>科目</th>
          <th v-for="h in headers" :key="h" :class="$style.num">{{ h }}</th>
          <th :class="$style.num">合计</th>
        </tr>
      </thead>
      <tbody>
        <tr :class="$style.section">
          <td colspan="5">收入</td>
        </tr>
        <tr v-for="row in revenueRows" :key="row.type">
          <td :title="row.hint">{{ row.name }}</td>
          <td v-for="(v, i) in row.values" :key="i" :class="$style.num">{{ cell(v) }}</td>
          <td :class="$style.num">{{ cell(row.total) }}</td>
        </tr>
        <tr :class="$style.subtotal">
          <td>收入合计</td>
          <td v-for="(v, i) in revenueTotals" :key="i" :class="$style.num">{{ cell(v) }}</td>
          <td :class="$style.num">{{ cell(revenueTotals.reduce((a, b) => a + b, 0)) }}</td>
        </tr>

        <tr :class="$style.section">
          <td colspan="5">支出</td>
        </tr>
        <tr v-for="row in expenseRows" :key="row.type">
          <td :title="row.hint">{{ row.name }}</td>
          <td v-for="(v, i) in row.values" :key="i" :class="$style.num">{{ cell(v) }}</td>
          <td :class="$style.num">{{ cell(row.total) }}</td>
        </tr>
        <tr :class="$style.subtotal">
          <td>支出合计</td>
          <td v-for="(v, i) in expenseTotals" :key="i" :class="$style.num">{{ cell(v) }}</td>
          <td :class="$style.num">{{ cell(expenseTotals.reduce((a, b) => a + b, 0)) }}</td>
        </tr>

        <tr :class="$style.net">
          <td>净利润</td>
          <td v-for="(v, i) in netTotals" :key="i" :class="$style.num">{{ cell(v) }}</td>
          <td :class="$style.num">{{ cell(netTotals.reduce((a, b) => a + b, 0)) }}</td>
        </tr>
      </tbody>
    </table>
    <div :class="$style.note">
      数据来自游戏下发的会计期间余额（最近
      {{ accountingPeriods.recent(COLUMNS).length }} 期）。收入/支出类科目的
      期末余额即当期发生额；未列出的科目显示为「科目 #编号」。
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

.note {
  opacity: 0.65;
  font-size: 0.9em;
}
</style>
