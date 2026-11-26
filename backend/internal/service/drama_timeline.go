package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
)

// maxTimelineImports 「已导入」最多保留的素材数，与请求校验一致。
const maxTimelineImports = 200

// episodeTimeline 对账后的时间线，以及对账、校验、合成要用到的片段和素材信息。
type episodeTimeline struct {
	// row 已保存的时间线；nil 表示还没保存过，clips 是现算的默认时间线
	row     *model.DramaEpisodeTimeline
	clips   []drama.TimelineClip
	removed []uint64
	imports []uint64
	muted   bool
	changes []drama.TimelineChange
	segs    []drama.TimelineSegment
	// taskAsset 成功结果任务 → 它的视频素材
	taskAsset map[uint64]uint64
	// assets 时间线和「已导入」引用到的、仍属于当前用户的图片或视频素材
	assets map[uint64]drama.TimelineAsset
	broken []string
}

// newClipID 生成新段的 ID；8 字节随机数，同一条时间线里碰撞的概率可以忽略。
func newClipID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand 在受支持的平台上不会失败
	return "c" + hex.EncodeToString(b)
}

// timelineSegments 在事务内读该集片段与成功的视频结果，并一次读出结果视频和 extra 里的素材（只认当前用户的）。
// 结果视频的素材缺失时这条结果不可用；素材时长未知时由 drama 包按片段秒数估。
func timelineSegments(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode, extra []uint64) ([]drama.TimelineSegment, map[uint64]uint64, map[uint64]drama.TimelineAsset, error) {
	// 1. 片段和它们成功的视频结果。
	segs, taskAsset, taskOf, err := segmentTakes(ctx, tx, p, ep)
	if err != nil {
		return nil, nil, nil, err
	}
	// 2. 一次读出素材：归属校验在仓储的 user_id 条件里完成，别人的素材读不到即视为不存在。
	ids := slices.Clone(extra)
	for _, id := range taskAsset {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	rows, err := tx.TimelineAssets(ctx, p.UserID, slices.Compact(ids))
	if err != nil {
		return nil, nil, nil, err
	}
	assets := make(map[uint64]drama.TimelineAsset, len(rows))
	for _, a := range rows {
		if a.Kind == drama.MediaVideo || a.Kind == drama.MediaImage {
			assets[a.ID] = drama.TimelineAsset{Media: a.Kind, DurationMS: a.DurationMs}
		}
	}
	// 3. 结果的视频素材还在才算可用结果，时长取素材登记的时长。
	for task, asset := range taskAsset {
		if a, ok := assets[asset]; ok && a.Media == drama.MediaVideo {
			segs[taskOf[task]].Takes[task] = a.DurationMS
		} else {
			delete(taskAsset, task)
		}
	}
	return segs, taskAsset, assets, nil
}

// segmentTakes 读片段和它们的正式任务；只有成功、有视频产物的任务才算结果。
// 返回片段、结果任务 → 视频素材、结果任务 → 片段下标（Takes 的时长由调用方读素材后填）。
func segmentTakes(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode) ([]drama.TimelineSegment, map[uint64]uint64, map[uint64]int, error) {
	rows, err := tx.Segments(ctx, p.UserID, ep.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	taskAsset, taskOf := map[uint64]uint64{}, map[uint64]int{}
	segs := make([]drama.TimelineSegment, 0, len(rows))
	for i, row := range rows {
		s := drama.TimelineSegment{ID: row.ID, Seq: row.Seq, Seconds: row.Seconds, Takes: map[uint64]int64{}}
		if row.ChosenTaskID != nil {
			s.Chosen = *row.ChosenTaskID
		}
		tasks, err := tx.SegmentTasks(ctx, p.UserID, p.CanvasID, segmentNode(row.ID))
		if err != nil {
			return nil, nil, nil, err
		}
		for j := range tasks {
			if tasks[j].Kind != model.KindVideo || tasks[j].Status != model.TaskSucceeded {
				continue
			}
			if id, err := segmentOutputAsset(&tasks[j], model.KindVideo); err == nil && id > 0 {
				taskAsset[tasks[j].ID], taskOf[tasks[j].ID] = id, i
			}
		}
		segs = append(segs, s)
	}
	return segs, taskAsset, taskOf, nil
}

// loadEpisodeTimeline 在事务内读取并对账某集的时间线：没保存过就按片段现算默认时间线（不报变化）。
func loadEpisodeTimeline(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode) (*episodeTimeline, error) {
	// 1. 已保存的时间线；不存在不是错误。
	t := &episodeTimeline{}
	row, err := tx.Timeline(ctx, p.UserID, ep.ID)
	switch {
	case errors.Is(err, repository.ErrNotFound):
	case err != nil:
		return nil, err
	default:
		t.row = row
		if err := decodeTimelineRow(row, t); err != nil {
			return nil, err
		}
	}
	// 2. 片段、结果与引用的素材。
	extra := slices.Clone(t.imports)
	for _, c := range t.clips {
		if c.Kind == drama.ClipAsset {
			extra = append(extra, c.AssetID)
		}
	}
	t.segs, t.taskAsset, t.assets, err = timelineSegments(ctx, tx, p, ep, extra)
	if err != nil {
		return nil, err
	}
	// 3. 对账：默认时间线本身就是片场的样子，不报变化。
	if t.row == nil {
		t.clips = drama.DefaultTimeline(t.segs, newClipID)
	} else {
		t.clips, t.removed, t.changes = drama.ReconcileTimeline(t.clips, t.removed, t.segs, newClipID)
	}
	t.broken = drama.BrokenClips(t.clips, t.segs, t.assets)
	return t, nil
}

// decodeTimelineRow 解析落库的 JSON 列。
func decodeTimelineRow(row *model.DramaEpisodeTimeline, t *episodeTimeline) error {
	t.muted = row.Muted
	for _, part := range []struct {
		raw []byte
		to  any
	}{{row.Clips, &t.clips}, {row.RemovedSegmentIDs, &t.removed}, {row.Imports, &t.imports}} {
		if len(part.raw) == 0 {
			continue
		}
		if err := json.Unmarshal(part.raw, part.to); err != nil {
			return fmt.Errorf("解析时间线失败：%w", err)
		}
	}
	return nil
}

// Timeline 返回对账后的粗剪时间线；还没保存过时返回按片段现算的默认时间线（revision 为 0）。
// 对账结果不写库，下次保存时自然落库。
func (s *DramaSegmentService) Timeline(ctx context.Context, userID, dramaID uint64, no int) (*model.DramaTimelineView, error) {
	// 1. 项目和集必须存活且属于当前用户。
	p, ep, err := s.episode(ctx, userID, dramaID, no)
	if err != nil {
		return nil, err
	}
	// 2. 在一个事务里读片段、结果、时间线和素材，得到一致的快照。
	var t *episodeTimeline
	err = s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		var err error
		t, err = loadEpisodeTimeline(ctx, tx, p, ep)
		return err
	})
	if err != nil {
		return nil, dramaError(err)
	}
	// 3. 素材地址在事务外取，读不到的素材不返回（界面按失效显示）。
	return s.timelineView(ctx, userID, t), nil
}

// SaveTimeline 带版本保存整份时间线，成功后返回对账后的最新时间线，并让已有成片显示过期。
func (s *DramaSegmentService) SaveTimeline(ctx context.Context, userID, dramaID uint64, no int, req *model.SaveDramaTimelineReq) (*model.DramaTimelineView, error) {
	p, ep, err := s.episode(ctx, userID, dramaID, no)
	if err != nil {
		return nil, err
	}
	err = s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		// 1. 锁项目，和片段编辑、合成提交串行，避免校验时读到的片段在写入前被改掉。
		if _, err := tx.Project(ctx, userID, dramaID, true); err != nil {
			return err
		}
		return saveTimelineTx(ctx, tx, p, ep, req)
	})
	if err != nil {
		return nil, dramaError(err)
	}
	return s.Timeline(ctx, userID, dramaID, no)
}

// saveTimelineTx 校验版本和内容后写入；版本不一致返回 67046，内容不合法返回 67047 并写明第几段。
func saveTimelineTx(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode, req *model.SaveDramaTimelineReq) error {
	// 1. 乐观锁：没保存过时版本必须是 0，保存过时必须和库里一致；不一致说明别的标签页改过。
	row, err := tx.Timeline(ctx, p.UserID, ep.ID)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return err
	}
	if err != nil {
		row = &model.DramaEpisodeTimeline{UserID: p.UserID, EpisodeID: ep.ID}
	}
	if row.Revision != req.Revision {
		return errcode.ErrDramaTimelineConflict
	}
	// 2. 校验：片段和版本必须属于这一集，素材必须属于当前用户且种类相符，长度不越界。
	clips := clipsFromView(req.Clips)
	extra := idsOf(req.Imports)
	for _, c := range clips {
		if c.Kind == drama.ClipAsset {
			extra = append(extra, c.AssetID)
		}
	}
	segs, _, assets, err := timelineSegments(ctx, tx, p, ep, extra)
	if err != nil {
		return err
	}
	if err := drama.ValidateTimeline(clips, segs, assets); err != nil {
		return errcode.ErrDramaTimelineInvalid.WithMsg(err.Error())
	}
	// 3. 删除名单只留现存片段，已导入只留当前用户的图片或视频并去重：这两项只影响界面，脏数据静默丢弃。
	removed, imports := keepRemoved(idsOf(req.RemovedSegmentIDs), segs), keepImports(idsOf(req.Imports), assets)
	if row.Clips, err = json.Marshal(clips); err != nil {
		return err
	}
	if row.RemovedSegmentIDs, err = json.Marshal(removed); err != nil {
		return err
	}
	if row.Imports, err = json.Marshal(imports); err != nil {
		return err
	}
	row.Muted = req.Muted
	// 4. 写入；并发的首次保存或版本冲突同样按 67046 处理，让前端载入最新版本。
	if err := tx.SaveTimeline(ctx, row, req.Revision); err != nil {
		if errors.Is(err, repository.ErrStateConflict) {
			return errcode.ErrDramaTimelineConflict
		}
		return err
	}
	return nil
}

// keepRemoved 删除名单只保留仍存在的片段。
func keepRemoved(ids []uint64, segs []drama.TimelineSegment) []uint64 {
	out := []uint64{}
	for _, id := range ids {
		if slices.ContainsFunc(segs, func(s drama.TimelineSegment) bool { return s.ID == id }) && !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	return out
}

// keepImports 已导入只保留当前用户的图片或视频，去重并限制数量。
func keepImports(ids []uint64, assets map[uint64]drama.TimelineAsset) []uint64 {
	out := []uint64{}
	for _, id := range ids {
		if _, ok := assets[id]; ok && !slices.Contains(out, id) && len(out) < maxTimelineImports {
			out = append(out, id)
		}
	}
	return out
}

// idsOf 把对外 ID 转成内部数字，丢掉空值。
func idsOf(in []idcodec.ID) []uint64 {
	out := make([]uint64, 0, len(in))
	for _, id := range in {
		if id != 0 {
			out = append(out, uint64(id))
		}
	}
	return out
}

// clipsFromView 把请求里的段转成领域结构；待采用占位不可能固定版本，图片没有入点。
func clipsFromView(in []model.DramaTimelineClip) []drama.TimelineClip {
	out := make([]drama.TimelineClip, 0, len(in))
	for _, c := range in {
		clip := drama.TimelineClip{ID: c.ID, Kind: c.Kind, InMS: c.InMS, OutMS: c.OutMS, Muted: c.Muted}
		switch c.Kind {
		case drama.ClipSegment:
			clip.SegmentID, clip.TaskID, clip.Pinned = uint64(c.SegmentID), uint64(c.TaskID), c.Pinned && c.TaskID != 0
		case drama.ClipAsset:
			clip.AssetID, clip.Media = uint64(c.AssetID), c.Media
		}
		out = append(out, clip)
	}
	return out
}

// timelineView 组装对外视图，并在事务外取素材地址；读不到的素材不返回。
func (s *DramaSegmentService) timelineView(ctx context.Context, userID uint64, t *episodeTimeline) *model.DramaTimelineView {
	v := &model.DramaTimelineView{Clips: []model.DramaTimelineClip{}, Muted: t.muted, RemovedSegmentIDs: []idcodec.ID{}, Imports: []idcodec.ID{}, Changes: []model.DramaTimelineChange{}, InvalidClipIDs: []string{}, Assets: []model.AssetView{}}
	if t.row != nil {
		v.Revision = t.row.Revision
	}
	var assetIDs []uint64
	for _, c := range t.clips {
		v.Clips = append(v.Clips, model.DramaTimelineClip{ID: c.ID, Kind: c.Kind, SegmentID: idcodec.ID(c.SegmentID), TaskID: idcodec.ID(c.TaskID), Pinned: c.Pinned, AssetID: idcodec.ID(c.AssetID), Media: c.Media, InMS: c.InMS, OutMS: c.OutMS, Muted: c.Muted})
		if c.Kind == drama.ClipAsset {
			assetIDs = append(assetIDs, c.AssetID)
		}
	}
	for _, id := range t.removed {
		v.RemovedSegmentIDs = append(v.RemovedSegmentIDs, idcodec.ID(id))
	}
	for _, id := range t.imports {
		v.Imports = append(v.Imports, idcodec.ID(id))
		assetIDs = append(assetIDs, id)
	}
	for _, c := range t.changes {
		v.Changes = append(v.Changes, model.DramaTimelineChange{Kind: c.Kind, SegmentID: idcodec.ID(c.SegmentID), Seq: c.Seq, ClipID: c.ClipID})
	}
	v.InvalidClipIDs = append(v.InvalidClipIDs, t.broken...)
	slices.Sort(assetIDs)
	for _, id := range slices.Compact(assetIDs) {
		if _, ok := t.assets[id]; !ok || s.assets == nil {
			continue
		}
		if view, err := s.assets.View(ctx, userID, id); err == nil {
			v.Assets = append(v.Assets, *view)
		}
	}
	return v
}
