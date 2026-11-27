import type { AssetDto } from "@/api/asset/type";
import type { DramaClipHost, Segment, Timeline } from "@/api/drama/type";
import type {
  ClipMenuItem,
  EditorClip,
  MediaItem,
  MediaTab,
} from "@/components/timeline-editor/types";
import { sortSegments } from "@/utils/drama/segments";
import {
  assetClip,
  segmentLabel,
  swapTake,
  takeClip,
  thumbUrlOf,
  versionOf,
} from "@/utils/drama/timeline";
import { hostOf } from "@/utils/drama/timeline-host";

import { usableTakes } from "./version-picker";

/**
 * 成片剪辑台给通用编辑器的素材面板数据和「素材 → 片段」的转换。
 * 都是纯函数，状态（画布素材、上传）由 use-final-host 持有。
 */

/** 素材卡片携带的载荷：片段的某个版本、已读到详情的素材，或只知道 ID 的画布素材 */
export type DramaMediaPayload =
  | { type: "take"; segmentId: string; taskId: string }
  | { type: "asset"; asset: AssetDto }
  | { type: "canvas"; assetId: string };

/** 画布上一个能放进时间线的素材 */
export interface CanvasMedia {
  /** 素材 ID */
  assetId: string;
  /** 素材地址 */
  url: string;
  /** 素材种类 */
  kind: "video" | "image" | "audio";
  /** 画布节点上的名字 */
  label: string;
}

/** 正在上传的本地文件 */
export interface UploadItem {
  /** 上传项的唯一键 */
  key: string;
  /** 本地文件 */
  file: File;
  /** 上传进度（0–100） */
  progress: number;
  /** 上传失败，等用户重试 */
  failed: boolean;
}

/** 时间线所有轨上用到的版本和素材的引用（take:任务ID / asset:素材ID），在轨的卡片底色深一些 */
export function onTimelineRefs(timeline: Timeline): Set<string> {
  const refs = new Set<string>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) if (clip.ref) refs.add(clip.ref);
  }
  return refs;
}

/** 以秒为单位的时长文字；未知为空串 */
const seconds = (ms: number | null | undefined): string => (ms ? `${Math.round(ms / 1000)}s` : "");

/** 「片段」标签：每个片段的各个成功版本，没有可用版本的片段不列 */
export function segmentsTab(
  segments: readonly Segment[],
  onTimeline: ReadonlySet<string>,
): MediaTab {
  const sections = sortSegments(segments).flatMap((segment) => {
    const takes = usableTakes(segment);
    if (takes.length === 0) return [];
    const items: MediaItem[] = takes.map((take) => ({
      id: `take:${take.taskId}`,
      type: "video",
      title: `版本 ${versionOf(segment, take.taskId)}`,
      subtitle: seconds(take.asset?.durationMs),
      thumbUrl: take.asset ? thumbUrlOf(take.asset.url, "video") : null,
      aspect: "project",
      badge: take.taskId === segment.chosenTaskId ? "已采用" : null,
      onTimeline: onTimeline.has(`take:${take.taskId}`),
      status: "ready",
      progress: 0,
      payload: {
        type: "take",
        segmentId: segment.id,
        taskId: take.taskId,
      } satisfies DramaMediaPayload,
    }));
    return [{ title: `${segmentLabel(segment.seq)} · ${segment.seconds}s`, items }];
  });
  return {
    id: "segments",
    label: "片段",
    sections,
    loading: false,
    emptyText: "还没有可用的片段视频",
    filterable: false,
    importable: false,
  };
}

/** 素材的副标题：「图片」「视频 · 6s」「音频 · 4s」 */
const assetSubtitle = (kind: "video" | "image" | "audio", durationMs: number | null): string => {
  if (kind === "image") return "图片";
  const name = kind === "video" ? "视频" : "音频";
  return durationMs ? `${name} · ${seconds(durationMs)}` : name;
};

/** 「画布素材」标签：画布上的图片、视频、音频；null 表示还在读取 */
export function canvasTab(
  media: readonly CanvasMedia[] | null,
  onTimeline: ReadonlySet<string>,
): MediaTab {
  const items: MediaItem[] = (media ?? []).map((item) => ({
    id: `asset:${item.assetId}`,
    type: item.kind,
    title: item.label || "未命名",
    subtitle: assetSubtitle(item.kind, null),
    thumbUrl: thumbUrlOf(item.url, item.kind),
    aspect: "square",
    badge: null,
    onTimeline: onTimeline.has(`asset:${item.assetId}`),
    status: "ready",
    progress: 0,
    payload: { type: "canvas", assetId: item.assetId } satisfies DramaMediaPayload,
  }));
  return {
    id: "canvas",
    label: "画布素材",
    sections: [{ title: null, items }],
    loading: media === null,
    emptyText: "画布上还没有素材",
    filterable: true,
    importable: false,
  };
}

/** 本地文件的素材种类；不是视频、图片、音频返回 null */
export function classifyFile(file: File): "video" | "image" | "audio" | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/** 「已导入」标签：上传中和失败的排在前面，然后是已导入的素材 */
export function importsTab(
  imports: readonly AssetDto[],
  uploads: readonly UploadItem[],
  onTimeline: ReadonlySet<string>,
): MediaTab {
  const pending: MediaItem[] = uploads.map((upload) => ({
    id: upload.key,
    type: classifyFile(upload.file) ?? "video",
    title: upload.file.name,
    subtitle: "",
    thumbUrl: null,
    aspect: "square",
    badge: null,
    onTimeline: false,
    status: upload.failed ? "failed" : "uploading",
    progress: upload.failed ? 0 : upload.progress,
    payload: null,
  }));
  const ready: MediaItem[] = imports.map((asset) => ({
    id: `asset:${asset.id}`,
    type: asset.kind,
    title: asset.fileName ?? "",
    subtitle: assetSubtitle(asset.kind, asset.durationMs),
    thumbUrl: thumbUrlOf(asset.url, asset.kind),
    aspect: "square",
    badge: null,
    onTimeline: onTimeline.has(`asset:${asset.id}`),
    status: "ready",
    progress: 0,
    payload: { type: "asset", asset } satisfies DramaMediaPayload,
  }));
  return {
    id: "imports",
    label: "已导入",
    sections: [{ title: null, items: [...pending, ...ready] }],
    loading: false,
    emptyText: "将文件拖至此处添加",
    filterable: true,
    importable: true,
  };
}

/** 做片段需要的外部能力 */
export interface CreateClipDeps {
  /** 当前集的片段 */
  segments: readonly Segment[];
  /** 读素材详情（画布素材要拿时长） */
  getAsset: (id: string) => Promise<AssetDto>;
  /** 把读到的素材记进素材表 */
  addAssets: (assets: AssetDto[]) => void;
  /** 读素材失败（可能已被删除）时提示用户 */
  onReadFail: () => void;
}

/** 拖入或点「+」的素材载荷 → 片段；片段不存在、素材读不到返回 null */
export async function createDramaClip(
  payload: unknown,
  deps: CreateClipDeps,
): Promise<EditorClip | null> {
  const data = payload as DramaMediaPayload | null;
  if (!data) return null;
  if (data.type === "take") {
    const segment = deps.segments.find((item) => item.id === data.segmentId);
    return segment ? takeClip(segment, data.taskId) : null;
  }
  let asset: AssetDto;
  if (data.type === "asset") asset = data.asset;
  else {
    try {
      asset = await deps.getAsset(data.assetId);
    } catch {
      deps.onReadFail();
      return null;
    }
  }
  deps.addAssets([asset]);
  return assetClip(asset);
}

/** 右键菜单里的换版本项：跟随采用 + 各个可用版本；当前用的带勾 */
export function swapMenuItems(
  clip: EditorClip,
  segment: Segment,
  apply: (next: EditorClip) => void,
): ClipMenuItem[] {
  const host: DramaClipHost = hostOf(clip);
  const item = (id: string, label: string): ClipMenuItem => ({
    id,
    label,
    run: () => apply(swapTake(clip, segment, id)),
  });
  return [
    item("follow", `跟随采用${host.pinned ? "" : " ✓"}`),
    ...usableTakes(segment).map((take) => {
      const name = `版本 ${versionOf(segment, take.taskId)}${take.taskId === segment.chosenTaskId ? "（已采用）" : ""}`;
      return item(take.taskId, `${name}${host.pinned && host.taskId === take.taskId ? " ✓" : ""}`);
    }),
  ];
}
