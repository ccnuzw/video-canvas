// Package dramapresetfake 提供开拍预设模块的内存 fake，供 service 测试与 handler 测试共用。
// 它不依赖 service 包（否则会循环依赖），只按 service 里声明的接口结构实现，
// 语义与真实 repository / storage 保持一致：读列表按 sort_order、id 升序，重复 (kind, key) 返回唯一冲突。
package dramapresetfake

import (
	"bytes"
	"context"
	"io"
	"sort"
	"sync"
	"time"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
	"video-canvas/internal/storage"
)

// Repo 是 drama_presets 的内存实现，同时实现 service.DramaPresetRepo 与 repository.DramaPresetTx。
type Repo struct {
	mu     sync.Mutex
	Rows   []model.DramaPreset // 当前全部条目（未排序，读取时才排）
	NextID uint64              // 下一个自增 id，0 时从 1 开始

	// StyleUsage / GenreUsage 是「有多少部短剧在用这个 key」，测试按需填。
	StyleUsage map[string]int64
	GenreUsage map[string]int64

	Err error // 非空时所有方法都返回它
}

// NewRepo 创建内存仓储并初始化自增 id 与使用量表。
// 不要在测试里直接写字面量再改 StyleUsage：那些 map 延迟到首次调用才初始化，
// 提前下标赋值会 panic，所以统一从这里建。
func NewRepo(rows ...model.DramaPreset) *Repo {
	r := &Repo{Rows: rows}
	r.init()
	return r
}

func (r *Repo) init() {
	if r.NextID == 0 {
		r.NextID = 1
	}
	for _, row := range r.Rows {
		if row.ID >= r.NextID {
			r.NextID = row.ID + 1
		}
	}
	if r.StyleUsage == nil {
		r.StyleUsage = map[string]int64{}
	}
	if r.GenreUsage == nil {
		r.GenreUsage = map[string]int64{}
	}
}

// sorted 返回某个种类的副本，按 sort_order、id 升序；kind 为空时返回全部。
func (r *Repo) sorted(kind string) []model.DramaPreset {
	var out []model.DramaPreset
	for _, row := range r.Rows {
		if kind == "" || row.Kind == kind {
			out = append(out, row)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].SortOrder != out[j].SortOrder {
			return out[i].SortOrder < out[j].SortOrder
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// ListAll 返回某个种类的全部条目，按 sort_order、id 升序。
func (r *Repo) ListAll(_ context.Context, kind string) ([]model.DramaPreset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	if r.Err != nil {
		return nil, r.Err
	}
	return r.sorted(kind), nil
}

// GetByID 按 id 查询，不存在返回 repository.ErrNotFound。
func (r *Repo) GetByID(_ context.Context, id uint64) (*model.DramaPreset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	if r.Err != nil {
		return nil, r.Err
	}
	for i := range r.Rows {
		if r.Rows[i].ID == id {
			row := r.Rows[i]
			return &row, nil
		}
	}
	return nil, repository.ErrNotFound
}

// GetByKey 按种类和 key 查询，不存在返回 repository.ErrNotFound。
func (r *Repo) GetByKey(_ context.Context, kind, key string) (*model.DramaPreset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	if r.Err != nil {
		return nil, r.Err
	}
	for i := range r.Rows {
		if r.Rows[i].Kind == kind && r.Rows[i].Key == key {
			row := r.Rows[i]
			return &row, nil
		}
	}
	return nil, repository.ErrNotFound
}

// GetByPreviewKey 按预览图对象 key 反查，不存在返回 repository.ErrNotFound。
func (r *Repo) GetByPreviewKey(_ context.Context, key string) (*model.DramaPreset, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	for i := range r.Rows {
		if r.Rows[i].PreviewKey == key {
			row := r.Rows[i]
			return &row, nil
		}
	}
	return nil, repository.ErrNotFound
}

// Create 插入条目；(kind, key) 重复返回 repository.ErrStateConflict。
func (r *Repo) Create(_ context.Context, row *model.DramaPreset) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	if r.Err != nil {
		return r.Err
	}
	for _, cur := range r.Rows {
		if cur.Kind == row.Kind && cur.Key == row.Key {
			return repository.ErrStateConflict
		}
	}
	row.ID = r.NextID
	r.NextID++
	r.Rows = append(r.Rows, *row)
	return nil
}

// Update 按列名更新指定字段，条目不存在返回 repository.ErrNotFound。
func (r *Repo) Update(_ context.Context, id uint64, fields map[string]any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	if r.Err != nil {
		return r.Err
	}
	for i := range r.Rows {
		if r.Rows[i].ID != id {
			continue
		}
		for k, v := range fields {
			switch k {
			case "name":
				r.Rows[i].Name = v.(string)
			case "prompt":
				r.Rows[i].Prompt = v.(string)
			case "preview_url":
				r.Rows[i].PreviewURL = v.(string)
			case "preview_key":
				r.Rows[i].PreviewKey = v.(string)
			case "preview_storage_id":
				r.Rows[i].PreviewStorageID = v.(uint64)
			case "enabled":
				r.Rows[i].Enabled = v.(bool)
			}
		}
		return nil
	}
	return repository.ErrNotFound
}

// Delete 删除条目，不存在返回 repository.ErrNotFound。
func (r *Repo) Delete(_ context.Context, id uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	if r.Err != nil {
		return r.Err
	}
	for i := range r.Rows {
		if r.Rows[i].ID == id {
			r.Rows = append(r.Rows[:i], r.Rows[i+1:]...)
			return nil
		}
	}
	return repository.ErrNotFound
}

// MaxSort 返回某个种类最大的 sort_order，没有条目时返回 -1。
func (r *Repo) MaxSort(_ context.Context, kind string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	top := -1
	for _, row := range r.Rows {
		if row.Kind == kind && row.SortOrder > top {
			top = row.SortOrder
		}
	}
	return top, nil
}

// UsageCounts 返回某个种类每个 key 的使用量。
func (r *Repo) UsageCounts(_ context.Context, kind string) (map[string]int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	src := r.StyleUsage
	if kind == model.DramaPresetKindGenre {
		src = r.GenreUsage
	}
	out := make(map[string]int64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out, nil
}

// CountProjectsByStyle 返回某个画风被多少部短剧使用。
func (r *Repo) CountProjectsByStyle(_ context.Context, key string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	return r.StyleUsage[key], nil
}

// CountProjectsByGenre 返回某个题材被多少部短剧使用。
func (r *Repo) CountProjectsByGenre(_ context.Context, key string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	return r.GenreUsage[key], nil
}

// WithTx 直接执行 fn（内存实现没有真正的事务，出错由调用方自己保证不写）。
func (r *Repo) WithTx(ctx context.Context, fn func(tx repository.DramaPresetTx) error) error {
	return fn(r)
}

// ListIDs 见 repository.DramaPresetTx。
func (r *Repo) ListIDs(_ context.Context, kind string) ([]uint64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	var ids []uint64
	for _, row := range r.sorted(kind) {
		ids = append(ids, row.ID)
	}
	return ids, nil
}

// SetSort 见 repository.DramaPresetTx。
func (r *Repo) SetSort(_ context.Context, id uint64, sort int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.init()
	for i := range r.Rows {
		if r.Rows[i].ID == id {
			r.Rows[i].SortOrder = sort
			return nil
		}
	}
	return repository.ErrNotFound
}

// Store 是 storage.Storage 的内存实现，记录写入与删除过的对象 key。
type Store struct {
	mu      sync.Mutex
	Objects map[string][]byte
	Puts    []string
	Deletes []string
	Err     error // 非空时 Put 返回它，用来验证「写失败要清掉对象」
}

// Put 写入对象。
func (s *Store) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return s.Err
	}
	if s.Objects == nil {
		s.Objects = map[string][]byte{}
	}
	s.Objects[key] = data
	s.Puts = append(s.Puts, key)
	return nil
}

// Open 读取对象。
func (s *Store) Open(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.Objects[key]
	if !ok {
		return nil, storage.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

// URL 返回固定地址（测试只关心它不为空）。
func (s *Store) URL(_ context.Context, key string, _ time.Duration) (string, error) {
	return "https://cdn.example.com/" + key, nil
}

// Delete 删除对象。
func (s *Store) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.Objects, key)
	s.Deletes = append(s.Deletes, key)
	return nil
}

// Stores 是 service.StoreRegistry 的固定实现：只有一套存储。
type Stores struct {
	Store *Store
	ID    uint64 // 存储 id，0 时按 3 处理
}

func (s Stores) id() uint64 {
	if s.ID == 0 {
		return 3
	}
	return s.ID
}

// Default 返回这套存储。
func (s Stores) Default(context.Context) (*storage.Handle, error) {
	return &storage.Handle{ID: s.id(), Storage: s.Store}, nil
}

// Get 忽略 id，永远返回这套存储。
func (s Stores) Get(context.Context, uint64) (*storage.Handle, error) {
	return &storage.Handle{ID: s.id(), Storage: s.Store}, nil
}
