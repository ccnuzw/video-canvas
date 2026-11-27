import { describe, expect, test } from "bun:test";

import { emptyTimeline } from "@/components/timeline-editor/model";
import {
  LANE_PAD,
  MAX_PPS,
  PANEL_CHROME,
  RULER_HEIGHT,
  TOOLBAR_HEIGHT,
  anchoredScroll,
  clampPps,
  clipBox,
  fitPanelHeight,
  fitPps,
  formatClock,
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

  test("缩小下限等于当前序列的适配比例，滑杆两端与缩放限制一致", () => {
    const min = fitPps(1200, 15_260);
    expect(clampPps(14, min)).toBe(min);
    expect(clampPps(999, min)).toBe(MAX_PPS);
    expect(sliderToPps(0, min)).toBe(min);
    expect(sliderToPps(100, min)).toBe(MAX_PPS);
    for (const pps of [min, 100, 160, MAX_PPS]) {
      expect(Math.abs(sliderToPps(ppsToSlider(pps, min), min) / pps - 1)).toBeLessThan(0.02);
    }
    expect(ppsToSlider(MAX_PPS, MAX_PPS)).toBe(0);
  });

  test("适配宽度：有内容用实际时长，长片可以继续缩小，空轨按 8 秒算", () => {
    expect(fitPps(912, 60_000)).toBeCloseTo((912 - 12 - 48) / 60);
    expect(fitPps(912, 1_800_000)).toBeLessThan(2);
    expect(fitPps(320, 2_000)).toBeCloseTo((320 - 12 - 48) / 2);
    expect(fitPps(912, 0)).toBeCloseTo((912 - 12 - 48) / 8);
    expect(fitPps(5000, 2_000)).toBe(240);
  });

  test("轨道宽度：内容装得下就铺满可见区域，装不下就撑开", () => {
    expect(laneWidth(10_000, 20, 1000)).toBe(1000);
    expect(laneWidth(100_000, 20, 1000)).toBe(LANE_PAD + 2000 + 48);
  });

  test("刻度间隔取间距不小于 64px 的第一档", () => {
    expect(rulerTicks(200, 14)).toEqual([0, 5, 10]);
    expect(rulerTicks(400, 100)).toEqual([0, 1, 2, 3]);
    expect(rulerTicks(400, MAX_PPS)).toEqual([0, 0.5, 1, 1.5]);
    expect(formatClock(60.5)).toBe("01:00.5");
  });

  test("缩放锚点：缩放后滚动位置让播放头停在原来的屏幕位置，不会小于 0", () => {
    expect(anchoredScroll(10_000, 100, 20)).toBe(LANE_PAD + 200 - 100);
    expect(anchoredScroll(0, 500, 20)).toBe(0);
  });

  test("首尾相接的片段只留一像素分隔，实际间隔随缩放显示", () => {
    for (const pps of [14, 160]) {
      const first = clipBox(1000, 3000, pps);
      const next = clipBox(4000, 3000, pps);
      const later = clipBox(4500, 3000, pps);
      expect(next.left - (first.left + first.width)).toBeCloseTo(1);
      expect(later.left - next.left).toBeCloseTo(pps / 2);
    }
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
