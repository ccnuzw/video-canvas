package model

import (
	"time"

	"gorm.io/datatypes"
)

// DramaScriptCharacter 是一部短剧的剧本人物表：剧本角色行引用它的 ID，改名一处生效。
// 名字（含别名）在同一短剧内忽略大小写唯一，由服务层在项目行锁内保证，库里不建函数索引。
type DramaScriptCharacter struct {
	ID           uint64                      `gorm:"primaryKey"`
	UserID       uint64                      `gorm:"not null;index:idx_drama_script_character_drama,priority:2"`
	DramaID      uint64                      `gorm:"not null;index:idx_drama_script_character_drama,priority:1"`
	Name         string                      `gorm:"size:64;not null"`
	Aliases      datatypes.JSONSlice[string] `gorm:"type:jsonb;not null;default:'[]'"`
	Note         string                      `gorm:"type:text;not null;default:''"`
	CanvasNodeID string                      `gorm:"size:64;not null;default:''"`
	Confirmed    bool                        `gorm:"not null;default:false"`
	Position     int                         `gorm:"not null;default:0"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// TableName 返回人物表表名。
func (DramaScriptCharacter) TableName() string { return "drama_script_characters" }

// DramaScriptLocation 是剧本地点表，规则同人物表。
type DramaScriptLocation struct {
	ID           uint64                      `gorm:"primaryKey"`
	UserID       uint64                      `gorm:"not null;index:idx_drama_script_location_drama,priority:2"`
	DramaID      uint64                      `gorm:"not null;index:idx_drama_script_location_drama,priority:1"`
	Name         string                      `gorm:"size:64;not null"`
	Aliases      datatypes.JSONSlice[string] `gorm:"type:jsonb;not null;default:'[]'"`
	Note         string                      `gorm:"type:text;not null;default:''"`
	CanvasNodeID string                      `gorm:"size:64;not null;default:''"`
	Confirmed    bool                        `gorm:"not null;default:false"`
	Position     int                         `gorm:"not null;default:0"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// TableName 返回地点表表名。
func (DramaScriptLocation) TableName() string { return "drama_script_locations" }

// DramaScene 是一集里的一场；场号由 Position 推出，不单独存。
type DramaScene struct {
	ID                uint64                      `gorm:"primaryKey"`
	UserID            uint64                      `gorm:"not null;index"`
	DramaID           uint64                      `gorm:"not null"`
	EpisodeID         uint64                      `gorm:"not null;index:idx_drama_scene_episode,priority:1"`
	Position          int                         `gorm:"not null;index:idx_drama_scene_episode,priority:2"`
	IntExt            string                      `gorm:"size:24;not null;default:''"`
	TimeLabel         string                      `gorm:"size:16;not null;default:''"`
	LocationID        uint64                      `gorm:"not null;default:0"`
	Title             string                      `gorm:"size:255;not null;default:''"`
	Summary           string                      `gorm:"type:text;not null;default:''"`
	Emotions          datatypes.JSONSlice[string] `gorm:"type:jsonb;not null;default:'[]'"`
	ExtraCharacterIDs datatypes.JSONSlice[uint64] `gorm:"type:jsonb;not null;default:'[]'"`
	Props             datatypes.JSONSlice[string] `gorm:"type:jsonb;not null;default:'[]'"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// TableName 返回场次表表名。
func (DramaScene) TableName() string { return "drama_scenes" }

// DramaScriptElement 是场内的一行：动作、角色、括号、对白、转场、字幕、空镜、闪回标记或备注。
type DramaScriptElement struct {
	ID          uint64 `gorm:"primaryKey"`
	UserID      uint64 `gorm:"not null;index"`
	DramaID     uint64 `gorm:"not null;index:idx_drama_element_character,priority:1"`
	EpisodeID   uint64 `gorm:"not null"`
	SceneID     uint64 `gorm:"not null;index:idx_drama_element_scene,priority:1"`
	Position    int    `gorm:"not null;index:idx_drama_element_scene,priority:2"`
	Type        string `gorm:"size:24;not null"`
	Text        string `gorm:"type:text;not null;default:''"`
	CharacterID uint64 `gorm:"not null;default:0;index:idx_drama_element_character,priority:2"`
	Extension   string `gorm:"size:8;not null;default:''"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// TableName 返回元素表表名。
func (DramaScriptElement) TableName() string { return "drama_script_elements" }

// DramaSceneRows 是一场及其全部元素，仓储整集读写的单位。
type DramaSceneRows struct {
	Scene    DramaScene
	Elements []DramaScriptElement
}

// DramaScriptUsage 是人物或地点在某一集的出现次数（人物：角色行条数；地点：场次数）。
type DramaScriptUsage struct {
	ID        uint64
	EpisodeNo int
	Count     int
}
