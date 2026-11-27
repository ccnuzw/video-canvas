/**
 * 剪辑台「全屏」偏好：全屏 = 剪辑台铺满浏览器窗口（盖住工作区顶栏和分集栏）。
 * 不用浏览器原生全屏：编辑器的菜单、弹层和提示都挂在 body 上，原生全屏时全屏元素以外的东西不显示。
 * 偏好按浏览器记住；存储不可用（隐私模式、被禁用）时当作没开，不报错。
 */

/** 存偏好用的键 */
const KEY = "drama-final-fullscreen";

/** 读写偏好用到的存储（默认 localStorage，测试可替换） */
type FullscreenStorage = Pick<Storage, "getItem" | "setItem">;

/** 当前环境的 localStorage；拿不到为 null */
function defaultStorage(): FullscreenStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读「上次是否全屏」
 * @param storage 存储，默认 localStorage
 * @returns 上次是全屏为 true；没存过或读不到为 false
 */
export function readFullscreen(storage: FullscreenStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 记住是否全屏；存储不可用时静默放弃
 * @param on 是否全屏
 * @param storage 存储，默认 localStorage
 */
export function writeFullscreen(
  on: boolean,
  storage: FullscreenStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 存不下就只在本次有效 */
  }
}
