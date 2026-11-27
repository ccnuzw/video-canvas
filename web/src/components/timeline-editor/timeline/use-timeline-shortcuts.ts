import { useEffect, useLayoutEffect, useRef } from "react";

/** 时间线的实际键位，按键监听和帮助面板共用 */
export const TIMELINE_KEYS = {
  play: " ",
  snap: "n",
  split: "s",
  trimLeft: "q",
  trimRight: "w",
  remove: "delete",
  removeAlt: "backspace",
  undo: "z",
  deselect: "escape",
} as const;

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
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || target?.closest(IGNORE)) return;
      const a = ref.current;
      const key = event.key.toLowerCase();
      if (key === TIMELINE_KEYS.play) {
        if (target?.closest("button, [role=button]")) return;
        event.preventDefault();
        return a.toggle();
      }
      if (key === TIMELINE_KEYS.snap && !event.metaKey && !event.ctrlKey) return a.toggleSnap();
      if (a.readOnly) return;
      if ((event.metaKey || event.ctrlKey) && key === TIMELINE_KEYS.undo) {
        event.preventDefault();
        return event.shiftKey ? a.redo() : a.undo();
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === TIMELINE_KEYS.split) a.split();
      else if (key === TIMELINE_KEYS.trimLeft) a.trimLeft();
      else if (key === TIMELINE_KEYS.trimRight) a.trimRight();
      else if (
        (key === TIMELINE_KEYS.remove || key === TIMELINE_KEYS.removeAlt) &&
        a.hasSelection
      ) {
        event.preventDefault();
        a.remove();
      } else if (key === TIMELINE_KEYS.deselect) a.deselect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
