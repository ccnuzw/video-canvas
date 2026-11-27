package drama_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"video-canvas/internal/drama"
)

// 附属轨与片段的构造辅助。
func overlayTrack(id string, clips ...drama.TimelineClip) drama.Track {
	return drama.Track{ID: id, Kind: drama.TrackOverlay, Name: "叠加", Clips: clips}
}

func audioTrack(id string, clips ...drama.TimelineClip) drama.Track {
	return drama.Track{ID: id, Kind: drama.TrackAudio, Role: drama.RoleVoice, Name: "配音", Clips: clips}
}

func textTrack(id string, clips ...drama.TimelineClip) drama.Track {
	return drama.Track{ID: id, Kind: drama.TrackText, Name: "字幕", Clips: clips}
}

func audioClip(id string, asset uint64, start, in, out int64) drama.TimelineClip {
	return drama.TimelineClip{ID: id, Kind: drama.ClipAsset, AssetID: asset, Media: drama.MediaAudio, StartMS: start, InMS: in, OutMS: out, Volume: 100}
}

func overlayImage(id string, asset uint64, start, out int64) drama.TimelineClip {
	return drama.TimelineClip{ID: id, Kind: drama.ClipAsset, AssetID: asset, Media: drama.MediaImage, StartMS: start, OutMS: out, Volume: 100, X: 50, Y: 50, Scale: 100, Opacity: 100}
}

func overlayTake(id string, sid, task uint64, start, out int64) drama.TimelineClip {
	return drama.TimelineClip{ID: id, Kind: drama.ClipSegment, SegmentID: sid, TaskID: task, Pinned: true, StartMS: start, OutMS: out, Volume: 100, X: 72, Y: 22, Scale: 42, Opacity: 100}
}

func textClip(id, text string, start, out int64) drama.TimelineClip {
	return drama.TimelineClip{ID: id, Kind: drama.ClipText, Text: text, Style: drama.TextSubtitle, Pos: drama.PosBottom, Size: 100, StartMS: start, OutMS: out, Volume: 100}
}

// withMain 一条合法主轨 + 额外的轨道，主轨放在中间。
func withMain(extra ...drama.Track) []drama.Track {
	main := drama.Track{ID: "main", Kind: drama.TrackMain, Name: "主轨", Clips: []drama.TimelineClip{seg("m1", 1, 11, 0, 15000)}}
	return append([]drama.Track{main}, extra...)
}

func trackAssets() map[uint64]drama.TimelineAsset {
	return map[uint64]drama.TimelineAsset{
		9: {Media: drama.MediaImage}, 8: {Media: drama.MediaVideo, DurationMS: 6000}, 5: {Media: drama.MediaAudio, DurationMS: 4000},
	}
}

func TestValidateTimeline_Tracks(t *testing.T) {
	full := withMain(
		textTrack("t1", textClip("s1", "你好", 0, 2000)),
		overlayTrack("o1", overlayImage("o1c", 9, 1000, 3000), overlayTake("o2c", 2, 21, 5000, 4000)),
		audioTrack("a1", audioClip("a1c", 5, 2000, 500, 4000)),
	)
	if err := drama.ValidateTimeline(full, segs(), trackAssets()); err != nil {
		t.Fatalf("合法的多轨时间线报错：%v", err)
	}
	many := func(kind string, n int) []drama.Track {
		out := withMain()
		for i := range n {
			out = append(out, drama.Track{ID: fmt.Sprintf("%s%d", kind, i), Kind: kind, Name: "x", Clips: []drama.TimelineClip{}})
		}
		return out
	}
	tooLong := make([]drama.TimelineClip, 0, 201)
	for i := range 201 {
		tooLong = append(tooLong, textClip(fmt.Sprintf("l%d", i), "字", int64(i)*1000, 600))
	}
	cases := []struct {
		name   string
		tracks []drama.Track
		want   string
	}{
		{"没有主轨", []drama.Track{textTrack("t1")}, "时间线必须有且只有一条主轨"},
		{"两条主轨", append(withMain(), drama.Track{ID: "main2", Kind: drama.TrackMain, Name: "主轨", Clips: []drama.TimelineClip{}}), "时间线必须有且只有一条主轨"},
		{"叠加轨超限", many(drama.TrackOverlay, 5), "叠加轨最多 4 条"},
		{"字幕轨超限", many(drama.TrackText, 5), "字幕轨最多 4 条"},
		{"音频轨超限", many(drama.TrackAudio, 7), "音频轨最多 6 条"},
		{"轨道类型未知", withMain(drama.Track{ID: "z", Kind: "effect", Name: "特效"}), "特效：不支持的轨道类型"},
		{"轨道 ID 重复", withMain(textTrack("main")), "轨道 ID 重复"},
		{"轨道 ID 为空", withMain(textTrack("")), "轨道 ID 不合法"},
		{"轨道名过长", withMain(drama.Track{ID: "t1", Kind: drama.TrackText, Name: strings.Repeat("长", 21)}), "轨道名不能超过 20 个字"},
		{"非音频轨设了用途", withMain(drama.Track{ID: "t1", Kind: drama.TrackText, Name: "字幕", Role: drama.RoleMusic}), "字幕：只有音频轨可以设置用途"},
		{"音频轨用途不合法", withMain(drama.Track{ID: "a1", Kind: drama.TrackAudio, Name: "配音", Role: "bgm"}), "配音：音频轨用途不合法"},
		{"片段 ID 跨轨重复", withMain(audioTrack("a1", audioClip("m1", 5, 0, 0, 1000))), "配音 第 1 段：段 ID 重复"},
		{"同轨重叠", withMain(audioTrack("a1", audioClip("x1", 5, 0, 0, 2000), audioClip("x2", 5, 1500, 0, 1000))), "配音 第 2 段：与同轨的其他片段重叠"},
		{"音频轨放图片", withMain(audioTrack("a1", drama.TimelineClip{ID: "x", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 1000, Volume: 100})), "配音 第 1 段：这条轨放不了这种片段"},
		{"叠加轨放音频", withMain(overlayTrack("o1", audioClip("x", 5, 0, 0, 1000))), "叠加 第 1 段：这条轨放不了这种片段"},
		{"字幕轨放素材", withMain(textTrack("t1", audioClip("x", 5, 0, 0, 1000))), "字幕 第 1 段：这条轨放不了这种片段"},
		{"主轨放文字", []drama.Track{{ID: "main", Kind: drama.TrackMain, Name: "主轨", Clips: []drama.TimelineClip{textClip("x", "字", 0, 1000)}}}, "主轨 第 1 段：这条轨放不了这种片段"},
		{"音频超出素材长度", withMain(audioTrack("a1", audioClip("x", 5, 0, 0, 5000))), "配音 第 1 段：超出素材长度"},
		{"音量超限", withMain(audioTrack("a1", func() drama.TimelineClip { c := audioClip("x", 5, 0, 0, 1000); c.Volume = 201; return c }())), "配音 第 1 段：音量要在 0–200"},
		{"淡入淡出超过时长", withMain(audioTrack("a1", func() drama.TimelineClip {
			c := audioClip("x", 5, 0, 0, 1000)
			c.FadeInMS, c.FadeOutMS = 600, 600
			return c
		}())), "配音 第 1 段：淡入淡出加起来不能超过片段时长"},
		{"淡入为负", withMain(audioTrack("a1", func() drama.TimelineClip { c := audioClip("x", 5, 0, 0, 1000); c.FadeInMS = -1; return c }())), "配音 第 1 段：淡入淡出不能为负"},
		{"起点为负", withMain(audioTrack("a1", audioClip("x", 5, -1, 0, 1000))), "配音 第 1 段：起点不能为负"},
		{"叠加缩放过小", withMain(overlayTrack("o1", func() drama.TimelineClip { c := overlayImage("x", 9, 0, 1000); c.Scale = 5; return c }())), "叠加 第 1 段：叠加画面缩放要在 10–100"},
		{"叠加位置越界", withMain(overlayTrack("o1", func() drama.TimelineClip { c := overlayImage("x", 9, 0, 1000); c.X = 101; return c }())), "叠加 第 1 段：叠加画面位置要在 0–100"},
		{"叠加不透明度越界", withMain(overlayTrack("o1", func() drama.TimelineClip { c := overlayImage("x", 9, 0, 1000); c.Opacity = 101; return c }())), "叠加 第 1 段：叠加画面不透明度要在 0–100"},
		{"叠加片段没选版本", withMain(overlayTrack("o1", overlayTake("x", 1, 0, 0, 1000))), "叠加 第 1 段：附属轨的片段必须选定版本"},
		{"叠加版本不属于片段", withMain(overlayTrack("o1", overlayTake("x", 1, 21, 0, 1000))), "叠加 第 1 段：这个版本不可用"},
		{"字幕为空", withMain(textTrack("t1", textClip("x", "  ", 0, 1000))), "字幕 第 1 段：字幕文字不能为空"},
		{"字幕过长", withMain(textTrack("t1", textClip("x", strings.Repeat("字", 201), 0, 1000))), "字幕 第 1 段：字幕文字不能超过 200 个字"},
		{"字幕样式不合法", withMain(textTrack("t1", func() drama.TimelineClip { c := textClip("x", "字", 0, 1000); c.Style = "big"; return c }())), "字幕 第 1 段：字幕样式不合法"},
		{"字幕位置不合法", withMain(textTrack("t1", func() drama.TimelineClip { c := textClip("x", "字", 0, 1000); c.Pos = "left"; return c }())), "字幕 第 1 段：字幕位置不合法"},
		{"字幕字号越界", withMain(textTrack("t1", func() drama.TimelineClip { c := textClip("x", "字", 0, 1000); c.Size = 50; return c }())), "字幕 第 1 段：字幕字号要在 60–180"},
		{"字幕带入点", withMain(textTrack("t1", func() drama.TimelineClip { c := textClip("x", "字", 0, 1000); c.InMS = 100; return c }())), "字幕 第 1 段：文字段的入点必须为 0"},
		{"单轨段数超限", withMain(textTrack("t1", tooLong...)), "字幕：一条轨最多 200 段"},
		{"附属轨超出总长", withMain(textTrack("t1", textClip("x", "字", 29*60*1000+30*1000, 2*60*1000))), "时间线总长不能超过 30 分钟"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := drama.ValidateTimeline(tc.tracks, segs(), trackAssets())
			if err == nil || err.Error() != tc.want {
				t.Fatalf("错误 = %v，期望 %q", err, tc.want)
			}
		})
	}
}

func TestValidateTimeline_TotalClips(t *testing.T) {
	var extra []drama.Track
	for k := range 3 {
		clips := make([]drama.TimelineClip, 0, 200)
		for i := range 200 {
			clips = append(clips, textClip(fmt.Sprintf("c%d-%d", k, i), "字", int64(i)*1000, 600))
		}
		extra = append(extra, textTrack(fmt.Sprintf("t%d", k), clips...))
	}
	err := drama.ValidateTimeline(withMain(extra...), segs(), trackAssets())
	if err == nil || err.Error() != "时间线最多 400 段" {
		t.Fatalf("总段数超限错误 = %v", err)
	}
}

func TestReconcileTimeline_OnlyMainTrack(t *testing.T) {
	attached := []drama.Track{
		textTrack("t1", textClip("s1", "你好", 0, 2000)),
		audioTrack("a1", audioClip("a1c", 5, 2000, 0, 4000)),
	}
	main := drama.Track{ID: "main", Kind: drama.TrackMain, Name: "主轨", Muted: true, Clips: []drama.TimelineClip{seg("a", 1, 11, 0, 15000), seg("b", 2, 21, 0, 15000)}}
	in := []drama.Track{attached[0], main, attached[1]}
	changeSegs := segs()
	changeSegs[1].Chosen = 23 // 片段 02 换了采用
	out, removed, changes := drama.ReconcileTimeline(in, nil, changeSegs[:2], ids())
	if len(out) != 3 || out[0].ID != "t1" || out[1].ID != "main" || out[2].ID != "a1" {
		t.Fatalf("轨道顺序应保持不变：%+v", out)
	}
	if !reflect.DeepEqual(out[0], attached[0]) || !reflect.DeepEqual(out[2], attached[1]) {
		t.Fatal("附属轨应原样透传")
	}
	if !out[1].Muted || out[1].Name != "主轨" {
		t.Fatalf("主轨属性应保留：%+v", out[1])
	}
	if got := out[1].Clips[1]; got.TaskID != 23 || got.OutMS != 10000 {
		t.Fatalf("主轨应跟随换采用：%+v", got)
	}
	if len(changes) != 1 || changes[0].Kind != drama.ChangeSwapped || len(removed) != 0 {
		t.Fatalf("变化 %+v 删除名单 %v", changes, removed)
	}
	if in[1].Clips[1].TaskID != 21 {
		t.Fatal("不应修改传入的轨道")
	}
}

func TestReconcileTimeline_MissingMainGetsCreated(t *testing.T) {
	out, _, changes := drama.ReconcileTimeline([]drama.Track{textTrack("t1")}, nil, segs()[:1], ids())
	var main *drama.Track
	for i := range out {
		if out[i].Kind == drama.TrackMain {
			main = &out[i]
		}
	}
	if main == nil || len(main.Clips) != 1 || main.Clips[0].SegmentID != 1 || len(changes) != 1 {
		t.Fatalf("缺主轨时应补一条：%+v %+v", out, changes)
	}
}

func TestBrokenClips_AllTracks(t *testing.T) {
	tracks := []drama.Track{
		{ID: "main", Kind: drama.TrackMain, Name: "主轨", Clips: []drama.TimelineClip{seg("a", 1, 12, 0, 12000), seg("d", 4, 0, 0, 15000)}},
		overlayTrack("o1", overlayTake("ok", 2, 21, 0, 1000), overlayTake("bad", 2, 999, 0, 1000), overlayImage("img", 9, 0, 1000), overlayImage("gone", 77, 0, 1000)),
		audioTrack("a1", audioClip("snd", 5, 0, 0, 1000), audioClip("snd2", 6, 0, 0, 1000)),
		textTrack("t1", textClip("txt", "字", 0, 1000)),
	}
	assets := map[uint64]drama.TimelineAsset{9: {Media: drama.MediaImage}, 5: {Media: drama.MediaAudio}, 6: {Media: drama.MediaVideo}}
	got := drama.BrokenClips(tracks, segs(), assets)
	if want := []string{"bad", "gone", "snd2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("失效段 = %v，期望 %v", got, want)
	}
}

func TestNormalizeTracks(t *testing.T) {
	in := []drama.Track{
		{ID: "t1", Kind: drama.TrackText, Clips: []drama.TimelineClip{{ID: "s", Kind: drama.ClipText, Text: " 你好 ", Style: "subtitle", Pos: "bottom", Size: 100, StartMS: 0, OutMS: 1000, Volume: 30, FadeInMS: 100, X: 5}}},
		{ID: "main", Kind: drama.TrackMain, Name: "主轨", Clips: []drama.TimelineClip{{ID: "m", Kind: drama.ClipSegment, SegmentID: 1, StartMS: 900, OutMS: 1000, Volume: 100, Text: "x", Size: 99, Scale: 50}}},
		{ID: "a1", Kind: drama.TrackAudio, Clips: []drama.TimelineClip{}},
		{ID: "o1", Kind: drama.TrackOverlay, Name: "叠加", Clips: []drama.TimelineClip{{ID: "o", Kind: drama.ClipAsset, Media: drama.MediaImage, StartMS: 10, OutMS: 1000, Volume: 100, X: 1, Y: 2, Scale: 30, Opacity: 40}}},
	}
	got := drama.NormalizeTracks(in)
	if c := got[0].Clips[0]; c.Text != "你好" || c.Volume != 100 || c.FadeInMS != 0 || c.X != 0 {
		t.Fatalf("字幕应去掉首尾空白并清掉无关字段：%+v", c)
	}
	if got[0].Name != "字幕" || got[1].Name != "主轨" || got[2].Name != "音频" || got[2].Role != drama.RoleSfx {
		t.Fatalf("空名字按类型补默认名、音频轨缺用途补音效：%+v", got)
	}
	if c := got[1].Clips[0]; c.StartMS != 0 || c.Text != "" || c.Size != 0 || c.Scale != 0 {
		t.Fatalf("主轨段不存起点和叠加/文字字段：%+v", c)
	}
	if c := got[3].Clips[0]; c.StartMS != 10 || c.X != 1 || c.Scale != 30 || c.Opacity != 40 {
		t.Fatalf("叠加段保留叠加参数：%+v", c)
	}
	if in[0].Clips[0].Text != " 你好 " {
		t.Fatal("不应修改传入的轨道")
	}
}
