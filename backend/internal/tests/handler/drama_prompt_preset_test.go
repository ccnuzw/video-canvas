package handler_test

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"

	"video-canvas/internal/handler"
	"video-canvas/internal/middleware"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

type httpPresetStore struct {
	repository.DramaPromptPresetTx
}

func (store httpPresetStore) PresetRows(_ context.Context, _, _ bool) ([]model.DramaPromptPresetRow, error) {
	rows := []model.DramaPromptPresetRow{}
	for _, step := range service.DramaPromptSteps {
		row := model.DramaPromptPreset{ID: 1, Step: step, Name: "标准版", Body: "不下发的管理正文", Status: model.DramaPresetEnabled, Revision: 1}
		rows = append(rows, model.DramaPromptPresetRow{DramaPromptPreset: row, DefaultID: 1, GroupRevision: 1})
	}
	return rows, nil
}

func (store httpPresetStore) WithTx(_ context.Context, apply func(repository.DramaPromptPresetTx) error) error {
	return apply(store)
}

func (store httpPresetStore) LockGroup(_ context.Context, step string) (*model.DramaPromptPresetGroup, error) {
	return &model.DramaPromptPresetGroup{Step: step, DefaultID: 1, Revision: 1}, nil
}

func (store httpPresetStore) Preset(_ context.Context, step string, id uint64) (*model.DramaPromptPreset, error) {
	if id > 2 {
		return nil, repository.ErrNotFound
	}
	return &model.DramaPromptPreset{ID: id, Step: step, Name: "模板", Body: "正文", Status: model.DramaPresetEnabled, Revision: 1}, nil
}

func (store httpPresetStore) SavePreset(_ context.Context, row *model.DramaPromptPreset) error {
	if row.ID == 0 {
		row.ID = 9
	}
	return nil
}

func (store httpPresetStore) SaveGroup(context.Context, *model.DramaPromptPresetGroup) error {
	return nil
}
func (store httpPresetStore) InsertAudit(context.Context, *model.AdminAuditLog) error { return nil }

func presetHTTPRouter(role string) *gin.Engine {
	api := handler.NewDramaHandler(service.NewDramaService(service.DramaDeps{Presets: httpPresetStore{}}))
	router := gin.New()
	router.Use(func(ctx *gin.Context) { ctx.Set(middleware.CtxUserIDKey, uint(7)); ctx.Next() })
	router.GET("/drama-prompt-presets", api.PromptPresetCatalog)
	admin := router.Group("/admin/drama-prompt-presets", middleware.RequireAdmin(func(context.Context, uint64) (string, error) { return role, nil }))
	admin.GET("", api.AdminPromptPresetCatalog)
	admin.POST("/:step", api.CreatePromptPreset)
	admin.PUT("/:step/:id", api.UpdatePromptPreset)
	admin.PUT("/:step/:id/state", api.SetPromptPresetState)
	return router
}

func TestDramaPresetHTTPVisibility(t *testing.T) {
	for _, role := range []string{model.RoleUser, model.RoleAdmin} {
		router := presetHTTPRouter(role)
		status, raw := characterCall(t, router, "GET", "/drama-prompt-presets", "")
		if status != 200 {
			t.Fatalf("用户目录：%d %+v", status, raw)
		}
		assertPresetBodyKey(t, raw, false)
		status, raw = characterCall(t, router, "GET", "/admin/drama-prompt-presets", "")
		if role == model.RoleAdmin && status == 200 {
			assertPresetBodyKey(t, raw, true)
		} else if role != model.RoleUser || status != 403 {
			t.Fatalf("后台目录权限：%s %d %+v", role, status, raw)
		}
	}
}

func assertPresetBodyKey(t *testing.T, raw map[string]any, want bool) {
	t.Helper()
	group := responseData(t, raw)["items"].([]any)[0].(map[string]any)
	item := group["items"].([]any)[0].(map[string]any)
	if _, ok := item["body"]; ok != want {
		t.Fatalf("正文可见性不符：%+v", item)
	}
}

func TestDramaPresetHTTPWrite(t *testing.T) {
	plan := "/admin/drama-prompt-presets/plan"
	preset := plan + "/" + idcodec.Encode(2)
	router := presetHTTPRouter(model.RoleAdmin)
	for _, tc := range []struct {
		method, path, body string
		status, code       int
	}{
		{"POST", plan, `{"name":"快节奏","body":"正文"}`, 201, 0},
		{"POST", plan, `{"body":"正文"}`, 400, 10001},
		{"POST", "/admin/drama-prompt-presets/board", `{"name":"错误","body":"缺少画面占位符"}`, 400, 67017},
		{"PUT", preset, `{"name":"新版","body":"新版正文","revision":1}`, 200, 0},
		{"PUT", preset, `{"name":"新版","body":"新版正文","revision":2}`, 409, 67031},
		{"PUT", preset + "/state", `{"action":"default","revision":1}`, 200, 0},
		{"PUT", preset + "/state", `{"action":"invalid","revision":1}`, 400, 10001},
		{"PUT", plan + "/" + idcodec.Encode(1) + "/state", `{"action":"archive","revision":1}`, 409, 67032},
	} {
		status, raw := characterCall(t, router, tc.method, tc.path, tc.body)
		if status != tc.status || raw["code"] != float64(tc.code) {
			t.Errorf("%s %s: %d %+v", tc.method, tc.path, status, raw)
		}
	}
}
