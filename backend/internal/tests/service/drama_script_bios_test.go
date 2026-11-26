package service_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/service"
)

const scriptBiosMD = "## 主要人物\n" +
	"- **林骁／林川**：码头搬运工，替父还债。\n" +
	"- **苏晚／晚晚**：林骁的青梅竹马。\n" +
	"- **赵强／彪哥**：放贷的债主。\n" +
	"- **王五**：看门的老头。\n"

func entityByName(list []service.DramaScriptEntityView, name string) *service.DramaScriptEntityView {
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

func TestDramaScript_ListImportsBiosOnce(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	r.project.CharactersMD = scriptBiosMD
	// 先有手动人物「阿彪」占用别名「彪哥」、手动人物「赵强」：传记里的赵强按正式名匹配上，被占用的别名跳过
	for _, req := range []service.CreateDramaScriptEntityReq{{Name: "阿彪", Aliases: []string{"彪哥"}}, {Name: "赵强"}} {
		if _, err := s.CreateScriptEntity(ctx, 7, 1, "character", &req); err != nil {
			t.Fatal(err)
		}
	}
	people, err := s.ListScriptEntities(ctx, 7, 1, "character")
	if err != nil {
		t.Fatal(err)
	}
	if !r.project.ScriptBiosImported {
		t.Fatal("列人物表后应标为已导入")
	}
	// 剧本里登记的林骁（待确认）：填小传、并入别名（已是正式名的不重复）、变已确认
	lin := entityByName(people, "林骁")
	if lin == nil || lin.Note != "码头搬运工，替父还债。" || !lin.Confirmed || strings.Join(lin.Aliases, ",") != "林川" {
		t.Fatalf("已有人物应填小传并确认：%+v", lin)
	}
	su := entityByName(people, "苏晚")
	if su == nil || su.Note != "林骁的青梅竹马。" || !su.Confirmed || strings.Join(su.Aliases, ",") != "晚晚" {
		t.Fatalf("苏晚应填小传、合并别名：%+v", su)
	}
	zhao := entityByName(people, "赵强")
	if zhao == nil || zhao.Note != "放贷的债主。" || !zhao.Confirmed || len(zhao.Aliases) != 0 {
		t.Fatalf("赵强应填小传且跳过被占用的别名：%+v", zhao)
	}
	if biao := entityByName(people, "阿彪"); biao == nil || biao.Note != "" {
		t.Fatalf("别名的原主人不动：%+v", biao)
	}
	// 人物表里没有的王五新建、已确认、排在末尾
	if last := people[len(people)-1]; last.Name != "王五" || last.Note != "看门的老头。" || !last.Confirmed {
		t.Fatalf("新建的人物应排在末尾：%+v", people)
	}
	// 没在传记里的老周保持原样
	if zhou := entityByName(people, "老周"); zhou == nil || zhou.Confirmed || zhou.Note != "" {
		t.Fatalf("传记里没有的人物不动：%+v", zhou)
	}

	// 用户清空林骁的小传后再列：已导入过，不再重导
	empty := ""
	linID := idOf(lin.ID)
	if _, err = s.UpdateScriptEntity(ctx, 7, 1, "character", linID, &service.UpdateDramaScriptEntityReq{Note: &empty}); err != nil {
		t.Fatal(err)
	}
	again, _ := s.ListScriptEntities(ctx, 7, 1, "character")
	if got := entityByName(again, "林骁"); got.Note != "" || len(again) != len(people) {
		t.Fatalf("只导入一次：%+v", again)
	}
	// 地点表不触发导入
	if places, err := s.ListScriptEntities(ctx, 7, 1, "location"); err != nil || len(places) != 2 {
		t.Fatalf("地点表：%+v %v", places, err)
	}
}

func TestDramaScript_BiosKeepExistingNoteAndMatchAlias(t *testing.T) {
	ctx := context.Background()
	r, s := scriptFixture(t)
	r.project.CharactersMD = "- **林川／小林**：传记里的说法。\n"
	// 手动人物「林骁」别名「林川」、已写了小传：按别名匹配上，小传不覆盖，新别名照样并进来
	if _, err := s.CreateScriptEntity(ctx, 7, 1, "character", &service.CreateDramaScriptEntityReq{Name: "阿骁", Aliases: []string{"阿林"}, Note: "用户写的小传"}); err != nil {
		t.Fatal(err)
	}
	r.project.ScriptBiosImported = false
	r.project.CharactersMD = "- **阿林／小骁**：传记里的说法。\n- **阿骁**：重复条目，不该新建。\n"
	people, err := s.ListScriptEntities(ctx, 7, 1, "character")
	if err != nil {
		t.Fatal(err)
	}
	a := entityByName(people, "阿骁")
	if a == nil || a.Note != "用户写的小传" || strings.Join(a.Aliases, ",") != "阿林,小骁" {
		t.Fatalf("按别名匹配、不覆盖已有小传、合并新别名：%+v", a)
	}
	if entityByName(people, "阿林") != nil {
		t.Fatalf("按别名匹配上的不应新建：%+v", people)
	}
}

func TestDramaScript_AnalyzeResetsBiosImported(t *testing.T) {
	r := newDramaMemory()
	seedDramaDraft(r, "第1章 开始\n正文。")
	e := &dramaTextStreamer{outputs: []string{`{"source_kind":"script","summary":"梗概","characters_md":"- **林阳**：外卖员","outline_md":"后文为抽样推断"}`}}
	s, _ := dramaTestService(r, e, nil)
	v, err := s.Create(context.Background(), 7, &model.CreateDramaReq{SourceToken: "draft", SourceKind: "novel", Ratio: "9:16", StyleKey: "custom", StyleCustom: "写实"})
	if err != nil {
		t.Fatal(err)
	}
	r.project.ScriptBiosImported = true
	if err = s.HandleDrama(context.Background(), 7, uint64(v.ID), r.jobs[0].ID); err != nil {
		t.Fatal(err)
	}
	if r.project.CharactersMD != "- **林阳**：外卖员" || r.project.ScriptBiosImported {
		t.Fatalf("研读写入新传记后应置回未导入：%q imported=%v", r.project.CharactersMD, r.project.ScriptBiosImported)
	}
}

func TestDramaScript_LocationNote(t *testing.T) {
	ctx := context.Background()
	_, s := scriptFixture(t)
	created, err := s.CreateScriptEntity(ctx, 7, 1, "location", &service.CreateDramaScriptEntityReq{Name: "天台", Note: "顶楼，风很大"})
	if err != nil || created.Note != "顶楼，风很大" {
		t.Fatalf("新建地点带描述：%+v %v", created, err)
	}
	note := "顶楼，晾着床单"
	updated, err := s.UpdateScriptEntity(ctx, 7, 1, "location", idOf(created.ID), &service.UpdateDramaScriptEntityReq{Note: &note})
	if err != nil || updated.Note != note {
		t.Fatalf("更新地点描述：%+v %v", updated, err)
	}
	places, _ := s.ListScriptEntities(ctx, 7, 1, "location")
	if got := entityByName(places, "天台"); got == nil || got.Note != note {
		t.Fatalf("列表返回地点描述：%+v", places)
	}
}

// 写分集剧本时，提示词里的 characters_md 由人物表拼出：只列已确认的人物，小传为空也列名字。
func TestDramaScriptsPromptUsesCharacterTable(t *testing.T) {
	r := newDramaMemory()
	r.project.CharactersMD = "- **林骁／林川**：码头搬运工。\n- **苏晚**：青梅竹马。\n"
	dramaAddEpisode(r, 1, "")
	e := &dramaTextStreamer{outputs: []string{"第1集\n\n1-1 夜/外 · 码头\n林骁：走。"}}
	s, _ := dramaTestService(r, e, nil)
	ctx := context.Background()
	// 先把苏晚的小传改掉、再加一个没有小传的已确认人物
	people, err := s.ListScriptEntities(ctx, 7, 1, "character")
	if err != nil {
		t.Fatal(err)
	}
	note := "表里改过的小传"
	if _, err = s.UpdateScriptEntity(ctx, 7, 1, "character", idOf(entityByName(people, "苏晚").ID), &service.UpdateDramaScriptEntityReq{Note: &note}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateScriptEntity(ctx, 7, 1, "character", &service.CreateDramaScriptEntityReq{Name: "老周"}); err != nil {
		t.Fatal(err)
	}
	j, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "scripts"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	got := promptCharacters(t, e.prompts[0])
	want := "- **林骁／林川**：码头搬运工。\n- **苏晚**：表里改过的小传\n- **老周**"
	if got != want {
		t.Fatalf("characters_md 应来自人物表\n得到 %q\n想要 %q", got, want)
	}
}

// 人物表里没有已确认人物时，退回研读的人物传记；没导入过的项目写剧本前先导入。
func TestDramaScriptsPromptImportsBiosBeforeWriting(t *testing.T) {
	r := newDramaMemory()
	r.project.CharactersMD = "当前文本未发现明确人物"
	dramaAddEpisode(r, 1, "")
	e := &dramaTextStreamer{outputs: []string{"第1集\n\n1-1 夜/外 · 码头\n△ 风。", "第1集\n\n1-1 夜/外 · 码头\n△ 风。"}}
	s, _ := dramaTestService(r, e, nil)
	ctx := context.Background()
	j, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "scripts"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if got := promptCharacters(t, e.prompts[0]); got != "当前文本未发现明确人物" {
		t.Fatalf("人物表为空时退回传记：%q", got)
	}
	if !r.project.ScriptBiosImported {
		t.Fatal("写剧本前应先导入传记")
	}

	// 没导入过的传记：写剧本前导入，提示词直接用人物表
	r.project.CharactersMD, r.project.ScriptBiosImported = "- **林阳**：外卖员。\n", false
	j, err = s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "scripts"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if got := promptCharacters(t, e.prompts[len(e.prompts)-1]); got != "- **林阳**：外卖员。" {
		t.Fatalf("写剧本前应先导入传记：%q", got)
	}
}

// promptCharacters 从提示词开头的 JSON 数据块里取出 characters_md。
func promptCharacters(t *testing.T, prompt string) string {
	t.Helper()
	start := strings.Index(prompt, "{")
	dec := json.NewDecoder(strings.NewReader(prompt[start:]))
	var data map[string]any
	if err := dec.Decode(&data); err != nil {
		t.Fatalf("提示词里没有 JSON 数据块：%v\n%s", err, prompt)
	}
	v, _ := data["characters_md"].(string)
	return v
}

// promptVar 从提示词开头的 JSON 数据块里取出某个字符串变量。
func promptVar(t *testing.T, prompt, key string) string {
	t.Helper()
	start := strings.Index(prompt, "{")
	var data map[string]any
	if err := json.NewDecoder(strings.NewReader(prompt[start:])).Decode(&data); err != nil {
		t.Fatalf("提示词里没有 JSON 数据块：%v\n%s", err, prompt)
	}
	v, _ := data[key].(string)
	return v
}

// 拆解（以及随后的资产图提示词）读人物表和地点描述，不再读研读生成的原始传记：
// 用户在卡片上改的小传、写的地点描述才会影响角色、场景资产的设定。
func TestDramaBreakdownPromptUsesCharacterAndLocationTables(t *testing.T) {
	r := newDramaMemory()
	r.project.Ratio = "9:16"
	r.project.CharactersMD = "- **林骁**：研读时写的原始传记。\n"
	dramaAddEpisode(r, 1, "第1集正文")
	m := &dramaFakeModel{}
	e := &dramaTextStreamer{respond: m.respond}
	c := &dramaPipelineCanvas{mem: r}
	s, _ := dramaTestService(r, e, c)
	ctx := context.Background()
	people, err := s.ListScriptEntities(ctx, 7, 1, "character")
	if err != nil {
		t.Fatal(err)
	}
	note := "表里改过的小传：左手有疤"
	if _, err = s.UpdateScriptEntity(ctx, 7, 1, "character", idOf(entityByName(people, "林骁").ID), &service.UpdateDramaScriptEntityReq{Note: &note}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateScriptEntity(ctx, 7, 1, "location", &service.CreateDramaScriptEntityReq{Name: "老码头", Note: "夜里潮湿阴冷，铁皮棚漏雨"}); err != nil {
		t.Fatal(err)
	}
	// 没写描述的地点不进提示词
	if _, err = s.CreateScriptEntity(ctx, 7, 1, "location", &service.CreateDramaScriptEntityReq{Name: "天台"}); err != nil {
		t.Fatal(err)
	}
	j, err := s.CreateJob(ctx, 7, 1, &model.DramaJobReq{Step: "breakdown", Episodes: []int{1}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.HandleDrama(ctx, 7, 1, uint64(j.ID)); err != nil {
		t.Fatal(err)
	}
	if got := promptVar(t, e.prompts[0], "characters_md"); !strings.Contains(got, "表里改过的小传：左手有疤") || strings.Contains(got, "原始传记") {
		t.Fatalf("拆解的人物资料应来自人物表：%q", got)
	}
	if got := promptVar(t, e.prompts[0], "locations_md"); got != "- **老码头**：夜里潮湿阴冷，铁皮棚漏雨" {
		t.Fatalf("拆解应带上地点描述（没描述的不列）：%q", got)
	}
}
