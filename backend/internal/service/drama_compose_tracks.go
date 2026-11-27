package service

import (
	"context"
	"fmt"
	"path/filepath"

	"video-canvas/internal/drama"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/videoframe"
)

// composeTracks 冻结的附属轨：叠加画面、音频、字幕各按轨道顺序展开成平铺列表，提交后不再受时间线修改影响。
// 隐藏轨、静音轨和音量为 0 的片段在冻结时就已经按预览规则处理掉，渲染时不用再判断。
type composeTracks struct {
	Overlays []composeOverlay `json:"overlays,omitempty"`
	Audios   []composeAudio   `json:"audios,omitempty"`
	Texts    []composeText    `json:"texts,omitempty"`
}

// composeOverlay 冻结的一段叠加画面；Muted 已合并轨道静音。
type composeOverlay struct {
	AssetID   uint64 `json:"asset_id"`
	Media     string `json:"media"`
	StartMS   int64  `json:"start_ms"`
	InMS      int64  `json:"in_ms"`
	OutMS     int64  `json:"out_ms"`
	Muted     bool   `json:"muted,omitempty"`
	Volume    int    `json:"volume"`
	FadeInMS  int64  `json:"fade_in_ms,omitempty"`
	FadeOutMS int64  `json:"fade_out_ms,omitempty"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Scale     int    `json:"scale"`
	Opacity   int    `json:"opacity"`
}

// composeAudio 冻结的一段音频；静音的轨和片段、音量为 0 的片段冻结时已剔除。
type composeAudio struct {
	AssetID   uint64 `json:"asset_id"`
	StartMS   int64  `json:"start_ms"`
	InMS      int64  `json:"in_ms"`
	OutMS     int64  `json:"out_ms"`
	Volume    int    `json:"volume"`
	FadeInMS  int64  `json:"fade_in_ms,omitempty"`
	FadeOutMS int64  `json:"fade_out_ms,omitempty"`
}

// composeText 冻结的一条字幕；隐藏的字幕轨冻结时已剔除。
type composeText struct {
	StartMS int64  `json:"start_ms"`
	LenMS   int64  `json:"len_ms"`
	Text    string `json:"text"`
	Style   string `json:"style"`
	Pos     string `json:"pos"`
	Size    int    `json:"size"`
}

// empty 没有任何附属轨内容。
func (c *composeTracks) empty() bool {
	return c == nil || len(c.Overlays)+len(c.Audios)+len(c.Texts) == 0
}

// freezeTracks 把主轨之外的轨冻结成平铺列表；没有任何内容返回 nil（冻结输入里就不带 tracks，和旧任务结构一致）。
// 叠加轨按「下面的轨先、上面的轨后」排列，渲染时后叠加的盖住先叠加的；轨道里的先后顺序按片段起点。
// taskAsset 是成功结果任务 → 它的视频素材，用来把叠加轨上的片段版本换成具体素材。
func freezeTracks(tracks []drama.Track, taskAsset map[uint64]uint64) *composeTracks {
	out := &composeTracks{}
	// 轨道在时间线里是「上面的轨在前」，叠加要从下往上，所以倒着遍历
	for i := len(tracks) - 1; i >= 0; i-- {
		tr := tracks[i]
		switch {
		case tr.Kind == drama.TrackOverlay && !tr.Hidden:
			out.Overlays = append(out.Overlays, freezeOverlays(tr, taskAsset)...)
		case tr.Kind == drama.TrackAudio && !tr.Muted:
			out.Audios = append(out.Audios, freezeAudios(tr)...)
		case tr.Kind == drama.TrackText && !tr.Hidden:
			out.Texts = append(out.Texts, freezeTexts(tr)...)
		}
	}
	if out.empty() {
		return nil
	}
	return out
}

// freezeOverlays 一条叠加轨：素材（图片、视频）和片段版本（换成那个版本的视频素材）；音量为 0 的视频只出画面。
// 附属轨上的片段版本一定选定了版本（校验保证），找不到素材的已被失效段检查拦下。
func freezeOverlays(tr drama.Track, taskAsset map[uint64]uint64) []composeOverlay {
	var out []composeOverlay
	for _, c := range tr.Clips {
		asset, media := overlaySource(c, taskAsset)
		if asset == 0 {
			continue
		}
		out = append(out, composeOverlay{
			AssetID: asset, Media: media, StartMS: c.StartMS, InMS: c.InMS, OutMS: c.OutMS,
			Muted: tr.Muted || c.Muted || c.Volume == 0, Volume: c.Volume, FadeInMS: c.FadeInMS, FadeOutMS: c.FadeOutMS,
			X: c.X, Y: c.Y, Scale: c.Scale, Opacity: c.Opacity,
		})
	}
	return out
}

// overlaySource 叠加片段用的素材和种类；不是素材也不是选定的片段版本时返回 0。
func overlaySource(c drama.TimelineClip, taskAsset map[uint64]uint64) (uint64, string) {
	switch c.Kind {
	case drama.ClipAsset:
		return c.AssetID, c.Media
	case drama.ClipSegment:
		return taskAsset[c.TaskID], drama.MediaVideo
	}
	return 0, ""
}

// freezeAudios 一条音频轨：片段静音或音量为 0 的不进合成。
func freezeAudios(tr drama.Track) []composeAudio {
	var out []composeAudio
	for _, c := range tr.Clips {
		if c.Kind != drama.ClipAsset || c.AssetID == 0 || c.Muted || c.Volume == 0 {
			continue
		}
		out = append(out, composeAudio{AssetID: c.AssetID, StartMS: c.StartMS, InMS: c.InMS, OutMS: c.OutMS, Volume: c.Volume, FadeInMS: c.FadeInMS, FadeOutMS: c.FadeOutMS})
	}
	return out
}

// freezeTexts 一条字幕轨。
func freezeTexts(tr drama.Track) []composeText {
	var out []composeText
	for _, c := range tr.Clips {
		if c.Kind != drama.ClipText || c.Text == "" || c.OutMS-c.InMS <= 0 {
			continue
		}
		out = append(out, composeText{StartMS: c.StartMS, LenMS: c.OutMS - c.InMS, Text: c.Text, Style: c.Style, Pos: c.Pos, Size: c.Size})
	}
	return out
}

// trackEndMS 附属轨里最晚的结束点，用来估合成时长（毫秒）。
func (c *composeTracks) trackEndMS() int64 {
	var end int64
	if c == nil {
		return 0
	}
	for _, o := range c.Overlays {
		end = max(end, o.StartMS+o.OutMS-o.InMS)
	}
	for _, a := range c.Audios {
		end = max(end, a.StartMS+a.OutMS-a.InMS)
	}
	for _, x := range c.Texts {
		end = max(end, x.StartMS+x.LenMS)
	}
	return end
}

// downloadTracks 把附属轨用到的素材下载到临时目录，同一个素材只下载一次；返回素材 ID 到本地路径的映射。
func (s *DramaService) downloadTracks(ctx context.Context, userID uint64, dir string, tracks *composeTracks, progress func(done, total int) error) (map[uint64]string, error) {
	type need struct {
		id    uint64
		media string
	}
	var needs []need
	seen := map[uint64]bool{}
	add := func(id uint64, media string) {
		if !seen[id] {
			seen[id] = true
			needs = append(needs, need{id, media})
		}
	}
	for _, o := range tracks.Overlays {
		add(o.AssetID, o.Media)
	}
	for _, a := range tracks.Audios {
		add(a.AssetID, drama.MediaAudio)
	}
	paths := make(map[uint64]string, len(needs))
	for i, n := range needs {
		path := filepath.Join(dir, fmt.Sprintf("track-%d", i))
		if err := s.downloadCompose(ctx, userID, n.id, n.media, path); err != nil {
			return nil, withCause(errcode.ErrInternal.WithMsg("下载失败：无法读取附属轨素材"), fmt.Errorf("素材 %d：%w", n.id, err), "compose_download")
		}
		paths[n.id] = path
		if err := progress(i+1, len(needs)); err != nil {
			return nil, err
		}
	}
	return paths, nil
}

// planOf 把冻结的附属轨接上本地素材路径，组成交给合成的计划。
func (c *composeTracks) planOf(main []videoframe.ComposeClip, paths map[uint64]string) videoframe.ComposePlan {
	plan := videoframe.ComposePlan{Main: main}
	if c == nil {
		return plan
	}
	for _, o := range c.Overlays {
		plan.Overlays = append(plan.Overlays, videoframe.ComposeOverlay{
			Path: paths[o.AssetID], Image: o.Media == drama.MediaImage, StartMS: o.StartMS, InMS: o.InMS, OutMS: o.OutMS,
			Muted: o.Muted, Volume: o.Volume, FadeInMS: o.FadeInMS, FadeOutMS: o.FadeOutMS,
			X: o.X, Y: o.Y, Scale: o.Scale, Opacity: o.Opacity,
		})
	}
	for _, a := range c.Audios {
		plan.Audios = append(plan.Audios, videoframe.ComposeAudio{Path: paths[a.AssetID], StartMS: a.StartMS, InMS: a.InMS, OutMS: a.OutMS, Volume: a.Volume, FadeInMS: a.FadeInMS, FadeOutMS: a.FadeOutMS})
	}
	for _, x := range c.Texts {
		plan.Texts = append(plan.Texts, videoframe.ComposeText{StartMS: x.StartMS, LenMS: x.LenMS, Text: x.Text, Style: x.Style, Pos: x.Pos, Size: x.Size})
	}
	return plan
}
