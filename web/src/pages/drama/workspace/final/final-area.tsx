import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { toast } from "sonner";

import { getAsset } from "@/api/asset";
import type { AssetDto } from "@/api/asset/type";
import type { Timeline, TimelineClip } from "@/api/drama/type";
import { finalFileName } from "@/components/drama/final-file";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useSharedWorkspace } from "@/hooks/use-shared-workspace";
import { useDramaJobsStore } from "@/store/drama";
import { segmentKey, useDramaSegmentsStore } from "@/store/drama-segments";
import { useDramaTimelineStore } from "@/store/drama-timeline";
import { downloadMedia } from "@/utils/canvas/download";
import { activeComposeJob, finalState } from "@/utils/drama/compose";
import { jobConflictReason } from "@/utils/drama/jobs";
import { reloadSegments } from "@/utils/drama/segment-events";
import type { WorkspaceStage } from "@/utils/drama/stages";
import {
  assetClip,
  clipAt,
  clipStarts,
  composeReason,
  insertClip,
  moveClip,
  removeClip,
  resolveClip,
  restoreLength,
  splitAt,
  swapTake,
  takeClip,
  totalMs,
  trimToPlayhead,
} from "@/utils/drama/timeline";

import { useCompose } from "../../use-compose";
import { useWorkspace } from "../context";
import type { TimelineDragPayload } from "./drag";
import { FinalBar } from "./final-bar";
import { MediaPanel } from "./media-panel";
import { TimelinePreview } from "./timeline-preview";
import { TimelineTrack, type TrackActions } from "./timeline-track";
import { useTimelinePlayer, type PlayerItem } from "./use-timeline-player";

/** 「x:y」比例转成 CSS aspect-ratio；认不出来用 9:16 */
const aspectOf = (ratio: string) => (/^\d+:\d+$/.test(ratio) ? ratio.replace(":", "/") : "9/16");

const NO_SEGMENTS: never[] = [];

/** 片场改动多久没有新变化才去对账（毫秒）：生成中片段状态推送很频繁，只在内容稳定后对一次 */
const RESYNC_DELAY = 600;

/** 分栏拖动条：透明的 12px 宽，留出卡片间距；悬停 / 拖动时中间亮一条主色细线 */
const HANDLE_COLUMN =
  "w-3 bg-transparent after:!w-3 before:absolute before:inset-y-2 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:transition-colors hover:before:bg-primary/60 data-[separator=active]:before:bg-primary";
const HANDLE_ROW =
  "!h-3 !w-full bg-transparent after:!h-3 before:absolute before:inset-x-2 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:rounded-full before:transition-colors hover:before:bg-primary/60 data-[separator=active]:before:bg-primary";

/**
 * 成片：剪辑台。左素材、右预览、下单轨时间线；顶栏是集标题、片场同步、统计和合成。
 * 时间线只存剪辑清单（自动保存），「合成」由后端按清单裁剪拼接，不扣积分。
 */
export function FinalArea({
  ep,
  onGo,
}: {
  ep: number;
  onGo: (stage: WorkspaceStage, ep?: number) => void;
}) {
  const shared = useSharedWorkspace();
  const { drama, jobs, applyEpisode, reportSave } = useWorkspace();
  const episode = drama.episodes.find((item) => item.no === ep) ?? drama.episodes[0];
  const no = episode?.no ?? 0;
  const ownSegments =
    useDramaSegmentsStore((state) => state.byEpisode[segmentKey(drama.id, no)]) ?? NO_SEGMENTS;
  const segments = shared ? (shared.segments[no] ?? NO_SEGMENTS) : ownSegments;

  const status = useDramaTimelineStore((state) => state.status);
  const readOnly = useDramaTimelineStore((state) => state.readOnly);
  const timeline = useDramaTimelineStore((state) => state.timeline);
  const invalidIds = useDramaTimelineStore((state) => state.invalid);
  const assetMap = useDramaTimelineStore((state) => state.assets);
  const sync = useDramaTimelineStore((state) => state.sync);
  const save = useDramaTimelineStore((state) => state.save);
  const savedCount = useDramaTimelineStore((state) => state.savedCount);
  const canUndo = useDramaTimelineStore((state) => state.undo.length > 0);
  const canRedo = useDramaTimelineStore((state) => state.redo.length > 0);
  const editor = useDramaTimelineStore.getState;

  const { compose } = useCompose(drama.id);
  // 竖屏（高大于宽的比例）：预览放右侧整列
  const [rw, rh] = /^\d+:\d+$/.test(drama.ratio) ? drama.ratio.split(":").map(Number) : [9, 16];
  const portrait = rh > rw;
  // 分栏尺寸每人记住：竖屏和横屏各存一份
  const portraitCols = useDefaultLayout({
    id: "drama-final-portrait-cols",
    panelIds: ["edit", "preview"],
  });
  const portraitRows = useDefaultLayout({
    id: "drama-final-portrait-rows",
    panelIds: ["media", "track"],
  });
  const landscapeRows = useDefaultLayout({
    id: "drama-final-landscape-rows",
    panelIds: ["top", "track"],
  });
  const landscapeCols = useDefaultLayout({
    id: "drama-final-landscape-cols",
    panelIds: ["media", "preview"],
  });
  const [selected, setSelected] = useState<string | null>(null);
  /** 导出进行到哪一步：保存时间线 / 等合成任务 / 下载；没在导出为 null */
  const [exportStep, setExportStep] = useState<"saving" | "composing" | "downloading" | null>(null);
  /** 这次导出提交的合成任务 ID，用来认出它结束了 */
  const exportJob = useRef<string | null>(null);

  // 片段读自片段接口：进到成片页（或换集）时拉一次，之后靠推送保持新鲜
  useEffect(() => {
    if (!shared && no > 0) void reloadSegments(drama.id, no);
  }, [drama.id, no, shared]);

  // 打开时间线：自己的剧读服务端（片段变化走下面的对账）；共享只读按片段现算默认时间线，片段变了就重算
  useEffect(() => {
    if (no > 0 && !shared) void editor().open(drama.id, no);
  }, [drama.id, no, shared, editor]);
  useEffect(() => {
    if (no > 0 && shared) editor().openShared(`${drama.id}:${no}`, segments);
  }, [drama.id, no, shared, segments, editor]);
  // 换集：清掉选中，放下进行中的导出（合成任务照常在后台跑完）
  const [shownEpisode, setShownEpisode] = useState(no);
  if (shownEpisode !== no) {
    setShownEpisode(no);
    setSelected(null);
    setExportStep(null);
  }

  /** 下载这一集的成片 */
  const downloadFinal = useCallback(
    async (url: string) => {
      setExportStep("downloading");
      try {
        await downloadMedia(url, finalFileName(drama.title, no));
      } finally {
        setExportStep(null);
      }
    },
    [drama.title, no],
  );

  // 导出提交了合成任务：任务失败或取消就停下；成功后等详情刷出新成片（不再过期）再下载
  useEffect(() => {
    if (exportStep !== "composing") return;
    const job = jobs.find((item) => item.id === exportJob.current);
    if (job && (job.status === "failed" || job.status === "canceled")) {
      exportJob.current = null;
      setExportStep(null);
      return;
    }
    if (job && job.status !== "succeeded") return;
    if (episode?.final && !episode.finalStale) {
      exportJob.current = null;
      void downloadFinal(episode.final.url);
    }
  }, [exportStep, jobs, episode, downloadFinal]);

  // 片场改了采用、增删片段、改顺序：内容稳定后对账一次
  const signature = segments
    .map(
      (s) =>
        `${s.id}:${s.seq}:${s.seconds}:${s.chosenTaskId}:${s.takes
          .filter((t) => t.status === "succeeded")
          .map((t) => t.taskId)
          .join(",")}`,
    )
    .join("|");
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (shared || status !== "ready") return;
    if (lastSignature.current === null || lastSignature.current === signature) {
      lastSignature.current = signature;
      return;
    }
    lastSignature.current = signature;
    const timer = setTimeout(() => void editor().resync(), RESYNC_DELAY);
    return () => clearTimeout(timer);
  }, [signature, shared, status, editor]);
  useEffect(() => {
    lastSignature.current = null;
  }, [drama.id, no]);

  // 保存状态汇报给顶栏；离开成片页时清掉
  useEffect(() => {
    reportSave("timeline", save);
  }, [save, reportSave]);
  useEffect(() => () => reportSave("timeline", "saved"), [reportSave]);

  // 保存过时间线：已有的成片随之过期（后端同时让片段版本自增）
  //    只认这次进来之后的保存：计数在编辑器里跨集累计
  const handledSaves = useRef(savedCount);
  useEffect(() => {
    if (savedCount === handledSaves.current) return;
    handledSaves.current = savedCount;
    if (episode?.final && !episode.finalStale) applyEpisode(episode.no, { finalStale: true });
  }, [savedCount, episode, applyEpisode]);

  const assets = useMemo(() => new Map(Object.entries(assetMap)), [assetMap]);
  const invalid = useMemo(() => new Set(invalidIds), [invalidIds]);
  const clips = timeline.clips;
  const sources = useMemo(
    () => clips.map((clip) => resolveClip(clip, segments, assets, invalid)),
    [clips, segments, assets, invalid],
  );
  const items = useMemo<PlayerItem[]>(() => {
    const starts = clipStarts(clips);
    return clips.map((clip, index) => ({
      id: clip.id,
      kind: sources[index].kind,
      url: sources[index].url,
      start: starts[index],
      inMs: clip.inMs,
      outMs: clip.outMs,
      muted: timeline.muted || clip.muted,
    }));
  }, [clips, sources, timeline.muted]);
  const player = useTimelinePlayer(items);
  const syncIds = useMemo(
    () => new Set(sync.flatMap((item) => (item.clip ? [item.clip.id] : []))),
    [sync],
  );
  const imports = useMemo(
    () => timeline.imports.flatMap((id) => (assetMap[id] ? [assetMap[id]] : [])),
    [timeline.imports, assetMap],
  );
  /** 时间线上用到的结果和素材，键为「task:ID」「asset:ID」（两种 ID 编码相同，可能撞成同一个串） */
  const onTimeline = useMemo(
    () =>
      new Set(
        clips.map((clip) =>
          clip.kind === "segment" ? `task:${clip.taskId}` : `asset:${clip.assetId}`,
        ),
      ),
    [clips],
  );

  const edit = useCallback((fn: (t: Timeline) => Timeline) => editor().edit(fn), [editor]);
  const editClip = useCallback(
    (id: string, fn: (clip: TimelineClip) => TimelineClip) =>
      edit((t) => ({ ...t, clips: t.clips.map((clip) => (clip.id === id ? fn(clip) : clip)) })),
    [edit],
  );

  /** 把拖入 / 点「+」的东西做成一段插到第 index 个位置；画布素材先读时长 */
  const insertPayload = useCallback(
    async (index: number, payload: TimelineDragPayload) => {
      let clip: TimelineClip;
      if (payload.type === "take") {
        const segment = segments.find((item) => item.id === payload.segmentId);
        if (!segment) return;
        clip = takeClip(segment, payload.taskId);
      } else {
        let asset: AssetDto;
        try {
          asset = payload.type === "asset" ? payload.asset : await getAsset(payload.assetId);
        } catch {
          toast.error("素材读取失败，可能已被删除");
          return;
        }
        if (asset.kind !== "video" && asset.kind !== "image") return;
        editor().addAssets([asset]);
        clip = assetClip(asset);
      }
      edit((t) => insertClip(t, index, clip));
      setSelected(clip.id);
    },
    [segments, edit, editor],
  );

  /** 播放头所在段之后的插入位置 */
  const afterPlayhead = useCallback(() => {
    const at = clipAt(clips, Math.min(player.time(), Math.max(0, totalMs(clips) - 1)));
    return at ? at.index + 1 : clips.length;
  }, [clips, player]);

  /** 操作的目标段：选中的，否则播放头所在的 */
  const targetIndex = useCallback(() => {
    const index = clips.findIndex((clip) => clip.id === selected);
    if (index >= 0) return index;
    return clipAt(clips, player.time())?.index ?? -1;
  }, [clips, selected, player]);

  const actions = useMemo<TrackActions>(
    () => ({
      select: setSelected,
      commitTrim: (clip) => editClip(clip.id, () => clip),
      move: (from, to) => edit((t) => ({ ...t, clips: moveClip(t.clips, from, to) })),
      drop: (index, payload) => void insertPayload(index, payload),
      split: () => {
        const result = splitAt(clips, player.time());
        if ("error" in result) return void toast.warning(result.error);
        edit((t) => ({ ...t, clips: result.clips }));
        setSelected(result.selectId);
      },
      trimLeft: () => {
        const result = trimToPlayhead(clips, targetIndex(), player.time(), "left");
        if ("error" in result) return void toast.warning(result.error);
        edit((t) => ({ ...t, clips: result.clips }));
        player.seek(result.playhead);
      },
      trimRight: () => {
        const result = trimToPlayhead(clips, targetIndex(), player.time(), "right");
        if ("error" in result) return void toast.warning(result.error);
        edit((t) => ({ ...t, clips: result.clips }));
      },
      remove: (id) => {
        const target = id ?? selected;
        if (!target) return void toast.warning("先选中一段");
        edit((t) => removeClip(t, target));
        setSelected(null);
      },
      undo: () => editor().undoEdit(),
      redo: () => editor().redoEdit(),
      toggleTrackMute: () => edit((t) => ({ ...t, muted: !t.muted })),
      toggleClipMute: (id) => editClip(id, (clip) => ({ ...clip, muted: !clip.muted })),
      restore: (id) => {
        const index = clips.findIndex((clip) => clip.id === id);
        if (index >= 0) editClip(id, (clip) => restoreLength(clip, sources[index].durationMs));
      },
      swap: (id, taskId) => {
        const clip = clips.find((item) => item.id === id);
        const segment = segments.find((item) => item.id === clip?.segmentId);
        if (!clip || !segment) return;
        const next = swapTake(clip, segment, taskId);
        editClip(id, () => next);
        toast.info(next.pinned ? "已换版本，这一段不再跟随片场的采用" : "已恢复跟随片场的采用");
      },
      goStudio: () => onGo("studio", no),
    }),
    [
      clips,
      sources,
      segments,
      selected,
      player,
      edit,
      editClip,
      editor,
      insertPayload,
      targetIndex,
      onGo,
      no,
    ],
  );

  // 快捷键：空格播放，S 拆分，Q/W 裁到播放头，Delete 删除，⌘Z / ⇧⌘Z 撤销重做
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]",
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        player.toggle();
        return;
      }
      if (readOnly) return;
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "s") actions.split();
      else if (key === "q") actions.trimLeft();
      else if (key === "w") actions.trimRight();
      else if ((key === "delete" || key === "backspace") && selected) {
        event.preventDefault();
        actions.remove();
      } else if (key === "escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, player, readOnly, selected]);

  if (!episode) {
    return (
      <p className="text-muted-foreground grid h-full place-items-center text-sm">还没有分集</p>
    );
  }

  const final = episode.final;
  const state = finalState(episode);
  const running = activeComposeJob(jobs, no);
  const busy = jobConflictReason(jobs, "compose", [no]);
  const reason =
    status !== "ready"
      ? "时间线还没读完"
      : (composeReason({ timeline, segments, assets, invalid, save }) ?? busy);

  const locate = (clipId: string) => {
    const index = clips.findIndex((clip) => clip.id === clipId);
    if (index < 0) return;
    setSelected(clipId);
    player.pause();
    player.seek(clipStarts(clips)[index]);
  };

  /**
   * 导出：先把没保存的剪辑存上（合成读的是服务端的时间线），再让后端按时间线合成，合成完自动下载；
   * 时间线合成后没改过就直接下载上次的成片。共享只读只能下载已有的成片。
   */
  const exportNow = async () => {
    if (readOnly) {
      if (final) void downloadFinal(final.url);
      return;
    }
    setExportStep("saving");
    const wasSaved = editor().save === "saved";
    if (!(await editor().flush())) return setExportStep(null);
    if (wasSaved && final && state === "fresh") return void downloadFinal(final.url);
    setExportStep("composing");
    if (!(await compose(no))) return setExportStep(null);
    exportJob.current =
      activeComposeJob(useDramaJobsStore.getState().byDrama[drama.id] ?? [], no)?.id ?? null;
  };
  const exportLabel =
    exportStep === "saving"
      ? "保存中…"
      : exportStep === "composing"
        ? `合成中 ${running?.progress ?? 0}%`
        : exportStep === "downloading"
          ? "下载中…"
          : null;
  const exportReason = readOnly ? (final ? null : "作者还没有导出过这一集") : reason;

  const mediaPanel = (
    <MediaPanel
      segments={segments}
      canvasId={drama.canvasId}
      imports={imports}
      onTimeline={onTimeline}
      aspect={aspectOf(drama.ratio)}
      readOnly={readOnly}
      onAdd={(payload) => void insertPayload(afterPlayhead(), payload)}
      onImported={(asset) => {
        editor().addAssets([asset]);
        edit((t) => ({
          ...t,
          imports: [asset.id, ...t.imports.filter((id) => id !== asset.id)],
        }));
      }}
    />
  );
  const preview = (
    <TimelinePreview
      player={player}
      items={items}
      labels={sources.map((source) => source.label)}
      aspect={aspectOf(drama.ratio)}
      muted={timeline.muted}
      readOnly={readOnly}
      onToggleMute={actions.toggleTrackMute}
      empty={status === "ready" && segments.length === 0 && clips.length === 0}
      onGoStudio={() => onGo("studio", no)}
    />
  );
  const track = (
    <TimelineTrack
      clips={clips}
      sources={sources}
      segments={segments}
      selected={selected}
      syncIds={syncIds}
      player={player}
      muted={timeline.muted}
      readOnly={readOnly}
      canUndo={canUndo}
      canRedo={canRedo}
      actions={actions}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FinalBar
        no={no}
        title={episode.title}
        save={save}
        sync={sync}
        segments={segments}
        exporting={exportLabel}
        exportReason={exportLabel ? null : exportReason}
        readOnly={readOnly || !!shared}
        onRetrySave={() => void editor().flush()}
        onLocate={locate}
        onAckSync={() => editor().ackSync()}
        onUndoSync={() => editor().undoSync()}
        onExport={() => void exportNow()}
      />
      {portrait ? (
        // 竖屏：预览在右侧整列，左侧上素材、下时间线；两条边都能拖
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1 px-6 pb-4"
          defaultLayout={portraitCols.defaultLayout}
          onLayoutChanged={portraitCols.onLayoutChanged}
        >
          <ResizablePanel id="edit" minSize={480}>
            <ResizablePanelGroup
              orientation="vertical"
              defaultLayout={portraitRows.defaultLayout}
              onLayoutChanged={portraitRows.onLayoutChanged}
            >
              <ResizablePanel id="media" minSize={160}>
                {mediaPanel}
              </ResizablePanel>
              <ResizableHandle className={HANDLE_ROW} />
              <ResizablePanel id="track" defaultSize={232} minSize={180} maxSize="70%">
                {track}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle className={HANDLE_COLUMN} />
          <ResizablePanel id="preview" defaultSize={400} minSize={260} maxSize="60%">
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        // 横屏：上面素材 + 预览，下面时间线；两条边都能拖
        <ResizablePanelGroup
          orientation="vertical"
          className="min-h-0 flex-1 px-6 pb-4"
          defaultLayout={landscapeRows.defaultLayout}
          onLayoutChanged={landscapeRows.onLayoutChanged}
        >
          <ResizablePanel id="top" minSize={240}>
            <ResizablePanelGroup
              orientation="horizontal"
              defaultLayout={landscapeCols.defaultLayout}
              onLayoutChanged={landscapeCols.onLayoutChanged}
            >
              <ResizablePanel id="media" defaultSize={300} minSize={220} maxSize="50%">
                {mediaPanel}
              </ResizablePanel>
              <ResizableHandle className={HANDLE_COLUMN} />
              <ResizablePanel id="preview" minSize={320}>
                {preview}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle className={HANDLE_ROW} />
          <ResizablePanel id="track" defaultSize={232} minSize={180} maxSize="60%">
            {track}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
