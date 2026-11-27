package drama

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

// ValidateTimeline 校验用户提交的时间线：轨道数量与类型、段 ID、片段与轨道匹配、长度、片段与版本归属、素材归属与种类、
// 同轨不重叠、各项参数范围、总长。返回的错误文案直接给用户看（「轨道名 第 N 段：原因」）。
func ValidateTimeline(tracks []Track, segs []TimelineSegment, assets map[uint64]TimelineAsset) error {
	if err := validateTrackSet(tracks); err != nil {
		return err
	}
	byID := make(map[uint64]TimelineSegment, len(segs))
	for _, s := range segs {
		byID[s.ID] = s
	}
	seen := map[string]bool{}
	var end int64
	for _, tr := range tracks {
		if err := validateTrackClips(tr, seen, byID, assets); err != nil {
			return err
		}
		end = max(end, trackEnd(tr))
	}
	if end > MaxTimelineMS {
		return errors.New("时间线总长不能超过 30 分钟")
	}
	return nil
}

// trackLabel 错误文案里用的轨道名。
func trackLabel(tr Track) string {
	if name := strings.TrimSpace(tr.Name); name != "" {
		return name
	}
	if name := trackName(tr.Kind); name != "" {
		return name
	}
	return tr.ID
}

// validateTrackSet 校验轨道本身：ID、类型、名字、用途、每种轨的数量和段数上限。
func validateTrackSet(tracks []Track) error {
	counts := map[string]int{}
	ids := map[string]bool{}
	total := 0
	for _, tr := range tracks {
		if err := validateTrack(tr, ids); err != nil {
			return err
		}
		ids[tr.ID] = true
		counts[tr.Kind]++
		total += len(tr.Clips)
	}
	switch {
	case counts[TrackMain] != 1:
		return errors.New("时间线必须有且只有一条主轨")
	case counts[TrackOverlay] > MaxOverlayTracks:
		return fmt.Errorf("叠加轨最多 %d 条", MaxOverlayTracks)
	case counts[TrackText] > MaxTextTracks:
		return fmt.Errorf("字幕轨最多 %d 条", MaxTextTracks)
	case counts[TrackAudio] > MaxAudioTracks:
		return fmt.Errorf("音频轨最多 %d 条", MaxAudioTracks)
	case total > MaxClipsTotal:
		return fmt.Errorf("时间线最多 %d 段", MaxClipsTotal)
	}
	return nil
}

// validateTrack 校验一条轨自身的字段。
func validateTrack(tr Track, ids map[string]bool) error {
	label := trackLabel(tr)
	switch {
	case tr.ID == "" || len(tr.ID) > MaxTrackIDLen:
		return errors.New("轨道 ID 不合法")
	case ids[tr.ID]:
		return errors.New("轨道 ID 重复")
	case !slices.Contains([]string{TrackMain, TrackOverlay, TrackAudio, TrackText}, tr.Kind):
		return fmt.Errorf("%s：不支持的轨道类型", label)
	case utf8.RuneCountInString(strings.TrimSpace(tr.Name)) > MaxTrackNameRunes:
		return fmt.Errorf("轨道名不能超过 %d 个字", MaxTrackNameRunes)
	case tr.Kind != TrackAudio && tr.Role != "":
		return fmt.Errorf("%s：只有音频轨可以设置用途", label)
	case tr.Role != "" && !slices.Contains([]string{RoleVoice, RoleMusic, RoleSfx}, tr.Role):
		return fmt.Errorf("%s：音频轨用途不合法", label)
	case len(tr.Clips) > MaxClipsPerTrack:
		return fmt.Errorf("%s：一条轨最多 %d 段", label, MaxClipsPerTrack)
	}
	return nil
}

// validateTrackClips 逐段校验一条轨上的片段，附属轨再检查同轨不重叠。
func validateTrackClips(tr Track, seen map[string]bool, segs map[uint64]TimelineSegment, assets map[uint64]TimelineAsset) error {
	label := trackLabel(tr)
	for i, c := range tr.Clips {
		if reason := clipProblem(tr.Kind, c, seen, segs, assets); reason != "" {
			return fmt.Errorf("%s 第 %d 段：%s", label, i+1, reason)
		}
		seen[c.ID] = true
	}
	if tr.Kind == TrackMain {
		return nil
	}
	if i := overlapAt(tr.Clips); i >= 0 {
		return fmt.Errorf("%s 第 %d 段：与同轨的其他片段重叠", label, i+1)
	}
	return nil
}

// trackEnd 一条轨的结束点：主轨是各段时长之和，附属轨是最晚的结束点。
func trackEnd(tr Track) int64 {
	var end int64
	for _, c := range tr.Clips {
		if tr.Kind == TrackMain {
			end += c.OutMS - c.InMS
		} else {
			end = max(end, c.StartMS+c.OutMS-c.InMS)
		}
	}
	return end
}

// overlapAt 按起点排序后第一个和前一段重叠的片段在原列表里的下标；没有重叠返回 -1。
func overlapAt(clips []TimelineClip) int {
	order := make([]int, len(clips))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int {
		switch {
		case clips[a].StartMS < clips[b].StartMS:
			return -1
		case clips[a].StartMS > clips[b].StartMS:
			return 1
		}
		return 0
	})
	var prevEnd int64
	for n, i := range order {
		if n > 0 && clips[i].StartMS < prevEnd {
			return i
		}
		prevEnd = max(prevEnd, clips[i].StartMS+clips[i].OutMS-clips[i].InMS)
	}
	return -1
}

// accepts 各种轨道能放的片段：主轨和叠加轨放片段版本、视频、图片，音频轨放音频素材，字幕轨放文字。
func accepts(trackKind string, c TimelineClip) bool {
	switch trackKind {
	case TrackMain, TrackOverlay:
		return c.Kind == ClipSegment || (c.Kind == ClipAsset && (c.Media == MediaVideo || c.Media == MediaImage))
	case TrackAudio:
		return c.Kind == ClipAsset && c.Media == MediaAudio
	case TrackText:
		return c.Kind == ClipText
	}
	return false
}

// clipProblem 返回一段的问题，没有问题返回空串。
func clipProblem(trackKind string, c TimelineClip, seen map[string]bool, segs map[uint64]TimelineSegment, assets map[uint64]TimelineAsset) string {
	switch {
	case c.ID == "" || len(c.ID) > MaxTrackIDLen:
		return "段 ID 不合法"
	case seen[c.ID]:
		return "段 ID 重复"
	case c.Kind != ClipSegment && c.Kind != ClipAsset && c.Kind != ClipText:
		return "不支持的段类型"
	case !accepts(trackKind, c):
		return "这条轨放不了这种片段"
	}
	if c.Kind == ClipText {
		return textProblem(c)
	}
	if reason := rangeProblem(trackKind, c); reason != "" {
		return reason
	}
	if c.Kind == ClipSegment {
		return segmentProblem(trackKind, c, segs)
	}
	return assetProblem(c, assets)
}

// rangeProblem 校验入出点、起点和音量淡变，叠加轨再校验画面参数。
func rangeProblem(trackKind string, c TimelineClip) string {
	length := c.OutMS - c.InMS
	switch {
	case c.InMS < 0 || length < MinClipMS:
		return "每段至少 0.5 秒"
	case trackKind != TrackMain && c.StartMS < 0:
		return "起点不能为负"
	case c.Volume < 0 || c.Volume > MaxVolume:
		return fmt.Sprintf("音量要在 0–%d", MaxVolume)
	case c.FadeInMS < 0 || c.FadeOutMS < 0:
		return "淡入淡出不能为负"
	case c.FadeInMS+c.FadeOutMS > length:
		return "淡入淡出加起来不能超过片段时长"
	}
	if trackKind != TrackOverlay {
		return ""
	}
	switch {
	case c.X < 0 || c.X > 100 || c.Y < 0 || c.Y > 100:
		return "叠加画面位置要在 0–100"
	case c.Scale < MinOverlayScale || c.Scale > 100:
		return fmt.Sprintf("叠加画面缩放要在 %d–100", MinOverlayScale)
	case c.Opacity < 0 || c.Opacity > 100:
		return "叠加画面不透明度要在 0–100"
	}
	return ""
}

// textProblem 校验字幕段：入点恒为 0、文字非空且不过长、样式位置字号合法。
func textProblem(c TimelineClip) string {
	text := strings.TrimSpace(c.Text)
	switch {
	case c.InMS != 0:
		return "文字段的入点必须为 0"
	case c.StartMS < 0:
		return "起点不能为负"
	case c.OutMS < MinClipMS:
		return "每段至少 0.5 秒"
	case text == "":
		return "字幕文字不能为空"
	case utf8.RuneCountInString(text) > MaxTextRunes:
		return fmt.Sprintf("字幕文字不能超过 %d 个字", MaxTextRunes)
	case c.Style != TextSubtitle && c.Style != TextTitle:
		return "字幕样式不合法"
	case c.Pos != PosTop && c.Pos != PosMiddle && c.Pos != PosBottom:
		return "字幕位置不合法"
	case c.Size < MinTextSize || c.Size > MaxTextSize:
		return fmt.Sprintf("字幕字号要在 %d–%d", MinTextSize, MaxTextSize)
	}
	return ""
}

// segmentProblem 校验片段版本段：片段属于这一集；主轨允许待采用占位，附属轨必须选定版本；版本必须成功且不越界。
func segmentProblem(trackKind string, c TimelineClip, segs map[uint64]TimelineSegment) string {
	s, ok := segs[c.SegmentID]
	if !ok {
		return "片段不存在"
	}
	if c.TaskID == 0 {
		if trackKind != TrackMain {
			return "附属轨的片段必须选定版本"
		}
		return ""
	}
	if _, ok := s.Takes[c.TaskID]; !ok {
		return "这个版本不可用"
	}
	if c.OutMS > s.takeDuration(c.TaskID)+durationSlackMS {
		return "超出素材长度"
	}
	return ""
}

// assetProblem 校验素材段：素材属于当前用户、种类相符、不越界；图片入点恒为 0、最长 30 秒。
func assetProblem(c TimelineClip, assets map[uint64]TimelineAsset) string {
	a, ok := assets[c.AssetID]
	switch {
	case !ok:
		return "素材不存在"
	case c.Media != a.Media:
		return "素材类型不符"
	case c.Media == MediaImage && (c.InMS != 0 || c.OutMS > MaxImageMS):
		return "图片时长要在 0.5–30 秒"
	case c.Media != MediaImage && a.DurationMS > 0 && c.OutMS > a.DurationMS+durationSlackMS:
		return "超出素材长度"
	}
	return ""
}
