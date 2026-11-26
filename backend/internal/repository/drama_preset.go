package repository

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"video-canvas/internal/model"
)

// DramaPresetTx 是重排预设时要用到的 SQL 原语；DramaPresetRepository 自身实现它，WithTx 把它绑定到事务传给回调。
type DramaPresetTx interface {
	// ListIDs 加行锁（FOR UPDATE）返回某个种类的全部条目 id，按 sort_order、id 升序。
	// 锁在事务结束时释放，避免重排与并发的增删交错。
	ListIDs(ctx context.Context, kind string) ([]uint64, error)
	// SetSort 把某个条目的 sort_order 设为 sort；条目不存在返回 ErrNotFound。
	SetSort(ctx context.Context, id uint64, sort int) error
}

// DramaPresetRepository 开拍设置预设表（drama_presets）的数据访问。
type DramaPresetRepository struct {
	db *gorm.DB
}

// NewDramaPresetRepository 创建预设仓储。
func NewDramaPresetRepository(db *gorm.DB) *DramaPresetRepository {
	return &DramaPresetRepository{db: db}
}

var _ DramaPresetTx = (*DramaPresetRepository)(nil)

// WithTx 在一个事务里执行 fn：fn 返回错误整体回滚，否则提交。
func (r *DramaPresetRepository) WithTx(ctx context.Context, fn func(tx DramaPresetTx) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(&DramaPresetRepository{db: tx})
	})
}

// ListAll 返回某个种类的全部条目（含停用），按 sort_order、id 升序。
func (r *DramaPresetRepository) ListAll(ctx context.Context, kind string) ([]model.DramaPreset, error) {
	var rows []model.DramaPreset
	err := r.db.WithContext(ctx).Where("kind = ?", kind).Order("sort_order ASC, id ASC").Find(&rows).Error
	return rows, err
}

// List 返回全部条目（题材与画风一起，含停用），按 kind、sort_order、id 升序。
//
// 目录加载用它一次取完：既要启用的条目做可选清单，也要停用的条目来判断
// 「老项目引用的画风是否还存在」（停用不等于不存在，见 drama.checkDramaStyleKept）。
func (r *DramaPresetRepository) List(ctx context.Context) ([]model.DramaPreset, error) {
	var rows []model.DramaPreset
	err := r.db.WithContext(ctx).Order("kind ASC, sort_order ASC, id ASC").Find(&rows).Error
	return rows, err
}

// GetByID 按 id 查询；不存在返回 ErrNotFound。
func (r *DramaPresetRepository) GetByID(ctx context.Context, id uint64) (*model.DramaPreset, error) {
	var row model.DramaPreset
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		return nil, translate(err)
	}
	return &row, nil
}

// GetByKey 按种类和 key 查询；不存在返回 ErrNotFound。
func (r *DramaPresetRepository) GetByKey(ctx context.Context, kind, key string) (*model.DramaPreset, error) {
	var row model.DramaPreset
	if err := r.db.WithContext(ctx).Where("kind = ? AND key = ?", kind, key).First(&row).Error; err != nil {
		return nil, translate(err)
	}
	return &row, nil
}

// Create 插入条目，成功后 row.ID 已回填；(kind, key) 重复返回 ErrStateConflict。
func (r *DramaPresetRepository) Create(ctx context.Context, row *model.DramaPreset) error {
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		if isUniqueViolation(err) {
			return ErrStateConflict
		}
		return err
	}
	return nil
}

// Update 按 id 更新指定列（fields 的 key 是列名），updated_at 由 gorm 自动刷新；条目不存在返回 ErrNotFound。
func (r *DramaPresetRepository) Update(ctx context.Context, id uint64, fields map[string]any) error {
	res := r.db.WithContext(ctx).Model(&model.DramaPreset{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete 硬删一条预设。
//
// 不走软删除：唯一索引 (kind, key) 与软删除叠加会让删掉的 key 永远无法重建，
// 而预设本来就是可以删了再加的运营内容，没有审计追溯需求（审计在 admin_audit_logs）。
func (r *DramaPresetRepository) Delete(ctx context.Context, id uint64) error {
	res := r.db.WithContext(ctx).Unscoped().Delete(&model.DramaPreset{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// MaxSort 返回某个种类当前最大的 sort_order；没有任何条目时返回 -1，这样「最大值 + 1」恰好是第一个条目的 0。
func (r *DramaPresetRepository) MaxSort(ctx context.Context, kind string) (int, error) {
	var top int
	err := r.db.WithContext(ctx).Model(&model.DramaPreset{}).
		Where("kind = ?", kind).Select("COALESCE(MAX(sort_order), -1)").Scan(&top).Error
	return top, err
}

// ListIDs 见 DramaPresetTx。
func (r *DramaPresetRepository) ListIDs(ctx context.Context, kind string) ([]uint64, error) {
	var ids []uint64
	err := r.db.WithContext(ctx).Model(&model.DramaPreset{}).
		Where("kind = ?", kind).Order("sort_order ASC, id ASC").
		Clauses(clause.Locking{Strength: "UPDATE"}).Pluck("id", &ids).Error
	return ids, err
}

// SetSort 见 DramaPresetTx。
func (r *DramaPresetRepository) SetSort(ctx context.Context, id uint64, sort int) error {
	res := r.db.WithContext(ctx).Model(&model.DramaPreset{}).Where("id = ?", id).Update("sort_order", sort)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// CountProjectsByStyle 返回仍在使用某个画风的短剧数量（软删除的项目不算）。
// 后台删除前用它判断：被引用时只能停用，不能删。
func (r *DramaPresetRepository) CountProjectsByStyle(ctx context.Context, key string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.DramaProject{}).Where("style_key = ?", key).Count(&n).Error
	return n, err
}

// CountProjectsByGenre 返回仍在使用某个题材的短剧数量（软删除的项目不算）。
func (r *DramaPresetRepository) CountProjectsByGenre(ctx context.Context, key string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&model.DramaProject{}).Where("genre = ?", key).Count(&n).Error
	return n, err
}

// UsageCounts 一次查出某个种类每条预设被多少部短剧使用（软删除的项目不算），键是预设 key。
//
// 后台列表每条都要显示「N 部剧在用」，逐条 count 就是 N+1 次查询；这里按列分组一次拿全。
// 没有项目使用的 key 不会出现在结果里，调用方按 0 处理。
func (r *DramaPresetRepository) UsageCounts(ctx context.Context, kind string) (map[string]int64, error) {
	column := "style_key"
	if kind == model.DramaPresetKindGenre {
		column = "genre"
	}
	var rows []struct {
		Key string
		N   int64
	}
	err := r.db.WithContext(ctx).Model(&model.DramaProject{}).
		Select(column + ` AS "key", COUNT(*) AS "n"`).
		Where(column + " <> ''").
		Group(column).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.Key] = row.N
	}
	return out, nil
}

// GetByPreviewKey 按预览图对象 key 反查预设；不存在返回 ErrNotFound。
// 公开预览路由用它把 URL 里的 key 换成「该图在哪个存储」，key 猜不出来，与 /files 同一套安全性。
func (r *DramaPresetRepository) GetByPreviewKey(ctx context.Context, key string) (*model.DramaPreset, error) {
	var row model.DramaPreset
	if err := r.db.WithContext(ctx).Where("preview_key = ?", key).First(&row).Error; err != nil {
		return nil, translate(err)
	}
	return &row, nil
}
