import { toast } from "sonner";
import { create } from "zustand";

import type { AssetDto } from "@/api/asset/type";
import { DRAMA_ERR, dramaErrorMessage, isDramaError } from "@/api/drama/errors";
import { getTimeline, saveTimeline } from "@/api/drama/timeline";
import type { Segment, Timeline, TimelineChange, TimelineView } from "@/api/drama/type";
import {
  emptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from "@/components/timeline-editor/history";
import { mainTrack } from "@/components/timeline-editor/model";
import type { EditorClip, EditorTimeline } from "@/components/timeline-editor/types";
import type { AutosaveStatus } from "@/utils/drama/autosave";
import { defaultTimeline, trackRemovedSegments } from "@/utils/drama/timeline";

/** 停手多久后自动保存（毫秒） */
const SAVE_DELAY = 1000;
const EMPTY: Timeline = { tracks: [], removedSegmentIds: [], imports: [] };

/** 片场同步提示里的一条：变化本身，加上当时变化后的主轨段（已移除为 null），文案由界面按片段列表生成 */
export type SyncItem = { change: TimelineChange; clip: EditorClip | null };

type TimelineEditorState = {
  /** 正在编辑的「短剧:集号」；null = 没有打开 */
  key: string | null;
  status: "idle" | "loading" | "ready" | "failed";
  /** 共享只读：按片段现算的默认时间线，不能编辑 */
  readOnly: boolean;
  timeline: Timeline;
  /** 服务端版本；0 = 还没保存过 */
  revision: number;
  /** 后端判定的失效段 */
  invalid: string[];
  /** 素材段和「已导入」用到的素材，按 ID */
  assets: Record<string, AssetDto>;
  /** 片场同步带来的变化（顶栏胶囊和轨上标记）；点「知道了」清空 */
  sync: SyncItem[];
  /** 撤销 / 重做栈 */
  history: History<Timeline>;
  save: AutosaveStatus;
  /** 每保存成功一次加一，界面据此把已有成片标成过期 */
  savedCount: number;

  /** 打开某集：读服务端对账后的时间线 */
  open: (dramaId: string, no: number) => Promise<void>;
  /** 共享只读：用片段现算默认时间线 */
  openShared: (key: string, segments: readonly Segment[]) => void;
  /** 改时间线：记一步撤销，停手后自动保存 */
  edit: (fn: (timeline: Timeline) => Timeline) => void;
  /** 编辑器改出了新的轨道：替换轨道，并按主轨的变化维护删除名单 */
  applyEditor: (next: EditorTimeline) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  /** 立刻保存未保存的改动；返回是否已是保存好的状态（合成前调用） */
  flush: () => Promise<boolean>;
  /** 片场的片段变了：有未保存的改动先保存（保存的响应就是对账后的），否则重新读 */
  resync: () => Promise<void>;
  /** 记下新素材（导入、画布素材拖入） */
  addAssets: (assets: readonly AssetDto[]) => void;
  /** 「知道了」：清掉同步提示和段上的标记 */
  ackSync: () => void;
  /** 「撤销同步」：退回同步前的时间线 */
  undoSync: () => void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 正在进行的保存；同一时间只发一个 */
let inflight: Promise<boolean> | null = null;
/** 每次编辑加一：保存返回时据此判断这期间有没有新改动 */
let editSeq = 0;
/** 每次因版本冲突载入最新版本加一：合成前的 flush 据此知道内容被换掉了，不能直接合成 */
let conflictSeq = 0;
/** 同步之前的时间线，「撤销同步」用 */
let beforeSync: Timeline | null = null;

/** 把读到 / 存完的视图里的同步变化转成提示条目 */
const syncItems = (view: TimelineView): SyncItem[] => {
  const main = mainTrack({ tracks: view.tracks }).clips;
  return view.changes.map((change) => ({
    change,
    clip: main.find((clip) => clip.id === change.clipId) ?? null,
  }));
};

const keyOf = (dramaId: string, no: number) => `${dramaId}:${no}`;

const parseKey = (key: string) => {
  const at = key.lastIndexOf(":");
  return { dramaId: key.slice(0, at), no: Number(key.slice(at + 1)) };
};

export const useDramaTimelineStore = create<TimelineEditorState>((set, get) => {
  /** 合并素材视图 */
  const withAssets = (assets: readonly AssetDto[]) => {
    const next = { ...get().assets };
    for (const asset of assets) next[asset.id] = asset;
    return next;
  };

  /** 采用服务端视图；有同步变化时记下同步前的样子，并把它放进撤销栈 */
  const adopt = (view: TimelineView, previous: Timeline | null) => {
    const items = syncItems(view);
    const state = get();
    if (items.length > 0 && previous) {
      beforeSync = previous;
      set({ history: pushHistory(state.history, previous) });
    }
    set({
      timeline: {
        tracks: view.tracks,
        removedSegmentIds: view.removedSegmentIds,
        imports: view.imports,
      },
      revision: view.revision,
      invalid: view.invalidClipIds,
      assets: withAssets(view.assets),
      sync: items.length > 0 ? [...get().sync, ...items] : get().sync,
    });
  };

  /** 版本冲突：载入最新版本，撤销栈作废 */
  const reloadAfterConflict = async (key: string) => {
    conflictSeq++;
    toast.error("时间线在别处被修改，已载入最新版本");
    const { dramaId, no } = parseKey(key);
    const view = await getTimeline(dramaId, no);
    if (get().key !== key) return;
    beforeSync = null;
    set({ history: emptyHistory(), sync: [], save: "saved" });
    adopt(view, null);
  };

  /** 真正发一次保存 */
  const doSave = async (): Promise<boolean> => {
    const { key, timeline, revision } = get();
    if (!key) return true;
    const seq = editSeq;
    const { dramaId, no } = parseKey(key);
    set({ save: "saving" });
    try {
      const view = await saveTimeline(dramaId, no, timeline, revision);
      if (get().key !== key) return true;
      // 保存期间又改了：只收下版本号等元数据，清单以本地为准，并接着再存一次
      if (seq !== editSeq) {
        set({
          revision: view.revision,
          invalid: view.invalidClipIds,
          assets: withAssets(view.assets),
          savedCount: get().savedCount + 1,
        });
        schedule();
        return false;
      }
      adopt(view, timeline);
      set({ save: "saved", savedCount: get().savedCount + 1 });
      return true;
    } catch (error) {
      if (get().key !== key) return false;
      if (isDramaError(error, DRAMA_ERR.timelineConflict)) {
        await reloadAfterConflict(key).catch(() => set({ save: "error" }));
        return false;
      }
      toast.error(dramaErrorMessage(error, "时间线保存失败，请重试"));
      set({ save: "error" });
      return false;
    }
  };

  /** 串行保存：已有保存在进行就等它结束再判断要不要再存 */
  const saveNow = async (): Promise<boolean> => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    while (inflight) await inflight;
    if (get().save === "saved") return true;
    inflight = doSave().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  /** 停手 SAVE_DELAY 后保存 */
  const schedule = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY);
  };

  return {
    key: null,
    status: "idle",
    readOnly: false,
    timeline: EMPTY,
    revision: 0,
    invalid: [],
    assets: {},
    sync: [],
    history: emptyHistory(),
    save: "saved",
    savedCount: 0,

    open: async (dramaId, no) => {
      const key = keyOf(dramaId, no);
      if (get().key === key && get().status !== "failed" && !get().readOnly) return;
      if (saveTimer) clearTimeout(saveTimer);
      beforeSync = null;
      set({
        key,
        status: "loading",
        readOnly: false,
        timeline: EMPTY,
        revision: 0,
        invalid: [],
        assets: {},
        sync: [],
        history: emptyHistory(),
        save: "saved",
      });
      try {
        const view = await getTimeline(dramaId, no);
        if (get().key !== key) return;
        adopt(view, null);
        set({ status: "ready" });
      } catch {
        if (get().key === key) set({ status: "failed" });
      }
    },

    openShared: (key, segments) => {
      if (saveTimer) clearTimeout(saveTimer);
      set({
        key,
        status: "ready",
        readOnly: true,
        timeline: defaultTimeline(segments),
        revision: 0,
        invalid: [],
        assets: {},
        sync: [],
        history: emptyHistory(),
        save: "saved",
      });
    },

    edit: (fn) => {
      const state = get();
      if (state.readOnly || state.status !== "ready") return;
      const next = fn(state.timeline);
      if (next === state.timeline) return;
      editSeq++;
      set({
        timeline: next,
        history: pushHistory(state.history, state.timeline),
        save: "dirty",
      });
      schedule();
    },

    applyEditor: (next) =>
      get().edit((timeline) => {
        if (next.tracks === timeline.tracks) return timeline;
        return {
          ...timeline,
          tracks: next.tracks,
          removedSegmentIds: trackRemovedSegments(
            timeline.tracks,
            next.tracks,
            timeline.removedSegmentIds,
          ),
        };
      }),

    undoEdit: () => {
      const state = get();
      if (state.readOnly) return;
      const result = undoHistory(state.history, state.timeline);
      if (!result) return;
      editSeq++;
      set({ timeline: result.value, history: result.history, save: "dirty" });
      schedule();
    },

    redoEdit: () => {
      const state = get();
      if (state.readOnly) return;
      const result = redoHistory(state.history, state.timeline);
      if (!result) return;
      editSeq++;
      set({ timeline: result.value, history: result.history, save: "dirty" });
      schedule();
    },

    flush: async () => {
      if (get().readOnly) return false;
      const conflicts = conflictSeq;
      // 保存期间又有改动时 saveNow 会返回 false 并排下一次；最多追三轮，直到存上最新的内容；
      // 中途因冲突载入了别处的版本，用户还没看过，返回 false
      for (let round = 0; round < 3; round++) {
        if (get().save === "saved") return true;
        const ok = await saveNow();
        if (conflictSeq !== conflicts || get().save === "error") return false;
        if (ok && get().save === "saved") return true;
      }
      if (conflictSeq !== conflicts) return false;
      return get().save === "saved";
    },

    resync: async () => {
      const { key, readOnly, status, save } = get();
      if (!key || readOnly || status !== "ready") return;
      if (save !== "saved") {
        await saveNow();
        return;
      }
      const { dramaId, no } = parseKey(key);
      const previous = get().timeline;
      try {
        const view = await getTimeline(dramaId, no);
        // 读的期间用户又改了：放弃这次结果，等下一次保存把对账带回来
        if (get().key !== key || get().timeline !== previous) return;
        adopt(view, previous);
      } catch {
        /* 全局已提示；下一次片段变化或保存会再对账 */
      }
    },

    addAssets: (assets) => set({ assets: withAssets(assets) }),

    ackSync: () => {
      beforeSync = null;
      set({ sync: [] });
    },

    undoSync: () => {
      const restore = beforeSync;
      beforeSync = null;
      set({ sync: [] });
      if (!restore) return;
      get().edit(() => restore);
    },
  };
});
