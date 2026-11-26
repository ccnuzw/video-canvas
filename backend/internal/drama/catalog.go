package drama

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// catalogTTL 是目录在进程内的缓存时长。
//
// 目录读在热路径上（建剧校验、每一步提示词组装都要取画风描述），不能每次都查库；
// 后台保存后会调用 InvalidateCatalog 立刻失效，TTL 只是多副本部署时的兜底：
// 单机立刻生效，多副本最迟一个 TTL 之后跟上。
const catalogTTL = 60 * time.Second

// catalogTimeout 是加载目录的查询超时。取目录不能拖住建剧请求，超时就退回上一次的缓存。
const catalogTimeout = 3 * time.Second

// Catalog 是预设目录的完整快照，**包含已停用的条目**。
//
// 为什么要带停用项：已建短剧的 style_key 可能指向一条后来被运营停用的画风，
// 保存剧集其它字段时不能因此报「画风不存在」（见 service.checkDramaStyle）。
// 对外的 Styles() 只吐启用的，停用项只用于存在性判断与后台回显。
type Catalog struct {
	Genres []Genre
	Styles []Style
	// Enabled 记录启用状态，键是 EnabledKey(kind, key)
	Enabled map[string]bool
}

// EnabledKey 返回启用状态表里的键。
func EnabledKey(kind, key string) string { return kind + ":" + key }

type catalogEntry struct {
	catalog Catalog
	expires time.Time
}

var (
	// catalogLoader 由启动流程注入（读 drama_presets 表）；为 nil 表示只用编译期内置目录。
	catalogLoader atomic.Pointer[func(context.Context) (Catalog, error)]

	catalogValue atomic.Pointer[catalogEntry]

	// catalogMu 串行化加载：缓存过期时只让一个请求去查库，其余等待后读新值。
	catalogMu sync.Mutex
)

// SetCatalogSource 注入数据库目录的加载器。由 initialize 在启动时调用一次。
//
// 注入后优先返回加载结果；加载失败或目录为空时回落编译期内置目录，
// 保证「后台还没配好 / 迁移没跑完」不会让开拍整体不可用。
func SetCatalogSource(load func(context.Context) (Catalog, error)) {
	if load == nil {
		catalogLoader.Store(nil)
	} else {
		catalogLoader.Store(&load)
	}
	InvalidateCatalog()
}

// InvalidateCatalog 丢弃进程内缓存，下一次读取重新加载。后台写入预设后调用。
func InvalidateCatalog() { catalogValue.Store(nil) }

// Styles 返回当前生效（启用）的题材与画风，切片为副本，调用方修改不会污染缓存或内置目录。
//
// 不接 ctx：目录是进程级状态（几十条小记录、60 秒缓存），调用方分散在 handler、建剧校验、
// 提示词组装的深层函数里，逐层透传 ctx 只为一个内存缓存没有收益；查询本身有独立超时。
func Styles() StylesView {
	c := current()
	view := StylesView{}
	for _, g := range c.Genres {
		if c.Enabled[EnabledKey("genre", g.Key)] {
			view.Genres = append(view.Genres, g)
		}
	}
	for _, s := range c.Styles {
		if c.Enabled[EnabledKey("style", s.Key)] {
			view.Styles = append(view.Styles, s)
		}
	}
	return view
}

// StyleKnown 判断画风是否存在（含已停用）。已建项目保存其它字段时用它放行。
func StyleKnown(key string) bool {
	_, ok := current().Enabled[EnabledKey("style", key)]
	return ok
}

// GenreKnown 判断题材是否存在（含已停用）。
func GenreKnown(key string) bool {
	_, ok := current().Enabled[EnabledKey("genre", key)]
	return ok
}

// current 返回缓存里的目录，过期则重新加载。
func current() Catalog {
	if entry := catalogValue.Load(); entry != nil && time.Now().Before(entry.expires) {
		return entry.catalog
	}
	return loadCatalog()
}

// loadCatalog 在缓存未命中时加载目录；加载失败沿用未过期的旧值，没有旧值时用内置目录。
func loadCatalog() Catalog {
	catalogMu.Lock()
	defer catalogMu.Unlock()
	// 双重检查：等锁期间别的请求可能已经填好了缓存
	if entry := catalogValue.Load(); entry != nil && time.Now().Before(entry.expires) {
		return entry.catalog
	}
	load := catalogLoader.Load()
	if load == nil {
		return builtinCatalog()
	}
	ctx, cancel := context.WithTimeout(context.Background(), catalogTimeout)
	defer cancel()
	catalog, err := (*load)(ctx)
	// 空目录（迁移没跑、或后台把条目全删了）也按内置处理：宁可多给几个选项，也不能让开拍没有画风可选
	if err == nil && len(catalog.Styles) > 0 {
		catalogValue.Store(&catalogEntry{catalog: catalog, expires: time.Now().Add(catalogTTL)})
		return catalog
	}
	if stale := catalogValue.Load(); stale != nil {
		// 有旧值：延长它的有效期，避免每个请求都去撞一次失败的查询
		extended := &catalogEntry{catalog: stale.catalog, expires: time.Now().Add(catalogTTL)}
		catalogValue.Store(extended)
		return extended.catalog
	}
	return builtinCatalog()
}

// builtinCatalog 把编译期内置目录包成 Catalog（全部视为启用）。
func builtinCatalog() Catalog {
	c := Catalog{
		Genres:  append([]Genre(nil), builtinStyles.Genres...),
		Styles:  append([]Style(nil), builtinStyles.Styles...),
		Enabled: make(map[string]bool, len(builtinStyles.Genres)+len(builtinStyles.Styles)),
	}
	for _, g := range builtinStyles.Genres {
		c.Enabled[EnabledKey("genre", g.Key)] = true
	}
	for _, s := range builtinStyles.Styles {
		c.Enabled[EnabledKey("style", s.Key)] = true
	}
	return c
}
