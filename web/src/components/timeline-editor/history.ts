/**
 * 撤销 / 重做栈的纯函数，不绑定任何状态库；宿主把它存进自己的 store 即可。
 */

/** 撤销最多保留多少步 */
export const HISTORY_LIMIT = 100;

/** 撤销栈和重做栈，栈顶是最近的一步 */
export interface History<T> {
  /** 可撤销回去的旧状态，最近的在末尾 */
  past: T[];
  /** 可重做回来的状态，最近撤销的在末尾 */
  future: T[];
}

/** 空历史 */
export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** 做了一次新编辑：把编辑前的状态压入撤销栈，重做栈作废 */
export function pushHistory<T>(history: History<T>, before: T, limit = HISTORY_LIMIT): History<T> {
  return { past: [...history.past, before].slice(-limit), future: [] };
}

/** 撤销：返回退回的状态和新历史；没有可撤销的为 null */
export function undoHistory<T>(
  history: History<T>,
  present: T,
): { value: T; history: History<T> } | null {
  const value = history.past.at(-1);
  if (value === undefined) return null;
  return {
    value,
    history: { past: history.past.slice(0, -1), future: [...history.future, present] },
  };
}

/** 重做：返回重做回来的状态和新历史；没有可重做的为 null */
export function redoHistory<T>(
  history: History<T>,
  present: T,
): { value: T; history: History<T> } | null {
  const value = history.future.at(-1);
  if (value === undefined) return null;
  return {
    value,
    history: { past: [...history.past, present], future: history.future.slice(0, -1) },
  };
}
