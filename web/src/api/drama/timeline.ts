import { mapAsset } from "@/api/asset";
import { normalize } from "@/components/timeline-editor/model";
import type {
  AudioRole,
  ClipType,
  EditorClip,
  EditorTrack,
} from "@/components/timeline-editor/types";
import { clipRef, hostOf } from "@/utils/drama/timeline-host";
import service from "@/utils/requests/service";

import type {
  BackendTimelineClip,
  BackendTimelineTrack,
  BackendTimelineView,
  DramaClipHost,
  Timeline,
  TimelineClipKind,
  TimelineMedia,
  TimelineTrackKind,
  TimelineView,
} from "./type";

/** 后端段的种类和素材种类 → 通用片段类型 */
const typeOf = (kind: TimelineClipKind, media: TimelineMedia | null): ClipType =>
  kind === "segment" ? "video" : kind === "text" ? "text" : (media ?? "video");

/** 后端段 → 通用片段；空 id 统一成空串，叠加和文字参数只在对应的轨和片段上有 */
function mapClip(raw: BackendTimelineClip, trackKind: TimelineTrackKind): EditorClip {
  const host: DramaClipHost = {
    kind: raw.kind,
    segmentId: raw.segment_id ?? "",
    taskId: raw.task_id ?? "",
    pinned: !!raw.pinned,
    assetId: raw.asset_id ? String(raw.asset_id) : "",
    media: raw.media || null,
  };
  return {
    id: raw.id,
    type: typeOf(raw.kind, host.media),
    ref: clipRef(host),
    startMs: trackKind === "main" ? 0 : (raw.start_ms ?? 0),
    inMs: raw.in_ms,
    outMs: raw.out_ms,
    muted: !!raw.muted,
    volume: raw.volume ?? 100,
    fadeInMs: raw.fade_in_ms ?? 0,
    fadeOutMs: raw.fade_out_ms ?? 0,
    overlay:
      trackKind === "overlay"
        ? {
            x: raw.x ?? 50,
            y: raw.y ?? 50,
            scale: raw.scale ?? 100,
            opacity: raw.opacity ?? 100,
          }
        : null,
    text:
      raw.kind === "text"
        ? {
            text: raw.text ?? "",
            style: raw.style ?? "subtitle",
            pos: raw.pos ?? "bottom",
            size: raw.size ?? 100,
          }
        : null,
    host,
  };
}

/** 后端轨道 → 通用轨道；音频轨角色缺省为音效，clips 兜底空数组 */
const mapTrack = (raw: BackendTimelineTrack): EditorTrack => ({
  id: raw.id,
  kind: raw.kind,
  role: raw.kind === "audio" ? ((raw.role as AudioRole | null | undefined) ?? "sfx") : null,
  name: raw.name,
  muted: !!raw.muted,
  hidden: !!raw.hidden,
  locked: !!raw.locked,
  clips: (raw.clips ?? []).map((clip) => mapClip(clip, raw.kind)),
});

/** 时间线视图 snake → camel；列表兜底空数组，主轨起点按顺序重算 */
export const mapTimeline = (raw: BackendTimelineView): TimelineView => ({
  tracks: normalize({ tracks: (raw.tracks ?? []).map(mapTrack) }).tracks,
  removedSegmentIds: raw.removed_segment_ids ?? [],
  imports: (raw.imports ?? []).map(String),
  revision: raw.revision ?? 0,
  changes: (raw.changes ?? []).map((change) => ({
    kind: change.kind,
    segmentId: change.segment_id ?? "",
    seq: change.seq,
    clipId: change.clip_id ?? "",
  })),
  invalidClipIds: raw.invalid_clip_ids ?? [],
  assets: (raw.assets ?? []).map(mapAsset),
});

/** 通用片段 → 请求体；只发本种类和所在轨用到的字段 */
function toClipBody(clip: EditorClip, trackKind: TimelineTrackKind): BackendTimelineClip {
  const host = hostOf(clip);
  const body: BackendTimelineClip = {
    id: clip.id,
    kind: clip.type === "text" ? "text" : host.kind === "text" ? "asset" : host.kind,
    in_ms: Math.round(clip.inMs),
    out_ms: Math.round(clip.outMs),
    muted: clip.muted,
    volume: Math.round(clip.volume),
    fade_in_ms: Math.round(clip.fadeInMs),
    fade_out_ms: Math.round(clip.fadeOutMs),
  };
  if (trackKind !== "main") body.start_ms = Math.round(clip.startMs);
  if (body.kind === "segment") {
    body.segment_id = host.segmentId;
    body.task_id = host.taskId || null;
    // 附属轨上的片段版本不跟随采用，后端一律当固定版本
    body.pinned = trackKind === "main" ? host.pinned : true;
  } else if (body.kind === "asset") {
    body.asset_id = Number(host.assetId);
    body.media = (host.media ?? (clip.type === "text" ? "video" : clip.type)) as TimelineMedia;
  } else if (clip.text) {
    body.text = clip.text.text;
    body.style = clip.text.style;
    body.pos = clip.text.pos;
    body.size = Math.round(clip.text.size);
  }
  if (trackKind === "overlay" && clip.overlay) {
    body.x = Math.round(clip.overlay.x);
    body.y = Math.round(clip.overlay.y);
    body.scale = Math.round(clip.overlay.scale);
    body.opacity = Math.round(clip.overlay.opacity);
  }
  return body;
}

/** 通用轨道 → 请求体；role 只有音频轨有 */
const toTrackBody = (track: EditorTrack): BackendTimelineTrack => ({
  id: track.id,
  kind: track.kind,
  ...(track.kind === "audio" && track.role ? { role: track.role } : {}),
  name: track.name,
  muted: track.muted,
  hidden: track.hidden,
  locked: track.locked,
  clips: track.clips.map((clip) => toClipBody(clip, track.kind)),
});

/** PUT 请求体：版本、轨道、删除名单和已导入 */
export const toTimelineBody = (timeline: Timeline, revision: number) => ({
  revision,
  tracks: timeline.tracks.map(toTrackBody),
  removed_segment_ids: timeline.removedSegmentIds,
  imports: timeline.imports.map(Number),
});

/**
 * 读一集对账后的粗剪时间线；没剪过返回按片段现算的默认时间线（revision 为 0）
 * @param id 短剧 ID
 * @param no 集号
 * @returns 时间线
 */
export const getTimeline = async (id: string, no: number): Promise<TimelineView> =>
  mapTimeline(await service.get<BackendTimelineView>(`/dramas/${id}/episodes/${no}/timeline`));

/**
 * 带版本保存整份时间线；静默：版本冲突（67046）由调用方载入最新版本，内容不合法（67047）就地提示
 * @param id 短剧 ID
 * @param no 集号
 * @param timeline 要保存的时间线
 * @param revision 读到时的版本，没保存过为 0
 * @returns 保存后对账的最新时间线
 */
export const saveTimeline = async (
  id: string,
  no: number,
  timeline: Timeline,
  revision: number,
): Promise<TimelineView> =>
  mapTimeline(
    await service.put<BackendTimelineView>(
      `/dramas/${id}/episodes/${no}/timeline`,
      toTimelineBody(timeline, revision),
      { silent: true },
    ),
  );
