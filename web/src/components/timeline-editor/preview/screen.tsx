import { VolumeX } from "lucide-react";
import { useEffect, useRef, type Ref } from "react";

import { cn } from "@/lib/utils";

import { activeTexts, kindOf, type MountedMedia } from "../player-plan";
import type { PlayerApi } from "../use-player";
import type { EditorTimeline } from "../types";

/** 字幕的基础字号（占画面宽度的百分比），标题更大 */
const TEXT_SIZE = { subtitle: 4.6, title: 7.5 } as const;

/** 文字的竖向位置 */
const TEXT_POS = {
  top: { top: "12%" },
  middle: { top: "50%", transform: "translateY(-50%)" },
  bottom: { bottom: "9%" },
} as const;

/**
 * 预览画面：主轨（两个 video 交替、图片、占位或失效提示）+ 叠加画面（上层盖下层）+ 字幕和标题。
 * 叠加画面、音频的元素由播放器登记并直接控制显隐、不透明度和音量。
 */
export function PreviewScreen({
  timeline,
  items,
  mainIndex,
  activeSlot,
  at,
  attached,
  bindVideo,
  bindImage,
  register,
  ratio,
  screenEl,
}: {
  timeline: EditorTimeline;
  /** 主轨的播放项 */
  items: PlayerApi["items"];
  /** 主轨当前画面是第几段；没有为 -1 */
  mainIndex: number;
  /** 正在显示画面的主轨 video 槽位 */
  activeSlot: PlayerApi["activeSlot"];
  /** 最近一次画面内容变化的时刻（毫秒） */
  at: number;
  /** 窗口内挂载的叠加画面和音频 */
  attached: PlayerApi["mounted"];
  /** 主轨 video 的 ref 回调 */
  bindVideo: PlayerApi["bindVideo"];
  /** 主轨图片的 ref 回调 */
  bindImage: PlayerApi["bindImage"];
  /** 叠加媒体登记 */
  register: PlayerApi["register"];
  /** CSS aspect-ratio，如 9/16 */
  ratio: string;
  /** 画面容器的 ref，全屏用 */
  screenEl: Ref<HTMLDivElement>;
}) {
  const item = items[mainIndex];
  const kind = item ? kindOf(item) : null;
  const texts = activeTexts(timeline, at);

  return (
    <div
      ref={screenEl}
      style={{ aspectRatio: ratio, containerType: "inline-size" }}
      className="relative h-full max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-[0_30px_60px_-30px_rgb(0_0_0/0.8)] ring-1 ring-white/10"
    >
      {([0, 1] as const).map((slot) => (
        <video
          key={slot}
          ref={bindVideo(slot)}
          playsInline
          preload="auto"
          className={cn(
            "absolute inset-0 size-full object-contain",
            kind === "video" && activeSlot === slot ? "visible" : "invisible",
          )}
        />
      ))}
      {kind === "image" && item?.media.url && (
        <img
          ref={bindImage}
          src={item.media.url}
          alt=""
          className="absolute inset-0 size-full object-contain"
        />
      )}
      {(kind === "placeholder" || kind === "broken") && item && (
        <div className="absolute inset-0 grid place-items-center px-4 text-center text-white">
          <div>
            <div
              className={cn("text-[15px] font-semibold", kind === "broken" && "text-destructive")}
            >
              {item.media.label}
            </div>
            <div className="mt-1 text-xs opacity-70">
              {kind === "placeholder" ? "暂无可用素材" : "素材已失效"}
            </div>
          </div>
        </div>
      )}
      {attached.map((media) => (
        <AttachedMedia key={media.id} media={media} register={register} />
      ))}
      {texts.map((clip) => {
        const text = clip.text;
        if (!text) return null;
        return (
          <div
            key={clip.id}
            style={{
              ...TEXT_POS[text.pos],
              fontSize: `${TEXT_SIZE[text.style] * (text.size / 100)}cqw`,
            }}
            className={cn(
              "absolute inset-x-[6%] text-center leading-snug whitespace-pre-wrap text-white [text-shadow:0_0_3px_#000,0_0_3px_#000,0_1px_2px_#000]",
              text.style === "title" ? "font-extrabold tracking-wider" : "font-semibold",
            )}
          >
            {text.text}
          </div>
        );
      })}
      {item?.muted && kind === "video" && (
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
          <VolumeX className="size-3" />
          静音
        </span>
      )}
    </div>
  );
}

/**
 * 一个叠加画面或音频的元素：挂上时向播放器登记，之后显隐、不透明度、音量、播放位置都由播放器直接控制。
 * 叠加画面按 overlay 的位置和宽度摆放，初始隐藏，到点才由播放器显示。
 */
function AttachedMedia({
  media,
  register,
}: {
  media: MountedMedia;
  register: PlayerApi["register"];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const { id } = media;
  useEffect(() => {
    register(id, video.current ?? audio.current ?? image.current);
    return () => register(id, null);
  }, [id, register]);

  if (media.kind === "audio") {
    return <audio ref={audio} src={media.url} preload="auto" />;
  }
  const overlay = media.clip.overlay;
  const style = {
    left: `${overlay?.x ?? 50}%`,
    top: `${overlay?.y ?? 50}%`,
    width: `${overlay?.scale ?? 100}%`,
    visibility: "hidden" as const,
  };
  const cls = "absolute -translate-x-1/2 -translate-y-1/2 object-contain";
  return media.kind === "video" ? (
    <video ref={video} src={media.url} playsInline preload="auto" style={style} className={cls} />
  ) : (
    <img ref={image} src={media.url} alt="" style={style} className={cls} />
  );
}
