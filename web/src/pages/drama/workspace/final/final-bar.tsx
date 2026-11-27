import { useState } from "react";
import {
  ChevronDown,
  Download,
  Loader2,
  LocateFixed,
  Maximize2,
  Minimize2,
  RefreshCw,
  Undo2,
} from "lucide-react";

import type { Segment } from "@/api/drama/type";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SyncItem } from "@/store/drama-timeline";
import type { AutosaveStatus } from "@/utils/drama/autosave";
import { changeText } from "@/utils/drama/timeline";

/**
 * 成片剪辑台顶栏：集标题、片场同步胶囊和一个「导出」按钮。
 * 导出 = 保存时间线 → 后端 ffmpeg 按时间线合成 → 下载 mp4；进行中按钮上显示进度。
 */
export function FinalBar({
  no,
  title,
  save,
  sync,
  segments,
  exporting,
  exportReason,
  readOnly,
  onRetrySave,
  onLocate,
  onAckSync,
  onUndoSync,
  onExport,
  fullscreen,
  onToggleFullscreen,
}: {
  no: number;
  title: string;
  save: AutosaveStatus;
  sync: readonly SyncItem[];
  segments: readonly Segment[];
  /** 导出进行中按钮上显示的进度文字（如「合成中 45%」）；没在导出为 null */
  exporting: string | null;
  /** 不能导出的原因（放在悬停提示里）；能导出为 null */
  exportReason: string | null;
  readOnly: boolean;
  onRetrySave: () => void;
  /** 点同步条目定位到那一段；编辑器暂不支持定位时不传，条目就只是文字 */
  onLocate?: (clipId: string) => void;
  onAckSync: () => void;
  onUndoSync: () => void;
  onExport: () => void;
  /** 剪辑台是否铺满窗口 */
  fullscreen: boolean;
  /** 进入 / 退出全屏 */
  onToggleFullscreen: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-14 items-center gap-2.5 px-6 py-2.5">
      <h2 className="font-display truncate text-[17px] font-bold tracking-wide">
        第 {no} 集 · {title}
      </h2>
      {save === "error" && !readOnly && (
        <button
          type="button"
          onClick={onRetrySave}
          className="text-destructive shrink-0 text-xs hover:underline"
        >
          时间线保存失败 · 重试
        </button>
      )}
      {sync.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 text-xs font-medium text-sky-500 transition-colors hover:bg-sky-500/25"
              />
            }
          >
            <RefreshCw className="size-3" />
            片场更新 {sync.length}
            <ChevronDown className="size-3" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="bg-chrome ring-chrome-border w-80 gap-0 rounded-2xl p-2 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150"
          >
            <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11.5px]">已按片场自动同步</p>
            {sync.map((item, index) => {
              const locatable = !!item.clip && !!onLocate;
              return (
                <button
                  key={`${item.change.segmentId}-${item.change.kind}-${index}`}
                  type="button"
                  disabled={!locatable}
                  onClick={() => {
                    if (!item.clip || !onLocate) return;
                    setOpen(false);
                    onLocate(item.clip.id);
                  }}
                  className="hover:bg-chrome-hover flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      locatable ? "bg-sky-500" : "bg-muted-foreground",
                    )}
                  />
                  <span className={cn("flex-1", !locatable && "text-muted-foreground")}>
                    {changeText(item.change, segments, item.clip)}
                  </span>
                  {locatable && <LocateFixed className="text-muted-foreground size-3.5" />}
                </button>
              );
            })}
            <div className="border-chrome-border mt-1.5 flex items-center gap-2 border-t px-1 pt-2">
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    onUndoSync();
                  }}
                >
                  <Undo2 />
                  撤销同步
                </Button>
              )}
              <span className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onAckSync();
                }}
              >
                知道了
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      <span className="flex-1" />
      <button
        type="button"
        aria-label={fullscreen ? "退出全屏" : "全屏"}
        aria-pressed={fullscreen}
        title={fullscreen ? "退出全屏" : "全屏"}
        onClick={onToggleFullscreen}
        className="hover:bg-chrome-hover ring-chrome-border grid size-8 shrink-0 place-items-center rounded-full ring-1 transition-colors [&_svg]:size-4"
      >
        {fullscreen ? <Minimize2 /> : <Maximize2 />}
      </button>
      <Button
        size="sm"
        className="min-w-24 rounded-full"
        disabled={!!exportReason || !!exporting}
        title={exportReason ?? "按时间线合成并下载 mp4，不扣积分"}
        onClick={onExport}
      >
        {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        {exporting ?? "导出"}
      </Button>
    </div>
  );
}
