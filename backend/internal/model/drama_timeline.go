package model

import "gorm.io/datatypes"

// 时间线段的来源种类与素材种类。
const (
	TimelineKindSegment = "segment" // 分镜片段的某条视频结果
	TimelineKindAsset   = "asset"   // 画布素材或本地导入的素材
	TimelineKindText    = "text"    // 字幕轨上的文字段
	TimelineMediaVideo  = "video"
	TimelineMediaImage  = "image"
	TimelineMediaAudio  = "audio"
)

// 时间线轨道种类与音频轨用途。
const (
	TimelineTrackMain    = "main"    // 主轨：首尾相接，对账只作用于它
	TimelineTrackOverlay = "overlay" // 叠加画面
	TimelineTrackAudio   = "audio"   // 配音 / BGM / 音效
	TimelineTrackText    = "text"    // 字幕
	TimelineRoleVoice    = "voice"
	TimelineRoleMusic    = "music"
	TimelineRoleSfx      = "sfx"
)

// 时间线变更种类：对账时片场改动给时间线带来的变化。
const (
	TimelineChangeRemoved   = "removed"   // 片段被删除，段已移除
	TimelineChangeUnadopted = "unadopted" // 片段取消了采用，段变成待采用占位
	TimelineChangeSwapped   = "swapped"   // 片段换了采用版本，段跟着换
	TimelineChangeAdopted   = "adopted"   // 待采用的片段采用了，占位变成视频
	TimelineChangeAdded     = "added"     // 新增片段，已插入时间线
)

// DramaEpisodeTimeline 一集的粗剪剪辑清单（多轨）；不存在时由片段现算默认时间线，第一次保存才落库。
type DramaEpisodeTimeline struct {
	BaseModel
	UserID    uint64 `gorm:"not null;index"`
	EpisodeID uint64 `gorm:"not null;uniqueIndex:uk_drama_episode_timeline"`
	// Tracks 是 []drama.Track，显示顺序为 字幕 → 叠加 → 主轨 → 音频；主轨的段按播放顺序首尾相接
	Tracks datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	// RemovedSegmentIDs 用户主动从轨上删掉的片段（[]uint64），对账不自动加回
	RemovedSegmentIDs datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	// Imports 「已导入」里的素材（[]uint64）
	Imports  datatypes.JSON `gorm:"type:jsonb;not null;default:'[]'"`
	Revision int64          `gorm:"not null;default:1"`
}

// TableName 返回时间线表名。
func (DramaEpisodeTimeline) TableName() string { return "drama_episode_timelines" }
