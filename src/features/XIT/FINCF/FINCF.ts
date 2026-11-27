import FINCF from '@src/features/XIT/FINCF/FINCF.vue';

xit.add({
  command: ['FINCF'],
  name: '现金流量表',
  description:
    '按经营/投资/筹资三类汇总现金流水，给出期初、期末与净变动。明细来自游戏下发的最近一段现金流水。',
  contextItems: () => [{ cmd: 'XIT FIN' }, { cmd: 'XIT FINIS' }, { cmd: 'XIT FINBS' }],
  component: () => FINCF,
});
