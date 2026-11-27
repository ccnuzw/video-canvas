import { describe, expect, test } from "bun:test";

import {
  downsamplePeaks,
  pseudoPeaks,
  windowPeaks,
} from "@/components/timeline-editor/timeline/waveform";

describe("波形峰值", () => {
  test("下采样取每格最大绝对值，并归一化到 0–1", () => {
    const data = new Float32Array([0.1, -0.5, 0.2, 0.25, -1, 0.3]);
    expect(downsamplePeaks(data, 3)).toEqual([0.5, 0.25, 1]);
  });

  test("全是静音时不会除以 0", () => {
    expect(downsamplePeaks(new Float32Array(10), 2)).toEqual([0, 0]);
    expect(downsamplePeaks(new Float32Array(0), 4)).toEqual([0, 0, 0, 0]);
  });

  test("伪波形：同一个种子结果固定，数值都在 0–1", () => {
    const a = pseudoPeaks("clip-1", 30);
    expect(a).toEqual(pseudoPeaks("clip-1", 30));
    expect(a).not.toEqual(pseudoPeaks("clip-2", 30));
    expect(a.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(a).toHaveLength(30);
  });

  test("取片段入出点范围内的峰值并重采样成指定条数", () => {
    const peaks = [0, 1, 0, 0];
    expect(windowPeaks(peaks, 1, 1000, 3000, 2)).toEqual([1, 0]);
    expect(windowPeaks(peaks, 1, 0, 4000, 4)).toEqual([0, 1, 0, 0]);
    expect(windowPeaks(peaks, 1, 0, 1000, 0)).toEqual([]);
  });
});
