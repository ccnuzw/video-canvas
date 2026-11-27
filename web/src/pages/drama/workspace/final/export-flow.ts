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
  | { kind: "composing" }
  /** 下载成片 */
  | { kind: "downloading" }
  /** 完成 */
  | { kind: "done" }
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
