import { expect, test } from "bun:test";

import {
  TOUR_STEPS,
  markTourSeen,
  tourRingBox,
  tourSeen,
  tourSteps,
} from "@/pages/drama/workspace/final/final-tour";

/** 内存里的假存储 */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const allPresent = () => true;

test("可编辑时走完整 6 步主流程，顺序是素材、主轨、轨道、剪辑、预览、导出", () => {
  expect(tourSteps(false, allPresent).map((s) => s.target)).toEqual([
    "media",
    "main-track",
    "tracks",
    "edit-tools",
    "preview",
    "export",
  ]);
  expect(TOUR_STEPS).toHaveLength(6);
});

test("只读时跳过需要编辑权限的步骤，只剩素材、预览、导出", () => {
  expect(tourSteps(true, allPresent).map((s) => s.target)).toEqual(["media", "preview", "export"]);
});

test("页面上找不到目标的步骤被跳过", () => {
  const steps = tourSteps(false, (target) => target !== "main-track");
  expect(steps.map((s) => s.target)).not.toContain("main-track");
  expect(steps).toHaveLength(5);
});

test("没看过时 tourSeen 为 false，标记后为 true", () => {
  const storage = memoryStorage();
  expect(tourSeen(storage)).toBe(false);
  markTourSeen(storage);
  expect(tourSeen(storage)).toBe(true);
});

test("看过的是旧版本引导时当作没看过", () => {
  expect(tourSeen(memoryStorage({ "vc.drama-final-tour": "0" }))).toBe(false);
});

test("存储不可用时当作已看过，不自动打扰；写入失败不报错", () => {
  expect(tourSeen(null)).toBe(true);
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(tourSeen(broken)).toBe(true);
  expect(() => markTourSeen(broken)).not.toThrow();
});

test("高亮框按遮罩挖洞的大小扩出留白，圆角不超过短边一半", () => {
  const rect = { left: 100, top: 50, width: 200, height: 10 };
  expect(tourRingBox(rect, 6, 16)).toEqual({
    left: 94,
    top: 44,
    width: 212,
    height: 22,
    radius: 11,
  });
  expect(tourRingBox({ left: 0, top: 0, width: 300, height: 300 }, 6, 16).radius).toBe(16);
});
