import { useEffect, useLayoutEffect, useRef } from "react";

/** 快捷键触发的动作 */
export interface ShortcutActions {
  /** 只读：只有播放和吸附开关可用 */
  readOnly: boolean;
  /** 是否有选中的片段 */
  hasSelection: boolean;
  /** 播放 / 暂停 */
  toggle: () => void;
  /** 拆分 */
  split: () => void;
  /** 向左裁 */
  trimLeft: () => void;
  /** 向右裁 */
  trimRight: () => void;
  /** 删除选中片段 */
  remove: () => void;
  /** 吸附开关 */
  toggleSnap: () => void;
  /** 撤销 */
  undo: () => void;
  /** 重做 */
  redo: () => void;
  /** 取消选中 */
  deselect: () => void;
}

/** 在这些元素里按键不触发快捷键 */
const IGNORE = "input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]";

/**
 * 时间线快捷键：空格播放，S 拆分，Q/W 裁到播放头，Delete 删除，N 吸附，⌘Z / ⇧⌘Z 撤销重做，Esc 取消选中。
 * 在输入框、对话框和菜单里不响应。
 */
export function useTimelineShortcuts(actions: ShortcutActions): void {
  const ref = useRef(actions);
  useLayoutEffect(() => {
    ref.current = actions;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest(IGNORE)) return;
      const a = ref.current;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        return a.toggle();
      }
      if (key === "n" && !event.metaKey && !event.ctrlKey) return a.toggleSnap();
      if (a.readOnly) return;
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        return event.shiftKey ? a.redo() : a.undo();
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "s") a.split();
      else if (key === "q") a.trimLeft();
      else if (key === "w") a.trimRight();
      else if ((key === "delete" || key === "backspace") && a.hasSelection) {
        event.preventDefault();
        a.remove();
      } else if (key === "escape") a.deselect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
