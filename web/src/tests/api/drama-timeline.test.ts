import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import { getTimeline, mapTimeline, saveTimeline, toTimelineBody } from "@/api/drama/timeline";
import type { BackendTimelineView, DramaClipHost } from "@/api/drama/type";
import { clipLength } from "@/components/timeline-editor/model";
import service from "@/utils/requests/service";

/** 一份覆盖所有轨道类型的后端视图 */
const rawView = (): BackendTimelineView => ({
  tracks: [
    {
      id: "text1",
      kind: "text",
      name: "字幕",
      clips: [
        {
          id: "t1",
          kind: "text",
          text: "你好",
          style: "title",
          pos: "top",
          size: 120,
          in_ms: 0,
          out_ms: 2000,
          start_ms: 1000,
          volume: 100,
        },
      ],
    },
    {
      id: "overlay1",
      kind: "overlay",
      name: "叠加",
      hidden: true,
      clips: [
        {
          id: "o1",
          kind: "segment",
          segment_id: "s1",
          task_id: "t9",
          pinned: true,
          in_ms: 500,
          out_ms: 3500,
          start_ms: 2000,
          volume: 60,
          fade_in_ms: 300,
          x: 72,
          y: 22,
          scale: 42,
          opacity: 80,
        },
      ],
    },
    {
      id: "main",
      kind: "main",
      name: "主轨",
      muted: true,
      clips: [
        {
          id: "a",
          kind: "segment",
          segment_id: "s1",
          task_id: "t1",
          in_ms: 0,
          out_ms: 4000,
          volume: 100,
        },
        {
          id: "b",
          kind: "segment",
          segment_id: "s2",
          task_id: null,
          in_ms: 0,
          out_ms: 10000,
          volume: 100,
        },
        {
          id: "c",
          kind: "asset",
          asset_id: "i1",
          media: "image",
          in_ms: 0,
          out_ms: 3000,
          volume: 100,
        },
      ],
    },
    {
      id: "voice1",
      kind: "audio",
      role: "voice",
      name: "配音",
      locked: true,
      clips: [
        {
          id: "v1",
          kind: "asset",
          asset_id: "a1",
          media: "audio",
          in_ms: 0,
          out_ms: 4000,
          start_ms: 2000,
          volume: 150,
          fade_out_ms: 500,
          muted: true,
        },
      ],
    },
    { id: "music1", kind: "audio", name: "BGM", clips: null },
  ],
  removed_segment_ids: ["s3"],
  imports: ["a1"],
  revision: 4,
  changes: [{ kind: "swapped", segment_id: "s1", seq: 0, clip_id: "a" }],
  invalid_clip_ids: ["o1"],
  assets: [],
});

const clipOf = (view: ReturnType<typeof mapTimeline>, id: string) =>
  view.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const hostOf = (c: { host: unknown }) => c.host as DramaClipHost;

describe("后端时间线 → 前端", () => {
  test("轨道属性映射，缺省值补齐：音频角色缺省 sfx，null 的 clips 变空数组", () => {
    const view = mapTimeline(rawView());
    expect(view.tracks.map((t) => [t.id, t.kind, t.role])).toEqual([
      ["text1", "text", null],
      ["overlay1", "overlay", null],
      ["main", "main", null],
      ["voice1", "audio", "voice"],
      ["music1", "audio", "sfx"],
    ]);
    const [, overlay, main, voice, music] = view.tracks;
    expect([overlay.hidden, main.muted, voice.locked, music.clips]).toEqual([true, true, true, []]);
    expect(view.revision).toBe(4);
    expect(view.removedSegmentIds).toEqual(["s3"]);
    expect(view.imports).toEqual(["a1"]);
    expect(view.invalidClipIds).toEqual(["o1"]);
    expect(view.changes).toEqual([{ kind: "swapped", segmentId: "s1", seq: 0, clipId: "a" }]);
  });

  test("主轨起点按顺序算出来，空任务是待采用占位（ref 为 null）", () => {
    const view = mapTimeline(rawView());
    expect(["a", "b", "c"].map((id) => clipOf(view, id).startMs)).toEqual([0, 4000, 14000]);
    const placeholder = clipOf(view, "b");
    expect([placeholder.type, placeholder.ref, hostOf(placeholder).taskId]).toEqual([
      "video",
      null,
      "",
    ]);
    expect(clipOf(view, "a").ref).toBe("take:t1");
  });

  test("通用类型和宿主字段：片段=video，素材取 media，文字=text", () => {
    const view = mapTimeline(rawView());
    expect(clipOf(view, "c")).toMatchObject({ type: "image", ref: "asset:i1" });
    expect(hostOf(clipOf(view, "c"))).toMatchObject({
      kind: "asset",
      assetId: "i1",
      media: "image",
    });
    expect(clipOf(view, "v1")).toMatchObject({
      type: "audio",
      ref: "asset:a1",
      muted: true,
      volume: 150,
    });
    expect(clipOf(view, "t1")).toMatchObject({
      type: "text",
      ref: null,
      startMs: 1000,
      text: { text: "你好", style: "title", pos: "top", size: 120 },
    });
    expect(hostOf(clipOf(view, "o1"))).toMatchObject({
      kind: "segment",
      segmentId: "s1",
      taskId: "t9",
      pinned: true,
    });
  });

  test("叠加参数只在叠加轨的片段上；音量淡入淡出缺省值", () => {
    const view = mapTimeline(rawView());
    expect(clipOf(view, "o1").overlay).toEqual({ x: 72, y: 22, scale: 42, opacity: 80 });
    expect(clipOf(view, "o1")).toMatchObject({
      volume: 60,
      fadeInMs: 300,
      fadeOutMs: 0,
      startMs: 2000,
    });
    expect(clipOf(view, "a").overlay).toBeNull();
    expect(clipOf(view, "a").text).toBeNull();
    expect(clipLength(clipOf(view, "o1"))).toBe(3000);
  });

  test("字段全缺失的旧式片段也能读：音量 100，叠加铺满", () => {
    const view = mapTimeline({
      ...rawView(),
      tracks: [
        {
          id: "overlay1",
          kind: "overlay",
          name: "叠加",
          clips: [
            {
              id: "x",
              kind: "asset",
              asset_id: "m",
              media: "image",
              in_ms: 0,
              out_ms: 3000,
              start_ms: 0,
            },
          ],
        },
        { id: "main", kind: "main", name: "主轨", clips: [] },
      ],
    });
    expect(clipOf(view, "x")).toMatchObject({
      volume: 100,
      fadeInMs: 0,
      overlay: { x: 50, y: 50, scale: 100, opacity: 100 },
    });
  });

  test("tracks 为 null 时给空数组", () => {
    expect(mapTimeline({ ...rawView(), tracks: null }).tracks).toEqual([]);
  });
});

describe("前端时间线 → 请求体", () => {
  test("读出来再存回去，字段保持一致（往返）", () => {
    const raw = rawView();
    const view = mapTimeline(raw);
    const body = toTimelineBody(view, 4);
    expect(body.revision).toBe(4);
    expect(body.removed_segment_ids).toEqual(["s3"]);
    expect(body.imports).toEqual(["a1"]);
    expect("clips" in body).toBe(false);
    expect("muted" in body).toBe(false);
    const byId = Object.fromEntries(
      body.tracks.flatMap((t) => t.clips ?? []).map((c) => [c.id, c]),
    );
    expect(byId.t1).toMatchObject({
      kind: "text",
      text: "你好",
      style: "title",
      pos: "top",
      size: 120,
      start_ms: 1000,
      in_ms: 0,
      out_ms: 2000,
    });
    expect(byId.o1).toMatchObject({
      kind: "segment",
      segment_id: "s1",
      task_id: "t9",
      pinned: true,
      start_ms: 2000,
      x: 72,
      y: 22,
      scale: 42,
      opacity: 80,
      volume: 60,
      fade_in_ms: 300,
      fade_out_ms: 0,
    });
    expect(byId.v1).toMatchObject({
      kind: "asset",
      asset_id: "a1",
      media: "audio",
      muted: true,
      volume: 150,
      start_ms: 2000,
    });
    expect(byId.c).toMatchObject({ kind: "asset", asset_id: "i1", media: "image" });
    const voice = body.tracks.find((t) => t.id === "voice1")!;
    expect([voice.kind, voice.role, voice.name, voice.locked]).toEqual([
      "audio",
      "voice",
      "配音",
      true,
    ]);
  });

  test("主轨片段不带 start_ms；待采用占位 task_id 为 null；文字轨不带 role", () => {
    const body = toTimelineBody(mapTimeline(rawView()), 0);
    const main = body.tracks.find((t) => t.id === "main")!;
    expect(main.clips!.every((c) => !("start_ms" in c))).toBe(true);
    expect(main.clips![1]).toMatchObject({
      id: "b",
      kind: "segment",
      task_id: null,
      pinned: false,
    });
    expect("role" in body.tracks[0]).toBe(false);
  });

  test("只发本种类用到的字段：素材片段没有 segment_id，叠加参数只在叠加轨", () => {
    const body = toTimelineBody(mapTimeline(rawView()), 0);
    const all = Object.fromEntries(body.tracks.flatMap((t) => t.clips ?? []).map((c) => [c.id, c]));
    expect("segment_id" in all.c).toBe(false);
    expect("x" in all.a).toBe(false);
    expect("text" in all.a).toBe(false);
    expect("asset_id" in all.a).toBe(false);
  });

  test("附属轨上的片段版本始终固定；编辑器新建的文字片段（没有宿主数据）也能存", () => {
    const view = mapTimeline(rawView());
    const overlay = view.tracks[1];
    overlay.clips[0] = {
      ...overlay.clips[0],
      host: { ...hostOf(overlay.clips[0]), pinned: false },
    };
    view.tracks[0].clips.push({
      id: "new",
      type: "text",
      ref: null,
      startMs: 5000,
      inMs: 0,
      outMs: 2000,
      muted: false,
      volume: 100,
      fadeInMs: 0,
      fadeOutMs: 0,
      overlay: null,
      text: { text: "新字幕", style: "subtitle", pos: "bottom", size: 100 },
      host: null,
    });
    const body = toTimelineBody(view, 1);
    const all = Object.fromEntries(body.tracks.flatMap((t) => t.clips ?? []).map((c) => [c.id, c]));
    expect(all.o1.pinned).toBe(true);
    expect(all.new).toMatchObject({ kind: "text", text: "新字幕", start_ms: 5000 });
  });

  test("毫秒取整", () => {
    const view = mapTimeline(rawView());
    view.tracks[2].clips[0] = { ...view.tracks[2].clips[0], inMs: 10.4, outMs: 3999.6 };
    const body = toTimelineBody(view, 0);
    expect(body.tracks[2].clips![0]).toMatchObject({ in_ms: 10, out_ms: 4000 });
  });
});

describe("接口调用", () => {
  let get: Mock<typeof service.get>;
  let put: Mock<typeof service.put>;
  beforeEach(() => {
    get = spyOn(service, "get");
    put = spyOn(service, "put");
  });
  afterEach(() => {
    get.mockRestore();
    put.mockRestore();
  });

  test("getTimeline 读 /timeline 并映射", async () => {
    get.mockResolvedValue(rawView());
    const view = await getTimeline("d1", 2);
    expect(get.mock.calls[0][0]).toBe("/dramas/d1/episodes/2/timeline");
    expect(view.tracks).toHaveLength(5);
  });

  test("saveTimeline 静默 PUT，带版本和轨道", async () => {
    put.mockResolvedValue(rawView());
    const view = await saveTimeline("d1", 2, mapTimeline(rawView()), 4);
    const [url, body, config] = put.mock.calls[0] as unknown as [
      string,
      { revision: number; tracks: unknown[] },
      { silent: boolean },
    ];
    expect(url).toBe("/dramas/d1/episodes/2/timeline");
    expect(body.revision).toBe(4);
    expect(body.tracks).toHaveLength(5);
    expect(config).toEqual({ silent: true });
    expect(view.revision).toBe(4);
  });
});
