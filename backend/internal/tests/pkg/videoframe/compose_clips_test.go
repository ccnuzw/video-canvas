package videoframe_test

import (
	"context"
	"encoding/json"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"video-canvas/internal/pkg/videoframe"
)

// composeImage 生成一张纯色 PNG。
func composeImage(t *testing.T, dir, color, size string) string {
	t.Helper()
	path := filepath.Join(dir, color+".png")
	args := []string{"-v", "error", "-f", "lavfi", "-i", "color=c=" + color + ":s=" + size, "-frames:v", "1", "-y", path}
	if out, err := exec.CommandContext(context.Background(), "ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("创建图片: %v\n%s", err, out)
	}
	return path
}

// composeLong 生成指定时长的带声音色块视频。
func composeLong(t *testing.T, dir, color, size, seconds string) string {
	t.Helper()
	if !videoframe.New(videoframe.Options{}).Available() {
		t.Skip("本机没有 ffmpeg / ffprobe，跳过合成测试")
	}
	path := filepath.Join(dir, color+"-long.mp4")
	args := []string{"-v", "error", "-f", "lavfi", "-i", "color=c=" + color + ":s=" + size + ":r=12:d=" + seconds,
		"-f", "lavfi", "-i", "sine=frequency=440:duration=" + seconds, "-c:a", "aac", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", "-y", path}
	if out, err := exec.CommandContext(context.Background(), "ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("创建色块视频: %v\n%s", err, out)
	}
	return path
}

// probeSize 读成片的画面尺寸与时长。
func probeSize(t *testing.T, path string) (int, int, float64) {
	t.Helper()
	out, err := exec.CommandContext(context.Background(), "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	var p struct {
		Streams []struct{ Width, Height int } `json:"streams"`
		Format  struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &p); err != nil || len(p.Streams) == 0 {
		t.Fatalf("解析成片信息: %v %s", err, out)
	}
	d, _ := strconv.ParseFloat(p.Format.Duration, 64)
	return p.Streams[0].Width, p.Streams[0].Height, d
}

func TestComposeClips_TrimImageMuteAndRatio(t *testing.T) {
	dir := t.TempDir()
	video := composeLong(t, dir, "red", "320x240", "4")
	image := composeImage(t, dir, "green", "200x200")
	dst := filepath.Join(dir, "final.mp4")
	e := videoframe.New(videoframe.Options{Timeout: time.Minute})
	clips := []videoframe.ComposeClip{
		{Path: video, InMS: 1000, OutMS: 2500},
		{Path: image, Image: true, OutMS: 1000},
		{Path: video, InMS: 0, OutMS: 500, Muted: true},
	}
	if err := e.ComposeClips(context.Background(), clips, "9:16", dst); err != nil {
		t.Fatal(err)
	}
	w, h, d := probeSize(t, dst)
	// 目标尺寸：项目比例 9:16，短边取第一段视频的短边 240 → 240x426（取偶数）
	if w != 240 || h != 426 {
		t.Fatalf("成片尺寸 %dx%d，期望 240x426", w, h)
	}
	if math.Abs(d-3) > 0.2 {
		t.Fatalf("成片时长 %.2f，期望约 3 秒（1.5 + 1 + 0.5）", d)
	}
	// 第二段是图片：成片 2 秒处应能读出画面
	if _, err := e.Frame(context.Background(), dst, 2.0, videoframe.FrameOpts{}); err != nil {
		t.Fatalf("图片段无法播放: %v", err)
	}
}

func TestComposeClips_RejectsEmptyAndBadRange(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "out.mp4")
	e := videoframe.New(videoframe.Options{})
	if err := e.ComposeClips(context.Background(), nil, "9:16", dst); err == nil {
		t.Fatal("空清单应报错")
	}
	video := composeLong(t, dir, "blue", "160x120", "1")
	if err := e.ComposeClips(context.Background(), []videoframe.ComposeClip{{Path: video, InMS: 900, OutMS: 800}}, "9:16", dst); err == nil {
		t.Fatal("出点早于入点应报错")
	}
}
