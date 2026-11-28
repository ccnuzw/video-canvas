import {
  ArrowRight,
  Clapperboard,
  LayoutGrid,
  MessageSquare,
  NotebookPen,
  Quote,
  Rewind,
  SkipForward,
  Type,
  User,
  Waves,
  type LucideIcon,
} from "lucide-react";

import type { ScriptElementType } from "@/api/drama/type";
import { cn } from "@/lib/utils";
import { CYCLE_TYPES, ELEMENT_LABEL, canType, type EditorElement } from "@/utils/drama/script-doc";

/** 每种元素的图标：图标在上、文字在下 */
const ICON: Record<ScriptElementType, LucideIcon> = {
  action: Waves,
  character: User,
  parenthetical: Quote,
  dialogue: MessageSquare,
  transition: ArrowRight,
  subtitle: Type,
  shot: Clapperboard,
  note: NotebookPen,
  flashback_start: Rewind,
  flashback_end: SkipForward,
};

const BUTTON =
  "flex min-w-[52px] shrink-0 flex-col items-center gap-[3px] rounded-xl px-2 py-1.5 text-[11px] leading-none outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35";

/**
 * 编辑区上方的元素类型条（参考 reveric 的剧本编辑器）：场次、动作、角色、括号、对白、转场、字幕、空镜、备注、闪回，
 * 光标所在行的类型高亮；不合法的类型置灰，原因放在悬停提示里。窄了可以横向滑动，不显示滚动条。
 * 按下时不抢走输入框的焦点，改完类型光标还在这一行。已锁定时整条不显示。
 * @param els 光标所在场次的全部行
 * @param index 光标所在行
 * @param readOnly 已锁定
 * @param onType 改当前行的类型
 * @param onMarker 在当前行后插入闪回标记
 * @param onNewScene 在当前场后新建一场
 */
export function ElementBar({
  els,
  index,
  readOnly,
  onType,
  onMarker,
  onNewScene,
}: {
  els: EditorElement[];
  index: number;
  readOnly: boolean;
  onType: (type: ScriptElementType) => void;
  onMarker: (type: ScriptElementType) => void;
  onNewScene: () => void;
}) {
  if (readOnly) return null;
  const current = els[index]?.type;
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const idle = "text-muted-foreground hover:bg-chrome-hover hover:text-foreground";
  return (
    <div
      role="toolbar"
      aria-label="剧本元素"
      className="border-border bg-background/85 sticky top-0 z-20 flex h-14 items-center justify-center gap-0.5 overflow-x-auto border-b px-2 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        type="button"
        title="在这一场后新建一场（⌘/Ctrl + Enter）"
        onMouseDown={keepFocus}
        onClick={onNewScene}
        className={cn(BUTTON, idle)}
      >
        <LayoutGrid className="size-4" />
        场次
      </button>
      {CYCLE_TYPES.map((type) => {
        const Icon = ICON[type];
        const why = canType(els, index, type);
        return (
          <button
            key={type}
            type="button"
            disabled={!!why}
            title={why || ELEMENT_LABEL[type]}
            aria-pressed={current === type}
            onMouseDown={keepFocus}
            onClick={() => onType(type)}
            className={cn(
              BUTTON,
              current === type ? "bg-chrome-hover ring-chrome-border text-foreground ring-1" : idle,
            )}
          >
            <Icon className="size-4" />
            {ELEMENT_LABEL[type]}
          </button>
        );
      })}
      {(["flashback_start", "flashback_end"] as const).map((type) => {
        const Icon = ICON[type];
        return (
          <button
            key={type}
            type="button"
            title={`在这一行后插入「${ELEMENT_LABEL[type]}」`}
            onMouseDown={keepFocus}
            onClick={() => onMarker(type)}
            className={cn(BUTTON, idle)}
          >
            <Icon className="size-4" />
            {ELEMENT_LABEL[type]}
          </button>
        );
      })}
    </div>
  );
}
