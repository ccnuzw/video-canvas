import { afterAll, beforeAll, expect, test } from "bun:test";
import { useState } from "react";

import { PresetEditor, type PresetEdit } from "@/pages/admin/drama-prompt-presets/preset-editor";
import { holdExitAnimations, installDom, type DomEnv } from "@/tests/helpers/dom";

let dom: DomEnv;
beforeAll(async () => {
  dom = await installDom();
});
afterAll(() => dom.restore());

function PromptEditorHarness() {
  const [edit, setEdit] = useState<PresetEdit | null>(null);
  return (
    <>
      <button
        type="button"
        data-testid="open"
        onClick={() => setEdit({ originalBody: "原提示词" })}
      >
        打开
      </button>
      <PresetEditor step="plan" edit={edit} onClose={() => setEdit(null)} onSave={async () => {}} />
    </>
  );
}

test("短剧提示词关闭期间保留正文，快速重开时表单重新初始化", async () => {
  const release = holdExitAnimations(dom);
  const { unmount } = await dom.mount(<PromptEditorHarness />);
  const doc = dom.win.document;
  const open = doc.querySelector('[data-testid="open"]');
  try {
    expect(doc.querySelector("textarea")).toBeNull();
    await dom.click(open);
    const initial = doc.querySelector("textarea");
    expect(initial?.value).toBe("原提示词");
    const cancel = Array.from(doc.querySelectorAll("button")).find(
      (button) => button.textContent === "取消",
    );
    await dom.click(cancel ?? null);
    expect(doc.querySelector("textarea")).toBe(initial);
    await dom.click(open);
    expect(doc.querySelector("textarea")).not.toBe(initial);
    expect(doc.querySelector("textarea")?.value).toBe("原提示词");
  } finally {
    release();
    await unmount();
  }
});
