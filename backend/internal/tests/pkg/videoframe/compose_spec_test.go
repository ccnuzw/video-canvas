package videoframe_test

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"video-canvas/internal/pkg/videoframe"
)

// frameRate 读成片首个视频流的帧率（r_frame_rate，如 "24/1"）。
func frameRate(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.CommandContext(context.Background(), "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=nw=1:nk=1", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out))
}

// 只有主轨：短边按规格缩放（素材短边 240 → 720），帧率按规格（24）。
func TestComposeTimeline_SpecShortSideAndFPS(t *testing.T) {
	e := needFFmpeg(t)
	dir := t.TempDir()
	video := silentVideo(t, dir, "red", "320x240", "1")
	dst := filepath.Join(dir, "final.mp4")
	plan := videoframe.ComposePlan{
		Main: []videoframe.ComposeClip{{Path: video, OutMS: 1000}},
		Spec: videoframe.ComposeSpec{ShortSide: 720, FPS: 24, CRF: 23},
	}
	if err := e.ComposeTimeline(context.Background(), plan, "9:16", dst); err != nil {
		t.Fatal(err)
	}
	if w, h, _ := probeSize(t, dst); w != 720 || h != 1280 {
		t.Fatalf("9:16 短边 720 应是 720x1280，得到 %dx%d", w, h)
	}
	if r := frameRate(t, dst); r != "24/1" {
		t.Fatalf("帧率应是 24/1，得到 %s", r)
	}
}

// 有附属轨（走滤镜图）：帧率和短边同样按规格。
func TestComposeTimeline_SpecAppliesToTracks(t *testing.T) {
	e := needFFmpeg(t)
	dir := t.TempDir()
	video := silentVideo(t, dir, "red", "320x240", "1")
	green := composeImage(t, dir, "green", "200x200")
	dst := filepath.Join(dir, "final.mp4")
	plan := videoframe.ComposePlan{
		Main:     []videoframe.ComposeClip{{Path: video, OutMS: 1000}},
		Overlays: []videoframe.ComposeOverlay{{Path: green, Image: true, StartMS: 200, OutMS: 600, X: 50, Y: 50, Scale: 50, Opacity: 100}},
		Spec:     videoframe.ComposeSpec{ShortSide: 720, FPS: 25, CRF: 17},
	}
	if err := e.ComposeTimeline(context.Background(), plan, "16:9", dst); err != nil {
		t.Fatal(err)
	}
	if w, h, _ := probeSize(t, dst); w != 1280 || h != 720 {
		t.Fatalf("16:9 短边 720 应是 1280x720，得到 %dx%d", w, h)
	}
	if r := frameRate(t, dst); r != "25/1" {
		t.Fatalf("帧率应是 25/1，得到 %s", r)
	}
}

// 不给规格（零值）：和以前一样，短边跟随素材、30 帧。
func TestComposeTimeline_ZeroSpecKeepsOldBehavior(t *testing.T) {
	e := needFFmpeg(t)
	dir := t.TempDir()
	video := silentVideo(t, dir, "red", "320x240", "1")
	dst := filepath.Join(dir, "final.mp4")
	if err := e.ComposeTimeline(context.Background(), videoframe.ComposePlan{Main: []videoframe.ComposeClip{{Path: video, OutMS: 1000}}}, "16:9", dst); err != nil {
		t.Fatal(err)
	}
	if w, h, _ := probeSize(t, dst); w != 426 || h != 240 {
		t.Fatalf("16:9、短边跟随素材 240 应是 426x240，得到 %dx%d", w, h)
	}
	if r := frameRate(t, dst); r != "30/1" {
		t.Fatalf("默认帧率应是 30/1，得到 %s", r)
	}
}
