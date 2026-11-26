import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { installDom, type DomEnv } from "@/tests/helpers/dom";

/** 场次栏：点一下只是让稿纸滚到这一场，栏里不改任何内容。 */

let dom: DomEnv;
let SceneList: typeof import("@/pages/drama/workspace/script-editor/scene-list").SceneList;
beforeAll(async () => {
  dom = await installDom();
  ({ SceneList } = await import("@/pages/drama/workspace/script-editor/scene-list"));
});
afterAll(async () => {
  await dom.flush(50);
  dom.restore();
});

const scene = (key: string, title: string, locationId: string | null) => ({
  key,
  intExt: "",
  timeLabel: "",
  locationId,
  title,
  summary: "",
  emotions: [],
  extraCharacterIds: [],
  props: [],
  elements: [{ key: `${key}-c`, type: "character", text: "", characterId: "c1", extension: "" }],
});

const editor = {
  readOnly: false,
  scenes: [scene("s1", "意象镜头", "l1"), scene("s2", "", "l2")],
  characters: [{ id: "c1", name: "闰土", canvasNodeId: "" }],
  locations: [
    { id: "l1", name: "海边沙地" },
    { id: "l2", name: "周家厨房" },
  ],
  moveScene: () => {},
} as unknown as Parameters<typeof SceneList>[0]["editor"];

describe("场次栏", () => {
  test("显示场号、标题（没有短标题用地点）和出场人物；点击只跳转，不展开编辑框", async () => {
    const jumped: string[] = [];
    const m = await dom.mount(<SceneList editor={editor} no={1} onJump={(k) => jumped.push(k)} />);
    const items = [...m.container.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual(["1-1意象镜头闰", "1-2周家厨房闰"]);
    await dom.click(items[1].querySelector("button"));
    await dom.click(items[0].querySelector("button"));
    expect(jumped).toEqual(["s2", "s1"]);
    expect(m.container.querySelector("input, textarea")).toBeNull();
    await m.unmount();
  });
});
