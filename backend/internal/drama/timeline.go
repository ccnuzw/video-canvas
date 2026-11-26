package drama

import (
	"slices"
)

// 时间线段的来源、素材种类与对账变化种类；取值与 model 里的同名常量一致。
const (
	ClipSegment = "segment"
	ClipAsset   = "asset"
	ClipText    = "text" // 字幕轨上的文字段
	MediaVideo  = "video"
	MediaImage  = "image"
	MediaAudio  = "audio"

	ChangeRemoved   = "removed"
	ChangeUnadopted = "unadopted"
	ChangeSwapped   = "swapped"
	ChangeAdopted   = "adopted"
	ChangeAdded     = "added"
)

// 时间线的长度约束，前端编辑时用同样的数字。
const (
	MinClipMS       = 500            // 每段至少 0.5 秒
	MaxImageMS      = 30_000         // 图片最长 30 秒
	MaxTimelineMS   = 30 * 60 * 1000 // 整条时间线最长 30 分钟
	durationSlackMS = 100            // 素材时长与前端读到的时长允许的误差
)

// TimelineClip 时间线上的一段；视频的 in/out 是素材内的毫秒位置，图片 in 恒为 0、out 即时长。
// 落库时直接序列化本结构，ID 用原始数字，不受对外 ID 编码密钥影响。
type TimelineClip struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	SegmentID uint64 `json:"segment_id,omitempty"`
	// TaskID 为 0 表示片段还没有采用（待采用占位，合成时跳过）
	TaskID uint64 `json:"task_id,omitempty"`
	// Pinned 用户在时间线里手动选了版本，不跟随片段的采用
	Pinned  bool   `json:"pinned,omitempty"`
	AssetID uint64 `json:"asset_id,omitempty"`
	Media   string `json:"media,omitempty"`
	InMS    int64  `json:"in_ms"`
	OutMS   int64  `json:"out_ms"`
	Muted   bool   `json:"muted,omitempty"`
	// StartMS 在时间线上的起点；只有附属轨用，主轨按顺序首尾相接不存
	StartMS int64 `json:"start_ms,omitempty"`
	// Volume 音量百分比 0–200，0 即静音，所以始终序列化
	Volume    int   `json:"volume"`
	FadeInMS  int64 `json:"fade_in_ms,omitempty"`
	FadeOutMS int64 `json:"fade_out_ms,omitempty"`
	// X/Y/Scale/Opacity 叠加画面的位置（中心点百分比）、占画面宽度的百分比和不透明度；只有叠加轨用
	X       int `json:"x,omitempty"`
	Y       int `json:"y,omitempty"`
	Scale   int `json:"scale,omitempty"`
	Opacity int `json:"opacity,omitempty"`
	// Text/Style/Pos/Size 只用于 kind=text
	Text  string `json:"text,omitempty"`
	Style string `json:"style,omitempty"`
	Pos   string `json:"pos,omitempty"`
	Size  int    `json:"size,omitempty"`
}

// TimelineSegment 对账需要的片段信息。
type TimelineSegment struct {
	ID      uint64
	Seq     int
	Seconds int
	// Chosen 采用的任务；0 表示没有采用
	Chosen uint64
	// Takes 成功且有视频素材的任务 → 视频时长毫秒（0 表示未知，按片段秒数估）
	Takes map[uint64]int64
}

// TimelineChange 对账带来的一条变化；ClipID 为空表示段已移除。
type TimelineChange struct {
	Kind      string
	SegmentID uint64
	Seq       int
	ClipID    string
}

// TimelineAsset 素材段校验需要的素材信息。
type TimelineAsset struct {
	Media      string
	DurationMS int64
}

// takeDuration 返回某条结果的时长；未知时按片段秒数估，避免把段裁成 0。
func (s TimelineSegment) takeDuration(task uint64) int64 {
	if d := s.Takes[task]; d > 0 {
		return d
	}
	return int64(s.Seconds) * 1000
}

// chosenOK 采用的任务仍然成功且有视频。
func (s TimelineSegment) chosenOK() bool {
	_, ok := s.Takes[s.Chosen]
	return s.Chosen != 0 && ok
}

// newSegmentClip 片段的全长跟随段；没有采用就是按片段秒数占位的段。
func newSegmentClip(id string, s TimelineSegment) TimelineClip {
	c := TimelineClip{ID: id, Kind: ClipSegment, SegmentID: s.ID, Volume: defaultVolume}
	if s.chosenOK() {
		c.TaskID, c.OutMS = s.Chosen, s.takeDuration(s.Chosen)
	} else {
		c.OutMS = int64(s.Seconds) * 1000
	}
	return c
}

// defaultMainClips 从没剪过的集的主轨：全部片段按序号排、全长、跟随采用，合成结果与按片段拼接一致。
func defaultMainClips(segs []TimelineSegment, newID func() string) []TimelineClip {
	sorted := slices.Clone(segs)
	slices.SortStableFunc(sorted, func(a, b TimelineSegment) int { return a.Seq - b.Seq })
	out := make([]TimelineClip, 0, len(sorted))
	for _, s := range sorted {
		out = append(out, newSegmentClip(newID(), s))
	}
	return out
}

// ReconcileClips 让主轨跟上片场：删掉的片段移除、跟随段换成新的采用、新片段插进去；
// 固定版本的段和用户删过的片段不动。不修改传入的切片。
func ReconcileClips(clips []TimelineClip, removed []uint64, segs []TimelineSegment, newID func() string) ([]TimelineClip, []uint64, []TimelineChange) {
	byID := make(map[uint64]TimelineSegment, len(segs))
	for _, s := range segs {
		byID[s.ID] = s
	}
	out := make([]TimelineClip, 0, len(clips)+len(segs))
	var changes []TimelineChange
	seen := map[uint64]bool{} // 一个片段拆成多段时只报一次变化
	note := func(kind string, sid uint64, seq int, clip string) {
		if !seen[sid] {
			seen[sid] = true
			changes = append(changes, TimelineChange{Kind: kind, SegmentID: sid, Seq: seq, ClipID: clip})
		}
	}
	for _, c := range clips {
		if c.Kind != ClipSegment {
			out = append(out, c)
			continue
		}
		s, ok := byID[c.SegmentID]
		if !ok {
			note(ChangeRemoved, c.SegmentID, removedSeq(clips, c.SegmentID), "")
			continue
		}
		if kind := followSegment(&c, s); kind != "" {
			note(kind, s.ID, s.Seq, c.ID)
		}
		out = append(out, c)
	}
	out, changes = insertNewSegments(out, removed, segs, byID, newID, changes)
	kept := make([]uint64, 0, len(removed))
	for _, id := range removed {
		if _, ok := byID[id]; ok {
			kept = append(kept, id)
		}
	}
	if len(kept) == 0 {
		kept = nil
	}
	return out, kept, changes
}

// removedSeq 片段被删后已没有序号，用它在原时间线里是第几个片段来近似，供界面写「片段 NN 已删除」。
func removedSeq(clips []TimelineClip, sid uint64) int {
	n := 0
	seen := map[uint64]bool{}
	for _, c := range clips {
		if c.Kind != ClipSegment {
			continue
		}
		if c.SegmentID == sid {
			return n
		}
		if !seen[c.SegmentID] {
			seen[c.SegmentID] = true
			n++
		}
	}
	return n
}

// followSegment 把跟随段对齐到片段当前的采用，返回变化种类；固定段和没变化返回空串。
func followSegment(c *TimelineClip, s TimelineSegment) string {
	if c.Pinned {
		return ""
	}
	if !s.chosenOK() {
		if c.TaskID == 0 {
			c.InMS, c.OutMS = 0, int64(s.Seconds)*1000 // 占位跟着片段秒数走，不算变化
			return ""
		}
		c.TaskID, c.InMS, c.OutMS = 0, 0, int64(s.Seconds)*1000
		return ChangeUnadopted
	}
	if s.Chosen == c.TaskID {
		return ""
	}
	dur := s.takeDuration(s.Chosen)
	kind := ChangeSwapped
	if c.TaskID == 0 {
		c.InMS, c.OutMS = 0, dur
		kind = ChangeAdopted
	} else {
		clampTrim(c, dur)
	}
	c.TaskID = s.Chosen
	return kind
}

// clampTrim 换素材后保留入出点，超出新长度就收回；入点也越界就恢复全长。
func clampTrim(c *TimelineClip, dur int64) {
	c.OutMS = min(c.OutMS, dur)
	if c.InMS > c.OutMS-MinClipMS {
		c.InMS, c.OutMS = 0, dur
	}
}

// insertNewSegments 把时间线上没有、也不在删除名单里的片段插到「最后一个序号比它小的片段段」之后，没有就放最前。
func insertNewSegments(out []TimelineClip, removed []uint64, segs []TimelineSegment, byID map[uint64]TimelineSegment, newID func() string, changes []TimelineChange) ([]TimelineClip, []TimelineChange) {
	sorted := slices.Clone(segs)
	slices.SortStableFunc(sorted, func(a, b TimelineSegment) int { return a.Seq - b.Seq })
	for _, s := range sorted {
		if slices.Contains(removed, s.ID) || slices.ContainsFunc(out, func(c TimelineClip) bool { return c.Kind == ClipSegment && c.SegmentID == s.ID }) {
			continue
		}
		at := 0
		for i, c := range out {
			if c.Kind == ClipSegment && byID[c.SegmentID].Seq < s.Seq {
				at = i + 1
			}
		}
		clip := newSegmentClip(newID(), s)
		out = slices.Insert(out, at, clip)
		changes = append(changes, TimelineChange{Kind: ChangeAdded, SegmentID: s.ID, Seq: s.Seq, ClipID: clip.ID})
	}
	return out, changes
}

// brokenClips 返回一条轨上素材已不可用的段：固定的版本不再成功、素材被删或种类不符。待采用占位不算。
func brokenClips(clips []TimelineClip, byID map[uint64]TimelineSegment, assets map[uint64]TimelineAsset) []string {
	var out []string
	for _, c := range clips {
		switch c.Kind {
		case ClipSegment:
			if c.TaskID == 0 {
				continue
			}
			if _, ok := byID[c.SegmentID].Takes[c.TaskID]; !ok {
				out = append(out, c.ID)
			}
		case ClipAsset:
			if a, ok := assets[c.AssetID]; !ok || a.Media != c.Media {
				out = append(out, c.ID)
			}
		}
	}
	return out
}
