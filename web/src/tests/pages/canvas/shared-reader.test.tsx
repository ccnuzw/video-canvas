import { expect, spyOn, test } from "bun:test";
import { installDom } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

test("编辑器共享遇到保存失败时停在原画布", async () => {
  const dom = await installDom();
  const { MemoryRouter } = await import("react-router");
  const { TopLeftBar } = await import("@/pages/canvas/chrome/top-left-bar");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  let saves = 0;
  let versionsRead = 0;
  try {
    const view = await dom.mount(
      <MemoryRouter>
        <TooltipProvider>
          <TopLeftBar
            canvasId="c1"
            title="尚未保存"
            onRename={() => {}}
            saveStatus="error"
            onSaveNow={async () => {
              saves++;
              return false;
            }}
            getVersion={() => ++versionsRead}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const trigger = view.container.querySelector('[aria-label="画布菜单"]');
    await dom.act(async () => {
      trigger?.dispatchEvent(
        new dom.win.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    const share = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("共享画布"),
    );
    expect(share).toBeDefined();
    await dom.click(share);
    expect(saves).toBe(1);
    expect(versionsRead).toBe(0);
    await view.unmount();
  } finally {
    dom.restore();
  }
});

test("查看者打开和刷新只读画布只读取共享投影，撤权后清除画布", async () => {
  const dom = await installDom();
  const { MemoryRouter, Routes, Route } = await import("react-router");
  const { default: Reader } = await import("@/pages/canvas/shared-reader");
  const get = spyOn(service, "get")
    .mockResolvedValueOnce({
      id: "c1",
      title: "共享画布样例",
      revision: 1,
      payload_json: {
        nodes: [
          {
            id: "board",
            type: "canvas",
            position: { x: 0, y: 0 },
            data: {
              kind: "storyboard",
              label: "镜头脚本",
              storyboard: { shots: [{ id: "shot", scene: "街景", duration: 3.5 }] },
            },
          },
        ],
        edges: [],
      },
    })
    .mockRejectedValueOnce(new Error("已撤权"));
  const writes = [
    spyOn(service, "post"),
    spyOn(service, "put"),
    spyOn(service, "patch"),
    spyOn(service, "delete"),
    spyOn(service, "upload"),
  ];
  try {
    const view = await dom.mount(
      <MemoryRouter initialEntries={["/canvas/c1/reader"]}>
        <Routes>
          <Route path="/canvas/:id/reader" element={<Reader />} />
        </Routes>
      </MemoryRouter>,
    );
    await dom.flush();
    expect(view.container.textContent).toContain("共享画布样例");
    expect(view.container.textContent).toContain("3.5 秒");
    await dom.act(async () => {
      window.dispatchEvent(new window.Event("focus"));
    });
    expect(view.container.textContent).toContain("画布不可访问");
    expect(view.container.textContent).not.toContain("共享画布样例");
    await view.unmount();
    expect(get.mock.calls.map(([url]) => url)).toEqual(["/canvas/c1/reader", "/canvas/c1/reader"]);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  } finally {
    get.mockRestore();
    for (const write of writes) write.mockRestore();
    dom.restore();
  }
});
