import { describe, expect, test } from "bun:test";

import { emptyTimeline } from "@/components/timeline-editor/model";
import {
  LANE_PAD,
  PANEL_CHROME,
  RULER_HEIGHT,
  TOOLBAR_HEIGHT,
  anchoredScroll,
  clampPps,
  fitPanelHeight,
  fitPps,
  laneWidth,
  msToX,
  ppsToSlider,
  rulerTicks,
  sliderToPps,
  xToMs,
} from "@/components/timeline-editor/timeline/layout";

describe("时间线布局换算", () => {
  test("毫秒和像素互相换算，0 从左侧留白开始", () => {
    expect(msToX(0, 20)).toBe(LANE_PAD);
    expect(msToX(2500, 20)).toBe(LANE_PAD + 50);
    expect(xToMs(LANE_PAD + 50, 20)).toBeCloseTo(2500);
  });

  test("缩放范围夹在 2–160，滑杆来回换算误差在 5% 内", () => {
    expect(clampPps(0.1)).toBe(2);
    expect(clampPps(999)).toBe(160);
    for (const pps of [2, 14, 60, 160]) {
      expect(Math.abs(sliderToPps(ppsToSlider(pps)) / pps - 1)).toBeLessThan(0.05);
    }
  });

  test("适配宽度：总长至少按 8 秒算，结果不超过上限", () => {
    expect(fitPps(912, 60_000)).toBeCloseTo((912 - 12 - 48) / 60);
    expect(fitPps(912, 2_000)).toBeCloseTo((912 - 12 - 48) / 8);
    expect(fitPps(5000, 2_000)).toBe(160);
  });

  test("轨道宽度：内容装得下就铺满可见区域，装不下就撑开", () => {
    expect(laneWidth(10_000, 20, 1000)).toBe(1000);
    expect(laneWidth(100_000, 20, 1000)).toBe(LANE_PAD + 2000 + 48);
  });

  test("刻度间隔取间距不小于 64px 的第一档", () => {
    expect(rulerTicks(200, 14)).toEqual([0, 5, 10]);
    expect(rulerTicks(400, 100)).toEqual([0, 1, 2, 3]);
  });

  test("缩放锚点：缩放后滚动位置让播放头停在原来的屏幕位置，不会小于 0", () => {
    expect(anchoredScroll(10_000, 100, 20)).toBe(LANE_PAD + 200 - 100);
    expect(anchoredScroll(0, 500, 20)).toBe(0);
  });
});

describe("时间线面板的默认高度", () => {
  test("刚好放下工具条、刻度尺和全部轨道，再留出横向滚动条的位置", () => {
    const tracks = emptyTimeline().tracks;
    const rows = 32 + 46 + 64 + 44 + 44;
    expect(fitPanelHeight(tracks)).toBe(TOOLBAR_HEIGHT + RULER_HEIGHT + rows + PANEL_CHROME);
  });

  test("轨道越多越高；没有轨道时也至少放得下工具条和刻度尺", () => {
    const tracks = emptyTimeline().tracks;
    const more = [...tracks, { ...tracks[3], id: "a3" }];
    expect(fitPanelHeight(more)).toBe(fitPanelHeight(tracks) + 44);
    expect(fitPanelHeight([])).toBe(TOOLBAR_HEIGHT + RULER_HEIGHT + PANEL_CHROME);
  });
});
