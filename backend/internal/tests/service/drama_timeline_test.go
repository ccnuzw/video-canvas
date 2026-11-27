package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/service/dramasegmentfake"
)

// timelineRepo 集10有两个片段：01 采用了结果 101（15 秒，另有 12 秒的 102），02 还没采用；
// 用户另有导入图片 601、音频 801，别人的图片 701。
func timelineRepo() *dramasegmentfake.Repo {
	r := dramasegmentfake.New()
	chosen, canvas := uint64(101), uint64(9)
	r.Rows = []model.DramaSegment{
		{BaseModel: model.BaseModel{ID: 1}, UserID: 1, EpisodeID: 10, Seq: 0, Seconds: 15, ChosenTaskID: &chosen, Revision: 1},
		{BaseModel: model.BaseModel{ID: 2}, UserID: 1, EpisodeID: 10, Seq: 1, Seconds: 15, Revision: 1},
	}
	task := func(id uint64, asset string) model.GenerationTask {
		return model.GenerationTask{ID: id, UserID: 1, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(1), Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: []byte(`[{"asset_id":` + asset + `,"media_type":"video"}]`)}
	}
	r.Tasks = []model.GenerationTask{task(101, "501"), task(102, "502")}
	r.Library = []model.Asset{
		{ID: 501, UserID: 1, Kind: "video", DurationMs: 15000},
		{ID: 502, UserID: 1, Kind: "video", DurationMs: 12000},
		{ID: 601, UserID: 1, Kind: "image"},
		{ID: 701, UserID: 2, Kind: "image"},
		{ID: 801, UserID: 1, Kind: "audio", DurationMs: 8000},
	}
	return r
}

func segClip(id string, sid, task uint64, in, out int64) model.DramaTimelineClip {
	return model.DramaTimelineClip{ID: id, Kind: model.TimelineKindSegment, SegmentID: idcodec.ID(sid), TaskID: idcodec.ID(task), InMS: in, OutMS: out, Volume: 100}
}

func imageClip(id string, asset uint64, out int64) model.DramaTimelineClip {
	return model.DramaTimelineClip{ID: id, Kind: model.TimelineKindAsset, AssetID: asset, Media: model.TimelineMediaImage, OutMS: out, Volume: 100}
}

func audioViewClip(id string, asset uint64, start, out int64) model.DramaTimelineClip {
	return model.DramaTimelineClip{ID: id, Kind: model.TimelineKindAsset, AssetID: asset, Media: model.TimelineMediaAudio, StartMS: start, OutMS: out, Volume: 100}
}

func trackOf(id, kind string, clips ...model.DramaTimelineClip) model.DramaTimelineTrack {
	name := id
	if kind == model.TimelineTrackMain {
		name = "主轨"
	}
	return model.DramaTimelineTrack{ID: id, Kind: kind, Name: name, Clips: clips}
}

// mainOf 取视图里的主轨。
func mainOf(t *testing.T, v *model.DramaTimelineView) model.DramaTimelineTrack {
	t.Helper()
	for _, tr := range v.Tracks {
		if tr.Kind == model.TimelineTrackMain {
			return tr
		}
	}
	t.Fatalf("视图里没有主轨：%+v", v.Tracks)
	return model.DramaTimelineTrack{}
}

func trackByID(t *testing.T, v *model.DramaTimelineView, id string) model.DramaTimelineTrack {
	t.Helper()
	for _, tr := range v.Tracks {
		if tr.ID == id {
			return tr
		}
	}
	t.Fatalf("视图里没有轨 %s：%+v", id, v.Tracks)
	return model.DramaTimelineTrack{}
}

func TestDramaTimeline_DefaultWhenNeverSaved(t *testing.T) {
	s := segmentService(timelineRepo())
	v, err := s.Timeline(context.Background(), 1, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if v.Revision != 0 || len(v.Changes) != 0 || len(v.InvalidClipIDs) != 0 || len(v.Tracks) != 5 {
		t.Fatalf("默认时间线 %+v", v)
	}
	var kinds []string
	for _, tr := range v.Tracks {
		kinds = append(kinds, tr.ID)
	}
	if got := strings.Join(kinds, ","); got != "text1,overlay1,main,voice1,music1" {
		t.Fatalf("默认轨道 %s", got)
	}
	clips := mainOf(t, v).Clips
	if len(clips) != 2 {
		t.Fatalf("主轨 %+v", clips)
	}
	first, second := clips[0], clips[1]
	if uint64(first.SegmentID) != 1 || uint64(first.TaskID) != 101 || first.InMS != 0 || first.OutMS != 15000 || first.Volume != 100 {
		t.Fatalf("第一段 %+v", first)
	}
	if uint64(second.SegmentID) != 2 || second.TaskID != 0 || second.OutMS != 15000 {
		t.Fatalf("待采用占位 %+v", second)
	}
	if v.Tracks[3].Role != model.TimelineRoleVoice || v.Tracks[4].Role != model.TimelineRoleMusic {
		t.Fatalf("音频轨用途 %+v", v.Tracks)
	}
}

func TestDramaTimeline_SaveReconcileAndConflict(t *testing.T) {
	r := timelineRepo()
	s := segmentService(r)
	ctx := context.Background()
	main := trackOf("main", model.TimelineTrackMain, segClip("a", 1, 101, 2000, 14000), imageClip("x", 601, 3000))
	main.Muted = true
	voice := trackOf("voice1", model.TimelineTrackAudio, audioViewClip("v1", 801, 1000, 4000))
	voice.Role = model.TimelineRoleVoice
	req := &model.SaveDramaTimelineReq{
		Tracks:            []model.DramaTimelineTrack{main, voice},
		RemovedSegmentIDs: []idcodec.ID{2},
		Imports:           []uint64{601, 701, 601, 801},
	}
	// 1. 第一次保存：版本 0 → 1，片段版本自增让成片过期；已导入去掉别人的素材和重复项，音频可以导入。
	v, err := s.SaveTimeline(ctx, 1, 7, 1, req)
	if err != nil {
		t.Fatal(err)
	}
	if v.Revision != 1 || r.SegmentVersion != 1 || len(v.Tracks) != 2 || len(v.Changes) != 0 {
		t.Fatalf("保存结果 %+v，片段版本 %d", v, r.SegmentVersion)
	}
	if !mainOf(t, v).Muted || len(mainOf(t, v).Clips) != 2 {
		t.Fatalf("主轨 %+v", mainOf(t, v))
	}
	if len(v.Imports) != 2 || v.Imports[0] != 601 || v.Imports[1] != 801 || len(v.RemovedSegmentIDs) != 1 || len(v.Assets) != 2 {
		t.Fatalf("已导入或删除名单 %+v", v)
	}
	if got := trackByID(t, v, "voice1").Clips[0]; got.StartMS != 1000 || got.Media != model.TimelineMediaAudio {
		t.Fatalf("配音段 %+v", got)
	}
	// 2. 旧版本再保存：冲突，不写入。
	_, err = s.SaveTimeline(ctx, 1, 7, 1, req)
	segmentCode(t, err, errcode.ErrDramaTimelineConflict.Code)
	if r.SegmentVersion != 1 {
		t.Fatal("冲突时不应改片段版本")
	}
	// 3. 片场换了采用：主轨跟随，出点收回到新版本的 12 秒；附属轨原样；删掉的片段 02 不加回来。
	other := uint64(102)
	r.Rows[0].ChosenTaskID = &other
	v, err = s.Timeline(ctx, 1, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	clips := mainOf(t, v).Clips
	if len(clips) != 2 || uint64(clips[0].TaskID) != 102 || clips[0].InMS != 2000 || clips[0].OutMS != 12000 {
		t.Fatalf("对账后 %+v", clips)
	}
	if len(trackByID(t, v, "voice1").Clips) != 1 {
		t.Fatalf("附属轨应保留：%+v", v.Tracks)
	}
	if len(v.Changes) != 1 || v.Changes[0].Kind != model.TimelineChangeSwapped || v.Changes[0].ClipID != "a" {
		t.Fatalf("变化 %+v", v.Changes)
	}
	// 4. 固定的版本被删（结果不再成功）：标成失效段。
	req.Revision = 1
	pinned := segClip("a", 1, 101, 0, 15000)
	pinned.Pinned = true
	req.Tracks = []model.DramaTimelineTrack{trackOf("main", model.TimelineTrackMain, pinned)}
	if _, err := s.SaveTimeline(ctx, 1, 7, 1, req); err != nil {
		t.Fatal(err)
	}
	r.Tasks[0].Status = model.TaskFailed
	v, err = s.Timeline(ctx, 1, 7, 1)
	if err != nil || len(v.InvalidClipIDs) != 1 || v.InvalidClipIDs[0] != "a" {
		t.Fatalf("失效段 %+v %v", v, err)
	}
}

func TestDramaTimeline_AttachedTracksNormalizedAndBroken(t *testing.T) {
	r := timelineRepo()
	s := segmentService(r)
	ctx := context.Background()
	text := model.DramaTimelineClip{ID: "s1", Kind: model.TimelineKindText, Text: " 你好 ", Style: "subtitle", Pos: "bottom", Size: 100, StartMS: 500, OutMS: 2000, Volume: 30, X: 9}
	overlay := segClip("o1", 1, 102, 0, 4000)
	overlay.StartMS, overlay.X, overlay.Y, overlay.Scale, overlay.Opacity = 1000, 72, 22, 42, 100
	req := &model.SaveDramaTimelineReq{Tracks: []model.DramaTimelineTrack{
		{ID: "t1", Kind: model.TimelineTrackText, Clips: []model.DramaTimelineClip{text}},
		{ID: "ov1", Kind: model.TimelineTrackOverlay, Clips: []model.DramaTimelineClip{overlay}},
		{ID: "main", Kind: model.TimelineTrackMain, Clips: []model.DramaTimelineClip{segClip("a", 1, 101, 0, 15000)}},
		{ID: "a1", Kind: model.TimelineTrackAudio},
	}}
	v, err := s.SaveTimeline(ctx, 1, 7, 1, req)
	if err != nil {
		t.Fatal(err)
	}
	if got := trackByID(t, v, "t1"); got.Name != "字幕" || got.Clips[0].Text != "你好" || got.Clips[0].Volume != 100 || got.Clips[0].X != 0 {
		t.Fatalf("字幕轨应补默认名并整理字段：%+v", got)
	}
	if got := trackByID(t, v, "a1"); got.Name != "音频" || got.Role != model.TimelineRoleSfx {
		t.Fatalf("音频轨应补默认名和用途：%+v", got)
	}
	if got := trackByID(t, v, "ov1").Clips[0]; !got.Pinned || got.StartMS != 1000 || got.Scale != 42 {
		t.Fatalf("叠加段 %+v", got)
	}
	if len(v.InvalidClipIDs) != 0 {
		t.Fatalf("不应有失效段：%+v", v.InvalidClipIDs)
	}
	// 叠加轨用的版本 102 后来失败了：附属轨上的失效段同样要报出来。
	r.Tasks[1].Status = model.TaskFailed
	v, err = s.Timeline(ctx, 1, 7, 1)
	if err != nil || len(v.InvalidClipIDs) != 1 || v.InvalidClipIDs[0] != "o1" {
		t.Fatalf("附属轨失效段 %+v %v", v.InvalidClipIDs, err)
	}
}

func TestDramaTimeline_SaveRejectsInvalid(t *testing.T) {
	mainWith := func(c model.DramaTimelineClip) []model.DramaTimelineTrack {
		return []model.DramaTimelineTrack{trackOf("main", model.TimelineTrackMain, c)}
	}
	validMain := trackOf("main", model.TimelineTrackMain, segClip("a", 1, 101, 0, 1000))
	for _, tc := range []struct {
		name   string
		tracks []model.DramaTimelineTrack
		msg    string
	}{
		{"别人的素材", mainWith(imageClip("x", 701, 3000)), "主轨 第 1 段：素材不存在"},
		{"别的片段的版本", mainWith(segClip("a", 2, 101, 0, 1000)), "主轨 第 1 段：这个版本不可用"},
		{"超出素材长度", mainWith(segClip("a", 1, 102, 0, 13000)), "主轨 第 1 段：超出素材长度"},
		{"太短", mainWith(segClip("a", 1, 101, 0, 300)), "主轨 第 1 段：每段至少 0.5 秒"},
		{"没有主轨", []model.DramaTimelineTrack{trackOf("t1", model.TimelineTrackText)}, "时间线必须有且只有一条主轨"},
		{"音频轨放图片", []model.DramaTimelineTrack{validMain, trackOf("a1", model.TimelineTrackAudio, imageClip("x", 601, 1000))}, "a1 第 1 段：这条轨放不了这种片段"},
		{"别人的音频", []model.DramaTimelineTrack{validMain, trackOf("a1", model.TimelineTrackAudio, audioViewClip("x", 999, 0, 1000))}, "a1 第 1 段：素材不存在"},
		{"音频超出素材长度", []model.DramaTimelineTrack{validMain, trackOf("a1", model.TimelineTrackAudio, audioViewClip("x", 801, 0, 9000))}, "a1 第 1 段：超出素材长度"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := timelineRepo()
			_, err := segmentService(r).SaveTimeline(context.Background(), 1, 7, 1, &model.SaveDramaTimelineReq{Tracks: tc.tracks})
			var business *errcode.Error
			if !errors.As(err, &business) || business.Code != errcode.ErrDramaTimelineInvalid.Code || !strings.Contains(business.Msg, tc.msg) {
				t.Fatalf("错误 %v，期望 %q", err, tc.msg)
			}
			if r.TimelineRow != nil || r.SegmentVersion != 0 {
				t.Fatal("不合法时不应写入")
			}
		})
	}
}

func TestDramaTimeline_Ownership(t *testing.T) {
	s := segmentService(timelineRepo())
	_, err := s.Timeline(context.Background(), 2, 7, 1)
	segmentCode(t, err, errcode.ErrDramaNotFound.Code)
	_, err = s.SaveTimeline(context.Background(), 1, 7, 9, &model.SaveDramaTimelineReq{})
	segmentCode(t, err, errcode.ErrDramaNotFound.Code)
}
