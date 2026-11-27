import { mapExportSpec } from "@/api/drama";
import type { DramaJob, EpisodeSummary, ExportSpec } from "@/api/drama/type";
import { clipEnd, clipLength } from "@/components/timeline-editor/model";
import type { ClipMedia, EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

/**
 * 导出弹窗的流程状态和导出单内容（纯函数）。
 * 导出 = 保存时间线 → 后端按时间线合成 → 下载成片；弹窗关掉流程照跑，顶栏按钮显示进度。
 */

/** 会失败的步骤 */
export type ExportStep = "saving" | "composing" | "downloading";

/** 导出走到哪一步 */
export type ExportPhase =
  /** 还没开始（弹窗里显示导出单） */
  | { kind: "idle" }
  /** 保存时间线 */
  | { kind: "saving" }
  /** 等后端合成 */
  | { kind: "composing"; jobId?: string; previousAssetId?: string }
  /** 下载成片 */
  | { kind: "downloading" }
  /** 完成 */
  | { kind: "done"; url: string }
  /** 在某一步失败；message 直接给用户看 */
  | { kind: "failed"; at: ExportStep; message: string };

/** 一步的状态：完成、进行中、等待、失败 */
export type StepState = "done" | "active" | "pending" | "failed";

/** 三步的顺序 */
const STEPS: ExportStep[] = ["saving", "composing", "downloading"];

/**
 * 总进度（0–100）：保存占前 4%，合成从 6% 到 94%，下载到 96%，完成是 100
 * @param phase 当前阶段
 * @param composeProgress 合成任务自己报的进度（0–100）
 */
export function overallProgress(phase: ExportPhase, composeProgress: number): number {
  switch (phase.kind) {
    case "saving":
      return 4;
    case "composing":
      return Math.round(6 + (Math.min(100, Math.max(0, composeProgress)) / 100) * 88);
    case "downloading":
      return 96;
    case "done":
      return 100;
    default:
      return 0;
  }
}

/** 保存、合成、下载三步各自的状态 */
export function stepStates(phase: ExportPhase): [StepState, StepState, StepState] {
  if (phase.kind === "idle") return ["pending", "pending", "pending"];
  if (phase.kind === "done") return ["done", "done", "done"];
  const current = phase.kind === "failed" ? phase.at : phase.kind;
  const at = STEPS.indexOf(current);
  const here: StepState = phase.kind === "failed" ? "failed" : "active";
  return STEPS.map((_, i) => (i < at ? "done" : i === at ? here : "pending")) as [
    StepState,
    StepState,
    StepState,
  ];
}

/** 是否正在导出（保存、合成或下载中） */
export const isRunning = (phase: ExportPhase): boolean =>
  phase.kind === "saving" || phase.kind === "composing" || phase.kind === "downloading";

/** 导出单上列的内容 */
export interface ExportSummary {
  /** 成片时长（毫秒）：主轨去掉跳过的占位后的长度，和附属轨最晚结束点取大 */
  durationMs: number;
  /** 主轨进成片的段数（不含待采用的占位） */
  main: number;
  /** 叠加画面段数 */
  overlay: number;
  /** 配音、BGM、音效段数 */
  audio: number;
  /** 字幕条数 */
  text: number;
  /** 合成时会跳过的片段名（待采用的占位） */
  skipped: string[];
  /** 封面：主轨第一段有缩略图的片段；没有为 null */
  posterUrl: string | null;
}

/**
 * 汇总导出单
 * @param timeline 当前时间线
 * @param resolve 宿主的素材解析
 */
export function summarizeExport(
  timeline: EditorTimeline,
  resolve: (clip: EditorClip) => ClipMedia,
): ExportSummary {
  const summary: ExportSummary = {
    durationMs: 0,
    main: 0,
    overlay: 0,
    audio: 0,
    text: 0,
    skipped: [],
    posterUrl: null,
  };
  let mainMs = 0;
  let attachedEnd = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (track.kind !== "main") {
        summary[track.kind] += 1;
        attachedEnd = Math.max(attachedEnd, clipEnd(clip));
        continue;
      }
      const media = resolve(clip);
      if (media.state === "placeholder") {
        // 名字里带着状态（如「片段 02 · 待采用」），只留片段名
        summary.skipped.push(media.label.split(" · ")[0]);
        continue;
      }
      summary.main += 1;
      mainMs += clipLength(clip);
      summary.posterUrl ??= media.thumbUrl;
    }
  }
  summary.durationMs = Math.max(mainMs, attachedEnd);
  return summary;
}

/** 默认导出规格：1080P、30fps、高画质 */
export const DEFAULT_SPEC: ExportSpec = { shortSide: 1080, fps: 30, quality: "high" };

/** 两份规格是否完全一样；旧成片没记规格（null）算不一样 */
export const sameSpec = (a: ExportSpec, b: ExportSpec | null): boolean =>
  !!b && a.shortSide === b.shortSide && a.fps === b.fps && a.quality === b.quality;

/**
 * 优先下载本次任务的结果；断线对账移除任务卡时，才从刷新后的集详情取新成片。
 * @param job 本次提交的任务
 * @param episode 刷新后的同一集
 * @param spec 本次导出规格
 * @param previousAssetId 提交前的成片素材 ID
 */
export function composedExportUrl(
  job: { status: DramaJob["status"]; result: { asset: { url: string } } | null } | undefined,
  episode:
    | {
        final: { id: string; url: string } | null;
        finalStale: EpisodeSummary["finalStale"];
        finalSpec: EpisodeSummary["finalSpec"];
      }
    | undefined,
  spec: ExportSpec,
  previousAssetId?: string,
): string | null {
  if (job) return job.status === "succeeded" ? (job.result?.asset.url ?? null) : null;
  if (!episode?.final || episode.finalStale || episode.final.id === previousAssetId) return null;
  return sameSpec(spec, episode.finalSpec) ? episode.final.url : null;
}

/** 取偶数（编码要求宽高是偶数） */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * 规格按项目比例换算成像素尺寸，如「1080 × 1920」；比例认不出来按 9:16
 * @param spec 导出规格
 * @param ratio 项目比例「宽:高」
 */
export function specSize(spec: ExportSpec, ratio: string): string {
  const [w, h] = /^\d+:\d+$/.test(ratio) ? ratio.split(":").map(Number) : [9, 16];
  const [rw, rh] = w > 0 && h > 0 ? [w, h] : [9, 16];
  const short = spec.shortSide;
  return rw <= rh
    ? `${short} × ${even((short * rh) / rw)}`
    : `${even((short * rw) / rh)} × ${short}`;
}

/** 存「上次选的规格」用的键 */
const SPEC_KEY = "drama-export-spec";

/** 读写规格用到的存储（默认 localStorage，测试可替换） */
type SpecStorage = Pick<Storage, "getItem" | "setItem">;

/** 当前环境的 localStorage；拿不到为 null */
function defaultStorage(): SpecStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读上次选的导出规格；没存过、读不到或内容不合法都用默认值
 * @param storage 存储，默认 localStorage
 */
export function readSpec(storage: SpecStorage | null = defaultStorage()): ExportSpec {
  try {
    const raw = JSON.parse(storage?.getItem(SPEC_KEY) ?? "null") as Partial<ExportSpec> | null;
    const spec = mapExportSpec(
      raw
        ? { short_side: raw.shortSide ?? 0, fps: raw.fps ?? 0, quality: raw.quality ?? "" }
        : null,
    );
    return spec ?? DEFAULT_SPEC;
  } catch {
    return DEFAULT_SPEC;
  }
}

/**
 * 记住这次选的导出规格；存储不可用时静默放弃
 * @param spec 导出规格
 * @param storage 存储，默认 localStorage
 */
export function writeSpec(spec: ExportSpec, storage: SpecStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(SPEC_KEY, JSON.stringify(spec));
  } catch {
    /* 存不下就只在本次有效 */
  }
}
