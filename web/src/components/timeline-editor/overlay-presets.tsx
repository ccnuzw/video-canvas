import { cn } from "@/lib/utils";

import type { OverlayParams } from "./types";

/** 叠加画面的预设位置 */
export const OVERLAY_PRESETS: { label: string; overlay: Omit<OverlayParams, "opacity"> }[] = [
  { label: "铺满", overlay: { x: 50, y: 50, scale: 100 } },
  { label: "居中", overlay: { x: 50, y: 50, scale: 62 } },
  { label: "右上小窗", overlay: { x: 72, y: 22, scale: 42 } },
  { label: "左下小窗", overlay: { x: 28, y: 78, scale: 42 } },
];

/**
 * 叠加位置预设：每个预设是一张小画面，里面的亮块就是叠加画面落的位置和大小，下面写名字。
 * 当前参数正好等于某个预设时，那一格高亮。
 */
export function OverlayPresets({
  overlay,
  ratio,
  disabled,
  onPick,
}: {
  /** 当前叠加参数 */
  overlay: OverlayParams;
  /** 项目画面比例（CSS aspect-ratio，如「9/16」） */
  ratio: string;
  disabled: boolean;
  onPick: (overlay: Omit<OverlayParams, "opacity">) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {OVERLAY_PRESETS.map((preset) => {
        const on =
          overlay.x === preset.overlay.x &&
          overlay.y === preset.overlay.y &&
          overlay.scale === preset.overlay.scale;
        const { x, y, scale } = preset.overlay;
        return (
          <button
            key={preset.label}
            type="button"
            aria-label={preset.label}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onPick(preset.overlay)}
            className="group flex flex-col items-center gap-1 disabled:opacity-45"
          >
            <span
              style={{ aspectRatio: ratio }}
              className={cn(
                "bg-background/60 relative block max-h-14 w-full overflow-hidden rounded-md ring-1 transition-colors",
                on ? "ring-primary" : "ring-chrome-border group-hover:ring-foreground/30",
              )}
            >
              <span
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${scale}%`,
                  aspectRatio: ratio,
                }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-[2px]",
                  on ? "bg-primary/70" : "bg-foreground/35",
                )}
              />
            </span>
            <span
              className={cn(
                "text-[11px]",
                on ? "text-foreground font-semibold" : "text-muted-foreground",
              )}
            >
              {preset.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
