// MV3 后台服务工作者：把一个游戏标签页标记成「不要丢弃」。
//
// 手机浏览器在后台会先冻结标签页，内存紧张时直接丢弃——丢弃等于销毁整个页面，
// 切回来就是从零重载游戏（桌面内存充足，所以看不到这个现象）。Chromium 只给
// 扩展暴露了这一个相关开关：tabs.autoDiscardable。设为 false 后，浏览器自身的
// 丢弃策略会跳过这个标签页。
//
// 这个文件放在 public/ 下直接进 dist：它没有依赖，也避免给内容脚本那份 IIFE
// 构建加第二个入口（Rollup 的 IIFE 输出不支持多入口）。
const KEEP_ALIVE_MESSAGE = 'rp-keep-alive';

function markKeepAlive(tabId) {
  try {
    // MV3 返回 Promise，旧实现返回 undefined；两种都不能让异常冒到控制台。
    const result = chrome.tabs.update(tabId, { autoDiscardable: false });
    if (result && typeof result.catch === 'function') {
      result.catch(() => undefined);
    }
  } catch {
    // 浏览器不支持 autoDiscardable 时忽略：这是尽力而为的优化。
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== KEEP_ALIVE_MESSAGE) {
    return;
  }
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') {
    return;
  }
  markKeepAlive(tabId);
});
