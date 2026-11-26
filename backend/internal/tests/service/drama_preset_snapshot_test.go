package service_test

import (
	"context"
	"strings"
	"testing"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
	"video-canvas/internal/service"
)

func TestDramaPresetDraftDoesNotReplaceFormattingProtocol(t *testing.T) {
	snapshot := `{"video":{"source":"preset","id":3,"version":2,"label":"运营模板","bodies":{"storyboard":"运营模板快照标识","storyboard_format":"不能覆盖格式协议"}}}`
	creative, format := runStoryboardWithFormat(t, "h3", snapshot)
	if !strings.Contains(creative, "运营模板快照标识") || strings.Contains(format, "不能覆盖格式协议") || !strings.Contains(format, `"max_seconds":12`) {
		t.Fatalf("运营模板只可替换创作段，实际创作段=%q 格式段=%q", creative, format)
	}
}

type presetSnapshotStore struct {
	service.DramaPromptPresetRepo
	rows []model.DramaPromptPresetRow
}

func (s presetSnapshotStore) PresetRows(_ context.Context, _, _ bool) ([]model.DramaPromptPresetRow, error) {
	return s.rows, nil
}

func (s presetSnapshotStore) Preset(_ context.Context, step string, id uint64) (*model.DramaPromptPreset, error) {
	for _, row := range s.rows {
		if row.Step == step && row.ID == id {
			return &row.DramaPromptPreset, nil
		}
	}
	return nil, repository.ErrNotFound
}

func defaultPresetSnapshotStore() *presetSnapshotStore {
	store := &presetSnapshotStore{}
	for index, step := range service.DramaPromptSteps {
		id := uint64(index + 1)
		row := model.DramaPromptPreset{ID: id, Step: step, Name: "标准版", Body: drama.PromptBody(service.DramaPromptPages(step)[0]), Status: model.DramaPresetEnabled, Revision: 1}
		store.rows = append(store.rows, model.DramaPromptPresetRow{DramaPromptPreset: row, DefaultID: id, GroupRevision: 1})
	}
	return store
}

func TestDramaPresetBoardSnapshotAndConflict(t *testing.T) {
	ctx := context.Background()
	memory := newDramaMemory()
	store := defaultPresetSnapshotStore()
	svc, registry := dramaTestService(memory, &dramaTextStreamer{}, nil, store)
	dramaModelRegistry(registry, nil)
	if err := createWithModels(memory, svc, "", model.DramaImageModels{}); err != nil {
		t.Fatal(err)
	}
	board := &store.rows[5]
	assertBoardPresetSnapshot(t, svc, memory, board.Body, false, false)
	board.Body = "新版 {{画面}}"
	board.Revision++
	assertBoardPresetSnapshot(t, svc, memory, drama.PromptBody("board"), false, true)
	choice := model.DramaPromptChoice{Source: "preset", ID: idcodec.ID(board.ID), Revision: 1}
	patch := &model.UpdateDramaReq{Revision: memory.project.Revision, Prompts: map[string]model.DramaPromptChoice{"board": choice}}
	_, err := svc.Update(ctx, 7, memory.project.ID, patch)
	dramaCheckCode(t, err, 67031)
	patch.Prompts["board"] = model.DramaPromptChoice{Source: "preset", ID: idcodec.ID(board.ID), Revision: 2}
	if _, err = svc.Update(ctx, 7, memory.project.ID, patch); err != nil {
		t.Fatal(err)
	}
	board.Status = model.DramaPresetArchived
	assertBoardPresetSnapshot(t, svc, memory, "新版 {{画面}}", true, false)
	patch.Revision = memory.project.Revision
	_, err = svc.Update(ctx, 7, memory.project.ID, patch)
	dramaCheckCode(t, err, 67031)
	patch.Prompts = map[string]model.DramaPromptChoice{"video": choice}
	_, err = svc.Update(ctx, 7, memory.project.ID, patch)
	dramaCheckCode(t, err, 67031)
}

func assertBoardPresetSnapshot(t *testing.T, svc *service.DramaService, memory *dramaMemory, body string, missing, update bool) {
	t.Helper()
	view, err := svc.Get(context.Background(), 7, memory.project.ID)
	if err != nil {
		t.Fatal(err)
	}
	board := view.PromptSettings["board"]
	if board.Source != "preset" || board.Bodies["board"] != body || board.Missing != missing || board.UpdateAvailable != update || view.PromptSettings["plan"].Bodies != nil {
		t.Fatalf("故事板快照不符：%+v", board)
	}
}

func TestDramaPresetPlanningPatchValidatesFinalModelAndPrompt(t *testing.T) {
	ctx := context.Background()
	memory := newDramaMemory()
	store := defaultPresetSnapshotStore()
	svc, registry := dramaTestService(memory, &dramaTextStreamer{}, nil, store)
	plan := store.rows[0].DramaPromptPreset
	long := plan
	long.ID, long.Name = 50, "长规划模板"
	long.Body += strings.Repeat("长", 3500)
	store.rows = append(store.rows, model.DramaPromptPresetRow{DramaPromptPreset: long, DefaultID: plan.ID})
	token := seedDramaDraft(memory, "第1章 开始\n"+strings.Repeat("短", 2000)+"\n第2章 结尾\n终")
	project, err := svc.Create(ctx, 7, &model.CreateDramaReq{SourceToken: token, SourceKind: "novel", StyleKey: "custom", StyleCustom: "写实"})
	if err != nil {
		t.Fatal(err)
	}
	registry.snap.Model.Capabilities.Context.Window = 20000
	key := "text"
	patch := &model.UpdateDramaReq{Revision: project.Revision, TextModel: &key, Prompts: map[string]model.DramaPromptChoice{
		"plan": {Source: "preset", ID: idcodec.ID(long.ID), Revision: long.Revision},
	}}
	before := string(memory.project.PromptSettings)
	_, err = svc.Update(ctx, 7, uint64(project.ID), patch)
	dramaCheckContextMsg(t, err, "第1章 开始")
	if string(memory.project.PromptSettings) != before || memory.project.TextModel != "" || memory.project.Revision != project.Revision {
		t.Fatal("容量校验失败不能保存模板、模型或改变项目修订")
	}
	patch.TextModel = nil
	_, err = svc.Update(ctx, 7, uint64(project.ID), patch)
	dramaCheckContextMsg(t, err, "第1章 开始")
	registry.snap.Model.Capabilities.Context.Window = 64000
	if _, err = svc.Update(ctx, 7, uint64(project.ID), patch); err != nil {
		t.Fatal(err)
	}
	registry.snap.Model.Capabilities.Context.Window = 20000
	patch.Revision, patch.TextModel = memory.project.Revision, &key
	patch.Prompts["plan"] = model.DramaPromptChoice{Source: "preset", ID: idcodec.ID(plan.ID), Revision: plan.Revision}
	if _, err = svc.Update(ctx, 7, uint64(project.ID), patch); err != nil {
		t.Fatalf("短模板和小窗口模型可以一起保存：%v", err)
	}
}
