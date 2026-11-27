package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/videoframe"
	"video-canvas/internal/provider"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

type composeMemory struct {
	*dramaMemory
	tasks       []model.GenerationTask
	assets      []model.Asset
	creditCalls int
	insertErr   error
	// timeline 已保存的时间线；nil 表示没剪过
	timeline *model.DramaEpisodeTimeline
	// library 用户素材库（结果视频、导入的素材）
	library []model.Asset
}

func newComposeMemory() *composeMemory {
	r := &composeMemory{dramaMemory: newDramaMemory()}
	r.episodes = []model.DramaEpisode{{BaseModel: model.BaseModel{ID: 3}, UserID: 7, DramaID: 1, No: 1, LockedAt: func() *time.Time { v := time.Now(); return &v }(), Revision: 1}}
	canvas, chosen := uint64(2), uint64(20)
	r.segments = []model.DramaSegment{{BaseModel: model.BaseModel{ID: 5}, UserID: 7, EpisodeID: 3, Seq: 0, ChosenTaskID: &chosen}, {BaseModel: model.BaseModel{ID: 6}, UserID: 7, EpisodeID: 3, Seq: 1}}
	r.tasks = []model.GenerationTask{{ID: chosen, UserID: 7, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(5), Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: []byte(`[{"asset_id":30,"media_type":"video"}]`)}}
	r.library = []model.Asset{{ID: 30, UserID: 7, Kind: "video", DurationMs: 5000}}
	return r
}

func (r *composeMemory) Timeline(_ context.Context, user, episode uint64) (*model.DramaEpisodeTimeline, error) {
	if r.timeline == nil || r.timeline.UserID != user || r.timeline.EpisodeID != episode {
		return nil, repository.ErrNotFound
	}
	row := *r.timeline
	return &row, nil
}
func (r *composeMemory) SaveTimeline(_ context.Context, row *model.DramaEpisodeTimeline, revision int64) error {
	if r.timeline != nil && r.timeline.Revision != revision {
		return repository.ErrStateConflict
	}
	saved := *row
	saved.ID, saved.Revision = 1, revision+1
	r.timeline, row.Revision = &saved, revision+1
	return nil
}
func (r *composeMemory) TimelineAssets(_ context.Context, user uint64, ids []uint64) ([]model.Asset, error) {
	out := []model.Asset{}
	for _, a := range r.library {
		for _, id := range ids {
			if a.ID == id && a.UserID == user {
				out = append(out, a)
			}
		}
	}
	return out, nil
}

func (r *composeMemory) WithTx(ctx context.Context, fn func(repository.DramaTx) error) error {
	before := append([]model.Asset{}, r.assets...)
	err := r.dramaMemory.WithTx(ctx, func(repository.DramaTx) error { return fn(r) })
	if err != nil {
		r.assets = before
	}
	return err
}
func (r *composeMemory) SegmentTasks(_ context.Context, user, canvas uint64, node string) ([]model.GenerationTask, error) {
	out := []model.GenerationTask{}
	for _, task := range r.tasks {
		if task.UserID == user && task.CanvasProjectID != nil && *task.CanvasProjectID == canvas && task.NodeID == node && !task.IsTest {
			out = append(out, task)
		}
	}
	return out, nil
}
func (r *composeMemory) CreateAsset(_ context.Context, asset *model.Asset) error {
	if r.insertErr != nil {
		return r.insertErr
	}
	asset.ID = 99
	r.assets = append(r.assets, *asset)
	return nil
}
func (r *composeMemory) JobByApproval(_ context.Context, user, approval uint64) (*model.DramaJob, error) {
	for _, job := range r.jobs {
		if job.UserID == user && job.ApprovalID != nil && *job.ApprovalID == approval {
			return &job, nil
		}
	}
	return nil, repository.ErrNotFound
}
func (r *composeMemory) EnsureCredit(context.Context, uint64, int) error {
	r.creditCalls++
	return errors.New("compose 不应创建积分账户")
}
func (r *composeMemory) LockCredit(context.Context, uint64) (*model.UserCredit, error) {
	r.creditCalls++
	return nil, errors.New("compose 不应锁积分")
}

type composeFiles struct {
	r           *composeMemory
	prepared    int
	discarded   int
	downloadErr error
}

func (a *composeFiles) Open(_ context.Context, user, id uint64) (*provider.AssetFile, error) {
	if a.downloadErr != nil {
		return nil, a.downloadErr
	}
	for _, asset := range a.r.library {
		if asset.ID == id && asset.UserID == user {
			return &provider.AssetFile{Asset: &asset, Body: io.NopCloser(strings.NewReader("media"))}, nil
		}
	}
	return nil, provider.ErrAssetNotFound
}
func (a *composeFiles) PrepareDramaVideo(_ context.Context, user uint64, path string) (*model.Asset, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	a.prepared++
	return &model.Asset{UserID: user, Kind: "video", Source: model.AssetSourceUpload, StorageKey: "compose.mp4"}, nil
}
func (a *composeFiles) DiscardCopies(_ context.Context, assets []*model.Asset) {
	a.discarded += len(assets)
}
func (a *composeFiles) View(_ context.Context, user, id uint64) (*model.AssetView, error) {
	if user != 7 {
		return nil, repository.ErrNotFound
	}
	return &model.AssetView{ID: id, Kind: "video", URL: "/files/compose.mp4"}, nil
}
func (a *composeFiles) ViewOf(_ context.Context, asset *model.Asset) (*model.AssetView, error) {
	return &model.AssetView{ID: asset.ID, Kind: "video", URL: "/files/compose.mp4"}, nil
}

type composeProcessor struct {
	calls  int
	during func()
	err    error
	inputs []string
	clips  []videoframe.ComposeClip
	ratio  string
	// plan 最近一次收到的完整合成计划（含附属轨）
	plan videoframe.ComposePlan
}

func (p *composeProcessor) ComposeTimeline(_ context.Context, plan videoframe.ComposePlan, ratio, dst string) error {
	p.calls++
	p.plan, p.clips, p.ratio = plan, plan.Main, ratio
	p.inputs = nil
	for _, c := range plan.Main {
		p.inputs = append(p.inputs, c.Path)
	}
	if p.during != nil {
		p.during()
	}
	if p.err != nil {
		return p.err
	}
	return os.WriteFile(dst, []byte("composed"), 0600)
}
func composeService(r *composeMemory, a *composeFiles, p *composeProcessor) *service.DramaService {
	return service.NewDramaService(service.DramaDeps{Repo: r, Segments: r, Assets: a, Compose: p})
}

func TestDramaCompose_ValidationWithoutModelOrCredits(t *testing.T) {
	for _, tc := range []struct {
		name        string
		scope       []int
		user        uint64
		empty, busy bool
		code        int
	}{
		{"成功", []int{1}, 7, false, false, 0},
		{"没有采用", []int{1}, 7, true, false, 67010},
		{"并发", []int{1}, 7, false, true, 67004},
		{"必须单集", []int{1, 2}, 7, false, false, 10001},
		{"必须选集", nil, 7, false, false, 10001},
		{"他人资源", []int{1}, 8, false, false, 67001},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newComposeMemory()
			if tc.empty {
				r.segments[0].ChosenTaskID = nil
			}
			if tc.busy {
				r.jobs = []model.DramaJob{{Status: "running"}}
			}
			s := composeService(r, &composeFiles{r: r}, &composeProcessor{})
			req := &model.DramaJobReq{Step: "compose", Episodes: tc.scope}
			_, err := s.CreateJob(context.Background(), tc.user, 1, req)
			if tc.code != 0 {
				dramaCheckCode(t, err, tc.code)
			} else if err != nil {
				t.Fatal(err)
			}
			if r.creditCalls != 0 || len(r.ledger) != 0 {
				t.Fatal("合成触碰积分")
			}
		})
	}
}

func TestDramaCompose_ResultIdempotenceAndStale(t *testing.T) {
	r := newComposeMemory()
	a, p := &composeFiles{r: r}, &composeProcessor{}
	s := composeService(r, a, p)
	ctx := context.Background()
	quote, err := s.Estimate(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil || quote != 0 {
		t.Fatalf("估价 %d: %v", quote, err)
	}
	job, err := s.CreateAgentJob(ctx, 7, 1, 55, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.CreateAgentJob(ctx, 7, 1, 55, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil || again.ID != job.ID {
		t.Fatalf("审批重复建任务: %+v %v", again, err)
	}
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ListJobs(ctx, 7, 1, false)
	if err != nil || len(jobs) != 1 || jobs[0].Status != "succeeded" || jobs[0].Result == nil {
		t.Fatalf("结果 %+v %v", jobs, err)
	}
	if got := jobs[0].Result; got.Asset.ID != 99 || len(got.SkippedSeqs) != 1 || got.SkippedSeqs[0] != 1 {
		t.Fatalf("合成结果 %+v", got)
	}
	if p.calls != 1 || a.prepared != 1 || len(r.assets) != 1 || r.creditCalls != 0 {
		t.Fatalf("重复执行或扣费: processor=%d prepared=%d assets=%d credits=%d", p.calls, a.prepared, len(r.assets), r.creditCalls)
	}
	for _, path := range p.inputs {
		if _, err := os.Stat(filepath.Dir(path)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("下载临时文件未清理: %v", err)
		}
	}
	view, err := s.Get(ctx, 7, 1)
	if err != nil || view.Episodes[0].Final == nil || view.Episodes[0].FinalStale {
		t.Fatalf("成片概要 %+v %v", view, err)
	}
	r.episodes[0].SegmentVersion++
	view, err = s.Get(ctx, 7, 1)
	if err != nil || !view.Episodes[0].FinalStale {
		t.Fatalf("片段变化未标记过期: %+v %v", view, err)
	}
	other := r.jobs[0]
	other.Step = "scripts"
	r.jobs = []model.DramaJob{other}
	jobs, _ = s.ListJobs(ctx, 7, 1, false)
	if jobs[0].Result != nil {
		t.Fatal("其他任务泄露合成结果")
	}
}

func TestDramaCompose_CancelFailureAndRetry(t *testing.T) {
	for _, kind := range []string{"cancel", "download", "transcode", "commit"} {
		t.Run(kind, func(t *testing.T) {
			r := newComposeMemory()
			a := &composeFiles{r: r}
			p := &composeProcessor{}
			s := composeService(r, a, p)
			ctx := context.Background()
			job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "cancel":
				p.during = func() {
					if _, err := s.CancelJob(ctx, 7, 1, uint64(job.ID)); err != nil {
						t.Fatal(err)
					}
				}
			case "download":
				a.downloadErr = errors.New("private storage secret")
			case "transcode":
				p.err = errors.New("private ffmpeg path")
			case "commit":
				r.insertErr = errors.New("database unavailable")
			}
			err = s.HandleDrama(ctx, 7, 1, uint64(job.ID))
			if kind == "commit" {
				if err == nil {
					t.Fatal("事务失败必须重试")
				}
				r.insertErr = nil
				if err = s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
					t.Fatal(err)
				}
				if len(r.assets) != 1 {
					t.Fatal("重试重复素材")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(r.assets) != 0 || r.episodes[0].FinalAssetID != nil || r.creditCalls != 0 {
				t.Fatal("取消失败发布了成片或扣费")
			}
			if kind != "cancel" && (r.jobs[0].ErrorCode != 10000 || !strings.Contains(r.jobs[0].ErrorMessage, map[string]string{"download": "下载失败", "transcode": "转码失败"}[kind]) || strings.Contains(r.jobs[0].ErrorMessage, "private")) {
				t.Fatalf("失败原因 %+v", r.jobs[0])
			}
		})
	}
}

func TestDramaCompose_TaskOwnership(t *testing.T) {
	for _, mutate := range []func(*model.GenerationTask){
		func(task *model.GenerationTask) { task.UserID = 8 },
		func(task *model.GenerationTask) { task.NodeID = "seg:6" },
		func(task *model.GenerationTask) { task.IsTest = true },
		func(task *model.GenerationTask) { task.Status = model.TaskFailed },
	} {
		r := newComposeMemory()
		mutate(&r.tasks[0])
		s := composeService(r, &composeFiles{r: r}, &composeProcessor{})
		_, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
		if err == nil {
			raw, _ := json.Marshal(r.tasks)
			t.Fatalf("合成接受非法采用任务: %s", raw)
		}
	}
}

func (r *composeMemory) SegmentEpisode(_ context.Context, user, id uint64) (*model.DramaEpisode, error) {
	for i := range r.episodes {
		if r.episodes[i].UserID == user && r.episodes[i].ID == id {
			ep := r.episodes[i]
			return &ep, nil
		}
	}
	return nil, repository.ErrNotFound
}

// composeTimeline 给集3保存一条时间线：主轨放 clips，extra 是附属轨。
func composeTimeline(t *testing.T, r *composeMemory, muted bool, clips ...drama.TimelineClip) {
	t.Helper()
	composeTracks(t, r, muted, nil, clips...)
}

func composeTracks(t *testing.T, r *composeMemory, muted bool, extra []drama.Track, clips ...drama.TimelineClip) {
	t.Helper()
	tracks := append([]drama.Track{{ID: "main", Kind: drama.TrackMain, Name: "主轨", Muted: muted, Clips: clips}}, extra...)
	raw, err := json.Marshal(tracks)
	if err != nil {
		t.Fatal(err)
	}
	r.timeline = &model.DramaEpisodeTimeline{BaseModel: model.BaseModel{ID: 1}, UserID: 7, EpisodeID: 3, Tracks: raw, RemovedSegmentIDs: []byte(`[]`), Imports: []byte(`[]`), Revision: 1}
}

func TestDramaCompose_UsesTimeline(t *testing.T) {
	r := newComposeMemory()
	r.project.Ratio = "9:16"
	r.library = append(r.library, model.Asset{ID: 40, UserID: 7, Kind: "image"})
	composeTimeline(t, r, true,
		drama.TimelineClip{ID: "a", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 20, InMS: 1000, OutMS: 4000},
		drama.TimelineClip{ID: "x", Kind: drama.ClipAsset, AssetID: 40, Media: drama.MediaImage, OutMS: 2000},
	)
	p := &composeProcessor{}
	s := composeService(r, &composeFiles{r: r}, p)
	ctx := context.Background()
	job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if p.ratio != "9:16" || len(p.clips) != 2 {
		t.Fatalf("合成参数 ratio=%q clips=%+v", p.ratio, p.clips)
	}
	if c := p.clips[0]; c.Image || c.InMS != 1000 || c.OutMS != 4000 || !c.Muted {
		t.Fatalf("视频段 %+v", c)
	}
	if c := p.clips[1]; !c.Image || c.OutMS != 2000 || !c.Muted {
		t.Fatalf("图片段 %+v", c)
	}
	// 片段 6 不在时间线上也没被删过：对账补成待采用占位，合成时跳过并提示
	jobs, _ := s.ListJobs(ctx, 7, 1, false)
	if got := jobs[0].Result; got == nil || len(got.SkippedSeqs) != 1 || got.SkippedSeqs[0] != 1 {
		t.Fatalf("跳过的片段 %+v", got)
	}
}

func TestDramaCompose_BrokenTimelineRejected(t *testing.T) {
	r := newComposeMemory()
	composeTimeline(t, r, false, drama.TimelineClip{ID: "a", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 999, Pinned: true, OutMS: 4000})
	s := composeService(r, &composeFiles{r: r}, &composeProcessor{})
	_, err := s.CreateJob(context.Background(), 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	dramaCheckCode(t, err, errcode.ErrDramaTimelineBroken.Code)
}

// 所有轨都冻结进合成输入并交给合成：主轨音量和淡变、叠加参数、音频轨、字幕、轨道静音/隐藏规则都要带上；
// 附属轨上有失效素材照样拒绝。
func TestDramaCompose_FreezesAllTracks(t *testing.T) {
	main := drama.TimelineClip{ID: "a", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 20, InMS: 1000, OutMS: 4000, Volume: 150, FadeInMS: 500, FadeOutMS: 700}
	overlay := func(hidden bool) drama.Track {
		return drama.Track{ID: "o1", Kind: drama.TrackOverlay, Name: "叠加", Hidden: hidden, Muted: true, Clips: []drama.TimelineClip{
			{ID: "ov", Kind: drama.ClipAsset, AssetID: 40, Media: drama.MediaImage, StartMS: 1000, OutMS: 2000, Volume: 100, X: 75, Y: 25, Scale: 40, Opacity: 80, FadeInMS: 300},
			{ID: "ovv", Kind: drama.ClipAsset, AssetID: 41, Media: drama.MediaVideo, StartMS: 4000, InMS: 500, OutMS: 2500, Volume: 50, Muted: true, X: 50, Y: 50, Scale: 100, Opacity: 100},
		}}
	}
	voice := drama.Track{ID: "a1", Kind: drama.TrackAudio, Role: drama.RoleVoice, Name: "配音", Clips: []drama.TimelineClip{
		{ID: "v", Kind: drama.ClipAsset, AssetID: 50, Media: drama.MediaAudio, StartMS: 500, InMS: 200, OutMS: 2200, Volume: 120, FadeInMS: 100, FadeOutMS: 200},
		{ID: "v0", Kind: drama.ClipAsset, AssetID: 50, Media: drama.MediaAudio, StartMS: 3000, OutMS: 1000, Volume: 0},
		{ID: "vm", Kind: drama.ClipAsset, AssetID: 50, Media: drama.MediaAudio, StartMS: 5000, OutMS: 1000, Volume: 100, Muted: true},
	}}
	mutedMusic := drama.Track{ID: "a2", Kind: drama.TrackAudio, Role: drama.RoleMusic, Name: "BGM", Muted: true, Clips: []drama.TimelineClip{
		{ID: "m", Kind: drama.ClipAsset, AssetID: 50, Media: drama.MediaAudio, OutMS: 2000, Volume: 100},
	}}
	text := drama.Track{ID: "t1", Kind: drama.TrackText, Name: "字幕", Clips: []drama.TimelineClip{
		{ID: "s", Kind: drama.ClipText, Text: "你好", Style: drama.TextTitle, Pos: drama.PosTop, Size: 120, StartMS: 200, OutMS: 2200, Volume: 100},
	}}
	hiddenText := drama.Track{ID: "t2", Kind: drama.TrackText, Name: "隐藏字幕", Hidden: true, Clips: []drama.TimelineClip{
		{ID: "s2", Kind: drama.ClipText, Text: "不应出现", Style: drama.TextSubtitle, Pos: drama.PosBottom, Size: 100, OutMS: 1000, Volume: 100},
	}}
	r := newComposeMemory()
	r.library = append(r.library, model.Asset{ID: 40, UserID: 7, Kind: "image"}, model.Asset{ID: 41, UserID: 7, Kind: "video", DurationMs: 3000}, model.Asset{ID: 50, UserID: 7, Kind: "audio", DurationMs: 3000})
	composeTracks(t, r, false, []drama.Track{text, hiddenText, overlay(false), voice, mutedMusic}, main)
	p := &composeProcessor{}
	s := composeService(r, &composeFiles{r: r}, p)
	ctx := context.Background()
	job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	// 提交之后再改时间线（删掉所有附属轨）：冻结的输入不受影响
	composeTimeline(t, r, false, main)
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	plan := p.plan
	if len(plan.Main) != 1 || plan.Main[0].Volume != 150 || plan.Main[0].FadeInMS != 500 || plan.Main[0].FadeOutMS != 700 {
		t.Fatalf("主轨应带音量和淡变：%+v", plan.Main)
	}
	if len(plan.Overlays) != 2 {
		t.Fatalf("叠加画面 %+v", plan.Overlays)
	}
	ov := plan.Overlays[0]
	if !ov.Image || ov.StartMS != 1000 || ov.OutMS != 2000 || ov.X != 75 || ov.Y != 25 || ov.Scale != 40 || ov.Opacity != 80 || ov.FadeInMS != 300 || !ov.Muted {
		t.Fatalf("叠加图片 %+v（轨道静音要并进片段静音）", ov)
	}
	if v := plan.Overlays[1]; v.Image || v.InMS != 500 || v.OutMS != 2500 || v.StartMS != 4000 || v.Volume != 50 || !v.Muted {
		t.Fatalf("叠加视频 %+v", v)
	}
	// 配音：音量 0 和片段静音的不进合成；BGM 轨静音整条不进
	if len(plan.Audios) != 1 {
		t.Fatalf("音频轨应只剩一段：%+v", plan.Audios)
	}
	if a := plan.Audios[0]; a.StartMS != 500 || a.InMS != 200 || a.OutMS != 2200 || a.Volume != 120 || a.FadeInMS != 100 || a.FadeOutMS != 200 {
		t.Fatalf("配音 %+v", a)
	}
	// 字幕：隐藏轨不进
	if len(plan.Texts) != 1 {
		t.Fatalf("字幕应只剩可见轨：%+v", plan.Texts)
	}
	if x := plan.Texts[0]; x.Text != "你好" || x.Style != "title" || x.Pos != "top" || x.Size != 120 || x.StartMS != 200 || x.LenMS != 2200 {
		t.Fatalf("字幕 %+v", x)
	}
}

func TestDramaCompose_HiddenOverlayTrackSkipped(t *testing.T) {
	main := drama.TimelineClip{ID: "a", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 20, OutMS: 4000, Volume: 100}
	hidden := drama.Track{ID: "o1", Kind: drama.TrackOverlay, Name: "叠加", Hidden: true, Clips: []drama.TimelineClip{
		{ID: "ov", Kind: drama.ClipAsset, AssetID: 40, Media: drama.MediaImage, OutMS: 2000, Volume: 100, X: 50, Y: 50, Scale: 100, Opacity: 100},
	}}
	r := newComposeMemory()
	r.library = append(r.library, model.Asset{ID: 40, UserID: 7, Kind: "image"})
	composeTracks(t, r, false, []drama.Track{hidden}, main)
	p := &composeProcessor{}
	s := composeService(r, &composeFiles{r: r}, p)
	ctx := context.Background()
	job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if len(p.plan.Overlays) != 0 {
		t.Fatalf("隐藏的叠加轨不应合成：%+v", p.plan.Overlays)
	}
}

// 附属轨上有失效素材照样拒绝；没有附属轨内容时输入里没有 tracks，和之前完全一致。
func TestDramaCompose_AttachedBrokenRejectedAndEmptyAttachedUnchanged(t *testing.T) {
	main := drama.TimelineClip{ID: "a", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 20, InMS: 1000, OutMS: 4000, Volume: 100}
	audio := func(asset uint64) drama.Track {
		return drama.Track{ID: "a1", Kind: drama.TrackAudio, Role: drama.RoleVoice, Name: "配音", Clips: []drama.TimelineClip{{ID: "v", Kind: drama.ClipAsset, AssetID: asset, Media: drama.MediaAudio, OutMS: 2000, Volume: 100}}}
	}
	ctx := context.Background()
	// 配音用的素材 99 不存在：附属轨失效，整体拒绝
	broken := newComposeMemory()
	composeTracks(t, broken, false, []drama.Track{audio(99)}, main)
	_, err := composeService(broken, &composeFiles{r: broken}, &composeProcessor{}).CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	dramaCheckCode(t, err, errcode.ErrDramaTimelineBroken.Code)

	// 附属轨都是空的：冻结输入不带附属轨，合成计划里也没有
	r := newComposeMemory()
	composeTracks(t, r, false, []drama.Track{{ID: "t1", Kind: drama.TrackText, Name: "字幕"}, {ID: "a1", Kind: drama.TrackAudio, Role: drama.RoleVoice, Name: "配音"}}, main)
	p := &composeProcessor{}
	s := composeService(r, &composeFiles{r: r}, p)
	job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(r.jobs[0].InputJSON), "tracks") {
		t.Fatalf("没有附属轨内容时冻结输入不应带 tracks：%s", r.jobs[0].InputJSON)
	}
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if len(p.plan.Overlays)+len(p.plan.Audios)+len(p.plan.Texts) != 0 || len(p.plan.Main) != 1 || p.plan.Main[0].InMS != 1000 {
		t.Fatalf("合成计划 %+v", p.plan)
	}
}

func TestDramaCompose_LegacyQueuedInput(t *testing.T) {
	r := newComposeMemory()
	p := &composeProcessor{}
	s := composeService(r, &composeFiles{r: r}, p)
	ctx := context.Background()
	job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	// 升级前入队的任务只有 asset_ids：整段拼接、沿用第一段比例
	r.jobs[0].InputJSON = []byte(`{"episode_id":3,"segment_version":0,"asset_ids":[30],"skipped_seqs":[1]}`)
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if p.ratio != "" || len(p.clips) != 1 || p.clips[0].OutMS != 0 || p.clips[0].Image {
		t.Fatalf("旧任务合成参数 ratio=%q clips=%+v", p.ratio, p.clips)
	}
}

// 叠加轨上放的是片段的某个版本（kind=segment）：要换成那个版本的视频素材冻结进去，不能被当成无关片段丢掉。
func TestDramaCompose_OverlaySegmentTakeFrozenAsVideo(t *testing.T) {
	main := drama.TimelineClip{ID: "a", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 20, OutMS: 4000, Volume: 100}
	overlay := drama.Track{ID: "o1", Kind: drama.TrackOverlay, Name: "叠加", Clips: []drama.TimelineClip{
		{ID: "ov", Kind: drama.ClipSegment, SegmentID: 5, TaskID: 20, Pinned: true, StartMS: 1000, InMS: 500, OutMS: 2500, Volume: 80, X: 70, Y: 30, Scale: 40, Opacity: 100},
	}}
	r := newComposeMemory()
	composeTracks(t, r, false, []drama.Track{overlay}, main)
	p := &composeProcessor{}
	s := composeService(r, &composeFiles{r: r}, p)
	ctx := context.Background()
	job, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "compose", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.HandleDrama(ctx, 7, 1, uint64(job.ID)); err != nil {
		t.Fatal(err)
	}
	if len(p.plan.Overlays) != 1 {
		t.Fatalf("叠加轨上的片段版本应进合成：%+v", p.plan.Overlays)
	}
	if o := p.plan.Overlays[0]; o.Image || o.Path == "" || o.StartMS != 1000 || o.InMS != 500 || o.OutMS != 2500 || o.Volume != 80 || o.Scale != 40 {
		t.Fatalf("叠加的片段版本 %+v", o)
	}
}
