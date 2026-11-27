/**
 * 多轨时间线编辑器模块的对外入口：外壳组件、宿主要用的类型和纯函数。
 * 模块不依赖任何业务代码，素材来源、保存、导出、对账都由宿主通过 TimelineEditorHost 提供。
 */
export { TimelineEditor } from "./timeline-editor";
/** 属性面板的分区卡片：宿主在 inspectorExtra 里追加内容时用它，和内置分区长得一样 */
export { InspectorSection } from "./inspector-fields";
export { endMediaDrag, startMediaDrag } from "./drag";
export { emptyHistory, HISTORY_LIMIT, pushHistory, redoHistory, undoHistory } from "./history";
export type { History } from "./history";
export {
  IMAGE_DEFAULT_MS,
  MAX_IMAGE_MS,
  MIN_CLIP_MS,
  clipEnd,
  clipLength,
  emptyTimeline,
  findClip,
  mainTrack,
  newId,
  normalize,
  textClip,
  timelineEnd,
  trackBadge,
  updateClip,
  updateTrack,
} from "./model";
export { placeMedia } from "./place";
export type * from "./types";
