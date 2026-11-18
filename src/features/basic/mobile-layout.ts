import $style from './mobile-layout.module.css';
import { MOBILE_QUERY, isMobileLayout, isTouchDevice } from './mobile-query';

const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover';

// 手机浏览器没有 viewport 时按 980px 虚拟视口渲染再整体缩小，字会小到看不清。
// 触屏设备先无条件校正一次：桌面版网站模式下 ignore 了 meta，innerWidth 会一直是 980。
function ensureViewport() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta === null) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.append(meta);
  }
  if (meta.content !== VIEWPORT_CONTENT) {
    meta.content = VIEWPORT_CONTENT;
  }
}

function init() {
  const media = window.matchMedia(MOBILE_QUERY);
  const touch = isTouchDevice();

  // 移动端样式整组以 html 上的类为前缀：功能被禁用时 init 不执行、类不会出现，
  // 样式自然全部失效，不需要额外卸载逻辑。
  function apply() {
    const isMobile = isMobileLayout();
    document.documentElement.classList.toggle($style.mobile, isMobile);
    if (isMobile) {
      ensureViewport();
    }
  }

  if (touch) {
    ensureViewport();
  }
  apply();
  // media 变化只是重新算一次的时机；真正的判定统一走 isMobileLayout，
  // 这样视口被撑到 980 的浏览器也能靠屏幕尺寸兜住。
  media.addEventListener('change', apply);
  window.addEventListener('resize', apply);
  if (touch) {
    // 修正视口后浏览器要重排，宽度可能才变成设备宽度。
    requestAnimationFrame(apply);
    window.addEventListener('load', apply);
  }
}

features.add(import.meta.url, init, '手机窄屏适配：修正视口并把点击热区放大到适合触控。');
