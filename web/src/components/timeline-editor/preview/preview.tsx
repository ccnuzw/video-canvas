import { Film, Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { timelineEnd } from "../model";
import type { PlayerApi } from "../use-player";
import type { EditorTimeline } from "../types";
import { PreviewScreen } from "./screen";
import { Timecode, timecode } from "./timecode";

/** 时间线上是不是什么都没有 */
const isBlank = (timeline: EditorTimeline): boolean =>
  timeline.tracks.every((track) => track.clips.length === 0);

/**
 * 编辑器预览：画面 + 播放 / 暂停、时码、主轨静音、全屏。
 * 时间线完全为空时显示空状态（图标 + 标题 + 宿主给的入口）。
 */
export function Preview({
  timeline,
  player,
  ratio,
  readOnly,
  emptyTitle = "还没有内容",
  emptyAction,
  onToggleMainMute,
}: {
  timeline: EditorTimeline;
  player: PlayerApi;
  /** CSS aspect-ratio，如 9/16 */
  ratio: string;
  readOnly: boolean;
  /** 空状态标题 */
  emptyTitle?: string;
  /** 空状态的入口按钮 */
  emptyAction?: { label: string; run: () => void };
  /** 切换主轨静音 */
  onToggleMainMute: () => void;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const empty = isBlank(timeline);
  const mainMuted = timeline.tracks.find((track) => track.kind === "main")?.muted ?? false;

  return (
    <section
      aria-label="预览"
      className="bg-chrome ring-chrome-border relative flex size-full min-w-0 flex-col rounded-2xl ring-1 ring-inset [corner-shape:squircle]"
    >
      <div className="grid min-h-0 flex-1 place-items-center px-3 pt-4 pb-2">
        {empty ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-[18px]">
              <Film className="size-6" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold">{emptyTitle}</h3>
            {emptyAction && (
              <Button variant="outline" onClick={emptyAction.run}>
                {emptyAction.label}
              </Button>
            )}
          </div>
        ) : (
          <PreviewScreen
            timeline={timeline}
            items={player.items}
            mainIndex={player.mainIndex}
            activeSlot={player.activeSlot}
            at={player.at}
            attached={player.mounted}
            bindVideo={player.bindVideo}
            bindImage={player.bindImage}
            register={player.register}
            ratio={ratio}
            screenEl={screen}
          />
        )}
      </div>

      {!empty && (
        <div className="flex items-center gap-3 px-4 pb-3">
          <span className="flex-1" />
          <button
            type="button"
            aria-label={player.playing ? "暂停" : "播放"}
            title={player.playing ? "暂停（空格）" : "播放（空格）"}
            onClick={player.handle.toggle}
            className="hover:bg-chrome-hover grid size-8 place-items-center rounded-full disabled:opacity-35"
          >
            {player.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <span className="flex items-center gap-1">
            <Timecode player={player.handle} />
            <span className="text-muted-foreground font-mono text-[12.5px] tabular-nums">
              / {timecode(timelineEnd(timeline))}
            </span>
          </span>
          <span className="flex flex-1 items-center justify-end gap-1">
            <button
              type="button"
              aria-label={mainMuted ? "取消主轨静音" : "主轨静音"}
              title={mainMuted ? "取消主轨静音" : "主轨静音"}
              disabled={readOnly}
              onClick={onToggleMainMute}
              className={cn(
                "hover:bg-chrome-hover grid size-8 place-items-center rounded-full disabled:opacity-35",
                mainMuted && "text-primary",
              )}
            >
              {mainMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <button
              type="button"
              aria-label="全屏"
              title="全屏"
              onClick={() => void screen.current?.requestFullscreen?.()}
              className="hover:bg-chrome-hover grid size-8 place-items-center rounded-full"
            >
              <Maximize className="size-4" />
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
