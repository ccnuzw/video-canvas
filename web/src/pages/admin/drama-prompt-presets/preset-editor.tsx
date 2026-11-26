import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminPreset, PresetInput } from "@/api/admin/drama-prompt-preset";
import { dramaErrorMessage } from "@/api/drama/errors";
import type { PromptStep } from "@/api/drama/type";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/admin-ui/dialog";
import { DialogSession } from "@/components/dialog-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRetained } from "@/hooks/use-retained";
import { checkBoardTemplate } from "@/utils/drama/placeholders";
import { PROMPT_BODY_MAX, promptStepName } from "@/utils/drama/prompts";

export type PresetEdit = { row?: AdminPreset; copy?: boolean; originalBody?: string };

type PresetEditorProps = {
  step: PromptStep;
  edit: PresetEdit | null;
  onClose: () => void;
  onSave: (id: string | undefined, input: PresetInput) => Promise<void>;
};

/** 短剧提示词编辑弹窗，关窗时保留表单直到退出动画结束。 */
export function PresetEditor({ step, edit, onClose, onSave }: PresetEditorProps) {
  const open = edit !== null;
  const shown = useRetained(edit);
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent
        className="flex max-h-[min(88svh,800px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={!saving}
      >
        <DialogSession open={open}>
          {shown && (
            <PresetEditorForm
              step={step}
              edit={shown}
              onClose={onClose}
              onSave={onSave}
              saving={saving}
              setSaving={setSaving}
            />
          )}
        </DialogSession>
      </DialogContent>
    </Dialog>
  );
}

function PresetEditorForm({
  step,
  edit,
  onClose,
  onSave,
  saving,
  setSaving,
}: Omit<PresetEditorProps, "edit"> & {
  edit: PresetEdit;
  saving: boolean;
  setSaving: (saving: boolean) => void;
}) {
  const [name, setName] = useState(edit.copy ? "" : (edit.row?.name ?? ""));
  const [description, setDescription] = useState(edit.row?.description ?? "");
  const [body, setBody] = useState(edit.originalBody ?? edit.row?.body ?? "");
  const [error, setError] = useState<string>();
  const updating = edit.row && !edit.copy ? edit.row : null;
  const title = edit.copy ? "复制提示词" : updating ? "编辑提示词" : "新建提示词";
  const submit = async () => {
    if (saving || !name.trim() || !body.trim()) return;
    const problem = step === "board" ? checkBoardTemplate(body) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave(updating?.id, {
        name: name.trim(),
        description: description.trim(),
        body: body.trim(),
        revision: updating?.revision,
      });
    } catch (cause) {
      setError(dramaErrorMessage(cause, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader className="shrink-0 px-6 pt-6 pr-14 pb-4">
        <DialogTitle>
          {title} · {promptStepName(step)}
        </DialogTitle>
        <DialogDescription>
          {updating?.status === "enabled"
            ? "保存后，新选择将使用新版；已建项目仍沿用原正文。"
            : updating
              ? "只编辑可替换的正文，不改变生成协议。"
              : "新模板保存为停用状态，启用后创作者才可选择。"}
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-4 overflow-y-auto px-6 pb-4">
        <label className="grid gap-1.5">
          模板名称
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoComplete="off"
            disabled={saving}
          />
        </label>
        <label className="grid gap-1.5">
          用途说明
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            disabled={saving}
          />
        </label>
        <label className="grid gap-1.5">
          提示词正文
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={PROMPT_BODY_MAX}
            required
            disabled={saving}
            spellCheck={false}
            className="min-h-52 resize-y font-mono text-sm"
          />
        </label>
        {step === "board" && (
          <p className="text-muted-foreground text-xs">
            必须保留 {"{{画面}}"}；可用 {"{{格数}}、{{列数}}、{{行数}}、{{比例}}"}。
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <DialogFooter className="m-0 shrink-0">
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={saving || !name.trim() || !body.trim()}>
          {saving && <Loader2 className="animate-spin" />}保存
        </Button>
      </DialogFooter>
    </form>
  );
}
