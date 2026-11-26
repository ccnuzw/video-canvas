import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";

import { FolderNameDialog } from "@/components/assets/folder-name-dialog";
import { FolderPickerDialog } from "@/components/assets/folder-picker-dialog";
import { installDom, type DomEnv } from "@/tests/helpers/dom";
import service from "@/utils/requests/service";

let dom: DomEnv;
beforeAll(async () => {
  dom = await installDom();
});
afterAll(() => dom.restore());

const button = (label: string) =>
  [...dom.win.document.querySelectorAll("button")].find((node) => node.textContent === label);

test("入库时可以提交可选名称", async () => {
  const read = spyOn(service, "get").mockResolvedValue({ items: [] });
  const confirm = mock(async () => {});
  const { unmount } = await dom.mount(
    <FolderPickerDialog
      open
      onOpenChange={() => {}}
      title="加入资产库"
      confirmLabel="加入"
      assetName="original.png"
      onConfirm={confirm}
    />,
  );
  try {
    const name = dom.win.document.querySelector('input[placeholder="original.png"]')!;
    await dom.type(name, " 角色定稿 ");
    await dom.click(button("加入"));
    expect(confirm).toHaveBeenCalledWith(null, "角色定稿");
  } finally {
    await unmount();
    read.mockRestore();
  }
});

test("重命名会填入现有名称，提交失败时保留新名称供重试", async () => {
  const close = mock(() => {});
  const save = mock(async () => {
    throw new Error("保存失败");
  });
  const { unmount } = await dom.mount(
    <FolderNameDialog
      open
      mode="rename"
      target="asset"
      initial="original.png"
      onClose={close}
      onSubmit={save}
    />,
  );
  try {
    const name = dom.win.document.querySelector<HTMLInputElement>('input[aria-label="素材名称"]')!;
    expect(name.value).toBe("original.png");
    await dom.type(name, " 定稿 ");
    await dom.click(button("保存"));
    expect(save).toHaveBeenCalledWith("定稿");
    expect(name.value).toBe(" 定稿 ");
    expect(close).not.toHaveBeenCalled();
  } finally {
    await unmount();
  }
});
