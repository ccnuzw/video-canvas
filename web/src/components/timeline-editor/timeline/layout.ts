import type { EditorTrack, TrackKind } from "../types";

/**
 * 时间线面板的布局常量和像素 ↔ 毫秒换算（纯函数）。
 * 缩放用「每秒多少像素」（pps）表示；轨道内容的 x 坐标从 LANE_PAD 开始，0 毫秒在那里。
 */

/** 轨道内容左侧留白（像素），0 毫秒从这里开始 */
export const LANE_PAD = 12;
/** 轨道末尾留白（像素），方便把素材拖到最后 */
export const LANE_TAIL = 48;
/** 轨道头的宽度（像素） */
export const HEAD_WIDTH = 168;
/** 刻度尺的高度（像素） */
export const RULER_HEIGHT = 28;
/** 片段距轨道行上下边缘的内缩（像素） */
export const CLIP_INSET = 4;
/** 工具条的高度（像素）：按钮 32px + 上下内边距 12px + 底边框 1px，改工具条样式时同步 */
export const TOOLBAR_HEIGHT = 45;
/** 轨道内容底部给自绘横向滚动条留的空（像素），免得滚动条压住最后一条轨 */
export const SCROLLBAR_GUTTER = 14;
/** 面板的其余占用（像素）：横向滚动条的留空，再加一点余量 */
export const PANEL_CHROME = SCROLLBAR_GUTTER + 4;
/** 缩放上限，每秒 240 像素可清楚显示半秒刻度 */
export const MAX_PPS = 240;

/** 各种轨道一行的高度（像素） */
export const ROW_HEIGHT: Record<TrackKind, number> = {
  text: 32,
  overlay: 46,
  main: 64,
  audio: 44,
};

/** 刻度间隔候选（秒），取第一个间距不小于 64px 的 */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200];

/** 缩放夹在允许范围内 */
export const clampPps = (pps: number, minPps: number): number =>
  Math.min(MAX_PPS, Math.max(minPps, pps));

/** 缩放值 → 滑杆位置（0–100，对数刻度） */
export const ppsToSlider = (pps: number, minPps: number): number =>
  minPps === MAX_PPS ? 0 : Math.round((Math.log(pps / minPps) / Math.log(MAX_PPS / minPps)) * 100);

/** 滑杆位置（0–100）→ 缩放值 */
export const sliderToPps = (value: number, minPps: number): number =>
  value === 100 ? MAX_PPS : minPps * Math.pow(MAX_PPS / minPps, value / 100);

/** 毫秒 → 轨道内容里的 x 坐标（像素） */
export const msToX = (ms: number, pps: number): number => LANE_PAD + (ms / 1000) * pps;

/** 轨道内容里的 x 坐标（像素）→ 毫秒 */
export const xToMs = (x: number, pps: number): number => ((x - LANE_PAD) / pps) * 1000;

/** 适配宽度也是缩小下限；尚无片段时先显示约 8 秒 */
export function fitPps(viewportPx: number, totalMs: number): number {
  const usableWidth = Math.max(1, viewportPx - LANE_PAD - LANE_TAIL);
  const seconds = totalMs > 0 ? totalMs / 1000 : 8;
  return Math.min(MAX_PPS, usableWidth / seconds);
}

/** 轨道内容的宽度：装得下就铺满可见区域（不出滚动条），装不下就撑开 */
export const laneWidth = (totalMs: number, pps: number, viewportPx: number): number =>
  Math.max(LANE_PAD + (totalMs / 1000) * pps + LANE_TAIL, viewportPx);

/** 刻度间隔（秒） */
export const rulerStep = (pps: number): number => STEPS.find((s) => s * pps >= 64) ?? 1800;

/** 刻度尺上要画的刻度（秒） */
export function rulerTicks(widthPx: number, pps: number): number[] {
  const step = rulerStep(pps);
  const ticks: number[] = [];
  for (let s = 0; s <= (widthPx - LANE_PAD) / pps; s += step) ticks.push(s);
  return ticks;
}

/** 缩放后的横向滚动位置：让 timeMs 处停在可见区域里原来的位置（anchorX） */
export const anchoredScroll = (timeMs: number, anchorX: number, pps: number): number =>
  Math.max(0, msToX(timeMs, pps) - anchorX);

/** 一段在轨道内容里的位置和宽度（像素）；用 1px 分隔相接的片段，最窄 6px */
export const clipBox = (
  startMs: number,
  lenMs: number,
  pps: number,
): { left: number; width: number } => ({
  left: msToX(startMs, pps),
  width: Math.max((lenMs / 1000) * pps - 1, 6),
});

/** 秒 → 「mm:ss」；半秒刻度加小数 */
export function formatClock(seconds: number): string {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const wholeSeconds = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${minutes}:${wholeSeconds}${Number.isInteger(seconds) ? "" : ".5"}`;
}

/** 毫秒 → 「3.0s」 */
export const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** 时间线面板刚好放下工具条、刻度尺和全部轨道（不出现竖向滚动条）需要的高度（像素） */
export const fitPanelHeight = (tracks: readonly EditorTrack[]): number =>
  TOOLBAR_HEIGHT +
  RULER_HEIGHT +
  PANEL_CHROME +
  tracks.reduce((sum, track) => sum + ROW_HEIGHT[track.kind], 0);
