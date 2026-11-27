import type { DragEvent } from "react";

import type { DraggedMedia } from "./types";

/**
 * 素材卡拖到时间线的拖放桥。
 * 载荷是宿主的任意对象，没法放进 DataTransfer，所以存在模块内；
 * DataTransfer 里只放一个标记类型，让浏览器允许放下，并让时间线认出这是素材。
 */

/** DataTransfer 里的标记类型 */
export const MEDIA_DRAG_TYPE = "application/x-timeline-media";

let current: DraggedMedia | null = null;

/** 开始拖一张素材卡 */
export function startMediaDrag(event: DragEvent, media: DraggedMedia): void {
  current = media;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(MEDIA_DRAG_TYPE, media.type);
}

/** 正在拖的素材；没有为 null（dragover 里读不到 getData，只能从这里读） */
export const currentMediaDrag = (): DraggedMedia | null => current;

/** 拖动结束（松手或取消） */
export function endMediaDrag(): void {
  current = null;
}

/** 这次拖动是不是素材卡（而不是文件或别的东西） */
export const isMediaDrag = (event: DragEvent): boolean =>
  event.dataTransfer.types.includes(MEDIA_DRAG_TYPE);
