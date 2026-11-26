package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"time"

	"video-canvas/internal/drama"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/logger"
	"video-canvas/internal/pkg/videoframe"
	"video-canvas/internal/provider"
	"video-canvas/internal/repository"

	"go.uber.org/zap"
)

// 合成超时：同时限制下载、全部转码和对象写入，避免整集任务无限占用 worker；
// 按成片时长的两倍放宽，至少 10 分钟、最多 30 分钟。
const (
	dramaComposeTimeout    = 10 * time.Minute
	dramaComposeTimeoutMax = 30 * time.Minute
)

// DramaVideoComposer 按剪辑清单截取各段、统一到项目比例再拼接，由 videoframe.Extractor 实现。
type DramaVideoComposer interface {
	// ComposeClips 将本地各段按顺序合成到 destination（最后一个参数），ratio 为空沿用第一段视频比例；调用方负责最终成片文件清理。
	ComposeClips(context.Context, []videoframe.ComposeClip, string, string) error
}

// DramaComposeAssets 复用素材存储，未提交对象和数据库登记分离以保证取消与重试安全。
type DramaComposeAssets interface {
	// Open 只打开当前用户素材，返回值的 Body 由调用方关闭。
	Open(context.Context, uint64, uint64) (*provider.AssetFile, error)
	// PrepareDramaVideo 上传本地产物但不插入素材行，事务提交后才能公开引用。
	PrepareDramaVideo(context.Context, uint64, string) (*model.Asset, error)
	// DiscardCopies 清理尚未提交的对象，复用画布导入的失败回收路径。
	DiscardCopies(context.Context, []*model.Asset)
	// View 读取当前用户素材的稳定视图。
	View(context.Context, uint64, uint64) (*model.AssetView, error)
	// ViewOf 为已经校验归属的素材生成稳定视图，不做网络请求。
	ViewOf(context.Context, *model.Asset) (*model.AssetView, error)
}

// dramaComposeInput 固定提交时的剪辑清单、跳过列表与片段版本，重试不能改用后来选中的 take 或改过的时间线。
// Clips 为空是旧版本入队的任务：按 AssetIDs 整段拼接。
type dramaComposeInput struct {
	EpisodeID      uint64        `json:"episode_id"`
	SegmentVersion int64         `json:"segment_version"`
	AssetIDs       []uint64      `json:"asset_ids"`
	SkippedSeqs    []int         `json:"skipped_seqs"`
	Ratio          string        `json:"ratio,omitempty"`
	Clips          []composeClip `json:"clips,omitempty"`
}

// composeClip 冻结后的一段：具体素材 + 入出点；Muted 已合并整轨静音。
type composeClip struct {
	AssetID uint64 `json:"asset_id"`
	Media   string `json:"media"`
	InMS    int64  `json:"in_ms"`
	OutMS   int64  `json:"out_ms"`
	Muted   bool   `json:"muted"`
}

// estimateCompose 与提交使用同一项目锁和片段校验，完全不解析模型或访问积分账户。
func (s *DramaService) estimateCompose(ctx context.Context, userID, dramaID uint64, req *model.DramaJobReq) (int, error) {
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, err := tx.Project(ctx, userID, dramaID, true)
		if err != nil {
			return err
		}
		eps, err := s.prepareDramaJob(ctx, tx, p, req)
		if err != nil {
			return err
		}
		_, err = composeInput(ctx, tx, p, eps[0])
		return err
	})
	return 0, dramaError(err)
}

// enqueueCompose 直接入队零费用任务，不建积分账户、流水或模型快照。
func enqueueCompose(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, req *model.DramaJobReq, eps []model.DramaEpisode, approvalID *uint64) (*model.DramaJob, error) {
	input, err := composeInput(ctx, tx, p, eps[0])
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	job := &model.DramaJob{UserID: p.UserID, DramaID: p.ID, Lane: "user", Step: "compose", Episodes: append([]int{}, req.Episodes...), Status: "queued", ConfigSnapshot: []byte(`{}`), InputJSON: raw, Output: []byte(`{}`), ApprovalID: approvalID}
	if err := tx.InsertJob(ctx, job); err != nil {
		return nil, err
	}
	return job, nil
}

// composeInput 读时间线并对账后冻结成剪辑清单：待采用占位跳过并记下序号；有失效段整体拒绝（67048），
// 不让用户以为合成了时间线上看到的样子。
func composeInput(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep model.DramaEpisode) (*dramaComposeInput, error) {
	t, err := loadEpisodeTimeline(ctx, tx, p, &ep)
	if err != nil {
		return nil, err
	}
	if len(t.broken) > 0 {
		at := slices.IndexFunc(t.clips, func(c drama.TimelineClip) bool { return c.ID == t.broken[0] })
		return nil, errcode.ErrDramaTimelineBroken.WithMsg(fmt.Sprintf("时间线第 %d 段的素材已失效，请换版本或删掉", at+1))
	}
	seqOf := make(map[uint64]int, len(t.segs))
	for _, sg := range t.segs {
		seqOf[sg.ID] = sg.Seq
	}
	input := &dramaComposeInput{EpisodeID: ep.ID, SegmentVersion: ep.SegmentVersion, AssetIDs: []uint64{}, SkippedSeqs: []int{}, Ratio: p.Ratio}
	for _, c := range t.clips {
		clip := composeClip{Media: drama.MediaVideo, InMS: c.InMS, OutMS: c.OutMS, Muted: c.Muted || t.muted}
		switch {
		case c.Kind == drama.ClipAsset:
			clip.AssetID, clip.Media = c.AssetID, c.Media
		case c.TaskID == 0:
			if seq := seqOf[c.SegmentID]; !slices.Contains(input.SkippedSeqs, seq) {
				input.SkippedSeqs = append(input.SkippedSeqs, seq)
			}
			continue
		default:
			clip.AssetID = t.taskAsset[c.TaskID]
		}
		input.Clips = append(input.Clips, clip)
		input.AssetIDs = append(input.AssetIDs, clip.AssetID)
	}
	if len(input.Clips) == 0 {
		return nil, errcode.ErrDramaNothingToCompose
	}
	slices.Sort(input.SkippedSeqs)
	return input, nil
}

// handleCompose 将重型文件处理放在事务外，成片素材、集引用和任务成功原子提交。
func (s *DramaService) handleCompose(ctx context.Context, run *dramaRun) error {
	// 1. 限制整次处理时间，内部超时使用原 ctx 写失败，worker 退出取消则留给队列恢复。
	workCtx, cancel := context.WithTimeout(ctx, composeTimeout(run.job))
	defer cancel()
	asset, input, err := s.renderCompose(workCtx, run.job)
	if err != nil {
		return s.failDrama(ctx, run.job, err)
	}
	// 2. 未被事务采纳的对象一律回收，包含取消、重复投递和数据库提交失败。
	committed := false
	defer func() {
		if !committed {
			s.assets.DiscardCopies(context.WithoutCancel(ctx), []*model.Asset{asset})
		}
	}()
	committed, err = s.commitCompose(ctx, run.job, asset, input)
	if committed {
		logger.RunOf(ctx).End(logger.StatusSucceeded, zap.Int("segments", len(input.Clips)), zap.Ints("skipped_seqs", input.SkippedSeqs))
	}
	return err
}

// renderCompose 下载和转码阶段给用户只返回固定原因文案，避免暴露存储地址或 ffmpeg 本地路径；底层原因经 withCause 留给日志。
func (s *DramaService) renderCompose(ctx context.Context, job *model.DramaJob) (*model.Asset, *dramaComposeInput, error) {
	if s.compose == nil || s.assets == nil {
		return nil, nil, errcode.ErrInternal.WithMsg("转码失败：合成服务未配置")
	}
	input, err := decodeComposeInput(job)
	if err != nil {
		return nil, nil, errcode.ErrInternal.WithMsg("转码失败：合成输入不可用")
	}
	dir, err := os.MkdirTemp("", "vc-drama-compose-*")
	if err != nil {
		return nil, nil, withCause(errcode.ErrInternal.WithMsg("转码失败：无法创建临时目录"), err, "compose_transcode")
	}
	defer func() { _ = os.RemoveAll(dir) }() // 临时文件没有外部引用，所有退出路径均清理。
	clips := make([]videoframe.ComposeClip, 0, len(input.Clips))
	for i, c := range input.Clips {
		path := filepath.Join(dir, fmt.Sprintf("input-%d", i))
		if err := s.downloadCompose(ctx, job.UserID, c.AssetID, c.Media, path); err != nil {
			return nil, nil, withCause(errcode.ErrInternal.WithMsg("下载失败：无法读取采用视频"), fmt.Errorf("素材 %d：%w", c.AssetID, err), "compose_download")
		}
		clips = append(clips, videoframe.ComposeClip{Path: path, Image: c.Media == drama.MediaImage, InMS: c.InMS, OutMS: c.OutMS, Muted: c.Muted})
		if err := s.dramaProgress(ctx, job, (i+1)*40/len(input.Clips)); err != nil {
			return nil, nil, err
		}
	}
	dst := filepath.Join(dir, "final.mp4")
	if err := s.compose.ComposeClips(ctx, clips, input.Ratio, dst); err != nil {
		return nil, nil, withCause(errcode.ErrInternal.WithMsg("转码失败：无法合成视频"), err, "compose_transcode")
	}
	if err := s.dramaProgress(ctx, job, 80); err != nil {
		return nil, nil, err
	}
	asset, err := s.assets.PrepareDramaVideo(ctx, job.UserID, dst)
	if err != nil {
		return nil, nil, withCause(errcode.ErrInternal.WithMsg("转码失败：成片存储失败"), err, "compose_store")
	}
	return asset, input, nil
}

// decodeComposeInput 解析冻结的合成输入；旧版本入队的任务没有 Clips，按 AssetIDs 整段、沿用第一段比例拼接。
func decodeComposeInput(job *model.DramaJob) (*dramaComposeInput, error) {
	var input dramaComposeInput
	if err := json.Unmarshal(job.InputJSON, &input); err != nil {
		return nil, err
	}
	if len(input.Clips) == 0 {
		for _, id := range input.AssetIDs {
			input.Clips = append(input.Clips, composeClip{AssetID: id, Media: drama.MediaVideo})
		}
	}
	if len(input.Clips) == 0 {
		return nil, errors.New("合成输入为空")
	}
	return &input, nil
}

// composeTimeout 按成片时长的两倍放宽合成超时，至少 10 分钟、最多 30 分钟；输入解析失败用默认值（随后会失败）。
func composeTimeout(job *model.DramaJob) time.Duration {
	input, err := decodeComposeInput(job)
	if err != nil {
		return dramaComposeTimeout
	}
	var total time.Duration
	for _, c := range input.Clips {
		total += time.Duration(c.OutMS-c.InMS) * time.Millisecond
	}
	return min(max(dramaComposeTimeout, 2*total), dramaComposeTimeoutMax)
}

// downloadCompose 从用户素材存储下载到临时目录，沿用素材转存的大小和取消约束；素材种类必须和段的种类一致。
func (s *DramaService) downloadCompose(ctx context.Context, userID, assetID uint64, media, path string) error {
	file, err := s.assets.Open(ctx, userID, assetID)
	if err != nil {
		return err
	}
	defer func() { _ = file.Body.Close() }()
	if file.Asset == nil || file.Asset.UserID != userID || file.Asset.Kind != media {
		return errors.New("素材不是当前用户的" + media)
	}
	f, err := os.Create(path) //nolint:gosec // path 完全由服务端临时目录和序号组成。
	if err != nil {
		return err
	}
	n, copyErr := io.Copy(f, io.LimitReader(&assetSrcReader{ctx: ctx, r: file.Body}, defaultMaxResult+1))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if n == 0 || n > defaultMaxResult {
		return errors.New("采用视频为空或超过大小限制")
	}
	return closeErr
}

// commitCompose 重新读取当前集版本，合成期间修改过片段时成片立即显示过期。
func (s *DramaService) commitCompose(ctx context.Context, job *model.DramaJob, asset *model.Asset, input *dramaComposeInput) (bool, error) {
	committed := false
	var completed *model.DramaJob
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		var err error
		completed, committed, err = s.commitComposeTx(ctx, tx, job, asset, input)
		return err
	})
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil // 项目或集已删除时不发布成片；调用方仍回收临时对象。
	}
	if err != nil {
		return false, err
	}
	s.publish(ctx, completed)
	return committed, nil
}

// commitComposeTx 在项目锁内登记素材、写集成片并结束任务；任务已被取消时什么都不写。
func (s *DramaService) commitComposeTx(ctx context.Context, tx repository.DramaTx, job *model.DramaJob, asset *model.Asset, input *dramaComposeInput) (*model.DramaJob, bool, error) {
	if _, err := tx.Project(ctx, job.UserID, job.DramaID, true); err != nil {
		return nil, false, err
	}
	current, err := tx.Job(ctx, job.UserID, job.DramaID, job.ID, true)
	if err != nil || !dramaActive(current.Status) {
		return current, false, err
	}
	ep, err := tx.SegmentEpisode(ctx, job.UserID, input.EpisodeID)
	if err != nil {
		return nil, false, err
	}
	if asset.UserID != job.UserID || ep.DramaID != job.DramaID {
		return nil, false, repository.ErrNotFound
	}
	if err := tx.CreateAsset(ctx, asset); err != nil {
		return nil, false, err
	}
	ep.FinalAssetID, ep.FinalSegmentVersion = &asset.ID, input.SegmentVersion
	if err := tx.SaveEpisode(ctx, ep, ep.Revision); err != nil {
		return nil, false, err
	}
	view, err := s.assets.ViewOf(ctx, asset)
	if err != nil {
		return nil, false, err
	}
	result := model.DramaComposeResult{Asset: *view, SkippedSeqs: input.SkippedSeqs}
	if err := s.finishTx(ctx, tx, current, "succeeded", 0, "", 0, result); err != nil {
		return nil, false, err
	}
	return current, true, nil
}
