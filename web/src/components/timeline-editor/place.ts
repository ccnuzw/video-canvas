import {
  DEFAULT_OVERLAY,
  addAttached,
  addTrack,
  clipEnd,
  clipLength,
  insertMain,
  mainClipAt,
  mainTrack,
  pickAudioTrack,
  timelineEnd,
} from "./model";
import type { DropTarget, EditError, EditorClip, EditorTimeline } from "./types";

/**
 * 把素材做成的片段放进时间线。
 * 有落点就放在落点（主轨插入、附属轨按起点）；没有落点（点「+」）时：
 * 视频和图片接在播放头所在的主轨段之后，音频放到播放头处空着的音频轨（都占着就新开一条）。
 */
export function placeMedia(
  timeline: EditorTimeline,
  clip: EditorClip,
  target: DropTarget | null,
  playheadMs: number,
): { timeline: EditorTimeline; selectId: string } | EditError {
  const visual = clip.type === "video" || clip.type === "image";
  if (target?.kind === "track") {
    const placed = addAttached(timeline, target.trackId, { ...clip, startMs: target.startMs });
    return "error" in placed ? placed : { timeline: placed.timeline, selectId: clip.id };
  }
  if (target?.kind === "main" || (!target && visual)) {
    if (!visual) return { error: "这类素材不能放进主轨" };
    const index = target ? target.index : afterPlayhead(timeline, playheadMs);
    return { timeline: insertMain(timeline, index, clip), selectId: clip.id };
  }
  if (clip.type !== "audio") return { error: "这类素材不能放进时间线" };
  return placeAudio(timeline, clip, playheadMs);
}

/** 播放头所在主轨段之后的插入位置；播放头在主轨之外就放最后 */
function afterPlayhead(timeline: EditorTimeline, playheadMs: number): number {
  const clips = mainTrack(timeline).clips;
  const end = clips.length > 0 ? clipEnd(clips[clips.length - 1]) : 0;
  const at = mainClipAt(timeline, Math.min(playheadMs, Math.max(0, end - 1)));
  return at ? at.index + 1 : clips.length;
}

/** 音频放到播放头处：优先空着的音频轨，没有就新开一条 */
function placeAudio(
  timeline: EditorTimeline,
  clip: EditorClip,
  playheadMs: number,
): { timeline: EditorTimeline; selectId: string } | EditError {
  const start = Math.min(Math.max(0, playheadMs), Math.max(0, 30 * 60 * 1000 - clipLength(clip)));
  let base = timeline;
  let trackId = pickAudioTrack(base, null, start, clipLength(clip));
  if (!trackId) {
    const added = addTrack(base, "audio");
    if ("error" in added) return { error: "音频轨已满，先腾出位置" };
    base = added.timeline;
    trackId = added.trackId;
  }
  const placed = addAttached(base, trackId, { ...clip, startMs: start, overlay: null });
  return "error" in placed ? placed : { timeline: placed.timeline, selectId: clip.id };
}

/** 叠加轨片段的默认位置（供外部取用） */
export const overlayDefaults = DEFAULT_OVERLAY;

/** 时间线总长，供宿主判断是否为空 */
export const isEmptyTimeline = (timeline: EditorTimeline): boolean => timelineEnd(timeline) === 0;
