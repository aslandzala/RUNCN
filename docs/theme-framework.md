# 界面主题框架（Theme Framework）

> 本文件是 **RUNCN 本地 fork 的主题规范**，不随 PR 提交上游。
> 两个单一事实源：`src/features/basic/theme-registry.ts`（主题元数据）、本文件（规则与流程）。
>
> **强制约定**：任何与主题相关的改动，**改之前必须先读本文件**；**改完必须同步更新 §4 有效规则库与 §7 修改台账**。
> 只改代码不写台账 = 本次改动未完成。此约定同时写在工作区长期记忆里，后续每个会话自动加载。

---

## 0. 一句话

**新增一套主题 = 在注册表加一行 + 按 `mode` 提供一份色板。**
id、设置页卡片、TypeScript 类型、引擎可识别集合、首屏防闪、图表取色、组件映射骨架全部自动跟随，不再需要手工同步 7 处。

改动前先确认要改的是哪一层：

| 想做的事 | 改哪里 | 要不要动引擎 |
|---|---|---|
| 加/删/改名主题、改卡片文案 | `theme-registry.ts` 一行 | 否 |
| 调某套现有主题的颜色 | 该主题的色板（`SKINS` 或 `--rp-cc-*` 块） | 否 |
| 加一套新浅色皮肤 | 注册表 + `SKINS` 一份色板 | 否 |
| 加一套精细多彩主题 | 注册表 + `refined-prun.css` 一份 `--rp-cc-*` 色板 | 否 |
| 改所有主题共用的行为 | 引擎 / 兜底 CSS / 本文件规则库 | **是，必须写台账** |

---

## 1. 三层架构

```
配置层   theme-registry.ts       主题元数据（id / label / desc / mode）★唯一事实源
         theme.ts  SKINS         skin 模式色板（--rp-skin-* 值 + 3 族映射 + status/indicator/progress）
         refined-prun.css        token 模式色板（html[data-rp-theme='<id>'] 里的 --rp-cc-*）
                                 + 全局兜底规则 1)~6)
         theme-ceramic.ts        buildCeramicSkin()（token→Skin）+ 组件映射骨架（与颜色无关）

引擎层   theme.ts                CSSOM 扫描 / 颜色重映射 / CONTROL_CSS / 注入与切换
         refined-prun-startup.ts 首屏防闪标记（token 模式）
         utils/chart-theme.ts    canvas 图表取色（token 模式）

消费层   XIT/SET/THEME.vue       卡片列表（从注册表生成）
         各组件                  var(--rp-skin-*, <原样回退>)、var(--rp-cc-*)
```

| 文件 | 职责 | 关键符号 |
|---|---|---|
| `src/features/basic/theme-registry.ts` | 元数据唯一事实源，**纯数据零依赖** | `THEMES` / `ThemeId` / `themeMode()` / `usesTokenPalette()` / `CUSTOM_THEME_ID_SET` |
| `src/features/basic/theme.ts` | 引擎内核 + `CONTROL_CSS` + light/paper 色板 | `SKINS` / `buildCss()` / `collect()` / `mapColor()` / `tokensFor()` / `apply()` |
| `src/features/basic/theme-ceramic.ts` | token 模式：组装 Skin + 组件映射骨架 | `buildCeramicSkin()` / `buildComponentCss(themeId)` |
| `src/refined-prun.css` | 全局兜底、token 色板、首屏底色 | `--rp-color-*` / `--rp-inv-cat-*-rgb` / 分节 1)~8) |
| `src/refined-prun-startup.ts` | 首屏防闪 | `needsStartupMarker()` |
| `src/utils/chart-theme.ts` | 图表取色 | `chartColors()` / `FALLBACK` |
| `src/features/XIT/SET/THEME.vue` | 设置页卡片 | `THEMES` |
| `src/store/user-data.types.d.ts` | `ThemeId`（从注册表派生） | `import('...').ThemeId` |
| `src/store/user-data-migrations.ts` | 历史数据迁移 | **id 必须硬编码**（见 R19） |

> 行号会随改动浮动，定位一律用上表的符号名 / 分节标题，不要依赖行号。

---

## 2. 三种主题模式

| | `native` | `skin` | `token` |
|---|---|---|---|
| 现例 | `default` 原样 | `light` 浅色明亮、`paper` 暖米纸 | `ceramic-colorful` 陶瓷白多彩 |
| 色板位置 | 无 | `theme.ts` 的 `SKINS[id]` | `refined-prun.css` 的 `html[data-rp-theme='<id>']` 块 |
| 色值形态 | — | TS 字面量，由 `tokensFor()` 注入 | CSS 字面量 `--rp-cc-*`，组件一律 `var()` 引用 |
| Skin 来源 | 不生成 | `SKINS[id]` | `buildCeramicSkin()` 从 CSS token 读 |
| 组件映射骨架 | — | 不启用 | `buildComponentCss(id)` 自动生成 100+ 条规则 |
| 首屏防闪标记 | 否 | 否 | **是**（色板在 CSS 里，React 首绘前必须就位） |
| 图表取色 | 默认色板 | 默认色板 | `--rp-cc-*` token |
| 适合 | 保持游戏原版 | 快速做一套新配色 | 精细主题：分类/图表/图标/状态分色 |

`mode` 是引擎唯一的分支依据。**禁止**再用 `theme === 'ceramic-colorful'` 之类的具名 id 做判断。
`CERAMIC_THEME_ID` 只是「当前 token 主题的默认 id」兼容常量，不是判断条件。

---

## 3. 引擎原理（不理解这 5 条必然踩坑）

### 3.1 注入顺序固定

`apply()` 生成的 `#rprun-theme` 内容顺序：

```
buildCss(skin)  →  tokensFor(theme, skin)  →  CONTROL_CSS  →  buildComponentCss(theme)
  覆盖表            主题变量                  通用控件规则      组件映射骨架（仅 token）
```

同特异性下**后面的赢**。`CONTROL_CSS` 三套主题共用、零主题分支；组件映射骨架最后，决定按钮/控件/表格最终外观。`buildCss()` 必须跳过 `#rprun-theme` 自己，否则反复切换会把已映射的颜色再次反转、累积失真。

### 3.2 CSSOM 扫描与 `TOKEN_RULE_RE`

`collect()` 遍历所有同源 `document.styleSheets`，把每条声明里的颜色字面量（`#hex` / `rgb()` / `hsl()`）按「角色 + 色相」重映射成主题色，输出全部带 `!important`。
只有选择器精确匹配 `^html\[data-rp-theme=[^\]]+\](\s+body)?$` 的规则会被跳过——**主题自己的 token 块靠这个正则免于被二次重映射**。

由此推出 R01：色板颜色**只能**放在精确 `html[data-rp-theme='<id>']` 块里。

### 3.3 `--rp-color-*` 为什么会被刷成近白

`refined-prun.css` 顶部在**裸 `html {}`** 里定义了 `--rp-color-green/text/orange/accent-primary` 等（给原样主题用）。裸 `html{}` 不匹配 `TOKEN_RULE_RE`，于是这些变量被当成「游戏原生颜色」参与重映射：
`#5cb85c` → 绿族 background `#e8f2eb`、`#ffc856` → 石板蓝 background `#e7eef4`、`#999` → `rgb(175,175,175)`。
组件拿它当**文字色**就是浅字压浅底（CONTS 曾 1.01:1）。

`--rp-skin-*` 不受影响有三重保护：注入在 `#rprun-theme` 内被跳过；token 模式的值全是 `var(--rp-cc-*)` 别名，没有颜色字面量；纯 RGB 三元组（`51, 86, 111`）也不匹配颜色正则。

### 3.4 特异性阶梯（文档顺序不可靠）

`#rprun-theme` 在 `<head>`，`refined-prun.css` 由 startup 挂在 `<html>` 末尾，文档顺序**晚于**引擎样式表。同特异性时全局兜底会反过来压掉主题规则，所以必须靠重复属性选择器显式抬级：

| 场景 | 前缀 | 特异性 |
|---|---|---|
| `CONTROL_CSS` 清窗口斜纹 | `html[data-rp-theme][data-rp-theme]` | (0,2,x) |
| 组件映射骨架 | `html[data-rp-theme='<id>'][data-rp-theme]` | (0,3,1) |
| 固定文字选中态 | `html[data-rp-theme] ×3` | (0,3,x) |
| 第 6) 组可读性兜底 | `html[data-rp-theme] ×3` + `:is(...)` | (0,5,x) |
| INV 分类头（token 覆盖） | `×5` | (0,5,x) |

### 3.5 token 值的三种合法形态

1. 精确 `html[data-rp-theme='<id>']` 块里的颜色字面量（被 `TOKEN_RULE_RE` 跳过）；
2. `var()` 别名，不含颜色字面量；
3. 纯 RGB 三元组 `51, 86, 111`（供 `rgb(var(--x))` 用），不匹配颜色正则。

**任何其它形态的颜色字面量都会被重映射。**

---

## 4. 有效规则库（历史踩坑固化）

> 每条都是「现象 → 根因 → 固化规则 → 落点 → 验证」。**新增规则或修改规则必须同步写 §7 台账。**

### A. 色板与 token

| ID | 现象 / 根因 | 固化规则（必须 / 禁止） | 落点 | 验证 |
|---|---|---|---|---|
| R01 | 色板颜色被扫描后压成中性灰 | **必须**把颜色字面量只放在精确 `html[data-rp-theme='<id>']` 块；**禁止**在组件规则里写裸色值 | `refined-prun.css` token 块 / `theme.ts TOKEN_RULE_RE` | `verify-ceramic-theme.mjs` 精确色值 |
| R02 | `--rp-color-*` 被二次重映射成近白，浅字压浅底 | **必须**在 XIT / 原生 FIN 窗口内把 6 个 `--rp-color-*` 局部重定义指向 `--rp-skin-*`；组件里用 `--rp-skin-*`，**禁止**用 `--rp-color-accent-primary` 当文字色 | `refined-prun.css` 第 6) 组；`CXOS.vue` / `NX.vue` | `verify-round25.mjs` 变量亮度 <0.4 |
| R03 | 分类头底色被重映射 | **必须**用纯 RGB 三元组存 `--rp-inv-cat-*-rgb` / `--rp-window-border-rgb`，**禁止**写成 `#hex` | `refined-prun.css` 分节 A/B | `verify-theme-cat-colors.mjs` |
| R04 | 同一颜色在多处重复定义，改一处漏一处 | **必须**保证每套主题只有一个颜色字面量来源：skin 模式在 `SKINS[id].vars`，token 模式在 `--rp-cc-*` 块，其余全部 `var()` 别名 | `theme-ceramic.ts buildCeramicSkin()` | 代码审查 |
| R05 | 图表 canvas 不认 `var()` | **必须**让 token 模式主题在 CSS 里提供 `--rp-cc-cat-1..8-chart` 等；非 token 模式一律返回 `FALLBACK`，保证原样/light/paper 图表一字不变 | `chart-theme.ts` | `verify-ceramic-real-dom.mjs` 画布取色 |

### B. 特异性与注入顺序

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R06 | 全局兜底被引擎 `!important` 规则压掉 | **必须**用重复 `html[data-rp-theme]` 抬特异性（见 §3.4），**禁止**依赖样式表文档顺序 | `theme.ts CONTROL_CSS` / `refined-prun.css` 第 6) 组 | `verify-round14-theme-fixes.mjs` |
| R07 | 反复切主题颜色累积失真 | `buildCss()` **必须**跳过 `#rprun-theme` 自身；跨域样式表 `try/catch` 跳过 | `theme.ts buildCss()` | 反复切换后取色 |
| R08 | 游戏启动后继续注入 CSS Modules 样式表，新表没被覆盖 | **必须**保留 `MutationObserver` + 250ms 防抖重算；原样主题时断开观察 | `theme.ts init()` | 切主题后新开窗口取色 |

### C. 可读性（三套自定义主题通用）

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R09 | 8~10px 小字在浅底不可读 | **必须** ≥11px；新增组件禁止引入 <11px 正文 | `refined-prun.css` 分节 D；各 SFC | `verify-round25.mjs` `small===0` |
| R10 | `opacity:0.3~0.85` 把文字压淡到 3~4:1 | **必须**在 XIT/FIN 窗口内 `opacity:1`，精确排除拖拽把手 / `dimmed` / 禁用态；**禁止**全局无差别覆盖 | `refined-prun.css` 第 6) 组 | `verify-round25.mjs` `faded===0` |
| R11 | 白半透明描边 / 遮罩在浅底消失或盖住数字 | **必须**把卡片线换成 `--rp-skin-border`、遮罩换成不透明语义色；预警层改不透明后**必须**给数字 `z-index:1` + `--rp-skin-ink` | `refined-prun.css` 第 6) 组；`theme-ceramic.ts` Overlay；`BURN/DaysCell.vue` | `verify-round25.mjs` |
| R12 | 表头透明、400 字重、细线，原生 FIN 与 XIT FINxx 格式分裂 | **必须**让第 6) 组作用域同时包含 `.rp-command-XIT`、`[class*='rp-command-FIN']`、`[class*='rp-command-CORPFIN']`；表头统一底色/600 字重/底线，td 补底线 | `refined-prun.css` 第 6) 组 | `verify-fin-style.mjs` 129 项 |
| R13 | ⓘ 图标被刷成近白，或改成深色后变成黑底白字 | **必须**用 `color: inherit` 自适应（**禁止**硬设深色：它常嵌在深蓝 LABEL 白字里）；Tooltip 容器必须透明无边框 | `refined-prun.css .rp-tooltip-icon`；`theme-ceramic.ts` Tooltip 段 | `verify-round25.mjs` / `verify-round14` |

### D. 布局与盒模型

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R14 | `XIT SET THEME` 从 2×2 塌成单列 | **禁止**用 `border` 界定窗口层级：窗口宽高由游戏 inline style 精确控制，2px 实边框会把内容区 428px 挤到 426px，正好放不下两列。**必须**用 `box-shadow: 0 0 0 1px` + `border:0`；卡片 `minmax(200px, 1fr)` 留 10px 余量 | `theme-ceramic.ts` Window 段；`refined-prun.css` 窗口描边；`THEME.vue .grid` | `verify-round14-theme-fixes.mjs` `cols===2 && cards===4` |
| R15 | 灰色斜纹 / 斑马纹窗体 | **必须**清掉 `Window__window` 的 `background-image`；货物条改纯色轨道；NOTS 只补底线，**禁止**铺斑马纹底 | `theme.ts CONTROL_CSS`；`refined-prun.css` 第 4) 组；`InvBar.vue` / `FleetCargoBar.vue` | `verify-round14` `gradients===0` |
| R16 | 对顶双三角悬浮指示 | **必须**全局 `[data-tooltip]::after { display:none }`，保留 `::before` 文字框；`:is()` 里**禁止**写伪元素（会让整条分支失效） | `refined-prun.css` 第 5) 组 | `verify-round23.mjs` |
| R17 | 贯穿全屏的 TileDivider 竖条被染色 | 装饰线规则**必须** `:not([class*='TileDivider__'])`，且不能破坏 `cursor:col-resize` | `theme-ceramic.ts` 装饰线段 | `verify-round14` |
| R24 | 原样主题下 FB 面板 BS / BURN 出现宽白边，中间 INV 却没有 | 槽位 `.slot` 的 `var(--rp-skin-*, <回退>)` 回退值**必须**是 `transparent`，**禁止**写浅色裸值（原样主题没有 skin 变量，浅色回退会从四周露出）；**必须**清零所有内嵌 `Tile__tile` 的 6px 外边距，使各槽铺满（缝隙 ≤2px）。回退里也**禁止**出现颜色字面量，否则会被 CSSOM 扫描 | `FB.vue .slot` / `.slot [class*='Tile__tile']` | `verify-round26.mjs` 四槽 gap / 槽位底色 |
| R25 | INV / SHPI 右侧两套滚动条叠加；紧凑模式物料全显却强制出滚动条 | 游戏 ScrollView 同时画自绘 6px 轨道与浏览器滚动条；`overflow:scroll` 无溢出也画轨道。**必须**把 `ScrollView__view` 改 `overflow:auto`、在本作用域把 `scrollbar-width/color` 清回 `auto`、隐藏自绘 `track/thumb`、只留 `::-webkit-scrollbar` 4px 且 `::-webkit-scrollbar-button{display:none}`；**禁止**让主题全局 `scrollbar-color` 覆盖本作用域（会让 Chromium 忽略 webkit 细条改画 ≈10px 标准条）。此组是布局修复，**不带**主题前缀 | `refined-prun.css` 第 7) 组 | `verify-round26.mjs` `barWidth===0` / `tracks===0` / 溢出时细条出现 |

### E. 语义色与数字

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R18 | 期限告警黄/红被收敛成石板蓝；选中态与未选中态分不出 | **必须**保留 `statusOverride()`（warning/danger）与 `semanticOverride()`（指示器、`<progress>` 容量条）；选中态拉回深色 | `theme.ts statusOverride / semanticOverride` + `Skin.status/indicator/progress` | `verify-theme-fixes.mjs` |
| R19 | 正负数字色被 `:is(td,th)` 统一文字色压成中性灰 | **必须** `:is(td, th):not([class*='ColoredValue'])`；原生 FIN 的语义色挂在 span、XIT FINBS 挂在 td，两类都要保留语义绿/红 | `theme-ceramic.ts` 表格段；`refined-prun.css` 第 6) 组 | `verify-fin-style.mjs` 正数颜色一致 |
| R20 | 缓存窗口边框从石板蓝→橙色→深蓝反复改 | 边框色**必须**走 `--rp-window-border-rgb`（纯三元组），用 `box-shadow` 不占盒模型；当前定值深蓝 `25, 60, 105` | `refined-prun.css` 分节 A/N | 真机取色 |
| R26 | 原生命令执行状态斜纹（运行中橙滚动 / 完成绿静止）在自定义主题下发白 | 游戏原生把颜色**写死在 `repeating-linear-gradient` 字面量**里，`collect()` 判 `gradient` 角色后换成 `palette.*.gradient` 近白；与 `--rp-color-*` 被污染是**两条独立路径**，第 6) 组的变量重定义覆盖不到，且 `COGCPEX` 等原生窗口不在 XIT/FIN 作用域。**必须**按 `ActionFeedback__progress/success/error` 类名直接覆盖 `background-image` / `background-color`，用 `color-mix(in srgb, var(--rp-skin-action-*) …, transparent)`（整条值不含颜色字面量，不会被扫描）；**禁止**改 `animation` / `background-position`（保留滚动与静止的区别）；**禁止**写裸色回退；规则带 `html[data-rp-theme]` 前缀，原样主题不受影响 | `refined-prun.css` 第 8) 组 | `verify-round26.mjs` 三主题 × 两态取色 + 原样 `styleLen===0` |

### F. 原样主题与历史数据

| ID | 现象 / 根因 | 固化规则 | 落点 | 验证 |
|---|---|---|---|---|
| R21 | 自定义主题规则误伤原样主题 | **必须**保证所有覆盖规则带 `html[data-rp-theme]` 前缀；`default` 时清空 `style.textContent` + `delete dataset.rpTheme` + 断开 observer；组件一律 `var(--rp-skin-*, <原样深色回退>)`；`chartColors()` 对非 token 模式返回 `FALLBACK`；固定文字选中态要有 `:not([data-rp-theme])` 并列分支 | `theme.ts apply()`；全库 `var()` 回退 | `verify-fin-style.mjs`（`data-rp-theme` 不存在、表头透明、字重 400）；`verify-ceramic-theme.mjs`（`styleLen===0`） |
| R22 | 迁移引用注册表导致旧数据被误改 | **禁止**在 `user-data-migrations.ts` 里 import 注册表；历史 id（如 `mint`）与回退目标**必须**硬编码。迁移描述「当时的数据」，不能随注册表变化；**删除主题必须补一条迁移** | `user-data-migrations.ts` | 迁移单测 / 真机旧档 |
| R23 | 反色滤镜方案残留 | **禁止**再引入 `invert()` / `hue-rotate()` / `darkMode`；主题一律「直接改颜色」 | `theme.ts` 引擎 | 代码审查 |

---

## 5. 新增主题 SOP

### 5.1 `skin` 模式（最快，适合「再做一套别的颜色」）

1. `src/features/basic/theme-registry.ts` → `THEMES` 加一项：
   `{ id: '<新id>', label: '…', desc: '…', mode: 'skin' }`。
2. `src/features/basic/theme.ts` → `SKINS` 加同名 key，**完整复制** `light` 的 `Skin` 结构后改色：
   `vars`（全部 `--rp-skin-*`，含 4 个 bridge）、`palette` 三族、`neutralShift`、`status`、`indicator`、`progress`。
   缺任何一组都会让 `mapColor()` 拿到 `undefined`。
3. `src/refined-prun.css` → 分节 B 加 `html[data-rp-theme='<新id>']` 的 4 类 `--rp-inv-cat-*-rgb`（纯 RGB 三元组）。
   若沿用全局兜底值可不改，但**要确认四类在该底色上对比度 ≥4.5**。
4. 完成。`ThemeId`、设置卡片、引擎集合、feature 描述自动跟随；首屏防闪与图表保持默认（与原样/light/paper 一致）。

### 5.2 `token` 模式（精细多彩主题）

1. 注册表加一项 `mode: 'token'`。
2. `src/refined-prun.css` 新增 `html[data-rp-theme='<新id>'] { ... }` 色板块，**照抄现有 `--rp-cc-*` 变量名全量定义**（约 90 个）：背景/文字/边框/5 类按钮×3 态/控件/表格/4 类状态/分类 1..8 各 4 个/图表 token。变量名必须完全同名，`buildCeramicSkin()` 与 `buildComponentCss()` 才能复用。
3. 同文件加 `html[data-rp-theme='<新id>'] body { ... }` 首屏底色与正文色。
4. 完成。首屏防闪、图表取色、8 色相带 Skin、100+ 条组件映射骨架全部自动生效。
5. **必须**跑 `prun-cdp/verify-ceramic-contrast.mjs` 的等价校验（把脚本读的色板块换成新 id），逐项确认 WCAG 2.1 ≥4.5。

### 5.3 两种模式都要做的收尾

- 跑 §8 全部验收；特别断言**原样主题**未受影响（R21）。
- 在 §7 台账追加一行，写清「为什么选这个 mode / 色板怎么定的」。
- 若改了任何共用规则，先更新 §4 对应条目再改代码。
- 若**删除**主题：删注册表项 + 删色板 + **必须补迁移**（R22）。

---

## 6. 原样主题红线（回归红线，一条都不能破）

1. `default` 不写 `data-rp-theme`、`#rprun-theme` 内容为空、observer 断开。
2. 所有覆盖规则带 `html[data-rp-theme]` 前缀；token 色板块只在精确 id 下生效。
3. 组件的 `var(--rp-skin-*, <回退>)` 回退值必须是游戏原生深色，不能删。
4. 首屏只对 `needsStartupMarker()` 为真的主题提前打标记。
5. 图表对非 token 模式返回 `FALLBACK`。
6. 固定文字选中态要有 `:not([data-rp-theme])` 并列分支，且**只留下划线**，不加底色、不改文字色/字重。

---

## 7. 修改台账（append-only）

> **这就是「以后再有修改，修改逻辑也写进固化里面」的落点。**
> 每次主题改动追加一行，四列必填：`改了什么` / `为什么（修改逻辑）` / `固化为哪条规则` / `怎么验的`。
> 若改动**新增或推翻**了一条规则，同时更新 §4 对应条目（不要只写台账不改规则库）。
> 只追加，不改历史行。

| 日期 / 提交 | 改了什么 | 修改逻辑（为什么这么改） | 固化为 | 验收 |
|---|---|---|---|---|
| 早期 `5a2aad2e` | 反色滤镜 `invert + hue-rotate` | 初版做法，图片/图表一起被反色、语义色失真 → 已废弃 | R23（禁止） | — |
| `245c485a` / `2dbef90d` | 主题系统重写：改为 CSSOM 扫描、按角色重映射颜色 | 只改颜色不动布局/数据；每套皮肤只换一组 token | §3.1、R07、R23 | 三主题基础取色 |
| `cb4d22ea` | 窗口深蓝描边、FB/INV 排版、BRN 分类分色 | 缓存窗口边界在浅底不清；橙边框视觉突兀 → 深蓝 + box-shadow 不占盒模型 | R20、R14 | `verify-theme-cat-colors.mjs` |
| `1fcc70e3` | CXOS 强调文字改 `--rp-skin-selection`（1.03→6.94） | `--rp-color-accent-primary` 被主题引擎刷成近白，浅字压浅底 | R02、R03 | CXOS 对比度 |
| `288261d8` | 全库 XIT 可读性整改：小字 ≥11px、opacity 归 1、状态色改 `--rp-skin-*`、半透明遮罩兜底、warm paper 深色化 | 三套自定义主题下浅底把细线/淡字/白半透明全部冲淡；统一走不受扫描影响的 `--rp-skin-*` | R09、R10、R11、R04 | `verify-round25.mjs` 三主题 × 8 面板 106/106 |
| 2026-11-09（未提交） | 原生 `FIN*` 与 `XIT FIN*` 格式统一；陶瓷白 `:is(td,th)` 排除 `ColoredValue` | 第 6) 组原只挂 `.rp-command-XIT`，原生财务窗口一条没吃到 → 表头/线条/数字色分裂；td 上的正负色类被统一表格文字色压成中性灰 | R12、R19 | `verify-fin-style.mjs` 129/129（三主题 × 6 类窗口 + 原样主题） |
| 2026-11-09（未提交） | **本框架固化**：注册表、三种 mode、组件映射骨架参数化、本文件 | 主题 id/描述散在 7 处手工同步；105 处硬编码 `ceramic-colorful` 前缀使新主题必须整段复制；20+ 条踩坑修正只存在于代码注释与验收脚本，没有单一事实源 | §0~§6 全部；R01、R04、R22 补充 | 类型检查 + 完整构建链 + 真机三主题回归（见 §8） |
| 2026-11-09（未提交） | FB 槽位白边、INV 双滚动条 / 紧凑强制滚动条、原生状态斜纹发白，共 4 项 | ① FB 槽位浅色 `var()` 回退 + 原生 6px 外边距 → 原样主题 BS/BURN 露出 14px 宽白边，INV 已铺满所以看不到；② `overflow:scroll` 无溢出也画轨道、紧凑模式清零负 margin 暴露第二套，主题全局 `scrollbar-color` 又让细条变 ≈10px 标准条；③ 游戏原生斜纹颜色是 `repeating-linear-gradient` 里的**字面量**，被 CSSOM 的 gradient 角色映射刷白，与 `--rp-color-*` 污染无关，第 6) 组变量兜底覆盖不到。一律选**局部 CSS 兜底**而非改引擎 `semanticOverride()`：后者只处理 `background-color`、不处理 `background-image`，要扩展需动 Skin 接口 + 三份色板，回归面最大；槽位改透明回退 + 清零外边距比改盒模型高度更安全；滚动条只隐藏自绘轨道、保留 4px webkit 细条，`overflow:auto` 天然按需 | 新增 R24、R25、R26 | `verify-round26.mjs`（三主题 + 原样真机）、完整构建链、既有主题回归脚本 |

**新行模板**

```
| YYYY-MM-DD（提交/未提交） | 改了哪些文件、什么行为 | 出现的问题 → 根因 → 为什么选这个修法、否掉了什么方案 | 新增/修改 R__ | 跑了哪些脚本、结果 |
```

---

## 8. 验收清单

**构建链**（每次改完固定流程，见工作区长期记忆）：

```
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/vite build
./node_modules/.bin/vite build --config vite.content.config.mts
node scripts/fix-innerHTML.mjs
cd ../prun-cdp && node reload-ext.mjs && node refresh-page.mjs
```

构建前移走 `dist/virtual`（构建会自动重建）。刷新后 SPA 可能自行跳 screen，**不要擅自切回**，如实告知用户。

**离线**：`prun-cdp/verify-ceramic-contrast.mjs`（色板 WCAG 2.1 60+ 组）。

**真机（后台 CDP，不抢前台、不触发真实库存动作）**：

| 脚本 | 覆盖 |
|---|---|
| `verify-ceramic-theme.mjs` | token 模式精确色值、按钮 5 类、表头/斑马纹、Tooltip、分类、图表、焦点环、刷新持久化与首屏无闪帧、**原样主题 `styleLen===0`** |
| `verify-round14-theme-fixes.mjs` | 4 主题：斑马纹、2×2 卡片、ⓘ 非黑底、窗口 `border=0`、TileDivider |
| `verify-round25.mjs` | 三主题 × 8 个 XIT 面板：0 低对比度 / 0 小字 / 0 opacity 压淡 |
| `verify-fin-style.mjs` | 三主题 × 原生 FIN + XIT FIN：表头/线条/数字色一致，**原样主题不受影响** |
| `verify-theme-cat-colors.mjs` | light/paper × compact on/off × 独立 INV：分类头底色未被重映射、≥4.5 |
| `verify-round24.mjs` / `verify-round23.mjs` | BRN 四色、CXOS 无裸硬编码、悬浮三角全消失、XIT 表头 |
| `verify-round26.mjs` | FB 四槽 gap / 槽位底色（含原样）、INV 双轨消除与按需 4px 细条、三主题 × 状态斜纹运行/完成/失败取色、原样主题红线 |

**结束必须**：恢复 url / screen / 主题 / 紧凑态 / 窗口集合，断言无残留测试窗口。

---

## 9. 维护约定

1. **改主题前**：读本文件 → 确认改动落在哪一层（§0 表）→ 确认没有触碰 §6 红线。
2. **改主题后**：更新 §4 规则库（若规则有变）→ 追加 §7 台账 → 跑 §8 验收 → 恢复现场。
3. **新增主题**：按 §5 SOP，收尾同样要写台账。
4. **本文件与 `theme-registry.ts` 是唯一事实源**：不要在别处再写一份主题 id 列表、描述文案或 id 联合类型；历史迁移例外（R22）。
5. **不往源码注释里写历史叙事**：上游 `docs/project-rules.md` 要求源码注释只保留当前不变量；「为什么改过、走过哪些弯路」写进本文件的规则库与台账。
6. **本文件不随 PR 提交上游**（本地 fork 规范）；若以后决定贡献给上游，先按 `docs/contributing.md` 精简成纯当前规范。
