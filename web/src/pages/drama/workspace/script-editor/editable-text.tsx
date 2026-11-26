import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * 一行可编辑的纯文本。文字由外面的状态持有，但不让 React 重写 DOM：
 * 只有状态里的文字和 DOM 里的不一样时（拆行、合并、重新载入）才写回，所以打字时光标不会跳。
 * @param value 当前文字
 * @param editable 是否可编辑
 * @param placeholder 空行时的占位提示
 * @param onInput 用户输入后的新文字
 */
export function EditableText({
  value,
  editable,
  placeholder,
  onInput,
  className,
  ...rest
}: {
  value: string;
  editable: boolean;
  placeholder: string;
  onInput: (text: string) => void;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onInput" | "children">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && node.textContent !== value) node.textContent = value;
  }, [value]);
  return (
    <div
      ref={ref}
      // plaintext-only：粘贴进来的只有纯文本，回车由编辑器自己处理
      contentEditable={editable ? "plaintext-only" : false}
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      data-text
      onInput={(e) => onInput(e.currentTarget.textContent ?? "")}
      className={cn(
        "min-h-[2.05em] rounded-md px-2 -mx-2 break-words whitespace-pre-wrap outline-none",
        "empty:before:text-muted-foreground/60 empty:before:content-[attr(data-placeholder)]",
        editable && "focus:bg-chrome-hover",
        className,
      )}
      {...rest}
    />
  );
}
