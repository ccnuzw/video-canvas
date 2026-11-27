import { describe, expect, test } from "bun:test";

import { scrollFromThumb, thumbOf } from "@/components/timeline-editor/timeline/scrollbar";

describe("自绘滚动条的滑块", () => {
  test("内容没超出时没有滑块", () => {
    expect(thumbOf({ scroll: 0, viewport: 800, content: 800, track: 400 })).toBeNull();
    expect(thumbOf({ scroll: 0, viewport: 800, content: 600, track: 400 })).toBeNull();
  });

  test("滑块长度按可见比例，位置按滚动比例；滚到底时贴住末尾", () => {
    expect(thumbOf({ scroll: 0, viewport: 500, content: 1000, track: 400 })).toEqual({
      size: 200,
      offset: 0,
    });
    expect(thumbOf({ scroll: 500, viewport: 500, content: 1000, track: 400 })).toEqual({
      size: 200,
      offset: 200,
    });
    expect(thumbOf({ scroll: 250, viewport: 500, content: 1000, track: 400 })?.offset).toBe(100);
  });

  test("内容很长时滑块不小于最小长度，位置仍能走满整条轨道", () => {
    const start = thumbOf({ scroll: 0, viewport: 100, content: 100000, track: 400 })!;
    const end = thumbOf({ scroll: 99900, viewport: 100, content: 100000, track: 400 })!;
    expect(start.size).toBe(24);
    expect(end.offset + end.size).toBe(400);
  });

  test("滚动位置越界（如回弹）时滑块夹在轨道内", () => {
    expect(thumbOf({ scroll: -50, viewport: 500, content: 1000, track: 400 })?.offset).toBe(0);
    expect(thumbOf({ scroll: 900, viewport: 500, content: 1000, track: 400 })?.offset).toBe(200);
  });

  test("拖滑块换算回滚动位置，并夹在可滚范围内", () => {
    const geo = { viewport: 500, content: 1000, track: 400 };
    expect(scrollFromThumb(100, geo)).toBe(250);
    expect(scrollFromThumb(-20, geo)).toBe(0);
    expect(scrollFromThumb(999, geo)).toBe(500);
  });
});
