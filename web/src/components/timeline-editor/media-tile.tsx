import { AudioLines, Film, Image as ImageIcon, Loader2, Plus, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

import { endMediaDrag, startMediaDrag } from "./drag";
import type { MediaItem } from "./types";

/** 没有缩略图时按类型显示的图标 */
function Fallback({ type }: { type: MediaItem["type"] }) {
  const Icon = type === "audio" ? AudioLines : type === "image" ? ImageIcon : Film;
  return <Icon className="text-muted-foreground size-6" aria-hidden />;
}

/**
 * 素材面板里的一张卡片：上面缩略图，下面名字和副标题。
 * 在时间线上的卡片底色深一些，不另加角标；可拖到时间线，悬停时右下角出现「+」。
 */
export function MediaTile({
  item,
  ratio,
  readOnly,
  onAdd,
  onRetry,
}: {
  item: MediaItem;
  /** 项目画面比例（CSS aspect-ratio），aspect 为 project 时用 */
  ratio: string;
  readOnly: boolean;
  /** 点「+」 */
  onAdd: (item: MediaItem) => void;
  /** 重试上传 */
  onRetry?: (itemId: string) => void;
}) {
  const ready = item.status === "ready";
  const draggable = ready && !readOnly;
  return (
    <div
      draggable={draggable}
      onDragStart={(event) => startMediaDrag(event, { type: item.type, payload: item.payload })}
      onDragEnd={endMediaDrag}
      className={cn(
        "group overflow-hidden rounded-xl ring-1 ring-transparent transition-colors [corner-shape:squircle]",
        item.onTimeline ? "bg-muted/35" : "bg-muted",
        draggable && "hover:ring-chrome-border cursor-grab active:cursor-grabbing",
      )}
    >
      <div
        style={{ aspectRatio: item.aspect === "square" ? "1 / 1" : ratio }}
        className="bg-muted relative grid place-items-center overflow-hidden"
      >
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <Fallback type={item.type} />
        )}
        {item.badge && (
          <span className="bg-status-success absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-black">
            {item.badge}
          </span>
        )}
        {item.status === "uploading" && (
          <span className="text-muted-foreground absolute inset-0 grid place-items-center bg-black/55 text-[12px] text-white">
            <span className="flex flex-col items-center gap-1">
              <Loader2 className="size-4 animate-spin" />
              {item.progress}%
            </span>
          </span>
        )}
        {item.status === "failed" && (
          <button
            type="button"
            onClick={() => onRetry?.(item.id)}
            className="text-destructive absolute inset-0 grid place-items-center bg-black/55 text-[12px]"
          >
            <span className="flex flex-col items-center gap-1">
              <RotateCcw className="size-4" />
              上传失败，点此重试
            </span>
          </button>
        )}
        {ready && !readOnly && (
          <button
            type="button"
            aria-label="加到时间线"
            title="加到时间线"
            onClick={() => onAdd(item)}
            className="absolute right-1.5 bottom-1.5 hidden size-7 place-items-center rounded-full bg-white/90 text-black shadow group-hover:grid"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-[12.5px] leading-tight" title={item.title}>
          {item.title || "未命名"}
        </div>
        {item.subtitle && (
          <div className="text-muted-foreground mt-0.5 text-[11.5px] leading-tight">
            {item.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
