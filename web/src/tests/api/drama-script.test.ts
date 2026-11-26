import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import {
  deleteScriptEntity,
  getScript,
  getUnit,
  listScriptEntities,
  mapScript,
  parseScript,
  saveScript,
  toSaveScriptBody,
  updateScriptEntity,
} from "@/api/drama";
import type { BackendScriptViewDto, ScriptSceneDto } from "@/api/drama/type";
import service from "@/utils/requests/service";

const raw = (patch: Partial<BackendScriptViewDto> = {}): BackendScriptViewDto => ({
  revision: 4,
  locked: false,
  warnings: null,
  scenes: [
    {
      id: "s1",
      int_ext: "exterior",
      time_label: "夜",
      location_id: "l1",
      title: "码头",
      summary: "",
      emotions: null,
      extra_character_ids: null,
      props: null,
      elements: [
        { id: "e1", type: "action", text: "雨。", character_id: null, extension: "" },
        { id: "e2", type: "character", text: "", character_id: "c1", extension: "OS" },
        { id: "e3", type: "dialogue", text: "走。", character_id: null, extension: "" },
      ],
    },
  ],
  ...patch,
});

describe("剧本接口映射", () => {
  test("后端的 null 数组兜底成空数组，未知画外音标记收窄成空串", () => {
    const script = mapScript(raw());
    expect(script.warnings).toEqual([]);
    expect(script.scenes[0]).toMatchObject({ emotions: [], extraCharacterIds: [], props: [] });
    expect(script.scenes[0].elements[1]).toMatchObject({ characterId: "c1", extension: "OS" });
    const odd = raw();
    odd.scenes![0].elements![1].extension = "XX";
    expect(mapScript(odd).scenes[0].elements[1].extension).toBe("");
  });

  test("没有场次时返回空数组；空 ID 转成 null", () => {
    expect(mapScript(raw({ scenes: null })).scenes).toEqual([]);
    const blank = raw();
    blank.scenes![0].id = "";
    blank.scenes![0].location_id = "";
    expect(mapScript(blank).scenes[0]).toMatchObject({ id: null, locationId: null });
  });

  test("保存请求体：没保存过的行 id 为 null，字段改成 snake_case", () => {
    const scene: ScriptSceneDto = {
      id: null,
      intExt: "interior",
      timeLabel: "日",
      locationId: null,
      title: "新场",
      summary: "",
      emotions: ["紧张"],
      extraCharacterIds: [],
      props: [],
      elements: [{ id: null, type: "action", text: "a", characterId: null, extension: "" }],
    };
    const body = toSaveScriptBody({ revision: 7, scenes: [scene] });
    expect(body.revision).toBe(7);
    expect(body.scenes[0]).toMatchObject({
      id: null,
      int_ext: "interior",
      time_label: "日",
      location_id: null,
    });
    expect(body.scenes[0].elements[0]).toEqual({
      id: null,
      type: "action",
      text: "a",
      character_id: null,
      extension: "",
    });
  });
});

describe("剧本接口请求", () => {
  let get: Mock<typeof service.get>;
  let put: Mock<typeof service.put>;
  let post: Mock<typeof service.post>;
  let patch: Mock<typeof service.patch>;
  let del: Mock<typeof service.delete>;
  beforeEach(() => {
    get = spyOn(service, "get");
    put = spyOn(service, "put");
    post = spyOn(service, "post");
    patch = spyOn(service, "patch");
    del = spyOn(service, "delete");
  });
  afterEach(() => {
    for (const spy of [get, put, post, patch, del]) spy.mockRestore();
  });

  test("读剧本走 GET …/script", async () => {
    get.mockResolvedValue(raw());
    const script = await getScript("1a2b", 3);
    expect(get.mock.calls[0][0]).toBe("/dramas/1a2b/episodes/3/script");
    expect(script.revision).toBe(4);
  });

  test("整集保存静默（冲突、锁定、结构不合法都由调用方处理）", async () => {
    put.mockResolvedValue(raw({ revision: 5 }));
    const saved = await saveScript("1a2b", 3, { revision: 4, scenes: [] });
    expect(put.mock.calls[0][0]).toBe("/dramas/1a2b/episodes/3/script");
    expect(put.mock.calls[0][2]).toMatchObject({ silent: true });
    expect(saved.revision).toBe(5);
  });

  test("粘贴解析走 POST …/script/parse", async () => {
    post.mockResolvedValue(raw());
    await parseScript("1a2b", "苏晚：走。");
    expect(post.mock.calls[0]).toEqual(["/dramas/1a2b/script/parse", { text: "苏晚：走。" }]);
  });

  test("人物表和地点表路径不同；列表 null 兜底成空", async () => {
    get.mockResolvedValue(null);
    expect(await listScriptEntities("1a2b", "character")).toEqual([]);
    await listScriptEntities("1a2b", "location");
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      "/dramas/1a2b/script-characters",
      "/dramas/1a2b/script-locations",
    ]);
  });

  test("改名和删除走 PATCH / DELETE …/:id", async () => {
    patch.mockResolvedValue({
      id: "c1",
      name: "林晓",
      aliases: null,
      note: "",
      canvas_node_id: "",
      confirmed: true,
      episodes: null,
      lines: 0,
    });
    const entity = await updateScriptEntity("1a2b", "character", "c1", { name: "林晓" });
    expect(patch.mock.calls[0][0]).toBe("/dramas/1a2b/script-characters/c1");
    expect(entity).toMatchObject({ aliases: [], canvasNodeId: null, episodes: [] });
    del.mockResolvedValue(undefined);
    await deleteScriptEntity("1a2b", "location", "l1");
    expect(del.mock.calls[0][0]).toBe("/dramas/1a2b/script-locations/l1");
  });

  test("读单个原文单元走 GET …/units/:no，静默（失败由对照栏自己提示）", async () => {
    get.mockResolvedValue({ no: 12, title: "第十二章", chars: 5, text: "夜里下着雨" });
    const unit = await getUnit("1a2b", 12);
    expect(get.mock.calls[0][0]).toBe("/dramas/1a2b/units/12");
    expect(get.mock.calls[0][2]).toMatchObject({ silent: true });
    expect(unit.text).toBe("夜里下着雨");
  });
});
