// 注册 XIT CBUY 命令（购物车购买表 / BURN 采购比价）。
import BuyTable from '@src/features/XIT/CART/BuyTable.vue';

xit.add({
  command: 'CBUY',
  name: parameters => (parameters[0] ? `采购比价 - ${parameters[0]}` : '购物车购买表'),
  description:
    '默认读取 XIT CART 购物车清单，统计各 CX 交易所买入价并给出最优混合采购成本；带星球编码时（XIT CBUY <星球>）改用该星球 XIT BURN 的「需要」列临时比价，不改动购物车。',
  optionalParameters: '星球编码（BURN 比价）；留空则使用 XIT CART 购物车',
  contextItems: () => [{ cmd: 'XIT CART' }],
  component: () => BuyTable,
});
