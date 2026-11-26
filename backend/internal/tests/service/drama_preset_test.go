package service_test

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	. "video-canvas/internal/service"
	"video-canvas/internal/service/dramapresetfake"
)

// 本文件测试开拍设置预设的后台服务（设计：docs/design/短剧预设后台/短剧预设后台.md）。
// 仓储、存储、审计都用内存 fake：这一层要验的是校验规则、排序语义、引用计数与预览图处理顺序，
// 真实 SQL 由 internal/tests/repository 的集成测试覆盖。

const presetActor = uint64(9)

// presetAudit 记录审计动作。
type presetAudit struct {
	mu   sync.Mutex
	logs []model.AdminAuditLog
}

func (a *presetAudit) Insert(_ context.Context, l *model.AdminAuditLog) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.logs = append(a.logs, *l)
	return nil
}

func (a *presetAudit) RecentForUser(context.Context, uint64, int) ([]model.AdminAuditView, error) {
	return nil, nil
}

func (a *presetAudit) actions() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]string, 0, len(a.logs))
	for _, l := range a.logs {
		out = append(out, l.Action)
	}
	return out
}

type presetEnv struct {
	svc    *DramaPresetService
	repo   *dramapresetfake.Repo
	stores *dramapresetfake.Store
	audit  *presetAudit
}

func newPresetEnv(rows ...model.DramaPreset) *presetEnv {
	repo := dramapresetfake.NewRepo(rows...)
	st := &dramapresetfake.Store{}
	audit := &presetAudit{}
	return &presetEnv{
		repo:   repo,
		stores: st,
		audit:  audit,
		svc: NewDramaPresetService(DramaPresetDeps{
			Repo: repo, Stores: dramapresetfake.Stores{Store: st}, Audit: audit,
		}),
	}
}

// TestDramaPresetKeyRules 检查 key 的字符集与保留值：这些 key 会写进 drama_projects.style_key，没有外键兜底。
func TestDramaPresetKeyRules(t *testing.T) {
	cases := []struct {
		name string
		key  string
		ok   bool
	}{
		{"正常", "ink_wash", true},
		{"大写不行", "InkWash", false},
		{"连字符不行", "ink-wash", false},
		{"空不行", "", false},
		{"超 32 位不行", strings.Repeat("a", 33), false},
		{"恰好 32 位可以", strings.Repeat("a", 32), true},
		{"custom 是自定义画风的保留值", "custom", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env := newPresetEnv()
			_, err := env.svc.Create(context.Background(), presetActor, &model.SaveDramaPresetReq{
				Kind: model.DramaPresetKindStyle, Key: c.key, Name: "测试画风",
			})
			if c.ok && err != nil {
				t.Fatalf("期望通过，得到错误：%v", err)
			}
			if !c.ok && !hasCode(err, errcode.ErrDramaPresetInvalid) {
				t.Fatalf("期望 67038，得到 %v", err)
			}
		})
	}
}

// TestDramaPresetCreateAppendsToEnd 检查新条目排在同类末尾、审计留痕、返回体带引用数。
func TestDramaPresetCreateAppendsToEnd(t *testing.T) {
	env := newPresetEnv(
		model.DramaPreset{ID: 1, Kind: model.DramaPresetKindStyle, Key: "a", Name: "A", SortOrder: 0, Enabled: true},
		model.DramaPreset{ID: 2, Kind: model.DramaPresetKindStyle, Key: "b", Name: "B", SortOrder: 1, Enabled: true},
		// 另一个种类的 sort 不该影响本种类
		model.DramaPreset{ID: 3, Kind: model.DramaPresetKindGenre, Key: "g", Name: "G", SortOrder: 9, Enabled: true},
	)
	item, err := env.svc.Create(context.Background(), presetActor, &model.SaveDramaPresetReq{
		Kind: model.DramaPresetKindStyle, Key: "c", Name: "C 画风",
	})
	if err != nil {
		t.Fatalf("新建失败：%v", err)
	}
	if item.SortOrder != 2 {
		t.Fatalf("新条目应排在末尾（2），得到 %d", item.SortOrder)
	}
	if !item.Enabled {
		t.Fatal("不传 enabled 时应默认启用")
	}
	if got := env.audit.actions(); len(got) != 1 || got[0] != model.AdminAuditDramaPresetCreate {
		t.Fatalf("审计动作不对：%v", got)
	}
}

// TestDramaPresetCreateRejectsGenrePrompt 检查题材不能带画风描述与预览图。
func TestDramaPresetCreateRejectsGenrePrompt(t *testing.T) {
	env := newPresetEnv()
	desc := "不该出现"
	_, err := env.svc.Create(context.Background(), presetActor, &model.SaveDramaPresetReq{
		Kind: model.DramaPresetKindGenre, Key: "wuxia", Name: "武侠", Prompt: &desc,
	})
	if !hasCode(err, errcode.ErrDramaPresetInvalid) {
		t.Fatalf("题材带描述应被拒绝，得到 %v", err)
	}
}

// TestDramaPresetCreateRejectsDuplicateKey 检查同种类 key 重复时给一句能看懂的话。
func TestDramaPresetCreateRejectsDuplicateKey(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{ID: 1, Kind: model.DramaPresetKindStyle, Key: "dup", Name: "已有", Enabled: true})
	_, err := env.svc.Create(context.Background(), presetActor, &model.SaveDramaPresetReq{
		Kind: model.DramaPresetKindStyle, Key: "dup", Name: "新的",
	})
	if !hasCode(err, errcode.ErrDramaPresetInvalid) || !strings.Contains(err.Error(), "已经存在") {
		t.Fatalf("重复 key 应返回 67038 且说明已存在，得到 %v", err)
	}
}

// TestDramaPresetUpdateKeepsKey 检查改名不动 key：key 是历史短剧唯一能对上的东西。
func TestDramaPresetUpdateKeepsKey(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{ID: 1, Kind: model.DramaPresetKindStyle, Key: "keep", Name: "旧名", Enabled: true})
	name := "新名"
	item, err := env.svc.Update(context.Background(), presetActor, 1, &model.UpdateDramaPresetReq{Name: &name})
	if err != nil {
		t.Fatalf("更新失败：%v", err)
	}
	if item.Key != "keep" || item.Name != "新名" {
		t.Fatalf("应为 key=keep / name=新名，得到 key=%s / name=%s", item.Key, item.Name)
	}
	if item.ID != 1 {
		t.Fatalf("id 变了：%d", item.ID)
	}
}

// TestDramaPresetUpdateRejectsUnsafePreviewURL 检查预览地址不接受伪协议：它会直接进 <img src>。
func TestDramaPresetUpdateRejectsUnsafePreviewURL(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{ID: 1, Kind: model.DramaPresetKindStyle, Key: "x", Name: "X", Enabled: true})
	bad := "javascript:alert(1)"
	if _, err := env.svc.Update(context.Background(), presetActor, 1, &model.UpdateDramaPresetReq{Preview: &bad}); !hasCode(err, errcode.ErrDramaPresetInvalid) {
		t.Fatalf("伪协议应被拒绝，得到 %v", err)
	}
	good := "/drama-styles/x.webp"
	if _, err := env.svc.Update(context.Background(), presetActor, 1, &model.UpdateDramaPresetReq{Preview: &good}); err != nil {
		t.Fatalf("站内绝对路径应通过：%v", err)
	}
}

// TestDramaPresetUpdateClearsPreviewLocator 检查手填地址后清掉平台存储定位，
// 否则公开预览路由还会按旧 key 返回上一张图。
func TestDramaPresetUpdateClearsPreviewLocator(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{
		ID: 1, Kind: model.DramaPresetKindStyle, Key: "x", Name: "X", Enabled: true,
		PreviewKey: "drama-presets/old.webp", PreviewStorageID: 3, PreviewURL: "/api/v1/drama-presets/previews/old.webp",
	})
	url := "https://cdn.example.com/new.webp"
	if _, err := env.svc.Update(context.Background(), presetActor, 1, &model.UpdateDramaPresetReq{Preview: &url}); err != nil {
		t.Fatalf("更新失败：%v", err)
	}
	row, err := env.repo.GetByID(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if row.PreviewKey != "" || row.PreviewStorageID != 0 {
		t.Fatalf("定位列应被清空，得到 key=%q storage=%d", row.PreviewKey, row.PreviewStorageID)
	}
}

// TestDramaPresetDeleteBlockedWhenInUse 检查被引用的预设只能停用：删掉会让那些剧的画风描述消失。
func TestDramaPresetDeleteBlockedWhenInUse(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{ID: 1, Kind: model.DramaPresetKindStyle, Key: "used", Name: "在用", Enabled: true})
	env.repo.StyleUsage["used"] = 2
	err := env.svc.Delete(context.Background(), presetActor, 1)
	if !hasCode(err, errcode.ErrDramaPresetInUse) || !strings.Contains(err.Error(), "2 部") {
		t.Fatalf("应返回 67039 且说明条数，得到 %v", err)
	}
	if _, err := env.repo.GetByID(context.Background(), 1); err != nil {
		t.Fatalf("被引用时不该删除：%v", err)
	}
}

// TestDramaPresetDeleteRemovesPreviewObject 检查删条目时顺手清掉平台存储里的预览图。
func TestDramaPresetDeleteRemovesPreviewObject(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{
		ID: 1, Kind: model.DramaPresetKindStyle, Key: "unused", Name: "没人用", Enabled: true,
		PreviewKey: "drama-presets/gone.webp", PreviewStorageID: 3,
	})
	if err := env.svc.Delete(context.Background(), presetActor, 1); err != nil {
		t.Fatalf("删除失败：%v", err)
	}
	if len(env.stores.Deletes) != 1 || env.stores.Deletes[0] != "drama-presets/gone.webp" {
		t.Fatalf("应删掉预览图对象，得到 %v", env.stores.Deletes)
	}
}

// TestDramaPresetReorder 检查重排：整组覆盖成功、集合不一致被拒。
func TestDramaPresetReorder(t *testing.T) {
	env := newPresetEnv(
		model.DramaPreset{ID: 1, Kind: model.DramaPresetKindGenre, Key: "a", Name: "A", SortOrder: 0, Enabled: true},
		model.DramaPreset{ID: 2, Kind: model.DramaPresetKindGenre, Key: "b", Name: "B", SortOrder: 1, Enabled: true},
	)
	if err := env.svc.Reorder(context.Background(), presetActor, model.DramaPresetKindGenre, []uint64{2, 1}); err != nil {
		t.Fatalf("重排失败：%v", err)
	}
	rows, _ := env.repo.ListAll(context.Background(), model.DramaPresetKindGenre)
	if len(rows) != 2 || rows[0].ID != 2 || rows[1].ID != 1 {
		t.Fatalf("顺序不对：%+v", rows)
	}

	// 少一个 id：前端拿了过期列表，必须拒绝而不是把另一个条目排没了
	if err := env.svc.Reorder(context.Background(), presetActor, model.DramaPresetKindGenre, []uint64{2}); !hasCode(err, errcode.ErrDramaPresetOrderBad) {
		t.Fatalf("集合不一致应返回 67034，得到 %v", err)
	}
}

// TestDramaPresetUploadPreview 检查预览图上传的类型与大小校验、落盘与地址生成。
func TestDramaPresetUploadPreview(t *testing.T) {
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)
	env := newPresetEnv(model.DramaPreset{ID: 1, Kind: model.DramaPresetKindStyle, Key: "s", Name: "S", Enabled: true})

	item, err := env.svc.UploadPreview(context.Background(), presetActor, 1, bytes.NewReader(png))
	if err != nil {
		t.Fatalf("上传失败：%v", err)
	}
	if len(env.stores.Puts) != 1 || !strings.HasPrefix(env.stores.Puts[0], "drama-presets/") || !strings.HasSuffix(env.stores.Puts[0], ".png") {
		t.Fatalf("对象 key 不对：%v", env.stores.Puts)
	}
	if !strings.HasPrefix(item.PreviewURL, "/api/v1/drama-presets/previews/") {
		t.Fatalf("预览地址应指向公开预览路由，得到 %s", item.PreviewURL)
	}

	// GIF 不在白名单里
	gif := append([]byte("GIF89a"), make([]byte, 64)...)
	if _, err := env.svc.UploadPreview(context.Background(), presetActor, 1, bytes.NewReader(gif)); !hasCode(err, errcode.ErrDramaPresetFileFormat) {
		t.Fatalf("GIF 应被拒绝，得到 %v", err)
	}

	// 超过 2MB
	huge := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, DramaPresetPreviewMaxBytes)...)
	if _, err := env.svc.UploadPreview(context.Background(), presetActor, 1, bytes.NewReader(huge)); !hasCode(err, errcode.ErrDramaPresetFileLarge) {
		t.Fatalf("超限应被拒绝，得到 %v", err)
	}

	// 题材没有预览图
	env2 := newPresetEnv(model.DramaPreset{ID: 2, Kind: model.DramaPresetKindGenre, Key: "g", Name: "G", Enabled: true})
	if _, err := env2.svc.UploadPreview(context.Background(), presetActor, 2, bytes.NewReader(png)); !hasCode(err, errcode.ErrDramaPresetInvalid) {
		t.Fatalf("题材上传预览图应被拒绝，得到 %v", err)
	}
}

// TestDramaPresetUploadPreviewReplacesOld 检查替换预览图时删掉旧对象，不留孤儿文件。
func TestDramaPresetUploadPreviewReplacesOld(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{
		ID: 1, Kind: model.DramaPresetKindStyle, Key: "s", Name: "S", Enabled: true,
		PreviewKey: "drama-presets/old.png", PreviewStorageID: 3,
	})
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)
	if _, err := env.svc.UploadPreview(context.Background(), presetActor, 1, bytes.NewReader(png)); err != nil {
		t.Fatalf("上传失败：%v", err)
	}
	if len(env.stores.Deletes) != 1 || env.stores.Deletes[0] != "drama-presets/old.png" {
		t.Fatalf("应删掉被替换的旧图，得到 %v", env.stores.Deletes)
	}
}

// TestDramaPresetPreviewTargetRejectsForeignKey 检查公开预览路由只认平台存储前缀。
func TestDramaPresetPreviewTargetRejectsForeignKey(t *testing.T) {
	env := newPresetEnv(model.DramaPreset{
		ID: 1, Kind: model.DramaPresetKindStyle, Key: "s", Name: "S", Enabled: true,
		PreviewKey: "drama-presets/ok.png", PreviewStorageID: 3,
	})
	if _, err := env.svc.PreviewTarget(context.Background(), "drama-styles/ok.webp"); !hasCode(err, errcode.ErrDramaPresetNotFound) {
		t.Fatalf("非平台存储 key 应 404，得到 %v", err)
	}
	if _, err := env.svc.PreviewTarget(context.Background(), DramaPresetPreviewObjectKey("ok.png")); err != nil {
		t.Fatalf("已知 key 应能解析：%v", err)
	}
}

// hasCode 判断 err 是否为指定错误码。
func hasCode(err error, want *errcode.Error) bool {
	if err == nil {
		return false
	}
	var e *errcode.Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Code == want.Code
}
