/**
 * 成片剪辑台的新手引导：步骤表和「是否看过」的读写（设计：docs/design/成片粗剪 第 15 节）。
 * 页面元素用 `data-tour="<target>"` 标出，引导按顺序高亮；只读时跳过要编辑权限的步骤。
 */

/** 引导能高亮的页面区域 */
export type TourTarget = "media" | "main-track" | "tracks" | "edit-tools" | "preview" | "export";

/** 气泡出现在目标的哪一侧（driver.js 放不下时自己翻转） */
export type TourSide = "top" | "right" | "bottom" | "left";

/** 引导的一步 */
export interface TourStep {
  target: TourTarget;
  title: string;
  text: string;
  /** 只有能编辑时才讲 */
  edit: boolean;
  side: TourSide;
}

/** 存「看过哪一版引导」用的键 */
const KEY = "vc.drama-final-tour";

/** 引导版本：步骤大改时加 1，所有人会再看一遍 */
const VERSION = "1";

/** 主流程 6 步：素材 → 主轨 → 其他轨道 → 剪辑 → 预览 → 导出 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: "media",
    title: "素材",
    text: "片场采用的片段、画布里的素材和导入的文件都在这里。",
    edit: false,
    side: "right",
  },
  {
    target: "main-track",
    title: "拖到主轨",
    text: "把素材拖进主轨，片段会首尾相接排好。斜纹块是片场还没采用的片段。",
    edit: true,
    side: "top",
  },
  {
    target: "tracks",
    title: "叠加、字幕和声音",
    text: "主轨上下的轨道放叠加画面、字幕、配音和 BGM，可以摆在任意时间点。",
    edit: true,
    side: "right",
  },
  {
    target: "edit-tools",
    title: "剪辑",
    text: "把播放头放到要剪的位置，再点剪刀拆分。按 Q 或 W 可以裁掉播放头的一侧。",
    edit: true,
    side: "bottom",
  },
  {
    target: "preview",
    title: "预览",
    text: "按时间线实时播放，空格键播放或暂停。",
    edit: false,
    side: "left",
  },
  {
    target: "export",
    title: "导出",
    text: "按时间线合成 mp4 并下载，不扣积分。",
    edit: false,
    side: "bottom",
  },
];

/**
 * 这一次要走的步骤
 * @param readOnly 只读时跳过要编辑权限的步骤
 * @param present 目标是否在页面上；不在的步骤跳过
 */
export function tourSteps(readOnly: boolean, present: (target: TourTarget) => boolean) {
  return TOUR_STEPS.filter((step) => (!step.edit || !readOnly) && present(step.target));
}

/** 读写「看过」用到的存储（默认 localStorage，测试可替换） */
type TourStorage = Pick<Storage, "getItem" | "setItem">;

/** 当前环境的 localStorage；拿不到为 null */
function defaultStorage(): TourStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 是否看过当前版本的引导
 * @returns 存储不可用（隐私模式、被禁用）时也为 true：记不住就别每次进来都弹
 */
export function tourSeen(storage: TourStorage | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(KEY) === VERSION;
  } catch {
    return true;
  }
}

/** 记下看过当前版本的引导；写不进去就算了 */
export function markTourSeen(storage: TourStorage | null = defaultStorage()) {
  try {
    storage?.setItem(KEY, VERSION);
  } catch {
    // 存储不可用：下次 tourSeen 同样读不到，也不会再弹
  }
}
