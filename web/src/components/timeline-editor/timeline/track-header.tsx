import {
  Captions,
  Ellipsis,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { EditorTrack } from "../types";
import { HEAD_WIDTH } from "./layout";

/** 轨道上能切换的开关 */
export type TrackToggle = "muted" | "hidden" | "locked";

/** 轨道头上的小图标按钮 */
function HeadButton({
  label,
  on,
  disabled,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:bg-chrome-hover hover:text-foreground grid size-[22px] shrink-0 place-items-center rounded-md disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5",
        on && "text-primary",
      )}
    >
      {children}
    </button>
  );
}

/** 轨道头的属性 */
export interface TrackHeaderProps {
  /** 轨道 */
  track: EditorTrack;
  /** 轨道编号，如 V1、A2 */
  badge: string;
  /** 这一行的高度（像素） */
  height: number;
  /** 只读 */
  readOnly: boolean;
  /** 宿主能按台词生成字幕 */
  canGenerate: boolean;
  /** 切换静音 / 隐藏 / 锁定 */
  onToggle: (trackId: string, toggle: TrackToggle) => void;
  /** 在播放头处加一条字幕 */
  onAddSubtitle: (trackId: string) => void;
  /** 按台词生成字幕 */
  onGenerate: (trackId: string) => void;
  /** 删除轨道 */
  onRemove: (trackId: string) => void;
}

/**
 * 时间线左侧固定的轨道头：编号和名字，加字幕、隐藏、静音、锁定和「更多」菜单。
 * 主轨只有整轨静音；其余按轨道种类显示对应的开关。
 */
export function TrackHeader({
  track,
  badge,
  height,
  readOnly,
  canGenerate,
  onToggle,
  onAddSubtitle,
  onGenerate,
  onRemove,
}: TrackHeaderProps) {
  const main = track.kind === "main";
  const showHide = track.kind === "overlay" || track.kind === "text";
  const showMute = track.kind !== "text";
  return (
    <div
      style={{ width: HEAD_WIDTH, height }}
      className="bg-chrome border-chrome-border sticky left-0 z-30 flex shrink-0 items-center gap-0.5 border-r pr-1.5 pl-2.5 backdrop-blur-xl"
    >
      <span
        className={cn(
          "bg-chrome-hover text-muted-foreground mr-1 rounded-[5px] px-1.5 py-px font-mono text-[10.5px] font-semibold",
          main && "bg-primary/20 text-primary",
        )}
      >
        {badge}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs" title={track.name}>
        {track.name}
        {main && <Magnet className="text-primary size-3 shrink-0" aria-label="首尾相接" />}
      </span>
      {track.kind === "text" && (
        <HeadButton
          label="在播放头处加字幕"
          disabled={readOnly || track.locked}
          onClick={() => onAddSubtitle(track.id)}
        >
          <Plus />
        </HeadButton>
      )}
      {showHide && (
        <HeadButton
          label={track.hidden ? "显示" : "隐藏"}
          on={track.hidden}
          disabled={readOnly}
          onClick={() => onToggle(track.id, "hidden")}
        >
          {track.hidden ? <EyeOff /> : <Eye />}
        </HeadButton>
      )}
      {showMute && (
        <HeadButton
          label={track.muted ? (main ? "取消整轨静音" : "取消静音") : main ? "整轨静音" : "静音"}
          on={track.muted}
          disabled={readOnly}
          onClick={() => onToggle(track.id, "muted")}
        >
          {track.muted ? <VolumeX /> : <Volume2 />}
        </HeadButton>
      )}
      {!main && (
        <HeadButton
          label={track.locked ? "解锁" : "锁定"}
          on={track.locked}
          disabled={readOnly}
          onClick={() => onToggle(track.id, "locked")}
        >
          {track.locked ? <Lock /> : <LockOpen />}
        </HeadButton>
      )}
      {!main && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="更多"
                title="更多"
                className="text-muted-foreground hover:bg-chrome-hover hover:text-foreground grid size-[22px] shrink-0 place-items-center rounded-md [&_svg]:size-3.5"
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {track.kind === "text" && canGenerate && (
              <>
                <DropdownMenuItem
                  disabled={readOnly || track.locked}
                  onClick={() => onGenerate(track.id)}
                >
                  <Captions />
                  按台词生成字幕
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={readOnly}
              onClick={() => onRemove(track.id)}
            >
              <Trash2 />
              删除轨道
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
