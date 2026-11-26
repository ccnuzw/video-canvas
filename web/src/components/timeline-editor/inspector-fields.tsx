import type { ReactNode } from "react";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/** 属性面板里的一组：小标题 + 内容 */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h5 className="text-muted-foreground text-[11.5px] font-medium">{title}</h5>
      {children}
    </div>
  );
}

/** 一排选项按钮 */
export function Options({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

/** 选项按钮：选中态用 chrome 的悬停底色加描边 */
export function Option({
  on = false,
  disabled,
  onClick,
  children,
}: {
  /** 是否选中 */
  on?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "ring-chrome-border hover:bg-chrome-hover inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] ring-1 disabled:opacity-45",
        on && "bg-chrome-hover text-foreground font-semibold",
      )}
    >
      {children}
    </button>
  );
}

/** 取滑杆回调里的数值（单滑块，可能是数字或数组） */
const first = (value: number | readonly number[]): number =>
  typeof value === "number" ? value : (value[0] ?? 0);

/**
 * 一行滑杆：标签 + 滑杆 + 当前值。
 * 拖动中连续调用 onPreview（只更新预览），松手调用 onCommit（宿主只记一步撤销）。
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onPreview,
  onCommit,
}: {
  /** 标签 */
  label: string;
  /** 当前值 */
  value: number;
  /** 最小值 */
  min: number;
  /** 最大值 */
  max: number;
  /** 步长 */
  step: number;
  /** 当前值怎么显示 */
  format: (value: number) => string;
  disabled: boolean;
  /** 拖动中 */
  onPreview: (value: number) => void;
  /** 松手 */
  onCommit: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[48px_1fr_48px] items-center gap-2.5 text-[12.5px]">
      <span>{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={Math.max(max, min)}
        step={step}
        disabled={disabled}
        onValueChange={(next) => onPreview(first(next))}
        onValueCommitted={(next) => onCommit(first(next))}
      />
      <span className="text-muted-foreground text-right font-mono text-[11.5px]">
        {format(value)}
      </span>
    </label>
  );
}
