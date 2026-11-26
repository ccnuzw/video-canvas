import { Image as ImageIcon, Pin, TriangleAlert, VolumeX } from "lucide-react";
import type { PointerEvent } from "react";

import { cn } from "@/lib/utils";

import { clipLength } from "../model";
import type { ClipBadges, ClipMedia, EditorClip, EditorTrack } from "../types";
import { AudioWave } from "./audio-wave";
import { clipBox, formatSeconds } from "./layout";
import type { ClipPart } from "./use-timeline-drag";

/** 音频轨角色的底色：配音、背景音乐、音效 */
const ROLE_BG = {
  voice: "bg-amber-700/55",
  music: "bg-orange-700/55",
  sfx: "bg-emerald-700/55",
} as const;

/** 文字阴影，让白字在任何缩略图上都看得清 */
const SHADOW = "text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]";

/** 时间线上的一个片段 */
export interface ClipBlockProps {
  /** 片段 */
  clip: EditorClip;
  /** 所在轨道 */
  track: EditorTrack;
  /** 素材解析结果；文字片段为 null */
  media: ClipMedia | null;
  /** 每秒多少像素 */
  pps: number;
  /** 是否选中 */
  selected: boolean;
  /** 宿主的标记 */
  badges: ClipBadges;
  /** 是否正被拖动（变淡） */
  dragging: boolean;
  /** 拖动中的落点不合法（红框） */
  invalidDrop: boolean;
  /** 能编辑（没有只读、轨道没锁定） */
  editable: boolean;
  /** 拖动中显示在片段中间的胶囊文字；没有为 null */
  pill: string | null;
  /** 在片段的某个部位按下 */
  onPointerDown: (event: PointerEvent, part: ClipPart) => void;
}

/** 片段背景：缩略图、色块、斜纹、波形 */
function ClipBackground({
  clip,
  track,
  media,
  width,
  height,
}: {
  clip: EditorClip;
  track: EditorTrack;
  media: ClipMedia | null;
  width: number;
  height: number;
}) {
  if (clip.type === "text") return <div className="absolute inset-0 bg-violet-500/50" />;
  if (media?.state === "broken") return <div className="bg-destructive/15 absolute inset-0" />;
  if (media?.state === "placeholder") return null;
  if (clip.type === "audio") {
    return (
      <>
        <div className={cn("absolute inset-0", ROLE_BG[track.role ?? "sfx"])} />
        <AudioWave clip={clip} url={media?.url ?? null} width={width} height={height} />
        <span
          style={{ top: `${(1 - Math.min(clip.volume, 200) / 200) * 100}%` }}
          className="pointer-events-none absolute inset-x-0 z-[1] border-t-[1.5px] border-white/70"
        />
      </>
    );
  }
  return (
    <div
      style={media?.thumbUrl ? { backgroundImage: `url("${media.thumbUrl}")` } : undefined}
      className="absolute inset-0 bg-neutral-800 bg-[length:auto_100%] bg-repeat-x"
    />
  );
}

/** 淡入淡出的三角遮罩和上沿的拖动手柄 */
function Fades({
  clip,
  width,
  pps,
  selected,
  editable,
  onPointerDown,
}: {
  clip: EditorClip;
  width: number;
  pps: number;
  selected: boolean;
  editable: boolean;
  onPointerDown: ClipBlockProps["onPointerDown"];
}) {
  const inPx = (clip.fadeInMs / 1000) * pps;
  const outPx = (clip.fadeOutMs / 1000) * pps;
  const handle = (part: "fadeIn" | "fadeOut", left: number) => (
    <span
      key={part}
      style={{ left }}
      onPointerDown={(event) => onPointerDown(event, part)}
      className={cn(
        "absolute top-0.5 z-20 size-2.5 -translate-x-1/2 cursor-ew-resize rounded-full bg-white shadow-[0_0_0_1.5px_rgb(0_0_0/0.45)]",
        selected ? "block" : "hidden group-hover:block",
      )}
    />
  );
  return (
    <>
      {inPx > 0 && (
        <span
          style={{ width: Math.min(inPx, width) }}
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] bg-black/45 [clip-path:polygon(0_0,100%_0,0_100%)]"
        />
      )}
      {outPx > 0 && (
        <span
          style={{ width: Math.min(outPx, width) }}
          className="pointer-events-none absolute inset-y-0 right-0 z-[1] bg-black/45 [clip-path:polygon(0_0,100%_0,100%_100%)]"
        />
      )}
      {editable && handle("fadeIn", Math.max(6, inPx))}
      {editable && handle("fadeOut", Math.min(width - 6, width - outPx))}
    </>
  );
}

/**
 * 时间线上的一个片段：缩略图 / 波形 / 文字、名字和时长、静音和宿主标记、
 * 淡入淡出遮罩与手柄、左右裁剪手柄。占位是斜纹灰块，失效是红描边，选中是主色描边。
 */
export function ClipBlock({
  clip,
  track,
  media,
  pps,
  selected,
  badges,
  dragging,
  invalidDrop,
  editable,
  pill,
  onPointerDown,
}: ClipBlockProps) {
  const len = clipLength(clip);
  const { left, width } = clipBox(clip.startMs, len, pps);
  const placeholder = media?.state === "placeholder";
  const broken = media?.state === "broken";
  const ready = clip.type === "text" || media?.state === "ready";
  const isText = clip.type === "text";
  const label = isText ? (clip.text?.text ?? "") : (media?.label ?? "");
  const rowHeight = track.kind === "main" ? 56 : track.kind === "overlay" ? 38 : 36;

  return (
    <div
      data-clip={clip.id}
      style={{ left, width }}
      onPointerDown={(event) => onPointerDown(event, "body")}
      className={cn(
        "group absolute inset-y-1 overflow-hidden rounded-lg border-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25)]",
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        invalidDrop
          ? "border-destructive"
          : selected
            ? "border-primary"
            : broken
              ? "border-destructive"
              : badges.marked
                ? "border-sky-400"
                : "border-transparent",
        placeholder &&
          "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_8px,transparent_8px_16px)]",
        dragging && "opacity-35",
      )}
    >
      <ClipBackground clip={clip} track={track} media={media} width={width} height={rowHeight} />
      {ready && !isText && (
        <Fades
          clip={clip}
          width={width}
          pps={pps}
          selected={selected}
          editable={editable}
          onPointerDown={onPointerDown}
        />
      )}
      <span
        className={cn(
          "absolute left-1.5 z-[2] flex max-w-[calc(100%-12px)] items-center gap-1 truncate text-[11px] [&_svg]:size-3",
          isText ? "top-1/2 -translate-y-1/2" : "top-0.5",
          placeholder ? "text-muted-foreground" : SHADOW,
        )}
      >
        {badges.pinned && <Pin />}
        {clip.type === "image" && <ImageIcon />}
        {label}
      </span>
      {!isText && (
        <span
          className={cn(
            "absolute bottom-0.5 left-1.5 z-[2] font-mono text-[10.5px]",
            placeholder ? "text-muted-foreground" : SHADOW,
          )}
        >
          {formatSeconds(len)}
        </span>
      )}
      <span className="absolute right-1.5 bottom-0.5 z-[2] flex gap-1 text-white [&_svg]:size-3">
        {clip.muted && <VolumeX />}
        {broken && <TriangleAlert />}
      </span>
      {badges.marked && (
        <span className="absolute top-1.5 right-1.5 z-[2] size-1.5 rounded-full bg-sky-400 ring-2 ring-black/30" />
      )}
      {pill && (
        <span className="bg-foreground text-background absolute top-1/2 left-1/2 z-30 -translate-1/2 rounded-full px-2 py-0.5 font-mono text-[11px] whitespace-nowrap">
          {pill}
        </span>
      )}
      {editable &&
        ready &&
        (["start", "end"] as const).map((side) => (
          <span
            key={side}
            onPointerDown={(event) => onPointerDown(event, side)}
            className={cn(
              "absolute inset-y-0 z-10 w-2.5 cursor-ew-resize after:absolute after:inset-y-[30%] after:left-[2.5px] after:w-1 after:rounded-full after:bg-white",
              side === "start" ? "left-0" : "right-0",
              selected ? "bg-primary block" : "hidden bg-white/30 group-hover:block",
            )}
          />
        ))}
    </div>
  );
}
