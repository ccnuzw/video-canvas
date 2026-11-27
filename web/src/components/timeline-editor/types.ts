import type { ReactNode } from "react";

/**
 * 多轨时间线编辑器的通用类型。
 * 这个模块不认识短剧：素材来源、保存、导出、对账都由宿主通过 {@link TimelineEditorHost} 传入，
 * 宿主自己的数据放进片段的 `host` 字段，编辑器原样保留、从不读取。
 */

/** 轨道种类：main 是主轨（片段首尾相接），其余是自由摆放的附属轨 */
export type TrackKind = "main" | "overlay" | "audio" | "text";

/** 音频轨的角色：配音 / 背景音乐 / 音效 */
export type AudioRole = "voice" | "music" | "sfx";

/** 片段类型：决定能放进哪种轨道 */
export type ClipType = "video" | "image" | "audio" | "text";

/** 文字样式：字幕或标题 */
export type TextStyle = "subtitle" | "title";

/** 文字在画面里的竖向位置 */
export type TextPos = "top" | "middle" | "bottom";

/** 叠加画面的位置和外观，只有叠加轨的片段有 */
export interface OverlayParams {
  /** 中心点横向位置，占画面宽度的百分比（0–100） */
  x: number;
  /** 中心点纵向位置，占画面高度的百分比（0–100） */
  y: number;
  /** 画面宽度占整个画面宽度的百分比（10–100） */
  scale: number;
  /** 不透明度百分比（0–100） */
  opacity: number;
}

/** 文字片段的内容和样式，只有字幕轨的片段有 */
export interface TextParams {
  /** 文字内容 */
  text: string;
  /** 字幕或标题 */
  style: TextStyle;
  /** 竖向位置 */
  pos: TextPos;
  /** 字号占默认字号的百分比（60–180） */
  size: number;
}

/** 时间线上的一段 */
export interface EditorClip {
  /** 段 ID，整条时间线内唯一 */
  id: string;
  /** 片段类型 */
  type: ClipType;
  /** 宿主的素材引用，编辑器当不透明字符串用；文字片段为 null */
  ref: string | null;
  /** 在时间线上的起点（毫秒）；主轨由编辑器按顺序算出，附属轨由用户摆放 */
  startMs: number;
  /** 素材内的入点（毫秒）；图片和文字恒为 0 */
  inMs: number;
  /** 素材内的出点（毫秒）；图片和文字就是时长。时长 = outMs - inMs */
  outMs: number;
  /** 这一段静音 */
  muted: boolean;
  /** 音量百分比（0–200，0 = 静音）；文字和图片不用 */
  volume: number;
  /** 淡入时长（毫秒） */
  fadeInMs: number;
  /** 淡出时长（毫秒） */
  fadeOutMs: number;
  /** 叠加参数；非叠加轨为 null */
  overlay: OverlayParams | null;
  /** 文字参数；非文字片段为 null */
  text: TextParams | null;
  /** 宿主私有数据，编辑器原样保留 */
  host: unknown;
}

/** 一条轨道 */
export interface EditorTrack {
  /** 轨道 ID，整条时间线内唯一；主轨固定为 "main" */
  id: string;
  /** 轨道种类 */
  kind: TrackKind;
  /** 音频轨的角色；其他轨为 null */
  role: AudioRole | null;
  /** 轨道名 */
  name: string;
  /** 静音（对主轨、叠加轨和音频轨生效） */
  muted: boolean;
  /** 隐藏（预览和导出都不显示；对叠加轨和字幕轨生效） */
  hidden: boolean;
  /** 锁定：不能编辑这条轨上的片段 */
  locked: boolean;
  /** 轨上的片段；主轨按播放顺序排列 */
  clips: EditorClip[];
}

/** 整条时间线；轨道按显示顺序排列：字幕 → 叠加 → 主轨 → 音频 */
export interface EditorTimeline {
  /** 全部轨道，恰好一条主轨 */
  tracks: EditorTrack[];
}

/** 编辑操作失败的原因（直接给用户看） */
export interface EditError {
  /** 失败原因 */
  error: string;
}

/** 一段素材解析出来的信息，由宿主给 */
export interface ClipMedia {
  /** ready 可用；placeholder 是占位（预览黑底，合成时跳过）；broken 是素材已失效 */
  state: "ready" | "placeholder" | "broken";
  /** 素材地址；占位和失效为 null */
  url: string | null;
  /** 素材全长（毫秒）：视频和音频是时长，图片是允许的最长时长，占位是预计时长 */
  durationMs: number;
  /** 段上显示的名字 */
  label: string;
  /** 缩略图地址（视频封面或图片缩略图）；没有为 null */
  thumbUrl: string | null;
}

/** 素材面板里的一张卡片 */
export interface MediaItem {
  /** 卡片 ID，同一个标签内唯一 */
  id: string;
  /** 素材类型，决定能拖进哪种轨道 */
  type: Exclude<ClipType, "text">;
  /** 卡片标题 */
  title: string;
  /** 卡片副标题，如「视频 · 6s」 */
  subtitle: string;
  /** 缩略图地址；没有为 null（音频显示图标） */
  thumbUrl: string | null;
  /** 缩略图比例：project 沿用项目画面比例（如视频本身），square 是方形（如画布素材、导入的文件） */
  aspect: "project" | "square";
  /** 缩略图左上角的标记，如「已采用」；没有为 null */
  badge: string | null;
  /** 已经在时间线上（卡片底色会深一些） */
  onTimeline: boolean;
  /** 上传状态：ready 可用，uploading 上传中，failed 上传失败 */
  status: "ready" | "uploading" | "failed";
  /** 上传进度（0–100）；只在 uploading 时有意义 */
  progress: number;
  /** 宿主私有载荷，拖入或点「+」时原样交回 createClip */
  payload: unknown;
}

/** 素材面板里的一组卡片（如一个片段的各个版本） */
export interface MediaSection {
  /** 组标题；没有为 null */
  title: string | null;
  /** 组内卡片 */
  items: MediaItem[];
}

/** 素材面板的一个标签 */
export interface MediaTab {
  /** 标签 ID */
  id: string;
  /** 标签名 */
  label: string;
  /** 标签内容 */
  sections: MediaSection[];
  /** 正在读取 */
  loading: boolean;
  /** 没有内容时显示的文字 */
  emptyText: string;
  /** 是否显示「全部 / 视频 / 图片 / 音频」筛选 */
  filterable: boolean;
  /** 是否显示「导入」按钮并接受拖入文件 */
  importable: boolean;
}

/** 右键菜单的一项（宿主追加的） */
export interface ClipMenuItem {
  /** 菜单项 ID */
  id: string;
  /** 菜单项文字 */
  label: string;
  /** 是否是危险操作（红色） */
  danger?: boolean;
  /** 点击后执行 */
  run: () => void;
}

/** 片段上的宿主标记 */
export interface ClipBadges {
  /** 显示图钉（如固定了版本） */
  pinned: boolean;
  /** 显示蓝色圆点（如片场同步改动过） */
  marked: boolean;
}

/** 编辑器对宿主的全部要求 */
export interface TimelineEditorHost {
  /** 解析一段用的素材 */
  resolve: (clip: EditorClip) => ClipMedia;
  /** 素材面板的标签 */
  tabs: readonly MediaTab[];
  /** 把拖入或点「+」的素材载荷做成片段（可能要先读素材时长）；失败返回 null，宿主自己提示 */
  createClip: (payload: unknown) => Promise<EditorClip | null>;
  /** 用户切到素材面板的某个标签（宿主可据此按需读取，如首次打开才读画布素材） */
  onTabSelect?: (tabId: string) => void;
  /** 导入本地文件；不传则没有导入入口 */
  onImport?: (files: File[]) => void;
  /** 重试上传失败的素材 */
  onRetryImport?: (itemId: string) => void;
  /** 宿主追加的片段右键菜单项 */
  clipMenu?: (clip: EditorClip) => ClipMenuItem[];
  /** 属性面板里追加的内容（如换版本） */
  inspectorExtra?: (clip: EditorClip) => ReactNode;
  /** 片段上的标记；不传则都没有 */
  clipBadges?: (clip: EditorClip) => ClipBadges;
  /** 「按台词生成字幕」：返回要放进字幕轨的文字片段（替换该轨原有内容）；不传则没有这个入口 */
  generateSubtitles?: () => EditorClip[];
  /** 预览为空时的「去片场」之类的入口 */
  emptyAction?: { label: string; run: () => void };
}

/** 播放器的句柄：时间线读取播放头、预览控制播放都走它；播放头每帧变化，不放进 React 状态 */
export interface PlayerHandle {
  /** 当前播放头位置（毫秒） */
  time: () => number;
  /** 是否在播放 */
  playing: () => boolean;
  /** 时间线总长（毫秒） */
  duration: () => number;
  /** 跳到某个位置（毫秒），会限制在 [0, 总长] */
  seek: (ms: number) => void;
  /** 暂停 */
  pause: () => void;
  /** 播放 / 暂停切换 */
  toggle: () => void;
  /** 订阅播放头和播放状态的变化，返回取消订阅函数；回调参数是当前位置（毫秒） */
  subscribe: (listener: (ms: number) => void) => () => void;
}

/** 素材拖到时间线上的落点 */
export type DropTarget =
  /** 主轨第 index 个插入位置（0 = 最前，段数 = 最后） */
  | { kind: "main"; index: number }
  /** 附属轨的某个起点（毫秒） */
  | { kind: "track"; trackId: string; startMs: number };

/** 时间线面板（工具条 + 刻度尺 + 轨道区）的属性 */
export interface TimelinePanelProps {
  /** 当前时间线 */
  timeline: EditorTimeline;
  /** 宿主提供的能力 */
  host: TimelineEditorHost;
  /** 选中的片段 ID */
  selectedIds: readonly string[];
  /** 替换当前选中的片段 */
  onSelect: (ids: string[]) => void;
  /** 播放器句柄 */
  player: PlayerHandle;
  /** 只读：不能编辑 */
  readOnly: boolean;
  /** 能否撤销 */
  canUndo: boolean;
  /** 能否重做 */
  canRedo: boolean;
  /** 时间线被改成了 next（一次完整的编辑，宿主负责记撤销和保存） */
  onChange: (next: EditorTimeline) => void;
  /** 撤销 */
  onUndo: () => void;
  /** 重做 */
  onRedo: () => void;
  /** 素材被拖到轨道上松手；落点是否合法由面板拖动时判断，松手后交给外壳建片段并放置 */
  onDropMedia: (item: DraggedMedia, target: DropTarget) => void;
  /** 编辑失败的提示（如「这里已有片段」），外壳弹 toast */
  onError: (message: string) => void;
}

/** 编辑器外壳（素材面板 + 预览 + 属性 + 时间线）的属性 */
export interface TimelineEditorProps {
  /** 当前时间线（受控） */
  timeline: EditorTimeline;
  /** 时间线被改成了 next；宿主负责记撤销、保存，并把新值传回 timeline */
  onChange: (next: EditorTimeline) => void;
  /** 撤销 / 重做的状态和动作，历史由宿主保存（可用 history.ts） */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  /** 宿主提供的能力 */
  host: TimelineEditorHost;
  /** 只读：不能编辑，但能播放和查看 */
  readOnly: boolean;
  /** 画面比例，如 "9:16"；认不出来按 9:16 */
  ratio: string;
  /** 让编辑器选中某个片段并把播放头移到它的起点（nonce 每次加一，同一个片段也能重复触发）；不需要为 undefined */
  focus?: { clipId: string; nonce: number };
  /** 分栏尺寸的存储 id 前缀：同一个宿主的不同场景用不同前缀，每人拖出的尺寸各记一份 */
  layoutId: string;
}

/** 正在被拖的素材卡 */
export interface DraggedMedia {
  /** 素材类型，决定能落进哪种轨道 */
  type: Exclude<ClipType, "text">;
  /** 宿主私有载荷，松手后交给 createClip */
  payload: unknown;
}

/** 吸附的范围（像素），换算成毫秒要除以每毫秒的像素数 */
export const SNAP_PX = 8;
