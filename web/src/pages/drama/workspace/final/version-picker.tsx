import { Check, Layers } from "lucide-react";

import type { Segment } from "@/api/drama/type";
import { InspectorSection } from "@/components/timeline-editor";
import type { EditorClip } from "@/components/timeline-editor/types";
import { cn } from "@/lib/utils";
import { hostOf } from "@/utils/drama/timeline-host";
import { versionOf } from "@/utils/drama/timeline";

/** 片段里能选的版本：成功且有视频 */
export const usableTakes = (segment: Segment) =>
  segment.takes.filter((take) => take.status === "succeeded" && take.asset?.url);

/**
 * 属性面板里的「版本」分区：单选列表，第一行是跟随采用，下面每个可用版本一行，片场采用的那版带标记。
 * 固定为某一版后，这一段不再跟随片场的采用。
 */
export function VersionPicker({
  clip,
  segment,
  disabled,
  onPick,
}: {
  clip: EditorClip;
  segment: Segment;
  disabled: boolean;
  /** 选了某一版（任务 ID），或选了跟随采用（"follow"） */
  onPick: (taskId: string | "follow") => void;
}) {
  const host = hostOf(clip);
  const row = (key: string, label: string, checked: boolean, adopted: boolean) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !checked && onPick(key)}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] transition-colors disabled:opacity-45",
        checked
          ? "bg-chrome-hover ring-chrome-border font-semibold ring-1"
          : "hover:bg-chrome-hover",
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full ring-1",
          checked ? "bg-primary ring-primary text-primary-foreground" : "ring-chrome-border",
        )}
      >
        {checked && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {adopted && (
        <span className="bg-status-success/15 text-status-success rounded-md px-1.5 py-px text-[10.5px] font-medium">
          采用
        </span>
      )}
    </button>
  );
  return (
    <InspectorSection icon={<Layers />} title="版本">
      <div role="radiogroup" aria-label="版本" className="flex flex-col gap-0.5">
        {row("follow", "跟随采用", !host.pinned, false)}
        {usableTakes(segment).map((take) =>
          row(
            take.taskId,
            `版本 ${versionOf(segment, take.taskId)}`,
            host.pinned && host.taskId === take.taskId,
            take.taskId === segment.chosenTaskId,
          ),
        )}
      </div>
    </InspectorSection>
  );
}
