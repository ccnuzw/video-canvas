import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DramaClipHost, Segment, Timeline, TimelineView } from "@/api/drama/type";
import {
  emptyTimeline,
  mainTrack,
  removeClip,
  updateTrack,
} from "@/components/timeline-editor/model";
import type { EditorClip } from "@/components/timeline-editor/types";
import { ApiError } from "@/utils/requests/request";

const clip = (id: string, taskId = "t1", outMs = 15000, segmentId = "s1"): EditorClip => ({
  id,
  type: "video",
  ref: taskId ? `take:${taskId}` : null,
  startMs: 0,
  inMs: 0,
  outMs,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: null,
  host: {
    kind: "segment",
    segmentId,
    taskId,
    pinned: false,
    assetId: "",
    media: null,
  } satisfies DramaClipHost,
});

/** 主轨放 clips 的时间线 */
const timelineOf = (clips: EditorClip[], removedSegmentIds: string[] = []): Timeline => ({
  tracks: emptyTimeline().tracks.map((t) => (t.kind === "main" ? { ...t, clips } : t)),
  removedSegmentIds,
  imports: [],
});

const view = (over: Partial<TimelineView> = {}): TimelineView => ({
  ...timelineOf([clip("a")]),
  revision: 0,
  changes: [],
  invalidClipIds: [],
  assets: [],
  ...over,
});

/** 把主轨静音：一个最小的编辑 */
const muteMain = (t: Timeline): Timeline => ({
  ...t,
  tracks: updateTrack({ tracks: t.tracks }, "main", { muted: true }).tracks,
});

/** 记录接口调用；getImpl / saveImpl 每个用例自己设 */
const calls = { get: 0, saves: [] as Array<{ timeline: Timeline; revision: number }> };
let getImpl: () => Promise<TimelineView>;
let saveImpl: (timeline: Timeline, revision: number) => Promise<TimelineView>;

mock.module("@/api/drama/timeline", () => ({
  getTimeline: () => {
    calls.get++;
    return getImpl();
  },
  saveTimeline: (_id: string, _no: number, timeline: Timeline, revision: number) => {
    calls.saves.push({ timeline, revision });
    return saveImpl(timeline, revision);
  },
}));

const { useDramaTimelineStore } = await import("@/store/drama-timeline");
const store = () => useDramaTimelineStore.getState();
const mainMuted = () => mainTrack({ tracks: store().timeline.tracks }).muted;
const mainIds = () => mainTrack({ tracks: store().timeline.tracks }).clips.map((c) => c.id);

beforeEach(async () => {
  calls.get = 0;
  calls.saves = [];
  getImpl = async () => view();
  saveImpl = async (timeline, revision) => view({ ...timeline, revision: revision + 1 });
  useDramaTimelineStore.setState({ key: null });
  await store().open("d1", 1);
});

describe("时间线编辑器", () => {
  test("打开后编辑、撤销、重做，保存带上版本", async () => {
    expect(store().status).toBe("ready");
    store().edit(muteMain);
    expect(store().save).toBe("dirty");
    store().undoEdit();
    expect(mainMuted()).toBe(false);
    store().redoEdit();
    expect(mainMuted()).toBe(true);
    expect(await store().flush()).toBe(true);
    expect(calls.saves).toHaveLength(1);
    expect(calls.saves[0].revision).toBe(0);
    expect(store().revision).toBe(1);
    expect(store().savedCount).toBe(1);
  });

  test("版本冲突：载入最新版本，撤销栈作废", async () => {
    saveImpl = async () => {
      throw new ApiError("conflict", 67046, 409);
    };
    getImpl = async () => view({ revision: 5, ...timelineOf([clip("server")]) });
    store().edit(muteMain);
    expect(await store().flush()).toBe(false);
    expect(store().revision).toBe(5);
    expect(mainIds()).toEqual(["server"]);
    expect(store().history.past).toHaveLength(0);
    expect(store().save).toBe("saved");
  });

  test("保存失败：状态为 error，再次 flush 会重试", async () => {
    saveImpl = async () => {
      throw new ApiError("bad", 67047, 400);
    };
    store().edit(muteMain);
    expect(await store().flush()).toBe(false);
    expect(store().save).toBe("error");
    saveImpl = async (timeline, revision) => view({ ...timeline, revision: revision + 1 });
    expect(await store().flush()).toBe(true);
    expect(store().save).toBe("saved");
  });

  test("片场变了：重新读到同步变化，可以撤销同步", async () => {
    getImpl = async () =>
      view({
        ...timelineOf([clip("a", "t2", 12000)]),
        changes: [{ kind: "swapped", segmentId: "s1", seq: 0, clipId: "a" }],
      });
    await store().resync();
    const taskOf = (c: EditorClip | undefined) => (c?.host as DramaClipHost | undefined)?.taskId;
    expect(taskOf(mainTrack({ tracks: store().timeline.tracks }).clips[0])).toBe("t2");
    expect(store().sync).toHaveLength(1);
    expect(taskOf(store().sync[0].clip ?? undefined)).toBe("t2");
    store().undoSync();
    expect(taskOf(mainTrack({ tracks: store().timeline.tracks }).clips[0])).toBe("t1");
    expect(store().sync).toHaveLength(0);
    expect(store().save).toBe("dirty");
  });

  test("片场变了但有未保存的改动：先保存，保存的响应带回同步", async () => {
    saveImpl = async (timeline, revision) =>
      view({
        ...timelineOf([clip("a"), clip("n1", "", 10000, "s2")]),
        removedSegmentIds: timeline.removedSegmentIds,
        revision: revision + 1,
        changes: [{ kind: "added", segmentId: "s2", seq: 1, clipId: "n1" }],
      });
    store().edit(muteMain);
    await store().resync();
    expect(calls.get).toBe(1);
    expect(mainIds()).toEqual(["a", "n1"]);
    expect(store().sync).toHaveLength(1);
    store().ackSync();
    expect(store().sync).toHaveLength(0);
  });

  test("共享只读：不能编辑，时间线是按片段现算的默认时间线", () => {
    store().openShared("d1:1", [
      { id: "s1", seq: 0, seconds: 15, takes: [], chosenTaskId: "" } as unknown as Segment,
    ]);
    store().edit(muteMain);
    expect(mainMuted()).toBe(false);
    expect(store().readOnly).toBe(true);
    expect(mainIds()).toEqual(["ds1"]);
  });
});

describe("编辑器改动落到时间线上", () => {
  const two = () =>
    view({
      ...timelineOf([clip("a"), clip("b", "", 10000, "s2")]),
      revision: 1,
    });

  test("applyEditor 替换轨道，主轨上某个片段整个删掉就记入删除名单", async () => {
    getImpl = async () => two();
    await store().open("d2", 1);
    const next = removeClip({ tracks: store().timeline.tracks }, "b");
    store().applyEditor(next);
    expect(mainIds()).toEqual(["a"]);
    expect(store().timeline.removedSegmentIds).toEqual(["s2"]);
    expect(store().history.past).toHaveLength(1);
    expect(store().save).toBe("dirty");
  });

  test("撤销会连删除名单一起退回", async () => {
    getImpl = async () => two();
    await store().open("d3", 1);
    store().applyEditor(removeClip({ tracks: store().timeline.tracks }, "b"));
    store().undoEdit();
    expect(mainIds()).toEqual(["a", "b"]);
    expect(store().timeline.removedSegmentIds).toEqual([]);
  });

  test("没改动不记撤销步", async () => {
    store().applyEditor({ tracks: store().timeline.tracks });
    expect(store().history.past).toHaveLength(0);
    expect(store().save).toBe("saved");
  });

  test("addAssets 合并素材视图；只读时 applyEditor 无效", () => {
    store().addAssets([
      {
        id: "x",
        url: "/f/x",
        kind: "audio",
        mimeType: "",
        byteSize: 1,
        width: null,
        height: null,
        durationMs: 1,
        fileName: "x.mp3",
      },
    ]);
    expect(store().assets.x.kind).toBe("audio");
    store().openShared("d1:9", []);
    store().applyEditor({ tracks: [] });
    expect(store().timeline.tracks.length).toBeGreaterThan(0);
  });
});
