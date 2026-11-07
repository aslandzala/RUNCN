<script setup lang="ts">
import Active from '@src/components/forms/Active.vue';
import NumberInput from '@src/components/forms/NumberInput.vue';
import RadioItem from '@src/components/forms/RadioItem.vue';
import SelectInput from '@src/components/forms/SelectInput.vue';
import SectionHeader from '@src/components/SectionHeader.vue';
import { userData } from '@src/store/user-data';

// 迁移已为存量用户回填，这里再兜一次底，避免设置页拿到 undefined。
userData.settings.repairBoard ??= {
  useOptimal: true,
  targetDays: 90,
  dueSoonDays: 7,
  arrivalDays: 0,
  subtractStore: true,
};

const board = userData.settings.repairBoard;

const arrivalModel = computed({
  get: () => String(board.arrivalDays),
  set: (value: string) => {
    board.arrivalDays = Number(value);
  },
});

const arrivalOptions = [
  { label: '今天', value: '0' },
  { label: '24 小时后', value: '1' },
  { label: '48 小时后', value: '2' },
];
</script>

<template>
  <SectionHeader>维修到期（XIT REPD）</SectionHeader>
  <Active
    label="目标维修日"
    tooltip="开启后，每个基地的目标维修日由插件按整站收益与维修成本算出（与 FLEET 维修列同一套算法）；
      关闭则统一使用下面的固定天数。游戏里没有 plan 概念，这是 PRUNplanner 最优间隔的替代口径。">
    <RadioItem v-model="board.useOptimal">按插件算出的最优间隔</RadioItem>
  </Active>
  <Active
    label="固定天数"
    tooltip="关闭最优间隔时使用。填多少天，就把「上次维修后第几天该修」当作目标，到期即变红。">
    <NumberInput v-model="board.targetDays" />
  </Active>
  <Active
    label="即将到期阈值"
    tooltip="距离目标日还剩这么多天及以内时，状态标为「即将到期」（黄）。">
    <NumberInput v-model="board.dueSoonDays" />
  </Active>
  <Active
    label="飞船抵达"
    tooltip="账单按飞船哪天抵达计算。今天 / 24 小时后 / 48 小时后三档直接取游戏给的维修材料，
      不再自己用公式折算。">
    <SelectInput v-model="arrivalModel" :options="arrivalOptions" />
  </Active>
  <Active
    label="库存抵扣"
    tooltip="开启后，购物清单只列基地现成库存之外还缺的数量；关闭则列出完整账单。">
    <RadioItem v-model="board.subtractStore">扣掉基地现成库存</RadioItem>
  </Active>
</template>
