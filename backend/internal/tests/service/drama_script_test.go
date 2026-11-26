package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/service"
)

const (
	scriptEp1 = "第1集\n\n1-1 夜/外 · 城西老码头\n人物：林骁、苏晚\n苏晚：你到底瞒了我什么？\n林骁（压低声音）：这事别让她知道。\n△ 远处传来汽笛声。"
	scriptEp2 = "第2集\n\n2-1 日/内 · 林家老宅客厅\n老周：少爷，老爷子醒了。"
)

// scriptFixture 一部三集的剧：第 1 集有文本未锁定，第 2 集有文本已锁定，第 3 集为空。
func scriptFixture(t *testing.T) (*dramaMemory, *service.DramaService) {
	t.Helper()
	r := newDramaMemory()
	dramaAddEpisode(r, 1, scriptEp1)
	dramaAddEpisode(r, 2, scriptEp2)
	dramaAddEpisode(r, 3, "")
	locked := time.Now()
	r.episodes[1].LockedAt = &locked
	s, _ := dramaTestService(r, &dramaTextStreamer{}, nil)
	return r, s
}

func idOf(v idcodec.ID) uint64 { return uint64(v) }

func TestDramaScript_GetConvertsWholeDramaLazily(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	v, err := s.GetScript(ctx, 7, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !r.project.ScriptStructured || len(v.Scenes) != 1 || v.Locked || v.Revision != 1 {
		t.Fatalf("第一次读应转换整部剧且不升 revision：structured=%v view=%+v", r.project.ScriptStructured, v)
	}
	// 苏晚（角色+对白）2 行，林骁（角色+括号+对白）3 行，动作 1 行
	if got := len(v.Scenes[0].Elements); got != 6 {
		t.Fatalf("第 1 场应有 6 个元素：%d", got)
	}
	// 未锁定集换成渲染结果；锁定集 script_md 原样保留，但结构已建好
	if !strings.Contains(r.episodes[0].ScriptMD, "人物：苏晚、林骁") {
		t.Fatalf("未锁定集应归一格式：%q", r.episodes[0].ScriptMD)
	}
	if r.episodes[1].ScriptMD != scriptEp2 || r.episodes[1].Revision != 1 {
		t.Fatalf("锁定集 script_md 和 revision 都不能动：%+v", r.episodes[1])
	}
	locked, err := s.GetScript(ctx, 7, 1, 2)
	if err != nil || !locked.Locked || len(locked.Scenes) != 1 {
		t.Fatalf("锁定集也有结构且标记只读：%+v %v", locked, err)
	}
	empty, err := s.GetScript(ctx, 7, 1, 3)
	if err != nil || len(empty.Scenes) != 0 {
		t.Fatalf("空集没有场次：%+v %v", empty, err)
	}
	people, err := s.ListScriptEntities(ctx, 7, 1, "character")
	if err != nil || len(people) != 3 {
		t.Fatalf("应登记三个人物：%+v %v", people, err)
	}
	for _, p := range people {
		if p.Confirmed {
			t.Fatalf("自动登记的人物应为待确认：%+v", p)
		}
	}
}

func TestDramaScript_GetNotFound(t *testing.T) {
	_, s := scriptFixture(t)
	_, err := s.GetScript(context.Background(), 8, 1, 1)
	dramaCheckCode(t, err, 67001)
	_, err = s.GetScript(context.Background(), 7, 1, 99)
	dramaCheckCode(t, err, 67001)
}

func TestDramaScript_PutSavesRendersAndGuards(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	v, err := s.GetScript(ctx, 7, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	clone := func() *service.SaveDramaScriptReq {
		req := &service.SaveDramaScriptReq{Revision: v.Revision, Scenes: append([]service.DramaScriptSceneView{}, v.Scenes...)}
		req.Scenes[0].Elements = append([]service.DramaScriptElementView{}, v.Scenes[0].Elements...)
		return req
	}

	// 成功：改一句对白，revision+1，script_md 同步渲染，新行拿到 ID
	req := clone()
	for i, e := range req.Scenes[0].Elements {
		if e.Type == "dialogue" && strings.HasPrefix(e.Text, "这事") {
			req.Scenes[0].Elements[i].Text = "这事，别让任何人知道。"
		}
	}
	req.Scenes[0].Elements = append(req.Scenes[0].Elements, service.DramaScriptElementView{Type: "action", Text: "雨停了。"})
	saved, err := s.PutScript(ctx, 7, 1, 1, req)
	if err != nil {
		t.Fatal(err)
	}
	last := saved.Scenes[0].Elements[len(saved.Scenes[0].Elements)-1]
	if saved.Revision != v.Revision+1 || last.ID == 0 || !strings.Contains(r.episodes[0].ScriptMD, "别让任何人知道") || !strings.Contains(r.episodes[0].ScriptMD, "△ 雨停了。") {
		t.Fatalf("保存结果：%+v md=%q", saved, r.episodes[0].ScriptMD)
	}

	// 旧 revision → 409
	_, err = s.PutScript(ctx, 7, 1, 1, req)
	dramaCheckCode(t, err, 30002)

	// 锁定集 → 67005
	lockedReq := &service.SaveDramaScriptReq{Revision: 1, Scenes: []service.DramaScriptSceneView{}}
	_, err = s.PutScript(ctx, 7, 1, 2, lockedReq)
	dramaCheckCode(t, err, 67005)

	// 对白前没有角色行 → 67043，并写明位置
	bad := &service.SaveDramaScriptReq{Revision: saved.Revision, Scenes: []service.DramaScriptSceneView{{Elements: []service.DramaScriptElementView{{Type: "action", Text: "a"}, {Type: "dialogue", Text: "孤零零的台词"}}}}}
	_, err = s.PutScript(ctx, 7, 1, 1, bad)
	dramaCheckCode(t, err, 67043)
	if !strings.Contains(err.Error(), "第 1 场第 2 行") {
		t.Fatalf("错误信息应写明位置：%v", err)
	}

	// 引用了不存在的人物 → 参数错误
	ghost := &service.SaveDramaScriptReq{Revision: saved.Revision, Scenes: []service.DramaScriptSceneView{{Elements: []service.DramaScriptElementView{{Type: "character", CharacterID: idcodec.ID(99999)}, {Type: "dialogue", Text: "x"}}}}}
	_, err = s.PutScript(ctx, 7, 1, 1, ghost)
	dramaCheckCode(t, err, 10001)

	// 别人的剧 → 67001
	_, err = s.PutScript(ctx, 8, 1, 1, req)
	dramaCheckCode(t, err, 67001)
}

func TestDramaScript_ParseRegistersNewNames(t *testing.T) {
	ctx := context.Background()
	_, s := scriptFixture(t)
	v, err := s.ParseScript(ctx, 7, 1, &service.ParseDramaScriptReq{Text: "3-1 夜/外 · 天台\n护士：林先生！\n这一行不认识"})
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Scenes) != 1 || len(v.Warnings) != 1 || idOf(v.Scenes[0].LocationID) == 0 {
		t.Fatalf("解析结果：%+v", v)
	}
	people, _ := s.ListScriptEntities(ctx, 7, 1, "character")
	places, _ := s.ListScriptEntities(ctx, 7, 1, "location")
	var nurse, roof bool
	for _, p := range people {
		nurse = nurse || (p.Name == "护士" && !p.Confirmed)
	}
	for _, p := range places {
		roof = roof || (p.Name == "天台" && !p.Confirmed)
	}
	if !nurse || !roof {
		t.Fatalf("新名字应登记为待确认：%+v %+v", people, places)
	}
	_, err = s.ParseScript(ctx, 8, 1, &service.ParseDramaScriptReq{Text: "x"})
	dramaCheckCode(t, err, 67001)
}

func TestDramaScript_EntityCreateRenameDelete(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	if _, err := s.GetScript(ctx, 7, 1, 1); err != nil {
		t.Fatal(err)
	}
	// 新建：直接已确认；名字或别名撞了已有条目 → 67045
	biao, err := s.CreateScriptEntity(ctx, 7, 1, "character", &service.CreateDramaScriptEntityReq{Name: "阿彪", Aliases: []string{"彪哥"}})
	if err != nil || !biao.Confirmed {
		t.Fatalf("新建：%+v %v", biao, err)
	}
	_, err = s.CreateScriptEntity(ctx, 7, 1, "character", &service.CreateDramaScriptEntityReq{Name: "路人", Aliases: []string{"苏晚"}})
	dramaCheckCode(t, err, 67045)
	_, err = s.CreateScriptEntity(ctx, 7, 1, "character", &service.CreateDramaScriptEntityReq{Name: " 阿彪 "})
	dramaCheckCode(t, err, 67045)

	// 改名：旧名进别名、条目变已确认、未锁定集重渲染并升 revision、锁定集不动
	people, _ := s.ListScriptEntities(ctx, 7, 1, "character")
	var lin uint64
	for _, p := range people {
		if p.Name == "林骁" {
			lin = idOf(p.ID)
		}
	}
	name := "林晓"
	before := r.episodes[0].Revision
	renamed, err := s.UpdateScriptEntity(ctx, 7, 1, "character", lin, &service.UpdateDramaScriptEntityReq{Name: &name})
	if err != nil || renamed.Name != "林晓" || !renamed.Confirmed || len(renamed.Aliases) != 1 || renamed.Aliases[0] != "林骁" {
		t.Fatalf("改名：%+v %v", renamed, err)
	}
	if !strings.Contains(r.episodes[0].ScriptMD, "林晓（压低声音）：") || strings.Contains(r.episodes[0].ScriptMD, "林骁（") || r.episodes[0].Revision != before+1 {
		t.Fatalf("未锁定集应按新名重渲染并升 revision：%q rev=%d", r.episodes[0].ScriptMD, r.episodes[0].Revision)
	}
	if r.episodes[1].ScriptMD != scriptEp2 {
		t.Fatalf("锁定集不动：%q", r.episodes[1].ScriptMD)
	}
	taken := "苏晚"
	_, err = s.UpdateScriptEntity(ctx, 7, 1, "character", lin, &service.UpdateDramaScriptEntityReq{Name: &taken})
	dramaCheckCode(t, err, 67045)
	_, err = s.UpdateScriptEntity(ctx, 7, 1, "character", 424242, &service.UpdateDramaScriptEntityReq{Name: &name})
	dramaCheckCode(t, err, 67001)

	// 删除：仍被引用 → 67044 并点名集号；没人引用的可以删，再删一次 → 67001
	err = s.DeleteScriptEntity(ctx, 7, 1, "character", lin)
	dramaCheckCode(t, err, 67044)
	if !strings.Contains(err.Error(), "第 1 集") {
		t.Fatalf("应点名引用它的集：%v", err)
	}
	if err = s.DeleteScriptEntity(ctx, 7, 1, "character", idOf(biao.ID)); err != nil {
		t.Fatal(err)
	}
	dramaCheckCode(t, s.DeleteScriptEntity(ctx, 7, 1, "character", idOf(biao.ID)), 67001)
}

func TestDramaScript_TextWriteKeepsSceneInfoAndNotes(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	v, err := s.GetScript(ctx, 7, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	// 用户手动加场次信息和一条备注
	req := &service.SaveDramaScriptReq{Revision: v.Revision, Scenes: append([]service.DramaScriptSceneView{}, v.Scenes...)}
	req.Scenes[0].Title, req.Scenes[0].Summary, req.Scenes[0].Emotions = "码头对峙", "苏晚逼问信封来历", []string{"紧张"}
	req.Scenes[0].Elements = append(append([]service.DramaScriptElementView{}, v.Scenes[0].Elements...), service.DramaScriptElementView{Type: "note", Text: "汽笛声要压低"})
	saved, err := s.PutScript(ctx, 7, 1, 1, req)
	if err != nil {
		t.Fatal(err)
	}
	// Agent 审批后用整段文本改一句对白（内部调用才带 script_md）
	text := strings.Replace(r.episodes[0].ScriptMD, "这事别让她知道", "这事，别让任何人知道", 1)
	if _, err = s.UpdateEpisode(ctx, 7, 1, 1, &model.UpdateDramaEpisodeReq{Revision: saved.Revision, ScriptMD: &text}); err != nil {
		t.Fatal(err)
	}
	after, err := s.GetScript(ctx, 7, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	sc := after.Scenes[0]
	if sc.ID != saved.Scenes[0].ID || sc.Title != "码头对峙" || sc.Summary != "苏晚逼问信封来历" || len(sc.Emotions) != 1 {
		t.Fatalf("整段重写后场次信息应保留：%+v", sc)
	}
	hasNote := false
	for _, e := range sc.Elements {
		hasNote = hasNote || (e.Type == "note" && e.Text == "汽笛声要压低")
	}
	if !hasNote || !strings.Contains(r.episodes[0].ScriptMD, "别让任何人知道") || strings.Contains(r.episodes[0].ScriptMD, "汽笛声要压低") {
		t.Fatalf("备注应保留且不进 script_md：%+v md=%q", sc.Elements, r.episodes[0].ScriptMD)
	}
}

func TestDramaScript_PreviewMatchesWhatIsSaved(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	raw := "1-1 夜/外 · 城西老码头\n护士：林先生！\n苏晚：来了。"
	md, err := s.PreviewScript(ctx, 7, 1, 1, raw)
	if err != nil || !strings.Contains(md, "护士：林先生！") {
		t.Fatalf("预览应认出新人物：%q %v", md, err)
	}
	// 预览不写库
	if people, _ := s.ListScriptEntities(ctx, 7, 1, "character"); len(people) != 3 {
		t.Fatalf("预览不应登记人物：%+v", people)
	}
	// 真正保存后 script_md 与预览一致；再解析预览文本，结果不变（审批重放幂等的前提）
	ep, _ := s.GetScript(ctx, 7, 1, 1)
	if _, err = s.UpdateEpisode(ctx, 7, 1, 1, &model.UpdateDramaEpisodeReq{Revision: ep.Revision, ScriptMD: &md}); err != nil {
		t.Fatal(err)
	}
	if r.episodes[0].ScriptMD != md {
		t.Fatalf("保存的应与预览一致：\n%q\n%q", r.episodes[0].ScriptMD, md)
	}
	if again, _ := s.PreviewScript(ctx, 7, 1, 1, md); again != md {
		t.Fatalf("预览文本再预览应不变：%q", again)
	}
	_, err = s.PreviewScript(ctx, 8, 1, 1, raw)
	dramaCheckCode(t, err, 67001)
}
