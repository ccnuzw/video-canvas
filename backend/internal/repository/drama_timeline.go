package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"video-canvas/internal/model"
)

// Timeline 按用户和集ID读取粗剪时间线；还没保存过返回ErrNotFound。
func (r *DramaRepository) Timeline(ctx context.Context, userID, episodeID uint64) (*model.DramaEpisodeTimeline, error) {
	var row model.DramaEpisodeTimeline
	err := r.db.WithContext(ctx).Where("user_id = ? AND episode_id = ?", userID, episodeID).First(&row).Error
	return &row, translate(err)
}

// SaveTimeline 第一次保存插入，之后按revision更新；版本不一致或并发首次保存返回ErrStateConflict，
// 成功后让集的segment_version自增，使已有成片显示过期。
func (r *DramaRepository) SaveTimeline(ctx context.Context, row *model.DramaEpisodeTimeline, revision int64) error {
	if row.ID == 0 {
		row.Revision = 1
		if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
			if isUniqueViolation(err) {
				return ErrStateConflict
			}
			return err
		}
		return r.bumpSegmentVersion(ctx, row.UserID, row.EpisodeID)
	}
	now := time.Now()
	res := r.db.WithContext(ctx).Model(&model.DramaEpisodeTimeline{}).Where("user_id = ? AND id = ? AND revision = ?", row.UserID, row.ID, revision).Updates(map[string]any{
		"tracks": row.Tracks, "removed_segment_ids": row.RemovedSegmentIDs, "imports": row.Imports,
		"revision": gorm.Expr("revision + 1"), "updated_at": now,
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrStateConflict
	}
	row.Revision, row.UpdatedAt = revision+1, now
	return r.bumpSegmentVersion(ctx, row.UserID, row.EpisodeID)
}

// TimelineAssets 按用户读取一批素材，只返回存在且属于该用户的；用于校验素材段和取时长。
func (r *DramaRepository) TimelineAssets(ctx context.Context, userID uint64, ids []uint64) ([]model.Asset, error) {
	rows := []model.Asset{}
	if len(ids) == 0 {
		return rows, nil
	}
	err := r.db.WithContext(ctx).Where("user_id = ? AND id IN ?", userID, ids).Find(&rows).Error
	return rows, err
}
