import { describe, expect, test } from "bun:test";

import type { ScriptElementType } from "@/api/drama/type";
import {
  backspaceAt,
  canDelete,
  canType,
  cycleType,
  enterAt,
  moveScene,
  newScene,
  removeScene,
  scriptStats,
  serializeContent,
  setElementType,
  validateScenes,
  type EditorElement,
  type EditorScene,
} from "@/utils/drama/script-doc";

let seq = 0;
const el = (
  type: ScriptElementType,
  text = "",
  characterId: string | null = null,
): EditorElement => ({
  key: `k${++seq}`,
  id: null,
  type,
  text,
  characterId,
  extension: "",
});
const scene = (...els: EditorElement[]): EditorScene => ({
  key: `s${++seq}`,
  id: null,
  intExt: "",
  timeLabel: "",
  locationId: null,
  title: "",
  summary: "",
  emotions: [],
  extraCharacterIds: [],
  props: [],
  elements: els,
});
const types = (s: EditorScene) => s.elements.map((e) => e.type);

describe("元素类型约束", () => {
  test("对白和括号必须接在角色、括号、对白后面", () => {
    const els = [el("action", "a"), el("character", "", "c1"), el("dialogue", "d")];
    expect(canType(els, 0, "dialogue")).not.toBe("");
    expect(canType(els, 2, "parenthetical")).toBe("");
    expect(canType([el("action"), el("action")], 1, "dialogue")).not.toBe("");
  });

  test("后面还挂着台词的行不能改成非台词类型", () => {
    const els = [el("character", "", "c1"), el("dialogue", "d")];
    expect(canType(els, 0, "action")).not.toBe("");
    expect(canType(els, 1, "action")).toBe("");
  });

  test("不能删一场里唯一的一行，也不能删掉挂着台词的角色行", () => {
    expect(canDelete([el("action")], 0)).not.toBe("");
    expect(canDelete([el("character", "", "c1"), el("dialogue", "d")], 0)).not.toBe("");
    expect(canDelete([el("action"), el("action")], 1)).toBe("");
  });

  test("校验与后端一致：对白无说话人、角色没选人、闪回不成对、括号后无台词", () => {
    const bad = (...els: EditorElement[]) => validateScenes([scene(...els)])?.message;
    expect(bad(el("action"), el("dialogue", "x"))).toBe("台词前面没有角色行");
    expect(bad(el("character"), el("dialogue", "x"))).toBe("角色行没有选人物");
    expect(bad(el("character", "", "c1"), el("action"))).toBe("角色行后面没有台词");
    expect(bad(el("flashback_start"), el("action"))).toBe("闪回没有结束");
    expect(bad(el("flashback_end"))).toBe("闪回结束前没有闪回");
    expect(bad(el("character", "", "c1"), el("parenthetical", "x"))).toBe("角色行后面没有台词");
    expect(bad(el("character", "", "c1"), el("dialogue", "x"), el("parenthetical", "y"))).toBe(
      "括号后面没有台词",
    );
    expect(
      validateScenes([
        scene(el("character", "", "c1"), el("parenthetical", "p"), el("dialogue", "d")),
      ]),
    ).toBeNull();
  });

  test("校验返回第几场第几个元素", () => {
    const err = validateScenes([scene(el("action")), scene(el("action"), el("dialogue", "x"))]);
    expect(err).toMatchObject({ scene: 1, element: 1 });
  });
});

describe("编辑操作", () => {
  test("把有文字的动作改成角色：文字落到后面新建的对白里，焦点进人物选择", () => {
    const s = scene(el("action", "你好"));
    const r = setElementType([s], s.key, 0, "character");
    expect(types(r.scenes[0])).toEqual(["character", "dialogue"]);
    expect(r.scenes[0].elements[1].text).toBe("你好");
    expect(r.focus).toMatchObject({ pick: true });
  });

  test("把空动作改成角色：后面补一个空对白", () => {
    const s = scene(el("action"));
    const r = setElementType([s], s.key, 0, "character");
    expect(types(r.scenes[0])).toEqual(["character", "dialogue"]);
  });

  test("不合法的类型切换被拒绝并给出原因，内容不变", () => {
    const s = scene(el("action", "a"));
    const r = setElementType([s], s.key, 0, "dialogue");
    expect(r.reason).not.toBe("");
    expect(r.scenes).toEqual([s]);
  });

  test("Tab 循环切换跳过不合法的类型", () => {
    const s = scene(el("action", "a"));
    const next = cycleType([s], s.key, 0, 1);
    expect(next.scenes[0].elements[0].type).toBe("character");
    const back = cycleType([s], s.key, 0, -1);
    expect(["note", "shot", "subtitle", "transition"]).toContain(back.scenes[0].elements[0].type);
  });

  test("Enter 在没有台词的角色行后接对白；已有台词时只是移过去", () => {
    const lone = scene(el("character", "", "c1"));
    expect(types(enterAt([lone], lone.key, 0, 0).scenes[0])).toEqual(["character", "dialogue"]);
    const s = scene(el("action", "ab"), el("character", "", "c1"), el("dialogue", "xy"));
    const moved = enterAt([s], s.key, 1, 0);
    expect(types(moved.scenes[0])).toEqual(["action", "character", "dialogue"]);
    expect(moved.focus?.key).toBe(s.elements[2].key);
  });

  test("Enter 在对白后接动作，在动作中间拆成两个动作", () => {
    const s = scene(el("action", "ab"), el("character", "", "c1"), el("dialogue", "xy"));
    expect(types(enterAt([s], s.key, 2, 2).scenes[0]).at(-1)).toBe("action");
    expect(types(enterAt([s], s.key, 0, 1).scenes[0]).slice(0, 2)).toEqual(["action", "action"]);
  });

  test("Enter 在文字中间会把光标后的文字带到新行", () => {
    const s = scene(el("action", "abcd"));
    const r = enterAt([s], s.key, 0, 2);
    expect(r.scenes[0].elements.map((e) => e.text)).toEqual(["ab", "cd"]);
  });

  test("在空行上按 Enter 也是换行：新起一行，不切换这一行的类型（切类型只用 Tab 和工具条）", () => {
    const s = scene(el("action", "a"), el("action", ""));
    const r = enterAt([s], s.key, 1, 0);
    expect(types(r.scenes[0])).toEqual(["action", "action", "action"]);
    expect(r.focus).toMatchObject({ key: r.scenes[0].elements[2].key, off: 0 });
    // 空对白行按 Enter：对白留着，下面接动作
    const d = scene(el("character", ""), el("dialogue", ""));
    expect(types(enterAt([d], d.key, 1, 0).scenes[0])).toEqual(["character", "dialogue", "action"]);
  });

  test("Backspace：空行删除；行首非空与上一行合并；不能夹断角色和台词", () => {
    const s = scene(el("action", "ab"), el("action", ""));
    expect(backspaceAt([s], s.key, 1, true).scenes[0].elements).toHaveLength(1);
    const merge = scene(el("action", "ab"), el("action", "cd"));
    const r = backspaceAt([merge], merge.key, 1, false);
    expect(r.scenes[0].elements.map((e) => e.text)).toEqual(["abcd"]);
    expect(r.focus).toMatchObject({ off: 2 });
    const blocked = scene(el("character", "", "c1"), el("dialogue", "x"));
    expect(backspaceAt([blocked], blocked.key, 0, true).reason).not.toBe("");
  });

  test("新建一场插在指定场次之后，只有一个空动作", () => {
    const a = scene(el("action", "a"));
    const b = scene(el("action", "b"));
    const r = newScene([a, b], a.key);
    expect(r.scenes).toHaveLength(3);
    expect(r.scenes[1].elements).toHaveLength(1);
    expect(r.scenes[1].elements[0].type).toBe("action");
    expect(r.scenes[0]).toBe(a);
  });

  test("删除一场；至少保留一场", () => {
    const a = scene(el("action", "a"));
    const b = scene(el("action", "b"));
    expect(removeScene([a, b], a.key).map((s) => s.key)).toEqual([b.key]);
    expect(removeScene([a], a.key)).toHaveLength(1);
  });
});

describe("调整场次顺序", () => {
  test("挪到某一场之前、挪到末尾；场次信息跟着场次走，原数组不变", () => {
    const a = { ...scene(el("action", "a")), title: "甲" };
    const b = { ...scene(el("action", "b")), title: "乙" };
    const c = { ...scene(el("action", "c")), title: "丙" };
    const all = [a, b, c];
    expect(moveScene(all, c.key, a.key).map((s) => s.title)).toEqual(["丙", "甲", "乙"]);
    expect(moveScene(all, a.key, null).map((s) => s.title)).toEqual(["乙", "丙", "甲"]);
    expect(all.map((s) => s.title)).toEqual(["甲", "乙", "丙"]);
  });

  test("挪到自己前面或不存在的目标：原样返回", () => {
    const a = scene(el("action", "a"));
    const b = scene(el("action", "b"));
    expect(moveScene([a, b], a.key, a.key)).toEqual([a, b]);
    expect(moveScene([a, b], a.key, "nope")).toEqual([a, b]);
    expect(moveScene([a, b], "nope", b.key)).toEqual([a, b]);
  });
});

describe("统计与序列化", () => {
  test("字数不含角色行和备注；对白占比和预估时长", () => {
    const s = scene(
      el("action", "雨夜码头"),
      el("character", "", "c1"),
      el("dialogue", "你到底瞒了我什么"),
      el("note", "只给自己看"),
      el("shot", "灯"),
    );
    const stats = scriptStats([s]);
    expect(stats.scenes).toBe(1);
    expect(stats.chars).toBe(4 + 8 + 1);
    expect(stats.dialogueRatio).toBe(Math.round((8 / 13) * 100));
    // 对白 8 字 / 4 + 动作 1 条 * 2 + 空镜 1 条 * 2
    expect(stats.seconds).toBe(2 + 2 + 2);
  });

  test("序列化只含内容，不含本地 key 和 id：保存拿到新 ID 不应让文档变脏", () => {
    const a = scene(el("action", "a"));
    const b = {
      ...a,
      key: "other",
      id: "s9",
      elements: [{ ...a.elements[0], key: "x", id: "e9" }],
    };
    expect(serializeContent([a])).toBe(serializeContent([b]));
    const c = scene(el("action", "不同"));
    expect(serializeContent([a])).not.toBe(serializeContent([c]));
  });
});
