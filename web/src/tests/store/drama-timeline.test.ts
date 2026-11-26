import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { Timeline, TimelineClip, TimelineView } from "@/api/drama/type";
import { ApiError } from "@/utils/requests/request";

const clip = (id: string, taskId = "t1", outMs = 15000): TimelineClip => ({
  id,
  kind: "segment",
  segmentId: "s1",
  taskId,
  pinned: false,
  assetId: "",
  media: null,
  inMs: 0,
  outMs,
  muted: false,
});

const view = (over: Partial<TimelineView> = {}): TimelineView => ({
  clips: [clip("a")],
  muted: false,
  removedSegmentIds: [],
  imports: [],
  revision: 0,
  changes: [],
  invalidClipIds: [],
  assets: [],
  ...over,
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
    store().edit((t) => ({ ...t, muted: true }));
    expect(store().save).toBe("dirty");
    store().undoEdit();
    expect(store().timeline.muted).toBe(false);
    store().redoEdit();
    expect(store().timeline.muted).toBe(true);
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
    getImpl = async () => view({ revision: 5, clips: [clip("server")] });
    store().edit((t) => ({ ...t, muted: true }));
    expect(await store().flush()).toBe(false);
    expect(store().revision).toBe(5);
    expect(store().timeline.clips[0].id).toBe("server");
    expect(store().undo).toHaveLength(0);
    expect(store().save).toBe("saved");
  });

  test("保存失败：状态为 error，再次 flush 会重试", async () => {
    saveImpl = async () => {
      throw new ApiError("bad", 67047, 400);
    };
    store().edit((t) => ({ ...t, muted: true }));
    expect(await store().flush()).toBe(false);
    expect(store().save).toBe("error");
    saveImpl = async (timeline, revision) => view({ ...timeline, revision: revision + 1 });
    expect(await store().flush()).toBe(true);
    expect(store().save).toBe("saved");
  });

  test("片场变了：重新读到同步变化，可以撤销同步", async () => {
    getImpl = async () =>
      view({
        clips: [clip("a", "t2", 12000)],
        changes: [{ kind: "swapped", segmentId: "s1", seq: 0, clipId: "a" }],
      });
    await store().resync();
    expect(store().timeline.clips[0].taskId).toBe("t2");
    expect(store().sync).toHaveLength(1);
    expect(store().sync[0].clip?.taskId).toBe("t2");
    store().undoSync();
    expect(store().timeline.clips[0].taskId).toBe("t1");
    expect(store().sync).toHaveLength(0);
    expect(store().save).toBe("dirty");
  });

  test("片场变了但有未保存的改动：先保存，保存的响应带回同步", async () => {
    saveImpl = async (timeline, revision) =>
      view({
        ...timeline,
        revision: revision + 1,
        clips: [...timeline.clips, clip("n1", "")],
        changes: [{ kind: "added", segmentId: "s2", seq: 1, clipId: "n1" }],
      });
    store().edit((t) => ({ ...t, muted: true }));
    await store().resync();
    expect(calls.get).toBe(1);
    expect(store().timeline.clips.map((c) => c.id)).toEqual(["a", "n1"]);
    expect(store().sync).toHaveLength(1);
    store().ackSync();
    expect(store().sync).toHaveLength(0);
  });

  test("共享只读：不能编辑", () => {
    store().openShared("d1:1", []);
    store().edit((t) => ({ ...t, muted: true }));
    expect(store().timeline.muted).toBe(false);
    expect(store().readOnly).toBe(true);
  });
});
