package migration_test

import (
	"context"
	"errors"
	"io/fs"
	"sync"
	"testing"

	"video-canvas/internal/drama"
	"video-canvas/internal/migration"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
	"video-canvas/migrations"
)

func TestDramaPresetMigrationSeedsOriginalsAndDoesNotOverwriteEdits(t *testing.T) {
	db := isolatedDB(t)
	ctx := context.Background()
	if err := migration.Run(ctx, db, migration.Options{FS: migrationsExcept(t, "0048_"), Logger: testLogger()}); err != nil {
		t.Fatal(err)
	}
	runReal(t, db)
	svc := service.NewDramaService(service.DramaDeps{Presets: repository.NewDramaPromptPresetRepository(db)})
	groups, err := svc.PromptPresetCatalog(ctx, true)
	if err != nil || len(groups) != 6 {
		t.Fatalf("groups=%+v err=%v", groups, err)
	}
	for _, group := range groups {
		if len(group.Items) != 1 || group.DefaultID != group.Items[0].ID || group.Items[0].Status != "enabled" || group.Items[0].Body != drama.PromptBody(service.DramaPromptPages(group.Step)[0]) {
			t.Fatalf("默认模板不等于升级前正文：%s", group.Step)
		}
	}
	plan := groups[0].Items[0]
	planID, _ := idcodec.Decode(plan.ID)
	if _, err = svc.SavePromptPreset(ctx, 7, planID, "plan", model.SaveDramaPromptPresetReq{Name: "改过的默认", Body: "保留后台正文", Revision: plan.Revision}); err != nil {
		t.Fatal(err)
	}
	runReal(t, db)
	script, err := fs.ReadFile(migrations.FS, "0048_drama_prompt_presets.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(string(script)).Error; err != nil {
		t.Fatal(err)
	}
	groups, err = svc.PromptPresetCatalog(ctx, true)
	if err != nil || len(groups[0].Items) != 1 || groups[0].Items[0].Body != "保留后台正文" {
		t.Fatalf("重跑不应覆盖或插入另一条默认：%v %v", groups, err)
	}
}

func TestDramaPresetConcurrentDefaultAndDisable(t *testing.T) {
	db := isolatedDB(t)
	runReal(t, db)
	svc := service.NewDramaService(service.DramaDeps{Presets: repository.NewDramaPromptPresetRepository(db)})
	ctx := context.Background()
	item, err := svc.SavePromptPreset(ctx, 7, 0, "plan", model.SaveDramaPromptPresetReq{Name: "快节奏", Body: "写得紧凑"})
	if err != nil || item.Status != "disabled" {
		t.Fatalf("新建必须停用：%+v %v", item, err)
	}
	presetID, _ := idcodec.Decode(item.ID)
	if _, err = svc.SetPromptPresetState(ctx, 7, presetID, "plan", model.UpdateDramaPromptPresetStateReq{Action: "default", Revision: 1}); !errors.Is(err, errcode.ErrDramaPresetInactive) {
		t.Fatalf("不能把停用项设为默认：%v", err)
	}
	item, err = svc.SetPromptPresetState(ctx, 7, presetID, "plan", model.UpdateDramaPromptPresetStateReq{Action: "enable", Revision: item.Revision})
	if err != nil {
		t.Fatal(err)
	}
	assertPresetRace(t, svc, presetID, item.Revision)
	groups, err := svc.PromptPresetCatalog(ctx, false)
	if err != nil || len(groups) != 6 || groups[0].DefaultID == "" || groups[0].Items[0].ID != groups[0].DefaultID || groups[0].Items[0].Body != "" {
		t.Fatalf("目录不变量或普通目录暴露正文：%v %v", groups, err)
	}
	var audits int64
	if err = db.Model(&model.AdminAuditLog{}).Where("target_type = ? AND target_id = ?", "drama_preset", presetID).Count(&audits).Error; err != nil || audits != 3 {
		t.Fatalf("创建、启用、并发获胜操作各一条审计，got %d: %v", audits, err)
	}
}

func assertPresetRace(t *testing.T, svc *service.DramaService, presetID uint64, revision int) {
	t.Helper()
	start := make(chan struct{})
	results := make(chan error, 2)
	var ready sync.WaitGroup
	for _, request := range []model.UpdateDramaPromptPresetStateReq{{Action: "default", Revision: 1}, {Action: "disable", Revision: revision}} {
		ready.Go(func() {
			<-start
			_, err := svc.SetPromptPresetState(context.Background(), 7, presetID, "plan", request)
			results <- err
		})
	}
	close(start)
	ready.Wait()
	success := 0
	for range 2 {
		switch err := <-results; {
		case err == nil:
			success++
		case errors.Is(err, errcode.ErrDramaPresetDefault), errors.Is(err, errcode.ErrDramaPresetInactive):
		default:
			t.Fatalf("意外的并发结果：%v", err)
		}
	}
	if success != 1 {
		t.Fatalf("并发写必须只成功一个，实际 %d", success)
	}
}
