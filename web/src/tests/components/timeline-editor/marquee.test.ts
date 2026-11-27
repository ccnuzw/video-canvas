import { describe, expect, test } from "bun:test";

import { emptyTimeline, normalize } from "@/components/timeline-editor/model";
import { removeSelection } from "@/components/timeline-editor/timeline/edit-actions";
import {
  HEAD_WIDTH,
  LANE_PAD,
  ROW_HEIGHT,
  RULER_HEIGHT,
} from "@/components/timeline-editor/timeline/layout";
import { clipsInMarquee, marqueeBounds } from "@/components/timeline-editor/timeline/marquee";

import { clip } from "./fixtures";

describe("时间线框选", () => {
  const rowTop = RULER_HEIGHT + ROW_HEIGHT.text;
  const origin = HEAD_WIDTH + LANE_PAD;
  const timeline = normalize({
    ...emptyTimeline(),
    tracks: [
      { ...emptyTimeline().tracks[0] },
      { ...emptyTimeline().tracks[1], clips: [clip("overlay", { startMs: 200, outMs: 3000 })] },
      {
        ...emptyTimeline().tracks[2],
        clips: [clip("a", { outMs: 1000 }), clip("b", { outMs: 1000 }), clip("c", { outMs: 1000 })],
      },
      {
        ...emptyTimeline().tracks[3],
        locked: true,
        clips: [clip("locked", { type: "audio", outMs: 3000 })],
      },
    ],
  });

  test("从右下往左上拖动，选中跨轨相交的片段并跳过锁定轨", () => {
    const box = marqueeBounds(
      { x: origin + 168, y: rowTop + 145 },
      { x: origin + 12, y: rowTop + 8 },
    );
    expect(clipsInMarquee(timeline.tracks, 100, box)).toEqual(["overlay", "a", "b"]);
  });

  test("选框只贴到片段边缘时不命中", () => {
    const box = marqueeBounds({ x: origin - 10, y: rowTop + 8 }, { x: origin, y: rowTop + 100 });
    expect(clipsInMarquee(timeline.tracks, 100, box)).toEqual([]);
  });

  test("删除框选的主轨和叠加片段，剩余主轨片段一次补位", () => {
    const result = removeSelection(timeline, ["overlay", "a", "b"]);
    expect("timeline" in result && result.timeline.tracks[1].clips).toEqual([]);
    expect(
      "timeline" in result &&
        result.timeline.tracks[2].clips.map(({ id, startMs }) => ({ id, startMs })),
    ).toEqual([{ id: "c", startMs: 0 }]);
    expect(removeSelection(timeline, ["a", "locked"])).toEqual({ error: "这条轨已锁定" });
  });
});
