package model

import "time"

// 运营模板状态；归档是终态。
const (
	DramaPresetEnabled  = "enabled"
	DramaPresetDisabled = "disabled"
	DramaPresetArchived = "archived"
)

// DramaPromptPreset 是按分类维护的运营模板；项目不引用其可变正文。
type DramaPromptPreset struct {
	ID          uint64 `gorm:"primaryKey;uniqueIndex:uq_drama_preset_step_id,priority:2"`
	Step        string `gorm:"size:24;not null;uniqueIndex:uq_drama_preset_step_id,priority:1;uniqueIndex:uq_drama_preset_name,priority:1,where:status <> 'archived'"`
	Name        string `gorm:"size:80;not null;uniqueIndex:uq_drama_preset_name,priority:2,where:status <> 'archived'"`
	Description string `gorm:"size:240;not null;default:''"`
	Body        string `gorm:"type:text;not null"`
	Status      string `gorm:"size:12;not null;check:ck_drama_preset_status,status IN ('enabled','disabled','archived')"`
	Revision    int    `gorm:"not null;default:1"`
	UpdatedBy   uint64 `gorm:"not null;default:0"`
	UpdatedAt   time.Time
}

// TableName 返回运营模板表名。
func (DramaPromptPreset) TableName() string { return "drama_prompt_presets" }

// DramaPromptPresetGroup 每类只有一个默认指针，也是并发写入的锁记录。
type DramaPromptPresetGroup struct {
	Step      string `gorm:"size:24;primaryKey"`
	DefaultID uint64 `gorm:"not null"`
	Revision  int    `gorm:"not null;default:1"`
}

// TableName 返回运营模板分类表名。
func (DramaPromptPresetGroup) TableName() string { return "drama_prompt_preset_groups" }

// DramaPromptPresetRow 是目录查询使用的快照。
type DramaPromptPresetRow struct {
	DramaPromptPreset
	DefaultID     uint64
	GroupRevision int
}

// DramaPromptPresetView 普通目录只包含可选项的元数据。
type DramaPromptPresetView struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Revision    int        `json:"revision"`
	Body        string     `json:"body,omitempty"`
	Status      string     `json:"status,omitempty"`
	UpdatedBy   string     `json:"updated_by,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

// DramaPromptPresetGroupView 一次返回分类默认值与候选模板。
type DramaPromptPresetGroupView struct {
	Step         string                  `json:"step"`
	DefaultID    string                  `json:"default_id"`
	Revision     int                     `json:"revision,omitempty"`
	OriginalBody string                  `json:"original_body,omitempty"`
	Items        []DramaPromptPresetView `json:"items"`
}

// SaveDramaPromptPresetReq 写入正文及描述，不改变启用状态。
type SaveDramaPromptPresetReq struct {
	Name        string `json:"name" binding:"required,max=80" label:"名称"`
	Description string `json:"description" binding:"max=240" label:"用途"`
	Body        string `json:"body" binding:"required,max=20000" label:"正文"`
	Revision    int    `json:"revision" binding:"min=0" label:"版本"`
}

// UpdateDramaPromptPresetStateReq 变更启停、归档或默认状态。
type UpdateDramaPromptPresetStateReq struct {
	Action   string `json:"action" binding:"required,oneof=enable disable archive default" label:"操作"`
	Revision int    `json:"revision" binding:"required,min=1" label:"版本"`
}
