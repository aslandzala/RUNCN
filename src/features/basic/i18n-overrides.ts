import { userData } from '@src/store/user-data';
import { watch } from 'vue';

// 游戏原生汉化的术语修正。
//
// 做法：直接改 window.PrUn_i18n 里的词条。实测（点开 CONTD 的「选择模板」弹窗）
// 游戏是**渲染时**读这张表，不是启动时拍快照，所以改完新渲染的界面立刻生效。
// 时机：本模块由 refined-prun.ts 在 infrastructure/shell 之前导入，而 shell 里的
// deserialize-prun-app 才是把游戏脚本挂回去的地方，因此这里的 defineProperty
// 一定早于游戏给 window.PrUn_i18n 赋值。
//
// 两条约束：
//  1. 只就地改 entry.value，不替换整个对象 —— 游戏可能缓存了对象引用；
//  2. 软覆盖：当前值必须与预期旧译完全一致才替换。游戏改文案 / 换语言后不匹配
//     就跳过，最坏只是不生效，不会把正确文案改成旧译文。

interface I18nEntry {
  type: number;
  value: string;
}

interface Override {
  key: string;
  /** 当前（错误的）译文，用于软匹配 */
  from: string;
  /** 建议译文 */
  to: string;
}

// 条目按「贷款模板 → 身份 → 条件 / 流水口径」，与 loan-i18n-review.md 的 P1/P2 对应。
const OVERRIDES: Override[] = [
  // ── 贷款模板字段：两处「利率」实际是本金比例，「期限」实际是期数 ──
  { key: 'TemplateSelectionLoanStable.label.repaymentRate', from: '还款利率', to: '每期还本比例' },
  { key: 'TemplateSelectionLoanAnnuity.label.repayment', from: '初始还款利率', to: '首期还本比例' },
  { key: 'TemplateSelectionLoanInterest.label.duration', from: '期限', to: '还款期数' },
  {
    key: 'TemplateSelectionLoanInterest.label.installments.info',
    from: '定义贷款在全额还清之前应分期付款多少次',
    to: '还清之前一共分多少期还款；期数 × 间隔 = 贷款总时长',
  },
  { key: 'TemplateSelectionLoanStable.label.interval', from: '间隔', to: '还款间隔（天）' },
  { key: 'TemplateSelectionLoanAnnuity.label.interval', from: '间隔', to: '还款间隔（天）' },
  { key: 'TemplateSelectionLoanInterest.label.interval', from: '间隔', to: '还款间隔（天）' },
  {
    key: 'TemplateSelectionLoanStable.label.interval.info',
    from: '指定分期付款之间的天数',
    to: '相邻两期还款之间相隔的天数',
  },
  {
    key: 'TemplateSelectionLoanAnnuity.label.interval.info',
    from: '指定分期付款之间的天数',
    to: '相邻两期还款之间相隔的天数',
  },
  {
    key: 'TemplateSelectionLoanInterest.label.interval.info',
    from: '指定分期付款之间的天数',
    to: '相邻两期还款之间相隔的天数',
  },

  // ── 三种模板说明：补上「等额本金 / 等额本息 / 先息后本」这层对应 ──
  {
    key: 'TemplateType.LOAN_STABLE_DESC',
    from: '还款金额固定、利息递减的贷款合同',
    to: '每期偿还的本金固定、利息随剩余本金递减的贷款合同（等额本金）',
  },
  {
    key: 'TemplateType.LOAN_ANNUITY_DESC',
    from: '固定分期付款的贷款合同',
    to: '每期还款总额固定（等额本息）：利息逐期减少、本金逐期增加',
  },
  {
    key: 'TemplateType.LOAN_INTEREST_DESC',
    from: '分期付款仅由利息组成的贷款合同。最后一期付款需全额偿还。',
    to: '每期只支付利息，最后一期一次性偿还全部本金的贷款合同（先息后本）',
  },

  // ── 身份：中文「贷款」作动词常指借入，「贷款方」两边都能读通 ──
  { key: 'Role.BORROWER', from: '借款方', to: '借入方' },
  { key: 'Role.LENDER', from: '贷款方', to: '出借方' },

  // ── 条件 / 流水：payout 是放款不是还款，installment 那一栏是本金 ──
  { key: 'ConditionType.CONDITION_LOAN_PAYOUT', from: '贷款偿还', to: '贷款发放' },
  { key: 'BookingType.LOAN_PAYOUT_PAID', from: '已还清贷款', to: '已发放贷款' },
  { key: 'BookingType.LOAN_PAYOUT_RECEIVED', from: '已收回贷款', to: '已收到贷款' },
  { key: 'ConditionType.CONDITION_LOAN_INSTALLMENT', from: '贷款分期款项', to: '分期还款' },
  { key: 'ConditionText.loanInstallment', from: '支付分期款项：利息', to: '支付分期还款：利息' },
  { key: 'ConditionText.loanInstallment', from: '，还款', to: '，本金' },
  { key: 'BookingType.LOAN_INSTALLMENT_PAID', from: '已支付贷款分期款项', to: '已支付分期还款' },
  {
    key: 'BookingType.LOAN_INSTALLMENT_RECEIVED',
    from: '已收到贷款分期款项',
    to: '已收到分期还款',
  },

  // ── 会计口径 ──
  { key: 'AccountType.INTEREST_INCOME', from: '利息营收', to: '利息收入' },
  { key: 'TemplateSelection.label.totalInterest', from: '总利息额', to: '利息总额' },

  // ── 财务报表（BAL / FIN）分类与科目 ──
  // EQUITY 是资产负债表右下角的权益，不是资产合计；游戏把它译成「总资产」，
  // 与真正的总资产（总资产 = 资产合计）撞名。FINBS / FINCH 里一直叫「权益」。
  { key: 'AccountCategory.EQUITY', from: '总资产', to: '权益' },
  { key: 'AccountCategory.REVENUE', from: '营收', to: '收入' },
  { key: 'AccountType.REVENUE', from: '一般营收', to: '其他收入' },
  { key: 'AccountType.EXTRAORDINARY_INCOME', from: '非常规营收', to: '非常规收入' },
  { key: 'AccountType.DIVIDEND_INCOME', from: '股息', to: '股息收入' },
  { key: 'AccountType.CASH_ESCROW', from: '押金（', to: '托管资金（' },
  { key: 'AccountType.WORKER_SUPPLIES', from: '工人供给', to: '劳动力消耗品' },
  { key: 'AccountType.FOREX_FLUCTUATION_EXPENSE', from: '货币波动', to: '汇率波动损失' },
  { key: 'AccountType.FOREX_FLUCTUATION_REVENUE', from: '货币波动', to: '汇率波动收益' },
  // TAXES 是税、FEE 是费，游戏把税科目也译成「费用」，与 BookingType 的费撞名。
  { key: 'AccountType.SITE_ESTABLISHMENT_TAXES', from: '基地建立费用', to: '基地设立税' },

  // 各类「供应 / 供给」实为出资（contribution），供应是方向读反了。
  { key: 'AccountType.COMPANY_HEADQUARTER_CONTRIBUTIONS', from: '公司总部供应', to: '总部出资' },
  {
    key: 'AccountType.CORPORATION_PROJECT_CONTRIBUTIONS',
    from: '集团项目供应',
    to: '集团项目出资',
  },
  { key: 'AccountType.PLANETARY_PROJECT_CONTRIBUTIONS', from: '行星项目供给', to: '行星项目出资' },
  {
    key: 'AccountType.REPRESENTATION_CENTER_CONTRIBUTIONS',
    from: 'APEX代表中心供给',
    to: 'APEX 代表中心出资',
  },

  // 收入类科目统一「～收入」，与「利息收入」同一口径（原来是「～营收」）。
  { key: 'AccountType.GATEWAY_FEE_REVENUES', from: '跃迁点收费营收', to: '跃迁点收费收入' },
  { key: 'AccountType.LOCAL_MARKET_FEE_REVENUE', from: '本地市场费用营收', to: '本地市场费用收入' },
  { key: 'AccountType.PRODUCTION_FEE_REVENUE', from: '生产费用营收', to: '生产费用收入' },
  { key: 'AccountType.TRANSPORT_REVENUE', from: '运输营收', to: '运输收入' },
  { key: 'AccountType.CONTRIBUTION_REVENUE', from: '货币贡献营收', to: '货币贡献收入' },
  // 「仓储费用收入」读起来自相矛盾（费用是支出），实际是收到的仓储费。
  { key: 'AccountType.WAREHOUSE_FEE_REVENUE', from: '仓储费用营收', to: '仓储费收入' },
  {
    key: 'AccountType.SITE_ESTABLISHMENT_TAXES_REVENUE',
    from: '基地建立费用营收',
    to: '基地设立税收入',
  },

  // ── 现金流水的科目名 ──
  // WORKFORCE_FEES 与仓储费重复（直接抄了上一行），实际是劳动力费用。
  { key: 'BookingType.WORKFORCE_FEES', from: '仓储费用', to: '劳动力费用' },
  { key: 'BookingType.WORKER_SUPPLIES', from: '生产力消耗的供给品', to: '劳动力消耗品' },
  { key: 'BookingType.GATEWAY_FEE_REVENUES', from: '来自跃迁点费用的营收', to: '跃迁点费用收入' },
  {
    key: 'BookingType.LOCAL_MARKET_FEE_REVENUES',
    from: '来自本地市场费用的营收',
    to: '本地市场费用收入',
  },
  { key: 'BookingType.PRODUCTION_FEE_REVENUES', from: '来自生产费用的营收', to: '生产费用收入' },
  {
    key: 'BookingType.SITE_ESTABLISHMENT_FEE_REVENUES',
    from: '来自基地建立费用的营收',
    to: '基地建立费用收入',
  },
  { key: 'BookingType.WAREHOUSE_FEE_REVENUES', from: '来自仓储费用的营收', to: '仓储费收入' },
  // FIN 记账时间列写成了「预定于」（像"计划在某时"），实际是这笔流水的入账时间。
  { key: 'CashBookings.time', from: '预定于', to: '记账时间' },

  // ── 利润表里几个看不出含义的科目 ──
  // 「材料售出」是动作名，和现金流水「已售卖材料」同源，容易当成同一笔记录；它是收入科目。
  { key: 'AccountType.MATERIAL_SALE_REVENUE', from: '材料售出', to: '材料销售收入' },
  // 「一般支出 / 一般收入」的"一般"没界定范围，实际是其他科目之外的兜底项。
  { key: 'AccountType.EXPENSE', from: '一般支出', to: '其他支出' },
  // 「合同核销」是行话：合同签订时就挂了一笔应收/应付，终止后只能在账面上冲平，
  // 没有现金进出，也不该有对应收入。改成"冲账"，避免被读成真的亏了一笔钱。
  { key: 'AccountType.CONTRACT_WRITE_OFF', from: '合同核销', to: '合同作废冲账' },
  // 「交易费用」没说清是哪类交易的手续费。
  { key: 'AccountType.TRANSACTION_FEES', from: '交易费用', to: '交易手续费' },

  // ── 经济概览 / 三张报表的标题与期间列 ──
  // 概览里的 equity 指标同样被译成「总资产」，与真正的总资产并排显示两个「总资产」。
  { key: 'FinanceOverviewPanel.indicators.equity', from: '总资产', to: '权益' },
  { key: 'FinanceOverviewPanel.indicators.revenue', from: '营收', to: '收入' },
  // 「财务报表」是泛称，这张表其实是资产负债表；收入表按常用叫法改成利润表。
  { key: 'BalanceStatementPanel.title', from: '财务报表', to: '资产负债表' },
  { key: 'IncomeStatementPanel.title', from: '收入报表', to: '利润表' },
  // 「上一周期 / 前一周期」在中文里分不出先后，按「本期 / 上期 / 上上期」排列。
  { key: 'BalanceStatementPanel.period.current', from: '当前周期', to: '本期' },
  { key: 'BalanceStatementPanel.period.last', from: '上一周期', to: '上期' },
  { key: 'BalanceStatementPanel.period.previous', from: '前一周期', to: '上上期' },
  { key: 'IncomeStatementPanel.period.current', from: '当前周期', to: '本期' },
  { key: 'IncomeStatementPanel.period.last', from: '上一周期', to: '上期' },
  { key: 'IncomeStatementPanel.period.previous', from: '前一周期', to: '上上期' },
];

/** 已改过的词条，停用时逐条还原。 */
const applied: { entry: I18nEntry; original: string }[] = [];
let current: Record<string, I18nEntry[] | undefined> | undefined;
let enabled = true;
let unmatchedKeys: string[] = [];

function patch(dict: Record<string, I18nEntry[] | undefined>) {
  unmatchedKeys = [];
  for (const override of OVERRIDES) {
    const entries = dict[override.key];
    if (!Array.isArray(entries)) {
      unmatchedKeys.push(override.key);
      continue;
    }
    let hit = false;
    for (const entry of entries) {
      if (typeof entry?.value !== 'string' || entry.value !== override.from) {
        continue;
      }
      if (!applied.some(x => x.entry === entry)) {
        applied.push({ entry, original: entry.value });
      }
      entry.value = override.to;
      hit = true;
    }
    if (!hit) {
      unmatchedKeys.push(`${override.key}（未匹配到「${override.from}」）`);
    }
  }
  if (import.meta.env.DEV && unmatchedKeys.length > 0) {
    console.warn('[i18n] 以下词条未按预期命中，可能游戏已更新文案：\n' + unmatchedKeys.join('\n'));
  }
}

function revert() {
  for (const { entry, original } of applied) {
    entry.value = original;
  }
  applied.length = 0;
}

function apply(dict: Record<string, I18nEntry[] | undefined> | undefined) {
  if (dict === undefined) {
    return;
  }
  if (enabled) {
    patch(dict);
  } else {
    revert();
  }
}

/** 供设置页开关调用；关闭时把已改的词条还原。 */
export function setI18nOverridesEnabled(value: boolean) {
  if (enabled === value) {
    return;
  }
  enabled = value;
  apply(current);
}

function install() {
  const target = window as unknown as Record<string, unknown>;
  const existing = target.PrUn_i18n as Record<string, I18nEntry[] | undefined> | undefined;
  try {
    Object.defineProperty(window, 'PrUn_i18n', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: Record<string, I18nEntry[] | undefined>) => {
        current = value;
        apply(value);
      },
    });
    // 已经被赋值过（本模块导入偏晚）时补打一次。
    if (existing !== undefined) {
      current = existing;
      apply(existing);
    }
  } catch (error) {
    // 属性不可改写时的兜底：轮询到表出现再就地改（晚于首屏渲染，需要重绘才生效）。
    console.warn('[i18n] 无法挂钩 PrUn_i18n，改用轮询', error);
    const timer = window.setInterval(() => {
      const dict = target.PrUn_i18n as Record<string, I18nEntry[] | undefined> | undefined;
      if (dict === undefined) {
        return;
      }
      window.clearInterval(timer);
      current = dict;
      apply(dict);
    }, 200);
  }
}

install();

// 设置默认开启；老存档没有这个字段时保持开启（store 里初始化时已补默认值）。
watch(
  () => userData.settings.i18nFix,
  value => setI18nOverridesEnabled(value ?? true),
  { immediate: true },
);
