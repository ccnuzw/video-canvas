import type { AssetDto } from "@/api/asset/type";
import type { DramaClipHost, Segment, Timeline, TimelineChange } from "@/api/drama/type";
import {
  IMAGE_DEFAULT_MS,
  MAX_IMAGE_MS,
  MIN_CLIP_MS,
  clipLength,
  emptyTimeline,
  mainTrack,
  newId,
  normalize,
} from "@/components/timeline-editor/model";
import type { ClipMedia, EditorClip, EditorTrack } from "@/components/timeline-editor/types";
import { variantUrl } from "@/utils/canvas/media-lod";

import type { AutosaveStatus } from "./autosave";
import { sortSegments } from "./segments";
import { clipRef, hostOf } from "./timeline-host";

/**
 * 成片粗剪里短剧特有的逻辑：片段与版本的解析、换版本、对账文案、导出前检查。
 * 通用的编辑操作（拆分、裁剪、移动……）在 components/timeline-editor/model.ts。
 */

/** 新段的 ID */
export const newClipId = (): string => newId("c");

/** 片段的显示名：「片段 01」 */
export const segmentLabel = (seq: number): string => `片段 ${String(seq + 1).padStart(2, "0")}`;

/** 是不是待采用占位（片段还没有采用视频，合成时跳过） */
export const isPlaceholder = (clip: EditorClip): boolean => {
  const host = hostOf(clip);
  return host.kind === "segment" && !host.taskId;
};

/** 片段的一条结果是第几版（从 1 起）；takes 按创建时间正序 */
export const versionOf = (segment: Segment, taskId: string): number =>
  segment.takes.findIndex((take) => take.taskId === taskId) + 1;

/** 片段里能用的结果：成功且有视频 */
const usableTake = (segment: Segment, taskId: string) =>
  segment.takes.find(
    (take) => take.taskId === taskId && take.status === "succeeded" && take.asset?.url,
  );

/** 素材地址的封面 / 缩略图变体；不归后端管的地址没有变体，音频没有 */
export function thumbUrlOf(url: string, kind: "video" | "image" | "audio"): string | null {
  if (kind === "audio") return null;
  const variant = variantUrl(url, kind === "image" ? "thumb" : "poster");
  return variant.hasVariant ? variant.url : null;
}

/** 失效的段：没有地址，标签照样显示，方便用户认出是哪一段 */
const broken = (clip: EditorClip, label: string): ClipMedia => ({
  state: "broken",
  url: null,
  durationMs: clipLength(clip),
  label,
  thumbUrl: null,
});

/**
 * 解析一段用的是什么素材。
 * invalid 是后端判定的失效段（固定版本不再可用等），以它为准；本地片段 / 素材找不到也算失效。
 */
export function resolveClip(
  clip: EditorClip,
  segments: readonly Segment[],
  assets: ReadonlyMap<string, AssetDto>,
  invalid: ReadonlySet<string>,
): ClipMedia {
  const host = hostOf(clip);
  if (host.kind === "text") {
    return {
      state: "ready",
      url: null,
      durationMs: clipLength(clip),
      label: clip.text?.text ?? "",
      thumbUrl: null,
    };
  }
  if (host.kind === "segment") {
    const segment = segments.find((item) => item.id === host.segmentId);
    const name = segment ? segmentLabel(segment.seq) : "片段";
    if (!segment || invalid.has(clip.id)) return broken(clip, name);
    if (!host.taskId) {
      return {
        state: "placeholder",
        url: null,
        durationMs: segment.seconds * 1000,
        label: `${name} · 待采用`,
        thumbUrl: null,
      };
    }
    const take = usableTake(segment, host.taskId);
    if (!take?.asset) return broken(clip, name);
    return {
      state: "ready",
      url: take.asset.url,
      durationMs: take.asset.durationMs || segment.seconds * 1000,
      label: `${name} · 版本 ${versionOf(segment, host.taskId)}`,
      thumbUrl: thumbUrlOf(take.asset.url, "video"),
    };
  }
  const asset = assets.get(host.assetId);
  if (!asset || asset.kind !== (host.media ?? clip.type) || invalid.has(clip.id)) {
    return broken(clip, asset?.fileName || "素材已失效");
  }
  return {
    state: "ready",
    url: asset.url,
    durationMs: asset.kind === "image" ? MAX_IMAGE_MS : asset.durationMs || clipLength(clip),
    label:
      asset.fileName ||
      (asset.kind === "image" ? "图片" : asset.kind === "audio" ? "音频" : "视频"),
    thumbUrl: thumbUrlOf(asset.url, asset.kind),
  };
}

/** 一个新片段的通用字段（不带轨道相关的参数） */
const blankClip = (id: string, over: Partial<EditorClip>): EditorClip => ({
  id,
  type: "video",
  ref: null,
  startMs: 0,
  inMs: 0,
  outMs: 0,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: null,
  host: null,
  ...over,
});

/** 用宿主数据组一个视频片段 */
const videoClip = (id: string, host: DramaClipHost, outMs: number): EditorClip =>
  blankClip(id, { type: "video", ref: clipRef(host), outMs, host });

/** 片段的全长跟随段；没有采用就是按片段秒数占位 */
export function segmentClip(segment: Segment, id = newClipId()): EditorClip {
  const take = segment.chosenTaskId ? usableTake(segment, segment.chosenTaskId) : undefined;
  const host: DramaClipHost = {
    kind: "segment",
    segmentId: segment.id,
    taskId: take ? segment.chosenTaskId : "",
    pinned: false,
    assetId: "",
    media: null,
  };
  const outMs = take ? take.asset?.durationMs || segment.seconds * 1000 : segment.seconds * 1000;
  return videoClip(id, host, outMs);
}

/** 一条片段结果做成的段：采用的版本是跟随段，其他版本是固定段 */
export function takeClip(segment: Segment, taskId: string): EditorClip {
  const take = usableTake(segment, taskId);
  const host: DramaClipHost = {
    kind: "segment",
    segmentId: segment.id,
    taskId,
    pinned: taskId !== segment.chosenTaskId,
    assetId: "",
    media: null,
  };
  return videoClip(newClipId(), host, take?.asset?.durationMs || segment.seconds * 1000);
}

/** 一个素材做成的段：视频和音频全长，图片默认 3 秒 */
export function assetClip(asset: AssetDto): EditorClip {
  const host: DramaClipHost = {
    kind: "asset",
    segmentId: "",
    taskId: "",
    pinned: false,
    assetId: asset.id,
    media: asset.kind,
  };
  const outMs = asset.kind === "image" ? IMAGE_DEFAULT_MS : asset.durationMs || IMAGE_DEFAULT_MS;
  return blankClip(newClipId(), { type: asset.kind, ref: clipRef(host), outMs, host });
}

/** 没剪过的集：主轨按序号、全长、跟随采用，附属轨为空（共享只读时前端自己算，和后端默认时间线一致） */
export function defaultTimeline(segments: readonly Segment[]): Timeline {
  const clips = sortSegments(segments).map((segment) => segmentClip(segment, `d${segment.id}`));
  const base = emptyTimeline();
  return {
    tracks: normalize({
      tracks: base.tracks.map((track) => (track.kind === "main" ? { ...track, clips } : track)),
    }).tracks,
    removedSegmentIds: [],
    imports: [],
  };
}

/**
 * 换版本：选一条结果就固定为它（选的正好是采用的那条就是跟随），选 follow 恢复跟随采用。
 * 入出点保留，超出新素材长度就收回；入点也越界就恢复全长。
 */
export function swapTake(
  clip: EditorClip,
  segment: Segment,
  taskId: string | "follow",
): EditorClip {
  const host = hostOf(clip);
  const target = taskId === "follow" ? segment.chosenTaskId : taskId;
  const take = target ? usableTake(segment, target) : undefined;
  if (!take) {
    return {
      ...clip,
      ref: null,
      host: { ...host, taskId: "", pinned: false },
      inMs: 0,
      outMs: segment.seconds * 1000,
    };
  }
  const duration = take.asset?.durationMs || segment.seconds * 1000;
  const pinned = taskId !== "follow" && target !== segment.chosenTaskId;
  const next: EditorClip = {
    ...clip,
    ref: `take:${target}`,
    host: { ...host, taskId: target, pinned },
  };
  if (!host.taskId) return { ...next, inMs: 0, outMs: duration };
  let { inMs, outMs } = clip;
  outMs = Math.min(outMs, duration);
  if (inMs > outMs - MIN_CLIP_MS) [inMs, outMs] = [0, duration];
  return { ...next, inMs, outMs };
}

/** 主轨上出现过的片段 ID（素材段和附属轨上的片段版本不算） */
const mainSegmentIds = (tracks: readonly EditorTrack[]): Set<string> => {
  const ids = new Set<string>();
  const main = tracks.find((track) => track.kind === "main");
  for (const clip of main?.clips ?? []) {
    const host = hostOf(clip);
    if (host.kind === "segment") ids.add(host.segmentId);
  }
  return ids;
};

/**
 * 编辑前后主轨的变化 → 新的「删除名单」：某个片段在主轨上的所有段都消失了就记进去（片场再改也不自动加回），
 * 又出现了就移出来。没有变化时返回原数组。
 */
export function trackRemovedSegments(
  before: readonly EditorTrack[],
  after: readonly EditorTrack[],
  removed: readonly string[],
): string[] {
  const was = mainSegmentIds(before);
  const now = mainSegmentIds(after);
  const gone = [...was].filter((id) => !now.has(id) && !removed.includes(id));
  const back = removed.filter((id) => now.has(id));
  if (gone.length === 0 && back.length === 0) return removed as string[];
  return [...removed.filter((id) => !now.has(id)), ...gone];
}

/** 「导出」按钮不能点的原因；能点为 null。任何一条轨上有失效素材都不能导出 */
export function composeReason(input: {
  timeline: Timeline;
  segments: readonly Segment[];
  assets: ReadonlyMap<string, AssetDto>;
  invalid: ReadonlySet<string>;
  save: AutosaveStatus;
}): string | null {
  const media = (clip: EditorClip) =>
    resolveClip(clip, input.segments, input.assets, input.invalid);
  const main = mainTrack(input.timeline).clips;
  const brokenAt = main.findIndex((clip) => media(clip).state === "broken");
  if (brokenAt >= 0) return `第 ${brokenAt + 1} 段的素材已失效，请换版本或删掉`;
  for (const track of input.timeline.tracks) {
    if (track.kind === "main") continue;
    const index = track.clips.findIndex((clip) => media(clip).state === "broken");
    if (index >= 0) return `「${track.name}」轨第 ${index + 1} 段的素材已失效，请删掉`;
  }
  if (!main.some((clip) => media(clip).state === "ready")) {
    return "至少要有一段可用的视频或图片才能合成";
  }
  if (input.save === "error" || input.save === "conflict") return "时间线没保存成功，先重试保存";
  return null;
}

/** 片场同步的一条变化写成给人看的话；clip 是变化后的主轨段（已移除为 null） */
export function changeText(
  change: TimelineChange,
  segments: readonly Segment[],
  clip: EditorClip | null,
): string {
  const segment = segments.find((item) => item.id === change.segmentId);
  const name = segmentLabel(segment?.seq ?? change.seq);
  const taskId = clip ? hostOf(clip).taskId : "";
  const version = segment && taskId ? versionOf(segment, taskId) : 0;
  switch (change.kind) {
    case "removed":
      return `${name} 已删除，已从时间线移除`;
    case "unadopted":
      return `${name} 取消了采用，变成待采用`;
    case "swapped":
      return `${name} 换成了采用的版本 ${version}`;
    case "adopted":
      return `${name} 已采用版本 ${version}`;
    case "added":
      return taskId ? `新增${name}` : `新增${name}（待采用）`;
  }
}
