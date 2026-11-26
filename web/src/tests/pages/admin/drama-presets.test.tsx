import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";

import type { AdminPresetGroup } from "@/api/admin/drama-prompt-preset";
import { TooltipProvider } from "@/components/ui/tooltip";
import type DramaPresetsPageType from "@/pages/admin/drama-prompt-presets";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

let dom: DomEnv;
let DramaPresetsPage: typeof DramaPresetsPageType;
beforeAll(async () => {
  dom = await installDom();
  DramaPresetsPage = (await import("@/pages/admin/drama-prompt-presets")).default;
});
afterAll(() => dom.restore());

const row = {
  id: "a",
  name: "标准版",
  description: "原内置",
  body: "当前正文",
  revision: 2,
  status: "enabled",
  updated_at: "2026-11-25T00:00:00Z",
} as const;

test("后台保护默认项，并可复制原内置为停用模板", async () => {
  const groups: AdminPresetGroup[] = [
    { step: "plan", revision: 1, default_id: "a", original_body: "升级前的正文", items: [row] },
  ];
  const read = spyOn(service, "get").mockResolvedValue({ items: groups } as never);
  const create = spyOn(service, "post").mockResolvedValue({
    ...row,
    id: "b",
    status: "disabled",
  } as never);
  const mounted = await dom.mount(
    <TooltipProvider>
      <DramaPresetsPage />
    </TooltipProvider>,
  );
  try {
    await dom.flush();
    expect(mounted.container.textContent).toContain("短剧提示词");
    expect(mounted.container.textContent).not.toContain("管理开拍设置里的内置提示词");
    const panel = mounted.container.querySelector('[data-slot="data-panel"]')!;
    expect(
      panel.querySelector('[data-slot="table-toolbar"] [aria-label="筛选状态"]'),
    ).not.toBeNull();
    expect(panel.querySelector('[data-slot="data-panel-body"] table')).not.toBeNull();
    const action = (root: ParentNode, text: string) =>
      [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
    const defaultRow = mounted.container.querySelector("tbody tr");
    expect(defaultRow?.textContent).toContain("默认");
    expect(defaultRow?.querySelector('[data-slot="status-label"]')?.textContent).toBe("已启用");
    expect(defaultRow?.querySelector('[aria-label="编辑 标准版"]')).not.toBeNull();
    expect(defaultRow?.querySelector('[aria-label="标准版的更多操作"]')).toBeNull();
    expect(action(defaultRow!, "停用")).toBeUndefined();
    expect(action(defaultRow!, "归档")).toBeUndefined();
    await dom.click(action(mounted.container, "复制原内置"));
    const popup = dom.win.document.body.querySelector('[data-slot="dialog-content"]')!;
    expect(popup.querySelector("textarea")?.value).toBe("升级前的正文");
    await dom.type(popup.querySelector("input")!, "原版备用");
    await dom.click(action(popup, "保存"));
    expect(create.mock.calls[0]).toMatchObject([
      "/admin/drama-prompt-presets/plan",
      { name: "原版备用", body: "升级前的正文" },
      { silent: true },
    ]);
  } finally {
    await mounted.unmount();
    create.mockRestore();
    read.mockRestore();
  }
});

test("分类切换重置状态筛选，停用模板的管理操作在行末菜单中", async () => {
  const groups: AdminPresetGroup[] = [
    {
      step: "plan",
      revision: 1,
      default_id: row.id,
      original_body: row.body,
      items: [row, { ...row, id: "b", name: "备用版", status: "disabled" }],
    },
    { step: "scripts", revision: 1, default_id: row.id, original_body: row.body, items: [row] },
  ];
  const read = spyOn(service, "get").mockResolvedValue({ items: groups } as never);
  const mounted = await dom.mount(
    <TooltipProvider>
      <DramaPresetsPage />
    </TooltipProvider>,
  );
  try {
    const { container } = mounted;
    const page = dom.win.document;
    const options = (role: string, name: string) =>
      [...page.querySelectorAll(`[role="${role}"]`)].find((node) => node.textContent === name);
    const rows = () => [...container.querySelectorAll("tbody tr")];

    await dom.click(container.querySelector('[aria-label="筛选状态"]'));
    const disabled = options("option", "已停用");
    expect(disabled).toBeDefined();
    await dom.act(async () => {
      disabled?.dispatchEvent(new dom.win.PointerEvent("pointerdown", { bubbles: true }));
    });
    await dom.click(disabled);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("备用版");

    const more = container.querySelector('[aria-label="备用版的更多操作"]');
    await dom.click(more);
    expect(options("menuitem", "启用")).toBeDefined();
    expect(options("menuitem", "归档")).toBeDefined();
    expect(options("menuitem", "设为默认")).toBeUndefined();
    await dom.act(async () => {
      options("menuitem", "启用")?.dispatchEvent(
        new dom.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    const script = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "分集剧本",
    );
    await dom.click(script);
    expect(container.querySelector('[aria-label="筛选状态"]')?.textContent).toContain("全部状态");
    expect(rows()[0]?.textContent).toContain("标准版");
  } finally {
    await mounted.unmount();
    read.mockRestore();
  }
});
