package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"go.uber.org/zap"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/logger"
	"video-canvas/internal/repository"
	"video-canvas/internal/storage"
)

// 预设字段的取值上限与预览图规格。
const (
	maxDramaPresetNameRunes    = 64      // 名称：列表一行放得下
	maxDramaPresetPromptRunes  = 500     // 画风描述：与「自定义画风」同一个上限，注入提示词的长度可控
	maxDramaPresetPreviewURL   = 1024    // 预览图地址
	DramaPresetPreviewMaxBytes = 2 << 20 // 预览图大小上限，handler 限制请求体时也用它
	// dramaPresetPreviewPrefix 是预览图在平台存储里的对象前缀，同时用来识别「这条地址走不走平台存储」
	dramaPresetPreviewPrefix = "drama-presets/"
	// dramaPresetPreviewRoute 是预览图的公开地址前缀；对象 key 去掉前缀拼在这里，key 里的 uuid 不可猜
	dramaPresetPreviewRoute = "/api/v1/drama-presets/previews/"
	// dramaPresetReservedKey 是「自定义画风」的哨兵值：drama_projects.style_key = custom 表示不用预设，
	// 预设里绝不能再出现这个 key，否则校验与提示词组装会撞车
	dramaPresetReservedKey = "custom"
)

// dramaPresetKeyPattern 是 key 的合法字符集：小写字母、数字、下划线。
// 不放上限进去，长度由 maxDramaPresetNameRunes 之外的字段长度单独判（这里 32 是库里的列宽）。
var dramaPresetKeyPattern = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)

// presetPreviewExt 是预览图允许的格式与落盘扩展名。
var presetPreviewExt = map[string]string{
	"image/webp": ".webp",
	"image/png":  ".png",
	"image/jpeg": ".jpg",
}

// DramaPresetRepo 是预设的数据访问接口（真实实现是 repository.DramaPresetRepository）。
//
// 也带 WithTx：重排要在同一个事务里「加锁读现有 id → 校验 → 逐条写 sort」，
// 否则校验通过后别的管理员新增 / 删除条目，会得到不完整的排序。
type DramaPresetRepo interface {
	// ListAll 返回某个种类的全部条目（含停用），按 sort_order、id 升序。
	ListAll(ctx context.Context, kind string) ([]model.DramaPreset, error)
	// GetByID 按 id 查询，不存在返回 repository.ErrNotFound。
	GetByID(ctx context.Context, id uint64) (*model.DramaPreset, error)
	// GetByKey 按种类和 key 查询，不存在返回 repository.ErrNotFound。
	GetByKey(ctx context.Context, kind, key string) (*model.DramaPreset, error)
	// GetByPreviewKey 按预览图对象 key 反查，不存在返回 repository.ErrNotFound。
	GetByPreviewKey(ctx context.Context, key string) (*model.DramaPreset, error)
	// Create 插入条目，成功后 ID 已回填；(kind, key) 重复返回 repository.ErrStateConflict。
	Create(ctx context.Context, row *model.DramaPreset) error
	// Update 按列名更新指定字段，条目不存在返回 repository.ErrNotFound。
	Update(ctx context.Context, id uint64, fields map[string]any) error
	// Delete 硬删条目，不存在返回 repository.ErrNotFound。
	Delete(ctx context.Context, id uint64) error
	// MaxSort 返回某个种类最大的 sort_order，没有条目时返回 -1。
	MaxSort(ctx context.Context, kind string) (int, error)
	// UsageCounts 返回某个种类每个 key 被多少部短剧使用。
	UsageCounts(ctx context.Context, kind string) (map[string]int64, error)
	// CountProjectsByStyle 返回某个画风被多少部短剧使用。
	CountProjectsByStyle(ctx context.Context, key string) (int64, error)
	// CountProjectsByGenre 返回某个题材被多少部短剧使用。
	CountProjectsByGenre(ctx context.Context, key string) (int64, error)
	// WithTx 在一个事务里执行 fn，fn 返回错误则整体回滚。
	WithTx(ctx context.Context, fn func(tx repository.DramaPresetTx) error) error
}

// DramaPresetDeps 是 DramaPresetService 的依赖。
type DramaPresetDeps struct {
	Repo   DramaPresetRepo  // 预设表
	Stores StoreRegistry    // 预览图所在的存储（上传用 Default，读取 / 删除按记录的 storage_id）
	Audit  AdminAuditWriter // 后台审计，nil 时不写
}

// DramaPresetService 是开拍设置预设（题材 / 画风）的后台维护：列表、增删改、启停、排序、预览图。
//
// 预设是全站共享的运营内容，不属于某个用户；写权限（admin 或 super_admin）由路由保证。
// 每次写操作后都要让 internal/drama 的目录缓存失效，否则前端最长要等一个 TTL 才看到新画风。
type DramaPresetService struct {
	repo   DramaPresetRepo
	stores StoreRegistry
	audit  AdminAuditWriter
}

// NewDramaPresetService 创建预设服务。
func NewDramaPresetService(d DramaPresetDeps) *DramaPresetService {
	return &DramaPresetService{repo: d.Repo, stores: d.Stores, audit: d.Audit}
}

// AdminList 返回后台某个种类的完整列表（含停用）并带上每条的引用数；items 永不为 nil。
func (s *DramaPresetService) AdminList(ctx context.Context, kind string) (*model.DramaPresetsAdminView, error) {
	if err := checkPresetKind(kind); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListAll(ctx, kind)
	if err != nil {
		return nil, fmt.Errorf("读取预设失败：%w", err)
	}
	usage, err := s.repo.UsageCounts(ctx, kind)
	if err != nil {
		return nil, fmt.Errorf("统计预设使用量失败：%w", err)
	}
	items := make([]model.DramaPresetAdminItem, 0, len(rows))
	for i := range rows {
		items = append(items, adminPresetItem(&rows[i], usage[rows[i].Key]))
	}
	return &model.DramaPresetsAdminView{Items: items}, nil
}

// Create 新建一条预设并返回后台视图：新条目排在同类末尾，key 只在此刻可定。
func (s *DramaPresetService) Create(ctx context.Context, actorID uint64, req *model.SaveDramaPresetReq) (*model.DramaPresetAdminItem, error) {
	// 1. 校验并规整；不合法直接返回，不写库、不写审计
	f, err := normalizeDramaPreset(req)
	if err != nil {
		return nil, err
	}

	// 2. key 先查一次，给一句能看懂的话；并发下仍可能撞，Create 的唯一冲突也翻成同一句
	if _, err := s.repo.GetByKey(ctx, f.kind, f.key); err == nil {
		return nil, errcode.ErrDramaPresetInvalid.WithMsg("这个 key 已经存在了")
	} else if !errors.Is(err, repository.ErrNotFound) {
		return nil, fmt.Errorf("检查预设 key 失败：%w", err)
	}

	// 3. 排在同类末尾：sort = 当前最大 sort + 1（没有条目时 MaxSort 返回 -1，第一条是 0）
	top, err := s.repo.MaxSort(ctx, f.kind)
	if err != nil {
		return nil, fmt.Errorf("读取预设排序失败：%w", err)
	}
	row := &model.DramaPreset{
		Kind: f.kind, Key: f.key, Name: f.name, Prompt: f.prompt, PreviewURL: f.previewURL,
		SortOrder: top + 1, Enabled: f.enabled,
	}
	if err := s.repo.Create(ctx, row); err != nil {
		if errors.Is(err, repository.ErrStateConflict) {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg("这个 key 已经存在了")
		}
		return nil, fmt.Errorf("保存预设失败：%w", err)
	}

	// 4. 目录立刻失效（否则开拍设置要等一个 TTL 才出这条），再写审计
	drama.InvalidateCatalog()
	adminAudit(ctx, s.audit, actorID, model.AdminAuditDramaPresetCreate, model.AdminAuditTargetDramaPre, row.ID, map[string]any{
		"kind": row.Kind, "key": row.Key, "name": row.Name, "enabled": row.Enabled,
	})
	return s.adminItem(ctx, row.ID, row.Kind)
}

// Update 修改一条预设的名称 / 描述 / 预览图地址并返回后台视图；key 与 kind 不可改。
func (s *DramaPresetService) Update(ctx context.Context, actorID, id uint64, req *model.UpdateDramaPresetReq) (*model.DramaPresetAdminItem, error) {
	row, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}
	// 只改出现的字段；一个字段都没传按参数错误返回，避免产生一条「什么都没改」的审计
	fields, err := presetUpdateFields(row, req)
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return nil, errcode.ErrDramaPresetInvalid.WithMsg("请至少修改一项")
	}
	if err := s.repo.Update(ctx, id, fields); err != nil {
		return nil, presetNotFoundAs(err, "更新预设失败")
	}

	drama.InvalidateCatalog()
	// 审计只记改了哪些列与新名称：prompt 可能有几百字，塞进审计表没意义
	adminAudit(ctx, s.audit, actorID, model.AdminAuditDramaPresetUpdate, model.AdminAuditTargetDramaPre, id, map[string]any{
		"kind": row.Kind, "key": row.Key, "fields": presetAuditFields(fields),
	})
	return s.adminItem(ctx, id, row.Kind)
}

// SetEnabled 启用或停用一条预设。
//
// 停用只是让它从开拍设置的清单里消失，不影响已经用了它的短剧继续保存、继续生成
// （校验只认「存在」，见 service.checkDramaStyleKept）。
func (s *DramaPresetService) SetEnabled(ctx context.Context, actorID, id uint64, enabled bool) (*model.DramaPresetAdminItem, error) {
	row, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, id, map[string]any{"enabled": enabled}); err != nil {
		return nil, presetNotFoundAs(err, "切换预设启用状态失败")
	}

	drama.InvalidateCatalog()
	adminAudit(ctx, s.audit, actorID, model.AdminAuditDramaPresetEnable, model.AdminAuditTargetDramaPre, id, map[string]any{
		"kind": row.Kind, "key": row.Key, "enabled": enabled,
	})
	return s.adminItem(ctx, id, row.Kind)
}

// Reorder 按 ids 的顺序把某个种类全部预设的 sort_order 重写为 0..n-1。
// ids 必须恰好包含该种类现有全部条目各一次，多了、少了、重复都按 67034 拒绝，
// 防止前端拿着过期列表把刚新增的条目排没了。
func (s *DramaPresetService) Reorder(ctx context.Context, actorID uint64, kind string, ids []uint64) error {
	if err := checkPresetKind(kind); err != nil {
		return err
	}
	err := s.repo.WithTx(ctx, func(tx repository.DramaPresetTx) error {
		current, err := tx.ListIDs(ctx, kind)
		if err != nil {
			return err
		}
		if !sameIDSet(current, ids) {
			return errcode.ErrDramaPresetOrderBad
		}
		for i, id := range ids {
			if err := tx.SetSort(ctx, id, i); err != nil {
				return fmt.Errorf("更新第 %d 条预设的排序失败：%w", i+1, err)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}

	drama.InvalidateCatalog()
	adminAudit(ctx, s.audit, actorID, model.AdminAuditDramaPresetOrder, model.AdminAuditTargetDramaPre, 0, map[string]any{
		"kind": kind, "ids": ids,
	})
	return nil
}

// Delete 删除一条预设。
//
// 有短剧在用它时**不删**，返回 67133 并提示「只能停用」：drama_projects 存的是 key、没有外键，
// 删掉一条正在被引用的画风会让那些剧的画风描述直接消失。删成功后顺手删掉它自己的预览图对象
// （仅限平台存储里的；内置条目那张静态图在前端发布包里，不归后端管）。
func (s *DramaPresetService) Delete(ctx context.Context, actorID, id uint64) error {
	row, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	used, err := s.presetUsage(ctx, row)
	if err != nil {
		return fmt.Errorf("统计预设使用量失败：%w", err)
	}
	if used > 0 {
		return errcode.ErrDramaPresetInUse.WithMsg(fmt.Sprintf("已有 %d 部短剧在用这个%s，只能停用", used, presetKindLabel(row.Kind)))
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return presetNotFoundAs(err, "删除预设失败")
	}

	drama.InvalidateCatalog()
	s.deletePreviewObject(ctx, row.PreviewStorageID, row.PreviewKey)
	adminAudit(ctx, s.audit, actorID, model.AdminAuditDramaPresetDelete, model.AdminAuditTargetDramaPre, id, map[string]any{
		"kind": row.Kind, "key": row.Key, "name": row.Name,
	})
	return nil
}

// UploadPreview 上传 / 替换一条画风的预览图，返回最新的后台视图。
//
// 图落平台存储（默认存储），表里记下 key 与 storage_id，公开地址换成后面那条预览路由：
// 只有后端知道「这张图在哪个存储」，本地磁盘直出、私有桶现签名由同一条路由分流，地址永不过期。
func (s *DramaPresetService) UploadPreview(ctx context.Context, actorID, id uint64, body io.Reader) (*model.DramaPresetAdminItem, error) {
	row, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}
	if row.Kind != model.DramaPresetKindStyle {
		return nil, errcode.ErrDramaPresetInvalid.WithMsg("题材没有预览图")
	}

	// 1. 读最多 2MB+1 字节：多读 1 字节才能区分「恰好 2MB」和「超了」
	data, err := readPresetPreview(body)
	if err != nil {
		return nil, err
	}
	// 2. 按 magic bytes 嗅探真实类型，不信任文件名与 Content-Type
	mime, ok := sniffAssetMime(data[:min(len(data), assetHeadLen)])
	ext, allowed := presetPreviewExt[mime]
	if !ok || !allowed {
		return nil, errcode.ErrDramaPresetFileFormat
	}

	// 3. 写默认存储；key 用 uuid（地址不可猜），扩展名取自嗅探结果
	h, err := s.stores.Default(ctx)
	if err != nil {
		return nil, fmt.Errorf("获取默认存储失败：%w", err)
	}
	key := dramaPresetPreviewPrefix + newAssetUUID() + ext
	if err := h.Storage.Put(ctx, key, bytes.NewReader(data), int64(len(data)), mime); err != nil {
		cleanupObject(ctx, h.Storage, key)
		return nil, fmt.Errorf("写入预览图失败：%w", err)
	}

	// 4. 写库；失败要删掉刚写的对象，否则留下没人引用的孤儿文件
	url := dramaPresetPreviewRoute + strings.TrimPrefix(key, dramaPresetPreviewPrefix)
	fields := map[string]any{"preview_url": url, "preview_key": key, "preview_storage_id": h.ID}
	if err := s.repo.Update(ctx, id, fields); err != nil {
		cleanupObject(ctx, h.Storage, key)
		return nil, presetNotFoundAs(err, "保存预览图失败")
	}

	// 5. 删掉被替换的旧图（row 是更新前的快照），失效目录，写审计
	s.deletePreviewObject(ctx, row.PreviewStorageID, row.PreviewKey)
	drama.InvalidateCatalog()
	adminAudit(ctx, s.audit, actorID, model.AdminAuditDramaPresetPreview, model.AdminAuditTargetDramaPre, id, map[string]any{
		"kind": row.Kind, "key": row.Key, "storage_id": h.ID,
	})
	return s.adminItem(ctx, id, row.Kind)
}

// DramaPresetPreviewObjectKey 把预览地址里的文件名还原成存储对象 key。
// 路由只暴露文件名（uuid + 扩展名），存储里的目录前缀由这里统一拼，两边不会写歪。
func DramaPresetPreviewObjectKey(name string) string { return dramaPresetPreviewPrefix + name }

// PreviewTarget 把预览图的对象 key 解析成「怎么把这个文件给浏览器」，供公开预览路由使用。
// 本地存储由后端直出，对象存储 302 到现签名的地址；key 里是 uuid，猜不出来，与 /files 同一套安全性。
func (s *DramaPresetService) PreviewTarget(ctx context.Context, key string) (*FileTarget, error) {
	// 1. 只认平台存储前缀，且文件名里不许出现路径分隔符：
	//    内置条目的静态图由前端 nginx 提供，不该走到这里；带斜杠的 key 也不可能是这里写进去的
	name := strings.TrimPrefix(key, dramaPresetPreviewPrefix)
	if name == key || name == "" || strings.ContainsAny(name, `/\`) {
		return nil, errcode.ErrDramaPresetNotFound
	}
	row, err := s.repo.GetByPreviewKey(ctx, key)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, errcode.ErrDramaPresetNotFound
		}
		return nil, fmt.Errorf("查询预览图失败：%w", err)
	}

	// 2. 图在哪：按上传时记下的 storage_id 取存储（默认存储后来换过也不影响）
	h, err := s.stores.Get(ctx, row.PreviewStorageID)
	if err != nil {
		logger.Error("解析预览图所在存储失败", zap.Uint64("preset_id", row.ID), zap.Uint64("storage_id", row.PreviewStorageID), zap.Error(err))
		return nil, errcode.ErrStorageUnavailable
	}
	if ls, ok := h.Storage.(*storage.LocalStorage); ok {
		return &FileTarget{Local: ls}, nil
	}
	// 签名一小时、浏览器只缓存 15 分钟，保证拿到的地址一定还没过期
	const ttl = time.Hour
	url, err := h.Storage.URL(ctx, key, ttl)
	if err != nil {
		logger.Error("生成预览图地址失败", zap.Uint64("preset_id", row.ID), zap.Error(err))
		return nil, errcode.ErrStorageUnavailable
	}
	return &FileTarget{RedirectURL: url, MaxAge: ttl / 4}, nil
}

// adminItem 重新读一条预设并补上引用数，转成后台视图。
func (s *DramaPresetService) adminItem(ctx context.Context, id uint64, kind string) (*model.DramaPresetAdminItem, error) {
	row, err := s.repo.GetByID(ctx, id)
	if err != nil {
		// 刚写完就被另一个管理员删掉：按不存在处理
		return nil, presetNotFoundAs(err, "读取预设失败")
	}
	usage, err := s.repo.UsageCounts(ctx, kind)
	if err != nil {
		return nil, fmt.Errorf("统计预设使用量失败：%w", err)
	}
	item := adminPresetItem(row, usage[row.Key])
	return &item, nil
}

// load 读一条预设，不存在返回 67131。
func (s *DramaPresetService) load(ctx context.Context, id uint64) (*model.DramaPreset, error) {
	row, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, presetNotFoundAs(err, "读取预设失败")
	}
	return row, nil
}

// presetUsage 返回有多少部短剧在用这条预设：画风查 style_key，题材查 genre。
func (s *DramaPresetService) presetUsage(ctx context.Context, row *model.DramaPreset) (int64, error) {
	if row.Kind == model.DramaPresetKindGenre {
		return s.repo.CountProjectsByGenre(ctx, row.Key)
	}
	return s.repo.CountProjectsByStyle(ctx, row.Key)
}

// deletePreviewObject 尽力删除平台存储里的预览图。
// 删除失败只记日志：行已经没了，这张图只是不再被引用，运维可按日志清孤儿对象。
func (s *DramaPresetService) deletePreviewObject(ctx context.Context, storageID uint64, key string) {
	if key == "" || storageID == 0 {
		return // 内置条目的静态图不在平台存储里，不归这里管
	}
	h, err := s.stores.Get(ctx, storageID)
	if err != nil {
		logger.Error("解析预览图所在存储失败，跳过删除", zap.Uint64("storage_id", storageID), zap.String("key", key), zap.Error(err))
		return
	}
	cleanupObject(ctx, h.Storage, key)
}

// presetFields 是校验、规整后的预设字段。
type presetFields struct {
	kind       string
	key        string
	name       string
	prompt     string
	previewURL string
	enabled    bool
}

// normalizeDramaPreset 校验并规整新建请求：key 合法且不撞保留值，名称 1–64 字，
// 画风的描述 ≤500 字、预览地址 ≤1024 字且必须是站内绝对路径或 http(s)，题材不允许带描述与预览图。
func normalizeDramaPreset(req *model.SaveDramaPresetReq) (*presetFields, error) {
	if err := checkPresetKind(req.Kind); err != nil {
		return nil, err
	}
	key := strings.TrimSpace(req.Key)
	if !dramaPresetKeyPattern.MatchString(key) {
		return nil, errcode.ErrDramaPresetInvalid.WithMsg("key 只能用小写字母、数字和下划线，最长 32 位")
	}
	if key == dramaPresetReservedKey {
		return nil, errcode.ErrDramaPresetInvalid.WithMsg("custom 是自定义画风的保留值，不能用作 key")
	}
	name, err := normalizePresetName(req.Name)
	if err != nil {
		return nil, err
	}

	f := &presetFields{kind: req.Kind, key: key, name: name, enabled: req.Enabled == nil || *req.Enabled}
	if req.Kind == model.DramaPresetKindGenre {
		// 题材只有 key + 名称：描述与预览图传了也按参数错误拒绝，而不是悄悄丢掉
		if req.Prompt != nil && strings.TrimSpace(*req.Prompt) != "" {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg("题材不需要画风描述")
		}
		if req.Preview != nil && strings.TrimSpace(*req.Preview) != "" {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg("题材没有预览图")
		}
		return f, nil
	}

	if req.Prompt != nil {
		f.prompt = strings.TrimSpace(*req.Prompt)
		if utf8.RuneCountInString(f.prompt) > maxDramaPresetPromptRunes {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg(fmt.Sprintf("画风描述最多 %d 个字", maxDramaPresetPromptRunes))
		}
	}
	if req.Preview != nil {
		if f.previewURL, err = normalizePreviewURL(*req.Preview); err != nil {
			return nil, err
		}
	}
	return f, nil
}

// presetUpdateFields 把修改请求变成「列名 → 新值」，并按条目种类校验：题材不许带描述与预览图。
func presetUpdateFields(row *model.DramaPreset, req *model.UpdateDramaPresetReq) (map[string]any, error) {
	fields := map[string]any{}
	if req.Name != nil {
		name, err := normalizePresetName(*req.Name)
		if err != nil {
			return nil, err
		}
		fields["name"] = name
	}
	if req.Prompt != nil {
		prompt := strings.TrimSpace(*req.Prompt)
		if row.Kind == model.DramaPresetKindGenre && prompt != "" {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg("题材不需要画风描述")
		}
		if utf8.RuneCountInString(prompt) > maxDramaPresetPromptRunes {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg(fmt.Sprintf("画风描述最多 %d 个字", maxDramaPresetPromptRunes))
		}
		fields["prompt"] = prompt
	}
	if req.Preview != nil {
		url, err := normalizePreviewURL(*req.Preview)
		if err != nil {
			return nil, err
		}
		if row.Kind == model.DramaPresetKindGenre && url != "" {
			return nil, errcode.ErrDramaPresetInvalid.WithMsg("题材没有预览图")
		}
		fields["preview_url"] = url
		// 手填地址意味着这条不再指向平台存储里的图，定位列必须一起清掉，
		// 否则预览路由还会按旧 key 返回上一张图
		if url != row.PreviewURL {
			fields["preview_key"] = ""
			fields["preview_storage_id"] = uint64(0)
		}
	}
	return fields, nil
}

// normalizePresetName 去掉首尾空白后按字符数（不是字节数）限长，中文与英文一样长。
func normalizePresetName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(name); n < 1 || n > maxDramaPresetNameRunes {
		return "", errcode.ErrDramaPresetInvalid.WithMsg(fmt.Sprintf("名称需要 1–%d 个字", maxDramaPresetNameRunes))
	}
	return name, nil
}

// normalizePreviewURL 只接受空串、站内绝对路径（/ 开头）或 http(s) 地址。
// 拒绝 javascript: 、data: 之类的伪协议：这个值会直接进 <img src>。
func normalizePreviewURL(raw string) (string, error) {
	url := strings.TrimSpace(raw)
	if url == "" {
		return "", nil
	}
	if utf8.RuneCountInString(url) > maxDramaPresetPreviewURL {
		return "", errcode.ErrDramaPresetInvalid.WithMsg("预览图地址过长")
	}
	if strings.HasPrefix(url, "/") && !strings.HasPrefix(url, "//") {
		return url, nil
	}
	if strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://") {
		return url, nil
	}
	return "", errcode.ErrDramaPresetInvalid.WithMsg("预览图地址必须是站内路径或 http(s) 地址")
}

// readPresetPreview 读预览图内容，最多 2MB；多读 1 字节用来区分「恰好 2MB」和「超了」。
func readPresetPreview(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, DramaPresetPreviewMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取预览图失败：%w", err)
	}
	if len(data) == 0 {
		return nil, errcode.ErrDramaPresetInvalid.WithMsg("请选择要上传的预览图")
	}
	if len(data) > DramaPresetPreviewMaxBytes {
		return nil, errcode.ErrDramaPresetFileLarge
	}
	return data, nil
}

// checkPresetKind 校验种类取值。
func checkPresetKind(kind string) error {
	if kind == model.DramaPresetKindGenre || kind == model.DramaPresetKindStyle {
		return nil
	}
	return errcode.ErrDramaPresetInvalid.WithMsg("种类只能是题材或画风")
}

// presetKindLabel 返回种类的中文名，用于提示语。
func presetKindLabel(kind string) string {
	if kind == model.DramaPresetKindGenre {
		return "题材"
	}
	return "画风"
}

// presetNotFoundAs 把仓储的 ErrNotFound 转成 67131，其他错误加上下文后原样上抛。
func presetNotFoundAs(err error, action string) error {
	if errors.Is(err, repository.ErrNotFound) {
		return errcode.ErrDramaPresetNotFound
	}
	return fmt.Errorf("%s：%w", action, err)
}

// adminPresetItem 把表行转成后台视图。
func adminPresetItem(row *model.DramaPreset, used int64) model.DramaPresetAdminItem {
	return model.DramaPresetAdminItem{
		ID: row.ID, Kind: row.Kind, Key: row.Key, Name: row.Name, Prompt: row.Prompt,
		PreviewURL: row.PreviewURL, SortOrder: row.SortOrder, Enabled: row.Enabled,
		IsBuiltin: row.IsBuiltin, ProjectCount: used,
	}
}

// presetAuditFields 挑出适合进审计的字段：name 与 preview_url 有价值，prompt 太长不记。
func presetAuditFields(fields map[string]any) map[string]any {
	out := make(map[string]any, len(fields))
	for _, k := range []string{"name", "preview_url"} {
		if v, ok := fields[k]; ok {
			out[k] = v
		}
	}
	if len(out) == 0 {
		// 只改了描述：给个明确的标记，免得审计里显示「改了 0 个字段」
		out["prompt"] = "changed"
	}
	return out
}
