import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { MAX_FADE_MS, findClip, snapTargets, updateClip } from "../model";
import { moveClipTo } from "../move";
import { SNAP_PX } from "../types";
import type { EditorClip, EditorTimeline, PlayerHandle, TimelineEditorHost } from "../types";
import { planMove, relocate, sourceMaxOf, trimDraft, type MovePlan } from "./drag-logic";

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
  /**
   * 拖片段换位置：主轨内调顺序、主轨和叠加轨之间换轨、附属轨之间换轨。
   * grabMs 是按下时指针离片段起点多少毫秒；plan 是当前落点；ghost 是主轨上跟着指针走的影子的尺寸和抓取点
   */
  | {
      mode: "move";
      id: string;
      x0: number;
      y0: number;
      grabMs: number;
      moving: boolean;
      canLeaveMain: boolean;
      plan: MovePlan | null;
      pointer: { x: number; y: number };
      ghost: GhostBox;
    };

/** 片段影子的尺寸和抓取点（像素）：抓取点是按下时指针相对片段左上角的位置 */
export interface GhostBox {
  /** 宽 */
  width: number;
  /** 高 */
  height: number;
  /** 抓取点横向偏移 */
  offsetX: number;
  /** 抓取点纵向偏移 */
  offsetY: number;
}

/** 主轨上跟着指针走的影子：位置（视口坐标）、尺寸和是哪一段 */
export interface Ghost {
  /** 片段 ID */
  id: string;
  /** 左上角横坐标 */
  x: number;
  /** 左上角纵坐标 */
  y: number;
  /** 宽 */
  width: number;
  /** 高 */
  height: number;
}

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
 * 时间线上所有指针拖动：seek、拖边裁剪、淡入淡出、片段换位置（主轨排序、换轨）。
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
    } else {
      const rect = (event.target as HTMLElement).closest("[data-clip]")?.getBoundingClientRect();
      set({
        mode: "move",
        id,
        x0,
        y0: event.clientY,
        grabMs: input.timeAt(x0) - clip.startMs,
        moving: false,
        // 待采用的占位、素材失效的段不能离开主轨
        canLeaveMain: clip.type !== "text" && input.host.resolve(clip).state === "ready",
        plan: null,
        pointer: { x: x0, y: event.clientY },
        ghost: {
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          offsetX: rect ? x0 - rect.left : 0,
          offsetY: rect ? event.clientY - rect.top : 0,
        },
      });
    }
  };

  // 拖动中画的时间线：草稿或临时摆好位置的样子
  let shown = input.timeline;
  let snapAt: number | null = null;
  if (drag?.mode === "trim") {
    shown = drag.draft;
    snapAt = drag.snapAt;
  } else if (drag?.mode === "fade") shown = drag.draft;
  else if (drag?.mode === "move" && drag.moving && drag.plan) {
    shown = movedView(input.timeline, drag.id, drag.plan);
    snapAt = drag.plan.snapAt;
  }
  const ghost = ghostOf(drag);

  return { drag, shown, snapAt, ghost, startSeek, startClip };
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
  const pointer = { x: event.clientX, y: event.clientY };
  if (!drag.moving && Math.hypot(pointer.x - drag.x0, pointer.y - drag.y0) < MOVE_THRESHOLD) {
    return drag;
  }
  const pointerMs = ctx.timeAt(event.clientX);
  const start = pointerMs - drag.grabMs;
  const targets = ctx.snapOn ? snapTargets(timeline, ctx.player.time(), drag.id) : [];
  const plan = planMove(
    timeline,
    drag.id,
    ctx.laneAt(event.clientY),
    start,
    pointerMs,
    targets,
    thresholdOf(pps),
    drag.canLeaveMain,
  );
  return { ...drag, moving: true, plan, pointer };
}

/** 拖动中画的样子：落点合法就是松手后的结果（主轨其余片段已经让位），不合法就原样摆上去并标红 */
function movedView(timeline: EditorTimeline, id: string, plan: MovePlan): EditorTimeline {
  if (plan.ok) {
    const result = moveClipTo(timeline, id, plan.target);
    return "error" in result ? timeline : result.timeline;
  }
  return plan.target.kind === "track"
    ? relocate(timeline, id, plan.target.trackId, plan.target.startMs)
    : timeline;
}

/** 落点在主轨时，跟着指针走的影子；其余情况为 null（附属轨上片段本身就跟着指针走） */
function ghostOf(drag: Drag | null): Ghost | null {
  if (drag?.mode !== "move" || !drag.moving || drag.plan?.target.kind !== "main") return null;
  if (drag.ghost.width <= 0) return null;
  return {
    id: drag.id,
    x: drag.pointer.x - drag.ghost.offsetX,
    y: drag.pointer.y - drag.ghost.offsetY,
    width: drag.ghost.width,
    height: drag.ghost.height,
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
  if (drag.mode === "move" && drag.moving && drag.plan) {
    const result = moveClipTo(ctx.timeline, drag.id, drag.plan.target);
    if ("error" in result) ctx.onError(result.error);
    else if (result.timeline !== ctx.timeline) ctx.onChange(result.timeline);
  }
}
