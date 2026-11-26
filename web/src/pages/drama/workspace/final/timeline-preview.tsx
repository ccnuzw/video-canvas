import { useSyncExternalStore } from "react";
import { Clapperboard, Film, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PlayerItem, TimelinePlayer } from "./use-timeline-player";

/** 毫秒写成 00:00.00（最后两位是帧，按 30fps） */
export const timecode = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${pad(s / 60)}:${pad(s % 60)}.${pad((s % 1) * 30)}`;
};

/** 当前时间码：每帧订阅播放器时钟，只有显示的值变了才重渲染 */
function Timecode({ player }: { player: TimelinePlayer }) {
  const frame = useSyncExternalStore(player.subscribe, () => Math.floor(player.time() / 33));
  return <span className="font-mono text-[12.5px] tabular-nums">{timecode(frame * 33)}</span>;
}

/**
 * 成片剪辑台的预览：按时间线清单播放（两个 video 交替，图片和待采用占位按时长显示）。
 */
export function TimelinePreview({
  player,
  items,
  labels,
  aspect,
  muted,
  readOnly,
  onToggleMute,
  empty,
  onGoStudio,
}: {
  player: TimelinePlayer;
  items: readonly PlayerItem[];
  /** 每段在画面上显示的名字（占位、失效时用） */
  labels: readonly string[];
  aspect: string;
  muted: boolean;
  readOnly: boolean;
  onToggleMute: () => void;
  /** 这一集还没有片段也没有任何段 */
  empty: boolean;
  onGoStudio: () => void;
}) {
  const item = items[player.index];

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
            <h3 className="text-[15px] font-semibold">这一集还没有片段</h3>
            <Button variant="outline" onClick={onGoStudio}>
              <Clapperboard />
              去片场
            </Button>
          </div>
        ) : (
          <div
            style={{ aspectRatio: aspect }}
            className="relative h-full max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-[0_30px_60px_-30px_rgb(0_0_0/0.8)] ring-1 ring-white/10"
          >
            <>
              {([0, 1] as const).map((slot) => (
                <video
                  key={slot}
                  ref={player.videoRef(slot)}
                  playsInline
                  preload="auto"
                  className={cn(
                    "absolute inset-0 size-full object-contain",
                    item?.kind === "video" && player.activeSlot === slot ? "visible" : "invisible",
                  )}
                />
              ))}
              {item?.kind === "image" && item.url && (
                <img src={item.url} alt="" className="absolute inset-0 size-full object-contain" />
              )}
              {(item?.kind === "placeholder" || item?.kind === "broken") && (
                <div className="absolute inset-0 grid place-items-center px-4 text-center text-white">
                  <div>
                    <div
                      className={cn(
                        "text-[15px] font-semibold",
                        item.kind === "broken" && "text-destructive",
                      )}
                    >
                      {item.kind === "placeholder"
                        ? `${labels[player.index]} 待采用`
                        : `${labels[player.index]} 素材已失效`}
                    </div>
                    <div className="mt-1 text-xs opacity-70">
                      {item.kind === "placeholder" ? "合成时跳过" : "请换版本或删掉这一段"}
                    </div>
                  </div>
                </div>
              )}
              {item?.muted && (
                <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
                  <VolumeX className="size-3" />
                  静音
                </span>
              )}
            </>
          </div>
        )}
      </div>

      {!empty && (
        <div className="flex items-center gap-3 px-4 pb-3">
          <span className="flex-1" />
          <button
            type="button"
            aria-label={player.playing ? "暂停" : "播放"}
            title={player.playing ? "暂停（空格）" : "播放（空格）"}
            onClick={player.toggle}
            disabled={items.length === 0}
            className="hover:bg-chrome-hover grid size-8 place-items-center rounded-full disabled:opacity-35"
          >
            {player.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <span className="flex items-center gap-1">
            <Timecode player={player} />
            <span className="text-muted-foreground font-mono text-[12.5px] tabular-nums">
              / {timecode(player.total)}
            </span>
          </span>
          <span className="flex flex-1 justify-end">
            <button
              type="button"
              aria-label={muted ? "取消整轨静音" : "整轨静音"}
              title={muted ? "取消整轨静音" : "整轨静音"}
              disabled={readOnly}
              onClick={onToggleMute}
              className={cn(
                "hover:bg-chrome-hover grid size-8 place-items-center rounded-full disabled:opacity-35",
                muted && "text-primary",
              )}
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
