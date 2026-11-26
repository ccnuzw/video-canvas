import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  MAX_FADE_MS,
  findClip,
  insertIndexAt,
  moveAttached,
  moveMain,
  snapTargets,
  updateClip,
} from "../model";
import { SNAP_PX } from "../types";
import type {
  EditError,
  EditorClip,
  EditorTimeline,
  PlayerHandle,
  TimelineEditorHost,
} from "../types";
import { previewMove, relocate, sourceMaxOf, trimDraft, type MovePreview } from "./drag-logic";

/** 片段上可以按下去拖的部位：本体（移动）、左右边（裁剪）、淡入淡出手柄 */
export type ClipPart = "body" | "start" | "end" | "fadeIn" | "fadeOut";

/** 指针拖动中的状态 */
export type Drag =
  /** 拖播放头或点刻度尺 */
  | { mode: "seek" }
  /** 拖边裁剪；draft 是边拖边画的草稿，松手才写进时间线 */
  | {
      mode: "trim";
      id: string;
      side: "start" | "end";
      x0: number;
      orig: EditorClip;
      sourceMax: number;
      draft: EditorTimeline;
      snapAt: number | null;
    }
  /** 拖淡入淡出手柄 */
  | {
      mode: "fade";
      id: string;
      side: "in" | "out";
      x0: number;
      orig: EditorClip;
      draft: EditorTimeline;
    }
  /** 拖主轨片段换顺序；insert 是插入位置 */
  | { mode: "moveMain"; id: string; x0: number; moving: boolean; insert: number | null }
  /** 拖附属片段（可跨同类轨） */
  | { mode: "move"; id: string; x0: number; moving: boolean; preview: MovePreview | null };

/** 拖动判定为「开始移动」的最小距离（像素） */
const MOVE_THRESHOLD = 5;

/** 拖动逻辑需要的外部输入 */
interface DragInput {
  /** 当前时间线 */
  timeline: EditorTimeline;
  /** 宿主 */
  host: TimelineEditorHost;
  /** 播放器 */
  player: PlayerHandle;
  /** 只读 */
  readOnly: boolean;
  /** 当前缩放（每秒像素） */
  pps: number;
  /** 吸附是否开启 */
  snapOn: boolean;
  /** 时间线被改 */
  onChange: (next: EditorTimeline) => void;
  /** 编辑失败 */
  onError: (message: string) => void;
  /** 选中片段 */
  onSelect: (id: string | null) => void;
  /** 指针横坐标 → 时间线毫秒 */
  timeAt: (clientX: number) => number;
  /** 指针纵坐标 → 轨道 ID */
  laneAt: (clientY: number) => string | null;
}

/**
 * 时间线上所有指针拖动：seek、拖边裁剪、淡入淡出、主轨换顺序、附属片段移动。
 * 用 window 监听 move/up，拖动中片段换轨导致元素重建也不会丢事件。
 * 拖动中只画草稿，松手才一次性 onChange（一步撤销）。
 */
export function useTimelineDrag(input: DragInput) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const set = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const active = drag !== null;

  useEffect(() => {
    if (!active) return;
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (current) dragRef.current = applyMove(current, event, inputRef.current);
      setDrag(dragRef.current);
    };
    const onUp = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (current) commit(current, inputRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [active]);

  /** 在刻度尺或轨道空白处按下：定位播放头并开始拖动定位 */
  const startSeek = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    input.player.pause();
    input.player.seek(input.timeAt(event.clientX));
    set({ mode: "seek" });
  };

  /** 在片段的某个部位按下：选中它，可编辑时开始对应的拖动 */
  const startClip = (event: ReactPointerEvent, id: string, part: ClipPart) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    input.onSelect(id);
    const found = findClip(input.timeline, id);
    if (!found || input.readOnly || found.track.locked) return;
    const { clip } = found;
    const x0 = event.clientX;
    if (part === "start" || part === "end") {
      const sourceMax = sourceMaxOf(clip, input.host.resolve(clip).durationMs);
      set({
        mode: "trim",
        id,
        side: part,
        x0,
        orig: clip,
        sourceMax,
        draft: input.timeline,
        snapAt: null,
      });
    } else if (part === "fadeIn" || part === "fadeOut") {
      set({
        mode: "fade",
        id,
        side: part === "fadeIn" ? "in" : "out",
        x0,
        orig: clip,
        draft: input.timeline,
      });
    } else if (found.track.kind === "main") {
      set({ mode: "moveMain", id, x0, moving: false, insert: null });
    } else {
      set({ mode: "move", id, x0, moving: false, preview: null });
    }
  };

  // 拖动中画的时间线：草稿或临时摆好位置的样子
  let shown = input.timeline;
  let snapAt: number | null = null;
  if (drag?.mode === "trim") {
    shown = drag.draft;
    snapAt = drag.snapAt;
  } else if (drag?.mode === "fade") shown = drag.draft;
  else if (drag?.mode === "move" && drag.moving && drag.preview) {
    shown = relocate(input.timeline, drag.id, drag.preview.trackId, drag.preview.startMs);
    snapAt = drag.preview.snapAt;
  }
  const insert = drag?.mode === "moveMain" && drag.moving ? drag.insert : null;

  return { drag, shown, snapAt, insert, startSeek, startClip };
}

/** 吸附阈值（毫秒） */
const thresholdOf = (pps: number) => (SNAP_PX / pps) * 1000;

/** 指针移动：更新拖动状态 */
function applyMove(drag: Drag, event: PointerEvent, ctx: DragInput): Drag {
  const { timeline, pps } = ctx;
  if (drag.mode === "seek") {
    ctx.player.seek(ctx.timeAt(event.clientX));
    return drag;
  }
  const deltaMs = ((event.clientX - drag.x0) / pps) * 1000;
  if (drag.mode === "trim") {
    const targets = snapTargets(timeline, ctx.player.time(), drag.id);
    const result = trimDraft(
      timeline,
      drag.orig,
      drag.side,
      deltaMs,
      drag.sourceMax,
      targets,
      thresholdOf(pps),
      ctx.snapOn,
    );
    return { ...drag, draft: result.timeline, snapAt: result.snapAt };
  }
  if (drag.mode === "fade") {
    const patch =
      drag.side === "in"
        ? { fadeInMs: Math.min(MAX_FADE_MS, drag.orig.fadeInMs + deltaMs) }
        : { fadeOutMs: Math.min(MAX_FADE_MS, drag.orig.fadeOutMs - deltaMs) };
    return { ...drag, draft: updateClip(timeline, drag.id, patch) };
  }
  if (!drag.moving && Math.abs(event.clientX - drag.x0) < MOVE_THRESHOLD) return drag;
  if (drag.mode === "moveMain") {
    return { ...drag, moving: true, insert: insertIndexAt(timeline, ctx.timeAt(event.clientX)) };
  }
  const found = findClip(timeline, drag.id);
  if (!found) return drag;
  const start = found.clip.startMs + deltaMs;
  const targets = ctx.snapOn ? snapTargets(timeline, ctx.player.time(), drag.id) : [];
  return {
    ...drag,
    moving: true,
    preview: previewMove(
      timeline,
      drag.id,
      ctx.laneAt(event.clientY),
      start,
      targets,
      thresholdOf(pps),
    ),
  };
}

/** 一段是否被改动过 */
const changed = (a: EditorClip | undefined, b: EditorClip | undefined) =>
  JSON.stringify(a) !== JSON.stringify(b);

/** 指针松手：把拖动结果一次性写进时间线；不合法就回退并提示 */
function commit(drag: Drag, ctx: DragInput): void {
  if (drag.mode === "trim" || drag.mode === "fade") {
    const after = findClip(drag.draft, drag.id)?.clip;
    if (changed(after, drag.orig)) ctx.onChange(drag.draft);
    return;
  }
  if (drag.mode === "moveMain") {
    if (!drag.moving || drag.insert === null) return;
    const next = moveMain(ctx.timeline, drag.id, drag.insert);
    if (next !== ctx.timeline) ctx.onChange(next);
    return;
  }
  if (drag.mode === "move" && drag.moving && drag.preview) {
    const result: { timeline: EditorTimeline } | EditError = moveAttached(
      ctx.timeline,
      drag.id,
      drag.preview.trackId,
      drag.preview.startMs,
    );
    if ("error" in result) ctx.onError(result.error);
    else ctx.onChange(result.timeline);
  }
}
