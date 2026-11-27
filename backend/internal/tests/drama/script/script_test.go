package script_test

import (
	"reflect"
	"strings"
	"testing"

	"video-canvas/internal/drama/script"
)

// fakeRoster 同时实现 Resolver 与 Names；resolve 未命中时按 auto 决定是否登记。
type fakeRoster struct {
	chars, locs map[string]uint64
	next        uint64
	auto        bool
	registered  []string
}

func newRoster() *fakeRoster {
	return &fakeRoster{
		chars: map[string]uint64{"林骁": 1, "林川": 1, "苏晚": 2, "老周": 3},
		locs:  map[string]uint64{"城西老码头": 1, "林家老宅客厅": 2, "老宅客厅": 2},
		next:  100,
		auto:  true,
	}
}

func (r *fakeRoster) lookup(m map[string]uint64, name string) uint64 {
	if id, ok := m[name]; ok {
		return id
	}
	if !r.auto {
		return 0
	}
	r.next++
	m[name] = r.next
	r.registered = append(r.registered, name)
	return r.next
}
func (r *fakeRoster) Character(name string) uint64 { return r.lookup(r.chars, name) }
func (r *fakeRoster) Location(name string) uint64  { return r.lookup(r.locs, name) }
func (r *fakeRoster) CharacterName(id uint64) string {
	return map[uint64]string{1: "林骁", 2: "苏晚", 3: "老周", 101: "护士"}[id]
}
func (r *fakeRoster) LocationName(id uint64) string {
	return map[uint64]string{1: "城西老码头", 2: "林家老宅客厅", 102: "天台"}[id]
}

const sample = `第3集

3-1 夜/外 · 城西老码头
人物：林骁、苏晚
道具：信封
△ 雨砸在铁皮棚上，林骁攥着一只湿透的信封。
苏晚：你到底瞒了我什么？
林骁（压低声音）：这事别让她知道。
△ 远处传来汽笛声。

3-2 日/内 · 林家老宅客厅
人物：林骁、老周
老周：少爷，老爷子醒了。
林骁（OS）：他醒得太巧了。
【字幕：三天后】
【空镜】走廊尽头的灯。
【闪回】
△ 十年前，同一条走廊。
【闪回结束】
切至：`

func types(els []script.Element) []script.ElementType {
	out := make([]script.ElementType, len(els))
	for i, e := range els {
		out[i] = e.Type
	}
	return out
}

func TestParseBuiltinFormat(t *testing.T) {
	res := script.Parse(sample, newRoster())
	if len(res.Scenes) != 2 {
		t.Fatalf("场次数=%d", len(res.Scenes))
	}
	s1 := res.Scenes[0]
	if s1.IntExt != script.Exterior || s1.TimeLabel != "夜" || s1.LocationID != 1 {
		t.Fatalf("场次标题解析错误：%+v", s1)
	}
	if !reflect.DeepEqual(s1.Props, []string{"信封"}) {
		t.Fatalf("道具=%v", s1.Props)
	}
	want := []script.ElementType{script.Action, script.Character, script.Dialogue, script.Character, script.Parenthetical, script.Dialogue, script.Action}
	if !reflect.DeepEqual(types(s1.Elements), want) {
		t.Fatalf("元素类型=%v", types(s1.Elements))
	}
	if s1.Elements[1].CharacterID != 2 || s1.Elements[2].Text != "你到底瞒了我什么？" {
		t.Fatalf("对白解析错误：%+v", s1.Elements[1:3])
	}
	if s1.Elements[4].Text != "压低声音" {
		t.Fatalf("括号=%q", s1.Elements[4].Text)
	}
	if len(res.Warnings) != 0 {
		t.Fatalf("不应有警告：%v", res.Warnings)
	}
}

func TestParseExtensionsAndMarkers(t *testing.T) {
	s2 := script.Parse(sample, newRoster()).Scenes[1]
	want := []script.ElementType{script.Character, script.Dialogue, script.Character, script.Dialogue, script.Subtitle, script.Shot, script.FlashbackStart, script.Action, script.FlashbackEnd, script.Transition}
	if !reflect.DeepEqual(types(s2.Elements), want) {
		t.Fatalf("元素类型=%v", types(s2.Elements))
	}
	if s2.Elements[2].Extension != script.ExtOS {
		t.Fatalf("OS 标记丢失：%+v", s2.Elements[2])
	}
	if s2.Elements[4].Text != "三天后" || s2.Elements[5].Text != "走廊尽头的灯。" {
		t.Fatalf("字幕或空镜文本错误：%+v", s2.Elements[4:6])
	}
	if s2.IntExt != script.Interior || s2.TimeLabel != "日" || s2.LocationID != 2 {
		t.Fatalf("场次标题：%+v", s2)
	}
}

func TestParseExtraCharactersExcludeSpeakers(t *testing.T) {
	res := script.Parse("1-1 日/内 · 林家老宅客厅\n人物：林骁、老周、苏晚\n老周：来了。", newRoster())
	got := res.Scenes[0].ExtraCharacterIDs
	if !reflect.DeepEqual(got, []uint64{1, 2}) {
		t.Fatalf("不说话的出场人物=%v，应为林骁、苏晚", got)
	}
}

func TestParseVariants(t *testing.T) {
	for name, text := range map[string]string{
		"markdown 标题": "## 3-1 夜/外 · 城西老码头\n△ 雨。",
		"整行加粗":        "**3-1 夜/外 · 城西老码头**\n△ 雨。",
		"INT/EXT":     "EXT. 城西老码头 - NIGHT\n△ 雨。",
	} {
		res := script.Parse(text, newRoster())
		if len(res.Scenes) != 1 || res.Scenes[0].LocationID != 1 || res.Scenes[0].IntExt != script.Exterior {
			t.Fatalf("%s：解析错误 %+v", name, res.Scenes)
		}
	}
	half := script.Parse("1-1 夜/外 · 城西老码头\n林骁(压低声音):走。", newRoster()).Scenes[0].Elements
	if len(half) != 3 || half[1].Text != "压低声音" || half[2].Text != "走。" {
		t.Fatalf("半角冒号和括号：%+v", half)
	}
}

func TestParseUnrecognizedLinesBecomeActions(t *testing.T) {
	res := script.Parse("夜里的码头下着雨。\n他没有回答。", newRoster())
	if len(res.Scenes) != 1 {
		t.Fatalf("场次标题之前的内容应进入一个场次，得到 %d", len(res.Scenes))
	}
	if got := types(res.Scenes[0].Elements); !reflect.DeepEqual(got, []script.ElementType{script.Action, script.Action}) {
		t.Fatalf("元素=%v", got)
	}
	if res.Scenes[0].LocationID != 0 {
		t.Fatal("没有标题的场次不应有地点")
	}
	if len(res.Warnings) == 0 {
		t.Fatal("应有未识别警告")
	}
	if res.Scenes[0].Elements[0].Text != "夜里的码头下着雨。" {
		t.Fatal("原文不能丢")
	}
}

func TestParseRegistersNewNames(t *testing.T) {
	r := newRoster()
	script.Parse("1-1 夜/外 · 天台\n护士：林先生！", r)
	if !reflect.DeepEqual(r.registered, []string{"天台", "护士"}) {
		t.Fatalf("登记=%v", r.registered)
	}
}

func TestRenderRoundTrip(t *testing.T) {
	r := newRoster()
	first := script.Render(script.Parse(sample, r).Scenes, 3, r)
	second := script.Render(script.Parse(first, r).Scenes, 3, r)
	if first != second {
		t.Fatalf("render(parse(render(x))) 应等于 render(x)\n--- first\n%s\n--- second\n%s", first, second)
	}
	for _, want := range []string{"第3集", "3-1 夜/外 · 城西老码头", "人物：苏晚、林骁", "道具：信封", "△ 雨砸在铁皮棚上", "林骁（压低声音）：这事别让她知道。", "林骁（OS）：他醒得太巧了。", "【字幕：三天后】", "【空镜】走廊尽头的灯。", "【闪回】", "【闪回结束】", "切至："} {
		if !strings.Contains(first, want) {
			t.Fatalf("渲染结果缺少 %q\n%s", want, first)
		}
	}
}

func TestRenderSkipsNotesAndMergesCast(t *testing.T) {
	r := newRoster()
	scenes := script.Parse("1-1 夜/外 · 城西老码头\n人物：林骁、苏晚\n苏晚：走吧。", r).Scenes
	scenes[0].Elements = append(scenes[0].Elements, script.Element{Type: script.Note, Text: "只给自己看"})
	out := script.Render(scenes, 1, r)
	if strings.Contains(out, "只给自己看") {
		t.Fatal("备注不应渲染进 script_md")
	}
	if !strings.Contains(out, "人物：苏晚、林骁") {
		t.Fatalf("人物行应是说话人在前、不说话的在后：\n%s", out)
	}
}

func TestValidate(t *testing.T) {
	el := func(ty script.ElementType, cid uint64) script.Element {
		return script.Element{Type: ty, CharacterID: cid, Text: "x"}
	}
	cases := []struct {
		name string
		els  []script.Element
		want string // 空串表示合法
		idx  int
	}{
		{"合法", []script.Element{el(script.Character, 1), el(script.Parenthetical, 0), el(script.Dialogue, 0), el(script.Action, 0)}, "", 0},
		{"对白没有说话人", []script.Element{el(script.Action, 0), el(script.Dialogue, 0)}, "台词前面没有角色行", 1},
		{"角色后没有台词", []script.Element{el(script.Character, 1), el(script.Action, 0)}, "角色行后面没有台词", 0},
		{"角色行没选人物", []script.Element{el(script.Character, 0), el(script.Dialogue, 0)}, "角色行没有选人物", 0},
		{"闪回不成对", []script.Element{el(script.FlashbackStart, 0), el(script.Action, 0)}, "闪回没有结束", 0},
		{"闪回嵌套", []script.Element{el(script.FlashbackStart, 0), el(script.FlashbackStart, 0), el(script.FlashbackEnd, 0)}, "闪回不能嵌套", 1},
		{"闪回结束前没有闪回", []script.Element{el(script.FlashbackEnd, 0)}, "闪回结束前没有闪回", 0},
	}
	for _, c := range cases {
		err := script.Validate([]script.Scene{{Elements: c.els}})
		if c.want == "" {
			if err != nil {
				t.Fatalf("%s：不应报错 %v", c.name, err)
			}
			continue
		}
		if err == nil || err.Message != c.want || err.Scene != 0 || err.Element != c.idx {
			t.Fatalf("%s：得到 %+v，期望 %q 在第 %d 个元素", c.name, err, c.want, c.idx)
		}
	}
}

// ---- 合并 ----

func old() []script.Scene {
	return []script.Scene{
		{ID: 10, IntExt: script.Exterior, TimeLabel: "夜", LocationID: 1, Title: "码头对峙", Summary: "逼问", Emotions: []string{"紧张"}, Elements: []script.Element{
			{ID: 101, Type: script.Action, Text: "雨。"},
			{ID: 102, Type: script.Character, CharacterID: 2},
			{ID: 103, Type: script.Dialogue, Text: "你瞒了我什么？"},
			{ID: 104, Type: script.Note, Text: "更冷一点"},
			{ID: 105, Type: script.Character, CharacterID: 1},
			{ID: 106, Type: script.Dialogue, Text: "别让她知道。"},
		}},
		{ID: 20, IntExt: script.Interior, TimeLabel: "日", LocationID: 2, Title: "老爷子苏醒", Elements: []script.Element{
			{ID: 201, Type: script.Character, CharacterID: 3},
			{ID: 202, Type: script.Dialogue, Text: "老爷子醒了。"},
		}},
	}
}

func clone(s []script.Scene) []script.Scene {
	out := make([]script.Scene, len(s))
	for i, sc := range s {
		sc.Elements = append([]script.Element(nil), sc.Elements...)
		out[i] = sc
	}
	return out
}

func TestMergeKeepsIDsAndSceneInfoWhenOneLineChanges(t *testing.T) {
	neu := clone(old())
	for i := range neu {
		neu[i].ID, neu[i].Title, neu[i].Summary, neu[i].Emotions = 0, "", "", nil
		for j := range neu[i].Elements {
			neu[i].Elements[j].ID = 0
		}
	}
	// 去掉备注（新文本里没有备注），改一句对白
	neu[0].Elements = append(neu[0].Elements[:3], neu[0].Elements[4:]...)
	neu[0].Elements[4].Text = "别让任何人知道。"

	merged, stats, warns := script.Merge(old(), neu)
	if stats != (script.Stats{Kept: 7, Modified: 1}) {
		t.Fatalf("统计=%+v", stats)
	}
	if len(warns) != 0 {
		t.Fatalf("警告=%v", warns)
	}
	s := merged[0]
	if s.ID != 10 || s.Title != "码头对峙" || s.Summary != "逼问" || !reflect.DeepEqual(s.Emotions, []string{"紧张"}) {
		t.Fatalf("场次信息应保留：%+v", s)
	}
	ids := []uint64{}
	for _, e := range s.Elements {
		ids = append(ids, e.ID)
	}
	if !reflect.DeepEqual(ids, []uint64{101, 102, 103, 104, 105, 106}) {
		t.Fatalf("元素 ID=%v，改一句对白只应换文本，备注挂回原位", ids)
	}
	if s.Elements[3].Type != script.Note || s.Elements[5].Text != "别让任何人知道。" {
		t.Fatalf("备注位置或修改文本错误：%+v", s.Elements)
	}
}

func TestMergeSwappedScenesKeepSceneInfo(t *testing.T) {
	neu := clone(old())
	neu[0], neu[1] = neu[1], neu[0]
	for i := range neu {
		neu[i].ID, neu[i].Title = 0, ""
		for j := range neu[i].Elements {
			neu[i].Elements[j].ID = 0
		}
	}
	merged, _, _ := script.Merge(old(), neu)
	if merged[0].ID != 20 || merged[0].Title != "老爷子苏醒" || merged[1].ID != 10 || merged[1].Title != "码头对峙" {
		t.Fatalf("调换顺序后场次信息应跟着场次走：%+v / %+v", merged[0], merged[1])
	}
}

func TestMergeDeletedSceneMovesNotesToFirstScene(t *testing.T) {
	neu := clone(old())[1:] // 码头那场被删，备注挂在它上面
	neu[0].ID = 0
	for j := range neu[0].Elements {
		neu[0].Elements[j].ID = 0
	}
	merged, stats, warns := script.Merge(old(), neu)
	if stats.Deleted != 5 {
		t.Fatalf("删除条数=%+v（码头那场 5 个非备注元素）", stats)
	}
	if len(warns) != 1 || !strings.Contains(warns[0].Message, "1 条备注") {
		t.Fatalf("警告=%v", warns)
	}
	if merged[0].Elements[0].Type != script.Note {
		t.Fatalf("备注应移到第一场开头：%+v", merged[0].Elements)
	}
}

func TestMergeNoteNotInsertedBetweenCharacterAndDialogue(t *testing.T) {
	prev := []script.Scene{{ID: 1, Elements: []script.Element{
		{ID: 1, Type: script.Action, Text: "a"},
		{ID: 2, Type: script.Note, Text: "n"},
		{ID: 3, Type: script.Character, CharacterID: 1},
		{ID: 4, Type: script.Dialogue, Text: "d"},
	}}}
	// 备注原先紧挨着「动作 a」，新文本在动作后紧跟一个角色行
	neu := []script.Scene{{Elements: []script.Element{
		{Type: script.Action, Text: "a"},
		{Type: script.Character, CharacterID: 1},
		{Type: script.Dialogue, Text: "d"},
	}}}
	merged, _, _ := script.Merge(prev, neu)
	if err := script.Validate(merged); err != nil {
		t.Fatalf("合并结果必须合法：%v %+v", err, merged[0].Elements)
	}
}

func TestMergeAddsAndDeletes(t *testing.T) {
	neu := []script.Scene{{IntExt: script.Exterior, TimeLabel: "夜", LocationID: 1, Elements: []script.Element{
		{Type: script.Action, Text: "雨。"},
		{Type: script.Action, Text: "全新的一行。"},
	}}}
	merged, stats, _ := script.Merge(old()[:1], neu)
	// 保留 1 个动作和 1 条备注；新增 1 行；删除 4 行（老场次除备注外有 5 个元素，只剩第一个动作）
	if stats != (script.Stats{Kept: 2, Added: 1, Deleted: 4}) {
		t.Fatalf("统计=%+v", stats)
	}
	got := []uint64{}
	for _, e := range merged[0].Elements {
		got = append(got, e.ID)
	}
	if !reflect.DeepEqual(got, []uint64{101, 104, 0}) {
		t.Fatalf("沿用原 ID、备注挂回动作后面、新增为 0：%v", got)
	}
}

func TestRepairDropsUnpairedFlashbackMarkers(t *testing.T) {
	mk := func(ts ...script.ElementType) []script.Scene {
		var els []script.Element
		for _, ty := range ts {
			els = append(els, script.Element{Type: ty, Text: "x"})
		}
		return []script.Scene{{Elements: els}}
	}
	cases := map[string][]script.ElementType{
		"只有开始":   {script.FlashbackStart, script.Action},
		"只有结束":   {script.Action, script.FlashbackEnd},
		"嵌套":     {script.FlashbackStart, script.FlashbackStart, script.Action, script.FlashbackEnd},
		"成对的保留":  {script.FlashbackStart, script.Action, script.FlashbackEnd},
		"本来就合法的": {script.Action},
	}
	want := map[string]int{"只有开始": 1, "只有结束": 1, "嵌套": 3, "成对的保留": 3, "本来就合法的": 1}
	for name, ts := range cases {
		got := script.Repair(mk(ts...))
		if err := script.Validate(got); err != nil {
			t.Fatalf("%s：修复后必须合法：%v", name, err)
		}
		if len(got[0].Elements) != want[name] {
			t.Fatalf("%s：元素数=%d，期望 %d", name, len(got[0].Elements), want[name])
		}
	}
}

// 一份带文头的剧本：剧名、时代背景、主要人物介绍都写在第一个场次标题之前，它们不是台词。
const withPreamble = `剧名：故乡
时代背景：清末民初，江南绍兴及海边沙地
核心视觉基调：冷灰暗调与高饱和绚丽色彩形成对比。
主要人物：
少年迅哥儿（12岁，瘦弱）：封建礼教下的少年，眼神苍白。
母亲（40岁）：温柔而疲惫。

1-1 日/外 · 城西老码头
苏晚：你来了。
时间：黄昏
林骁（压低声音）：嗯。`

func TestParsePreambleLinesAreNotSpeakers(t *testing.T) {
	r := newRoster()
	r.chars = map[string]uint64{"苏晚": 2, "林骁": 1}
	res := script.Parse(withPreamble, r)
	for _, name := range r.registered {
		t.Fatalf("文头里的字段名和人物介绍不应登记成人物：%q", name)
	}
	if len(res.Scenes) != 2 {
		t.Fatalf("文头应单独成一个没有地点的场次，正文一个场次：%d", len(res.Scenes))
	}
	head := res.Scenes[0]
	if head.LocationID != 0 {
		t.Fatal("文头场次不应有地点")
	}
	for _, e := range head.Elements {
		if e.Type != script.Action {
			t.Fatalf("文头里的行都应作为动作保存：%+v", e)
		}
	}
	if head.Elements[0].Text != "剧名：故乡" {
		t.Fatalf("原文不能丢：%q", head.Elements[0].Text)
	}
	// 正文里的台词照常解析；「时间：黄昏」是字段名，不是说话人
	body := res.Scenes[1]
	if got := types(body.Elements); !reflect.DeepEqual(got, []script.ElementType{script.Character, script.Dialogue, script.Action, script.Character, script.Parenthetical, script.Dialogue}) {
		t.Fatalf("正文元素=%v", got)
	}
}

func TestParseFragmentWithoutHeadingKeepsDialogue(t *testing.T) {
	// 粘贴几行对白，没有场次标题：这是片段，不是文头，对白要认出来
	r := newRoster()
	res := script.Parse("苏晚：走吧。\n林骁：好。", r)
	if len(res.Scenes) != 1 || !reflect.DeepEqual(types(res.Scenes[0].Elements), []script.ElementType{script.Character, script.Dialogue, script.Character, script.Dialogue}) {
		t.Fatalf("片段里的对白应被认出：%+v", res.Scenes)
	}
}

func TestParseReservedLabelsAreNeverSpeakers(t *testing.T) {
	r := newRoster()
	res := script.Parse("1-1 日/内 · 林家老宅客厅\n场景：老宅\n地点：客厅\n备注：别删\n老周：来了。", r)
	if len(r.registered) != 0 {
		t.Fatalf("字段名不应登记成人物：%v", r.registered)
	}
	if got := types(res.Scenes[0].Elements); !reflect.DeepEqual(got, []script.ElementType{script.Action, script.Action, script.Action, script.Character, script.Dialogue}) {
		t.Fatalf("元素=%v", got)
	}
}

// numberedScript 是另一种常见写法：「第一场：地点 · 时间 · 内外」做场次标题，
// 说话人单独一行、台词在下一行，【画面】做段落标签。
const numberedScript = `剧名：《少年闰土》
主要人物：
少年迅哥儿（11-12岁）： 封建大户人家的少爷。
成年“我”（40余岁，仅画外音）： 沧桑、温厚。

第一场：海边沙地 · 夜 · 外（意象镜头）

【画面】
黑屏渐亮。
动作特写： 那黑影（猹）极其伶俐。

成年“我”（画外音）：
这少年便是闰土。

第二场：周家大院 · 祠堂与内院 · 日 · 内/外

【镜头语言】
母亲走过来。

闰土父亲：
（憨厚地笑，推了推闰土）这是少爷。
快叫少爷。

【画面】蒙太奇快切： 两个少年蹲在灶台边烤火。`

func TestParseNumberedSceneHeadings(t *testing.T) {
	r := newRoster()
	r.chars = map[string]uint64{}
	r.locs = map[string]uint64{}
	res := script.Parse(numberedScript, r)
	if len(res.Scenes) != 3 {
		t.Fatalf("应为文头 + 两场，得到 %d 场", len(res.Scenes))
	}
	head := res.Scenes[0]
	for _, e := range head.Elements {
		if e.Type != script.Action {
			t.Fatalf("文头里的人物介绍应作为动作保存：%+v", e)
		}
	}
	s1, s2 := res.Scenes[1], res.Scenes[2]
	if s1.TimeLabel != "夜" || s1.IntExt != script.Exterior || s1.Title != "意象镜头" || s1.LocationID == 0 {
		t.Fatalf("第一场标题解析错误：%+v", s1)
	}
	if s2.TimeLabel != "日" || s2.IntExt != script.InteriorExterior || s2.LocationID == 0 {
		t.Fatalf("第二场标题解析错误：%+v", s2)
	}
	if r.locs["海边沙地"] == 0 || r.locs["周家大院·祠堂与内院"] == 0 {
		t.Fatalf("地点登记错误：%v", r.locs)
	}
	for _, name := range r.registered {
		switch name {
		case "海边沙地", "周家大院·祠堂与内院", "成年“我”", "闰土父亲":
		default:
			t.Fatalf("不应登记 %q", name)
		}
	}
}

func TestParseSpeakerOnOwnLine(t *testing.T) {
	r := newRoster()
	r.chars = map[string]uint64{}
	r.locs = map[string]uint64{}
	res := script.Parse(numberedScript, r)
	s1 := res.Scenes[1].Elements
	if got := types(s1); !reflect.DeepEqual(got, []script.ElementType{script.Action, script.Action, script.Character, script.Dialogue}) {
		t.Fatalf("第一场元素=%v %+v", got, s1)
	}
	if s1[1].Text != "动作特写： 那黑影（猹）极其伶俐。" || s1[3].Text != "这少年便是闰土。" {
		t.Fatalf("第一场文本错误：%+v", s1)
	}
	if s1[2].Extension != script.ExtVO {
		t.Fatalf("画外音应标为 VO：%+v", s1[2])
	}
	s2 := res.Scenes[2].Elements
	want := []script.ElementType{script.Action, script.Character, script.Parenthetical, script.Dialogue, script.Action}
	if got := types(s2); !reflect.DeepEqual(got, want) {
		t.Fatalf("第二场元素=%v %+v", got, s2)
	}
	if s2[2].Text != "憨厚地笑，推了推闰土" || s2[3].Text != "这是少爷。快叫少爷。" {
		t.Fatalf("括号和多行台词错误：%+v", s2)
	}
	if s2[4].Text != "蒙太奇快切： 两个少年蹲在灶台边烤火。" {
		t.Fatalf("【画面】后的文字应作为动作：%q", s2[4].Text)
	}
}

// spacedScript 是另一种常见写法：场次标题用空格分隔「编号 地点 时间 内外」，
// 第一场还省掉了编号；文头是对标剧、核心梗这类自定义字段。
const spacedScript = `《开局一座幼儿园》
对标剧：同类型非同IP
核心梗：萌娃穿梭+震惊古代
一句话故事：继承了爷爷幼儿园的林牧……

小兕子寝宫 日 内
人物：小兕子、翠儿。
【一组蒙太奇】
画面一：
△ 小兕子，坐在椅子上，一手托腮。
【蒙太奇结束】
翠儿：小公主？快来喝药了。

4-1 大唐 立政殿 日/黄昏 内
林牧OS：唉爷爷啊爷爷。
5-2 立政殿偏殿长廊 夜 内/外
小兕子：阿姐！`

func TestParseSpaceSeparatedSceneHeadings(t *testing.T) {
	r := newRoster()
	r.chars = map[string]uint64{"小兕子": 1, "翠儿": 2, "林牧": 3}
	r.locs = map[string]uint64{}
	res := script.Parse(spacedScript, r)
	if len(res.Scenes) != 4 {
		t.Fatalf("应为文头 + 三场，得到 %d 场", len(res.Scenes))
	}
	s1, s2, s3 := res.Scenes[1], res.Scenes[2], res.Scenes[3]
	if s1.TimeLabel != "日" || s1.IntExt != script.Interior || s1.LocationID != r.locs["小兕子寝宫"] || s1.LocationID == 0 {
		t.Fatalf("没有编号的标题解析错误：%+v %v", s1, r.locs)
	}
	if s2.TimeLabel != "日/黄昏" || s2.IntExt != script.Interior || s2.LocationID != r.locs["大唐·立政殿"] || s2.LocationID == 0 {
		t.Fatalf("带编号的标题解析错误：%+v %v", s2, r.locs)
	}
	if s3.TimeLabel != "夜" || s3.IntExt != script.InteriorExterior || s3.LocationID != r.locs["立政殿偏殿长廊"] || s3.LocationID == 0 {
		t.Fatalf("内/外 标题解析错误：%+v %v", s3, r.locs)
	}
}

func TestParseSpacedScriptRegistersOnlyRealCharacters(t *testing.T) {
	r := newRoster()
	r.chars = map[string]uint64{"小兕子": 1, "翠儿": 2, "林牧": 3}
	r.locs = map[string]uint64{}
	script.Parse(spacedScript, r)
	if len(r.chars) != 3 {
		t.Fatalf("文头字段、段落标签、画外音标记都不应登记成人物：%v", r.registered)
	}
}

func TestParseCustomPreambleLabelsInFragmentAreNotSpeakers(t *testing.T) {
	// 没有场次标题时没有文头保护，常见的文头字段名本身也不能当说话人
	r := newRoster()
	script.Parse("对标剧：同类型\n核心梗：萌娃穿梭\n一句话故事：林牧……\n苏晚：走吧。", r)
	if len(r.registered) != 0 {
		t.Fatalf("文头字段名不应登记成人物：%v", r.registered)
	}
}

func TestParseSpeakerWithoutDialogueIsNotRegistered(t *testing.T) {
	r := newRoster()
	res := script.Parse("1-1 日/内 · 林家老宅客厅\n画面一：\n△ 小兕子坐在椅子上。\n老周：来了。", r)
	if len(r.registered) != 0 {
		t.Fatalf("单独一行的「名字：」后面没有台词时不应登记人物：%v", r.registered)
	}
	els := res.Scenes[0].Elements
	if els[0].Type != script.Action || els[0].Text != "画面一：" {
		t.Fatalf("没等到台词的说话人行应原样保存为动作：%+v", els[0])
	}
}

func TestParseSpeakerWithOSSuffix(t *testing.T) {
	r := newRoster()
	res := script.Parse("1-1 日/内 · 林家老宅客厅\n林骁OS：他醒得太巧了。\n老周vo：少爷。", r)
	if len(r.registered) != 0 {
		t.Fatalf("名字后缀的 OS/VO 是画外音标记，不是名字的一部分：%v", r.registered)
	}
	els := res.Scenes[0].Elements
	if els[0].CharacterID != 1 || els[0].Extension != script.ExtOS || els[2].CharacterID != 3 || els[2].Extension != script.ExtVO {
		t.Fatalf("画外音标记错误：%+v", els)
	}
}

func TestParseCastListTrimsPunctuation(t *testing.T) {
	r := newRoster()
	res := script.Parse("1-1 日/内 · 林家老宅客厅\n人物：苏晚、老周。\n老周：来了。", r)
	if len(r.registered) != 0 {
		t.Fatalf("人物行末尾的标点不是名字的一部分：%v", r.registered)
	}
	if got := res.Scenes[0].ExtraCharacterIDs; !reflect.DeepEqual(got, []uint64{2}) {
		t.Fatalf("人物行里没说话的人物=%v", got)
	}
}
