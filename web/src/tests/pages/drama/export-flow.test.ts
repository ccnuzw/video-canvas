import { describe, expect, test } from "bun:test";

import { emptyTimeline, normalize } from "@/components/timeline-editor/model";
import type { ClipMedia, EditorClip, EditorTimeline } from "@/components/timeline-editor/types";
import {
  DEFAULT_SPEC,
  composedExportUrl,
  isRunning,
  overallProgress,
  readSpec,
  sameSpec,
  specSize,
  stepStates,
  summarizeExport,
  writeSpec,
} from "@/pages/drama/workspace/final/export-flow";

test("导出只下载本次合成结果，断线对账后可用同规格的新成片兜底", () => {
  const old = { id: "old", url: "/old.mp4" };
  const next = { id: "next", url: "/next.mp4" };
  const episode = { final: old, finalStale: false, finalSpec: DEFAULT_SPEC };
  const updated = { ...episode, final: next };
  expect(composedExportUrl(undefined, episode, DEFAULT_SPEC, old.id)).toBeNull();
  expect(composedExportUrl(undefined, updated, DEFAULT_SPEC, old.id)).toBe(next.url);
  expect(
    composedExportUrl(undefined, { ...updated, finalStale: true }, DEFAULT_SPEC, old.id),
  ).toBeNull();
  expect(
    composedExportUrl({ status: "running", result: null }, updated, DEFAULT_SPEC, old.id),
  ).toBeNull();
  expect(
    composedExportUrl(
      { status: "succeeded", result: { asset: next } },
      episode,
      DEFAULT_SPEC,
      old.id,
    ),
  ).toBe(next.url);
});

const clip = (id: string, over: Partial<EditorClip> = {}): EditorClip => ({
  id,
  type: "video",
  ref: `take:${id}`,
  startMs: 0,
  inMs: 0,
  outMs: 4000,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: null,
  host: null,
  ...over,
});

describe("导出进度", () => {
  test("总进度：保存占一点，合成占大头，下载收尾，完成是 100", () => {
    expect(overallProgress({ kind: "idle" }, 0)).toBe(0);
    expect(overallProgress({ kind: "saving" }, 0)).toBe(4);
    expect(overallProgress({ kind: "composing" }, 0)).toBe(6);
    expect(overallProgress({ kind: "composing" }, 50)).toBe(50);
    expect(overallProgress({ kind: "composing" }, 100)).toBe(94);
    expect(overallProgress({ kind: "downloading" }, 0)).toBe(96);
    expect(overallProgress({ kind: "done", url: "/final.mp4" }, 0)).toBe(100);
  });

  test("合成进度越界时夹住", () => {
    expect(overallProgress({ kind: "composing" }, -5)).toBe(6);
    expect(overallProgress({ kind: "composing" }, 180)).toBe(94);
  });

  test("三步的状态：之前的完成、当前的进行中、之后的等待；失败标在出错的那一步", () => {
    expect(stepStates({ kind: "idle" })).toEqual(["pending", "pending", "pending"]);
    expect(stepStates({ kind: "saving" })).toEqual(["active", "pending", "pending"]);
    expect(stepStates({ kind: "composing" })).toEqual(["done", "active", "pending"]);
    expect(stepStates({ kind: "downloading" })).toEqual(["done", "done", "active"]);
    expect(stepStates({ kind: "done", url: "/final.mp4" })).toEqual(["done", "done", "done"]);
    expect(stepStates({ kind: "failed", at: "composing", message: "x" })).toEqual([
      "done",
      "failed",
      "pending",
    ]);
    expect(stepStates({ kind: "failed", at: "saving", message: "x" })).toEqual([
      "failed",
      "pending",
      "pending",
    ]);
  });

  test("进行中的阶段", () => {
    expect(isRunning({ kind: "saving" })).toBe(true);
    expect(isRunning({ kind: "composing" })).toBe(true);
    expect(isRunning({ kind: "downloading" })).toBe(true);
    expect(isRunning({ kind: "idle" })).toBe(false);
    expect(isRunning({ kind: "done", url: "/final.mp4" })).toBe(false);
    expect(isRunning({ kind: "failed", at: "saving", message: "" })).toBe(false);
  });
});

describe("导出单汇总", () => {
  function sample(): EditorTimeline {
    const tl = emptyTimeline();
    const by = (id: string) => tl.tracks.find((t) => t.id === id)!;
    by("main").clips = [
      clip("a"),
      clip("ph", { ref: null, outMs: 5000 }),
      clip("b", { outMs: 2000 }),
    ];
    by("overlay1").clips = [
      clip("o", {
        startMs: 1000,
        outMs: 1500,
        overlay: { x: 50, y: 50, scale: 100, opacity: 100 },
      }),
    ];
    by("voice1").clips = [clip("v", { type: "audio", startMs: 0, outMs: 3000 })];
    by("music1").clips = [clip("m", { type: "audio", startMs: 0, outMs: 20000 })];
    by("text1").clips = [clip("t", { type: "text", ref: null, startMs: 500, outMs: 1000 })];
    return normalize(tl);
  }
  const resolve = (c: EditorClip): ClipMedia => ({
    state: c.id === "ph" ? "placeholder" : "ready",
    url: null,
    durationMs: 9000,
    label: c.id === "ph" ? "片段 02 · 待采用" : `素材 ${c.id}`,
    thumbUrl: c.id === "a" ? "/thumb/a.jpg" : null,
  });

  test("按轨道类别计数，待采用的占位不算进主轨、单独列出跳过的片段", () => {
    const s = summarizeExport(sample(), resolve);
    expect([s.main, s.overlay, s.audio, s.text]).toEqual([2, 1, 2, 1]);
    expect(s.skipped).toEqual(["片段 02"]);
  });

  test("时长：主轨去掉跳过的占位后首尾相接的长度，和附属轨最晚结束点取大", () => {
    // 主轨 a(4s)+b(2s)=6s，BGM 到 20s
    expect(summarizeExport(sample(), resolve).durationMs).toBe(20000);
    const short = sample();
    short.tracks.find((t) => t.id === "music1")!.clips = [];
    expect(summarizeExport(short, resolve).durationMs).toBe(6000);
  });

  test("封面取主轨第一段有缩略图的片段", () => {
    expect(summarizeExport(sample(), resolve).posterUrl).toBe("/thumb/a.jpg");
    expect(summarizeExport(emptyTimeline(), resolve).posterUrl).toBeNull();
  });
});

describe("导出规格", () => {
  test("默认 1080P、30fps、高画质", () => {
    expect(DEFAULT_SPEC).toEqual({ shortSide: 1080, fps: 30, quality: "high" });
  });

  test("和上次成片的规格比较：完全一样才算一样，旧成片没记规格算不一样", () => {
    expect(sameSpec(DEFAULT_SPEC, { ...DEFAULT_SPEC })).toBe(true);
    expect(sameSpec(DEFAULT_SPEC, { ...DEFAULT_SPEC, fps: 24 })).toBe(false);
    expect(sameSpec(DEFAULT_SPEC, null)).toBe(false);
  });

  test("按项目比例换算出像素尺寸（短边是分辨率，宽高取偶数）", () => {
    expect(specSize({ ...DEFAULT_SPEC, shortSide: 1080 }, "9:16")).toBe("1080 × 1920");
    expect(specSize({ ...DEFAULT_SPEC, shortSide: 720 }, "16:9")).toBe("1280 × 720");
    expect(specSize({ ...DEFAULT_SPEC, shortSide: 1440 }, "4:3")).toBe("1920 × 1440");
    expect(specSize({ ...DEFAULT_SPEC, shortSide: 1080 }, "乱写")).toBe("1080 × 1920");
  });

  test("记住上次选的规格；存储不可用或存的内容不合法时用默认值", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readSpec(storage)).toEqual(DEFAULT_SPEC);
    writeSpec({ shortSide: 720, fps: 24, quality: "best" }, storage);
    expect(readSpec(storage)).toEqual({ shortSide: 720, fps: 24, quality: "best" });
    store.set("drama-export-spec", '{"shortSide":999,"fps":24,"quality":"best"}');
    expect(readSpec(storage)).toEqual(DEFAULT_SPEC);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSpec(broken)).toEqual(DEFAULT_SPEC);
    expect(() => writeSpec(DEFAULT_SPEC, broken)).not.toThrow();
  });
});
