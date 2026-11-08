import { computed, watchEffect } from 'vue';
import { userData } from '@src/store/user-data';
import { hasMountedUi } from '@src/utils/mount-ui-once';
import $style from './inv-compact-layout.module.css';

// 紧凑排列是全局开关，写进 userData.settings 后由 user-data-serializer 自动保存，
// 刷新页面时 loadUserData 会恢复；只有再次点击按钮才会改变模式。
const compact = computed({
  get: () => userData.settings.invCompact ?? false,
  set: (value: boolean) => (userData.settings.invCompact = value),
});

function onTileReady(tile: PrunTile) {
  // 同一 frame 上只允许一个按钮：切换标签 / FB 搬移 DOM 会让 observer 重复触发。
  if (hasMountedUi(tile.frame, 'inv-compact-toggle')) {
    return;
  }
  // 按钮挂在 frame 内部（不是标题栏的 TileFrame.controls）：FB 面板会把内嵌磁贴的
  // 标题栏控件区整个 display:none，挂那里 FB 里就看不见。frame 自身是 position:relative，
  // 按钮用绝对定位落在标题栏下方那一行（WAR / UPCK 上下文命令行）的最右端。
  // 作用域交给 refined-prun.css 判断：FB 是异步把磁贴 appendChild 搬进面板的，
  // 注入这一刻磁贴可能还没被搬进去，所以这里对所有 INV / SHPI 都注入，由
  // [data-rp-fb-panel] 后代选择器决定显隐——只有 XIT FB 面板内会出现按钮，
  // 用户单独打开的 INV / SHPI 窗口按钮被 display:none 隐藏，也不占留白。
  createFragmentApp(() => (
    <button
      type="button"
      data-rp-ui="inv-compact-toggle"
      class={[C.Button.btn, C.Button.dark, $style.toggle, compact.value ? $style.active : '']}
      title={
        compact.value
          ? '当前：紧凑排列。点击恢复游戏原版排列与图标大小。'
          : '当前：原版排列。点击切换到紧凑排列。'
      }
      onClick={() => (compact.value = !compact.value)}>
      紧凑排列
    </button>
  )).appendTo(tile.frame);
}

function init() {
  // refined-prun.css 里的紧凑规则同时带 html[data-rp-inv-compact='on'] 与
  // [data-rp-fb-panel] 前缀：只有 XIT FB 面板内的 INV / SHPI 会变紧凑，
  // 独立打开的 INV / SHPI 窗口始终使用游戏原版排列与 48px 图标。
  watchEffect(() => {
    document.documentElement.dataset.rpInvCompact = compact.value ? 'on' : 'off';
  });
  tiles.observe(['INV', 'SHPI'], onTileReady);
}

features.add(
  import.meta.url,
  init,
  'XIT FB 面板内的 INV/SHPI：窗体内部右上角「紧凑排列」开关，切换 BRN 竖排分组与图标尺寸；独立 INV/SHPI 窗口保持游戏原版。设置持久化，刷新后保持。',
);
