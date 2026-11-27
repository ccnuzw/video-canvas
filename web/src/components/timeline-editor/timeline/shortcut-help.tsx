import { Keyboard, X } from "lucide-react";

import { Kbd } from "@/components/canvas/chrome/chrome";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { TIMELINE_KEYS } from "./use-timeline-shortcuts";

/** 可在只读时间线使用的操作 */
const VIEW_SHORTCUTS = [
  { label: "播放 / 暂停", keys: ["空格"] },
  { label: "切换吸附", keys: [TIMELINE_KEYS.snap.toUpperCase()] },
  { label: "缩放时间线", keys: ["⌘ + 滚轮", "Ctrl + 滚轮"] },
];

const undoKey = TIMELINE_KEYS.undo.toUpperCase();
/** 需要编辑权限的操作 */
const EDIT_SHORTCUTS = [
  { label: "在播放头处拆分", keys: [TIMELINE_KEYS.split.toUpperCase()] },
  { label: "裁掉播放头左侧", keys: [TIMELINE_KEYS.trimLeft.toUpperCase()] },
  { label: "裁掉播放头右侧", keys: [TIMELINE_KEYS.trimRight.toUpperCase()] },
  { label: "删除选中的片段", keys: ["Delete", "Backspace"] },
  { label: "撤销", keys: [`⌘ + ${undoKey}`, `Ctrl + ${undoKey}`] },
  { label: "重做", keys: [`⇧ + ⌘ + ${undoKey}`, `Ctrl + Shift + ${undoKey}`] },
  { label: "取消选择", keys: ["Esc"] },
];

/** 时间线工具栏里的快捷操作速查 */
export function ShortcutHelp({ readOnly }: { readOnly: boolean }) {
  const shortcuts = readOnly ? VIEW_SHORTCUTS : [...VIEW_SHORTCUTS, ...EDIT_SHORTCUTS];
  return (
    <Dialog>
      <DialogTrigger
        aria-label="快捷键"
        title="快捷键"
        className="text-foreground hover:bg-chrome-hover focus-visible:ring-ring data-popup-open:bg-chrome-hover grid size-8 shrink-0 place-items-center rounded-full focus-visible:ring-2 [&_svg]:size-4"
      >
        <Keyboard aria-hidden />
      </DialogTrigger>
      <DialogContent
        aria-modal="true"
        variant="chrome"
        showCloseButton={false}
        className="flex max-h-[min(80svh,38rem)] flex-col gap-0 p-0 sm:max-w-md"
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between px-5 pt-5">
          <DialogTitle>时间线快捷键</DialogTitle>
          <DialogClose
            aria-label="关闭"
            title="关闭"
            className="text-muted-foreground hover:bg-chrome-hover hover:text-foreground focus-visible:ring-ring grid size-8 shrink-0 place-items-center rounded-full focus-visible:ring-2 [&_svg]:size-4"
          >
            <X aria-hidden />
          </DialogClose>
        </DialogHeader>
        <dl className="divide-chrome-border grid min-h-0 flex-1 divide-y overflow-y-auto px-5 pt-2 pb-5">
          {shortcuts.map(({ label, keys }) => (
            <div
              key={label}
              className="flex min-h-10 flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5"
            >
              <dt>{label}</dt>
              <dd className="ml-auto flex flex-wrap justify-end gap-1">
                {keys.map((key) => (
                  <Kbd
                    key={key}
                    className="bg-chrome-hover rounded px-1.5 py-0.5 whitespace-nowrap opacity-100"
                  >
                    {key}
                  </Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
