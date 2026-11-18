import { isMobileLayout } from './mobile-query';

// 浏览器开「桌面版网站」时 viewport meta 不生效，游戏顶部那排屏幕标签
// （`<a href="#screen=…">`）轻点常常没反应：浏览器把轻点当成双击缩放的第一次，
// 手指稍微动一下就判成滚动，click 被丢掉。长按「在新标签页打开链接」却有效，
// 说明 hash 导航本身是通的。这里在触摸抬起时补一次导航。
const MOVE_THRESHOLD = 12;

let startX = 0;
let startY = 0;
let moved = false;

function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  if (touch === undefined) {
    return;
  }
  startX = touch.clientX;
  startY = touch.clientY;
  moved = false;
}

function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (touch === undefined) {
    return;
  }
  if (
    Math.abs(touch.clientX - startX) > MOVE_THRESHOLD ||
    Math.abs(touch.clientY - startY) > MOVE_THRESHOLD
  ) {
    moved = true;
  }
}

function onTouchEnd(event: TouchEvent) {
  // 滑动过去的不算点击，否则左右滑标签栏时松手就会跳到别的屏幕。
  if (moved || !isMobileLayout()) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
  if (link === null) {
    return;
  }
  const hash = link.getAttribute('href');
  if (hash === null || hash.length < 2) {
    return;
  }
  // 游戏自己已经处理过（阻止默认行为）就不重复导航。
  if (event.defaultPrevented) {
    return;
  }
  if (window.location.hash === hash) {
    return;
  }
  window.location.hash = hash;
}

function init() {
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { capture: true });
}

features.add(
  import.meta.url,
  init,
  '手机窄屏：游戏顶部屏幕标签轻点即切换（桌面版网站模式下原生点击会失效）。',
);
