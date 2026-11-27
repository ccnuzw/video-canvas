import { Captions } from "lucide-react";
import type { PointerEvent } from "react";

import { cn } from "@/lib/utils";

import { clipLength } from "../model";
import type { EditorTrack, TimelineEditorHost } from "../types";
import { ClipBlock } from "./clip-block";
import { DROP_PREVIEW_MS } from "./drag-logic";
import { LANE_PAD, ROW_HEIGHT, clipBox, formatSeconds } from "./layout";
import { TrackHeader, type TrackToggle } from "./track-header";
import type { ClipPart, Drag } from "./use-timeline-drag";

/** 素材拖入时在这条轨上画的落点方框 */
export interface DropBox {
  /** 起点（毫秒） */
  startMs: number;
  /** 是否合法；不合法画红框 */
  ok: boolean;
}

/** 一条轨道（轨道头 + 内容区）的属性 */
export interface TrackRowProps {
  /** 轨道（拖动中是草稿里的样子） */
  track: EditorTrack;
  /** 轨道编号 */
  badge: string;
  /** 宿主 */
  host: TimelineEditorHost;
  /** 每秒多少像素 */
  pps: number;
  /** 内容区宽度（像素） */
  width: number;
  /** 当前高亮的片段，包含拖动中的选框预览 */
  selectedIds: ReadonlySet<string>;
  /** 单选时显示手柄的片段 */
  activeId: string | null;
  /** 只读 */
  readOnly: boolean;
  /** 指针拖动中的状态 */
  drag: Drag | null;
  /** 主轨换顺序或素材拖入时的插入线横坐标（像素）；没有为 null */
  insertX: number | null;
  /** 素材拖入的落点方框；没有为 null */
  dropBox: DropBox | null;
  /** 在片段上按下 */
  onClipPointerDown: (event: PointerEvent, id: string, part: ClipPart) => void;
  /** 在内容区空白处按下 */
  onLanePointerDown: (event: PointerEvent) => void;
  /** 切换静音 / 隐藏 / 锁定 */
  onToggle: (trackId: string, toggle: TrackToggle) => void;
  /** 在播放头处加字幕 */
  onAddSubtitle: (trackId: string) => void;
  /** 按台词生成字幕 */
  onGenerate: (trackId: string) => void;
  /** 删除轨道 */
  onRemove: (trackId: string) => void;
}

/** 拖动中显示在片段中间的胶囊文字：裁剪时是时长，淡入淡出时是淡变时长 */
function pillOf(drag: Drag | null, track: EditorTrack, clipId: string): string | null {
  if (!drag || (drag.mode !== "trim" && drag.mode !== "fade") || drag.id !== clipId) return null;
  const clip = track.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  if (drag.mode === "trim") return formatSeconds(clipLength(clip));
  return `淡${drag.side === "in" ? "入" : "出"} ${formatSeconds(drag.side === "in" ? clip.fadeInMs : clip.fadeOutMs)}`;
}

/**
 * 一条轨道：左侧固定的轨道头，右侧按时间摆放的片段。
 * 锁定的轨是斜纹底，隐藏的叠加和字幕轨、静音的音频轨上的片段变淡。
 */
export function TrackRow(props: TrackRowProps) {
  const { track, host, pps, width, selectedIds, activeId, readOnly, drag } = props;
  const editable = !readOnly && !track.locked;
  const faded = track.hidden || (track.kind === "audio" && track.muted);
  const moving = drag?.mode === "move" && drag.moving ? drag : null;
  // 落点在主轨：被拖的那段画成占位槽，其余片段带过渡地让位；附属轨上被拖的片段直接跟着指针，不加过渡
  const toMain = moving?.plan?.target.kind === "main";
  return (
    <div
      data-tour={track.kind === "main" ? "main-track" : undefined}
      className="border-chrome-border/50 flex border-b"
      style={{ height: ROW_HEIGHT[track.kind] }}
    >
      <TrackHeader
        track={track}
        badge={props.badge}
        height={ROW_HEIGHT[track.kind]}
        readOnly={readOnly}
        canGenerate={!!host.generateSubtitles}
        onToggle={props.onToggle}
        onAddSubtitle={props.onAddSubtitle}
        onGenerate={props.onGenerate}
        onRemove={props.onRemove}
      />
      <div
        data-lane={track.id}
        style={{ width }}
        onPointerDown={props.onLanePointerDown}
        className={cn(
          "relative shrink-0",
          track.kind === "main" && "bg-chrome-hover/40",
          track.locked &&
            "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(128_128_128/0.08)_6px_12px)]",
        )}
      >
        <div className={cn("absolute inset-0", faded && "opacity-35")}>
          {track.clips.map((clip) => (
            <ClipBlock
              key={clip.id}
              clip={clip}
              track={track}
              media={clip.type === "text" ? null : host.resolve(clip)}
              pps={pps}
              selected={selectedIds.has(clip.id)}
              active={activeId === clip.id}
              badges={host.clipBadges?.(clip) ?? { pinned: false, marked: false }}
              dragging={!!moving && toMain && moving.id === clip.id}
              animate={!!moving && (moving.id !== clip.id || toMain)}
              invalidDrop={!!moving && moving.id === clip.id && !!moving.plan && !moving.plan.ok}
              editable={editable}
              pill={pillOf(drag, track, clip.id)}
              onPointerDown={(event, part) => props.onClipPointerDown(event, clip.id, part)}
            />
          ))}
        </div>
        {props.insertX !== null && (
          <div
            style={{ left: props.insertX }}
            className="bg-primary shadow-primary absolute inset-y-0 z-10 w-[3px] -translate-x-1/2 rounded-full shadow-[0_0_10px]"
          />
        )}
        {props.dropBox && (
          <div
            style={clipBox(props.dropBox.startMs, DROP_PREVIEW_MS, pps)}
            className={cn(
              "pointer-events-none absolute inset-y-1 z-10 rounded-lg border-2 border-dashed",
              props.dropBox.ok
                ? "border-primary bg-primary/10"
                : "border-destructive bg-destructive/10",
            )}
          />
        )}
        {track.kind === "text" &&
          track.clips.length === 0 &&
          host.generateSubtitles &&
          editable && (
            <button
              type="button"
              onClick={() => props.onGenerate(track.id)}
              style={{ left: LANE_PAD + 6 }}
              className="text-muted-foreground hover:text-foreground border-chrome-border absolute top-1/2 flex h-[22px] -translate-y-1/2 items-center gap-1 rounded-full border border-dashed px-2.5 text-[11.5px] [&_svg]:size-3"
            >
              <Captions />
              按台词生成
            </button>
          )}
      </div>
    </div>
  );
}
