package videoframe

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// composeInfo 只读取转码所需的首视频流尺寸、时长和音轨存在性。
type composeInfo struct {
	width, height int
	duration      float64
	audio         bool
}

// ComposeClip 成片里的一段：视频按入出点截取，图片按时长定格。
type ComposeClip struct {
	Path  string
	Image bool
	// InMS / OutMS 视频是素材内的毫秒位置，OutMS 为 0 表示到结尾；图片只看 OutMS，即时长
	InMS  int64
	OutMS int64
	// Muted 这一段不要声音（补静音轨）
	Muted bool
	// Volume 音量百分比（0–200）；0 表示不调整（100%），要静音用 Muted
	Volume int
	// FadeInMS / FadeOutMS 淡入淡出时长（毫秒），同时作用于画面（淡到黑）和声音；0 表示没有
	FadeInMS  int64
	FadeOutMS int64
}

// composeTarget 统一后的画面尺寸。
type composeTarget struct{ width, height int }

// 默认输出规格：30 帧、crf 20（与指定规格之前的行为一致）。
const (
	defaultFPS = 30
	defaultCRF = 20
)

// ComposeSpec 成片的输出规格；各字段为 0 表示用默认（短边跟随第一段视频、30 帧、crf 20）。
type ComposeSpec struct {
	// ShortSide 画面短边像素；0 跟随第一段视频素材的短边（没有视频取 720）
	ShortSide int
	// FPS 帧率；0 按 30
	FPS int
	// CRF x264 的画质参数（越小越清晰、文件越大）；0 按 20
	CRF int
}

// withDefaults 把零值换成默认值（短边保持 0，表示跟随素材）。
func (s ComposeSpec) withDefaults() ComposeSpec {
	if s.FPS <= 0 {
		s.FPS = defaultFPS
	}
	if s.CRF <= 0 {
		s.CRF = defaultCRF
	}
	return s
}

// Compose 将本地片段整段按顺序拼接，尺寸统一为第一段的分辨率；等同于不裁剪、不改比例的 ComposeClips。
func (e *Extractor) Compose(ctx context.Context, sources []string, destination string) error {
	clips := make([]ComposeClip, 0, len(sources))
	for _, s := range sources {
		clips = append(clips, ComposeClip{Path: s})
	}
	return e.ComposeClips(ctx, clips, "", destination)
}

// ComposeClips 逐段截取、统一为 ratio 比例（空串沿用第一段视频的比例）、30fps、H.264/AAC，再按顺序拼接。
// 短边取第一段视频的短边（没有视频取 720）；比例不同的素材加黑边居中；无音轨或静音段补立体声静音。
// 整个操作受 Options.Timeout 限制，失败清理半成片，所有路径清理中间文件。
func (e *Extractor) ComposeClips(ctx context.Context, clips []ComposeClip, ratio, destination string) error {
	return e.composeClipsSpec(ctx, clips, ratio, ComposeSpec{}, destination)
}

// composeClipsSpec 同 ComposeClips，按 spec 指定短边、帧率和画质。
func (e *Extractor) composeClipsSpec(ctx context.Context, clips []ComposeClip, ratio string, spec ComposeSpec, destination string) (err error) {
	if len(clips) == 0 {
		return fmt.Errorf("%w: 没有待合成视频", ErrDecode)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()
	dir, err := os.MkdirTemp(filepath.Dir(destination), "vc-concat-*")
	if err != nil {
		return fmt.Errorf("创建合成临时目录失败：%w", err)
	}
	defer func() {
		_ = os.RemoveAll(dir) // 中间文件没有外部引用，无论成功或失败均回收。
		if err != nil {
			_ = os.Remove(destination) // 不保留可能被误认为可播放成片的半成品。
		}
	}()
	_, _, err = e.composeBase(ctx, dir, clips, ratio, spec, destination)
	return err
}

// composeBase 把各段逐个转码成统一规格再拼接到 destination，返回统一后的画面尺寸和成片总秒数；
// dir 放中间文件，由调用方清理。
func (e *Extractor) composeBase(ctx context.Context, dir string, clips []ComposeClip, ratio string, spec ComposeSpec, destination string) (composeTarget, float64, error) {
	infos, err := e.composeProbeAll(ctx, clips)
	if err != nil {
		return composeTarget{}, 0, err
	}
	spec = spec.withDefaults()
	target := composeTargetOf(clips, infos, ratio, spec.ShortSide)
	var playlist strings.Builder
	var total float64
	for i, clip := range clips {
		name := fmt.Sprintf("part-%06d.mp4", i)
		if err := e.composeTranscode(ctx, clip, infos[i], target, spec, filepath.Join(dir, name)); err != nil {
			return composeTarget{}, 0, err
		}
		length, _ := clipLength(clip, infos[i]) // 探测阶段已校验过
		total += length
		fmt.Fprintf(&playlist, "file '%s'\n", name)
	}
	listPath := filepath.Join(dir, "concat.txt")
	if err := os.WriteFile(listPath, []byte(playlist.String()), 0600); err != nil {
		return composeTarget{}, 0, fmt.Errorf("写入合成清单失败：%w", err)
	}
	_, err = e.run(ctx, e.ffmpeg, "-nostdin", "-v", "error", "-f", "concat", "-safe", "1", "-i", listPath,
		"-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart", "-y", destination)
	return target, total, err
}

// composeProbeAll 读每段的尺寸、时长和音轨，并校验入出点；图片只需要尺寸。
func (e *Extractor) composeProbeAll(ctx context.Context, clips []ComposeClip) ([]composeInfo, error) {
	infos := make([]composeInfo, len(clips))
	for i, clip := range clips {
		info, err := e.composeProbe(ctx, clip.Path, clip.Image)
		if err != nil {
			return nil, err
		}
		if _, err := clipLength(clip, info); err != nil {
			return nil, err
		}
		infos[i] = info
	}
	return infos, nil
}

// clipLength 返回这一段在成片里的秒数；入出点越界或长度不为正时报错。
func clipLength(clip ComposeClip, info composeInfo) (float64, error) {
	if clip.Image {
		if clip.OutMS <= 0 {
			return 0, fmt.Errorf("%w: 图片段没有时长", ErrDecode)
		}
		return float64(clip.OutMS) / 1000, nil
	}
	in := float64(clip.InMS) / 1000
	end := info.duration
	if clip.OutMS > 0 {
		end = min(end, float64(clip.OutMS)/1000)
	}
	if clip.InMS < 0 || end-in <= 0 {
		return 0, fmt.Errorf("%w: 视频段的入出点不合法", ErrDecode)
	}
	return end - in, nil
}

// composeTargetOf 算统一尺寸：短边取第一段视频的短边（没有视频取 720），比例取 ratio，宽高都取偶数。
// shortSide 大于 0 时短边按它，否则跟随第一段视频（没有视频取 720）；ratio 认不出时沿用第一段视频的比例。
func composeTargetOf(clips []ComposeClip, infos []composeInfo, ratio string, shortSide int) composeTarget {
	var first *composeInfo
	for i := range clips {
		if !clips[i].Image {
			first = &infos[i]
			break
		}
	}
	rw, rh, ok := parseRatio(ratio)
	if first != nil && !ok {
		rw, rh, ok = first.width, first.height, true
		if shortSide <= 0 {
			return composeTarget{even(first.width), even(first.height)}
		}
	}
	short := 720
	switch {
	case shortSide > 0:
		short = shortSide
	case first != nil:
		short = min(first.width, first.height)
	}
	if !ok {
		rw, rh = 9, 16
	}
	if rw <= rh {
		return composeTarget{even(short), even(short * rh / rw)}
	}
	return composeTarget{even(short * rw / rh), even(short)}
}

// parseRatio 解析「9:16」这样的比例。
func parseRatio(s string) (int, int, bool) {
	a, b, found := strings.Cut(s, ":")
	w, err1 := strconv.Atoi(a)
	h, err2 := strconv.Atoi(b)
	if !found || err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}

// even 向下取偶数，H.264 的 yuv420p 要求宽高为偶数。
func even(n int) int { return max(2, n-n%2) }

// composeProbe 使用与抽帧相同的二进制定位、协议白名单和受限执行器；图片不要求时长。
func (e *Extractor) composeProbe(ctx context.Context, source string, image bool) (composeInfo, error) {
	out, err := e.run(ctx, e.ffprobe, "-v", "error", "-protocol_whitelist", "file", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", source)
	if err != nil {
		return composeInfo{}, err
	}
	var probe struct {
		Streams []struct {
			Type     string `json:"codec_type"`
			Width    int    `json:"width"`
			Height   int    `json:"height"`
			Duration string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return composeInfo{}, fmt.Errorf("%w: 视频信息无法解析", ErrDecode)
	}
	info := composeInfo{}
	for _, stream := range probe.Streams {
		if stream.Type == "audio" {
			info.audio = true
		}
		if stream.Type == "video" && info.width == 0 {
			info.width, info.height = stream.Width, stream.Height
			info.duration, _ = strconv.ParseFloat(stream.Duration, 64)
		}
	}
	if info.duration <= 0 {
		info.duration, _ = strconv.ParseFloat(probe.Format.Duration, 64)
	}
	if info.width <= 0 || info.height <= 0 || (!image && info.duration <= 0) {
		return composeInfo{}, fmt.Errorf("%w: 视频没有有效的尺寸或时长", ErrDecode)
	}
	return info, nil
}

// composeTranscode 把一段截取并转换成统一的尺寸、帧率、像素格式、音频采样率与声道布局。
func (e *Extractor) composeTranscode(ctx context.Context, clip ComposeClip, info composeInfo, target composeTarget, spec ComposeSpec, destination string) error {
	length, err := clipLength(clip, info)
	if err != nil {
		return err
	}
	seconds := strconv.FormatFloat(length, 'f', 6, 64)
	args := []string{"-nostdin", "-v", "error", "-protocol_whitelist", "file"}
	switch {
	case clip.Image:
		args = append(args, "-loop", "1", "-framerate", strconv.Itoa(spec.FPS), "-t", seconds, "-i", clip.Path)
	case clip.InMS > 0:
		args = append(args, "-ss", strconv.FormatFloat(float64(clip.InMS)/1000, 'f', 3, 64), "-i", clip.Path)
	default:
		args = append(args, "-i", clip.Path)
	}
	audio := "0:a:0"
	if clip.Image || clip.Muted || !info.audio {
		args = append(args, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000")
		audio = "1:a:0"
	}
	lengthMS := int64(length*1000 + 0.5)
	filter := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=%d", target.width, target.height, target.width, target.height, spec.FPS)
	filter += videoFadeFilters(clip.FadeInMS, clip.FadeOutMS, lengthMS)
	// 声音：先音量和淡变，再补静音到整段长度；用静音源时没有可调的声音
	audioChain := []string{"apad"}
	if audio == "0:a:0" {
		audioChain = append(gainFilters(clip.Volume, clip.FadeInMS, clip.FadeOutMS, lengthMS), "apad")
	}
	args = append(args, "-map", "0:v:0", "-map", audio, "-vf", filter,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", strconv.Itoa(spec.CRF), "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-ar", "48000", "-ac", "2", "-af", strings.Join(audioChain, ","),
		"-t", seconds, "-video_track_timescale", "90000", "-y", destination)
	_, err = e.run(ctx, e.ffmpeg, args...)
	return err
}
