package drama

import (
	"slices"
	"strings"
)

// 轨道种类与音频轨的用途；取值与前端、model 里的同名常量一致。
const (
	TrackMain    = "main"    // 主轨：磁吸、首尾相接，对账只作用于它
	TrackOverlay = "overlay" // 叠加画面：上层盖住下层
	TrackAudio   = "audio"   // 配音 / BGM / 音效
	TrackText    = "text"    // 字幕

	RoleVoice = "voice"
	RoleMusic = "music"
	RoleSfx   = "sfx"

	TextSubtitle = "subtitle"
	TextTitle    = "title"
	PosTop       = "top"
	PosMiddle    = "middle"
	PosBottom    = "bottom"
)

// 多轨的数量与取值约束，前端编辑时用同样的数字。
const (
	MaxOverlayTracks  = 4
	MaxTextTracks     = 4
	MaxAudioTracks    = 6
	MaxClipsPerTrack  = 200
	MaxClipsTotal     = 400
	MaxTrackNameRunes = 20
	MaxTrackIDLen     = 32
	MaxTextRunes      = 200
	MaxVolume         = 200
	MinOverlayScale   = 10
	MinTextSize       = 60
	MaxTextSize       = 180

	defaultVolume = 100
)

// 默认时间线里固定的轨 ID。
const (
	trackTextID    = "text1"
	trackOverlayID = "overlay1"
	trackVoiceID   = "voice1"
	trackMusicID   = "music1"
)

// Track 时间线上的一条轨；同一条轨上的片段按所属种类放置，落库时直接序列化本结构。
type Track struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Role 只有音频轨有，缺省按音效处理
	Role   string         `json:"role,omitempty"`
	Name   string         `json:"name"`
	Muted  bool           `json:"muted,omitempty"`
	Hidden bool           `json:"hidden,omitempty"`
	Locked bool           `json:"locked,omitempty"`
	Clips  []TimelineClip `json:"clips"`
}

// trackName 没起名字时按种类给默认名。
func trackName(kind string) string {
	switch kind {
	case TrackMain:
		return "主轨"
	case TrackOverlay:
		return "叠加"
	case TrackAudio:
		return "音频"
	case TrackText:
		return "字幕"
	}
	return ""
}

// DefaultTimeline 从没剪过的集：字幕、叠加、主轨（全部片段按序号排、全长、跟随采用，合成结果与按片段拼接一致）、配音、BGM。
func DefaultTimeline(segs []TimelineSegment, newID func() string) []Track {
	empty := func() []TimelineClip { return []TimelineClip{} }
	return []Track{
		{ID: trackTextID, Kind: TrackText, Name: "字幕", Clips: empty()},
		{ID: trackOverlayID, Kind: TrackOverlay, Name: "叠加", Clips: empty()},
		{ID: TrackMain, Kind: TrackMain, Name: "主轨", Clips: defaultMainClips(segs, newID)},
		{ID: trackVoiceID, Kind: TrackAudio, Role: RoleVoice, Name: "配音", Clips: empty()},
		{ID: trackMusicID, Kind: TrackAudio, Role: RoleMusic, Name: "BGM", Clips: empty()},
	}
}

// MainTrack 返回主轨的下标；没有返回 -1。
func MainTrack(tracks []Track) int {
	return slices.IndexFunc(tracks, func(t Track) bool { return t.Kind == TrackMain })
}

// ReconcileTimeline 让主轨跟上片场，其他轨原样透传；缺主轨时补一条（排在字幕、叠加之后）。
// 不修改传入的轨道。
func ReconcileTimeline(tracks []Track, removed []uint64, segs []TimelineSegment, newID func() string) ([]Track, []uint64, []TimelineChange) {
	out := slices.Clone(tracks)
	at := MainTrack(out)
	if at < 0 {
		at = 0
		for at < len(out) && (out[at].Kind == TrackText || out[at].Kind == TrackOverlay) {
			at++
		}
		out = slices.Insert(out, at, Track{ID: TrackMain, Kind: TrackMain, Name: "主轨"})
	}
	clips, kept, changes := ReconcileClips(out[at].Clips, removed, segs, newID)
	out[at].Clips = clips
	return out, kept, changes
}

// BrokenClips 返回所有轨上素材已不可用的段：固定的版本不再成功、素材被删或种类不符。待采用占位不算。
func BrokenClips(tracks []Track, segs []TimelineSegment, assets map[uint64]TimelineAsset) []string {
	byID := make(map[uint64]TimelineSegment, len(segs))
	for _, s := range segs {
		byID[s.ID] = s
	}
	var out []string
	for _, tr := range tracks {
		out = append(out, brokenClips(tr.Clips, byID, assets)...)
	}
	return out
}

// NormalizeTracks 保存前把轨道和片段整理成统一形状：补默认名和用途，清掉与所在轨无关的字段。不修改传入的轨道。
func NormalizeTracks(in []Track) []Track {
	out := make([]Track, len(in))
	for i, tr := range in {
		tr.Name = strings.TrimSpace(tr.Name)
		if tr.Name == "" {
			tr.Name = trackName(tr.Kind)
		}
		switch {
		case tr.Kind != TrackAudio:
			tr.Role = ""
		case tr.Role == "":
			tr.Role = RoleSfx
		}
		clips := make([]TimelineClip, len(tr.Clips))
		for j, c := range tr.Clips {
			clips[j] = normalizeClip(tr.Kind, c)
		}
		tr.Clips = clips
		out[i] = tr
	}
	return out
}

// normalizeClip 清掉与轨道、片段种类无关的字段；附属轨上的片段版本一律视为固定。
func normalizeClip(trackKind string, c TimelineClip) TimelineClip {
	if c.Kind == ClipText {
		c.Text = strings.TrimSpace(c.Text)
		c.Volume, c.FadeInMS, c.FadeOutMS = defaultVolume, 0, 0
	} else {
		c.Text, c.Style, c.Pos, c.Size = "", "", "", 0
	}
	if trackKind != TrackOverlay {
		c.X, c.Y, c.Scale, c.Opacity = 0, 0, 0, 0
	}
	if trackKind == TrackMain {
		c.StartMS = 0
	} else if c.Kind == ClipSegment {
		c.Pinned = true
	}
	return c
}
