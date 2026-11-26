import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getAsset, uploadAsset } from "@/api/asset";
import type { AssetDto } from "@/api/asset/type";
import { getCanvas } from "@/api/canvas";
import type { Segment, Timeline } from "@/api/drama/type";
import { mainTrack, updateClip } from "@/components/timeline-editor/model";
import type { EditorClip, TimelineEditorHost } from "@/components/timeline-editor/types";
import { UPLOAD_SIZE_LIMIT } from "@/constants/canvas";
import { useDramaTimelineStore } from "@/store/drama-timeline";
import { resolveClip, swapTake } from "@/utils/drama/timeline";
import { hostOf } from "@/utils/drama/timeline-host";

import {
  canvasTab,
  classifyFile,
  createDramaClip,
  importsTab,
  onTimelineRefs,
  segmentsTab,
  swapMenuItems,
  type CanvasMedia,
  type UploadItem,
} from "./host";
import { VersionPicker } from "./version-picker";

/** 读短剧画布上带素材的图片、视频、音频节点；null 表示还在读，读失败当作没有 */
function useCanvasMedia(canvasId: string, enabled: boolean): CanvasMedia[] | null {
  const [state, setState] = useState<{ canvasId: string; media: CanvasMedia[] } | null>(null);
  // 首次点开「画布素材」标签才读；失败静默（全局已提示或画布已删）
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getCanvas(canvasId)
      .then((detail) => {
        if (!alive) return;
        const media: CanvasMedia[] = [];
        for (const node of detail.graph.nodes) {
          // 分组节点没有 kind，只要带素材的节点
          if (!node.data || !("kind" in node.data)) continue;
          const data = node.data;
          const kind = data.mediaType ?? data.kind;
          if (!data.assetId || !data.src || data.src.startsWith("blob:")) continue;
          if (kind !== "video" && kind !== "image" && kind !== "audio") continue;
          media.push({
            assetId: data.assetId,
            url: data.src,
            kind,
            label: data.label || data.fileName || "",
          });
        }
        setState({ canvasId, media });
      })
      .catch(() => alive && setState({ canvasId, media: [] }));
    return () => {
      alive = false;
    };
  }, [canvasId, enabled]);
  return state?.canvasId === canvasId ? state.media : null;
}

/** 本地导入：校验种类和大小、上传、成功后记进素材表和「已导入」 */
function useImports() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const upload = useCallback(async (item: UploadItem) => {
    const patch = (fn: (u: UploadItem) => UploadItem) =>
      setUploads((list) => list.map((u) => (u.key === item.key ? fn(u) : u)));
    patch((u) => ({ ...u, progress: 0, failed: false }));
    try {
      const asset = await uploadAsset(item.file, {
        onProgress: (progress) => patch((u) => ({ ...u, progress })),
      });
      setUploads((list) => list.filter((u) => u.key !== item.key));
      const store = useDramaTimelineStore.getState();
      store.addAssets([asset]);
      store.edit((t) => ({
        ...t,
        imports: [asset.id, ...t.imports.filter((id) => id !== asset.id)],
      }));
    } catch {
      patch((u) => ({ ...u, failed: true }));
    }
  }, []);

  const importFiles = useCallback(
    (files: File[]) => {
      const picked: UploadItem[] = [];
      for (const file of files) {
        const kind = classifyFile(file);
        if (!kind) {
          toast.error(`${file.name} 不是视频、图片或音频`);
          continue;
        }
        if (file.size > UPLOAD_SIZE_LIMIT[kind]) {
          toast.error(`${file.name} 超过 ${UPLOAD_SIZE_LIMIT[kind] / 1024 / 1024}MB`);
          continue;
        }
        picked.push({
          key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
          file,
          progress: 0,
          failed: false,
        });
      }
      if (picked.length === 0) return;
      setUploads((list) => [...picked, ...list]);
      picked.forEach((item) => void upload(item));
    },
    [upload],
  );

  const retry = useCallback(
    (key: string) => {
      const item = uploads.find((u) => u.key === key);
      if (item) void upload(item);
    },
    [uploads, upload],
  );

  return { uploads, importFiles, retry };
}

/** 换版本：改这一段的版本，提示是否还跟随片场的采用 */
function applySwap(clip: EditorClip, next: EditorClip): void {
  const store = useDramaTimelineStore.getState();
  store.applyEditor(updateClip({ tracks: store.timeline.tracks }, clip.id, () => next));
  toast.info(hostOf(next).pinned ? "已换版本，这一段不再跟随片场的采用" : "已恢复跟随片场的采用");
}

/**
 * 把短剧的数据（片段、画布素材、导入、时间线）接成通用编辑器要的宿主能力：
 * 素材面板的标签、素材解析、素材转片段、换版本、片场同步标记。
 */
export function useFinalHost(input: {
  canvasId: string;
  segments: readonly Segment[];
  timeline: Timeline;
  assets: ReadonlyMap<string, AssetDto>;
  invalid: ReadonlySet<string>;
  /** 被片场同步改过的主轨段 */
  syncIds: ReadonlySet<string>;
  /** 「已导入」里的素材（已按顺序） */
  imports: readonly AssetDto[];
  readOnly: boolean;
  onGoStudio: () => void;
}): TimelineEditorHost {
  const { canvasId, segments, timeline, assets, invalid, syncIds, imports, readOnly, onGoStudio } =
    input;
  const [canvasWanted, setCanvasWanted] = useState(false);
  const canvas = useCanvasMedia(canvasId, canvasWanted);
  const { uploads, importFiles, retry } = useImports();

  const refs = useMemo(() => onTimelineRefs(timeline), [timeline]);
  const tabs = useMemo(
    () => [
      segmentsTab(segments, refs),
      canvasTab(canvas, refs),
      importsTab(imports, uploads, refs),
    ],
    [segments, canvas, imports, uploads, refs],
  );
  const mainIds = useMemo(
    () => new Set(mainTrack({ tracks: timeline.tracks }).clips.map((clip) => clip.id)),
    [timeline.tracks],
  );
  /** 主轨上的片段段对应的片段；其他段（素材、附属轨、找不到）为 null */
  const segmentOf = useCallback(
    (clip: EditorClip): Segment | null => {
      const host = hostOf(clip);
      if (!mainIds.has(clip.id) || host.kind !== "segment") return null;
      return segments.find((item) => item.id === host.segmentId) ?? null;
    },
    [mainIds, segments],
  );

  return useMemo<TimelineEditorHost>(
    () => ({
      resolve: (clip) => resolveClip(clip, segments, assets, invalid),
      tabs,
      onTabSelect: (tabId) => {
        if (tabId === "canvas") setCanvasWanted(true);
      },
      createClip: (payload) =>
        createDramaClip(payload, {
          segments,
          getAsset,
          addAssets: (list) => useDramaTimelineStore.getState().addAssets(list),
          onReadFail: () => toast.error("素材读取失败，可能已被删除"),
        }),
      onImport: readOnly ? undefined : importFiles,
      onRetryImport: readOnly ? undefined : retry,
      clipMenu: (clip) => {
        const segment = segmentOf(clip);
        return segment ? swapMenuItems(clip, segment, (next) => applySwap(clip, next)) : [];
      },
      inspectorExtra: (clip) => {
        const segment = segmentOf(clip);
        return segment ? (
          <VersionPicker
            clip={clip}
            segment={segment}
            disabled={readOnly}
            onPick={(taskId) => applySwap(clip, swapTake(clip, segment, taskId))}
          />
        ) : null;
      },
      clipBadges: (clip) => ({
        pinned: mainIds.has(clip.id) && hostOf(clip).pinned,
        marked: syncIds.has(clip.id),
      }),
      // 片段上没有结构化的台词字段，「按台词生成字幕」暂不提供入口
      emptyAction: { label: "去片场", run: onGoStudio },
    }),
    [
      segments,
      assets,
      invalid,
      tabs,
      readOnly,
      importFiles,
      retry,
      segmentOf,
      mainIds,
      syncIds,
      onGoStudio,
    ],
  );
}
