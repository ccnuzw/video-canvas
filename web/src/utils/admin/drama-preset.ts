import type { DramaPresetAdminItem, DramaPresetKind } from "@/api/admin/drama-preset/type";

/** 名称上限（与后端 maxDramaPresetNameRunes 一致） */
export const PRESET_NAME_MAX = 64;
/** 画风描述上限（与「自定义画风」同一个上限） */
export const PRESET_PROMPT_MAX = 500;
/** key 的合法字符集与长度，与后端 dramaPresetKeyPattern 一致 */
const KEY_PATTERN = /^[a-z0-9_]{1,32}$/;

/** 「自定义画风」的哨兵值，预设里不能出现 */
const RESERVED_KEY = "custom";

/** 名称按字符数（不是字节数）计，中文与英文一样长 */
export const charCount = (text: string) => [...text].length;

/** 预设种类的中文名 */
export const KIND_LABEL: Record<DramaPresetKind, string> = {
  genre: "题材",
  style: "画风",
};

/** 新建 / 编辑弹窗的表单状态 */
export interface PresetForm {
  key: string;
  name: string;
  prompt: string;
  previewUrl: string;
  enabled: boolean;
}

/** 从列表项回填表单 */
export const formFromItem = (item: DramaPresetAdminItem): PresetForm => ({
  key: item.key,
  name: item.name,
  prompt: item.prompt,
  previewUrl: item.preview_url,
  enabled: item.enabled,
});

/** 新建时的空表单（默认启用：新加的条目通常希望立即可选） */
export const emptyPresetForm = (): PresetForm => ({
  key: "",
  name: "",
  prompt: "",
  previewUrl: "",
  enabled: true,
});

/** 字段错误：键是字段名，值是给用户看的说明 */
export type PresetFormErrors = Partial<Record<"key" | "name" | "prompt" | "previewUrl", string>>;

/**
 * 按和后端相同的规则校验表单，返回的错误显示在对应字段下面。
 * @param form 表单值
 * @param kind 题材 / 画风（题材没有描述与预览图）
 * @param editing 是否在编辑已有条目（key 只读，不再校验）
 */
export const validatePresetForm = (
  form: PresetForm,
  kind: DramaPresetKind,
  editing: boolean,
): PresetFormErrors => {
  const errors: PresetFormErrors = {};

  if (!editing) {
    const key = form.key.trim();
    if (!KEY_PATTERN.test(key)) {
      errors.key = "只能用小写字母、数字和下划线，1–32 位";
    } else if (key === RESERVED_KEY) {
      errors.key = "custom 是自定义画风的保留值，换一个";
    }
  }

  const name = form.name.trim();
  if (charCount(name) < 1 || charCount(name) > PRESET_NAME_MAX) {
    errors.name = `名称需要 1–${PRESET_NAME_MAX} 个字`;
  }

  if (kind === "style") {
    if (charCount(form.prompt.trim()) > PRESET_PROMPT_MAX) {
      errors.prompt = `画风描述最多 ${PRESET_PROMPT_MAX} 个字`;
    }
    const url = form.previewUrl.trim();
    if (url && !/^(\/|https?:\/\/)/.test(url)) {
      errors.previewUrl = "预览图地址必须是站内路径或 http(s) 地址";
    }
  }

  return errors;
};

/**
 * 预览图文件的本地校验：类型与大小在提交前先拦一道，免得白等一次上传。
 * 后端还会按 magic bytes 复核，这里的类型判断只用于即时提示。
 */
export const validatePreviewFile = (file: File): string | null => {
  const allowed = ["image/webp", "image/png", "image/jpeg"];
  if (!allowed.includes(file.type)) return "只支持 WebP / PNG / JPEG";
  if (file.size > 2 * 1024 * 1024) return "图片不能超过 2MB";
  return null;
};
