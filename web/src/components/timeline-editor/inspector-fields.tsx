import { useState, type ReactNode } from "react";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * 属性面板的基础件：分区卡片、信息条、滑杆 + 数值输入的一行、文字分段单选、卡片头的图标开关。
 * 外观按清透风格：卡片是 chrome 悬停底色的圆角块，选中态是 chrome 悬停底色加描边。
 */

/** 一张分区卡片：头部图标 + 标题，右侧可放开关；内容是若干行 */
export function InspectorSection({
  icon,
  title,
  action,
  children,
}: {
  /** 标题前的图标 */
  icon: ReactNode;
  /** 标题，同时作为分区的无障碍名称 */
  title: string;
  /** 头部右侧的操作（如静音开关）；没有为 undefined */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      role="group"
      aria-label={title}
      className="bg-chrome-hover/40 ring-chrome-border/60 rounded-xl ring-1 [corner-shape:squircle]"
    >
      <header className="flex h-10 items-center gap-2 px-3">
        <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <h5 className="flex-1 text-[12.5px] font-semibold">{title}</h5>
        {action}
      </header>
      <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>
    </section>
  );
}

/** 一行：左边固定宽度的标签，右边内容 */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[52px_1fr] items-center gap-2.5 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2.5">{children}</div>
    </div>
  );
}

/** 头部的信息条：几格「小标签 + 数值」并排 */
export function StatStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl
      aria-label="片段信息"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="bg-chrome-hover/40 ring-chrome-border/60 divide-chrome-border/60 grid divide-x rounded-xl ring-1 [corner-shape:squircle]"
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
          <dt className="text-muted-foreground text-[11px]">{item.label}</dt>
          <dd className="truncate font-mono text-[12.5px]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 数值的范围和单位换算：显示值 = 实际值 / scale（如毫秒按秒显示时 scale 为 1000） */
export interface FieldRange {
  /** 最小值（实际值） */
  min: number;
  /** 最大值（实际值） */
  max: number;
  /** 步长（实际值） */
  step: number;
  /** 显示值和实际值的倍数 */
  scale: number;
}

/**
 * 把输入框里的文字换算回实际值：去掉空白和单位，按倍数换算，夹到范围内，按步长取整
 * @param text 输入框里的文字
 * @param range 范围和单位换算
 * @returns 实际值；看不懂（空、不是数字）为 null，调用方保持原值
 */
export function parseField(text: string, range: FieldRange): number | null {
  const cleaned = text.trim().replace(/[^\d.+-]/g, "");
  if (cleaned === "") return null;
  const shown = Number(cleaned);
  if (!Number.isFinite(shown)) return null;
  const value = Math.min(range.max, Math.max(range.min, shown * range.scale));
  return Math.round(value / range.step) * range.step;
}

/** 实际值按单位换算后显示的文字 */
const formatField = (value: number, scale: number, decimals: number) =>
  (value / scale).toFixed(decimals);

/** 取滑杆回调里的数值（单滑块，可能是数字或数组） */
const first = (value: number | readonly number[]): number =>
  typeof value === "number" ? value : (value[0] ?? 0);

/**
 * 带单位的数值输入框：输入中只改框里的文字，回车或失焦才换算并提交；看不懂的输入还原成原值
 */
export function NumberField({
  label,
  value,
  range,
  unit,
  decimals = 0,
  prefix,
  disabled,
  onCommit,
  className,
}: {
  /** 无障碍名称 */
  label: string;
  /** 框内左侧的短标记（如 X、Y）；没有为 undefined */
  prefix?: string;
  /** 当前实际值 */
  value: number;
  range: FieldRange;
  /** 单位，显示在框内右侧 */
  unit: string;
  /** 显示几位小数 */
  decimals?: number;
  disabled: boolean;
  /** 提交新的实际值 */
  onCommit: (value: number) => void;
  className?: string;
}) {
  const shown = formatField(value, range.scale, decimals);
  // 正在输入的文字；没在输入时为 null，显示当前值
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = parseField(draft, range);
    setDraft(null);
    if (next !== null && next !== value) onCommit(next);
  };
  return (
    <label
      className={cn(
        "bg-chrome-hover ring-chrome-border focus-within:ring-foreground/40 flex h-7 w-[72px] shrink-0 items-center rounded-full pr-2.5 ring-1",
        disabled && "opacity-45",
        className,
      )}
    >
      {prefix && <span className="text-muted-foreground pl-2.5 text-[11px]">{prefix}</span>}
      <input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? shown}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1 bg-transparent pl-2.5 text-right font-mono text-[12px] outline-none disabled:cursor-not-allowed"
      />
      <span className="text-muted-foreground pl-0.5 text-[11px]">{unit}</span>
    </label>
  );
}

/**
 * 一行「标签 + 滑杆 + 数值输入框」。
 * 拖滑杆时连续调用 onPreview（只更新预览），松手调用 onCommit（宿主只记一步撤销）；数值框回车或失焦提交。
 */
export function SliderField({
  label,
  value,
  range,
  unit,
  decimals = 0,
  disabled,
  onPreview,
  onCommit,
}: {
  label: string;
  /** 当前实际值 */
  value: number;
  range: FieldRange;
  unit: string;
  decimals?: number;
  disabled: boolean;
  /** 拖动中 */
  onPreview: (value: number) => void;
  /** 松手或输入完成 */
  onCommit: (value: number) => void;
}) {
  return (
    <FieldRow label={label}>
      <Slider
        aria-label={label}
        value={[value]}
        min={range.min}
        max={Math.max(range.max, range.min)}
        step={range.step}
        disabled={disabled}
        onValueChange={(next) => onPreview(first(next))}
        onValueCommitted={(next) => onCommit(first(next))}
        className="min-w-0 flex-1"
      />
      <NumberField
        label={label}
        value={value}
        range={range}
        unit={unit}
        decimals={decimals}
        disabled={disabled}
        onCommit={onCommit}
      />
    </FieldRow>
  );
}

/** 文字分段单选：等宽的几格，选中的一格有底色和描边 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  /** 无障碍名称 */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      className="bg-chrome-hover/60 grid h-8 flex-1 gap-0.5 rounded-full p-0.5"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !on && onChange(option.value)}
            className={cn(
              "rounded-full text-[12px] transition-colors disabled:opacity-45",
              on
                ? "bg-background text-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 卡片头上的图标开关（如静音）：按下态是主色 */
export function IconToggle({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  /** 无障碍名称和悬停提示 */
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "hover:bg-chrome-hover grid size-7 place-items-center rounded-full transition-colors disabled:opacity-45 [&_svg]:size-3.5",
        pressed ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
