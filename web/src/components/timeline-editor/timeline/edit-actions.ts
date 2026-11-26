import {
  IMAGE_DEFAULT_MS,
  MIN_CLIP_MS,
  TEXT_DEFAULT_MS,
  addAttached,
  findClip,
  mainClipAt,
  neighborsOf,
  newId,
  normalize,
  overlapsAt,
  removeClip,
  splitAt,
  textClip,
  trimToPlayhead,
  updateClip,
} from "../model";
import type { ClipMedia, EditError, EditorClip, EditorTimeline } from "../types";

/**
 * 工具条、右键菜单和快捷键共用的编辑命令（纯函数）：
 * 在 model 的基础上加上「作用于哪一段」的选择，以及占位、失效段的限制。
 * 成功返回新时间线，失败返回 {@link EditError}。
 */

/** 解析一段素材的函数，宿主提供 */
export type Resolver = (clip: EditorClip) => ClipMedia;

/** 命令的目标段：有选中的就用选中的，否则用播放头所在的主轨片段；都没有为 null */
export function targetClipId(
  timeline: EditorTimeline,
  selectedId: string | null,
  playheadMs: number,
): string | null {
  if (selectedId && findClip(timeline, selectedId)) return selectedId;
  return mainClipAt(timeline, playheadMs)?.clip.id ?? null;
}

/** 拆分和裁剪前的检查：占位和失效的段不能动；文字没有素材，不检查 */
function editableMedia(clip: EditorClip, resolve: Resolver, verb: string): EditError | null {
  if (clip.type === "text") return null;
  const { state } = resolve(clip);
  if (state === "placeholder") return { error: `待采用的片段不能${verb}` };
  if (state === "broken") return { error: "素材已失效，请先换版本或删掉" };
  return null;
}

/** 在播放头处拆分目标段，选中后一半 */
export function splitCommand(
  timeline: EditorTimeline,
  resolve: Resolver,
  selectedId: string | null,
  playheadMs: number,
  makeId: () => string = newId,
): { timeline: EditorTimeline; selectId: string } | EditError {
  const id = targetClipId(timeline, selectedId, playheadMs);
  if (!id) return { error: "先选中一段，或把播放头放到主轨的片段上" };
  const blocked = editableMedia(findClip(timeline, id)!.clip, resolve, "拆分");
  return blocked ?? splitAt(timeline, id, playheadMs, makeId);
}

/** 把目标段播放头左边（left）或右边（right）的部分删掉 */
export function trimCommand(
  timeline: EditorTimeline,
  resolve: Resolver,
  selectedId: string | null,
  playheadMs: number,
  side: "left" | "right",
): { timeline: EditorTimeline; playhead: number } | EditError {
  const id = targetClipId(timeline, selectedId, playheadMs);
  if (!id) return { error: "先选中一段，或把播放头放到主轨的片段上" };
  const blocked = editableMedia(findClip(timeline, id)!.clip, resolve, "裁剪");
  return blocked ?? trimToPlayhead(timeline, id, playheadMs, side);
}

/** 找到可编辑的一段；找不到或所在轨被锁定返回错误 */
function editable(
  timeline: EditorTimeline,
  id: string | null,
): { found: NonNullable<ReturnType<typeof findClip>> } | EditError {
  const found = id ? findClip(timeline, id) : null;
  if (!found) return { error: "先选中一段" };
  if (found.track.locked) return { error: "这条轨已锁定" };
  return { found };
}

/** 删除选中的一段 */
export function removeCommand(
  timeline: EditorTimeline,
  id: string | null,
): { timeline: EditorTimeline } | EditError {
  const target = editable(timeline, id);
  if ("error" in target) return target;
  return { timeline: removeClip(timeline, target.found.clip.id) };
}

/** 切换一段的静音 */
export function muteCommand(
  timeline: EditorTimeline,
  id: string | null,
): { timeline: EditorTimeline } | EditError {
  const target = editable(timeline, id);
  if ("error" in target) return target;
  const { clip } = target.found;
  return { timeline: updateClip(timeline, clip.id, { muted: !clip.muted }) };
}

/**
 * 恢复原长：视频和音频回到素材全长，图片回到默认 3 秒；
 * 附属轨不能压到后一段，所以最长到后一段的起点。
 */
export function restoreCommand(
  timeline: EditorTimeline,
  resolve: Resolver,
  id: string | null,
): { timeline: EditorTimeline } | EditError {
  const target = editable(timeline, id);
  if ("error" in target) return target;
  const { clip, track } = target.found;
  if (clip.type === "text") return { error: "文字片段没有原长" };
  const media = resolve(clip);
  if (media.state !== "ready") return { error: "素材不可用，不能恢复原长" };
  const full = clip.type === "image" ? IMAGE_DEFAULT_MS : media.durationMs;
  const room = track.kind === "main" ? Infinity : neighborsOf(track, clip).nextStart - clip.startMs;
  const len = Math.max(MIN_CLIP_MS, Math.min(full, room));
  return { timeline: updateClip(timeline, clip.id, { inMs: 0, outMs: len }) };
}

/** 在播放头处给字幕轨加一条字幕（最长 2 秒，遇到后一条就缩短）；播放头处已有字幕失败 */
export function addSubtitle(
  timeline: EditorTimeline,
  trackId: string,
  playheadMs: number,
  makeId: () => string = newId,
): { timeline: EditorTimeline; selectId: string } | EditError {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) return { error: "找不到这条轨" };
  if (track.locked) return { error: "这条轨已锁定" };
  const start = Math.max(0, Math.round(playheadMs));
  if (overlapsAt(track, start, MIN_CLIP_MS)) return { error: "播放头处已有字幕" };
  const next = track.clips.filter((clip) => clip.startMs > start).map((clip) => clip.startMs);
  const clip = textClip(start, makeId);
  const len = Math.min(TEXT_DEFAULT_MS, Math.min(...next, Infinity) - start);
  const placed = addAttached(timeline, trackId, { ...clip, outMs: Math.max(MIN_CLIP_MS, len) });
  return "error" in placed ? placed : { timeline: placed.timeline, selectId: clip.id };
}

/** 用宿主生成的片段替换整条字幕轨的内容（按台词生成字幕） */
export function replaceTrackClips(
  timeline: EditorTimeline,
  trackId: string,
  clips: readonly EditorClip[],
): EditorTimeline | EditError {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) return { error: "找不到这条轨" };
  if (track.locked) return { error: "这条轨已锁定" };
  return normalize({
    ...timeline,
    tracks: timeline.tracks.map((item) =>
      item.id === trackId ? { ...item, clips: clips.map((clip) => ({ ...clip })) } : item,
    ),
  });
}
