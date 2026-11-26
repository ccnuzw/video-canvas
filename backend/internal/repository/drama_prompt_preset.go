package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"video-canvas/internal/model"
)

// DramaPromptPresetRepository 提供内置提示词目录及分类串行化写入。
type DramaPromptPresetRepository struct{ db *gorm.DB }

// DramaPromptPresetTx 是运营模板分类事务里的写操作。
type DramaPromptPresetTx interface {
	LockGroup(context.Context, string) (*model.DramaPromptPresetGroup, error)
	Preset(context.Context, string, uint64) (*model.DramaPromptPreset, error)
	SavePreset(context.Context, *model.DramaPromptPreset) error
	SaveGroup(context.Context, *model.DramaPromptPresetGroup) error
	InsertAudit(context.Context, *model.AdminAuditLog) error
}

// NewDramaPromptPresetRepository 创建内置提示词的数据访问对象。
func NewDramaPromptPresetRepository(db *gorm.DB) *DramaPromptPresetRepository {
	return &DramaPromptPresetRepository{db: db}
}

// PresetRows 在一条查询中返回各分类的默认指针和模板版本。
func (r *DramaPromptPresetRepository) PresetRows(ctx context.Context, admin, bodies bool) ([]model.DramaPromptPresetRow, error) {
	var rows []model.DramaPromptPresetRow
	fields := "p.id, p.step, p.name, p.description, p.status, p.revision, g.default_id, g.revision AS group_revision"
	if bodies || admin {
		fields += ", p.body"
	}
	if admin {
		fields += ", p.updated_by, p.updated_at"
	}
	query := r.db.WithContext(ctx).Table("drama_prompt_presets AS p").Select(fields).
		Joins("JOIN drama_prompt_preset_groups AS g ON g.step = p.step").Order("p.id")
	if !admin {
		query = query.Where("p.status = ?", model.DramaPresetEnabled)
	}
	if bodies && !admin {
		query = query.Where("p.id = g.default_id")
	}
	err := query.Scan(&rows).Error
	return rows, err
}

// WithTx 使同一分类的修改及其审计在同一事务中提交。
func (r *DramaPromptPresetRepository) WithTx(ctx context.Context, fn func(DramaPromptPresetTx) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return fn(NewDramaPromptPresetRepository(tx)) })
}

// LockGroup 按分类加排他行锁；缺失返回 ErrNotFound。
func (r *DramaPromptPresetRepository) LockGroup(ctx context.Context, step string) (*model.DramaPromptPresetGroup, error) {
	var group model.DramaPromptPresetGroup
	err := r.db.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("step = ?", step).Take(&group).Error
	return &group, presetLookupError(err)
}

// Preset 按分类和 ID 查询模板；缺失返回 ErrNotFound。
func (r *DramaPromptPresetRepository) Preset(ctx context.Context, step string, id uint64) (*model.DramaPromptPreset, error) {
	var row model.DramaPromptPreset
	err := r.db.WithContext(ctx).Where("step = ? AND id = ?", step, id).Take(&row).Error
	return &row, presetLookupError(err)
}

// SavePreset 插入或更新已由分类锁保护的模板；同类重名返回 ErrDuplicate。
func (r *DramaPromptPresetRepository) SavePreset(ctx context.Context, row *model.DramaPromptPreset) error {
	query := r.db.WithContext(ctx)
	if row.ID == 0 {
		return presetLookupError(query.Create(row).Error)
	}
	return presetLookupError(query.Model(row).Select("Name", "Description", "Body", "Status", "Revision", "UpdatedBy", "UpdatedAt").Updates(row).Error)
}

// SaveGroup 切换已加锁分类的默认项及版本。
func (r *DramaPromptPresetRepository) SaveGroup(ctx context.Context, group *model.DramaPromptPresetGroup) error {
	return r.db.WithContext(ctx).Model(group).Select("DefaultID", "Revision").Updates(group).Error
}

// InsertAudit 在分类事务中持久化不含正文的操作审计。
func (r *DramaPromptPresetRepository) InsertAudit(ctx context.Context, row *model.AdminAuditLog) error {
	return r.db.WithContext(ctx).Create(row).Error
}

func presetLookupError(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return ErrNotFound
	case isUniqueViolation(err):
		return ErrDuplicate
	default:
		return err
	}
}
