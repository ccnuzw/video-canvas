package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"

	. "video-canvas/internal/handler"
	"video-canvas/internal/middleware"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/utils"
	"video-canvas/internal/router"
	"video-canvas/internal/service"
	"video-canvas/internal/service/dramapresetfake"
)

// 本文件测试 /admin/drama-presets/*（admin 或 super_admin，删除只有 super_admin）
// 与公开预览路由 /api/v1/drama-presets/previews/*（不鉴权）。
// 路由用真实的 router.New（含 JWTAuth、RequireActive、RequireAdmin），服务用真实实现，仓储用内存 fake。

const (
	dpJWTSecret = "drama-preset-handler-secret"
	dpSuper     = 1
	dpAdmin     = 2
	dpNormal    = 3

	dpBase = "/api/v1/admin/drama-presets"
)

type dpEnv struct {
	engine *gin.Engine
	repo   *dramapresetfake.Repo
	stores *dramapresetfake.Store
	audit  *shAudit
	tokens map[int]string
}

func newDpEnv(t *testing.T, rows ...model.DramaPreset) *dpEnv {
	t.Helper()
	repo := dramapresetfake.NewRepo(rows...)
	stores := &dramapresetfake.Store{}
	audit := &shAudit{}
	svc := service.NewDramaPresetService(service.DramaPresetDeps{
		Repo: repo, Stores: dramapresetfake.Stores{Store: stores}, Audit: audit,
	})
	roles := map[uint64]string{dpSuper: model.RoleSuperAdmin, dpAdmin: model.RoleAdmin, dpNormal: model.RoleUser}
	stateLookup := func(_ context.Context, id uint64) (*middleware.UserState, error) {
		role, ok := roles[id]
		if !ok {
			return nil, nil
		}
		return &middleware.UserState{Role: role, Status: model.UserStatusActive}, nil
	}
	roleLookup := func(_ context.Context, id uint64) (string, error) { return roles[id], nil }
	env := &dpEnv{repo: repo, stores: stores, audit: audit, tokens: map[int]string{}}
	for id := range roles {
		tok, _, err := utils.GenerateToken(uint(id), "u"+strconv.Itoa(int(id)), 0, dpJWTSecret, "test", 1)
		if err != nil {
			t.Fatal(err)
		}
		env.tokens[int(id)] = tok
	}
	env.engine = router.New(gin.TestMode, dpJWTSecret, router.Handlers{
		DramaPreset: NewDramaPresetHandler(svc),
		AdminRole:   roleLookup,
		UserState:   stateLookup,
	})
	return env
}

// do 发一个 JSON 请求；user 为 0 表示不带登录凭证。
func (e *dpEnv) do(method, path string, body any, user int) shResp {
	var buf *bytes.Reader
	switch b := body.(type) {
	case nil:
		buf = bytes.NewReader(nil)
	case string:
		buf = bytes.NewReader([]byte(b))
	default:
		raw, _ := json.Marshal(b)
		buf = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, buf)
	req.Header.Set("Content-Type", "application/json")
	if user > 0 {
		req.Header.Set("Authorization", "Bearer "+e.tokens[user])
	}
	w := httptest.NewRecorder()
	e.engine.ServeHTTP(w, req)
	var parsed struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &parsed)
	return shResp{Status: w.Code, Code: parsed.Code, Msg: parsed.Msg, Data: parsed.Data, Raw: w.Body.String(), Header: w.Header()}
}

// seed 准备一条题材与一条画风，画风带内置静态预览图。
func seed() []model.DramaPreset {
	return []model.DramaPreset{
		{ID: 1, Kind: model.DramaPresetKindGenre, Key: "suspense", Name: "悬疑推理", SortOrder: 0, Enabled: true, IsBuiltin: true},
		{ID: 2, Kind: model.DramaPresetKindStyle, Key: "ink_wash", Name: "水墨风", Prompt: "以水墨笔触呈现", PreviewURL: "/drama-styles/ink_wash.webp", SortOrder: 0, Enabled: true, IsBuiltin: true},
	}
}

func TestDramaPresetHandler_Access(t *testing.T) {
	t.Run("未登录 401", func(t *testing.T) {
		e := newDpEnv(t, seed()...)
		if r := e.do(http.MethodGet, dpBase+"?kind=style", nil, 0); r.Status != http.StatusUnauthorized {
			t.Fatalf("期望 401，实际 %d：%s", r.Status, r.Raw)
		}
	})
	t.Run("普通用户 403", func(t *testing.T) {
		e := newDpEnv(t, seed()...)
		if r := e.do(http.MethodGet, dpBase+"?kind=style", nil, dpNormal); r.Status != http.StatusForbidden {
			t.Fatalf("期望 403，实际 %d：%s", r.Status, r.Raw)
		}
	})
	t.Run("删除只有 super_admin 能调", func(t *testing.T) {
		e := newDpEnv(t, seed()...)
		if r := e.do(http.MethodDelete, dpBase+"/1", nil, dpAdmin); r.Status != http.StatusForbidden {
			t.Fatalf("admin 删除应被拒，实际 %d：%s", r.Status, r.Raw)
		}
	})
}

func TestDramaPresetHandler_List(t *testing.T) {
	e := newDpEnv(t, seed()...)
	// 画风 ink_wash 有 3 部短剧在用
	e.repo.StyleUsage["ink_wash"] = 3

	r := e.do(http.MethodGet, dpBase+"?kind=style", nil, dpAdmin).want(t, 200, 0)
	items := r.obj(t)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("只应返回画风：%s", r.Raw)
	}
	item := items[0].(map[string]any)
	want := map[string]any{
		"id": float64(2), "kind": "style", "key": "ink_wash", "name": "水墨风",
		"preview_url": "/drama-styles/ink_wash.webp", "enabled": true,
		"is_builtin": true, "project_count": float64(3),
	}
	for k, v := range want {
		if item[k] != v {
			t.Fatalf("字段 %s 期望 %v，实际 %v", k, v, item[k])
		}
	}
	// 新建用的内部列不该出现
	for _, forbidden := range []string{"preview_key", "preview_storage_id"} {
		if _, ok := item[forbidden]; ok {
			t.Fatalf("不该暴露 %s：%v", forbidden, item)
		}
	}

	// 不传 kind 按参数错误返回，而不是把题材和画风混在一起
	e.do(http.MethodGet, dpBase, nil, dpAdmin).want(t, 400, 67038)
}

func TestDramaPresetHandler_CreateAndUpdate(t *testing.T) {
	e := newDpEnv(t, seed()...)

	// 新建画风：不传 enabled 默认启用，排在同类末尾
	r := e.do(http.MethodPost, dpBase, map[string]any{
		"kind": "style", "key": "neo_noir", "name": "新黑色电影", "prompt": "以硬光与低饱和呈现",
	}, dpAdmin).want(t, 200, 0)
	item := r.obj(t)
	if item["key"] != "neo_noir" || item["enabled"] != true || item["sort_order"] != float64(1) {
		t.Fatalf("新建结果不对：%s", r.Raw)
	}

	// 重复 key：400 并说明已存在
	dup := e.do(http.MethodPost, dpBase, map[string]any{"kind": "style", "key": "neo_noir", "name": "再来一条"}, dpAdmin)
	dup.want(t, 400, 67038)
	if dup.Msg == "" {
		t.Fatal("重复 key 要给一句能看懂的话")
	}

	// 改名：key 不变
	id := int(item["id"].(float64))
	upd := e.do(http.MethodPut, dpBase+"/"+strconv.Itoa(id), map[string]any{"name": "改个名"}, dpAdmin).want(t, 200, 0)
	if upd.obj(t)["name"] != "改个名" || upd.obj(t)["key"] != "neo_noir" {
		t.Fatalf("改名结果不对：%s", upd.Raw)
	}

	// 审计留痕：create + update
	if len(e.audit.actions) != 2 {
		t.Fatalf("应有两次审计，实际 %v", e.audit.actions)
	}
}

func TestDramaPresetHandler_ReorderAndEnabled(t *testing.T) {
	e := newDpEnv(t, seed()...)

	// 重排题材：只有一条时顺序不变
	e.do(http.MethodPut, dpBase+"/order", map[string]any{"kind": "genre", "ids": []uint64{1}}, dpAdmin).want(t, 200, 0)

	// 集合不一致：400 / 67040
	e.do(http.MethodPut, dpBase+"/order", map[string]any{"kind": "style", "ids": []uint64{1}}, dpAdmin).want(t, 400, 67040)

	// 停用
	r := e.do(http.MethodPut, dpBase+"/2/enabled", map[string]any{"enabled": false}, dpAdmin).want(t, 200, 0)
	if r.obj(t)["enabled"] != false {
		t.Fatalf("停用后应为 false：%s", r.Raw)
	}
}

func TestDramaPresetHandler_Delete(t *testing.T) {
	t.Run("被引用只能停用", func(t *testing.T) {
		e := newDpEnv(t, seed()...)
		e.repo.StyleUsage["ink_wash"] = 4
		r := e.do(http.MethodDelete, dpBase+"/2", nil, dpSuper)
		r.want(t, 409, 67039)
		if r.Msg == "" {
			t.Fatal("要说清楚有多少部剧在用")
		}
	})
	t.Run("没人用可以删", func(t *testing.T) {
		e := newDpEnv(t, seed()...)
		e.do(http.MethodDelete, dpBase+"/2", nil, dpSuper).want(t, 200, 0)
		if _, err := e.repo.GetByID(context.Background(), 2); err == nil {
			t.Fatal("应已删除")
		}
	})
}

func TestDramaPresetHandler_PreviewIsPublic(t *testing.T) {
	e := newDpEnv(t, seed()...)
	// 不存在的预览图：不鉴权也要回 404（而不是 401），并且不能是 500
	if r := e.do(http.MethodGet, "/api/v1/drama-presets/previews/unknown.png", nil, 0); r.Status != http.StatusNotFound {
		t.Fatalf("期望 404，实际 %d：%s", r.Status, r.Raw)
	}
	// 内置条目的静态图不经过后端
	if r := e.do(http.MethodGet, "/api/v1/drama-presets/previews/drama-styles/ink_wash.webp", nil, 0); r.Status != http.StatusNotFound {
		t.Fatalf("带路径分隔符的 key 应 404，实际 %d", r.Status)
	}
}
