<script setup lang="ts">
import HeadItem from './HeadItem.vue';
import { context, screensStore } from '@src/infrastructure/prun-api/data/screens';
import { userData } from '@src/store/user-data';
import { vDraggable } from 'vue-draggable-plus';
import { syncState } from '@src/features/basic/screen-tab-bar/sync';
import { useTemplateRef } from 'vue';

watchEffect(syncState);

const current = computed(() => screensStore.current.value);

function getScreen(id: string) {
  return screensStore.getById(id);
}

// 政府管理视图是在「context=管理机构 id」下看同一批界面。标签页如果用纯
// `#screen=<id>` 跳转，会把 context 丢掉、直接从政府视图弹回公司上下文，
// 所以当前带 context 时要把 context 一起带上。
function screenHref(id: string) {
  return context.value ? `#/context=${context.value}&screen=${id}` : `#screen=${id}`;
}

const container = useTemplateRef('container');

onMounted(() => {
  container.value?.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      container.value?.scrollBy({ left: e.deltaY, behavior: 'smooth' });
    },
    { passive: false },
  );
});
</script>

<template>
  <div :class="$style.spacer" />
  <div
    ref="container"
    v-draggable="[userData.tabs.order, { animation: 150 }]"
    :class="$style.container">
    <template v-for="id in userData.tabs.order" :key="id">
      <a v-show="!userData.tabs.hidden.includes(id)" :href="screenHref(id)" :class="$style.item">
        <HeadItem :label="getScreen(id)?.name ?? ''" :active="current === getScreen(id)" />
      </a>
    </template>
  </div>
  <div :class="$style.spacer" />
</template>

<style module>
.spacer {
  display: inline-block;
  width: 5px;
}

.container {
  display: flex;
  flex-direction: row;
  flex: 1 1 auto;
  min-width: 50px;
  contain: inline-size;
  overflow: hidden;

  > .item {
    flex-shrink: 0;
  }
}
</style>
