import {
  MAX_IMAGE_MS,
  MIN_CLIP_MS,
  accepts,
  clipEnd,
  clipLength,
  findClip,
  insertIndexAt,
  normalize,
  overlapsAt,
  snapMove,
  snapTime,
  trimEdge,
} from "../model";
import { mainSlotAt, type MoveTarget } from "../move";
import type { ClipType, EditorClip, EditorTimeline, TrackKind } from "../types";

/**
 * 拖动相关的纯判定：素材落点、附属片段移动预览、带吸附的裁剪草稿。
 * 界面只负责把指针位置换成毫秒和轨道，剩下的规则都在这里。
 */

/** 素材拖入时附属轨上画的预览方框长度（毫秒）；真实长度要等宿主读完素材才知道 */
export const DROP_PREVIEW_MS = 2000;

/** 素材拖入时指针下的落点；ok 为 false 表示会压到别的片段 */
export type DropMark =
  /** 主轨第 index 个插入位置 */
  | { kind: "main"; index: number }
  /** 附属轨的某个起点 */
  | { kind: "track"; trackId: string; startMs: number; ok: boolean; snapAt: number | null };

/**
 * 指针在 trackId 这条轨上、时间 ms 处，拖着 type 类型的素材时的落点。
 * 轨道不存在、被锁定、类型不符都返回 null；附属轨的起点会吸附到 targets。
 */
export function dropTargetFor(
  timeline: EditorTimeline,
  type: Exclude<ClipType, "text">,
  trackId: string | null,
  ms: number,
  targets: readonly number[],
  thresholdMs: number,
): DropMark | null {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track || track.locked || !accepts(track.kind, type)) return null;
  if (track.kind === "main") return { kind: "main", index: insertIndexAt(timeline, ms) };
  const snapped = snapMove(Math.max(0, ms), DROP_PREVIEW_MS, targets, thresholdMs);
  const startMs = Math.max(0, snapped.start);
  return {
    kind: "track",
    trackId: track.id,
    startMs,
    ok: !overlapsAt(track, startMs, MIN_CLIP_MS),
    snapAt: snapped.at,
  };
}

/** 片段拖动中的落点 */
export interface MovePlan {
  /** 移到哪里 */
  target: MoveTarget;
  /** 是否合法（附属轨上不压到别的片段；主轨插入总是合法） */
  ok: boolean;
  /** 吸附到的位置（毫秒）；没吸附为 null */
  snapAt: number | null;
}

/** 主轨和叠加轨都是画面，片段可以互换；其他轨只能在同类之间挪 */
const sameFamily = (a: TrackKind, b: TrackKind) =>
  a === b || (a === "main" && b === "overlay") || (a === "overlay" && b === "main");

/**
 * 拖着 id 这一段、指针悬停在 hoverTrackId 这条轨、片段起点在 startMs、指针在 pointerMs 时的落点。
 * 悬停的轨能放（同类或主轨 ↔ 叠加、没锁、类型相符；从主轨拿去叠加轨还要 canLeaveMain）就换过去，否则留在原轨。
 * 落在主轨按拖动方向的领头边给插入位置（见 mainSlotAt）；落在附属轨起点吸附到 targets。找不到片段返回 null。
 */
export function planMove(
  timeline: EditorTimeline,
  id: string,
  hoverTrackId: string | null,
  startMs: number,
  pointerMs: number,
  targets: readonly number[],
  thresholdMs: number,
  canLeaveMain: boolean,
): MovePlan | null {
  const found = findClip(timeline, id);
  if (!found) return null;
  const hover = timeline.tracks.find((track) => track.id === hoverTrackId);
  const usable =
    !!hover &&
    !hover.locked &&
    sameFamily(hover.kind, found.track.kind) &&
    accepts(hover.kind, found.clip.type) &&
    !(found.track.kind === "main" && hover.kind !== "main" && !canLeaveMain);
  const dest = usable ? hover : found.track;
  const len = clipLength(found.clip);
  if (dest.kind === "main") {
    return {
      target: { kind: "main", index: mainSlotAt(timeline, id, startMs, pointerMs) },
      ok: true,
      snapAt: null,
    };
  }
  const snapped = snapMove(startMs, len, targets, thresholdMs);
  const start = Math.max(0, snapped.start);
  return {
    target: { kind: "track", trackId: dest.id, startMs: start },
    ok: !overlapsAt(dest, start, len, id),
    snapAt: snapped.at,
  };
}

/** 不做任何校验，把一段摆到某条轨的某个起点；用来画拖动中的样子 */
export function relocate(
  timeline: EditorTimeline,
  id: string,
  trackId: string,
  startMs: number,
): EditorTimeline {
  const found = findClip(timeline, id);
  if (!found) return timeline;
  const moved = { ...found.clip, startMs };
  return normalize({
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      const rest = track.clips.filter((clip) => clip.id !== id);
      return track.id === trackId
        ? { ...track, clips: [...rest, moved] }
        : { ...track, clips: rest };
    }),
  });
}

/** 一段能拉长到的最大素材长度：文字不限，图片 30 秒，视频和音频取素材时长 */
export function sourceMaxOf(clip: EditorClip, durationMs: number): number {
  if (clip.type === "text") return Infinity;
  if (clip.type === "image") return MAX_IMAGE_MS;
  return durationMs;
}

/**
 * 拖边裁剪的草稿：先按 delta 裁一次，边靠近吸附目标就再补偿到目标上。
 * 主轨的左边只改入点、位置不动，不参与吸附。返回草稿时间线和吸附到的位置。
 */
export function trimDraft(
  timeline: EditorTimeline,
  orig: EditorClip,
  side: "start" | "end",
  delta: number,
  sourceMaxMs: number,
  targets: readonly number[],
  thresholdMs: number,
  snapOn: boolean,
): { timeline: EditorTimeline; snapAt: number | null } {
  const base = trimEdge(timeline, orig, side, delta, sourceMaxMs);
  const found = findClip(base, orig.id);
  if (!snapOn || !found || (found.track.kind === "main" && side === "start")) {
    return { timeline: base, snapAt: null };
  }
  const edgeOf = (clip: EditorClip) => (side === "start" ? clip.startMs : clipEnd(clip));
  const edge = edgeOf(found.clip);
  const snapped = snapTime(edge, targets, thresholdMs);
  if (snapped.at === null) return { timeline: base, snapAt: null };
  const next = trimEdge(timeline, orig, side, delta + (snapped.t - edge), sourceMaxMs);
  const nextClip = findClip(next, orig.id)!.clip;
  return {
    timeline: next,
    snapAt: Math.abs(edgeOf(nextClip) - snapped.t) < 1 ? snapped.at : null,
  };
}
