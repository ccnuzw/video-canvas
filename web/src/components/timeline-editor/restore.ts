import {
  IMAGE_DEFAULT_MS,
  MIN_CLIP_MS,
  clipLength,
  findClip,
  neighborsOf,
  updateClip,
} from "./model";
import type { EditorTimeline } from "./types";

/**
 * 恢复原长：视频和音频回到素材全长（附属轨不压到后一段），图片回到默认 3 秒；文字不变。
 * durationMs 是素材全长（宿主解析给的）；找不到这一段返回原对象。
 */
export function restoreLength(
  timeline: EditorTimeline,
  id: string,
  durationMs: number,
): EditorTimeline {
  const found = findClip(timeline, id);
  if (!found || found.clip.type === "text") return timeline;
  const { clip, track } = found;
  const target = clip.type === "image" ? IMAGE_DEFAULT_MS : durationMs;
  if (track.kind === "main") {
    return updateClip(timeline, id, { inMs: 0, outMs: target });
  }
  const room = neighborsOf(track, clip).nextStart - clip.startMs;
  const len = Math.max(MIN_CLIP_MS, Math.min(target, room));
  return updateClip(timeline, id, {
    inMs: 0,
    outMs: len || clipLength(clip),
  });
}
