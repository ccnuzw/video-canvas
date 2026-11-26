package repository_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"gorm.io/gorm"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

func scriptFixture(t *testing.T) (*repository.DramaRepository, *gorm.DB, uint64, uint64) {
	t.Helper()
	db := isolatedDB(t, &model.DramaProject{}, &model.DramaEpisode{}, &model.DramaScriptCharacter{}, &model.DramaScriptLocation{}, &model.DramaScene{}, &model.DramaScriptElement{})
	p := model.DramaProject{UserID: 1, CanvasID: 9, Title: "剧", SourceText: "文", StyleKey: "real_city_film"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	ep := model.DramaEpisode{UserID: 1, DramaID: p.ID, No: 1}
	if err := db.Create(&ep).Error; err != nil {
		t.Fatal(err)
	}
	return repository.NewDramaRepository(db), db, p.ID, ep.ID
}

func el(ty string, cid uint64, text string) model.DramaScriptElement {
	return model.DramaScriptElement{Type: ty, CharacterID: cid, Text: text}
}

func TestDramaScriptRows_ReplaceInsertUpdateDelete(t *testing.T) {
	r, db, dramaID, epID := scriptFixture(t)
	ctx := context.Background()
	first := []model.DramaSceneRows{
		{Scene: model.DramaScene{TimeLabel: "夜", Title: "码头"}, Elements: []model.DramaScriptElement{el("action", 0, "雨。"), el("character", 2, ""), el("dialogue", 0, "你瞒了我什么？")}},
		{Scene: model.DramaScene{TimeLabel: "日", Title: "老宅"}, Elements: []model.DramaScriptElement{el("action", 0, "门开了。")}},
	}
	saved, err := r.ReplaceScriptRows(ctx, 1, dramaID, epID, first)
	if err != nil {
		t.Fatal(err)
	}
	if saved[0].Scene.ID == 0 || saved[0].Elements[2].ID == 0 || saved[1].Scene.Position != 1 {
		t.Fatalf("新行应分配 ID 并按顺序编号：%+v", saved)
	}

	// 第二次：保留第一场（改标题、删第一个动作、把第二场的动作挪进第一场）、删掉第二场、新增一场
	moved := saved[1].Elements[0]
	second := []model.DramaSceneRows{
		{Scene: saved[0].Scene, Elements: []model.DramaScriptElement{saved[0].Elements[1], saved[0].Elements[2], moved}},
		{Scene: model.DramaScene{TimeLabel: "夜", Title: "天台"}, Elements: []model.DramaScriptElement{el("action", 0, "风很大。")}},
	}
	second[0].Scene.Title = "码头对峙"
	got, err := r.ReplaceScriptRows(ctx, 1, dramaID, epID, second)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Scene.ID != saved[0].Scene.ID || got[1].Scene.ID == saved[1].Scene.ID {
		t.Fatalf("带 ID 的场次沿用，新增场次拿新 ID：%+v", got)
	}
	rows, err := r.ScriptRows(ctx, 1, epID)
	if err != nil || len(rows) != 2 {
		t.Fatalf("读回：%+v %v", rows, err)
	}
	if rows[0].Scene.Title != "码头对峙" || len(rows[0].Elements) != 3 {
		t.Fatalf("第一场：%+v", rows[0])
	}
	texts := []string{}
	for _, e := range rows[0].Elements {
		texts = append(texts, e.Text)
	}
	if !reflect.DeepEqual(texts, []string{"", "你瞒了我什么？", "门开了。"}) || rows[0].Elements[2].ID != moved.ID {
		t.Fatalf("元素应按新顺序，且挪过来的元素沿用原 ID：%v", texts)
	}
	if rows[1].Scene.Title != "天台" {
		t.Fatalf("第二场：%+v", rows[1])
	}
	var gone int64
	if err := db.Model(&model.DramaScriptElement{}).Where("id = ?", saved[0].Elements[0].ID).Count(&gone).Error; err != nil || gone != 0 {
		t.Fatalf("被丢掉的元素应删除：%d %v", gone, err)
	}
}

func TestDramaScriptRows_RejectsForeignIDsAndOtherUsers(t *testing.T) {
	r, _, dramaID, epID := scriptFixture(t)
	ctx := context.Background()
	saved, err := r.ReplaceScriptRows(ctx, 1, dramaID, epID, []model.DramaSceneRows{{Scene: model.DramaScene{Title: "甲"}, Elements: []model.DramaScriptElement{el("action", 0, "a")}}})
	if err != nil {
		t.Fatal(err)
	}
	// 另一个用户读不到
	if rows, err := r.ScriptRows(ctx, 2, epID); err != nil || len(rows) != 0 {
		t.Fatalf("他人不应读到：%+v %v", rows, err)
	}
	// 带上别的集或别人的 ID 会被拒绝，且不破坏原数据
	forged := saved[0]
	forged.Scene.ID += 1000
	if _, err := r.ReplaceScriptRows(ctx, 1, dramaID, epID, []model.DramaSceneRows{forged}); !errors.Is(err, repository.ErrScriptRowMissing) {
		t.Fatalf("伪造场次 ID：%v", err)
	}
	if _, err := r.ReplaceScriptRows(ctx, 2, dramaID, epID, []model.DramaSceneRows{saved[0]}); !errors.Is(err, repository.ErrScriptRowMissing) {
		t.Fatalf("他人用别人的 ID：%v", err)
	}
	if rows, _ := r.ScriptRows(ctx, 1, epID); len(rows) != 1 || rows[0].Scene.Title != "甲" {
		t.Fatalf("原数据应完好：%+v", rows)
	}
}

func TestDramaScriptRefsAndEntities(t *testing.T) {
	r, _, dramaID, epID := scriptFixture(t)
	ctx := context.Background()
	c := model.DramaScriptCharacter{UserID: 1, DramaID: dramaID, Name: "林骁", Aliases: []string{"林川"}}
	if err := r.SaveScriptCharacter(ctx, &c); err != nil || c.ID == 0 {
		t.Fatalf("新建人物：%v", err)
	}
	loc := model.DramaScriptLocation{UserID: 1, DramaID: dramaID, Name: "城西老码头"}
	if err := r.SaveScriptLocation(ctx, &loc); err != nil {
		t.Fatal(err)
	}
	extra := model.DramaScene{ExtraCharacterIDs: []uint64{c.ID}, LocationID: loc.ID}
	if _, err := r.ReplaceScriptRows(ctx, 1, dramaID, epID, []model.DramaSceneRows{{Scene: extra, Elements: []model.DramaScriptElement{el("action", 0, "x")}}}); err != nil {
		t.Fatal(err)
	}
	for kind, id := range map[string]uint64{"character": c.ID, "location": loc.ID} {
		if refs, err := r.ScriptRefs(ctx, 1, dramaID, kind, id); err != nil || !reflect.DeepEqual(refs, []uint64{epID}) {
			t.Fatalf("%s 引用：%v %v", kind, refs, err)
		}
	}
	if refs, _ := r.ScriptRefs(ctx, 1, dramaID, "character", c.ID+99); len(refs) != 0 {
		t.Fatalf("未被引用的人物不应有引用：%v", refs)
	}

	// 改名 + 别名；他人不能改
	c.Name, c.Confirmed = "林骁（改）", true
	if err := r.SaveScriptCharacter(ctx, &c); err != nil {
		t.Fatal(err)
	}
	other := c
	other.UserID = 2
	if err := r.SaveScriptCharacter(ctx, &other); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("他人改名应返回不存在：%v", err)
	}
	if err := r.DeleteScriptCharacter(ctx, 2, dramaID, c.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("他人删除：%v", err)
	}
	if err := r.DeleteScriptCharacter(ctx, 1, dramaID, c.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := r.ScriptCharacters(ctx, 1, dramaID); len(list) != 0 {
		t.Fatalf("删除后应为空：%+v", list)
	}
}
