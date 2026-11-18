// 窄屏判定的唯一出处：mobile-layout 与 mobile-tiles 必须用同一套条件，
// 否则会出现「样式进了移动布局、磁贴还在分屏」这种半截状态。

// 主流手机竖屏 360–430px、横屏 780–930px。820px 收口：竖屏全进移动布局，
// 横屏只有较窄机型进入，横向空间够时仍保留桌面多窗口。
// 触屏设备另兜一条：手机横屏宽度可能超过 820（如 844），但高度只有 390，
// 仍应走移动布局；桌面触屏笔记本的主指针是鼠标（fine），不会命中。
export const MOBILE_QUERY = '(max-width: 820px), (pointer: coarse) and (max-height: 900px)';

const HANDHELD_UA = /Android|iPhone|iPod|Windows Phone|HarmonyOS|Mobile/i;

// 触屏或手机 UA：用来决定要不要先修正视口。
export function isTouchDevice(): boolean {
  if (window.matchMedia('(pointer: coarse)').matches) {
    return true;
  }
  return HANDHELD_UA.test(navigator.userAgent);
}

// 浏览器开了「桌面版网站」时，viewport meta 会被忽略、布局视口停在 980，
// 光看 innerWidth 永远判不到窄屏。screen 尺寸不受布局视口影响，可以拿来做兜底。
export function isMobileLayout(): boolean {
  if (window.matchMedia(MOBILE_QUERY).matches) {
    return true;
  }
  if (!isTouchDevice()) {
    return false;
  }
  return Math.min(window.screen.width, window.screen.height) <= 820;
}
