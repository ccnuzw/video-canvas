package drama_test

import (
	"fmt"
	"reflect"
	"testing"

	"video-canvas/internal/drama"
)

// ids 生成可预测的新段 ID，便于断言插入位置。
func ids() func() string {
	n := 0
	return func() string { n++; return fmt.Sprintf("n%d", n) }
}

// segs 是 4 个片段：01、02 已采用，03 已采用（只有一条），04 没有采用。
func segs() []drama.TimelineSegment {
	return []drama.TimelineSegment{
		{ID: 1, Seq: 0, Seconds: 15, Chosen: 11, Takes: map[uint64]int64{11: 15000, 12: 12000}},
		{ID: 2, Seq: 1, Seconds: 15, Chosen: 21, Takes: map[uint64]int64{21: 15000, 22: 15000, 23: 10000}},
		{ID: 3, Seq: 2, Seconds: 15, Chosen: 31, Takes: map[uint64]int64{31: 15000}},
		{ID: 4, Seq: 3, Seconds: 15},
	}
}

func seg(id string, sid, task uint64, in, out int64) drama.TimelineClip {
	return drama.TimelineClip{ID: id, Kind: drama.ClipSegment, SegmentID: sid, TaskID: task, InMS: in, OutMS: out, Volume: 100}
}

func TestDefaultTimeline(t *testing.T) {
	got := drama.DefaultTimeline(segs(), ids())
	main := []drama.TimelineClip{
		seg("n1", 1, 11, 0, 15000), seg("n2", 2, 21, 0, 15000), seg("n3", 3, 31, 0, 15000), seg("n4", 4, 0, 0, 15000),
	}
	want := []drama.Track{
		{ID: "text1", Kind: drama.TrackText, Name: "字幕", Clips: []drama.TimelineClip{}},
		{ID: "overlay1", Kind: drama.TrackOverlay, Name: "叠加", Clips: []drama.TimelineClip{}},
		{ID: "main", Kind: drama.TrackMain, Name: "主轨", Clips: main},
		{ID: "voice1", Kind: drama.TrackAudio, Role: drama.RoleVoice, Name: "配音", Clips: []drama.TimelineClip{}},
		{ID: "music1", Kind: drama.TrackAudio, Role: drama.RoleMusic, Name: "BGM", Clips: []drama.TimelineClip{}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("默认时间线 = %+v，期望 %+v", got, want)
	}
}

func TestReconcileClips(t *testing.T) {
	base := func() []drama.TimelineClip {
		return []drama.TimelineClip{
			seg("a", 1, 11, 0, 15000),
			seg("b", 2, 21, 2000, 14000),
			{ID: "x", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 3000},
			seg("c", 3, 31, 0, 15000),
			seg("d", 4, 0, 0, 15000),
		}
	}
	cases := []struct {
		name       string
		clips      func() []drama.TimelineClip
		removed    []uint64
		change     func(s []drama.TimelineSegment) []drama.TimelineSegment
		want       func(c []drama.TimelineClip) []drama.TimelineClip
		changes    []drama.TimelineChange
		removedOut []uint64
	}{
		{
			name:   "没有变化",
			clips:  base,
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment { return s },
			want:   func(c []drama.TimelineClip) []drama.TimelineClip { return c },
		},
		{
			name:  "换了采用版本：入出点保留，超出新长度收回",
			clips: base,
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s[1].Chosen = 23
				return s
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				c[1].TaskID, c[1].OutMS = 23, 10000
				return c
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeSwapped, SegmentID: 2, Seq: 1, ClipID: "b"}},
		},
		{
			name: "换版本后入点也越界：恢复全长",
			clips: func() []drama.TimelineClip {
				c := base()
				c[1].InMS, c[1].OutMS = 11000, 14000
				return c
			},
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s[1].Chosen = 23
				return s
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				c[1].TaskID, c[1].InMS, c[1].OutMS = 23, 0, 10000
				return c
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeSwapped, SegmentID: 2, Seq: 1, ClipID: "b"}},
		},
		{
			name: "固定版本不跟随",
			clips: func() []drama.TimelineClip {
				c := base()
				c[1].Pinned = true
				return c
			},
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s[1].Chosen = 23
				return s
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip { return c },
		},
		{
			name:  "占位片段采用了：变成全长跟随段",
			clips: base,
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s[3].Chosen, s[3].Takes = 41, map[uint64]int64{41: 12000}
				return s
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				c[4].TaskID, c[4].OutMS = 41, 12000
				return c
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeAdopted, SegmentID: 4, Seq: 3, ClipID: "d"}},
		},
		{
			name:  "取消采用：变成待采用占位",
			clips: base,
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s[0].Chosen = 0
				return s
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				c[0].TaskID = 0
				return c
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeUnadopted, SegmentID: 1, Seq: 0, ClipID: "a"}},
		},
		{
			name: "片段删除：所有同源段移除，删除名单里也去掉",
			clips: func() []drama.TimelineClip {
				c := base()
				return append(c, seg("c2", 3, 31, 0, 5000))
			},
			removed: []uint64{3, 99},
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s = append(s[:2], s[3])
				s[2].Seq = 2
				return s
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				return []drama.TimelineClip{c[0], c[1], c[2], c[4]}
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeRemoved, SegmentID: 3, Seq: 2}},
		},
		{
			name:  "新增片段：插在最后一个序号更小的片段后面",
			clips: base,
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment {
				s[2].Seq, s[3].Seq = 3, 4
				return append(s, drama.TimelineSegment{ID: 5, Seq: 2, Seconds: 8})
			},
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				return []drama.TimelineClip{c[0], c[1], seg("n1", 5, 0, 0, 8000), c[2], c[3], c[4]}
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeAdded, SegmentID: 5, Seq: 2, ClipID: "n1"}},
		},
		{
			name: "用户删过的片段不自动加回",
			clips: func() []drama.TimelineClip {
				c := base()
				return append(c[:3], c[4])
			},
			removed:    []uint64{3},
			change:     func(s []drama.TimelineSegment) []drama.TimelineSegment { s[2].Chosen = 31; return s },
			want:       func(c []drama.TimelineClip) []drama.TimelineClip { return c },
			removedOut: []uint64{3},
		},
		{
			name: "新片段排在最前",
			clips: func() []drama.TimelineClip {
				return []drama.TimelineClip{{ID: "x", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 3000}}
			},
			change: func(s []drama.TimelineSegment) []drama.TimelineSegment { return s[:1] },
			want: func(c []drama.TimelineClip) []drama.TimelineClip {
				return []drama.TimelineClip{seg("n1", 1, 11, 0, 15000), c[0]}
			},
			changes: []drama.TimelineChange{{Kind: drama.ChangeAdded, SegmentID: 1, Seq: 0, ClipID: "n1"}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := tc.clips()
			got, removed, changes := drama.ReconcileClips(before, tc.removed, tc.change(segs()), ids())
			want := tc.want(tc.clips())
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("段 = %+v\n期望 %+v", got, want)
			}
			if !reflect.DeepEqual(changes, tc.changes) {
				t.Fatalf("变化 = %+v，期望 %+v", changes, tc.changes)
			}
			if len(removed) != len(tc.removedOut) || (len(removed) > 0 && !reflect.DeepEqual(removed, tc.removedOut)) {
				t.Fatalf("删除名单 = %v，期望 %v", removed, tc.removedOut)
			}
			if !reflect.DeepEqual(before, tc.clips()) {
				t.Fatal("不应修改传入的切片")
			}
		})
	}
}

func TestBrokenClips(t *testing.T) {
	clips := []drama.TimelineClip{
		seg("a", 1, 12, 0, 12000),
		{ID: "p", Kind: drama.ClipSegment, SegmentID: 1, TaskID: 13, Pinned: true, OutMS: 5000},
		{ID: "x", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 3000},
		{ID: "y", Kind: drama.ClipAsset, AssetID: 8, Media: drama.MediaVideo, OutMS: 3000},
		seg("d", 4, 0, 0, 15000),
	}
	assets := map[uint64]drama.TimelineAsset{9: {Media: drama.MediaImage}}
	got := drama.BrokenClips(mainOnly(clips), segs(), assets)
	if want := []string{"p", "y"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("失效段 = %v，期望 %v", got, want)
	}
}

func TestValidateTimeline(t *testing.T) {
	assets := map[uint64]drama.TimelineAsset{9: {Media: drama.MediaImage}, 8: {Media: drama.MediaVideo, DurationMS: 6000}}
	ok := []drama.TimelineClip{
		seg("a", 1, 12, 1000, 12000),
		{ID: "x", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 3000},
		{ID: "y", Kind: drama.ClipAsset, AssetID: 8, Media: drama.MediaVideo, InMS: 500, OutMS: 6000},
		seg("d", 4, 0, 0, 15000),
	}
	if err := drama.ValidateTimeline(mainOnly(ok), segs(), assets); err != nil {
		t.Fatalf("合法时间线报错：%v", err)
	}
	bad := []struct {
		name  string
		clips []drama.TimelineClip
		want  string
	}{
		{"段 ID 重复", []drama.TimelineClip{seg("a", 1, 11, 0, 15000), seg("a", 2, 21, 0, 15000)}, "主轨 第 2 段：段 ID 重复"},
		{"段 ID 为空", []drama.TimelineClip{seg("", 1, 11, 0, 15000)}, "主轨 第 1 段：段 ID 不合法"},
		{"不认识的种类", []drama.TimelineClip{{ID: "a", Kind: "audio", OutMS: 1000}}, "主轨 第 1 段：不支持的段类型"},
		{"不足 0.5 秒", []drama.TimelineClip{seg("a", 1, 11, 0, 400)}, "主轨 第 1 段：每段至少 0.5 秒"},
		{"入点为负", []drama.TimelineClip{seg("a", 1, 11, -1, 4000)}, "主轨 第 1 段：每段至少 0.5 秒"},
		{"超出素材长度", []drama.TimelineClip{seg("a", 1, 12, 0, 13000)}, "主轨 第 1 段：超出素材长度"},
		{"片段不属于这一集", []drama.TimelineClip{seg("a", 7, 11, 0, 1000)}, "主轨 第 1 段：片段不存在"},
		{"版本不属于片段", []drama.TimelineClip{seg("a", 1, 21, 0, 1000)}, "主轨 第 1 段：这个版本不可用"},
		{"素材不存在", []drama.TimelineClip{{ID: "a", Kind: drama.ClipAsset, AssetID: 7, Media: drama.MediaVideo, OutMS: 1000}}, "主轨 第 1 段：素材不存在"},
		{"素材种类不符", []drama.TimelineClip{{ID: "a", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaVideo, OutMS: 1000}}, "主轨 第 1 段：素材类型不符"},
		{"图片带入点", []drama.TimelineClip{{ID: "a", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, InMS: 100, OutMS: 3000}}, "主轨 第 1 段：图片时长要在 0.5–30 秒"},
		{"图片超 30 秒", []drama.TimelineClip{{ID: "a", Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 31000}}, "主轨 第 1 段：图片时长要在 0.5–30 秒"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			err := drama.ValidateTimeline(mainOnly(tc.clips), segs(), assets)
			if err == nil || err.Error() != tc.want {
				t.Fatalf("错误 = %v，期望 %q", err, tc.want)
			}
		})
	}
	long := make([]drama.TimelineClip, 0, 130)
	for i := range 130 {
		long = append(long, drama.TimelineClip{ID: fmt.Sprintf("x%d", i), Kind: drama.ClipAsset, AssetID: 9, Media: drama.MediaImage, OutMS: 15000})
	}
	if err := drama.ValidateTimeline(mainOnly(long), segs(), assets); err == nil || err.Error() != "时间线总长不能超过 30 分钟" {
		t.Fatalf("总长超限错误 = %v", err)
	}
}

// mainOnly 只有一条主轨的时间线。
func mainOnly(clips []drama.TimelineClip) []drama.Track {
	return []drama.Track{{ID: "main", Kind: drama.TrackMain, Name: "主轨", Clips: clips}}
}
