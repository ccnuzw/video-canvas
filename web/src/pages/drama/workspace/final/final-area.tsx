import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExportSpec } from "@/api/drama/type";
import { TimelineEditor } from "@/components/timeline-editor";
import { finalFileName } from "@/components/drama/final-file";
import { useSharedWorkspace } from "@/hooks/use-shared-workspace";
import { cn } from "@/lib/utils";
import { segmentKey, useDramaSegmentsStore } from "@/store/drama-segments";
import { useDramaTimelineStore } from "@/store/drama-timeline";
import { downloadMedia } from "@/utils/canvas/download";
import { activeComposeJob, finalState } from "@/utils/drama/compose";
import { jobConflictReason } from "@/utils/drama/jobs";
import { reloadSegments } from "@/utils/drama/segment-events";
import type { WorkspaceStage } from "@/utils/drama/stages";
import { composeReason } from "@/utils/drama/timeline";

import { useCompose } from "../../use-compose";
import { useWorkspace } from "../context";

import { ExportDialog } from "./export-dialog";
import {
  composedExportUrl,
  readSpec,
  sameSpec,
  summarizeExport,
  writeSpec,
  type ExportPhase,
} from "./export-flow";
import { FinalBar } from "./final-bar";
import { readFullscreen, writeFullscreen } from "./fullscreen";
import { useFinalHost } from "./use-final-host";

const NO_SEGMENTS: never[] = [];

/** 片场改动多久没有新变化才去对账（毫秒）：生成中片段状态推送很频繁，只在内容稳定后对一次 */
const RESYNC_DELAY = 600;

/**
 * 成片：剪辑台。素材 / 属性、预览和多轨时间线都在通用的多轨编辑器里，这里只负责短剧的部分：
 * 打开和对账时间线、自动保存、片场同步提示，以及顶栏的导出。
 * 时间线只存剪辑清单（自动保存），「导出」由后端按清单合成，不扣积分。
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
  const history = useDramaTimelineStore((state) => state.history);
  const editor = useDramaTimelineStore.getState;

  const { compose } = useCompose(drama.id);
  /** 导出走到哪一步；弹窗关掉流程照跑 */
  const [phase, setPhase] = useState<ExportPhase>({ kind: "idle" });
  const [exportOpen, setExportOpen] = useState(false);
  /** 导出规格：按浏览器记住上次的选择 */
  const [spec, setSpec] = useState<ExportSpec>(readSpec);
  const changeSpec = (next: ExportSpec) => {
    setSpec(next);
    writeSpec(next);
  };

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
  /** 剪辑台铺满窗口（盖住工作区顶栏和分集栏）；按浏览器记住上次的选择 */
  const [fullscreen, setFullscreen] = useState(readFullscreen);
  const toggleFullscreen = () => {
    setFullscreen((on) => {
      writeFullscreen(!on);
      return !on;
    });
  };
  /** 顶栏「片场更新」点某一条：让编辑器选中并定位到那一段（nonce 每次加一） */
  const [focus, setFocus] = useState<{ clipId: string; nonce: number } | undefined>();
  // 换集：放下进行中的导出、关掉弹窗（合成任务照常在后台跑完）
  const [shownEpisode, setShownEpisode] = useState(no);
  if (shownEpisode !== no) {
    setShownEpisode(no);
    setPhase({ kind: "idle" });
    setExportOpen(false);
  }

  /** 下载这一集的成片；失败停在「下载」这一步 */
  const downloadFinal = useCallback(
    async (url: string) => {
      setPhase({ kind: "downloading" });
      try {
        await downloadMedia(url, finalFileName(drama.title, no));
        setPhase({ kind: "done", url });
      } catch {
        setPhase({ kind: "failed", at: "downloading", message: "下载没有完成，请重试" });
      }
    },
    [drama.title, no],
  );

  // 跟踪本次提交的任务；断线时用重新拉取的集详情恢复下载
  useEffect(() => {
    if (phase.kind !== "composing" || !phase.jobId) return;
    const job = jobs.find((item) => item.id === phase.jobId);
    if (job && (job.status === "failed" || job.status === "canceled")) {
      const message =
        job.status === "canceled" ? "合成已取消" : job.errorMessage || "合成失败，请重试";
      setPhase({ kind: "failed", at: "composing", message });
      return;
    }
    const url = composedExportUrl(job, episode, spec, phase.previousAssetId);
    if (url) void downloadFinal(url);
  }, [phase, jobs, episode, downloadFinal, spec]);

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
  const syncIds = useMemo(
    () => new Set(sync.flatMap((item) => (item.clip ? [item.clip.id] : []))),
    [sync],
  );
  const imports = useMemo(
    () => timeline.imports.flatMap((id) => (assetMap[id] ? [assetMap[id]] : [])),
    [timeline.imports, assetMap],
  );
  const goStudio = useCallback(() => onGo("studio", no), [onGo, no]);
  const host = useFinalHost({
    canvasId: drama.canvasId,
    segments,
    timeline,
    assets,
    invalid,
    syncIds,
    imports,
    readOnly,
    onGoStudio: goStudio,
  });
  // 编辑器只认轨道；删除名单、已导入由短剧自己维护
  const editorTimeline = useMemo(() => ({ tracks: timeline.tracks }), [timeline.tracks]);
  /** 导出单：时长、各轨段数、会跳过的片段、封面 */
  const exportSummary = useMemo(
    () => summarizeExport(editorTimeline, host.resolve),
    [editorTimeline, host.resolve],
  );
  const editorHistory = useMemo(
    () => ({
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      undo: () => editor().undoEdit(),
      redo: () => editor().redoEdit(),
    }),
    [history, editor],
  );

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

  /** 成片已是最新：时间线合成后没改过、规格也和上次一样，直接下载上次的成片（共享只读只能下载已有的成片） */
  const fresh = readOnly
    ? !!final
    : save === "saved" && !!final && state === "fresh" && sameSpec(spec, episode.finalSpec);

  /**
   * 导出：先把没保存的剪辑存上（合成读的是服务端的时间线），再让后端按时间线合成，合成完自动下载；
   * 时间线合成后没改过就直接下载上次的成片。每一步失败都停在那一步，弹窗里显示原因和重试。
   */
  const exportNow = async () => {
    if (readOnly) {
      if (final) void downloadFinal(final.url);
      return;
    }
    setPhase({ kind: "saving" });
    const wasSaved = editor().save === "saved";
    if (!(await editor().flush())) {
      return setPhase({ kind: "failed", at: "saving", message: "时间线没保存成功，请重试" });
    }
    if (wasSaved && final && state === "fresh" && sameSpec(spec, episode.finalSpec)) {
      return void downloadFinal(final.url);
    }
    setPhase({ kind: "composing" });
    const job = await compose(no, spec);
    if (!job) {
      return setPhase({ kind: "failed", at: "composing", message: "合成任务没有提交成功，请重试" });
    }
    setPhase({ kind: "composing", jobId: job.id, previousAssetId: final?.id });
  };
  /** 顶栏「导出」：打开弹窗；上次已结束（完成或失败）就回到导出单，进行中就看进度 */
  const openExport = () => {
    if (phase.kind === "done" || phase.kind === "failed") setPhase({ kind: "idle" });
    setExportOpen(true);
  };
  const exportLabel =
    phase.kind === "saving"
      ? "保存中…"
      : phase.kind === "composing"
        ? `合成中 ${running?.progress ?? 0}%`
        : phase.kind === "downloading"
          ? "下载中…"
          : null;
  const exportReason = readOnly ? (final ? null : "作者还没有导出过这一集") : reason;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        // 全屏：铺满浏览器窗口，盖住工作区的顶栏和分集栏；菜单、弹层和提示挂在 body 上，层级更高，照常可见
        fullscreen ? "bg-background fixed inset-0 z-40" : "h-full",
      )}
    >
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
        onLocate={(clipId) => setFocus((prev) => ({ clipId, nonce: (prev?.nonce ?? 0) + 1 }))}
        onAckSync={() => editor().ackSync()}
        onUndoSync={() => editor().undoSync()}
        onExport={openExport}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
      <div className="min-h-0 flex-1 px-6 pb-4">
        <TimelineEditor
          timeline={editorTimeline}
          onChange={(next) => editor().applyEditor(next)}
          history={editorHistory}
          host={host}
          readOnly={readOnly}
          ratio={drama.ratio}
          focus={focus}
          layoutId="drama-final"
        />
      </div>
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={`第 ${no} 集 · ${episode.title}`}
        phase={phase}
        composeProgress={running?.progress ?? (phase.kind === "composing" ? 0 : 100)}
        summary={exportSummary}
        fileName={finalFileName(drama.title, no)}
        ratio={drama.ratio}
        fresh={fresh}
        spec={spec}
        onSpecChange={changeSpec}
        onStart={() => void exportNow()}
        onRetry={() => void exportNow()}
        onDownload={() => phase.kind === "done" && void downloadFinal(phase.url)}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
