import { watch } from 'vue';
import $style from './mobile-tiles.module.css';
import { getScreenVariable } from '@src/core/screen-variables';
import { MOBILE_QUERY, isMobileLayout } from './mobile-query';

// 窄屏单磁贴全屏：分屏树由 CSS 摊平，这里只负责「当前显示哪一个」以及底部切换条。
// 判定与 mobile-layout 共用 mobile-query，避免两边走散。
const ACTIVE_ATTR = 'data-rp-mobile-active';
// 组合面板（一块磁贴里装多块磁贴，如 XIT FB 分屏）用这个属性声明自己这一段：
// 窄屏下里面的磁贴归它自己排，不再单独进切换条、也不按「一块铺满」处理。
const COMPOSITE_ATTR = 'data-rp-mobile-composite';

interface TileEntry {
  tile: HTMLElement;
  cmd: string;
  // 磁贴自带的标题。游戏与插件都按当前语言渲染，直接拿来当切换条文案，不硬编码命令译名。
  title: string;
  // 同一个磁贴元素上一次的命令。命令里的星球、船号等参数会随屏幕变量变化，
  // 此时游戏在原槽位重建磁贴但复用元素，只换命令文本。
  prevCmd: string | undefined;
}

// 磁贴元素到当前命令的映射，用来区分「新开的窗口」和「原位重建的磁贴」。
let tileCmds = new WeakMap<HTMLElement, string>();

let tabBar: HTMLElement | null = null;
let activeCmd: string | null = null;
let observer: MutationObserver | null = null;
let renderTimer: number | null = null;
let lastSignature = '';
// 上一次见到的命令集合：用来识别「用户刚打开的新窗口」并自动切过去。
let knownCmds: string[] = [];
// 最近访问过的命令，末尾是当前。关掉弹窗后据此回到来源面板，而不是跳到第一个。
let history: string[] = [];
// 从页面里点按钮打开子窗口时，把来源面板压栈；「返回」按钮据此逐层退回。
let returnStack: string[] = [];
// 命令到切换条文案的缓存：磁贴标题短暂为空时沿用旧文案，避免中文标签闪回命令。
const labelCache = new Map<string, string>();
// 宽屏或被禁用后置 false：挡住 teardown 之前排队、事后才执行的回调重新挂 tab。
let enabled = false;

function setActive(cmd: string) {
  activeCmd = cmd;
  history = history.filter(x => x !== cmd);
  history.push(cmd);
  if (history.length > 10) {
    history.shift();
  }
}

// 游戏用 hidden 类标记「不该显示的窗口」：showBuffer 的 autoClose 询价窗口先 add 再保持，
// 普通窗口只在创建过程中短暂带这个类。窄屏样式会强制接管显示，必须先把它们排除，
// 否则批量询价时每个隐藏窗口都会被当成新窗口轮流弹出。
function isMarkedHidden(win: HTMLElement): boolean {
  for (const className of win.classList) {
    if (className.includes('hidden')) {
      return true;
    }
  }
  return false;
}

function collectTiles(): TileEntry[] {
  const result: TileEntry[] = [];
  const tiles = document.querySelectorAll<HTMLElement>('[class*="Tile__tile"]');
  for (const tile of tiles) {
    const win = tile.closest<HTMLElement>('[class*="Window__window"]');
    if (win !== null && isMarkedHidden(win)) {
      continue;
    }
    const cmd = (tile.querySelector('[class*="TileFrame__cmd"]')?.textContent ?? '').trim();
    if (cmd.length === 0) {
      continue;
    }
    const title = (tile.querySelector('[class*="TileFrame__title"]')?.textContent ?? '').trim();
    result.push({ tile, cmd, title, prevCmd: tileCmds.get(tile) });
  }
  // 组合面板内部的磁贴不算独立面板：它们由面板自己排布，切换条只留面板本身。
  return result.filter(x => x.tile.closest(`[${COMPOSITE_ATTR}]`) === null);
}

// 命令到切换条短名的对照表。切换条只有一行高度，用 2-3 个字的固定短名比面板标题更好认，
// 也不用跟着游戏语言的标题长度变化。键是命令名（XIT 命令取其后的子命令），统一小写比对。
const COMMAND_LABELS: Record<string, string> = {
  fleet: 'Fleet',
  burn: '消耗',
  rep: '维修',
  inv: '库存',
  bs: '基地',
  flt: '舰队',
  prod: '生产',
  act: '操作包',
  fb: '分屏',
};

// 取出用于查表的命令名：`XIT FLT` 取 flt，`bs OF-443b` 取 bs。
function commandKey(cmd: string): string {
  const words = cmd.split(/\s+/);
  const first = (words[0] ?? '').toLowerCase();
  if ((first === 'xit' || first === 'xit_') && words.length > 1) {
    return (words[1] ?? '').toLowerCase();
  }
  return first;
}

// 参数部分（星球编码、船注册号等），用于区分同名面板。
function commandArgs(cmd: string): string {
  const words = cmd.split(/\s+/);
  const rest = (words[0] ?? '').toLowerCase() === 'xit' ? words.slice(2) : words.slice(1);
  return rest.join(' ');
}

// 切换条文案：已知命令查短名表，未知命令退回面板标题并压到 4 个字以内。
function buildLabels(tiles: TileEntry[]): Map<string, string> {
  const bases = new Map<string, string>();
  for (const { cmd, title } of tiles) {
    const mapped = COMMAND_LABELS[commandKey(cmd)];
    if (mapped !== undefined) {
      bases.set(cmd, mapped);
      continue;
    }
    // 游戏重渲染时标题会短暂为空，这时沿用上一次的文案，避免按钮闪回命令原文。
    const cached = labelCache.get(cmd);
    const resolved = title.length > 0 ? shortenTitle(title) : (cached ?? '');
    bases.set(cmd, resolved);
  }

  const counts = new Map<string, number>();
  for (const value of bases.values()) {
    if (value.length === 0) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const { cmd } of tiles) {
    const base = bases.get(cmd) ?? '';
    if (base.length === 0) {
      labels.set(cmd, cmd);
      continue;
    }
    const duplicated = (counts.get(base) ?? 0) > 1;
    const args = commandArgs(cmd);
    labels.set(cmd, duplicated && args.length > 0 ? `${base} ${args}` : base);
  }
  for (const [cmd, label] of labels) {
    labelCache.set(cmd, label);
  }
  return labels;
}

// 标题常带星球名（「消耗品报告 - Nova Kyushu」）或副标题，只留主标题并压到 2 个字，
// 与其他短名保持一致的紧凑宽度。
function shortenTitle(title: string): string {
  const main = title.split(/[：:]| - /)[0]?.trim() ?? '';
  const source = main.length > 0 ? main : title;
  return source.slice(0, 2);
}

function ensureTabBar(): HTMLElement {
  if (tabBar !== null && tabBar.isConnected) {
    return tabBar;
  }
  tabBar = document.createElement('nav');
  tabBar.className = $style.tabBar;
  document.body.append(tabBar);
  return tabBar;
}

// 顶部中间的当前基地徽标：内容取游戏的 BS 屏幕变量，也就是在基地列表里点某个基地后
// 选中的那个地址（FLEET 面板点星球列即写入此处）。窄屏下表格看不全，用它当位置提示。
let badge: HTMLElement | null = null;

// 原生变量栏的值最可靠：插件自维护的 store 只在写入时更新，游戏侧改动不一定回流。
function readBaseValue(): string {
  const input = document.querySelector<HTMLInputElement>(
    '[class*="ScreenVariableControls__bar"] input',
  );
  const native = input?.value.trim() ?? '';
  return native.length > 0 ? native : (getScreenVariable('BS') ?? '');
}

function updateBadge() {
  const value = readBaseValue();
  if (value.length === 0) {
    badge?.remove();
    badge = null;
    return;
  }
  if (badge === null || !badge.isConnected) {
    badge = document.createElement('div');
    badge.className = $style.locationBadge;
    document.body.append(badge);
  }
  if (badge.textContent !== value) {
    badge.textContent = value;
  }
}

// 全屏磁贴要给游戏自带的外壳让位：顶部 Head（屏幕切换、视图/公司）、左侧 sidebar（屏幕图标、
// 命令、设置）、底部 foot（货币、新建缓存窗口）。三处尺寸都由游戏按窗口大小排版决定，只能量出来。
let chromeSignature = '';
let chromeRemeasurePending = false;

// 浏览器「桌面版网站」模式会把布局视口撑到 980 再整体缩小显示，所有 CSS 尺寸只剩四成：
// 顶部标签在屏幕上只有 13x10 像素，手指点不中。按 innerWidth / 屏幕短边 算出的比例把
// 插件自己画的触摸目标放大，视觉尺寸才回到正常手机水平。
function computeScale(): number {
  const shortSide = Math.min(window.screen.width, window.screen.height);
  if (shortSide <= 0) {
    return 1;
  }
  const ratio = window.innerWidth / shortSide;
  return ratio > 1.15 ? Math.round(ratio * 100) / 100 : 1;
}

function updateChromeInsets() {
  const head = document.querySelector<HTMLElement>('[class*="Head__container"]');
  const sidebar = document.querySelector<HTMLElement>('[class*="Frame__sidebar"]');
  const foot = document.querySelector<HTMLElement>('[class*="Frame__foot"]');
  const headHeight = head === null ? 0 : Math.round(head.getBoundingClientRect().height);
  const sideWidth = sidebar === null ? 0 : Math.round(sidebar.getBoundingClientRect().width);
  const footHeight = foot === null ? 0 : Math.round(foot.getBoundingClientRect().height);
  const scale = computeScale();
  const signature = `${headHeight}/${sideWidth}/${footHeight}/${scale}`;
  if (signature === chromeSignature) {
    return;
  }
  chromeSignature = signature;
  const root = document.documentElement.style;
  root.setProperty('--rp-mobile-head-height', `${headHeight}px`);
  root.setProperty('--rp-mobile-side-width', `${sideWidth}px`);
  root.setProperty('--rp-mobile-foot-height', `${footHeight}px`);
  root.setProperty('--rp-mobile-scale', `${scale}`);

  // 新尺寸会改变布局本身（标签放大后行数、Head 高度都变），本帧量到的仍是旧值。
  // 下一帧重量一次，磁贴顶部才不会压住标签栏。
  if (!chromeRemeasurePending) {
    chromeRemeasurePending = true;
    requestAnimationFrame(() => {
      chromeRemeasurePending = false;
      if (enabled) {
        updateChromeInsets();
      }
    });
  }
}

function render() {
  if (!enabled) {
    return;
  }
  // 顺带刷新基地徽标：原生变量栏改值时不一定有可订阅的事件。
  updateBadge();
  updateChromeInsets();
  const tiles = collectTiles();
  if (tiles.length === 0) {
    return;
  }
  const cmds = tiles.map(x => x.cmd);

  // 当前面板的磁贴被游戏原位重建时（命令里的基地编码等参数随屏幕变量更新），
  // 跟着迁移到新命令，否则会被当成「面板已关闭」而跳到别的标签。
  if (activeCmd !== null && !cmds.includes(activeCmd)) {
    const moved = tiles.find(x => x.prevCmd === activeCmd);
    if (moved !== undefined) {
      history = history.filter(x => x !== activeCmd);
      setActive(moved.cmd);
    }
  }

  // 用户点按钮打开的新窗口要立刻显示：否则它既不在切换条的高亮里，又会被窄屏样式隐藏，
  // 表现为「点了按钮但屏幕没有变化」。同时记下来源面板，供「返回」按钮逐层退回。
  // 只认新出现的磁贴元素：分屏磁贴原位重建时元素被复用，不算新窗口。
  const opened = tiles.find(x => x.prevCmd === undefined && !knownCmds.includes(x.cmd))?.cmd;
  knownCmds = cmds;
  if (opened !== undefined) {
    if (activeCmd !== null && cmds.includes(activeCmd)) {
      returnStack.push(activeCmd);
    }
    setActive(opened);
  }
  if (activeCmd === null || !cmds.includes(activeCmd)) {
    // 当前面板被关掉时回到最近访问过且仍存在的那个。
    const previous = [...history].reverse().find(x => cmds.includes(x));
    setActive(previous ?? cmds[0]);
  }
  // 来源面板被关掉后就退不出去了，及时清栈，避免「返回」按钮点了没反应。
  returnStack = returnStack.filter(x => cmds.includes(x) && x !== activeCmd);

  // activeCmd 可能刚变过，属性要在这之前同步；早退只用于跳过重建切换条。
  // 先清掉不在本列表里的残留标记：组合面板被排除后不会再走进循环，
  // 不主动清就会和真正激活的那块同时铺满屏幕。
  for (const stale of document.querySelectorAll<HTMLElement>(`[${ACTIVE_ATTR}="true"]`)) {
    if (!tiles.some(x => x.tile === stale)) {
      stale.removeAttribute(ACTIVE_ATTR);
    }
  }
  for (const { tile, cmd } of tiles) {
    tileCmds.set(tile, cmd);
    if (cmd === activeCmd) {
      tile.setAttribute(ACTIVE_ATTR, 'true');
    } else {
      tile.removeAttribute(ACTIVE_ATTR);
    }
  }

  // 磁贴集合没变化就不重建切换条 DOM，避免游戏自身刷新内容时反复重建。
  // 标签与返回按钮的有无一起参与比较，文案或可返回状态变了也要跟着更新。
  const labels = buildLabels(tiles);
  const signature =
    tiles.map(x => `${x.cmd} ${labels.get(x.cmd) ?? ''}`).join('|') + `#${returnStack.length}`;
  if (signature === lastSignature) {
    return;
  }
  lastSignature = signature;

  const bar = ensureTabBar();
  bar.textContent = '';

  // 从页面里点按钮打开了子面板时，最左侧给一个返回键，退回上一层。
  if (returnStack.length > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '←';
    back.className = `${$style.tab} ${$style.tabBack}`;
    back.dataset.back = 'true';
    back.addEventListener('click', goBack);
    bar.append(back);
  }

  for (const { cmd } of tiles) {
    const isActive = cmd === activeCmd;
    const label = labels.get(cmd) ?? cmd;
    const button = document.createElement('button');
    button.type = 'button';
    // 点击与高亮都以命令为准，显示文本只负责好看。
    button.dataset.cmd = cmd;
    button.textContent = label;
    button.className = isActive ? `${$style.tab} ${$style.tabActive}` : $style.tab;
    button.addEventListener('click', () => select(cmd));
    bar.append(button);
  }
  revealActiveTab();
}

// 退回打开当前面板的那个面板。
function goBack() {
  const target = returnStack.pop();
  if (target === undefined) {
    return;
  }
  lastSignature = '';
  setActive(target);
  render();
}

// 切换条项目多时会横向溢出，把当前项滚进可视区，否则新打开的窗口高亮在屏幕外看不见。
function revealActiveTab() {
  if (tabBar === null) {
    return;
  }
  const active = Array.from(tabBar.children).find(x => x.classList.contains($style.tabActive));
  if (active === undefined) {
    return;
  }
  const button = active as HTMLElement;
  const target = button.offsetLeft - (tabBar.clientWidth - button.offsetWidth) / 2;
  tabBar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
}

function select(cmd: string) {
  setActive(cmd);
  const tiles = collectTiles();
  for (const entry of tiles) {
    if (entry.cmd === cmd) {
      entry.tile.setAttribute(ACTIVE_ATTR, 'true');
    } else {
      entry.tile.removeAttribute(ACTIVE_ATTR);
    }
  }
  const bar = ensureTabBar();
  for (const child of Array.from(bar.children)) {
    const button = child as HTMLButtonElement;
    const isActive = button.dataset.cmd === cmd;
    button.className = isActive ? `${$style.tab} ${$style.tabActive}` : $style.tab;
  }
  revealActiveTab();
}

function scheduleRender() {
  if (renderTimer !== null) {
    return;
  }
  // 游戏自身每帧都在刷表格内容，用短定时器合并成一次，避免每帧重新收集磁贴。
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    render();
  }, 120);
}

function startObserve() {
  if (observer !== null) {
    return;
  }
  // 必须观察整个 body：分屏磁贴在 MainState__tiles 里，但点按钮新开的是浮动窗口
  // （Window__window > Tile__tile），挂在 App__container 下，观察分屏容器会漏掉它们。
  observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.body, { childList: true, subtree: true });
}

function teardown() {
  enabled = false;
  observer?.disconnect();
  observer = null;
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
    renderTimer = null;
  }
  lastSignature = '';
  activeCmd = null;
  knownCmds = [];
  history = [];
  returnStack = [];
  labelCache.clear();
  tileCmds = new WeakMap();
  chromeSignature = '';
  const root = document.documentElement.style;
  root.removeProperty('--rp-mobile-head-height');
  root.removeProperty('--rp-mobile-side-width');
  root.removeProperty('--rp-mobile-foot-height');
  root.removeProperty('--rp-mobile-scale');
  if (tabBar !== null) {
    tabBar.remove();
    tabBar = null;
  }
  if (badge !== null) {
    badge.remove();
    badge = null;
  }
  for (const { tile } of collectTiles()) {
    tile.removeAttribute(ACTIVE_ATTR);
  }
}

function init() {
  const media = window.matchMedia(MOBILE_QUERY);

  function apply() {
    const isMobile = isMobileLayout();
    enabled = isMobile;
    // 样式整组以这个类为前缀：宽屏或被禁用时移除，规则自然失效。
    document.documentElement.classList.toggle($style.mobile, isMobile);
    if (!isMobile) {
      teardown();
      return;
    }
    render();
    updateBadge();
    startObserve();
  }

  apply();
  media.addEventListener('change', apply);
  // CDP 调窗或页面在后台时 media query 的 change 不一定触发，resize 兜底一次。
  window.addEventListener('resize', apply);
  // 选中基地只改屏幕变量，不一定带来磁贴结构变化，单独订阅它更新徽标。
  watch(() => getScreenVariable('BS'), updateBadge, { flush: 'sync' });
}

features.add(import.meta.url, init, '手机窄屏：磁贴单页全屏显示，底部切换条切换磁贴。');
