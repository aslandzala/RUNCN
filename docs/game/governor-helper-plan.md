# XIT GOVH — Governor Helper 方案（已实现）

> 状态：**已实现并经真机验收**（2026-11-11）。本文继续作为固化系数与实现口径的事实源；
> 最新口径：单价统一复用 BPC/BMAT/CBUY 的 `computeComponents()`，待补量扣除政府基建设施
> 「下一次消耗 + 储备」内部存量，并在表格「计算过程」列展示算式；底部不再放购物车按钮。
> 补给方案按建筑分组，「建筑」与「覆盖需求」列同一建筑 `rowspan` 合并，组间只保留粗线与建筑列色条，无分组底色；
> 前四列固定 `建筑 / 覆盖需求 / 选 / 物料`，勾选只从「选」列向右染色、覆盖需求与「选」列之间有 2px 边界；
> 自有基地星球下拉与政府下拉统一 11px，占位不带星球数量；
> 维生行角标不挂浮窗，下方用「维生」需求定稿说明。新增「维生预期」两档（按当前 / 预计补齐 100%，默认后者），
> 后五类按所选假设备货；预览同时给出预测值与游戏当前实际显示值，六类需求表删除恒空的「封顶」列，
> 三段说明移到双栏之外同栅格排布。表头选「自定义编码…」后可从「自有基地星球」下拉选择
> （游戏约束一星球一基地，选项不显示基地数量），也可手输；焦点被游戏容器抢走时会自动补回。
> 验收记录以 `scripts/test-govh-model.mjs`、`prun-cdp/govh-verify-dom.mjs`、
> `prun-cdp/govh-verify-e2e.mjs`、`prun-cdp/verify-govh-theme.mjs`、
> `prun-cdp/govh-verify-remount.mjs` 与 `prun-cdp/govh-verify-cache-timing.mjs` 为准。
> 最终真机验收：`govh-verify-e2e.mjs` **88/88**、`verify-govh-theme.mjs` 20/20、
> `govh-verify-dom.mjs` 13/13、`govh-verify-remount.mjs` 8/8、`test-govh-model.mjs` 26/26。
> 目标：在独立 XIT 面板 `XIT GOVH` 内，按六类需求 × 五类人口反算达到
> 100% 满意度所需的基建补给物料与数量（2026-11-11 起目标固定 100%，70% 档已移除），列出全部物料供自选，并联动
> 生成采购清单 / 打开购物界面。
> 红线：**只连游戏本地数据**（本地 store + 原生窗口 DOM + `showBuffer` 订阅），
> 不引入 FIO / Prunplanner / oogcapitalmanagement 等任何外部运行时请求。
> 外部网站的系数是**一次性查阅后固化到本仓库**的静态表，运行时零网络。

---

## 1. 需求与决策口径（用户已确认）

| 项 | 决定 |
|---|---|
| 数据来源 | 外部公式/系数**一次性固化**；运行时只用游戏本地数据 |
| 命令形态 | 独立命令 `XIT GOVH`（不嵌进 POPI） |
| 口径 | **六类需求**（维生/安全/健康/舒适/文化/教育）× **五类人口**（先驱/定居/技术/工程/科学） |
| 目标档位 | 固定 100%（2026-11-11 移除 70% 档：默认维生预期已是「预计补齐 100%」，再留 70% 等于同一目标两个旋钮；求解器现硬编码 100% 目标、不再接受任意 `target`，「省钱档」旋钮已从设计与模型中彻底移除） |
| 物料范围 | 列出**全部**可补给物料供勾选，而非只给最低限度 |
| 联动 | 计算出的清单能生成 `XIT CBUY GOVH` 临时比价清单，或复制为 XIT JSON 供 `XIT CART` 导入；GOVH 面板内不再放购物车按钮 |

---

## 2. 游戏机制（固化：来自 pct.fnar.net + oogcapitalmanagement，已核对）

### 2.1 需求满足度（Need Fulfillment）

```
满足度 = Needs Provided / Needs Needed
```

**Needs Needed**（按人口加权求和，`count × weight`）：

| 人口 \ 需求 | 维生 lifeSupport | 安全 safety | 健康 health | 舒适 comfort | 文化 culture | 教育 education |
|---|---|---|---|---|---|---|
| 先驱 Pioneer | 0.54 | 0.25 | 0.15 | 0.03 | 0.02 | 0.01 |
| 定居 Settler | 0.41 | 0.30 | 0.20 | 0.03 | 0.03 | 0.03 |
| 技术 Technician | 0.15 | 0.20 | 0.30 | 0.20 | 0.10 | 0.05 |
| 工程 Engineer | 0.10 | 0.10 | 0.15 | 0.35 | 0.20 | 0.10 |
| 科学 Scientist | 0.05 | 0.10 | 0.10 | 0.20 | 0.25 | 0.30 |

> 这是 GitHub 上 `population-infrastructure` 的权重表（已与 oog 的 `HAPPINESS_WEIGHTS` 交叉核对一致）。

**Needs Provided** 三个来源：
- 肥沃星球（fertile）：维生恒为 100%。
- 基地（base）：每座提供 `safety = 50 × 基地数`、`health = 50 × 基地数`；基地上的住房提供维生。
- 基建（POPI）：效果与**一周内实际收到的 upkeep 成正比**，所有输入物料等权，且只在消耗 tick 计入。

### 2.2 分层封顶（Capping）

需求分 4 层，**高层满足度不能超过其下一层中最差的那一项**：

```
Tier 1  维生
Tier 2  安全 & 健康
Tier 3  舒适 & 文化
Tier 4  教育

fulfillment[安全] = min(raw安全, 维生)
fulfillment[健康] = min(raw健康, 维生)
fulfillment[舒适] = min(raw舒适, min(安全, 健康))
fulfillment[文化] = min(raw文化, min(安全, 健康))
fulfillment[教育] = min(raw教育, min(舒适, 文化))
```

> 这解释了 oog governor-helper 结果里「健康 314% / 舒适 132%」但满足度都显示 71.8% —— 被下一层的短板封顶。
> **GOVH 必须实现封顶**，否则会把玩家引到超额采购上。
>
> **维生预期（2026-11-11）**：政府改不了维生，但非宜居星球的住房缺口通常只是一个人口报告周期内的暂时状态。
> 面板提供两档假设：`按当前 XX%`（`lifeBaseline = POPR 现值`、`effectiveTarget = min(target, 维生现值)`）
> 与 `预计补齐 100%`（`lifeBaseline = 1`、`effectiveTarget = target`，默认）。
> 采购量按 `effectiveTarget` 备足 30 天，预览按 `lifeBaseline` 封顶给出**预测值**，
> 另用 `displayNow` 给出游戏此刻**实际显示值**，两者不可混为一谈。
> 肥沃星球维生恒 100%，两档等价、按钮禁用。

### 2.3 人口幸福度（与需求满足度分开算，但受其影响）

```
needHappiness(tier) = Σ(need_weight[tier][need] × fulfillment[need])   // 不含维生以外失业
trueHappiness = clamp(needHappiness ± unemployment, 0, 1)
  失业为负时加成封顶 = 30% × needHappiness
  新星球前 4 周 explorer's grace：+50%（仍封顶 100%）
averagedHappiness = 0.4·h0 + 0.25·h1 + 0.2·h2 + 0.1·h3 + 0.05·h4   // 游戏显示值，5 周加权
```

- 增长：幸福度 > 70% 迁入（`pop × (H − 0.7)`），< 50% 迁出（`0.8 × pop × (0.5 − H)`）。
- 教育升级：如 `SET→TEC = 0.015 × SET人口 × TEC幸福度`（基础 S 值 + 教育建筑加成）。

> GOVH v1 聚焦「补给→需求满足度→幸福度」这一段；人口增长/教育流动表作为**参考展示**，
> 不参与采购求解（避免过度设计）。

---

## 3. 固化系数表（一次性，运行时零网络）

### 3.1 14 座基建建筑 → 物料 / 日耗 / 需求贡献

来源：oogcapitalmanagement `/infra-data.js`（`UPKEEP_BUILDINGS`）。
`qtyPerDay` 是**每 1 级**的日耗；`needs` 是全部物料供给时**每 1 级**提供的需求单位，
每种物料独立提供 `1/n`（n=该建筑物料数）。

| 建筑 | ticker | 物料(日耗/级) | 需求贡献(每级) |
|---|---|---|---|
| 安全站 | SST | DW 10, OFF 10, SUN 2 | 安全 2500 |
| 安防无人机站 | SDP | POW 1, RAD 0.47, CCD 0.07, SUD 0.07 | 安全 5000 |
| 应急中心 | EMC | PK 2, POW 0.4, BND 4, RED 0.07, BSC 0.07 | 安全 1000, 健康 1000 |
| 医务室 | INF | OFF 10, TUB 6.67, STR 0.67 | 健康 2500 |
| 医院 | HOS | PK 2, SEQ 0.4, BND 4, SDR 0.07, RED 0.07, BSC 0.13 | 健康 5000 |
| 健康中心 | WCE | KOM 4, OLF 2, DW 6, DEC 0.67, PFE 2.67, SOI 6.67 | 健康 1000, 舒适 1000 |
| 野生动物园 | PAR | DW 10, FOD 6, PFE 2, SOI 3.33, DEC 0.33 | 舒适 2500 |
| 4D 游乐中心 | 4DA | POW 2, MHP 2, OLF 4, BID 0.2, HOG 0.2, EDC 0.2 | 舒适 5000 |
| 艺术餐厅 | ACA | COF 8, OLF 2, VIT 8, DW 10, GL 6.67, DEC 0.67 | 舒适 1000, 文化 1000 |
| 画廊 | ART | MHP 1, HOG 1, UTS 0.67, DEC 0.67 | 文化 2500 |
| VR 剧院 | VRT | POW 1.4, MHP 2, HOG 1.4, OLF 4, BID 0.33, DEC 0.67 | 文化 5000 |
| 行星广播站 | PBH | OFF 10, MHP 1, SP 1.33, AAR 0.67, EDC 0.27, IDC 0.13 | 文化 1000, 教育 1000 |
| 图书馆 | LIB | MHP 1, HOG 1, CD 0.33, DIS 0.33, BID 0.2 | 教育 2500 |
| 大学 | UNI | COF 10, REA 10, TUB 10, BID 0.33, HD 0.67, IDC 0.2 | 教育 5000 |

> 实机 POPID `t-SST` 验证：`DW 0/100`、`OFF 0/100`、`SUN 0/60` 是**当前消耗单次的储备量**，
> 与「每座 1 级、3 种物料、每种 1/3 贡献」的机制一致（SST 安全 2500 × 1/3 每种）。
> 上表数值与实机一致，可直接固化。

### 3.2 建筑中文名（运行时也可从游戏 DOM 读，这里作为兜底）

实机 `POPI VH-192b` 表格顺序与中文名：安全站、安防无人机站、应急中心、医务室、医院、
健康中心、野生动物园、4D游乐中心、艺术餐厅、画廊、VR剧院、行星广播站、图书馆、大学。
（共 14 行可见；oog 表 14 条一致。原 docs/game/planetary-governance.md 写「16 座」，
以实机 14 行为准，TODO 复核是否有 2 座未在列表。）

### 3.3 需求中文标签 & 分层

```
NEEDS = ['LIFE_SUPPORT','SAFETY','HEALTH','COMFORT','CULTURE','EDUCATION']
标签  =  维生 / 安全 / 健康 / 舒适 / 文化 / 教育
TIERS = [[LIFE_SUPPORT],[SAFETY,HEALTH],[COMFORT,CULTURE],[EDUCATION]]
```

### 3.4 五类人口

中文标签复用 `WFOR.vue` 的 `LEVEL_LABELS`（先驱者/定居者/技术员/工程师/科学家）；
类型复用 `PrunApi.WorkforceLevel`（`PIONEER/SETTLER/TECHNICIAN/ENGINEER/SCIENTIST`）。

### 3.5 数据来源标注

固化表文件头统一注释来源 URL + 抓取日期（2026-11-10），与 `plan-housing.ts` /
`notification-catalog.ts` 的现有风格一致。落点建议：`src/features/XIT/GOVH/govh-model.ts`
（若未来跨面板复用再提升到 `src/core/governance-needs.ts`）。

---

## 4. 实机数据源结论（决定实现路径）

### 4.1 关键发现：基建数据走 DOM，不走可订阅的 API store

| 尝试 | 结果 |
|---|---|
| 登录批次 `WORKFORCE_WORKFORCES` | 有，但只有**公司劳动力**（`level/population/reserve/satisfaction/needs`），`NeedCategory` 是 `CLOTHING/FOOD/HEALTH/TOOLS/WATER`，**不是**六类政府需求 |
| `DATA_DATA` path | 公司视图只有 `admincenters / companies / commodityexchanges` 等；**无** `infrastructure` / `populationProject` |
| `POPID` 打开后新增 WS 消息 | 只有 `ACTION_COMPLETED` + 重复的 `WORKFORCE_WORKFORCES` / `PRODUCTION_SITE_PRODUCTION_LINES`；**无**带储备数值的新 DATA_DATA |
| `POPID` Vue 组件 setupState | 取不到（DOM 上无 `__vueParentComponent` 可用字段） |
| `POPID` DOM | ✅ **完整可读**：维护供给表（库存/贡献/下一次消耗/储备/维持）、贡献表、指令 NONE/ALL/贡献 |

**结论**：GOVH 的运行时数据源 = **原生 `POPI <星球>` / `POPID p-<planet> t-<ticker>` 窗口的 DOM**，
用 `showBuffer` 开 hidden 窗口（buffers.ts 的 `autoClose`/`closeWhen` 模式，与换汇/BRA 一致），
读渲染后的表格。这样：
- ✅ 完全本地，不碰 `rest.fnar.net`（游戏自己请求它的 `allplanets` 与我们无关，我们不主动连）
- ✅ 复用游戏已算好的「储备/下一次消耗」，避免重算 30 天消耗周期
- ✅ 与现有 `contribution-bulk-controls.tsx`（观察 `POPID` 注入按钮）的技术路线一致

### 4.2 POPID DOM 结构（实机样例 `POPID p-VH-192b t-SST`）

```
维护供给
┌──────┬──────┬────────────────────┬──────────┬──────────┐
│ 库存 │ 贡献 │ 下一次消耗         │ 储备     │ 维持     │
├──────┼──────┼────────────────────┼──────────┼──────────┤
│ DW   │ 315  │ 0/100 (4天3小时内，每5天)  │ 0/600    │ --       │
│ OFF  │ 850  │ 0/100 (4天3小时内，每5天)  │ 0/600    │ --       │
│ SUN  │ 180  │ 0/60  (4天3小时内，每15天) │ 0/120    │ --       │
└──────┴──────┴────────────────────┴──────────┴──────────┘
[NONE][ALL] 贡献 | [NONE][ALL] 贡献
按贡献者排列的近期贡献：无近期贡献
```

- **下一次消耗**：`<progress value="0" max="100">`，当前值 0、满值 100，是下一次消耗周期内已备料量。
- **储备**：`<progress value="0" max="600">`，当前值 0、满值 600（= 30 天量），是设施内部储备。
- GOVH **只扣这两个 progress 的当前 `value` 之和**；不读「库存」「贡献」，更不读基地仓库。
- **库存 / 贡献**：仓库现有量 / 已捐入量，与本次扣除口径无关。
- 指令区 `NONE / ALL / 贡献` = 玩家补给的入口（GOVH 只读不自动点，见红线）。
- 不带 `t-<ticker>` 的 `POPID p-<planet>` 汇总窗口**没有**维护供给表，必须逐已建建筑打开详情窗口。

### 4.2.1 取数实现避坑（真机踩坑固化）

- `POPID` **必须**写成 `POPID p-<planet> t-<ticker>`。漏掉 `p-` 时游戏不弹错误，而是渲染一个空标题的「无效指令」缓存窗口；
  `withBuffer()` 检测到该文本会立即失败，不再让每座建筑各空等 9 秒超时。
- POPID 的维护供给表**没有** `Population__table` 语义类（POPR / POPI 有）。`populationTables()` 先按 `C.Population.table`
  找，找不到必须回退到原生 `<table>`，再按表头同时含「下一次消耗 / 储备」定位；否则 14 座建筑全部解析失败，面板一直「读取中…」。
- 物料 ticker 依次回退：`C.ColoredIcon.label` → `[class*="ColoredIcon__label"]` → 首格文本前缀（如 `DW315` → `DW`）。
- `showBuffer` 在 `autoClose` 下先释放串行队列再真正关窗。连续开 hidden 窗口时必须等本次新增窗口 `isConnected === false`
  并留 500ms settle，避免把下一条命令派发到正在关闭的旧壳（诊断中观察到空标题窗口）。

### 4.3 上下文约束（复用已修好的政府视图逻辑）

- 用户要求"在公司视图下，以公司身份补给"→ GOVH 面板在**公司视图**打开即可；
  它是 XIT 命令，与公司上下文绑定，不受政府视图 store 缺失影响。
- 星球编码优先取 `useXitParameters()`（如 `XIT GOVH VH-192b`）；留空时面板表头的
  **「我管理的政府」下拉**从游戏本地「视图」菜单预设，无需手输（见 §6.4）。
  账号数据全部**运行时推导，禁止硬编码**（项目红线）。

---

## 5. 计算模型（GOVH 求解流程）

```
输入：星球编码 planet、目标固定 100%（求解器硬编码，不再接受任意 target）、维生预期 lifeSupportAssumption(current / full，默认 full)、
      人口 pop[5]、基地数 siteCount、
      已建造建筑等级 levels[ticker]、当前满足度 fulfillment[6]、当前幸福度 happiness[5]、
      各建筑各物料设施存量 facilityStocks[building][material]
      （人口 / 满足度 / 幸福度来自 `POPR`，等级来自 `POPI`，设施存量来自 `POPID` 详情窗口，
       基地数来自 `sitesStore`；单价来自 `cxobStore`，全部本地）

1. needsNeeded[need]   = Σ_tier pop[tier] × weight[tier][need]
2. rawProvided[need]   = 固定基线 + Σ_building (每级贡献 × 有效等级 × 供给率)
     固定基线：
       - 维生 LIFE_SUPPORT = needsNeeded[LIFE_SUPPORT] × lifeBaseline。
         lifeBaseline 由维生预期派生：按当前 = POPR 当前维生满足度；预计补齐 100% = 1.0（默认）。
         维生由住房 / 星球肥沃度决定，GOVH 基建物料改变不了它；
         不能取 0，否则 2.2 的 4 层封顶会把全部需求误压成 0%。
       - 安全 / 健康各 += 50 × siteCount（玩家自有基地）。
       - 已填满 30 天（下一次消耗 + 储备 ≥ qtyPerDay × 30）的物料始终计入，
         即使不勾选也不重复采购；其 netFillAmount = 0、待补成本 = 0。
     供给率 = 已采购或已填满的物料种类比例（每种物料独立 1/n）
     有效等级 = 当前已建造等级
     ！部分存量的物料按「买满 30 天后贡献 1/n」处理；未买满又未勾选的物料不计入预览。
3. fulfillment[need]   = clamp(rawProvided / needsNeeded, 0, 1) → 再按 2.2 分层封顶
4. 缺口 gap[need]      = max(0, needsNeeded[need] × effectiveTarget − provided[need])
     effectiveTarget = 预计补齐 100% ? target : min(target, lifeBaseline)
     Phase2 冗余剔除用同一组 effectiveTarget / lifeBaseline 判达标
     （历史 bug：曾误用含封顶的 target，维生低于目标时恒 false，待剔除物料被立刻加回）
5. 求解：对每个 (建筑, 物料) 组合，实际等级下的每 credit 贡献
           = (该物料覆盖的各类需求贡献之和 × 有效等级) / 日成本
   - 单价直接复用 BPC/BMAT/CBUY 的 `bp-utils.computeComponents()` /
     `readBuyPrice()`，从 `cxobStore` 实时订单簿取四大交易所最低有量买一价
   - Phase1：按「当前短板需求」的每 credit 贡献降序贪心，直到所有 gap ≤ 0；
     注意性价比要乘回有效等级，且用当前需求而非跨需求合计排序。
   - Phase2：按总性价比从低到高尝试剔除冗余物料，剔除后仍达标才永久移除。
   - 这是沿用 oog `computeCheapestFulfillment` 的**两阶段启发式，不是严格全局最优**；
     零报价物料排最后，已填满存量不进采购清单。若要严格最低一次性采购价，需另做精确搜索。
6. 输出每个 (建筑, 物料) 选项：
   - grossFillAmount = 日耗 × 30（pct 官方 30 天储备口径，毛量）
   - stockTotal = POPID「下一次消耗.value + 储备.value」
   - netFillAmount = max(0, grossFillAmount − stockTotal)（实际待补量）
   - netFillCost = netFillAmount × 单价；日成本 / 幸福度预览仍按持续日耗计算
   - calculation = "30天填充 A − 下一次消耗 B − 储备 C = 待补 D"
7. 预览：调整后重新算 fulfillment（含封顶）与五类人口幸福度，实时显示

单价缺失（订单簿未就绪）时：显示 "—"，并在汇总区提示成本被低估；可点「更新价格」订阅本地订单簿；
**不提供手填覆盖**，绝不回退 FIO / Prunplanner，避免价格口径与 BPC/BMAT/CBUY 分叉。
```

### 与 oog governor-helper 的差异（有意为之）

| oog 网站 | GOVH |
|---|---|
| 只推荐**最低限度**补给 | 列出全部物料 + 自选 |
| 用 PP7d Universe VWAP 价格（外部） | 用本地 `cxobStore` 实时卖一价 |
| 请求 FIO `api.fnar.net`（外部） | 只读游戏 DOM（本地） |
| Web 工具，与游戏割裂 | XIT 面板，直接联动购物车 / CBUY |

---

## 6. 面板设计（`XIT GOVH`）

### 6.1 布局（分区）

```
┌─ XIT GOVH · 管理的政府 [Shardonia b (VH-192b) ▾]  维生预期 [当前 ○ 补齐 ⦿]  [刷新数据] ┐
│ ① 现状：五类人口幸福度卡片（只留等级 + 幸福度，人口数见下方报告明细） │
│    先驱 98.9% │ 定居 20.0% │ 技术 63.2% │ 工程 46.6% │ 科学 20.0% │
│    ┌ 本期人口报告（POPR 原生，无折线图）┐ ┌ 六类需求现状 → 补足后预览 ┐ │
│    │ 项目/先驱/定居/职技工/工程师/科学家 │ │ 需求/需要/现状/预览/提供/封顶│ │
│    │ 人口 变更 移民 教育（增/减）        │ │ 维生/安全/健康/舒适/文化/教育│ │
│    │ 幸福 失业 待聘 + 报告#43/3天13小时前│ │ 原值含 "--"，预览含封顶态   │ │
│    │ 项目：重大行星假期 · 说明…          │ │                            │ │
│    └────────────────────────────────────┘ └────────────────────────────┘ │
│ ② 已建造等级（14 座，来自 POPI）                                │
│ ③ 补给方案：全部物料表（勾选 / 日耗 / 30天填充 / 待补量 / 计算过程 /   │
│              只读单价 / 来源 / 日成本 / 待补成本 / 性价比）           │
│    ☑ 安全站 DW  20/天  600 → 300  30天填充600−下耗100−储备200=待补300│
│ ④ 汇总：日成本 / 待补成本 / 总重体积                             │
│ ⑤ [CBUY 比价]  [复制 JSON]（底部无指向自身的 XIT GOVH 链接）        │
└───────────────────────────────────────────────────────────────┘
```

补给方案表按建筑分组：「建筑」列与「覆盖需求」列同一建筑的物料行都用 `rowspan` 合并为单一单元格；
组首行加 2px 上边框，合并建筑单元格左侧 2px 装饰色条，合并单元格强制透明底色以抵消游戏原生
`!important` 灰底，不再使用交替淡底（R30）。这样 20 行物料表仍保留全部物料，但建筑边界一眼可辨。

### 6.2 UI/主题约定（强制）

- 组件用 `MaterialIcon`（物料图标+数量角标）、`NumberInput`/`SelectInput`/`SearchInput`、
  `ActionBar`、`SectionHeader`、`PrunButton`、`ProgressBar`（复用 `docs/feature-patterns.md` 清单）。
- 主题遵守 `docs/theme-framework.md`：组件规则**禁止裸色值**，一律 `var(--rp-skin-*)`；
  正文 ≥ 11px；涨跌/正负用 `--rp-skin-*` 语义色。实现阶段已按框架 §4/§7 同步台账：
  `--rp-accent-rgb` 仅作装饰色，文字（含新增政府下拉 `<select>`）统一
  `var(--rp-skin-ink, currentColor)`。
- 表格用原生 `<table>`，数字列右对齐靠 `.table .numCell` / `.table .numCol`（R28），
  flex 只放在 `<td>` 内部 wrapper，不直接 `<td display:flex>`。
- 补给方案行按 `UPKEEP_BUILDINGS` 顺序连续生成，`solve()` / `filteredOptions` 只做 filter 保序；
  每行带 `data-govh-col` / `data-govh-building-start` / `data-govh-group`，建筑列与覆盖需求列都在组首 `rowspan` 合并。
  覆盖需求显示该建筑组的需求并集，按 `INFRA_NEEDS` 排序，不含维生。`rowspan` 后非组首行少两个 `<td>`，
  验收必须按列属性定位，**禁止**用 `row.children[表头索引]`（R30）。
- 建筑分组的视觉分隔只落在三处：组首 2px 上边框、合并建筑单元格 2px 左色条、组间上边框；
  **禁止**交替淡底 / 斑马纹。合并单元格会被游戏原生 `!important` 规则刷成灰底
  `rgb(240,240,240)`，必须用 `background-color: transparent !important` 抵消；验收同时断言
  「无正 alpha 底色 + 各组底色一致 + 与普通 td 底色一致」。色条只作装饰，文字仍走
  `var(--rp-skin-ink, currentColor)`，`--rp-accent-rgb` 不作文字色（R02 / R30）。
- 补给方案前四列固定为 `建筑 | 覆盖需求 | 选 | 物料`：两列合并单元格在前，复选框与物料列在后，
  让被染色的列在视觉上连成一片。勾选 / 悬浮染色**只作用于从「选」列向右的 `<td>`**：
  `tr:hover` 用 `rgba(var(--rp-accent-rgb), 0.08) !important`、`tr.rowSelected` 用
  `rgba(var(--rp-accent-rgb), 0.1) !important`；**禁止**把背景挂在 `<tr>` 上——它会透过
  合并单元格的 `transparent !important` 让整块合并区域变色（R30）。e2e 断言选中行非合并
  单元格 alpha 全 0.1、未选中行 0、两列合并单元格前后均无淡底。
- 「覆盖需求」与「选」列之间必须有 2px 竖向边界：表头 `.needsHeader` 与合并单元格
  `.needsCellMerged[rowspan]` 都写 `border-right: 2px solid var(--rp-skin-border-strong, currentColor) !important`，
  原样主题回退 `currentColor`，合并单元格继续 `background-color: transparent !important`（R30 / R02）。
- 表头两块原生 `<select>` 字号统一 `11px`（R09 下限，游戏默认 13.33px 与面板控件不齐）；
  自有基地星球占位文案固定 `选择自有基地星球`，不带星球数量。
- 维生行角标「靠住房，补给无效」不再挂 `title` 浮窗；下方提示写作「维生」需求：宜居星球恒为
  100%，非宜居星球由全星球住房容量决定（容量 ≥ 人口，达到100%）。基建补给无法改善这一项，
  需由该星球入驻玩家自行新建 / 升级住房。文字仍走 `var(--rp-skin-ink, currentColor)`（R02）。
- 单价列只读，不渲染输入框；「计算过程」文本走 `var(--rp-skin-ink, currentColor)`。
- 「本期报告明细 + 六类需求」双栏用 `repeat(auto-fit, minmax(min(100%, 330px), 1fr))`，
  窄面板自动落回单栏，不能用 viewport 媒体查询；表格各自横向滚动，紧凑 padding 走
  `.table.miniTable`（R29）。小标题 / 项目行文字同样走 `--rp-skin-ink`。
- 底部不放指向当前命令的 `PrunLink`：点击会再开一个同样的 GOVH 面板，形成循环。
- 五类人口大卡片只显示「等级 + 幸福度」，**不显示人口数量**：下方 POPR 报告明细「人口」行已有同值，避免重复。
- 快照恢复在 `setup` 阶段同步完成（`restoreFromCache()`），使组件重挂载（切换政府 / 公司视图、重新打开命令）
  首绘即完整，避免「空态 → 读缓存 → 二次重建整表」卡顿；根元素 `data-govh-restored=cache|cold`
  标记首绘来源，`onMounted` 命中缓存时跳过 `refreshData` 重读（价格仍走 `cxobStore` 实时订阅）。

### 6.3 命令注册（改动点，已在架构探查确认）

- 新建 `src/features/XIT/GOVH/`：
  - `GOVH.ts`：`xit.add({ command: 'GOVH', name: '政府基建补给助手', description: ..., bufferSize: [...] })`
  - `GOVH.vue`：主面板（政府下拉、目标、现状、物料表、联动按钮）
  - `govh-model.ts`：固化系数表 + 满足度/封顶/幸福度/求解函数
  - `govh-dom.ts`：打开并读取 `POPR` / `POPI` / 逐建筑 `POPID` DOM 的封装（hidden buffer + closeWhen），
    同时解析 POPR 7 行报告明细、报告编号、需求原值与底部管理方项目
  - `govh-cache.ts`：按星球的 `sessionStorage` 快照缓存（TTL 5 分钟，只存本地 DOM 纯数据），
    切回 / 刷新页面直接复用；「刷新数据」强制绕过并覆写
  - `govh-prices.ts`：复用 BPC `computeComponents()` 读 `cxobStore` 本地订单簿，hidden `CXOB` 按需订阅，
    按 `ticker.exchange` 去重；「更新价格」等待订阅结束后回收提示
  - `govh-governments.ts`：本地「视图」菜单 → 我管理的政府 → 星球编码映射（§6.4）
  - `govh-quote.ts`：`XIT CBUY GOVH` 临时清单 handoff，不写购物车、不落盘
- 改 `src/features/XIT/index.ts`：加一行 `import './GOVH/GOVH';`
- 改 `src/features/XIT/HELP.vue` 的 `categoryMap`：归类到「生产与基地」
- `xit-registry.ts` / `xit-commands.ts` / `useXitParameters` 通用机制直接复用，不改

### 6.4 表头政府下拉的数据源（运行时零外部请求）

用户要求「不用手输星球编码」。实现只拼本地两处已有信息：

1. `userDataStore.contexts` 里 `type === 'GOVERNMENT'` 的 context id
   —— 权限事实源，天然排除公司上下文；
2. 游戏原生顶部「视图」上下文菜单 `[class*="ContextControls__contexts"] a[href*="context="]`
   —— 同一个 context id，内层 `<span>` 文本形如 `Shardonia b (VH-192b)`。

两边按 context id 关联，再用 `planetsStore.getByNaturalId()` 回正 naturalId 大小写，得到
`{ contextId, planet, name, label }`。`govh-governments.ts` 用 `MutationObserver` + `USER_DATA`
跟随菜单/权限变化，并做内容相等比较，避免面板自身 DOM 更新导致刷新回环。

- 命令参数 `XIT GOVH <planet>` 仍然预填；大小写不对时命中政府表会自动回正。
- 留空且列表就绪时自动选中第一个政府并读取；切换政府先查会话缓存，未命中才重读 POPR / POPI / POPID。
- 保留显式「自定义编码…」兜底（默认不显示输入框），输入的编码同样会过一次本地政府表回正。
- 选择「自定义编码…」后优先显示「自有基地星球」下拉：选项只来自本地 `sitesStore` 中基地地址解析出的
  naturalId，并用 `planetsStore.getByNaturalId()` 补显示名 / 回正大小写；游戏约束每个玩家每个星球只能有
  1 座基地，故按 naturalId 去重即可，选项只显示 `星球名 (naturalId)`，**不显示基地数量**，
  占位文案固定 `选择自有基地星球`（同样不带星球数量），下拉字号与政府下拉统一 `11px`（R09），
  也不拉全量星球列表或产生任何外部请求。
- 同区域保留 `TextInput` 手输兜底。`focus-on-mount` 负责第一次聚焦；真人鼠标点原生 `<select>`
  时，游戏 Frame 的全局 click 会在 `nextTick` 单次 focus 后把焦点抢回不可编辑容器，因此再加
  600ms 守护式聚焦（`focusout` + 40ms 轮询），焦点落到不可编辑区域时补回，用户主动切到其它
  `input/textarea/select/button/a[href]/[contenteditable]` 则立即放手。提交后仍走本地政府表回正。

### 6.5 会话缓存与加载耗时

- 每次冷读要依次开 `POPR` + `POPI` + 每个已建建筑的 `POPID` hidden 窗口，VH-192b 实测 ~10s。
  打开 / 切回面板改为先查 `govh-cache.ts` 的 `sessionStorage`（按星球 naturalId 大写建键，TTL 5 分钟）；
  命中即直接渲染，info 行显示「本地缓存（x 分钟前，点「刷新数据」重读）」。
- 「刷新数据」按钮传 `force=true`，绕过并覆写缓存，仍从本地原生窗口重读；不会引入外部请求。
- 价格不进缓存，始终取 `cxobStore` 实时订单簿；`subscribePrices` 按 `ticker.exchange` 去重，
  切回面板不再重复开同一批 hidden `CXOB`。「更新价格」`force=true` 清空去重表重试，
  并 **await** 订阅结束后把「正在…」提示回收为 `本地订单簿已更新：x / y 种物料有实时买一价`。
- 实测（`prun-cdp/govh-verify-cache-timing.mjs`）：冷读 **9520~9805ms**，缓存切回 **12~34ms**，
  强制刷新 **8212~9008ms**（多次实测区间，随现场窗口数浮动）；缓存不牺牲可刷新性。

---

## 7. 联动购物界面（复用现成 handoff）

- **清单 → CBUY**：照 `repair-quote.ts` 的模块内 `shallowRef` 模式新建 `govh-quote.ts`
  （`setGovhQuote` / `govhQuoteRef`），`showBuffer('XIT CBUY GOVH')`；
  `BuyTable.vue` 增加一个清单来源分支（现有：CART / `<星球>` / `REPD` / `GOVH`）。
  清单数量使用 `netFillAmount`，即已扣除政府基建内部存量的待补量。
- **清单 → 购物车**：GOVH 面板不再直接写 `userData.cart`，底部只保留「CBUY 比价」和
  「复制 JSON」；玩家可把 JSON 导入 `XIT CART`，或直接从 CBUY 生成 ACT（不自动下单）。
- **预填原生采购**：如需直达交易所采购，用 `CONTGEN`/`contd-auto-fill` 的
  "写 workspace → showBuffer → 自动填表" 模式（已验证可复用）。
- **价格**：直接调用 `bp-utils.computeComponents()`（内部 `readBuyPrice()` 聚合卖单量、
  跳过 amount≤0 的价位）从 `cxobStore` 取四大交易所最低有量买一价，
  与 BPC/BMAT/CBUY 完全同一口径；GOVH 只开 hidden CXOB 窗口按需拉价，不手填覆盖。

---

## 8. 分阶段实施

| 阶段 | 内容 | 状态 | 验收 |
|---|---|---|---|
| P0 数据层 | `govh-model.ts`：固化 §2/§3 全部表与公式（满足度、分层封顶、幸福度、求解）；基建存量扣除与计算过程；纯函数 + 单测脚本 | ✅ | `test-govh-model.mjs` 30/30，含封顶、幸福度、贪心求解、无人口/无基地边界、净待补量/成本/重量/体积、分建筑独立扣除，以及维生基线 / 已填满免费存量 / 效率量纲 / 100% 维生短板 |
| P1 取数层 | `govh-dom.ts`：hidden `POPR` / `POPI` / 逐建筑 `POPID` 窗口读 DOM，抽五类人口 / 六类满足度 / 14 座建筑等级 / 「下一次消耗 + 储备」存量，以及 POPR 7 行报告明细 / 报告编号 / 需求原值 / 管理方项目；只关自己开的窗口 | ✅ | `govh-verify-dom.mjs` 13/13，VH-192b 读出人口 / 5 类已建基建 / SST 三物料 progress 存量，0 外部请求，玩家既有窗口未被关闭；`govh-diag-loading.mjs` 真实面板约 10 秒读完 POPR + POPI + 5 座 POPID，5 座设施存量全部计入 |
| P2 面板骨架 | `GOVH.ts/vue` 注册 + 现状展示（幸福度/满足度/封顶，人口卡片不再重复「人口」字样）+ 本期 POPR 明细与六类需求左右双栏（无折线图、无自链接）+ 已建造等级 + 政府下拉 | ✅ | 命令能开；公司上下文不混入下拉；下拉选项来自本地「视图」菜单；e2e 断言明细 7 行、双栏 `sameRow`、无 `Population__graph` DOM、无 `XIT GOVH` 自链接 |
| P3 求解与自选 | 目标档、缺口、全部物料表、只读统一单价、待补量 / 计算过程列、勾选实时重算、表格布局修正 | ✅ | 100% 目标 + 维生预期两档（current/full）切换；20 行物料表勾选实时重算；数字列右对齐、`<td>` 不再 flex；单价无手填输入框 |
| P4 联动 | 清单→CBUY / 复制 JSON；底部删除两个购物车按钮；价格走 BPC 同口径本地订单簿 | ✅ | `XIT CBUY GOVH` 显示「比价来源」且数量已扣存量；复制 JSON 通过；零外部价格源请求 |
| P5 打磨 | 主题校验、多宽度、切换政府自动重读、自定义兜底、CHANGELOG | ✅ | `govh-verify-e2e.mjs` **71/71**、`govh-verify-dom.mjs` **13/13**、`verify-govh-theme.mjs` **20/20**（三主题 n=273 个文字节点 0 低对比度 / 0 小字 / 0 opacity）、`test-govh-model.mjs` **26/26**；三主题新增「计算过程 / 只读单价 / 报告明细 / 双栏标题与项目行 / 建筑分组 / 自定义模式下拉」后仍无低对比度 / 小字 / opacity 压淡 |
| P6 加载优化 | 会话级快照缓存、价格订阅去重、「更新价格」提示回收、hidden buffer 等待压缩 | ✅ | `govh-verify-e2e.mjs` 断言首开冷读 / 切回命中缓存 / 「刷新数据」强制重读 / 更新价格提示回收；`govh-verify-cache-timing.mjs` 冷读 9520ms → 缓存切回 **12ms**，强制刷新 8724ms |
| P7 推荐求解修正 | 维生用 POPR 现值作封顶基线；已填满 30 天的物料自动计入且不重复采购；性价比乘回实际等级并按当前短板需求排序；面板标注「贪心近似，非严格全局最优」 | ✅ | `test-govh-model.mjs` 30/30；`govh-verify-e2e.mjs` **71/71** 100% 正确提示维生封顶且预览非 0；三主题 20/20 |
| P8 重挂载首绘完整 | 人口卡片删除重复人口数量；快照恢复从 `onMounted` 前移到 `setup` 同步执行，`data-govh-restored=cache\|cold` 标记首绘来源，命中缓存时 `onMounted` 跳过 `refreshData` | ✅ | `govh-verify-remount.mjs` **8/8**（`force` 新建实例首帧 130ms 即 20 行完整 + `cache` 标记、无冷读、无「0→20 行」二次重建；docked 磁贴 frame + window 同时打标记，消除假失败）；`govh-verify-e2e.mjs` **71/71** 断言人口卡片只 2 行含 %；`govh-verify-cache-timing.mjs` 缓存切回 **12ms**；`verify-govh-theme.mjs` **20/20**（三主题 n=273，0 低对比度 / 0 小字 / 0 opacity） |
| P9 分组可读性与输入聚焦 | `materialRows` 计算建筑组 `rowspan` / `groupIndex`；组间 2px 上边框、建筑列 2px 色条；所有 td 加 `data-govh-col`，e2e 改属性定位；自定义编码输入 `focus-on-mount` | ✅ | `govh-verify-e2e.mjs` **71/71**（5 个建筑组、建筑列 `rowspan` 3/3/5/4/5、组间粗线 / 色条、所有 td 带列属性、选完自定义编码可直接输入 `ZZ-777y`）；`verify-govh-theme.mjs` **20/20**（三主题 n=273，0 低对比度 / 0 小字 / 0 opacity，worstCR 6.11 / 5.63 / 6.18）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`test-govh-model.mjs` 26/26；`node status.mjs` 无残留测试窗口 |
| P10 最终口径收尾 | 覆盖需求列与建筑列同组 `rowspan` 合并；去掉交替淡底，合并单元格用 `background-color: transparent !important` 抵消原生灰底；维生角标去掉 `title`，下方改「维生」需求定稿；自定义模式新增「自有基地星球」下拉（本地 `sitesStore` + `planetsStore`，一星球一基地、不显示数量、不拉全量星球），并补 600ms 守护式聚焦；同步主题规则 R30 / 台账 / 文档 | ✅ | `govh-verify-e2e.mjs` **71/71**（建筑列 + 覆盖需求列 rowspan、无正 alpha 底色、各组底色一致且与普通 td 一致、无浮窗 / 无住房型号、自有基地星球下拉与 `sitesStore` 一一对应、焦点回弹守护、零外部请求）；`verify-govh-theme.mjs` **20/20**（n=273，low=0 / small=0 / faded=0，worstCR 6.11 / 5.63 / 6.18）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`govh-verify-cache-timing.mjs` 冷读 9520ms / 缓存 12ms / 强制 8724ms；`test-govh-model.mjs` 26/26；现场 theme=light / compact=on / 0 残留窗口 / 0 测试标记 |
| P11 表格列顺序 / 选中态 / 边界 / 下拉收尾 | 前四列改 `建筑 / 覆盖需求 / 选 / 物料`；hover / selected 背景从 `<tr>` 下沉到「选」及其后 `<td>`，合并单元格不再变色；「覆盖需求」表头与合并单元格补 2px 右边界；两个 `<select>` 统一 11px、占位去掉星球数量；e2e 补 6 项断言（共 77 项）并加入 APEX 断连归因 | ✅ | 列顺序 / 着色阶段 `govh-verify-e2e.mjs` **74/74**，边界阶段 **75/75**（同期 `verify-govh-theme.mjs` 20/20、`govh-verify-dom.mjs` 13/13、`govh-verify-remount.mjs` 8/8、`govh-verify-cache-timing.mjs` 冷读 9525ms / 缓存 32ms / 强制 8212ms 全绿）；11px / 占位 2 项断言单项 PASS；`vue-tsc` + 完整构建链 + `test-govh-model.mjs` 26/26 通过；服务器恢复后**现场复跑 77/77 全绿**（DOM 13/13、theme 20/20、remount 8/8、cache 冷读 9805ms / 缓存 34ms / 强制 9008ms、0 外部请求 / 0 页面异常 / 0 意外重载、status / residual 正常、现场 theme=light / compact=on 恢复） |
| P12 维生预期两档与预览区收尾 | `govh-model.ts` 新增 `LifeSupportAssumption` 与 `lifeBaseline` / `effectiveTarget` 派生，统一 Phase1 / Phase2 / `allTargetsMet` / 预览 / `achievable`；`NeedState` 拆 `fulfillment` / `displayNow`；`GOVH.vue` 表头新增两档按钮（默认「预计补齐 100%」、肥沃星球禁用）、预览格「当前 XX%」小字、两档成本对照、条件式告警；删「封顶」列，说明区移出右栏改同栅格双列 + 整宽成本行，「XX% 封顶」用 `--rp-skin-danger` 文字色强调 | ✅ | `vue-tsc` + 完整构建链 + `test-govh-model.mjs` **32/32**；`govh-verify-e2e.mjs` **88/88**（零 FAIL 零 WARN，含两档切换 / 双口径 / 成本差额 0 等价 / 5 列表 / 说明区栅格 / 警示色 `rgb(156,59,59)` 且背景透明）；`verify-govh-theme.mjs` **20/20**（三主题 n=275，low=0 / small=0 / faded=0，worstCR 5.63 / 5.05 / 6.18）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`govh-verify-cache-timing.mjs` 冷读 12460ms / 缓存 82ms / 强制 12759ms；status / residual 正常，现场 theme=light / compact=on / 0 残留窗口 |
| P13 顶部控件收敛 | 删除「目标满足度 70% / 100%」，目标固定 100%（`target` 已从求解器移除，硬编码 100%）；维生预期与刷新/更新收成一排，动作按钮包进 `.actions` 且 `margin-left:auto` 靠右；e2e 改 89 项（删 70%↔100% 切换用例，加目标档移除 / 单排控件 / 动作组靠右） | ✅ | `vue-tsc` + 完整构建链 + `test-govh-model.mjs` **30/30**；`govh-verify-e2e.mjs` **89/89** 零 FAIL 零 WARN；`verify-govh-theme.mjs` **20/20**（三主题 n=274）；`govh-verify-dom.mjs` 13/13；`govh-verify-remount.mjs` 8/8；`govh-verify-cache-timing.mjs` 缓存 16 / 40ms、强制 12184 / 19342ms（冷读标记本次未采到）；status / residual 正常 |

---

## 9. 风险与注意事项

1. **DOM 抓取的稳定性**：`POPR`/`POPI` 是游戏原生界面，类名可能随游戏更新变化。
   缓解：用 `C.Population*` / `C.InfrastructureUpkeep*` 等 `prun-css.types.d.ts` 已登记的语义类，
   不写死 hash；POPID 维护表没有 `Population__table` 语义类，必须回退原生 `<table>` 并按表头定位（见 §4.2.1）；
   解析失败给出明确降级提示，不崩。
2. **封顶必须实现**：否则 100% 目标会误导玩家买无用物料（oog 结果里多处 300%+ 被封到 71.8%）。
3. **"下一次消耗 / 储备"存量（实现口径）**：日耗仍按固化 `qtyPerDay × 等级` 计算；
   30 天毛填充量 `grossFillAmount` 必须扣除每个已建建筑 POPID 详情窗口里该物料的
   「下一次消耗.value + 储备.value」得到 `netFillAmount`。不读「库存 / 贡献」，
   不读基地仓库。汇总成本、重量、体积、CBUY 清单与 JSON 全部使用净待补量。
   若所有已建建筑都读不到维护表，取数层直接报错，避免按 0 存量静默超买。
4. **价格来源**：统一调用 `bp-utils.computeComponents()` / `readBuyPrice()` 读 `cxobStore`
   本地订单簿最低有量买一价；无报价显示 "—" 并提示成本被低估，可点「更新价格」订阅；
   **不提供手填覆盖**，绝不回退 FIO/Prunplanner。
5. **不自动补给/下单**：面板只算清单和跳转，实际的「贡献/购买/下单」由玩家确认
   （延续 BRA 批量维修"两次确认"的谨慎原则，且避免误操作）。
6. **14 vs 16 座建筑（已复核）**：旧 `docs/game/planetary-governance.md` 写 16；
   实机 `POPI` 与 oog `infra-data.js` 都是 14 座，GOVH 固化表与本文均按 **14 座**实现。
7. **价格单位（已确认）**：oog 表用 PP7d VWAP（credit/单位）；GOVH 与 BPC/BMAT/CBUY
   一样用本地 `cxobStore` 最低有量买一价，按 1:1 不换算汇率，界面标注来源交易所；
   无报价不手填、不回退外部源。
8. **会话缓存的时效**：`sessionStorage` 快照 TTL 5 分钟，期间基建等级 / 设施存量可能已被玩家改动。
   缓解：info 行始终显示「本地缓存（x 分钟前）」并提示点「刷新数据」；该按钮强制绕过并覆写缓存，
   真实重读本地窗口。价格不进缓存，始终实时取 `cxobStore`。
9. **推荐是启发式，不是严格最优**：求解按当前短板需求贪心 + 冗余剔除，
   目标是「用较低持续日成本达到 100% 的原始需求」，并已扣除设施内部「下一次消耗 + 储备」
   得到一次性待补量。它不保证**严格最低一次性采购价**；存在交叉需求 / 多建筑同物料时，
   理论上可能有更便宜的组合。面板文案已标注「非严格全局最优」，玩家可手动勾选调整；
   若要严格最优需把小规模（≤ 60 个选项）问题改成分支定界 / 整数规划离线求解。
10. **建筑列 / 覆盖需求列 `rowspan` 的视觉与验收口径**：合并后非组首行同时没有「建筑」和「覆盖需求」两个 `<td>`，
    DOM 断言 / 截图定位一律按 `data-govh-col`，**禁止**按 `row.children[表头索引]` 取列（R30）。
    整行交替底色会被游戏原生 td 的不透明背景压掉，并与 hover / 选中态冲突；最终口径是**完全不加底色**，
    只用组首 2px 上边框 + 建筑列 2px 装饰色条区分。游戏原生还会给 `rowspan` 单元格刷 `rgb(240,240,240)` 的
    `!important` 灰底，因此 `.nameCell[rowspan]` / `.needsCellMerged[rowspan]` 必须写
    `background-color: transparent !important`；e2e 同时断言无正 alpha 底色、各组底色一致、与普通 td 底色一致。
    另：前四列固定 `建筑 / 覆盖需求 / 选 / 物料`，染色只落「选」及其后的 `<td>`，**禁止** `<tr>` 级背景；
    「覆盖需求」与「选」列之间 2px 右边界同走 `--rp-skin-border-strong, currentColor`（R30 / R02）。
11. **服务器维护会让 e2e 中途整体失效**：APEX 断连时游戏 SPA 自行 reload，GOVH 面板、所有窗口与
    `window.__govhFrame` 一起清空，后续依赖面板的断言会连锁失败（曾出现 58 pass / 19 fail，
    前 58 项含冷读 / 政府切换 / 缓存命中 / 下拉字号 / 占位全部 PASS）。只读探测可确认：页面正文
    「无法连接到APEX网络」、`navType=reload`、窗口数归零。这**不是**插件或脚本回归；
    `govh-verify-e2e.mjs` 已记录主框架导航次数与 `apexOffline`，命中时输出 WARN 并写进结果 JSON。
    **必须**在服务器恢复后重跑全套真机验收，不要用断连期间的结果判断功能。本次已在恢复后复跑 77/77 全绿，确认无功能回归。
12. **维生预期是假设，不是事实**：`预计补齐 100%` 假定一个人口报告周期内住房会补齐；
    若非宜居星球住房容量长期不足（人口增长快于住房建设）、政府换届或人口结构变化，提前备货会错配。
    缓解：一次性填满的是 30 天储备，物料按日耗持续消耗、不会白买；缓存 TTL 5 分钟可随时刷新取到新维生值；
    面板同时给出两档成本差额与「游戏当前实际显示值」，**禁止**把预测值标成游戏现值。

---

## 10. 参考来源（仅一次性查阅，运行时不请求）

- 需求满足度 / 分层封顶 / 幸福度：<https://pct.fnar.net/population-infrastructure/>
- 物料效率与治理指南：<https://oogcapitalmanagement.com/governing-mats/> 、<https://oogcapitalmanagement.com/posts/good-governance>
- 计算示例（EUU）：<https://oogcapitalmanagement.com/governor-helper/?planet=EUU>
- 固化系数抓取自：`/infra-data.js`（UPKEEP_BUILDINGS / HAPPINESS_WEIGHTS）、`/governor-calc.js`（computeCheapestFulfillment）、抓取日期 2026-11-10。
- 本地架构与实机验证记录：`docs/game/planetary-governance.md`、`prun-cdp/probe-popi-api.mjs`。

> ⚠️ 上述 URL 仅供**开发期一次性查阅**。任何运行时代码不得 `fetch` 这些域名；
> 系数以本仓库固化表为准，与网站后续改版解耦。
