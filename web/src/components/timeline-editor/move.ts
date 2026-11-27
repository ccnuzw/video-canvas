import {
  DEFAULT_OVERLAY,
  accepts,
  clampClip,
  clipLength,
  findClip,
  mainTrack,
  normalize,
  overlapsAt,
} from "./model";
import type { EditError, EditorClip, EditorTimeline } from "./types";

/**
 * 把一段移到时间线上任意合法位置：主轨内调顺序、主轨和叠加轨之间换轨、附属轨之间换轨（纯函数）。
 * 拖动中画的样子和松手写入用同一个函数，看到的就是松手后的结果。
 */

/** 移动的目标位置 */
export type MoveTarget =
  /** 主轨第 index 个插入位置（按移走这一段之后的主轨算；0 = 最前） */
  | { kind: "main"; index: number }
  /** 附属轨的某个起点（毫秒） */
  | { kind: "track"; trackId: string; startMs: number };

/**
 * 拖着 id 这一段、它的中心点在时间线上 centerMs 处时，应该插到主轨的第几个位置。
 * 按「拿掉这一段后其余片段首尾相接」的位置算中点：中心点越过某段的中点就排到它后面。
 * 用合上空位后的位置而不是原位置，拖动中其余片段让位后判断也不会来回跳。
 */
export function mainSlotAt(timeline: EditorTimeline, id: string, centerMs: number): number {
  let slot = 0;
  let at = 0;
  for (const clip of mainTrack(timeline).clips) {
    if (clip.id === id) continue;
    const len = clipLength(clip);
    if (centerMs > at + len / 2) slot++;
    at += len;
  }
  return slot;
}

/** 换到目标轨时要改的字段：进叠加轨补默认叠加参数，离开叠加轨去掉 */
function adapt(clip: EditorClip, toOverlay: boolean): EditorClip {
  return { ...clip, overlay: toOverlay ? (clip.overlay ?? DEFAULT_OVERLAY) : null };
}

/**
 * 把 id 这一段移到 target；类型不符、轨道锁定、落在附属轨会压到别的片段时失败。
 * 主轨内原地不动返回原对象，方便调用方判断「没有改动」。
 */
export function moveClipTo(
  timeline: EditorTimeline,
  id: string,
  target: MoveTarget,
): { timeline: EditorTimeline } | EditError {
  const found = findClip(timeline, id);
  if (!found) return { error: "找不到这一段" };
  const dest =
    target.kind === "main"
      ? mainTrack(timeline)
      : timeline.tracks.find((track) => track.id === target.trackId);
  if (!dest) return { error: "找不到这条轨" };
  if (found.track.locked || dest.locked) return { error: "这条轨已锁定" };
  // 主轨和叠加轨都是画面，可以互换；其他轨只能在同类之间挪
  const sameFamily =
    dest.kind === found.track.kind ||
    (dest.kind === "main" && found.track.kind === "overlay") ||
    (dest.kind === "overlay" && found.track.kind === "main");
  if (!sameFamily || !accepts(dest.kind, found.clip.type)) {
    return { error: "这类片段不能放到这条轨" };
  }
  if (target.kind === "main") {
    const rest = mainTrack(timeline).clips.filter((clip) => clip.id !== id);
    const index = Math.min(Math.max(target.index, 0), rest.length);
    if (found.track.kind === "main" && index === found.index) return { timeline };
    const clips = [...rest];
    clips.splice(index, 0, adapt(found.clip, false));
    return { timeline: normalize(place(timeline, id, dest.id, clips)) };
  }
  const startMs = Math.max(0, Math.round(target.startMs));
  if (overlapsAt(dest, startMs, clipLength(found.clip), id)) {
    return { error: "这里已有片段，换个位置" };
  }
  const moved = clampClip({ ...adapt(found.clip, dest.kind === "overlay"), startMs });
  const clips = [...dest.clips.filter((clip) => clip.id !== id), moved];
  return { timeline: normalize(place(timeline, id, dest.id, clips)) };
}

/** 从所有轨里拿掉 id，再把目标轨的片段换成 clips */
function place(
  timeline: EditorTimeline,
  id: string,
  destId: string,
  clips: EditorClip[],
): EditorTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === destId
        ? { ...track, clips }
        : { ...track, clips: track.clips.filter((clip) => clip.id !== id) },
    ),
  };
}
