// XIT GOVH 的本地价格源：只读游戏订单簿 cxobStore 的实时买一价，零外部请求。
// 与 BPC/BMAT/CBUY 完全同一套机制：直接复用 bp-utils.computeComponents()
// （内部 readBuyPrice 聚合同价位挂单量、跳过 amount<=0 的价位），从 bestPrice /
// bestExchange 取全市场最低有量价。无报价返回 undefined，由面板显示「—」；
// 不提供手填覆盖，不回退 FIO / Prunplanner。

import { cxobStore } from '@src/infrastructure/prun-api/data/cxob';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';
import { sleep } from '@src/utils/sleep';
import {
  computeComponents,
  type BpcExchange,
  type BpcMaterialNeed,
} from '@src/features/XIT/BPC/bp-utils';

// 与 BPC/BMAT/CBUY 一致的 4 个玩家 CX 交易所。
export const GOVH_EXCHANGES: BpcExchange[] = [
  { code: 'AI1', currency: 'AIC' },
  { code: 'CI1', currency: 'CIS' },
  { code: 'IC1', currency: 'ICA' },
  { code: 'NC1', currency: 'NCC' },
];

export interface GovhPrice {
  price: number;
  exchange: string;
}

// 读取全部物料的全市场最低有量价（1:1 口径，不换算汇率）。
// 价格口径由 BPC 的 computeComponents / readBuyPrice 唯一决定，GOVH 只做映射。
export function readPrices(tickers: readonly string[]): Record<string, GovhPrice> {
  const needs: BpcMaterialNeed[] = tickers.map(ticker => ({
    ticker,
    name: ticker,
    amount: 1,
  }));
  const components = computeComponents(needs, GOVH_EXCHANGES);
  const result: Record<string, GovhPrice> = {};
  for (const component of components) {
    if (
      component.bestPrice !== undefined &&
      component.bestPrice > 0 &&
      component.bestExchange !== undefined
    ) {
      result[component.ticker] = {
        price: component.bestPrice,
        exchange: component.bestExchange,
      };
    }
  }
  return result;
}

// 已投递过的 CXOB 订阅，避免切回面板 / 命中快照缓存时重复开同一批 hidden 窗口。
const subscribed = new Set<string>();

// 为缺失报价的物料订阅本地订单簿（hidden 窗口，数据到达自动关闭）。
// 分批推入 showBuffer 串行队列，避免几十个请求堵住玩家手动开的窗口。
// force=true（「更新价格」）清空去重表重新订阅，给无报价的物料一次重试机会。
export async function subscribePrices(
  tickers: readonly string[],
  isReady: (ticker: string) => boolean,
  isDisposed: () => boolean,
  force = false,
): Promise<void> {
  if (force) {
    subscribed.clear();
  }
  const pending = tickers.filter(ticker => !isReady(ticker));
  for (let i = 0; i < pending.length && !isDisposed(); i += 6) {
    for (const ticker of pending.slice(i, i + 6)) {
      // 4 个交易所各开一个 hidden CXOB；任一有报价即可。
      // 循环内复查：同批更早的订阅可能已经把该物料的价格推到 cxobStore，
      // 不必再为它开剩下 3 个交易所窗口。
      for (const exchange of GOVH_EXCHANGES) {
        if (isReady(ticker)) {
          break;
        }
        const key = `${ticker}.${exchange.code}`;
        if (subscribed.has(key)) {
          continue;
        }
        subscribed.add(key);
        void showBuffer(`CXOB ${key}`, {
          autoClose: true,
          closeWhen: computed(() => cxobStore.getByTicker(key) !== undefined),
        });
      }
    }
    await sleep(600);
  }
}
