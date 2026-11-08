import { computed } from 'vue';
import { userData } from '@src/store/user-data';
import { hasMountedUi } from '@src/utils/mount-ui-once';
import { watchEffectWhileNodeAlive } from '@src/utils/watch';
import fa from '@src/utils/font-awesome.module.css';
import $style from './blu-hidden-blueprints.module.css';

// BLU 的显隐是「固定的」：写入 userData.settings 后由 user-data-serializer 自动
// 落盘到 chrome.storage.local，刷新页面 loadUserData 原样恢复。只有手动点击眼睛
// 按钮 / 显示开关才会改变，服务器数据更新、窗口重开、排序变化都不会重置。
const hidden = computed(() => userData.settings.hiddenBlueprints ?? []);
const hiddenSet = computed(() => new Set(hidden.value));
const showHidden = computed({
  get: () => userData.settings.showHiddenBlueprints ?? false,
  set: (value: boolean) => (userData.settings.showHiddenBlueprints = value),
});

function toggleHidden(id: string) {
  const list = hidden.value;
  const index = list.indexOf(id);
  if (index >= 0) {
    list.splice(index, 1);
  } else {
    list.push(id);
  }
}

// 游戏是 React 渲染：BLU 表格行既没有 data-prun-id，行文本里也没有蓝图编码，
// 而且名称允许重复（实测有 6 行都叫「作废」），不能拿名称当键。
// 每行 tr 的 React fiber.key 就是蓝图 id（32 位 hex，实测 22 行全唯一）；
// 名称列 Link 的 fiber 祖先链上还带该行专属的 naturalId（BP-XXXX-NNNN），
// 正是 XIT BPC 蓝图下拉框用的 value。优先存 naturalId，取不到退回 id；
// BPC 侧同时按 naturalId / id 匹配，两种结果都能同步。
const NATURAL_ID_RE = /^BP-[A-Z0-9]+-[A-Z0-9]+$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fiberOf(element: Element | null): any {
  if (!element) {
    return null;
  }
  const key = Object.keys(element).find(x => x.startsWith('__reactFiber$'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (element as any)[key] : null;
}

function blueprintIdOf(row: HTMLTableRowElement): string | null {
  let fiber = fiberOf(row.querySelector('[class*="Link__link"]'));
  for (let i = 0; i < 10 && fiber; i++, fiber = fiber.return) {
    const naturalId = fiber.memoizedProps?.naturalId;
    if (typeof naturalId === 'string' && NATURAL_ID_RE.test(naturalId)) {
      return naturalId;
    }
  }
  const key = fiberOf(row)?.key;
  return typeof key === 'string' && key.length > 8 ? key : null;
}

function onTileReady(tile: PrunTile) {
  // 两个眼睛按钮只写 data-tooltip，绝不写 title：浏览器原生 title 会额外弹一个
  // 深色文本框，和游戏 [data-tooltip] 伪元素的浅色浮窗同时出现、文案还不一样。
  // 无障碍名称改用 aria-label，它不会触发任何浮窗。
  // 「新建」按钮左边：直接把开关塞进按钮所在的 ActionBar__element，
  // 无论外层 flex 怎么对齐，两个按钮都紧邻、开关恒在左侧。
  // 游戏是 React 异步渲染，onTileReady 触发时 ActionBar 可能还没出现，
  // 所以订阅新出现的 button 而不是当场查询一次，刷新后首次加载也不会漏。
  subscribe($$(tile.frame, 'button'), button => {
    if (button.textContent?.trim() !== '新建') {
      return;
    }
    const host = button.parentElement;
    if (!host || hasMountedUi(host, 'blu-show-hidden-toggle')) {
      return;
    }
    createFragmentApp(() => (
      <button
        type="button"
        data-rp-ui="blu-show-hidden-toggle"
        data-rp-blu-show={showHidden.value ? 'on' : 'off'}
        class={[C.Button.btn, $style.eyeButton, $style.toggle, fa.solid]}
        data-tooltip-position="bottom"
        data-tooltip={
          showHidden.value
            ? `当前显示含 ${hidden.value.length} 个隐藏蓝图的完整清单；点击恢复只显示未隐藏蓝图`
            : `当前已隐藏 ${hidden.value.length} 个蓝图；点击显示完整清单以便恢复`
        }
        aria-label="显示或隐藏已隐藏的蓝图"
        onClick={() => (showHidden.value = !showHidden.value)}>
        {showHidden.value ? '\uf06e' : '\uf070'}
      </button>
    )).prependTo(host);
  });

  // 表体「指令」列：每个蓝图行最前面加一颗眼睛。表头行（只有 th）跳过。
  subscribe($$(tile.anchor, 'tr'), row => {
    if (!row.querySelector('td') || hasMountedUi(row, 'blu-hide-button')) {
      return;
    }
    const cell = row.children[row.children.length - 1] as HTMLElement | undefined;
    if (!cell) {
      return;
    }
    const id = blueprintIdOf(row as HTMLTableRowElement);
    if (!id) {
      return;
    }

    createFragmentApp(() => {
      const isHidden = hiddenSet.value.has(id);
      return (
        <button
          type="button"
          data-rp-ui="blu-hide-button"
          data-rp-blu-hidden={isHidden ? 'on' : 'off'}
          class={[
            $style.eyeButton,
            fa.solid,
            isHidden ? $style.isHidden : '',
          ]}
          data-tooltip-position="bottom"
          data-tooltip={isHidden ? '取消隐藏此蓝图' : '从清单隐藏此蓝图'}
          aria-label={isHidden ? '取消隐藏此蓝图' : '从清单隐藏此蓝图'}
          onClick={() => toggleHidden(id)}>
          {isHidden ? '\uf070' : '\uf06e'}
        </button>
      );
    }).prependTo(cell);

    // 显隐完全由持久化状态驱动：开关关闭时隐藏行不渲染，打开时淡显并保留
    // 眼睛按钮，方便一键恢复。React 不给 tr 写 inline display，这里直接改
    // style 不会被重渲染覆盖；节点被移除时 watch 自动停止。
    watchEffectWhileNodeAlive(row, () => {
      const isHidden = hiddenSet.value.has(id);
      const visible = showHidden.value || !isHidden;
      const style = (row as HTMLElement).style;
      style.display = visible ? '' : 'none';
      style.opacity = isHidden && visible ? '0.55' : '';
    });
  });
}

function init() {
  tiles.observe('BLU', onTileReady);
}

features.add(
  import.meta.url,
  init,
  'BLU：在「指令」列给每个蓝图加隐藏眼睛按钮，「新建」左侧加显示隐藏蓝图开关；显隐持久化，XIT BPC 蓝图下拉同步过滤。',
);
