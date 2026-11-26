import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { AssetDto } from "@/api/asset/type";
import type { DramaClipHost, Segment, Timeline } from "@/api/drama/type";
import { emptyTimeline } from "@/components/timeline-editor/model";
import type { EditorClip } from "@/components/timeline-editor/types";
import {
  canvasTab,
  classifyFile,
  createDramaClip,
  importsTab,
  onTimelineRefs,
  segmentsTab,
  swapMenuItems,
} from "@/pages/drama/workspace/final/host";
import { VersionPicker } from "@/pages/drama/workspace/final/version-picker";
import { segmentClip } from "@/utils/drama/timeline";

const asset = (
  id: string,
  kind: "video" | "image" | "audio",
  durationMs: number | null = null,
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
  fileName: `${id}.bin`,
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

const segments: Segment[] = [
  {
    id: "s1",
    seq: 0,
    seconds: 15,
    takes: [take("t1", 15000), take("t2", 12000), take("t3", 0, "failed")],
    chosenTaskId: "t1",
  } as unknown as Segment,
  { id: "s2", seq: 1, seconds: 10, takes: [], chosenTaskId: "" } as unknown as Segment,
  {
    id: "s0",
    seq: 2,
    seconds: 8,
    takes: [take("t9", 8000)],
    chosenTaskId: "",
  } as unknown as Segment,
];

describe("在轨标记", () => {
  test("所有轨上用到的版本和素材按 ref 记下", () => {
    const base = emptyTimeline();
    const tl: Timeline = {
      tracks: base.tracks.map((t) => {
        if (t.kind === "main") return { ...t, clips: [segmentClip(segments[0], "a")] };
        if (t.id === "voice1")
          return {
            ...t,
            clips: [
              { ...segmentClip(segments[0], "v"), type: "audio", ref: "asset:a1" } as EditorClip,
            ],
          };
        return t;
      }),
      removedSegmentIds: [],
      imports: [],
    };
    expect([...onTimelineRefs(tl)].sort()).toEqual(["asset:a1", "take:t1"]);
  });
});

describe("素材面板标签", () => {
  test("「片段」按序号分组，只列成功的版本，采用的带标记，没有可用版本的片段不列", () => {
    const tab = segmentsTab(segments, new Set(["take:t2"]));
    expect(tab).toMatchObject({
      id: "segments",
      label: "片段",
      filterable: false,
      importable: false,
      loading: false,
    });
    expect(tab.sections.map((s) => s.title)).toEqual(["片段 01 · 15s", "片段 03 · 8s"]);
    const items = tab.sections[0].items;
    expect(items.map((i) => [i.id, i.title, i.subtitle, i.badge, i.onTimeline, i.type])).toEqual([
      ["take:t1", "版本 1", "15s", "已采用", false, "video"],
      ["take:t2", "版本 2", "12s", null, true, "video"],
    ]);
    expect(items[0].payload).toEqual({ type: "take", segmentId: "s1", taskId: "t1" });
    expect(items[0].thumbUrl).toBe("/files/at1?v=poster");
    expect(items[0].status).toBe("ready");
    // 片段版本沿用项目画面比例
    expect(items.every((i) => i.aspect === "project")).toBe(true);
  });

  test("「画布素材」：读取中、空、图片视频音频；可筛选", () => {
    expect(canvasTab(null, new Set()).loading).toBe(true);
    const empty = canvasTab([], new Set());
    expect(empty).toMatchObject({ loading: false, filterable: true, importable: false });
    const tab = canvasTab(
      [
        { assetId: "i1", url: "/files/i1", kind: "image", label: "封面" },
        { assetId: "a1", url: "/files/a1", kind: "audio", label: "旁白" },
        { assetId: "v1", url: "/files/v1", kind: "video", label: "" },
      ],
      new Set(["asset:a1"]),
    );
    const items = tab.sections[0].items;
    expect(items.map((i) => [i.type, i.title, i.subtitle, i.onTimeline, i.thumbUrl])).toEqual([
      ["image", "封面", "图片", false, "/files/i1?v=thumb"],
      ["audio", "旁白", "音频", true, null],
      ["video", "未命名", "视频", false, "/files/v1?v=poster"],
    ]);
    expect(items[0].payload).toEqual({ type: "canvas", assetId: "i1" });
  });

  test("「已导入」：上传中、失败排在前面，已导入的素材带载荷", () => {
    const file = new File(["x"], "旁白.mp3", { type: "audio/mpeg" });
    const tab = importsTab(
      [asset("a1", "audio", 4000), asset("i1", "image")],
      [
        { key: "u1", file, progress: 40, failed: false },
        { key: "u2", file, progress: 0, failed: true },
      ],
      new Set(["asset:i1"]),
    );
    expect(tab).toMatchObject({ id: "imports", importable: true, filterable: true });
    const items = tab.sections[0].items;
    expect(items.map((i) => [i.id, i.status, i.progress])).toEqual([
      ["u1", "uploading", 40],
      ["u2", "failed", 0],
      ["asset:a1", "ready", 0],
      ["asset:i1", "ready", 0],
    ]);
    expect(items[2]).toMatchObject({ type: "audio", subtitle: "音频 · 4s", onTimeline: false });
    expect(items[3]).toMatchObject({ type: "image", subtitle: "图片", onTimeline: true });
    expect((items[2].payload as { type: string }).type).toBe("asset");
    expect(items[0].title).toBe("旁白.mp3");
  });
});

describe("导入文件分类", () => {
  test("按 MIME 分视频、图片、音频，其余为 null", () => {
    expect(classifyFile(new File([], "a", { type: "video/mp4" }))).toBe("video");
    expect(classifyFile(new File([], "a", { type: "image/png" }))).toBe("image");
    expect(classifyFile(new File([], "a", { type: "audio/mpeg" }))).toBe("audio");
    expect(classifyFile(new File([], "a", { type: "application/pdf" }))).toBeNull();
  });
});

describe("素材做成片段", () => {
  const deps = (fetch: (id: string) => Promise<AssetDto>) => ({
    segments,
    getAsset: fetch,
    addAssets: mock(() => {}),
    onReadFail: mock(() => {}),
  });

  test("版本：按版本做成段，采用的是跟随，其他版本固定", async () => {
    const d = deps(async () => asset("x", "video"));
    const followed = await createDramaClip({ type: "take", segmentId: "s1", taskId: "t1" }, d);
    expect(followed).toMatchObject({ type: "video", ref: "take:t1", outMs: 15000 });
    expect((followed!.host as DramaClipHost).pinned).toBe(false);
    const other = await createDramaClip({ type: "take", segmentId: "s1", taskId: "t2" }, d);
    expect((other!.host as DramaClipHost).pinned).toBe(true);
    expect(await createDramaClip({ type: "take", segmentId: "nope", taskId: "t2" }, d)).toBeNull();
  });

  test("已导入的素材直接用，并记进素材表；音频做成音频段", async () => {
    const d = deps(async () => {
      throw new Error("不该去读");
    });
    const clip = await createDramaClip({ type: "asset", asset: asset("a1", "audio", 4000) }, d);
    expect(clip).toMatchObject({ type: "audio", ref: "asset:a1", outMs: 4000 });
    expect(d.addAssets).toHaveBeenCalledTimes(1);
  });

  test("画布素材先读详情拿时长；读不到返回 null 并提示", async () => {
    const ok = deps(async () => asset("v1", "video", 6000));
    expect(await createDramaClip({ type: "canvas", assetId: "v1" }, ok)).toMatchObject({
      ref: "asset:v1",
      outMs: 6000,
    });
    expect(ok.addAssets).toHaveBeenCalledTimes(1);
    const bad = deps(async () => {
      throw new Error("404");
    });
    expect(await createDramaClip({ type: "canvas", assetId: "v1" }, bad)).toBeNull();
    expect(bad.onReadFail).toHaveBeenCalledTimes(1);
  });
});

describe("换版本入口", () => {
  const clip = segmentClip(segments[0], "a");

  test("右键菜单：跟随采用 + 各个可用版本，当前的带勾", () => {
    const run = mock((next: EditorClip) => void next);
    const items = swapMenuItems(clip, segments[0], run);
    expect(items.map((i) => i.label)).toEqual(["跟随采用 ✓", "版本 1（已采用）", "版本 2"]);
    items[2].run();
    expect(run.mock.calls[0][0]).toMatchObject({ ref: "take:t2" });
    expect((run.mock.calls[0][0].host as DramaClipHost).pinned).toBe(true);
  });

  test("固定了版本时，勾在那个版本上", () => {
    const pinned = {
      ...clip,
      ref: "take:t2",
      host: { ...(clip.host as DramaClipHost), taskId: "t2", pinned: true },
    };
    const items = swapMenuItems(pinned, segments[0], () => {});
    expect(items.map((i) => i.label)).toEqual(["跟随采用", "版本 1（已采用）", "版本 2 ✓"]);
  });

  test("属性面板里的版本选择：列出跟随采用和各版本，选中态在 aria-pressed 上", () => {
    const html = renderToStaticMarkup(
      <VersionPicker clip={clip} segment={segments[0]} disabled={false} onPick={() => {}} />,
    );
    expect(html).toContain("跟随采用");
    expect(html).toContain("版本 1");
    expect(html).toContain("版本 2");
    expect(html).not.toContain("版本 3");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});
