import type {
  ScriptDto,
  ScriptElementDto,
  ScriptElementType,
  ScriptSceneDto,
} from "@/api/drama/type";

/** 编辑中的一行：多一个只在前端用的 key，保存拿到的服务端 ID 另存在 {@link IdMap} 里 */
export interface EditorElement extends ScriptElementDto {
  /** 前端稳定标识，行在编辑中改类型、移动都不变 */
  key: string;
}

/** 编辑中的一场 */
export interface EditorScene extends Omit<ScriptSceneDto, "elements"> {
  /** 前端稳定标识 */
  key: string;
  elements: EditorElement[];
}

/** 前端 key → 服务端 ID：保存带上、保存后补上新行的 ID；不放进编辑状态，免得拿到新 ID 就让文档变脏 */
export type IdMap = Map<string, string>;

/** 编辑操作后光标应该去哪 */
export interface EditorFocus {
  /** 要聚焦的行 key */
  key: string;
  /** 光标位置：数字是字符偏移，"end" 是行尾；不给就用默认 */
  off?: number | "end";
  /** 聚焦后立刻打开人物选择 */
  pick?: boolean;
}

/** 一次编辑操作的结果 */
export interface EditResult {
  /** 操作后的全部场次；被拒绝时原样返回 */
  scenes: EditorScene[];
  /** 光标去向 */
  focus?: EditorFocus;
  /** 被拒绝时的原因（界面上提示一下，内容不变） */
  reason?: string;
}

/** 元素类型的中文名 */
export const ELEMENT_LABEL: Record<ScriptElementType, string> = {
  action: "动作",
  character: "角色",
  parenthetical: "括号",
  dialogue: "对白",
  transition: "转场",
  subtitle: "字幕",
  shot: "空镜",
  flashback_start: "闪回",
  flashback_end: "闪回结束",
  note: "备注",
};

/** Tab 循环和工具条里的类型顺序（闪回标记另有按钮，不在循环里） */
export const CYCLE_TYPES: ScriptElementType[] = [
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "subtitle",
  "shot",
  "note",
];

/** 有可编辑正文的类型 */
const TEXTUAL = new Set<ScriptElementType>([
  "action",
  "parenthetical",
  "dialogue",
  "transition",
  "subtitle",
  "shot",
  "note",
]);

/** 属于「说话块」的类型：角色、括号、对白 */
const SPEECH = new Set<ScriptElementType>(["character", "parenthetical", "dialogue"]);

/** 判断类型是不是有正文 */
export const isTextual = (type: ScriptElementType): boolean => TEXTUAL.has(type);

let keySeq = 0;

/** 生成一个前端 key */
export const newKey = (): string => `n${++keySeq}`;

const blankElement = (type: ScriptElementType, text = ""): EditorElement => ({
  key: newKey(),
  id: null,
  type,
  text,
  characterId: null,
  extension: "",
});

/**
 * 后端剧本 → 编辑状态，同时记下服务端 ID
 * @param script 后端返回的一集剧本
 * @returns 带 key 的场次，以及 key → ID 的映射
 */
export const toEditorScenes = (script: ScriptDto): { scenes: EditorScene[]; ids: IdMap } => {
  const ids: IdMap = new Map();
  const scenes = script.scenes.map((scene) => {
    const key = newKey();
    if (scene.id) ids.set(key, scene.id);
    return {
      ...scene,
      key,
      elements: scene.elements.map((el) => {
        const elKey = newKey();
        if (el.id) ids.set(elKey, el.id);
        return { ...el, key: elKey };
      }),
    };
  });
  return { scenes, ids };
};

/**
 * 编辑状态 → 整集保存的请求内容：服务端 ID 从映射里取，没有的是新增
 * @param scenes 编辑状态
 * @param ids key → 服务端 ID
 */
export const toScriptScenes = (scenes: EditorScene[], ids: IdMap): ScriptSceneDto[] =>
  scenes.map(({ key, elements, ...scene }) => ({
    ...scene,
    id: ids.get(key) ?? null,
    elements: elements.map(({ key: elKey, ...el }) => ({ ...el, id: ids.get(elKey) ?? null })),
  }));

/**
 * 保存成功后把新分配的 ID 记进映射：响应的场次、元素顺序与请求一致，按位置对应
 * @param ids 要更新的映射
 * @param sent 发出去的那一版编辑状态
 * @param saved 后端返回的保存结果
 */
export const rememberIds = (ids: IdMap, sent: EditorScene[], saved: ScriptSceneDto[]): void => {
  sent.forEach((scene, i) => {
    const back = saved[i];
    if (!back) return;
    if (back.id) ids.set(scene.key, back.id);
    scene.elements.forEach((el, j) => {
      const id = back.elements[j]?.id;
      if (id) ids.set(el.key, id);
    });
  });
};

/**
 * 序列化成「只含内容」的字符串，给自动保存比较有没有改动；不含 key 和服务端 ID
 * @param scenes 编辑状态
 */
export const serializeContent = (scenes: EditorScene[]): string =>
  JSON.stringify(
    scenes.map((s) => [
      s.intExt,
      s.timeLabel,
      s.locationId,
      s.title,
      s.summary,
      s.emotions,
      s.extraCharacterIds,
      s.props,
      s.elements.map((e) => [e.type, e.text, e.characterId, e.extension]),
    ]),
  );

/**
 * 判断第 i 行能不能改成某类型，不能时返回原因（空串表示可以）
 * @param els 这一场的全部行
 * @param i 要改的行
 * @param type 目标类型
 */
export const canType = (els: EditorElement[], i: number, type: ScriptElementType): string => {
  const prev = els[i - 1];
  const next = els[i + 1];
  if ((type === "parenthetical" || type === "dialogue") && !(prev && SPEECH.has(prev.type))) {
    return "前面要先有角色行";
  }
  if (next && (next.type === "parenthetical" || next.type === "dialogue") && !SPEECH.has(type)) {
    return "后面还挂着台词，先改掉台词";
  }
  return "";
};

/**
 * 判断第 i 行能不能删，不能时返回原因（空串表示可以）
 * @param els 这一场的全部行
 * @param i 要删的行
 */
export const canDelete = (els: EditorElement[], i: number): string => {
  const prev = els[i - 1];
  const next = els[i + 1];
  if (els.length === 1) return "一场至少保留一行";
  // 删掉这一行后，后面的台词要紧挨着说话块，否则就成了没有说话人的台词
  if (next && (next.type === "parenthetical" || next.type === "dialogue")) {
    if (!(prev && SPEECH.has(prev.type))) return "后面还挂着台词，先删掉台词";
  }
  return "";
};

/** 校验失败的位置 */
export interface ScriptProblem {
  /** 第几场，从 0 起 */
  scene: number;
  /** 第几行，从 0 起 */
  element: number;
  message: string;
}

const followedByDialogue = (els: EditorElement[], i: number): boolean => {
  for (let k = i + 1; k < els.length; k++) {
    if (els[k].type === "dialogue") return true;
    if (els[k].type !== "parenthetical") return false;
  }
  return false;
};

const problemIn = (els: EditorElement[]): { element: number; message: string } | null => {
  let open = -1;
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e.type === "character") {
      if (!e.characterId) return { element: i, message: "角色行没有选人物" };
      if (!followedByDialogue(els, i)) return { element: i, message: "角色行后面没有台词" };
    }
    if (e.type === "parenthetical" || e.type === "dialogue") {
      if (i === 0 || !SPEECH.has(els[i - 1].type))
        return { element: i, message: "台词前面没有角色行" };
      if (e.type === "parenthetical" && !followedByDialogue(els, i)) {
        return { element: i, message: "括号后面没有台词" };
      }
    }
    if (e.type === "flashback_start") {
      if (open >= 0) return { element: i, message: "闪回不能嵌套" };
      open = i;
    }
    if (e.type === "flashback_end") {
      if (open < 0) return { element: i, message: "闪回结束前没有闪回" };
      open = -1;
    }
  }
  return open >= 0 ? { element: open, message: "闪回没有结束" } : null;
};

/**
 * 校验场内顺序（与后端规则一致），保存前先拦住，返回第一个不合法的位置
 * @param scenes 编辑状态
 * @returns 不合法的位置，合法返回 null
 */
export const validateScenes = (scenes: EditorScene[]): ScriptProblem | null => {
  for (let s = 0; s < scenes.length; s++) {
    const found = problemIn(scenes[s].elements);
    if (found) return { scene: s, ...found };
  }
  return null;
};

const withScene = (
  scenes: EditorScene[],
  sceneKey: string,
  fn: (scene: EditorScene) => EditorElement[],
): EditorScene[] => scenes.map((s) => (s.key === sceneKey ? { ...s, elements: fn(s) } : s));

const sceneOf = (scenes: EditorScene[], key: string) => scenes.find((s) => s.key === key);

/**
 * 改某一行的类型；改成角色时，原有文字落到后面的对白里，并聚焦人物选择
 * @param scenes 全部场次
 * @param sceneKey 所在场次
 * @param i 行号
 * @param type 目标类型
 */
export const setElementType = (
  scenes: EditorScene[],
  sceneKey: string,
  i: number,
  type: ScriptElementType,
): EditResult => {
  const sc = sceneOf(scenes, sceneKey);
  const el = sc?.elements[i];
  if (!sc || !el || el.type === type) return { scenes };
  const reason = canType(sc.elements, i, type);
  if (reason) return { scenes, reason };
  if (type === "character") {
    const next = sc.elements[i + 1];
    const extra: EditorElement[] = [];
    if (el.text.trim()) extra.push(blankElement("dialogue", el.text));
    else if (!next || !(next.type === "parenthetical" || next.type === "dialogue")) {
      extra.push(blankElement("dialogue"));
    }
    const out = withScene(scenes, sceneKey, (s) => {
      const els = [...s.elements];
      els.splice(i, 1, { ...el, type, text: "", characterId: null, extension: "" }, ...extra);
      return els;
    });
    return { scenes: out, focus: { key: el.key, pick: true } };
  }
  const keepText = TEXTUAL.has(el.type) && TEXTUAL.has(type);
  const out = withScene(scenes, sceneKey, (s) =>
    s.elements.map((e, k) =>
      k === i ? { ...e, type, text: keepText ? e.text : "", characterId: null, extension: "" } : e,
    ),
  );
  return { scenes: out, focus: { key: el.key, off: "end" } };
};

/**
 * Tab / Shift+Tab：往后或往前找下一个合法的类型切过去
 * @param scenes 全部场次
 * @param sceneKey 所在场次
 * @param i 行号
 * @param dir 1 往后，-1 往前
 */
export const cycleType = (
  scenes: EditorScene[],
  sceneKey: string,
  i: number,
  dir: 1 | -1,
): EditResult => {
  const sc = sceneOf(scenes, sceneKey);
  const el = sc?.elements[i];
  if (!sc || !el) return { scenes };
  let k = CYCLE_TYPES.indexOf(el.type);
  for (let n = 0; n < CYCLE_TYPES.length; n++) {
    k = (k + dir + CYCLE_TYPES.length) % CYCLE_TYPES.length;
    if (!canType(sc.elements, i, CYCLE_TYPES[k]))
      return setElementType(scenes, sceneKey, i, CYCLE_TYPES[k]);
  }
  return { scenes };
};

/** Enter 后新行的类型：插在说话块中间时只能是对白，否则按当前行接下一种 */
const typeAfter = (els: EditorElement[], i: number, base: ScriptElementType): ScriptElementType => {
  const after = els[i + 1];
  return after && (after.type === "parenthetical" || after.type === "dialogue") ? "dialogue" : base;
};

/**
 * Enter：在行尾新起一行（角色行已有台词时只是移到台词），在文字中间会把后面的文字带到新行；
 * 空行上也一样是换行，不切换类型（切类型只用 Tab 和工具条，连按回车不会把行切成意想不到的类型）
 * @param scenes 全部场次
 * @param sceneKey 所在场次
 * @param i 行号
 * @param offset 光标在文字里的位置
 */
export const enterAt = (
  scenes: EditorScene[],
  sceneKey: string,
  i: number,
  offset: number,
): EditResult => {
  const sc = sceneOf(scenes, sceneKey);
  const el = sc?.elements[i];
  if (!sc || !el) return { scenes };
  const next = sc.elements[i + 1];
  if (el.type === "character") {
    if (next && (next.type === "dialogue" || next.type === "parenthetical")) {
      return { scenes, focus: { key: next.key, off: "end" } };
    }
    const fresh = blankElement("dialogue");
    const out = withScene(scenes, sceneKey, (s) => [
      ...s.elements.slice(0, i + 1),
      fresh,
      ...s.elements.slice(i + 1),
    ]);
    return { scenes: out, focus: { key: fresh.key, off: 0 } };
  }
  if (!TEXTUAL.has(el.type)) {
    const fresh = blankElement(typeAfter(sc.elements, i, "action"));
    const out = withScene(scenes, sceneKey, (s) => [
      ...s.elements.slice(0, i + 1),
      fresh,
      ...s.elements.slice(i + 1),
    ]);
    return { scenes: out, focus: { key: fresh.key, off: 0 } };
  }
  const base: ScriptElementType =
    el.type === "parenthetical" ? "dialogue" : el.type === "dialogue" ? "action" : el.type;
  const fresh = blankElement(typeAfter(sc.elements, i, base), el.text.slice(offset));
  const out = withScene(scenes, sceneKey, (s) => [
    ...s.elements.slice(0, i),
    { ...el, text: el.text.slice(0, offset) },
    fresh,
    ...s.elements.slice(i + 1),
  ]);
  return { scenes: out, focus: { key: fresh.key, off: 0 } };
};

/**
 * Backspace：空行（或没有正文的行）直接删；行首的非空行与上一行合并；不能把角色和台词隔开
 * @param scenes 全部场次
 * @param sceneKey 所在场次
 * @param i 行号
 * @param remove true 表示直接删这一行（空行或没有正文的行），false 表示光标在行首要与上一行合并
 */
export const backspaceAt = (
  scenes: EditorScene[],
  sceneKey: string,
  i: number,
  remove: boolean,
): EditResult => {
  const sc = sceneOf(scenes, sceneKey);
  const el = sc?.elements[i];
  if (!sc || !el) return { scenes };
  const reason = canDelete(sc.elements, i);
  if (reason) return { scenes, reason };
  const prev = sc.elements[i - 1];
  if (remove) {
    const out = withScene(scenes, sceneKey, (s) => s.elements.filter((_, k) => k !== i));
    const focusKey = prev?.key ?? sc.elements[i + 1]?.key;
    return { scenes: out, focus: focusKey ? { key: focusKey, off: "end" } : undefined };
  }
  if (!prev || !TEXTUAL.has(prev.type) || !TEXTUAL.has(el.type)) return { scenes };
  const out = withScene(scenes, sceneKey, (s) =>
    s.elements.flatMap((e, k) =>
      k === i ? [] : k === i - 1 ? [{ ...e, text: e.text + el.text }] : [e],
    ),
  );
  return {
    scenes: out,
    focus: { key: prev.key, off: prev.text.length },
  };
};

/**
 * 在指定场次之后新建一场，里面只有一个空动作
 * @param scenes 全部场次
 * @param afterKey 在哪一场之后插入
 */
export const newScene = (scenes: EditorScene[], afterKey: string): EditResult => {
  const at = scenes.findIndex((s) => s.key === afterKey);
  const first = blankElement("action");
  const scene: EditorScene = {
    key: newKey(),
    id: null,
    intExt: "",
    timeLabel: "",
    locationId: null,
    title: "",
    summary: "",
    emotions: [],
    extraCharacterIds: [],
    props: [],
    elements: [first],
  };
  const out = [...scenes.slice(0, at + 1), scene, ...scenes.slice(at + 1)];
  return { scenes: out, focus: { key: first.key, off: 0 } };
};

/**
 * 删除一场；至少保留一场
 * @param scenes 全部场次
 * @param key 要删的场次
 */
export const removeScene = (scenes: EditorScene[], key: string): EditorScene[] =>
  scenes.length <= 1 ? scenes : scenes.filter((s) => s.key !== key);

/**
 * 把一场挪到另一场之前（拖动场次栏调整顺序）；目标是 null 表示挪到最后。场号随之重排，场次信息跟着场次走
 * @param scenes 全部场次
 * @param key 要挪的场次
 * @param beforeKey 挪到哪一场之前；null 表示末尾
 */
export const moveScene = (
  scenes: EditorScene[],
  key: string,
  beforeKey: string | null,
): EditorScene[] => {
  const moving = scenes.find((s) => s.key === key);
  if (!moving || key === beforeKey) return scenes;
  const rest = scenes.filter((s) => s.key !== key);
  const at = beforeKey === null ? rest.length : rest.findIndex((s) => s.key === beforeKey);
  if (at < 0) return scenes;
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
};

/** 一集的统计 */
export interface ScriptStats {
  /** 场次数 */
  scenes: number;
  /** 字数：不含角色行和备注 */
  chars: number;
  /** 对白字数占比，0–100 的整数 */
  dialogueRatio: number;
  /** 预估时长（秒）：对白每秒 4 个字，动作、空镜、字幕每条 2 秒（暂定公式，待用真实剧本校准） */
  seconds: number;
}

/**
 * 统计场次数、字数、对白占比和预估时长
 * @param scenes 编辑状态
 */
export const scriptStats = (scenes: EditorScene[]): ScriptStats => {
  let chars = 0;
  let dialogue = 0;
  let beats = 0;
  for (const s of scenes) {
    for (const e of s.elements) {
      if (e.type === "note" || e.type === "character") continue;
      const n = [...e.text].length;
      chars += n;
      if (e.type === "dialogue") dialogue += n;
      if (e.type === "action" || e.type === "shot" || e.type === "subtitle") beats += 1;
    }
  }
  return {
    scenes: scenes.length,
    chars,
    dialogueRatio: chars ? Math.round((dialogue / chars) * 100) : 0,
    seconds: Math.round(dialogue / 4 + beats * 2),
  };
};
