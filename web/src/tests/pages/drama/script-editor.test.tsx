import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import type { BackendScriptEntityDto, BackendScriptViewDto } from "@/api/drama/type";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

/** 结构化剧本编辑器：挂真实的 hook 和组件，只替换网络请求。 */

let dom: DomEnv;
let Harness: React.ComponentType<{ locked?: boolean }>;
beforeAll(async () => {
  dom = await installDom();
  const { ScriptEditor } = await import("@/pages/drama/workspace/script-editor");
  const { useScriptEditor } =
    await import("@/pages/drama/workspace/script-editor/use-script-editor");
  Harness = function Harness({ locked = false }: { locked?: boolean }) {
    const editor = useScriptEditor(
      "1a2b",
      3,
      locked,
      () => {},
      () => {},
    );
    return <ScriptEditor editor={editor} no={3} />;
  };
});
afterAll(async () => {
  await dom.flush(50);
  dom.restore();
});

const person = (id: string, name: string, confirmed = true): BackendScriptEntityDto => ({
  id,
  name,
  aliases: null,
  note: "",
  canvas_node_id: "",
  confirmed,
  episodes: null,
  lines: 0,
});

const script = (locked = false): BackendScriptViewDto => ({
  revision: 5,
  locked,
  warnings: null,
  scenes: [
    {
      id: "s1",
      int_ext: "exterior",
      time_label: "夜",
      location_id: "l1",
      title: "码头对峙",
      summary: "",
      emotions: null,
      extra_character_ids: null,
      props: null,
      elements: [
        { id: "e1", type: "action", text: "雨。", character_id: null, extension: "" },
        { id: "e2", type: "character", text: "", character_id: "c1", extension: "" },
        { id: "e3", type: "dialogue", text: "走。", character_id: null, extension: "" },
      ],
    },
  ],
});

let get: ReturnType<typeof spyOn<typeof service, "get">>;
let put: ReturnType<typeof spyOn<typeof service, "put">>;
let locked = false;
beforeEach(() => {
  locked = false;
  get = spyOn(service, "get").mockImplementation((async (url: string) => {
    if (url.endsWith("/script")) return script(locked);
    if (url.endsWith("script-characters"))
      return [person("c1", "林骁"), person("c2", "苏晚", false)];
    return [person("l1", "城西老码头")];
  }) as never);
  put = spyOn(service, "put").mockImplementation((async (
    _url: string,
    body: { revision: number },
  ) => ({
    ...script(),
    revision: body.revision + 1,
  })) as never);
});
afterEach(() => {
  get.mockRestore();
  put.mockRestore();
});

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("等待超时");
    await dom.flush(20);
  }
}

/** 编辑区上方那一行元素类型条里的按钮 */
const bar = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>("[role=toolbar] button")];
const barButton = (c: HTMLElement, label: string) =>
  bar(c).find((b) => b.textContent === label) as HTMLButtonElement;

const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-el]")];
const textRow = (c: HTMLElement, text: string) =>
  rows(c)
    .map((r) => r.querySelector<HTMLElement>("[data-text]"))
    .find((n) => n?.textContent === text) as HTMLElement;

/** 把光标放在一行文字末尾并派发 focusin，让编辑器知道光标在哪 */
async function focusEnd(el: HTMLElement) {
  const { setCaret } = await import("@/pages/drama/workspace/script-editor/caret");
  setCaret(el, "end");
  el.dispatchEvent(new dom.win.FocusEvent("focusin", { bubbles: true }));
  await dom.flush();
}

async function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new dom.win.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  await dom.flush();
  return event;
}

describe("结构化剧本编辑器", () => {
  test("按场次和元素渲染：场号、地点、角色名、对白；待确认的人物有标记", async () => {
    const m = await dom.mount(<Harness />);
    await until(() => rows(m.container).length === 3);
    expect(m.container.textContent).toContain("3-1");
    expect(m.container.textContent).toContain("城西老码头");
    expect(m.container.querySelector("[data-pick]")?.textContent).toBe("林骁");
    expect(textRow(m.container, "走。")).toBeTruthy();
    // 场次标题下面是只读的「出场人物」一行（说话的人加在场不说话的人）
    expect(m.container.querySelector("[data-scene-cast]")?.textContent).toBe("出场人物：林骁");
    // 编辑区上方一行元素类型条：光标还没进任何行时按第一行算，动作行不能直接改成对白
    expect(barButton(m.container, "动作").getAttribute("aria-pressed")).toBe("true");
    const dialogue = barButton(m.container, "对白");
    expect(dialogue.disabled).toBe(true);
    expect(dialogue.title).toBe("前面要先有角色行");
    // 场次、闪回也在这一行里；页边没有类型标签
    expect(barButton(m.container, "场次")).toBeTruthy();
    expect(barButton(m.container, "闪回")).toBeTruthy();
    expect(m.container.querySelector("[data-type-menu]")).toBeNull();
    await m.unmount();
  });

  test("类型条跟着光标：点进对白行，「对白」高亮；对白行上「括号」可选", async () => {
    const m = await dom.mount(<Harness />);
    await until(() => rows(m.container).length === 3);
    await focusEnd(textRow(m.container, "走。"));
    expect(barButton(m.container, "对白").getAttribute("aria-pressed")).toBe("true");
    expect(barButton(m.container, "动作").getAttribute("aria-pressed")).toBe("false");
    expect(barButton(m.container, "括号").disabled).toBe(false);
    await m.unmount();
  });

  test("在对白后按 Enter 新起一行动作，停手后整集保存：已有行带 ID，新行 ID 为 null", async () => {
    const m = await dom.mount(<Harness />);
    await until(() => rows(m.container).length === 3);
    const dialogue = textRow(m.container, "走。");
    await focusEnd(dialogue);
    const event = await press(dialogue, "Enter");
    expect(event.defaultPrevented).toBe(true);
    expect(rows(m.container)).toHaveLength(4);
    await until(() => put.mock.calls.length === 1);
    const [url, body] = put.mock.calls[0] as [
      string,
      {
        revision: number;
        scenes: { id: string; elements: { id: string | null; type: string }[] }[];
      },
    ];
    expect(url).toBe("/dramas/1a2b/episodes/3/script");
    expect(body.revision).toBe(5);
    expect(body.scenes[0].id).toBe("s1");
    expect(body.scenes[0].elements.map((e) => e.id)).toEqual(["e1", "e2", "e3", null]);
    expect(body.scenes[0].elements.at(-1)?.type).toBe("action");
    await m.unmount();
  });

  test("把动作切成角色但没选人物：保存被拦住，页面写明位置，不发请求", async () => {
    const m = await dom.mount(<Harness />);
    await until(() => rows(m.container).length === 3);
    const action = textRow(m.container, "雨。");
    await focusEnd(action);
    await dom.click(barButton(m.container, "角色"));
    // 动作行有文字：变成角色行，原来的文字落到后面新建的对白里，所以多一行
    await until(() => rows(m.container).length === 4);
    await until(() => !!m.container.querySelector("[role=alert]"), 4000);
    expect(m.container.querySelector("[role=alert]")?.textContent).toContain("角色行没有选人物");
    expect(put.mock.calls).toHaveLength(0);
    await m.unmount();
  });

  test("已锁定：不能编辑，Enter 不会加行，也不会保存", async () => {
    locked = true;
    const m = await dom.mount(<Harness locked />);
    await until(() => rows(m.container).length === 3);
    const dialogue = textRow(m.container, "走。");
    expect(dialogue.getAttribute("contenteditable")).toBe("false");
    await press(dialogue, "Enter");
    expect(rows(m.container)).toHaveLength(3);
    // 锁定时没有类型条；场次标题是纯文字，不出现下拉和占位词
    expect(m.container.querySelector("[role=toolbar]")).toBeNull();
    expect(m.container.querySelector("[data-scene-heading] select")).toBeNull();
    expect(m.container.querySelector("[data-scene-heading]")?.textContent).not.toContain(
      "选择地点",
    );
    await dom.flush(1000);
    expect(put.mock.calls).toHaveLength(0);
    await m.unmount();
  });

  test("场次标题的时间、内外景用和地点选择同一套弹层，不用原生下拉；选了就保存", async () => {
    const m = await dom.mount(<Harness />);
    await until(() => rows(m.container).length === 3);
    const heading = m.container.querySelector<HTMLElement>("[data-scene-heading]")!;
    expect(heading.querySelector("select")).toBeNull();
    const time = heading.querySelector<HTMLButtonElement>("button[aria-label=时间]")!;
    expect(time.textContent).toBe("夜");
    await dom.click(time);
    const option = await (async () => {
      let found: HTMLButtonElement | undefined;
      await until(() => {
        found = [
          ...dom.win.document.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"),
        ].find((b) => b.textContent === "日");
        return !!found;
      });
      return found!;
    })();
    await dom.click(option);
    await until(() => time.textContent === "日");
    await until(() => put.mock.calls.length === 1);
    const body = put.mock.calls[0][1] as { scenes: { time_label: string }[] };
    expect(body.scenes[0].time_label).toBe("日");
    await m.unmount();
  });

  test("读取失败时给出提示而不是空白", async () => {
    get.mockImplementation((async () => {
      throw new Error("boom");
    }) as never);
    const m = await dom.mount(<Harness />);
    await until(() => (m.container.textContent ?? "").includes("读取失败"));
    await m.unmount();
  });
});
