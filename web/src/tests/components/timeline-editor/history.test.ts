import { describe, expect, test } from "bun:test";

import {
  emptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/components/timeline-editor/history";

describe("撤销重做栈", () => {
  test("编辑后可撤销，撤销后可重做，再编辑会清空重做栈", () => {
    let h = pushHistory(emptyHistory<number>(), 1);
    h = pushHistory(h, 2);
    const undone = undoHistory(h, 3)!;
    expect(undone.value).toBe(2);
    const redone = redoHistory(undone.history, 2)!;
    expect(redone.value).toBe(3);
    const edited = pushHistory(undone.history, 2);
    expect(edited.future).toEqual([]);
    expect(redoHistory(edited, 9)).toBeNull();
  });

  test("没有可撤销 / 可重做时返回 null；超过上限丢最旧的", () => {
    expect(undoHistory(emptyHistory<number>(), 1)).toBeNull();
    expect(redoHistory(emptyHistory<number>(), 1)).toBeNull();
    let h = emptyHistory<number>();
    for (let i = 0; i < 5; i++) h = pushHistory(h, i, 3);
    expect(h.past).toEqual([2, 3, 4]);
  });

  test("撤销到 0 这类假值也能正确退回", () => {
    const h = pushHistory(emptyHistory<number>(), 0);
    expect(undoHistory(h, 5)?.value).toBe(0);
  });
});
