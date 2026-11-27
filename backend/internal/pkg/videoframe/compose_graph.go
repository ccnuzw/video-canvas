package videoframe

import (
	"fmt"
	"strconv"
	"strings"
)

// 多轨合成的滤镜图：主轨先合成成一个统一规格的底片，再在这条底片上叠加画面、混音、烧字幕。
// 这里只拼滤镜图文本，不执行命令；输入顺序约定为 0 = 底片，接着是各叠加输入，最后是各音频输入。

// graphOverlay 滤镜图里的一个叠加输入。
type graphOverlay struct {
	// idx 是它在 ffmpeg 输入里的序号
	idx int
	c   ComposeOverlay
	// lenMS 它在成片里的时长（毫秒）
	lenMS int64
	// audio 是否把它自带的声音混进成片
	audio bool
}

// graphAudio 滤镜图里的一个音频输入。
type graphAudio struct {
	idx   int
	c     ComposeAudio
	lenMS int64
}

// graphSpec 一次多轨合成的滤镜图描述。
type graphSpec struct {
	target composeTarget
	// baseMS 底片（主轨）的时长；totalMS 成片总时长（全部轨的最晚结束点）
	baseMS, totalMS int64
	overlays        []graphOverlay
	audios          []graphAudio
	// assPath 字幕文件；没有字幕为空
	assPath string
	// spec 输出规格（已补默认值），帧率和画质用它
	spec ComposeSpec
}

// secs 毫秒转成 ffmpeg 用的秒，如 1500 → "1.500"。
func secs(ms int64) string { return strconv.FormatFloat(float64(ms)/1000, 'f', 3, 64) }

// fadeSpans 把淡入淡出夹到不超过片段长度，两者之和也不超过。
func fadeSpans(fadeIn, fadeOut, lengthMS int64) (int64, int64) {
	fadeIn = min(max(fadeIn, 0), lengthMS)
	fadeOut = min(max(fadeOut, 0), lengthMS-fadeIn)
	return fadeIn, fadeOut
}

// gainFilters 一段声音的音量和淡入淡出滤镜（段内时间从 0 起）；volume 为 0 表示不调整。
func gainFilters(volume int, fadeIn, fadeOut, lengthMS int64) []string {
	var out []string
	if volume > 0 && volume != 100 {
		out = append(out, fmt.Sprintf("volume=%.3f", float64(min(volume, 200))/100))
	}
	fadeIn, fadeOut = fadeSpans(fadeIn, fadeOut, lengthMS)
	if fadeIn > 0 {
		out = append(out, fmt.Sprintf("afade=t=in:st=0:d=%s", secs(fadeIn)))
	}
	if fadeOut > 0 {
		out = append(out, fmt.Sprintf("afade=t=out:st=%s:d=%s", secs(lengthMS-fadeOut), secs(fadeOut)))
	}
	return out
}

// videoFadeFilters 主轨一段的画面淡入淡出（淡到黑），没有淡变返回空串；返回值以逗号开头，可直接接在滤镜链后面。
func videoFadeFilters(fadeIn, fadeOut, lengthMS int64) string {
	fadeIn, fadeOut = fadeSpans(fadeIn, fadeOut, lengthMS)
	var b strings.Builder
	if fadeIn > 0 {
		fmt.Fprintf(&b, ",fade=t=in:st=0:d=%s", secs(fadeIn))
	}
	if fadeOut > 0 {
		fmt.Fprintf(&b, ",fade=t=out:st=%s:d=%s", secs(lengthMS-fadeOut), secs(fadeOut))
	}
	return b.String()
}

// script 拼出完整的滤镜图，输出标签固定为 [vout] 和 [aout]。
func (g graphSpec) script() string {
	lines, last := g.videoLines()
	lines = append(lines, fmt.Sprintf("[%s]format=yuv420p[vout]", last))
	lines = append(lines, g.audioLines()...)
	return strings.Join(lines, ";\n")
}

// videoLines 画面部分：主轨比别的轨短时尾部补黑，再按轨道顺序叠加画面，最后烧字幕；返回最后一个标签。
func (g graphSpec) videoLines() ([]string, string) {
	var lines []string
	last := "0:v"
	if g.totalMS > g.baseMS {
		lines = append(lines, fmt.Sprintf("[0:v]tpad=stop_mode=add:stop_duration=%s:color=black[vbase]", secs(g.totalMS-g.baseMS)))
		last = "vbase"
	}
	for i, o := range g.overlays {
		lines = append(lines, fmt.Sprintf("[%d:v]%s[ov%d]", o.idx, g.overlayChain(o), i))
		x, y := g.target.width*clampPct(o.c.X)/100, g.target.height*clampPct(o.c.Y)/100
		lines = append(lines, fmt.Sprintf("[%s][ov%d]overlay=x=%d-w/2:y=%d-h/2:eof_action=pass:enable='between(t,%s,%s)'[v%d]",
			last, i, x, y, secs(o.c.StartMS), secs(o.c.StartMS+o.lenMS), i))
		last = fmt.Sprintf("v%d", i)
	}
	if g.assPath != "" {
		lines = append(lines, fmt.Sprintf("[%s]ass=filename='%s'[vsub]", last, escapeQuoted(g.assPath)))
		last = "vsub"
	}
	return lines, last
}

// overlayChain 一个叠加画面的处理：按宽度占比缩放、淡入淡出作用于透明度、整体不透明度，再平移到它的起点。
func (g graphSpec) overlayChain(o graphOverlay) string {
	scale := o.c.Scale
	if scale <= 0 {
		scale = 100
	}
	chain := []string{fmt.Sprintf("scale=%d:-2", even(g.target.width*min(scale, 100)/100)), "format=rgba"}
	fadeIn, fadeOut := fadeSpans(o.c.FadeInMS, o.c.FadeOutMS, o.lenMS)
	if fadeIn > 0 {
		chain = append(chain, fmt.Sprintf("fade=t=in:st=0:d=%s:alpha=1", secs(fadeIn)))
	}
	if fadeOut > 0 {
		chain = append(chain, fmt.Sprintf("fade=t=out:st=%s:d=%s:alpha=1", secs(o.lenMS-fadeOut), secs(fadeOut)))
	}
	if opacity := clampPct(o.c.Opacity); opacity < 100 {
		chain = append(chain, fmt.Sprintf("colorchannelmixer=aa=%.3f", float64(opacity)/100))
	}
	chain = append(chain, fmt.Sprintf("setpts=PTS-STARTPTS+%s/TB", secs(o.c.StartMS)))
	return strings.Join(chain, ",")
}

// audioLines 声音部分：底片的声音补静音到总长，和叠加视频的声音、音频轨按各自起点延后后混成一路。
func (g graphSpec) audioLines() []string {
	pad := fmt.Sprintf("apad=whole_dur=%s", secs(g.totalMS))
	var lines, labels []string
	add := func(idx int, label string, volume int, fadeIn, fadeOut, startMS, lenMS int64) {
		chain := []string{"aformat=sample_rates=48000:channel_layouts=stereo"}
		chain = append(chain, gainFilters(volume, fadeIn, fadeOut, lenMS)...)
		if startMS > 0 {
			chain = append(chain, fmt.Sprintf("adelay=%d:all=1", startMS))
		}
		lines = append(lines, fmt.Sprintf("[%d:a]%s[%s]", idx, strings.Join(chain, ","), label))
		labels = append(labels, "["+label+"]")
	}
	for i, o := range g.overlays {
		if o.audio {
			add(o.idx, fmt.Sprintf("oa%d", i), o.c.Volume, o.c.FadeInMS, o.c.FadeOutMS, o.c.StartMS, o.lenMS)
		}
	}
	for j, a := range g.audios {
		add(a.idx, fmt.Sprintf("ac%d", j), a.c.Volume, a.c.FadeInMS, a.c.FadeOutMS, a.c.StartMS, a.lenMS)
	}
	if len(labels) == 0 {
		return []string{fmt.Sprintf("[0:a]%s[aout]", pad)}
	}
	lines = append([]string{fmt.Sprintf("[0:a]%s[a0]", pad)}, lines...)
	mix := fmt.Sprintf("[a0]%samix=inputs=%d:duration=longest:normalize=0,alimiter=limit=0.98[aout]", strings.Join(labels, ""), len(labels)+1)
	return append(lines, mix)
}

// clampPct 把百分比夹到 0–100。
func clampPct(v int) int { return min(max(v, 0), 100) }

// escapeQuoted 转义放进滤镜图单引号里的文本：只有单引号需要处理。
func escapeQuoted(s string) string { return strings.ReplaceAll(s, "'", `'\''`) }
