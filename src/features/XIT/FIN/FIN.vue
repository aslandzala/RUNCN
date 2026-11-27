<script setup lang="ts">
import { calculateLocationAssets } from '@src/core/financials';
import KeyFigures from '@src/features/XIT/FIN/KeyFigures.vue';
import FinHeader from '@src/features/XIT/FIN/FinHeader.vue';
import {
  fixed0,
  fixed1,
  fixed2,
  formatCurrency,
  percent0,
  percent1,
  percent2,
} from '@src/utils/format';
import { liveBalanceSummary } from '@src/core/balance/balance-sheet-live';
import { userData } from '@src/store/user-data';

const locations = computed(() => calculateLocationAssets());

function formatRatio(ratio: number | undefined) {
  if (ratio === undefined) {
    return '--';
  }
  if (!isFinite(ratio)) {
    return 'N/A';
  }
  const absRatio = Math.abs(ratio);
  if (absRatio > 1000) {
    return ratio > 0 ? '> 1,000' : '< -1,000';
  }
  if (absRatio > 100) {
    return fixed0(ratio);
  }
  if (absRatio > 10) {
    return fixed1(ratio);
  }
  return fixed2(ratio);
}

function formatPercentage(ratio: number | undefined) {
  if (ratio === undefined) {
    return '--';
  }
  if (!isFinite(ratio)) {
    return 'N/A';
  }
  const absRatio = Math.abs(ratio);
  if (absRatio > 10) {
    return ratio > 0 ? '> 1,000%' : '< -1,000%';
  }
  if (absRatio > 1) {
    return percent0(ratio);
  }
  if (absRatio > 0.1) {
    return percent1(ratio);
  }
  return percent2(ratio);
}

const figures = computed(() => {
  return [
    {
      name: '速动资产',
      value: formatCurrency(liveBalanceSummary.quickAssets),
      tooltip:
        '速动资产包括：现金及现金等价物、流动应收账款和' +
        '流动应收贷款（详见 XIT FINBS）。这些资产' +
        '是流动性较高的资产，用于速动比率计算。',
    },
    {
      name: '流动资产',
      value: formatCurrency(liveBalanceSummary.currentAssets),
    },
    { name: '总资产', value: formatCurrency(liveBalanceSummary.assets) },
    { name: '权益', value: formatCurrency(liveBalanceSummary.equity) },
    {
      name: '速动负债',
      value: formatCurrency(liveBalanceSummary.quickLiabilities),
      tooltip:
        '速动负债包括：流动应付账款和流动应付贷款（详见 XIT FINBS' +
        '）。这些负债代表即时的财务义务，' +
        '用于速动比率计算。',
    },
    {
      name: '流动负债',
      value: formatCurrency(liveBalanceSummary.currentLiabilities),
    },
    {
      name: '总负债',
      value: formatCurrency(liveBalanceSummary.liabilities),
    },
    {
      name: '清算价值',
      hidden: !userData.fullEquityMode,
      value: formatCurrency(liveBalanceSummary.liquidationValue),
      tooltip:
        '公司所有可直接变现资产的市场价值。' +
        '清算价值不包括飞船、总部升级和 ARC 等资产，因为' +
        '它们无法在市场上出售。',
    },
    {
      // 「速动比率 / 酸性测试比率」是行话，这里按"能不能还短期债"命名，口径写在气泡里。
      name: '短期偿债比率',
      value: formatRatio(liveBalanceSummary.acidTestRatio),
      tooltip:
        '可快速变现的资产（速动资产）除以短期要还的负债（速动负债），' +
        '用来判断手头资产够不够还短期债务。1.0 或以上说明够，低于 1.0 说明可能吃紧。',
    },
    {
      // 「负债比率」容易被读成负债/权益，这里按资产负债率命名，分子分母写清楚。
      name: '资产负债率',
      value: formatPercentage(liveBalanceSummary.debtRatio),
      tooltip: '总负债 ÷ 总资产。大于 100% 表示负债超过资产，低于 100% 表示资产大于负债。',
    },
  ];
});
</script>

<template>
  <FinHeader>关键指标</FinHeader>
  <KeyFigures :figures="figures" />
  <FinHeader>库存明细</FinHeader>
  <table>
    <thead>
      <tr>
        <th>名称</th>
        <th>非流动资产</th>
        <th>流动资产</th>
        <th>总资产</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="location in locations" :key="location.name">
        <td>{{ location.name }}</td>
        <td>{{ fixed0(location.nonCurrent) }}</td>
        <td>{{ fixed0(location.current) }}</td>
        <td>{{ fixed0(location.total) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
table tr > :not(:first-child) {
  text-align: right;
}
</style>
