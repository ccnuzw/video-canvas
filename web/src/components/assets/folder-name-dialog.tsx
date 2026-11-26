import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { DialogSession } from "@/components/dialog-session";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FOLDER_NAME_MAX, validateAssetName, validateFolderName } from "@/utils/assets/folder-name";

/**
 * 文件夹和素材共用的命名弹窗。保存失败时保留用户输入。
 * @param open 是否打开
 * @param mode create 新建，rename 重命名
 * @param target 名称对应的资源，默认是文件夹
 * @param initial 重命名时的当前名称，新建传空串；打开时作为初始值
 * @param onClose 关闭
 * @param onSubmit 提交名称，失败时抛错
 */
export function FolderNameDialog({
  open,
  mode,
  initial = "",
  target = "folder",
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "rename";
  initial?: string;
  target?: "folder" | "asset";
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {/* 每次打开重新挂载表单，初始值取最新名称，不用在 effect 里同步；关闭时留给退出动画 */}
        <DialogSession open={open}>
          <FolderNameForm
            target={target}
            mode={mode}
            initial={initial}
            onClose={onClose}
            onSubmit={onSubmit}
            saving={saving}
            setSaving={setSaving}
          />
        </DialogSession>
      </DialogContent>
    </Dialog>
  );
}

function FolderNameForm({
  mode,
  target,
  initial,
  onClose,
  onSubmit,
  saving,
  setSaving,
}: {
  mode: "create" | "rename";
  initial: string;
  target: "folder" | "asset";
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
  saving: boolean;
  setSaving: (saving: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  /** 提交过一次才显示校验提示，输入过程中不抢着报错 */
  const [touched, setTouched] = useState(false);
  const isAsset = target === "asset";
  const result = isAsset ? validateAssetName(value) : validateFolderName(value);
  const invalid = !result.ok;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!result.ok || saving) return;
    setSaving(true);
    try {
      await onSubmit(result.name);
      onClose();
    } catch {
      // 提示由请求层统一弹，弹窗保持打开
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {isAsset ? "重命名素材" : mode === "create" ? "新建文件夹" : "重命名文件夹"}
        </DialogTitle>
        <DialogDescription className={isAsset ? "sr-only" : undefined}>
          {isAsset
            ? "修改个人资产库中显示的素材名称。"
            : `名称最多 ${FOLDER_NAME_MAX} 个字，不能与已有文件夹重名。`}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Input
          autoFocus
          disabled={saving}
          value={value}
          aria-label={isAsset ? "素材名称" : "文件夹名称"}
          aria-invalid={touched && invalid}
          placeholder={isAsset ? undefined : "例如：角色图"}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        {touched && !result.ok && (
          <span role="alert" className="text-destructive text-xs">
            {result.message}
          </span>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {mode === "create" ? "创建" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
