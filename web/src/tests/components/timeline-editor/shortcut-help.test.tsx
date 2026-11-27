import { afterAll, beforeAll, expect, mock, test } from "bun:test";

import { installDom, type DomEnv } from "@/tests/helpers/dom";
import type { ShortcutHelp as ShortcutHelpComponent } from "@/components/timeline-editor/timeline/shortcut-help";
import { useTimelineShortcuts } from "@/components/timeline-editor/timeline/use-timeline-shortcuts";

let dom: DomEnv;
let ShortcutHelp: typeof ShortcutHelpComponent;

beforeAll(async () => {
  dom = await installDom();
  ShortcutHelp = (await import("@/components/timeline-editor/timeline/shortcut-help")).ShortcutHelp;
});
afterAll(() => dom?.restore());

test("快捷键按钮打开操作说明，列出 Mac 和 Windows 的按键", async () => {
  const mounted = await dom.mount(<ShortcutHelp readOnly={false} />);
  try {
    const trigger = mounted.container.querySelector('button[aria-label="快捷键"]');
    expect(trigger).not.toBeNull();
    await dom.click(trigger);
    const popup = dom.win.document.querySelector('[role="dialog"][data-slot="dialog-content"]');
    expect(popup?.getAttribute("aria-modal")).toBe("true");
    expect(popup?.classList.contains("bg-chrome")).toBe(true);
    expect(popup?.classList.contains("bg-popover")).toBe(false);
    expect(popup?.classList.contains("backdrop-blur-2xl")).toBe(true);
    expect(popup?.textContent).toContain("播放 / 暂停");
    expect(popup?.textContent).toContain("删除选中的片段");
    const keys = [...(popup?.querySelectorAll("kbd") ?? [])].map((key) => key.textContent);
    expect(keys).toContain("⌘ + Z");
    expect(keys).toContain("Ctrl + Z");
    expect(keys).toContain("Backspace");
    await dom.click(popup?.querySelector('button[aria-label="关闭"]'));
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await mounted.unmount();
  }
});

test("只读时间线只列出可用的快捷操作", async () => {
  const mounted = await dom.mount(<ShortcutHelp readOnly />);
  try {
    await dom.click(mounted.container.querySelector('button[aria-label="快捷键"]'));
    const popup = dom.win.document.querySelector('[role="dialog"][data-slot="dialog-content"]');
    expect(popup?.textContent).toContain("播放 / 暂停");
    expect(popup?.textContent).toContain("缩放时间线");
    expect(popup?.textContent).not.toContain("拆分");
  } finally {
    await mounted.unmount();
  }
});

test("聚焦快捷键按钮时，空格保留按钮的原生行为", async () => {
  const toggle = mock(() => {});
  const noop = () => {};
  function TimelineHelp() {
    useTimelineShortcuts({
      readOnly: false,
      hasSelection: false,
      toggle,
      split: noop,
      trimLeft: noop,
      trimRight: noop,
      remove: noop,
      toggleSnap: noop,
      undo: noop,
      redo: noop,
      deselect: noop,
    });
    return <ShortcutHelp readOnly={false} />;
  }
  const mounted = await dom.mount(<TimelineHelp />);
  try {
    const button = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="快捷键"]',
    )!;
    button.focus();
    const pressSpace = () =>
      new dom.win.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    expect(button.dispatchEvent(pressSpace())).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
    expect(mounted.container.dispatchEvent(pressSpace())).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
  } finally {
    await mounted.unmount();
  }
});
