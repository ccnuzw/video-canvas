import { mapAsset } from "@/api/asset";
import service from "@/utils/requests/service";

import type {
  BackendTimelineClip,
  BackendTimelineView,
  Timeline,
  TimelineClip,
  TimelineView,
} from "./type";

/** 后端段 → 前端段；空 id 统一成空串 */
const mapClip = (raw: BackendTimelineClip): TimelineClip => ({
  id: raw.id,
  kind: raw.kind,
  segmentId: raw.segment_id ?? "",
  taskId: raw.task_id ?? "",
  pinned: !!raw.pinned,
  assetId: raw.asset_id ?? "",
  media: raw.media || null,
  inMs: raw.in_ms,
  outMs: raw.out_ms,
  muted: !!raw.muted,
});

/** 时间线视图 snake → camel；列表兜底空数组 */
export const mapTimeline = (raw: BackendTimelineView): TimelineView => ({
  clips: (raw.clips ?? []).map(mapClip),
  muted: !!raw.muted,
  removedSegmentIds: raw.removed_segment_ids ?? [],
  imports: raw.imports ?? [],
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

/** 前端段 → 请求体；只发本种类用到的字段 */
const toClipBody = (clip: TimelineClip): BackendTimelineClip =>
  clip.kind === "segment"
    ? {
        id: clip.id,
        kind: "segment",
        segment_id: clip.segmentId,
        task_id: clip.taskId || null,
        pinned: clip.pinned,
        in_ms: Math.round(clip.inMs),
        out_ms: Math.round(clip.outMs),
        muted: clip.muted,
      }
    : {
        id: clip.id,
        kind: "asset",
        asset_id: clip.assetId,
        media: clip.media ?? "video",
        in_ms: Math.round(clip.inMs),
        out_ms: Math.round(clip.outMs),
        muted: clip.muted,
      };

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
      {
        revision,
        clips: timeline.clips.map(toClipBody),
        muted: timeline.muted,
        removed_segment_ids: timeline.removedSegmentIds,
        imports: timeline.imports,
      },
      { silent: true },
    ),
  );
