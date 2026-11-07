import FB from '@src/features/XIT/FB/FB.vue';

xit.add({
  command: ['FB', 'BASES'],
  name: '基地总览',
  description:
    '一屏管理全部基地：FLEET 基地列表 + BS 概况 + INV 仓库 + BURN 消耗品 + FLT 舰队 + SHPI 舰船货舱。子磁贴由本命令自行开齐，新建缓存窗口输入 XIT FB 即可完整显示，也可固定成游戏内标签页。',
  bufferSize: [1500, 900],
  component: () => FB,
});
