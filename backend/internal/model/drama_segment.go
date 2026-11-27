package model

import (
	"time"

	"gorm.io/datatypes"

	"video-canvas/internal/pkg/idcodec" //nolint:depguard // 对外 ID 与短剧项目沿用十六进制契约
)

// DramaSegment 单集内可独立生成的片段，任务和素材保留各自的生命周期。
type DramaSegment struct {
	BaseModel
	UserID       uint64 `gorm:"not null;index"`
	EpisodeID    uint64 `gorm:"not null;index:idx_drama_segment_episode_seq,priority:1"`
	Seq          int    `gorm:"not null;default:0;index:idx_drama_segment_episode_seq,priority:2"`
	Seconds      int    `gorm:"not null;default:5"`
	Prompt       string `gorm:"type:text;not null;default:''"`
	ChosenTaskID *uint64
	// Adaptations 按格式（h3 / generic）存原稿的转写稿，值为 DramaSegmentAdaptation；原稿就是 Seedance，不存 seedance 键
	Adaptations datatypes.JSON `gorm:"type:jsonb;not null;default:'{}'"`
	Revision    int64          `gorm:"not null;default:1"`
}

// DramaSegmentAdaptation 是一份转写稿；SourceHash 是转写时原稿的 SHA-256，与当前原稿不同即已过期。
type DramaSegmentAdaptation struct {
	Prompt     string    `json:"prompt"`
	SourceHash string    `json:"source_hash"`
	Edited     bool      `json:"edited"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// TableName 返回片段表名。
func (DramaSegment) TableName() string { return "drama_segments" }

// DramaSegmentTakeView 从生成任务读取的结果，不复制保存任务状态。
type DramaSegmentTakeView struct {
	TaskID       idcodec.ID `json:"task_id"`
	Status       string     `json:"status"`
	Asset        *AssetView `json:"asset"`
	ErrorMessage string     `json:"error_message"`
	CreatedAt    time.Time  `json:"created_at"`
}

// DramaSegmentView 是片段工作区和 WebSocket 共用视图。
type DramaSegmentView struct {
	ID           idcodec.ID                        `json:"id"`
	EpisodeNo    int                               `json:"episode_no"`
	Seq          int                               `json:"seq"`
	Seconds      int                               `json:"seconds"`
	Prompt       string                            `json:"prompt"`
	Adaptations  map[string]DramaSegmentAdaptation `json:"adaptations"`
	Takes        []DramaSegmentTakeView            `json:"takes"`
	ChosenTaskID string                            `json:"chosen_task_id"`
	Status       string                            `json:"status"`
	Revision     int64                             `json:"revision"`
	UpdatedAt    time.Time                         `json:"updated_at"`
}

// CreateDramaSegmentReq 新增片段，after_seq 未传则追加到末尾。
type CreateDramaSegmentReq struct {
	Prompt   string `json:"prompt"`
	Seconds  *int   `json:"seconds" binding:"omitempty,min=1" label:"片段时长"`
	AfterSeq *int   `json:"after_seq" binding:"omitempty,min=0" label:"插入位置"`
}

// UpdateDramaSegmentReq 带版本部分更新，采用结果必须属于本段且已成功。
type UpdateDramaSegmentReq struct {
	Revision     int64       `json:"revision" binding:"required,min=1" label:"版本"`
	Prompt       *string     `json:"prompt"`
	Seconds      *int        `json:"seconds" binding:"omitempty,min=1" label:"片段时长"`
	ChosenTaskID *idcodec.ID `json:"chosen_task_id"`
	// Adaptation 手改某个格式的转写稿；该格式必须已经转写过
	Adaptation *DramaSegmentAdaptationEdit `json:"adaptation"`
}

// DramaSegmentAdaptationEdit 是对一份转写稿的手改。
type DramaSegmentAdaptationEdit struct {
	Format string `json:"format" binding:"required,oneof=h3 generic" label:"转写格式"`
	Prompt string `json:"prompt"`
}

// AdaptDramaSegmentReq 把片段原稿转写成目标格式；revision 用来确认转写的是用户眼前这一版。
type AdaptDramaSegmentReq struct {
	Format   string `json:"format" binding:"required,oneof=h3 generic" label:"转写格式"`
	Revision int64  `json:"revision" binding:"required,min=1" label:"版本"`
}

// OrderDramaSegmentsReq 必须包含该集完整且不重复的片段集合。
type OrderDramaSegmentsReq struct {
	IDs []idcodec.ID `json:"ids" binding:"required" label:"片段列表"`
}

// GenerateDramaSegmentReq 复用生成任务的输入结构，种类、画布与节点由服务指定。
type GenerateDramaSegmentReq struct {
	ModelID string         `json:"model_id" binding:"required,max=128" label:"模型"`
	Input   map[string]any `json:"input" binding:"required" label:"生成参数"`
}

// GenerateDramaBoardReq 片场生成故事板：前端按片段原稿和项目设置拼好的节点内容与任务输入，
// 后端写短剧画布上的故事板节点并绑定任务（种类固定图片，画布与节点由服务指定）。
type GenerateDramaBoardReq struct {
	ModelID    string         `json:"model_id" binding:"required,max=128" label:"模型"`
	Input      map[string]any `json:"input" binding:"required" label:"生成参数"`
	Prompt     string         `json:"prompt" binding:"required,max=40000" label:"提示词"`
	Params     map[string]any `json:"params" label:"节点参数"`
	Label      string         `json:"label" binding:"max=255" label:"标题"`
	SourceHash string         `json:"source_hash" binding:"required,max=128" label:"原稿哈希"`
	Layout     string         `json:"layout" binding:"required,oneof=2x2 3x2 3x3" label:"宫格"`
	ShotCount  int            `json:"shot_count" binding:"min=0,max=200" label:"镜头数"`
	Refs       []string       `json:"refs" binding:"max=30,dive,max=128" label:"参考资产"`
}

// SelectDramaBoardOutputReq 切换故事板的当前版本：OutputID 是故事板节点历史里的某一版（素材 id）。
type SelectDramaBoardOutputReq struct {
	OutputID string `json:"output_id" binding:"required,max=64" label:"版本"`
}

// DramaSegmentStats 是某集片段的实时聚合。
type DramaSegmentStats struct {
	Count   int
	Seconds int
	// Done 有采用视频的片段数
	Done int
	// Boards 有故事板且没过期的片段数（故事板是短剧画布上的图片节点，见 DramaBoardHashes）
	Boards int
}

// ---- 成片粗剪时间线的对外视图与请求（表结构见 drama_timeline.go） ----

// DramaTimelineClip 时间线上的一段；时长 = out_ms - in_ms：视频、音频的 in/out 是素材内的位置，图片和文字 in 恒为 0。
// 数字字段（start_ms、volume、淡变、叠加参数、size）始终序列化，没有用到的为 0，前端按所在轨的种类取用。
type DramaTimelineClip struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// SegmentID / TaskID / Pinned 只用于 kind=segment；主轨 TaskID 为 0 表示片段还没有采用（待采用占位），附属轨必须有 TaskID
	SegmentID idcodec.ID `json:"segment_id,omitempty"`
	TaskID    idcodec.ID `json:"task_id,omitempty"`
	// Pinned 用户在时间线里手动选了版本，不再跟随片段的采用；附属轨上的版本恒为固定
	Pinned bool `json:"pinned"`
	// AssetID / Media 只用于 kind=asset；素材 ID 和素材接口、画布节点一致，是原始数字（不编码）
	AssetID uint64 `json:"asset_id,omitempty"`
	Media   string `json:"media,omitempty"`
	InMS    int64  `json:"in_ms"`
	OutMS   int64  `json:"out_ms"`
	// StartMS 在时间线上的起点；主轨不存（恒为 0），按顺序首尾相接
	StartMS int64 `json:"start_ms"`
	Muted   bool  `json:"muted"`
	// Volume 音量百分比 0–200，0 即静音
	Volume    int   `json:"volume"`
	FadeInMS  int64 `json:"fade_in_ms"`
	FadeOutMS int64 `json:"fade_out_ms"`
	// X/Y/Scale/Opacity 只用于叠加轨：中心点位置（画面宽高的百分比）、占画面宽度的百分比、不透明度
	X       int `json:"x"`
	Y       int `json:"y"`
	Scale   int `json:"scale"`
	Opacity int `json:"opacity"`
	// Text/Style/Pos/Size 只用于 kind=text：文字、样式（subtitle/title）、位置（top/middle/bottom）、字号百分比
	Text  string `json:"text,omitempty"`
	Style string `json:"style,omitempty"`
	Pos   string `json:"pos,omitempty"`
	Size  int    `json:"size"`
}

// DramaTimelineTrack 时间线上的一条轨；显示顺序为 字幕 → 叠加 → 主轨 → 音频。
type DramaTimelineTrack struct {
	ID   string `json:"id" binding:"max=64" label:"轨道 ID"`
	Kind string `json:"kind"`
	// Role 只有音频轨有：voice / music / sfx，缺省按 sfx
	Role   string              `json:"role,omitempty"`
	Name   string              `json:"name" binding:"max=60" label:"轨道名"`
	Muted  bool                `json:"muted"`
	Hidden bool                `json:"hidden"`
	Locked bool                `json:"locked"`
	Clips  []DramaTimelineClip `json:"clips" binding:"max=200" label:"片段"`
}

// DramaTimelineChange 对账产生的一条变化；ClipID 为空表示对应的段已移除。
type DramaTimelineChange struct {
	Kind      string     `json:"kind"`
	SegmentID idcodec.ID `json:"segment_id"`
	Seq       int        `json:"seq"`
	ClipID    string     `json:"clip_id"`
}

// DramaTimelineView 是对账后的时间线；Revision 为 0 表示还没保存过（默认时间线）。
type DramaTimelineView struct {
	Tracks            []DramaTimelineTrack  `json:"tracks"`
	RemovedSegmentIDs []idcodec.ID          `json:"removed_segment_ids"`
	Imports           []uint64              `json:"imports"` // 「已导入」的素材，原始数字 ID
	Revision          int64                 `json:"revision"`
	Changes           []DramaTimelineChange `json:"changes"`
	// InvalidClipIDs 所有轨上固定的版本或素材已不可用的段，合成前必须处理
	InvalidClipIDs []string `json:"invalid_clip_ids"`
	// Assets 所有轨的素材段和「已导入」引用到的素材视图（只含当前用户仍可读的，可含音频）
	Assets []AssetView `json:"assets"`
}

// SaveDramaTimelineReq 带版本保存整份时间线；revision 为 0 表示第一次保存。
type SaveDramaTimelineReq struct {
	Revision          int64                `json:"revision" binding:"min=0" label:"版本"`
	Tracks            []DramaTimelineTrack `json:"tracks" binding:"max=15,dive" label:"轨道"`
	RemovedSegmentIDs []idcodec.ID         `json:"removed_segment_ids" binding:"max=500" label:"已删除片段"`
	Imports           []uint64             `json:"imports" binding:"max=200" label:"已导入素材"` // 原始数字 ID
}
