package model

// 预设种类：开拍设置里的题材与画风共用一张表，靠 Kind 区分。
const (
	DramaPresetKindGenre = "genre"
	DramaPresetKindStyle = "style"
)

// DramaPreset 是开拍设置的预设条目：题材（genre）只有 key + 名称，画风（style）另有正向描述与预览图。
//
// 这张表是预设目录的单一事实源。迁移前目录硬编码在 internal/drama/styles.json，
// 迁移后该文件只作为种子来源与空表兜底（见 docs/design/短剧预设后台/短剧预设后台.md）。
type DramaPreset struct {
	BaseModel
	// Kind 预设种类：genre / style，在同一事务里重排与唯一约束都按它分组
	Kind string `gorm:"size:8;not null;uniqueIndex:uk_drama_presets_kind_key,priority:1;index:idx_drama_presets_kind_order,priority:1" json:"kind"`
	// Key 预设标识，创建后不可改：drama_projects.style_key / genre 存的就是它，且没有外键
	Key string `gorm:"size:32;not null;uniqueIndex:uk_drama_presets_kind_key,priority:2" json:"key"`
	// Name 展示名称
	Name string `gorm:"size:64;not null" json:"name"`
	// Prompt 画风的正向视觉描述，会注入各步骤提示词的 style 变量；题材恒为空串
	Prompt string `gorm:"type:text;not null;default:''" json:"prompt"`
	// PreviewURL 预览图地址：内置条目是前端静态相对路径，后台上传的是公开预览路由地址
	PreviewURL string `gorm:"column:preview_url;size:1024;not null;default:''" json:"preview_url"`
	// PreviewKey 预览图在平台存储里的对象 key；内置条目为空串（图在前端发布包里）
	PreviewKey string `gorm:"column:preview_key;size:512;not null;default:'';index:idx_drama_presets_preview_key" json:"-"`
	// PreviewStorageID 预览图所在存储的 id；0 表示不在平台存储
	PreviewStorageID uint64 `gorm:"column:preview_storage_id;not null;default:0" json:"-"`
	// SortOrder 排序，越小越靠前
	SortOrder int `gorm:"not null;default:0;index:idx_drama_presets_kind_order,priority:2" json:"sort_order"`
	// Enabled 是否出现在开拍设置里；停用不影响已有短剧继续使用该 key
	Enabled bool `gorm:"not null" json:"enabled"`
	// IsBuiltin 是否随迁移种入，仅用于后台展示来源，不参与运行时判断
	IsBuiltin bool `gorm:"not null;default:false" json:"is_builtin"`
}

// TableName 返回表名。
func (DramaPreset) TableName() string { return "drama_presets" }

// DramaPresetAdminItem 是后台列表的一行：表字段 + 有多少部短剧正在用它。
//
// ProjectCount 只对删除有意义（后台据此把「删除」变成「只能停用」的提示），
// 但它同时是运营最关心的信息：一条没人用的画风通常可以直接删掉。
type DramaPresetAdminItem struct {
	ID           uint64 `json:"id"`
	Kind         string `json:"kind"`
	Key          string `json:"key"`
	Name         string `json:"name"`
	Prompt       string `json:"prompt"`
	PreviewURL   string `json:"preview_url"`
	SortOrder    int    `json:"sort_order"`
	Enabled      bool   `json:"enabled"`
	IsBuiltin    bool   `json:"is_builtin"`
	ProjectCount int64  `json:"project_count"`
}

// DramaPresetsAdminView 是后台某个种类的完整列表（含停用），按 sort_order 升序。
type DramaPresetsAdminView struct {
	Items []DramaPresetAdminItem `json:"items"`
}

// SaveDramaPresetReq 是后台新建预设的请求。kind / key 只在新建时有意义：
// key 创建后不可改（drama_projects 里存的是它，且没有外键），kind 同理。
type SaveDramaPresetReq struct {
	Kind    string  `json:"kind" binding:"required,oneof=genre style"`
	Key     string  `json:"key" binding:"required,max=32"`
	Name    string  `json:"name" binding:"required,max=64"`
	Prompt  *string `json:"prompt"`      // 画风专有；题材传了会被拒绝
	Preview *string `json:"preview_url"` // 画风专有；不传则为空（前端显示占位）
	Enabled *bool   `json:"enabled"`     // 不传默认启用
}

// UpdateDramaPresetReq 是后台修改预设的请求：只改出现的字段，key / kind 一律不接受。
// 排序不在这里改（走 /order 整组提交），避免弹窗顺手把顺序改乱。
type UpdateDramaPresetReq struct {
	Name    *string `json:"name"`
	Prompt  *string `json:"prompt"`
	Preview *string `json:"preview_url"`
}

// SetDramaPresetEnabledReq 是后台启停预设的请求。
type SetDramaPresetEnabledReq struct {
	Enabled *bool `json:"enabled" binding:"required"`
}

// ReorderDramaPresetsReq 是后台重排预设的请求：ids 必须恰好是该种类现有全部条目各一次。
type ReorderDramaPresetsReq struct {
	Kind string   `json:"kind" binding:"required,oneof=genre style"`
	IDs  []uint64 `json:"ids" binding:"required"`
}
