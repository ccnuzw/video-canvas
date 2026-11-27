import { useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";

import { clipLength } from "../model";
import type { EditorTrack } from "../types";
import { CLIP_INSET, HEAD_WIDTH, ROW_HEIGHT, RULER_HEIGHT, clipBox } from "./layout";

/** 轨道内容中的指针坐标（像素） */
type Point = { x: number; y: number };
/** 轨道内容中的选框位置和尺寸（像素） */
type Bounds = { left: number; top: number; width: number; height: number };

/** 支持从任意方向开始拖动 */
export function marqueeBounds(start: Point, end: Point): Bounds {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(start.x - end.x)),
    height: Math.max(1, Math.abs(start.y - end.y)),
  };
}

/** 返回被框到的片段，按轨道和片段顺序排列；锁定轨跳过 */
export function clipsInMarquee(tracks: readonly EditorTrack[], pps: number, box: Bounds): string[] {
  const ids: string[] = [];
  let top = RULER_HEIGHT;
  for (const track of tracks) {
    const bottom = top + ROW_HEIGHT[track.kind];
    if (
      !track.locked &&
      top + CLIP_INSET < box.top + box.height &&
      bottom - 1 - CLIP_INSET > box.top
    ) {
      for (const clip of track.clips) {
        const { left, width } = clipBox(clip.startMs, clipLength(clip), pps);
        const x = HEAD_WIDTH + left;
        if (x < box.left + box.width && x + width > box.left) ids.push(clip.id);
      }
    }
    top = bottom;
  }
  return ids;
}

/** 区分轻点空白定位与框选拖动 */
const DRAG_THRESHOLD = 5;

/** 鼠标或笔在空白处开始的选框；触屏仍用原来的定位手势 */
export function useMarquee(
  scrollRef: RefObject<HTMLDivElement | null>,
  tracks: readonly EditorTrack[],
  pps: number,
  onSelect: (ids: string[]) => void,
  onClick: (clientX: number) => void,
) {
  const [box, setBox] = useState<Bounds | null>(null);
  const gesture = useRef<{
    pointerId: number;
    start: Point;
    screen: Point;
    moved: boolean;
  } | null>(null);

  const point = (event: PointerEvent, scroll: HTMLElement): Point => {
    const rect = scroll.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * scroll.offsetWidth) / rect.width;
    const y = ((event.clientY - rect.top) * scroll.offsetHeight) / rect.height;
    return {
      x: scroll.scrollLeft + Math.min(scroll.clientWidth, Math.max(HEAD_WIDTH, x)),
      y: scroll.scrollTop + Math.min(scroll.clientHeight, Math.max(RULER_HEIGHT, y)),
    };
  };

  const start = (event: PointerEvent) => {
    const scroll = scrollRef.current;
    if (!scroll || gesture.current || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      start: point(event, scroll),
      screen: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  };

  const boundsAt = (event: PointerEvent): Bounds | null => {
    const current = gesture.current;
    const scroll = scrollRef.current;
    if (!current || !scroll) return null;
    current.moved ||=
      Math.hypot(event.clientX - current.screen.x, event.clientY - current.screen.y) >=
      DRAG_THRESHOLD;
    return current.moved ? marqueeBounds(current.start, point(event, scroll)) : null;
  };
  const cancel = () => {
    gesture.current = null;
    setBox(null);
  };
  const matches = (event: PointerEvent) => gesture.current?.pointerId === event.pointerId;

  return {
    box,
    previewIds: box ? clipsInMarquee(tracks, pps, box) : null,
    start,
    cancel,
    onPointerMove: (event: PointerEvent) => {
      if (matches(event)) setBox(boundsAt(event));
    },
    onPointerUp: (event: PointerEvent) => {
      if (!matches(event)) return;
      const finalBox = boundsAt(event);
      cancel();
      if (finalBox) onSelect(clipsInMarquee(tracks, pps, finalBox));
      else onClick(event.clientX);
    },
    onPointerCancel: (event: PointerEvent) => {
      if (matches(event)) cancel();
    },
  };
}
