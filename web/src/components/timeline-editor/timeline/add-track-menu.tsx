import { AudioLines, Captions, Layers, Plus } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { TRACK_LIMIT } from "../model";
import type { TrackKind } from "../types";

/** 可以新增的附属轨种类 */
export type AddableKind = Exclude<TrackKind, "main">;

/** 新增轨道菜单里的各项 */
const ADD_ITEMS: { kind: AddableKind; label: string; icon: ReactNode }[] = [
  { kind: "overlay", label: "叠加轨", icon: <Layers /> },
  { kind: "text", label: "字幕轨", icon: <Captions /> },
  { kind: "audio", label: "音频轨", icon: <AudioLines /> },
];

/** 新增轨道菜单：放在刻度尺左侧、轨道头列顶上的角落，某类轨道到上限时对应项禁用 */
export function AddTrackMenu({
  readOnly,
  trackCounts,
  onAddTrack,
}: {
  /** 只读时整个入口禁用 */
  readOnly: boolean;
  /** 各类附属轨现在有几条 */
  trackCounts: Record<AddableKind, number>;
  /** 新增一条轨道 */
  onAddTrack: (kind: AddableKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={readOnly}
        render={
          <button
            type="button"
            aria-label="新增轨道"
            className="hover:bg-chrome-hover text-muted-foreground hover:text-foreground flex h-5.5 items-center gap-1 rounded-full px-2 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3"
          />
        }
      >
        <Plus />
        轨道
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        {ADD_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.kind}
            disabled={trackCounts[item.kind] >= TRACK_LIMIT[item.kind]}
            onClick={() => onAddTrack(item.kind)}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
