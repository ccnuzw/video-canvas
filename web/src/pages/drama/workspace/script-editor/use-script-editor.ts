import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createScriptEntity,
  getScript,
  listScriptEntities,
  parseScript,
  saveScript,
} from "@/api/drama";
import { DRAMA_ERR, dramaErrorMessage, isRevisionConflict } from "@/api/drama/errors";
import type { ScriptElementType, ScriptEntityDto, ScriptEntityKind } from "@/api/drama/type";
import { ApiError } from "@/utils/requests/request";
import { Autosaver, type AutosaveStatus } from "@/utils/drama/autosave";
import {
  backspaceAt,
  cycleType,
  enterAt,
  moveScene,
  newScene,
  removeScene,
  rememberIds,
  scriptStats,
  serializeContent,
  setElementType,
  toEditorScenes,
  toScriptScenes,
  validateScenes,
  type EditResult,
  type EditorElement,
  type EditorFocus,
  type EditorScene,
  type IdMap,
  type ScriptProblem,
  type ScriptStats,
} from "@/utils/drama/script-doc";

/** 保存前校验没过：自动保存把它当作普通失败，状态变 error，界面显示具体位置 */
class ScriptInvalidError extends Error {}

/** 编辑器对外暴露的状态与动作 */
export interface ScriptEditorApi {
  /** 载入阶段：loading 读取中，ready 可编辑，failed 读取失败 */
  phase: "loading" | "ready" | "failed";
  /** 当前全部场次 */
  scenes: EditorScene[];
  /** 始终指向最新场次，给键盘事件这类不想闭包旧状态的地方用 */
  scenesRef: { readonly current: EditorScene[] };
  /** 人物表 */
  characters: ScriptEntityDto[];
  /** 地点表 */
  locations: ScriptEntityDto[];
  /** 是否只读（已锁定） */
  readOnly: boolean;
  /** 保存状态 */
  status: AutosaveStatus;
  /** 保存前校验没过时的位置，null 表示没有问题 */
  problem: ScriptProblem | null;
  /** 统计 */
  stats: ScriptStats;
  /** 等待应用的光标去向，应用后调用 consumeFocus */
  focus: (EditorFocus & { token: number }) | null;
  /** 光标已应用 */
  consumeFocus: () => void;
  /** 应用一次编辑操作的结果（含光标和被拒绝的提示） */
  apply: (result: EditResult) => void;
  /** 改某一行的文字 */
  setText: (sceneKey: string, elKey: string, text: string) => void;
  /** 改某一行的类型 */
  setType: (sceneKey: string, i: number, type: ScriptElementType) => void;
  /** Tab 循环切换类型 */
  cycle: (sceneKey: string, i: number, dir: 1 | -1) => void;
  /** Enter */
  enter: (sceneKey: string, i: number, offset: number) => void;
  /** Backspace */
  backspace: (sceneKey: string, i: number, remove: boolean) => void;
  /** 给角色行选人物 */
  setCharacter: (sceneKey: string, elKey: string, characterId: string) => void;
  /** 切换角色行的画外音标记：空 → OS → VO → 空 */
  cycleExtension: (sceneKey: string, elKey: string) => void;
  /** 改场次的内外景、时间、地点、短标题等 */
  patchScene: (sceneKey: string, patch: Partial<EditorScene>) => void;
  /** 在某场之后新建一场 */
  addScene: (afterKey: string) => void;
  /** 删一场 */
  deleteScene: (key: string) => void;
  /** 把一场挪到另一场之前，null 表示挪到最后 */
  moveScene: (key: string, beforeKey: string | null) => void;
  /** 插入闪回标记 */
  insertMarker: (sceneKey: string, i: number, type: ScriptElementType) => void;
  /** 粘贴多行文本：交后端解析后插入光标处 */
  paste: (sceneKey: string, i: number, text: string) => Promise<void>;
  /** 手动新建人物或地点，返回新条目的 id；失败返回 null */
  createEntity: (kind: ScriptEntityKind, name: string) => Promise<string | null>;
  /** 冲突后载入最新版本，放弃本地改动 */
  reload: () => Promise<void>;
  /** 冲突后以本地内容覆盖 */
  overwrite: () => Promise<void>;
  /** 人物 / 地点改名等操作前后调用：先把未保存的改动存了，操作完再对齐 revision 并刷新人物表 */
  around: (action: () => Promise<void>) => Promise<void>;
  /** 重新读人物表和地点表 */
  reloadEntities: () => Promise<void>;
  /** 集级 revision 被别的保存（改钩子、悬念）推进后，把新版本号告诉编辑器，免得下次保存白白冲突 */
  syncRevision: (revision: number) => void;
}

/**
 * 一集结构化剧本的编辑状态：读取、编辑操作、自动保存（整集保存、revision 乐观锁）、人物地点表。
 * 编辑状态里不放服务端 ID，ID 另存在映射里，所以保存拿到新 ID 不会让文档重新变脏。
 * @param dramaId 短剧 id
 * @param no 集号
 * @param locked 这一集是否已锁定（来自集摘要）
 * @param onStatus 保存状态变化的回调（汇报给工作台顶栏）
 * @param onSaved 保存成功后的回调（同步集摘要的 revision 和状态）
 * @param enabled 是否读取；分享链接里是只读快照、不走这些接口，传 false 就不发请求
 */
export function useScriptEditor(
  dramaId: string,
  no: number,
  locked: boolean,
  onStatus: (status: AutosaveStatus) => void,
  onSaved: (revision: number, hasContent: boolean) => void,
  enabled = true,
): ScriptEditorApi {
  const [phase, setPhase] = useState<ScriptEditorApi["phase"]>("loading");
  const [scenes, setScenes] = useState<EditorScene[]>([]);
  const [characters, setCharacters] = useState<ScriptEntityDto[]>([]);
  const [locations, setLocations] = useState<ScriptEntityDto[]>([]);
  const [readOnly, setReadOnly] = useState(locked);
  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [problem, setProblem] = useState<ScriptProblem | null>(null);
  const [focus, setFocus] = useState<ScriptEditorApi["focus"]>(null);
  // 键盘事件、保存回调都要读「最新」值，不能闭包渲染时的旧状态，所以放进 ref；渲染本身不读它们
  const scenesRef = useRef<EditorScene[]>([]);
  const idsRef = useRef<IdMap>(new Map());
  const focusToken = useRef(0);
  const latest = useRef({ onStatus, onSaved });
  useEffect(() => {
    latest.current = { onStatus, onSaved };
  });

  // Autosaver 的回调只在保存时才执行，不在渲染里读 ref；lint 看不出这一点，所以单独放行这一处
  const [saver] = useState(
    // oxlint-disable-next-line react/refs
    () =>
      new Autosaver({
        revision: 0,
        isConflict: isRevisionConflict,
        onStatus: (next) => {
          setStatus(next);
          latest.current.onStatus(next);
        },
        save: async (_value, revision) => {
          // 取最新的编辑状态：内容至少和 value 一样新
          const snapshot = scenesRef.current;
          const found = validateScenes(snapshot);
          setProblem(found);
          if (found) throw new ScriptInvalidError(found.message);
          const saved = await saveScript(dramaId, no, {
            revision,
            scenes: toScriptScenes(snapshot, idsRef.current),
          });
          rememberIds(idsRef.current, snapshot, saved.scenes);
          latest.current.onSaved(
            saved.revision,
            snapshot.some((s) => s.elements.some((e) => e.type !== "note")),
          );
          return saved.revision;
        },
      }),
  );

  /** 读剧本和人物地点表；返回 Promise 让调用方在回调里写入状态 */
  const fetchAll = useCallback(
    () =>
      Promise.all([
        getScript(dramaId, no),
        listScriptEntities(dramaId, "character"),
        listScriptEntities(dramaId, "location"),
      ]),
    [dramaId, no],
  );

  const applyLoaded = useCallback(
    ([script, people, places]: Awaited<ReturnType<typeof fetchAll>>) => {
      const { scenes: next, ids } = toEditorScenes(script);
      const initial = next.length > 0 ? next : newScene([], "").scenes;
      idsRef.current = ids;
      scenesRef.current = initial;
      setScenes(initial);
      setCharacters(people);
      setLocations(places);
      setReadOnly(script.locked);
      setProblem(null);
      saver.reset(serializeContent(initial), script.revision);
      setPhase("ready");
    },
    [saver],
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchAll()
      .then((all) => active && applyLoaded(all))
      .catch(() => active && setPhase("failed"));
    return () => {
      active = false;
    };
  }, [enabled, fetchAll, applyLoaded]);

  // 离开页面或切集时立即保存，不丢改动
  useEffect(() => {
    const flush = () => void saver.flush();
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", flush);
      void saver.flush().finally(() => saver.dispose());
    };
  }, [saver]);

  /** 写入新的场次并通知自动保存；只改内容时 focus 不传 */
  const commit = useCallback(
    (next: EditorScene[], nextFocus?: EditorFocus) => {
      scenesRef.current = next;
      setScenes(next);
      setProblem(null);
      if (nextFocus) setFocus({ ...nextFocus, token: ++focusToken.current });
      saver.update(serializeContent(next));
    },
    [saver],
  );

  const apply = useCallback(
    (result: EditResult) => {
      if (readOnly) return;
      if (result.reason) {
        toast.warning(result.reason);
        return;
      }
      if (result.scenes !== scenesRef.current || result.focus) commit(result.scenes, result.focus);
    },
    [commit, readOnly],
  );

  const mapElement = useCallback(
    (sceneKey: string, elKey: string, fn: (el: EditorElement) => EditorElement) => {
      commit(
        scenesRef.current.map((s) =>
          s.key === sceneKey
            ? { ...s, elements: s.elements.map((e) => (e.key === elKey ? fn(e) : e)) }
            : s,
        ),
      );
    },
    [commit],
  );

  const reloadEntities = useCallback(async () => {
    const [people, places] = await Promise.all([
      listScriptEntities(dramaId, "character"),
      listScriptEntities(dramaId, "location"),
    ]);
    setCharacters(people);
    setLocations(places);
  }, [dramaId]);

  const paste = useCallback(
    async (sceneKey: string, i: number, text: string) => {
      if (readOnly) return;
      const parsed = await parseScript(dramaId, text);
      if (parsed.scenes.length === 0) return;
      const incoming = toEditorScenes(parsed).scenes;
      const current = scenesRef.current;
      const at = current.findIndex((s) => s.key === sceneKey);
      const [head, ...rest] = incoming;
      // 第一段没有场次标题（文本开头的内容）就接进当前场，其余作为新场次
      const headless = !head.locationId && !head.timeLabel && !head.intExt;
      const next = current.flatMap((s, k) => {
        if (k !== at) return [s];
        const merged = headless
          ? [
              {
                ...s,
                elements: [
                  ...s.elements.slice(0, i + 1),
                  ...head.elements,
                  ...s.elements.slice(i + 1),
                ],
              },
            ]
          : [s, head];
        return [...merged, ...rest];
      });
      const lastKey = (headless ? head.elements : incoming.at(-1)?.elements)?.at(-1)?.key;
      commit(next, lastKey ? { key: lastKey, off: "end" } : undefined);
      await reloadEntities();
      toast.success(
        `已插入 ${incoming.reduce((n, s) => n + s.elements.length, 0)} 行${
          parsed.warnings.length ? `，${parsed.warnings.length} 行未识别，已作为动作` : ""
        }`,
      );
    },
    [commit, dramaId, readOnly, reloadEntities],
  );

  const createEntity = useCallback(
    async (kind: ScriptEntityKind, name: string) => {
      try {
        const created = await createScriptEntity(dramaId, kind, { name });
        if (kind === "character") setCharacters((list) => [...list, created]);
        else setLocations((list) => [...list, created]);
        return created.id;
      } catch (e) {
        toast.error(dramaErrorMessage(e, "新建失败"));
        return null;
      }
    },
    [dramaId],
  );

  const reload = useCallback(async () => {
    applyLoaded(await fetchAll());
  }, [applyLoaded, fetchAll]);

  const overwrite = useCallback(async () => {
    const script = await getScript(dramaId, no);
    // 以最新 revision 为基线，再把本地内容标成「未保存」，保存时就会覆盖
    saver.reset("", script.revision);
    saver.update(serializeContent(scenesRef.current));
  }, [dramaId, no, saver]);

  const around = useCallback(
    async (action: () => Promise<void>) => {
      await saver.flush();
      await action();
      // 改名等操作会让后端重渲染这一集（revision 前进）：对齐 revision，免得下次保存白白冲突
      const script = await getScript(dramaId, no);
      saver.reset(serializeContent(scenesRef.current), script.revision);
      await reloadEntities();
    },
    [dramaId, no, reloadEntities, saver],
  );

  const stats = useMemo(() => scriptStats(scenes), [scenes]);

  return {
    phase,
    scenes,
    scenesRef,
    characters,
    locations,
    readOnly,
    status,
    problem,
    stats,
    focus,
    consumeFocus: () => setFocus(null),
    apply,
    setText: (sceneKey, elKey, text) => mapElement(sceneKey, elKey, (e) => ({ ...e, text })),
    setType: (sceneKey, i, type) => apply(setElementType(scenesRef.current, sceneKey, i, type)),
    cycle: (sceneKey, i, dir) => apply(cycleType(scenesRef.current, sceneKey, i, dir)),
    enter: (sceneKey, i, offset) => apply(enterAt(scenesRef.current, sceneKey, i, offset)),
    backspace: (sceneKey, i, remove) => apply(backspaceAt(scenesRef.current, sceneKey, i, remove)),
    setCharacter: (sceneKey, elKey, characterId) => {
      mapElement(sceneKey, elKey, (e) => ({ ...e, characterId }));
    },
    cycleExtension: (sceneKey, elKey) =>
      mapElement(sceneKey, elKey, (e) => ({
        ...e,
        extension: e.extension === "" ? "OS" : e.extension === "OS" ? "VO" : "",
      })),
    patchScene: (sceneKey, patch) =>
      commit(scenesRef.current.map((s) => (s.key === sceneKey ? { ...s, ...patch } : s))),
    addScene: (afterKey) => apply(newScene(scenesRef.current, afterKey)),
    deleteScene: (key) => commit(removeScene(scenesRef.current, key)),
    moveScene: (key, beforeKey) => commit(moveScene(scenesRef.current, key, beforeKey)),
    insertMarker: (sceneKey, i, type) => {
      const sc = scenesRef.current.find((s) => s.key === sceneKey);
      const next = sc?.elements[i + 1];
      if (next && (next.type === "parenthetical" || next.type === "dialogue")) {
        toast.warning("不能插在角色和台词中间");
        return;
      }
      const fresh: EditorElement = {
        key: `m${++focusToken.current}`,
        id: null,
        type,
        text: "",
        characterId: null,
        extension: "",
      };
      commit(
        scenesRef.current.map((s) =>
          s.key === sceneKey
            ? { ...s, elements: [...s.elements.slice(0, i + 1), fresh, ...s.elements.slice(i + 1)] }
            : s,
        ),
        { key: fresh.key, off: 0 },
      );
    },
    paste: async (sceneKey, i, text) => {
      try {
        await paste(sceneKey, i, text);
      } catch (e) {
        toast.error(dramaErrorMessage(e, "解析失败，请稍后重试"));
      }
    },
    createEntity,
    reload,
    overwrite,
    around,
    reloadEntities,
    syncRevision: (revision) => saver.setRevision(revision),
  };
}

/** 判断错误是不是「这一集已锁定」 */
export const isScriptLocked = (e: unknown): boolean =>
  e instanceof ApiError && e.code === DRAMA_ERR.episodeLocked;
