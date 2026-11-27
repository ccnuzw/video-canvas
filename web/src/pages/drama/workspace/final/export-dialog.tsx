import {
  Check,
  CircleCheck,
  CircleX,
  Download,
  Film,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { DialogSession } from "@/components/dialog-session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  isRunning,
  overallProgress,
  stepStates,
  type ExportPhase,
  type ExportSummary,
  type StepState,
} from "./export-flow";

/** 三步的名字，顺序和 stepStates 一致 */
const STEP_LABELS = ["保存时间线", "合成视频", "下载成片"] as const;

/** 进行中每一步的标题 */
const RUNNING_TITLE: Record<string, string> = {
  saving: "正在保存时间线",
  composing: "正在合成视频",
  downloading: "正在下载成片",
};

/** 毫秒 → 「分:秒」 */
const clock = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** 导出弹窗的内容属性 */
interface ExportPanelProps {
  /** 当前阶段 */
  phase: ExportPhase;
  /** 合成任务自己报的进度（0–100） */
  composeProgress: number;
  /** 导出单内容 */
  summary: ExportSummary;
  /** 下载下来的文件名 */
  fileName: string;
  /** 项目画面比例，如「9:16」 */
  ratio: string;
  /** 成片已是最新（时间线合成后没改过）：直接下载，不用再合成 */
  fresh: boolean;
  /** 开始导出 */
  onStart: () => void;
  /** 失败后重试 */
  onRetry: () => void;
  /** 完成后再次下载 */
  onDownload: () => void;
  /** 关闭弹窗（进行中关掉 = 转到后台继续） */
  onClose: () => void;
}

/**
 * 导出弹窗：确认导出单 → 三步进度（保存、合成、下载）→ 完成或失败。
 * 进行中可以关掉弹窗，导出在后台继续，顶栏按钮显示进度，点它再打开。
 */
export function ExportDialog({
  open,
  onOpenChange,
  title,
  ...panel
}: ExportPanelProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 副标题，如「第 1 集 · 闯入者」 */
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-chrome ring-chrome-border flex max-h-[min(88svh,40rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl backdrop-blur-xl backdrop-saturate-150 [corner-shape:squircle] sm:max-w-[30rem]">
        <div className="flex flex-col gap-1 px-5 pt-5 pb-1">
          <DialogTitle className="text-[15px] font-semibold">导出成片</DialogTitle>
          <DialogDescription className="text-muted-foreground text-[12.5px]">
            {title}
          </DialogDescription>
        </div>
        <DialogSession open={open}>
          <ExportPanel {...panel} />
        </DialogSession>
      </DialogContent>
    </Dialog>
  );
}

/** 弹窗正文：按阶段显示导出单、进度或结果，底部是对应的按钮 */
export function ExportPanel(props: ExportPanelProps) {
  const { phase } = props;
  if (phase.kind === "idle") return <ReadyView {...props} />;
  return <ProgressView {...props} />;
}

/** 导出单：封面 + 文件信息，有会被跳过的片段时提示 */
function ReadyView({ summary, fileName, ratio, fresh, onStart, onClose }: ExportPanelProps) {
  const parts = [
    `主轨 ${summary.main} 段`,
    summary.overlay > 0 && `叠加 ${summary.overlay} 段`,
    summary.audio > 0 && `音频 ${summary.audio} 段`,
    summary.text > 0 && `字幕 ${summary.text} 条`,
  ].filter(Boolean);
  const [rw, rh] = /^\d+:\d+$/.test(ratio) ? ratio.split(":") : ["9", "16"];
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        <div className="bg-chrome-hover/40 ring-chrome-border/60 flex gap-4 rounded-xl p-3 ring-1 [corner-shape:squircle]">
          <div
            style={{ aspectRatio: `${rw} / ${rh}` }}
            className="bg-muted relative grid max-h-36 w-24 shrink-0 place-items-center overflow-hidden rounded-lg"
          >
            {summary.posterUrl ? (
              <img src={summary.posterUrl} alt="" className="size-full object-cover" />
            ) : (
              <Film className="text-muted-foreground size-6" />
            )}
          </div>
          <dl className="grid min-w-0 flex-1 grid-cols-[40px_1fr] content-center gap-x-3 gap-y-2 text-[12.5px]">
            <Info label="文件">
              <span className="truncate font-medium" title={fileName}>
                {fileName}
              </span>
            </Info>
            <Info label="时长">
              <span className="font-mono">{clock(summary.durationMs)}</span>
            </Info>
            <Info label="画面">{ratio}</Info>
            <Info label="格式">MP4 · H.264 · AAC</Info>
            <Info label="内容">
              <span className="text-muted-foreground">{parts.join(" · ")}</span>
            </Info>
          </dl>
        </div>
        {summary.skipped.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{summary.skipped.join("、")} 还没有采用视频，合成时跳过</span>
          </div>
        )}
      </div>
      <Footer>
        <Button variant="ghost" className="rounded-full" onClick={onClose}>
          取消
        </Button>
        <Button className="min-w-28 rounded-full" onClick={onStart}>
          <Download />
          {fresh ? "下载" : "开始导出"}
        </Button>
      </Footer>
    </>
  );
}

/** 一行导出单信息 */
function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </>
  );
}

/** 进行中、完成、失败：大号状态 + 总进度条 + 三步列表 */
function ProgressView({
  phase,
  composeProgress,
  fileName,
  onRetry,
  onDownload,
  onClose,
}: ExportPanelProps) {
  const percent = overallProgress(phase, composeProgress);
  const states = stepStates(phase);
  const running = isRunning(phase);
  const failed = phase.kind === "failed";
  const done = phase.kind === "done";
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {done && <CircleCheck className="text-status-success size-6 shrink-0" />}
            {failed && <CircleX className="text-destructive size-6 shrink-0" />}
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">
                {done ? "导出完成" : failed ? "导出失败" : RUNNING_TITLE[phase.kind]}
              </p>
              <p className="text-muted-foreground truncate text-[12px]">
                {failed ? phase.message : fileName}
              </p>
            </div>
          </div>
          {!failed && (
            <span className="font-mono text-3xl font-semibold tabular-nums">{percent}%</span>
          )}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="导出进度"
          className="bg-muted h-1.5 overflow-hidden rounded-full"
        >
          <div
            style={{ width: `${failed ? 100 : percent}%` }}
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              failed ? "bg-destructive/60" : done ? "bg-status-success" : "bg-primary",
              running && "animate-pulse",
            )}
          />
        </div>
        <ol className="flex flex-col gap-1">
          {STEP_LABELS.map((label, index) => (
            <StepRow key={label} label={label} state={states[index]} />
          ))}
        </ol>
      </div>
      <Footer>
        {running && (
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            后台运行
          </Button>
        )}
        {done && (
          <>
            <Button variant="ghost" className="rounded-full" onClick={onDownload}>
              <Download />
              再次下载
            </Button>
            <Button className="min-w-24 rounded-full" onClick={onClose}>
              完成
            </Button>
          </>
        )}
        {failed && (
          <>
            <Button variant="ghost" className="rounded-full" onClick={onClose}>
              关闭
            </Button>
            <Button className="min-w-24 rounded-full" onClick={onRetry}>
              <RotateCcw />
              重试
            </Button>
          </>
        )}
      </Footer>
    </>
  );
}

/** 三步中的一步：状态图标 + 名字 */
function StepRow({ label, state }: { label: string; state: StepState }) {
  return (
    <li
      data-state={state}
      className={cn(
        "flex h-9 items-center gap-3 rounded-lg px-2.5 text-[12.5px]",
        state === "active" && "bg-chrome-hover/60",
      )}
    >
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          state === "done" && "bg-primary text-primary-foreground",
          state === "active" && "text-primary",
          state === "pending" && "ring-chrome-border ring-1",
          state === "failed" && "bg-destructive text-white",
        )}
      >
        {state === "done" && <Check className="size-3" strokeWidth={3} />}
        {state === "active" && <Loader2 className="size-4 animate-spin" />}
        {state === "failed" && <CircleX className="size-3.5" />}
      </span>
      <span
        className={cn(
          state === "pending" ? "text-muted-foreground" : "text-foreground",
          state === "active" && "font-semibold",
        )}
      >
        {label}
      </span>
    </li>
  );
}

/** 底部按钮区 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="border-chrome-border flex justify-end gap-2 border-t px-5 py-3.5">
      {children}
    </div>
  );
}
