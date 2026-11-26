import {
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioLines,
  Captions,
  CircleMinus,
  CirclePlus,
  Layers,
  Magnet,
  Plus,
  Redo2,
  Scan,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { TRACK_LIMIT } from "../model";
import type { TrackKind } from "../types";
import { ppsToSlider, sliderToPps } from "./layout";

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

/** 可以新增的附属轨种类 */
type AddableKind = Exclude<TrackKind, "main">;

/** 新增轨道菜单里的各项 */
const ADD_ITEMS: { kind: AddableKind; label: string; icon: ReactNode }[] = [
  { kind: "overlay", label: "叠加轨", icon: <Layers /> },
  { kind: "text", label: "字幕轨", icon: <Captions /> },
  { kind: "audio", label: "音频轨", icon: <AudioLines /> },
];

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
  /** 吸附是否开启 */
  snapOn: boolean;
  /** 当前缩放（每秒像素） */
  pps: number;
  /** 各类附属轨现在有几条 */
  trackCounts: Record<AddableKind, number>;
  /** 撤销 */
  onUndo: () => void;
  /** 重做 */
  onRedo: () => void;
  /** 拆分 */
  onSplit: () => void;
  /** 向左裁 */
  onTrimLeft: () => void;
  /** 向右裁 */
  onTrimRight: () => void;
  /** 删除选中片段 */
  onRemove: () => void;
  /** 新增一条轨道 */
  onAddTrack: (kind: AddableKind) => void;
  /** 切换吸附 */
  onToggleSnap: () => void;
  /** 缩放到指定值（每秒像素） */
  onZoom: (pps: number) => void;
  /** 适配宽度 */
  onFit: () => void;
}

/** 时间线上方的工具条：撤销重做、拆分裁剪删除、新增轨道、吸附、缩放 */
export function Toolbar(props: ToolbarProps) {
  const { readOnly, pps } = props;
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
      <ToolButton label="拆分" shortcut="S" disabled={readOnly} onClick={props.onSplit}>
        <Scissors />
      </ToolButton>
      <ToolButton
        label="删掉播放头左边"
        shortcut="Q"
        disabled={readOnly}
        onClick={props.onTrimLeft}
      >
        <ArrowLeftToLine />
      </ToolButton>
      <ToolButton
        label="删掉播放头右边"
        shortcut="W"
        disabled={readOnly}
        onClick={props.onTrimRight}
      >
        <ArrowRightToLine />
      </ToolButton>
      <ToolButton
        label="删除"
        shortcut="Delete"
        disabled={readOnly || !props.hasSelection}
        onClick={props.onRemove}
      >
        <Trash2 />
      </ToolButton>
      <span className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={readOnly}
          render={
            <button
              type="button"
              aria-label="新增轨道"
              className="hover:bg-chrome-hover ring-chrome-border mr-1.5 flex h-7 items-center gap-1 rounded-full px-2.5 text-xs ring-1 disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5"
            />
          }
        >
          <Plus />
          轨道
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          {ADD_ITEMS.map((item) => (
            <DropdownMenuItem
              key={item.kind}
              disabled={props.trackCounts[item.kind] >= TRACK_LIMIT[item.kind]}
              onClick={() => props.onAddTrack(item.kind)}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton label="吸附" shortcut="N" active={props.snapOn} onClick={props.onToggleSnap}>
        <Magnet />
      </ToolButton>
      <span className="bg-chrome-border mx-1.5 h-4.5 w-px" />
      <ToolButton label="缩小" onClick={() => props.onZoom(pps / 1.4)}>
        <CircleMinus />
      </ToolButton>
      <input
        type="range"
        min={0}
        max={100}
        value={ppsToSlider(pps)}
        aria-label="缩放"
        onChange={(event) => props.onZoom(sliderToPps(Number(event.target.value)))}
        className="accent-foreground w-28"
      />
      <ToolButton label="放大" onClick={() => props.onZoom(pps * 1.4)}>
        <CirclePlus />
      </ToolButton>
      <ToolButton label="适配宽度" onClick={props.onFit}>
        <Scan />
      </ToolButton>
    </div>
  );
}
