// 现金流水（BookingType 业务代码）→ 中文名 + 现金流量表三大活动分类。
//
// 代码来自游戏下发的 ACCOUNTING_CASH_BOOKINGS.type；分类按现金流性质判断，
// 不照抄利润表的科目归属（例如「基地设立费」在损益里是费用，但现金流上属于
// 投资活动）。贷款类要看方向：
//   LOAN_PAYOUT_*      付出 = 对外放贷（投资）；收到 = 借入（筹资）
//   LOAN_INSTALLMENT_* 付出 = 还贷（筹资）；收到 = 收回贷款本息（投资）
import type { CashBooking } from '@src/infrastructure/prun-api/data/cash-bookings';

export type CashFlowSection = 'operating' | 'investing' | 'financing';

export interface CashFlowLabel {
  name: string;
  section: CashFlowSection;
  hint?: string;
}

const OPERATING: Record<string, CashFlowLabel> = {
  MATERIAL_SALE: { name: '材料销售收入', section: 'operating' },
  MATERIAL_PURCHASE: { name: '采购材料', section: 'operating' },
  MATERIAL_RECEIVED: { name: '收到材料', section: 'operating' },
  MATERIAL_CONSUMPTION: { name: '消耗材料', section: 'operating' },
  PRODUCTION_FEE: { name: '生产费用', section: 'operating' },
  PRODUCTION_FEE_REFUND: { name: '生产费用退回', section: 'operating' },
  PRODUCTION_FEE_REVENUES: { name: '生产费用收入', section: 'operating' },
  WORKFORCE_FEES: { name: '劳动力费用', section: 'operating' },
  WORKER_SUPPLIES: { name: '劳动力消耗品', section: 'operating' },
  GATEWAY_FEE: { name: '跃迁点通行费', section: 'operating' },
  GATEWAY_FEE_REFUND: { name: '通行费退回', section: 'operating' },
  GATEWAY_FEE_REVENUES: { name: '通行费收入', section: 'operating' },
  LOCAL_MARKET_FEE: { name: '本地市场费', section: 'operating' },
  LOCAL_MARKET_FEE_REVENUES: { name: '本地市场费收入', section: 'operating' },
  WAREHOUSE_FEE_REVENUES: { name: '仓储费收入', section: 'operating' },
  GOVERNMENT_PROGRAM_FEE: { name: '管理方项目费', section: 'operating' },
  GOVERNMENT_PROGRAM_FEE_ROLLBACK: { name: '管理方项目费退回', section: 'operating' },
  // 交易所挂单押金是买卖商品的保证金，随成交结算 → 经营
  COMEX_DEPOSIT: { name: '商品交易所挂单押金', section: 'operating' },
  COMEX_DEPOSIT_REFUND: { name: '挂单押金退回', section: 'operating' },
  COMEX_ORDER_DELETION_FEES: { name: '撤单费', section: 'operating' },
  COMEX_ORDER_DELETION_FEES_ROLLBACK: { name: '撤单费退回', section: 'operating' },
  FOREX_DEPOSIT: { name: '外汇挂单押金', section: 'operating' },
  FOREX_DEPOSIT_REFUND: { name: '外汇押金退回', section: 'operating' },
  FOREX_PURCHASE: { name: '买入外汇', section: 'operating', hint: '换汇，属现金管理' },
  FOREX_SALE: { name: '卖出外汇', section: 'operating', hint: '换汇，属现金管理' },
  CONTRACT_PAYMENT_PAID: { name: '支付合同款', section: 'operating' },
  CONTRACT_PAYMENT_RECEIVED: { name: '收到合同款', section: 'operating' },
  DIRECT_PAYMENT_PAID: { name: '转出资金', section: 'operating' },
  DIRECT_PAYMENT_RECEIVED: { name: '转入资金', section: 'operating' },
};

const INVESTING: Record<string, CashFlowLabel> = {
  PLATFORM_BUILT: { name: '建造基地建筑', section: 'investing' },
  PLATFORM_REMOVED: { name: '拆除基地建筑', section: 'investing' },
  SITE_ESTABLISHMENT_FEE: { name: '基地设立费', section: 'investing' },
  SITE_ESTABLISHMENT_FEE_REVENUES: { name: '基地设立费收入', section: 'investing' },
  REPRESENTATION_CENTER_CONTRIBUTION: { name: 'APEX 代表中心出资', section: 'investing' },
  CORPORATION_FORMATION: { name: '建立集团出资', section: 'investing' },
  CORPORATION_INVESTMENT: { name: '购买集团股份', section: 'investing' },
  CORPORATION_DIVIDEND: { name: '收到集团分红', section: 'investing' },
  INITIAL_MATERIALS: { name: '启动材料', section: 'investing' },
};

const FINANCING: Record<string, CashFlowLabel> = {
  INITIAL_FUNDS: { name: '启动资金', section: 'financing' },
};

// 非现金或只在特殊场景出现的代码：兜底成经营活动，标注原因避免读者误判。
const FALLBACK: CashFlowLabel = { name: '其他', section: 'operating' };

const DIRECTION_SENSITIVE: Record<string, { inflow: CashFlowLabel; outflow: CashFlowLabel }> = {
  LOAN_PAYOUT_PAID: {
    inflow: { name: '借入贷款', section: 'financing' },
    outflow: { name: '对外放贷', section: 'investing' },
  },
  LOAN_PAYOUT_RECEIVED: {
    inflow: { name: '借入贷款', section: 'financing' },
    outflow: { name: '对外放贷', section: 'investing' },
  },
  LOAN_INSTALLMENT_PAID: {
    inflow: { name: '收回贷款本息', section: 'investing' },
    outflow: { name: '偿还贷款本息', section: 'financing' },
  },
  LOAN_INSTALLMENT_RECEIVED: {
    inflow: { name: '收回贷款本息', section: 'investing' },
    outflow: { name: '偿还贷款本息', section: 'financing' },
  },
};

export function classifyBooking(type: string, inflow: boolean): CashFlowLabel {
  const sensitive = DIRECTION_SENSITIVE[type];
  if (sensitive !== undefined) {
    return inflow ? sensitive.inflow : sensitive.outflow;
  }
  return OPERATING[type] ?? INVESTING[type] ?? FINANCING[type] ?? { ...FALLBACK, name: type };
}

export interface CashFlowLine {
  key: string;
  name: string;
  section: CashFlowSection;
  hint?: string;
  /** 按列（本期 → 上期 → 上上期）的净额；该列无该科目数据时是 undefined */
  values: (number | undefined)[];
  total: number;
}

export interface CashFlowResult {
  lines: CashFlowLine[];
  sectionTotals: Record<CashFlowSection, (number | undefined)[]>;
  /** 有明细的期间集合（用于区分「三期里有几期真的有流水」） */
  periodsWithDetail: Set<number>;
  /** 每期的笔数 */
  counts: Map<number, number>;
}

// 把流水按「期间列 × 科目」汇总成本币净额（流入为正、流出为负）。
export function buildCashFlow(bookings: CashBooking[], periodNumbers: number[]): CashFlowResult {
  const columnOf = new Map<number, number>();
  periodNumbers.forEach((p, i) => columnOf.set(p, i));
  const columns = periodNumbers.length;
  const lines = new Map<string, CashFlowLine>();
  const periodsWithDetail = new Set<number>();
  const counts = new Map<number, number>();

  for (const booking of bookings) {
    const column = columnOf.get(booking.period);
    if (column === undefined) {
      continue;
    }
    periodsWithDetail.add(booking.period);
    counts.set(booking.period, (counts.get(booking.period) ?? 0) + 1);
    const label = classifyBooking(booking.type, booking.debit);
    const key = `${label.section}:${label.name}`;
    const line =
      lines.get(key) ??
      ({
        key,
        name: label.name,
        section: label.section,
        hint: label.hint,
        values: Array.from({ length: columns }, () => undefined),
        total: 0,
      } satisfies CashFlowLine);
    const signed = booking.debit ? booking.bookAmount.amount : -booking.bookAmount.amount;
    line.values[column] = (line.values[column] ?? 0) + signed;
    line.total += signed;
    lines.set(key, line);
  }

  const result = [...lines.values()];
  const sectionOrder: CashFlowSection[] = ['operating', 'investing', 'financing'];
  result.sort((a, b) => {
    const bySection = sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section);
    if (bySection !== 0) {
      return bySection;
    }
    return Math.abs(b.total) - Math.abs(a.total);
  });

  const sectionTotals = {
    operating: Array.from({ length: columns }, () => undefined as number | undefined),
    investing: Array.from({ length: columns }, () => undefined as number | undefined),
    financing: Array.from({ length: columns }, () => undefined as number | undefined),
  };
  for (const line of result) {
    for (let i = 0; i < columns; i++) {
      const value = line.values[i];
      if (value === undefined) {
        continue;
      }
      sectionTotals[line.section][i] = (sectionTotals[line.section][i] ?? 0) + value;
    }
  }
  return { lines: result, sectionTotals, periodsWithDetail, counts };
}
