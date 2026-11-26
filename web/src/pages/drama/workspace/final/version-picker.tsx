import type { Segment } from "@/api/drama/type";
import type { EditorClip } from "@/components/timeline-editor/types";
import { cn } from "@/lib/utils";
import { hostOf } from "@/utils/drama/timeline-host";
import { versionOf } from "@/utils/drama/timeline";

/** 片段里能选的版本：成功且有视频 */
export const usableTakes = (segment: Segment) =>
  segment.takes.filter((take) => take.status === "succeeded" && take.asset?.url);

/**
 * 属性面板里的「版本」选择：跟随采用，或固定为某一版。
 * 选中的版本用 aria-pressed 表示；固定版本的段不再跟随片场的采用。
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
  const option = (key: string, label: string, pressed: boolean) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={() => onPick(key)}
      className={cn(
        "ring-chrome-border h-7 rounded-full px-2.5 text-xs ring-1 transition-colors disabled:opacity-50",
        pressed ? "bg-chrome-hover font-semibold" : "hover:bg-chrome-hover",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <h5 className="text-muted-foreground text-xs font-medium">版本</h5>
      <div className="flex flex-wrap gap-1.5">
        {option("follow", "跟随采用", !host.pinned)}
        {usableTakes(segment).map((take) =>
          option(
            take.taskId,
            `版本 ${versionOf(segment, take.taskId)}${take.taskId === segment.chosenTaskId ? " · 采用" : ""}`,
            host.pinned && host.taskId === take.taskId,
          ),
        )}
      </div>
    </div>
  );
}
