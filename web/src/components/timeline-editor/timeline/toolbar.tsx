import {
  CircleMinus,
  CirclePlus,
  Magnet,
  Redo2,
  Scan,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { MAX_PPS, ppsToSlider, sliderToPps } from "./layout";
import { ShortcutHelp } from "./shortcut-help";

/** 工具条上的图标按钮 */
function ToolButton({
  label,
  shortcut,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label}（${shortcut}）` : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-foreground hover:bg-chrome-hover grid size-8 place-items-center rounded-full disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4",
        active && "text-primary",
      )}
    >
      {children}
    </button>
  );
}

/** 工具条的属性 */
export interface ToolbarProps {
  /** 只读 */
  readOnly: boolean;
  /** 能否撤销 */
  canUndo: boolean;
  /** 能否重做 */
  canRedo: boolean;
  /** 是否有选中的片段 */
  hasSelection: boolean;
  /** 多选时禁用仅适用于单段的剪辑命令 */
  multiSelected: boolean;
  /** 吸附是否开启 */
  snapOn: boolean;
  /** 当前缩放（每秒像素） */
  pps: number;
  /** 当前片长与视口决定的缩小下限 */
  minPps: number;
  /** 撤销 */
  onUndo: () => void;
  /** 重做 */
  onRedo: () => void;
  /** 拆分 */
  onSplit: () => void;
  /** 删除选中片段 */
  onRemove: () => void;
  /** 切换吸附 */
  onToggleSnap: () => void;
  /** 缩放到指定值（每秒像素） */
  onZoom: (pps: number) => void;
  /** 适配宽度 */
  onFit: () => void;
}

/** 时间线上方的工具条：撤销重做、拆分删除、吸附、缩放 */
export function Toolbar(props: ToolbarProps) {
  const { readOnly, pps, minPps } = props;
  const singleDisabled = readOnly || props.multiSelected;
  return (
    <div className="border-chrome-border flex items-center gap-0.5 border-b px-2.5 py-1.5">
      <ToolButton
        label="撤销"
        shortcut="⌘Z"
        disabled={readOnly || !props.canUndo}
        onClick={props.onUndo}
      >
        <Undo2 />
      </ToolButton>
      <ToolButton
        label="重做"
        shortcut="⇧⌘Z"
        disabled={readOnly || !props.canRedo}
        onClick={props.onRedo}
      >
        <Redo2 />
      </ToolButton>
      <span className="bg-chrome-border mx-1.5 h-4.5 w-px" />
      {/* 新手引导的「剪辑」一步高亮这一组 */}
      <span data-tour="edit-tools" className="flex items-center gap-0.5">
        <ToolButton label="拆分" shortcut="S" disabled={singleDisabled} onClick={props.onSplit}>
          <Scissors />
        </ToolButton>
        <ToolButton
          label="删除"
          shortcut="Delete"
          disabled={readOnly || !props.hasSelection}
          onClick={props.onRemove}
        >
          <Trash2 />
        </ToolButton>
      </span>
      <span className="flex-1" />
      <ToolButton label="吸附" shortcut="N" active={props.snapOn} onClick={props.onToggleSnap}>
        <Magnet />
      </ToolButton>
      <span className="bg-chrome-border mx-1.5 h-4.5 w-px" />
      <ToolButton label="缩小" disabled={pps <= minPps} onClick={() => props.onZoom(pps / 1.4)}>
        <CircleMinus />
      </ToolButton>
      <input
        type="range"
        min={0}
        max={100}
        value={ppsToSlider(pps, minPps)}
        disabled={minPps === MAX_PPS}
        aria-label="缩放"
        onChange={(event) => props.onZoom(sliderToPps(Number(event.target.value), minPps))}
        className="accent-foreground w-28"
      />
      <ToolButton label="放大" disabled={pps >= MAX_PPS} onClick={() => props.onZoom(pps * 1.4)}>
        <CirclePlus />
      </ToolButton>
      <ToolButton label="适配宽度" onClick={props.onFit}>
        <Scan />
      </ToolButton>
      <ShortcutHelp readOnly={readOnly} />
    </div>
  );
}
