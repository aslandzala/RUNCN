// 界面主题注册表 —— 主题元数据的唯一事实源。
//
// 改动前必读 docs/theme-framework.md（规则库、新增主题 SOP、修改台账）。
//
// 约束：
//  1. 本文件必须保持「纯数据、零依赖」。refined-prun-startup.ts 会在页面脚本
//     启动早期（React 首次绘制之前）引用它，此时 store / 主题引擎 / DOM 都还
//     没就绪，任何 import 副作用都会破坏首屏。
//  2. 新增主题只需在这里加一行 + 按 mode 提供一份色板；id / 说明 / ThemeId /
//     设置页卡片 / 引擎可识别集合 / 首屏防闪 / 图表取色全部自动跟随。
//  3. 历史数据迁移（user-data-migrations.ts）里的主题 id 必须硬编码，禁止引用
//     本文件：迁移描述的是「当时的数据」，不能随注册表一起变化。
//  4. 任何主题逻辑的改动，都必须同步更新 docs/theme-framework.md 的
//     「有效规则库」与「修改台账」。

/** 主题的实现模式，决定引擎走哪条路径。 */
export type ThemeMode = 'native' | 'skin' | 'token';

export interface ThemeDefinition {
  /** userData.settings.theme 的值，同时也是 html[data-rp-theme] 的值。 */
  id: string;
  /** XIT SET THEME 卡片标题。 */
  label: string;
  /** XIT SET THEME 卡片说明。 */
  desc: string;
  /**
   * native：游戏原生外观。不注入覆盖表、不写 data-rp-theme。全表只能有一个。
   * skin ：色板写在 theme.ts 的 SKINS 里，--rp-skin-* 由 tokensFor() 注入；
   *        走通用 CONTROL_CSS，不做组件类型级映射。
   * token：色板写在 refined-prun.css 的 html[data-rp-theme='<id>'] 块里，
   *        --rp-cc-* 是唯一颜色字面量来源；引擎从 token 组装 Skin，并复用
   *        buildComponentCss(<id>) 生成组件类型 → token 的映射骨架。
   *        token 模式自动获得：首屏防闪标记、图表 token 取色。
   */
  mode: ThemeMode;
}

export const THEMES = [
  {
    id: 'default',
    label: '原样',
    desc: '游戏原生，不加修饰',
    mode: 'native',
  },
  {
    id: 'light',
    label: '浅色明亮',
    desc: '浅色明亮，低饱和',
    mode: 'skin',
  },
  {
    id: 'paper',
    label: '暖米纸',
    desc: '暖米纸张，赭金点缀',
    mode: 'skin',
  },
  {
    id: 'ceramic-colorful',
    label: '陶瓷白多彩',
    desc: '陶瓷暖白，八色分类',
    mode: 'token',
  },
  {
    id: 'nebula',
    label: '星海霓虹',
    desc: '深空霓虹，青蓝主色',
    mode: 'token',
  },
  {
    id: 'starforge',
    label: '星铸工业',
    desc: '深空工业，橙金主色',
    mode: 'token',
  },
] as const satisfies readonly ThemeDefinition[];

/** 设置项与 data-rp-theme 的合法取值，从注册表派生，不再手工维护。 */
export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME_ID: ThemeId = 'default';

/**
 * 当前 token 模式主题的默认 id。theme-ceramic.ts 的命名与它绑定。
 * 引擎判断一律用 usesTokenPalette()（基于 mode），禁止用这个常量做分支，
 * 否则新增第二个 token 主题时会被漏掉。
 */
export const CERAMIC_THEME_ID: ThemeId = 'ceramic-colorful';

/** 需要注入覆盖表的自定义主题（原样主题除外）。 */
export const CUSTOM_THEME_IDS: readonly ThemeId[] = THEMES.filter(t => t.mode !== 'native').map(
  t => t.id,
);
export const CUSTOM_THEME_ID_SET: ReadonlySet<string> = new Set<string>(CUSTOM_THEME_IDS);

export function themeById(id: string | undefined | null): ThemeDefinition | undefined {
  return THEMES.find(t => t.id === id);
}

/** 未知 / 未设置一律当原样主题，保证存量数据不会误触发覆盖表。 */
export function themeMode(id: string | undefined | null): ThemeMode {
  return themeById(id)?.mode ?? 'native';
}

export function isCustomTheme(id: string | undefined | null): boolean {
  return themeMode(id) !== 'native';
}

/** token 模式：色板在 CSS 里，需要首屏提前打标记、图表走 token 取色。 */
export function usesTokenPalette(id: string | undefined | null): boolean {
  return themeMode(id) === 'token';
}

/** 首屏防闪白名单：色板在 CSS 里的主题必须在 React 首次绘制前就位。 */
export const needsStartupMarker = usesTokenPalette;
