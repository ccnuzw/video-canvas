import { describe, expect, test } from "bun:test";

import type { AssetDto } from "@/api/asset/type";
import type { DramaClipHost, Segment, Timeline } from "@/api/drama/type";
import { emptyTimeline, mainTrack } from "@/components/timeline-editor/model";
import type { EditorClip, EditorTrack } from "@/components/timeline-editor/types";
import {
  assetClip,
  attachedHasClips,
  changeText,
  composeReason,
  defaultTimeline,
  isPlaceholder,
  resolveClip,
  segmentClip,
  swapTake,
  takeClip,
  trackRemovedSegments,
} from "@/utils/drama/timeline";

const asset = (
  id: string,
  kind: "video" | "image" | "audio",
  durationMs: number | null,
  url = `/files/${id}`,
): AssetDto => ({
  id,
  url,
  kind,
  mimeType: "",
  byteSize: 1,
  width: null,
  height: null,
  durationMs,
  fileName: `${id}.${kind === "video" ? "mp4" : kind === "image" ? "png" : "mp3"}`,
});

const take = (
  taskId: string,
  durationMs: number,
  status: "succeeded" | "failed" = "succeeded",
) => ({
  taskId,
  status,
  asset: status === "succeeded" ? asset(`a${taskId}`, "video", durationMs) : null,
  errorMessage: "",
  createdAt: "",
});

/** 片段 01 有 t1（15 秒）、t2（12 秒），采用 t1；片段 02 没有采用 */
const segments: Segment[] = [
  {
    id: "s1",
    episodeNo: 1,
    seq: 0,
    seconds: 15,
    prompt: "",
    takes: [take("t1", 15000), take("t2", 12000), take("t3", 0, "failed")],
    chosenTaskId: "t1",
    status: "done",
    revision: 1,
    updatedAt: "",
    adaptations: {},
  } as unknown as Segment,
  {
    id: "s2",
    episodeNo: 1,
    seq: 1,
    seconds: 10,
    prompt: "",
    takes: [],
    chosenTaskId: "",
    status: "idle",
    revision: 1,
    updatedAt: "",
    adaptations: {},
  } as unknown as Segment,
];

const hostFor = (over: Partial<DramaClipHost>): DramaClipHost => ({
  kind: "segment",
  segmentId: "",
  taskId: "",
  pinned: false,
  assetId: "",
  media: null,
  ...over,
});

const base = (id: string, over: Partial<EditorClip>): EditorClip => ({
  id,
  type: "video",
  ref: null,
  startMs: 0,
  inMs: 0,
  outMs: 1000,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: null,
  host: null,
  ...over,
});

const seg = (id: string, segmentId: string, taskId: string, inMs: number, outMs: number) =>
  base(id, {
    ref: taskId ? `take:${taskId}` : null,
    inMs,
    outMs,
    host: hostFor({ kind: "segment", segmentId, taskId }),
  });

const media = (id: string, assetId: string, kind: "image" | "video" | "audio", outMs: number) =>
  base(id, {
    type: kind,
    ref: `asset:${assetId}`,
    outMs,
    host: hostFor({ kind: "asset", assetId, media: kind }),
  });

const assets = new Map([
  ["i1", asset("i1", "image", null)],
  ["a1", asset("a1", "audio", 8000)],
]);

/** 主轨放 clips，附属轨放进指定轨 */
function timelineOf(main: EditorClip[], attached: Record<string, EditorClip[]> = {}): Timeline {
  const base = emptyTimeline();
  return {
    tracks: base.tracks.map((track) =>
      track.kind === "main"
        ? { ...track, clips: main }
        : { ...track, clips: attached[track.id] ?? [] },
    ),
    removedSegmentIds: [],
    imports: [],
  };
}

describe("默认时间线", () => {
  test("主轨按片段序号、全长、跟随铺好，附属轨为空", () => {
    const t = defaultTimeline([...segments].reverse());
    const main = mainTrack({ tracks: t.tracks }).clips;
    expect(
      main.map((c) => [
        (c.host as DramaClipHost).segmentId,
        (c.host as DramaClipHost).taskId,
        c.inMs,
        c.outMs,
      ]),
    ).toEqual([
      ["s1", "t1", 0, 15000],
      ["s2", "", 0, 10000],
    ]);
    expect(main.map((c) => c.startMs)).toEqual([0, 15000]);
    expect(t.tracks.map((x) => x.id)).toEqual(["text1", "overlay1", "main", "voice1", "music1"]);
    expect(t.tracks.filter((x) => x.kind !== "main").every((x) => x.clips.length === 0)).toBe(true);
    expect(t.removedSegmentIds).toEqual([]);
  });

  test("生成的段：ref 和宿主数据填好，待采用占位 ref 为 null", () => {
    const followed = segmentClip(segments[0], "x");
    expect(followed).toMatchObject({ id: "x", type: "video", ref: "take:t1", outMs: 15000 });
    expect(followed.host).toMatchObject({
      kind: "segment",
      segmentId: "s1",
      taskId: "t1",
      pinned: false,
    });
    const placeholder = segmentClip(segments[1], "p");
    expect(placeholder).toMatchObject({ ref: null, outMs: 10000 });
    expect(isPlaceholder(placeholder)).toBe(true);
    expect(isPlaceholder(followed)).toBe(false);
  });

  test("拖入采用的版本是跟随段，其他版本是固定段", () => {
    expect((takeClip(segments[0], "t1").host as DramaClipHost).pinned).toBe(false);
    const pinned = takeClip(segments[0], "t2");
    expect(pinned).toMatchObject({ ref: "take:t2", outMs: 12000 });
    expect((pinned.host as DramaClipHost).pinned).toBe(true);
  });

  test("素材做成段：视频全长、图片默认 3 秒、音频全长", () => {
    expect(assetClip(asset("v", "video", 6000))).toMatchObject({
      type: "video",
      outMs: 6000,
      ref: "asset:v",
    });
    expect(assetClip(asset("i", "image", null))).toMatchObject({ type: "image", outMs: 3000 });
    const audio = assetClip(asset("a", "audio", 4000));
    expect(audio).toMatchObject({ type: "audio", outMs: 4000, ref: "asset:a" });
    expect(audio.host).toMatchObject({ kind: "asset", assetId: "a", media: "audio" });
  });
});

describe("解析段的素材", () => {
  const none = new Set<string>();

  test("跟随段：可播放，带封面、标签含版本", () => {
    expect(resolveClip(seg("a", "s1", "t2", 0, 1000), segments, assets, none)).toMatchObject({
      state: "ready",
      url: "/files/at2",
      durationMs: 12000,
      label: "片段 01 · 版本 2",
      thumbUrl: "/files/at2?v=poster",
    });
  });

  test("待采用占位、失效（版本失败、片段不存在、后端判定失效）", () => {
    expect(resolveClip(seg("b", "s2", "", 0, 1000), segments, assets, none)).toMatchObject({
      state: "placeholder",
      durationMs: 10000,
      label: "片段 02 · 待采用",
      url: null,
    });
    expect(resolveClip(seg("c", "s1", "t3", 0, 1000), segments, assets, none).state).toBe("broken");
    expect(resolveClip(seg("d", "s9", "t1", 0, 1000), segments, assets, none).state).toBe("broken");
    expect(resolveClip(seg("a", "s1", "t1", 0, 1000), segments, assets, new Set(["a"])).state).toBe(
      "broken",
    );
  });

  test("素材：图片用缩略图变体、图片最长 30 秒；音频没有缩略图；种类不符或不存在算失效", () => {
    expect(resolveClip(media("x", "i1", "image", 3000), segments, assets, none)).toMatchObject({
      state: "ready",
      label: "i1.png",
      durationMs: 30000,
      thumbUrl: "/files/i1?v=thumb",
    });
    expect(resolveClip(media("y", "a1", "audio", 3000), segments, assets, none)).toMatchObject({
      state: "ready",
      durationMs: 8000,
      thumbUrl: null,
    });
    expect(resolveClip(media("z", "i9", "image", 3000), segments, assets, none).state).toBe(
      "broken",
    );
    expect(resolveClip(media("w", "i1", "video", 3000), segments, assets, none).state).toBe(
      "broken",
    );
  });

  test("外链地址没有变体，封面为 null；文字片段没有素材，当作可用", () => {
    const external = new Map([["e", asset("e", "video", 5000, "https://cdn.example.com/a.mp4")]]);
    expect(
      resolveClip(media("e1", "e", "video", 1000), segments, external, none).thumbUrl,
    ).toBeNull();
    const text = base("t", {
      type: "text",
      outMs: 2000,
      text: { text: "你好", style: "subtitle", pos: "bottom", size: 100 },
      host: hostFor({ kind: "text" }),
    });
    expect(resolveClip(text, segments, assets, none)).toMatchObject({
      state: "ready",
      label: "你好",
      durationMs: 2000,
    });
  });
});

describe("换版本", () => {
  const a = seg("a", "s1", "t1", 2000, 14000);

  test("固定版本保留入出点并收回；入点越界恢复全长", () => {
    const swapped = swapTake(a, segments[0], "t2");
    expect(swapped).toMatchObject({ ref: "take:t2", inMs: 2000, outMs: 12000 });
    expect(swapped.host).toMatchObject({ taskId: "t2", pinned: true });
    expect(swapTake({ ...a, inMs: 11800 }, segments[0], "t2")).toMatchObject({
      inMs: 0,
      outMs: 12000,
    });
  });

  test("跟随采用恢复不固定；选的正好是采用的那条也不算固定", () => {
    const pinned = swapTake(a, segments[0], "t2");
    const back = swapTake(pinned, segments[0], "follow");
    expect(back).toMatchObject({ ref: "take:t1" });
    expect(back.host).toMatchObject({ taskId: "t1", pinned: false });
    expect((swapTake(pinned, segments[0], "t1").host as DramaClipHost).pinned).toBe(false);
  });

  test("占位换成某版本：从头开始用全长；没有可用结果就退回占位", () => {
    const ph = seg("p", "s1", "", 0, 15000);
    expect(swapTake(ph, segments[0], "t2")).toMatchObject({
      ref: "take:t2",
      inMs: 0,
      outMs: 12000,
    });
    const none = swapTake(a, segments[1], "follow");
    expect(none).toMatchObject({ ref: null, inMs: 0, outMs: 10000 });
    expect(none.host).toMatchObject({ taskId: "", pinned: false });
  });
});

describe("删除名单的维护", () => {
  const tracksOf = (main: EditorClip[]): EditorTrack[] => timelineOf(main).tracks;

  test("主轨上某片段的所有段都消失才记入，拆过的片段删掉一段不记", () => {
    const prev = tracksOf([
      seg("a", "s1", "t1", 0, 5000),
      seg("a2", "s1", "t1", 5000, 15000),
      seg("b", "s2", "", 0, 10000),
    ]);
    expect(
      trackRemovedSegments(
        prev,
        tracksOf([seg("a", "s1", "t1", 0, 5000), seg("a2", "s1", "t1", 5000, 15000)]),
        [],
      ),
    ).toEqual(["s2"]);
    expect(
      trackRemovedSegments(
        prev,
        tracksOf([seg("a2", "s1", "t1", 5000, 15000), seg("b", "s2", "", 0, 10000)]),
        [],
      ),
    ).toEqual([]);
  });

  test("插回的片段从名单里移出；已在名单里的不重复记", () => {
    const prev = tracksOf([seg("a", "s1", "t1", 0, 15000)]);
    const next = tracksOf([seg("c", "s2", "", 0, 10000), seg("a", "s1", "t1", 0, 15000)]);
    expect(trackRemovedSegments(prev, next, ["s2"])).toEqual([]);
    expect(trackRemovedSegments(next, prev, ["s2"])).toEqual(["s2"]);
  });

  test("没变化返回原数组；素材段和附属轨上的片段版本都不算", () => {
    const prev = timelineOf([seg("a", "s1", "t1", 0, 15000)]).tracks;
    const names = ["s9"];
    expect(trackRemovedSegments(prev, prev, names)).toBe(names);
    const withOverlay = timelineOf([seg("a", "s1", "t1", 0, 15000)], {
      overlay1: [{ ...seg("o", "s2", "t2", 0, 1000), startMs: 0 }],
    }).tracks;
    expect(trackRemovedSegments(withOverlay, prev, [])).toEqual([]);
    const assetOnly = timelineOf([media("m", "i1", "image", 3000)]).tracks;
    expect(trackRemovedSegments(assetOnly, tracksOf([]), [])).toEqual([]);
  });
});

describe("导出前检查", () => {
  const ok = {
    timeline: timelineOf([seg("a", "s1", "t1", 0, 15000)]),
    segments,
    assets,
    invalid: new Set<string>(),
    save: "saved" as const,
  };

  test("可以导出时没有原因", () => {
    expect(composeReason(ok)).toBeNull();
  });

  test("保存没成功", () => {
    expect(composeReason({ ...ok, save: "error" })).toBe("时间线没保存成功，先重试保存");
    expect(composeReason({ ...ok, save: "conflict" })).toBe("时间线没保存成功，先重试保存");
  });

  test("主轨失效或没有可用段", () => {
    expect(composeReason({ ...ok, invalid: new Set(["a"]) })).toBe(
      "第 1 段的素材已失效，请换版本或删掉",
    );
    expect(composeReason({ ...ok, timeline: timelineOf([seg("b", "s2", "", 0, 10000)]) })).toBe(
      "至少要有一段可用的视频或图片才能合成",
    );
  });

  test("附属轨上的素材失效也不能导出，指出是哪条轨第几段", () => {
    const withAudio = timelineOf([seg("a", "s1", "t1", 0, 15000)], {
      voice1: [
        media("v1", "a1", "audio", 3000),
        { ...media("v2", "a9", "audio", 3000), startMs: 5000 },
      ],
    });
    expect(composeReason({ ...ok, timeline: withAudio })).toBe(
      "「配音」轨第 2 段的素材已失效，请删掉",
    );
    const flagged = timelineOf([seg("a", "s1", "t1", 0, 15000)], {
      overlay1: [{ ...seg("o", "s1", "t2", 0, 1000), startMs: 0 }],
    });
    expect(composeReason({ ...ok, timeline: flagged, invalid: new Set(["o"]) })).toBe(
      "「叠加」轨第 1 段的素材已失效，请删掉",
    );
  });

  test("附属轨上的文字片段不算失效；attachedHasClips 看附属轨有没有片段", () => {
    const text = base("t", {
      type: "text",
      outMs: 2000,
      text: { text: "你好", style: "subtitle", pos: "bottom", size: 100 },
      host: hostFor({ kind: "text" }),
    });
    const withText = timelineOf([seg("a", "s1", "t1", 0, 15000)], { text1: [text] });
    expect(composeReason({ ...ok, timeline: withText })).toBeNull();
    expect(attachedHasClips(ok.timeline)).toBe(false);
    expect(attachedHasClips(withText)).toBe(true);
  });
});

describe("同步变化的文案", () => {
  test("各种变化", () => {
    expect(
      changeText(
        { kind: "swapped", segmentId: "s1", seq: 0, clipId: "a" },
        segments,
        seg("a", "s1", "t2", 0, 1),
      ),
    ).toBe("片段 01 换成了采用的版本 2");
    expect(
      changeText(
        { kind: "added", segmentId: "s2", seq: 1, clipId: "b" },
        segments,
        seg("b", "s2", "", 0, 1),
      ),
    ).toBe("新增片段 02（待采用）");
    expect(
      changeText(
        { kind: "added", segmentId: "s1", seq: 0, clipId: "b" },
        segments,
        seg("b", "s1", "t1", 0, 1),
      ),
    ).toBe("新增片段 01");
    expect(
      changeText({ kind: "removed", segmentId: "s9", seq: 2, clipId: "" }, segments, null),
    ).toBe("片段 03 已删除，已从时间线移除");
    expect(
      changeText({ kind: "unadopted", segmentId: "s1", seq: 0, clipId: "a" }, segments, null),
    ).toBe("片段 01 取消了采用，变成待采用");
    expect(
      changeText(
        { kind: "adopted", segmentId: "s1", seq: 0, clipId: "a" },
        segments,
        seg("a", "s1", "t1", 0, 1),
      ),
    ).toBe("片段 01 已采用版本 1");
  });
});
