<script setup lang="ts">
import SectionHeader from '@src/components/SectionHeader.vue';
import PrunButton from '@src/components/PrunButton.vue';
import Commands from '@src/components/forms/Commands.vue';
import { userData } from '@src/store/user-data';

// 主题在点击时立即生效（theme.ts 监听 userData），无需刷新页面。
const themes = [
  {
    id: 'default',
    label: '原样',
    desc: '游戏原生深色界面 + 橙金强调色，等于不启用主题。',
  },
  {
    id: 'light',
    label: '浅色明亮',
    desc: '浅底深字、低饱和：窗口、表格、按钮、物料图标、输入框统一重配色，彩色收敛为石板蓝；保留黄红异常标记，图片与涨跌含义不变。',
  },
  {
    id: 'paper',
    label: '暖米纸',
    desc: '参考暖色纸张界面：淡米白底、近白卡片、卡其细边框，赭金强调搭配小面积墨绿与暗红；低饱和暖调，黄红异常标记照旧保留。',
  },
  {
    id: 'ceramic-colorful',
    label: '陶瓷白多彩',
    desc: '暖陶瓷白底 + 近白卡片，8 个低饱和色相只用于分类标签、图表、图标、装饰线与状态提示；按钮/表单/表格按组件类型统一，正文、焦点态与禁用态经 WCAG 对比度校验。',
  },
] as const;

const current = computed(() => userData.settings.theme ?? 'default');

function pick(id: (typeof themes)[number]['id']) {
  userData.settings.theme = id;
}

function reset() {
  userData.settings.theme = 'default';
}
</script>

<template>
  <SectionHeader>界面主题</SectionHeader>
  <form>
    <div :class="$style.grid">
      <button
        v-for="t in themes"
        :key="t.id"
        type="button"
        :class="[$style.card, current === t.id ? $style.cardActive : '']"
        @click="pick(t.id)">
        <span :class="$style.cardHead">
          <strong>{{ t.label }}</strong>
          <span v-if="current === t.id" :class="$style.activeTag">当前</span>
        </span>
        <span :class="$style.cardDesc">{{ t.desc }}</span>
      </button>
    </div>
  </form>
  <form>
    <Commands>
      <PrunButton primary @click="reset">恢复默认</PrunButton>
    </Commands>
  </form>
</template>

<style module>
.grid {
  display: grid;
  /* min 留 10px 余量：窗口宽高由游戏 inline style 精确控制，不同主题下
     内容区可能只差 1~2px；用 210px 时陶瓷白主题曾因 426px < 428px
     从「两行两列」塌成「四行单列」。200px 保证四个主题都是 2×2。 */
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}

/* 主题卡片自身也走 token：自定义主题下由 theme.ts 的 --rp-skin-* 提供，
   default 原样主题回退到游戏原色，视觉不变。 */
.card {
  display: flex;
  flex-direction: column;
  row-gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--rp-skin-border-strong, rgb(61, 74, 84));
  border-radius: 4px;
  background: var(--rp-skin-panel, rgb(26, 33, 38));
  color: var(--rp-skin-ink, inherit);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.card:hover {
  border-color: rgb(var(--rp-accent-rgb));
}

.cardActive {
  border-color: rgb(var(--rp-accent-rgb));
  background: rgba(var(--rp-accent-rgb), 0.08);
}

.cardHead {
  display: flex;
  align-items: center;
  column-gap: 8px;
}

.activeTag {
  margin-left: auto;
  color: rgb(var(--rp-accent-rgb));
  font-size: 11px;
}

.cardDesc {
  color: var(--rp-skin-muted, #999);
  font-size: 11px;
  line-height: 1.5;
}
</style>
