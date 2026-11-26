/** 预设种类：题材与画风共用一张表，靠 kind 区分 */
export type DramaPresetKind = "genre" | "style";

/** 后台看到的一条预设（GET /admin/drama-presets 的 items） */
export interface DramaPresetAdminItem {
  /** 预设 ID */
  id: number;
  /** 题材 / 画风 */
  kind: DramaPresetKind;
  /** 预设标识，创建后不可改：短剧表里存的就是它 */
  key: string;
  /** 展示名称 */
  name: string;
  /** 画风的正向视觉描述，会注入提示词；题材恒为空串 */
  prompt: string;
  /** 预览图地址：内置是静态相对路径，后台上传的是预览路由地址 */
  preview_url: string;
  /** 排序，越小越前 */
  sort_order: number;
  /** 是否出现在开拍设置里 */
  enabled: boolean;
  /** 是否随迁移种入 */
  is_builtin: boolean;
  /** 有多少部短剧正在用它；大于 0 时只能停用不能删 */
  project_count: number;
}

/** 后台某个种类的完整列表（含停用） */
export interface DramaPresetAdminView {
  items: DramaPresetAdminItem[];
}

/** 新建预设的请求体 */
export interface SaveDramaPresetBody {
  kind: DramaPresetKind;
  /** 小写字母、数字、下划线，最长 32 位，创建后不可改 */
  key: string;
  /** 1–64 字 */
  name: string;
  /** 画风描述，最多 500 字；题材不传 */
  prompt?: string;
  /** 预览图地址；题材不传 */
  preview_url?: string;
  /** 不传默认启用 */
  enabled?: boolean;
}

/** 修改预设的请求体：只改出现的字段，key / kind 一律不接受 */
export interface UpdateDramaPresetBody {
  name?: string;
  prompt?: string;
  preview_url?: string;
}
