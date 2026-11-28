package drama_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"video-canvas/internal/drama"
)

func TestSourceFiveMillionBoundary(t *testing.T) {
	for _, n := range []int{5_000_000, 5_000_001} {
		_, err := drama.ParseSource("书.txt", []byte(strings.Repeat("字", n)))
		if (err != nil) != (n > 5_000_000) {
			t.Fatalf("%d: %v", n, err)
		}
	}
}

func TestPreflightKindsAndUnits(t *testing.T) {
	for _, tc := range []struct{ text, kind, unit string }{
		{"第1集 开始\n甲：走。\n第2集 结束\n乙：好。", "script", "episode"},
		{"1-1 日 内\n甲：走。\n1-2 夜 外\n乙：好。\n1-3 日 内\n甲：回来。", "script", "scene"},
		{"第1章 开始\n他来了。\n第2章 结束\n她走了。", "novel", "chapter"},
		{"一段没有明显结构的文字。", "unknown", "chunk"},
	} {
		p := drama.Preflight(tc.text, "")
		if p.KindGuess != tc.kind || p.UnitKind != tc.unit {
			t.Fatalf("%+v", p)
		}
		for i, u := range p.Units {
			if u.No != i+1 || u.Text == "" {
				t.Fatalf("%+v", u)
			}
		}
	}
	p := drama.Preflight("求推荐票\n第1章 长章\n"+strings.Repeat("段落。\n", 4000)+"第2章 尾声\n结束。", "novel")
	if strings.Contains(p.Text, "求推荐票") || len(p.Units) < 3 {
		t.Fatalf("去噪或拆长章失败: %d", len(p.Units))
	}
	for _, u := range p.Units {
		if u.Chars > 12000 {
			t.Fatalf("长章未拆: %d", u.Chars)
		}
	}
}

func TestSampleAndBatchKeepCompleteSource(t *testing.T) {
	p := drama.Preflight(strings.Repeat("原文段落。\n", 15000), "novel")
	sample := drama.Sample(p.Units, 40000)
	if utf8.RuneCountInString(sample) > 40000 || !strings.Contains(sample, "[1]") {
		t.Fatalf("抽样预算错误: %d", utf8.RuneCountInString(sample))
	}
	cursor := 0
	for cursor < len(p.Units) {
		batch, err := drama.NextBatch(p.Units, cursor, len(p.Units), 30000)
		if err != nil || len(batch) == 0 || len(batch) > 12 {
			t.Fatalf("batch=%d err=%v", len(batch), err)
		}
		for i, u := range batch {
			if u.No != cursor+i+1 || !strings.Contains(drama.UnitSource(batch), u.Text) {
				t.Fatal("批次丢失正文或不连续")
			}
		}
		cursor = batch[len(batch)-1].No
	}
}

func TestScriptEpisodesKeepScenes(t *testing.T) {
	marked := drama.Preflight("第1集 开始\n甲：走。\n第2集 结束\n乙：好。", "script")
	if eps := drama.ScriptEpisodes(marked.Units, 60); len(eps) != 2 || !strings.Contains(eps[1].ScriptMD, "乙：好。") {
		t.Fatalf("%+v", eps)
	}
	preface := drama.Preflight("序言不应成为额外的一集。\n第1集 开始\n甲：走。\n第2集 结束\n乙：好。", "script")
	if eps := drama.ScriptEpisodes(preface.Units, 60); len(eps) != 2 || strings.Contains(eps[0].ScriptMD, "序言") || eps[0].UnitFrom != 1 || eps[0].Title != "第1集 开始" {
		t.Fatalf("分集标记之前的介绍应留在原文范围：%+v", eps)
	}
	unmarked := drama.Preflight("1-1 日 内\n"+strings.Repeat("甲：走。\n", 180)+"1-2 夜 外\n乙：好。\n1-3 日 内\n甲：回来。", "script")
	eps := drama.ScriptEpisodes(unmarked.Units, 60)
	if len(eps) < 1 || strings.Count(eps[0].ScriptMD, "甲：走。") != 180 {
		t.Fatal("场次被拆开或台词丢失")
	}
}

func TestScriptEpisodesKeepProjectIntroInSource(t *testing.T) {
	const intro = "《开局一座幼儿园》\n对标剧：同类型\n类型：轻奇幻\n核心梗：萌娃穿梭\n一句话故事：林牧继承了幼儿园……第一集"
	const scene = "小兕子寝宫 日 内\n人物：小兕子\n△ 小兕子趴着窗沿。"
	for _, tc := range []struct {
		name, opening string
	}{
		{name: "直接开场"},
		{name: "有序幕戏", opening: "△ 风筝落在院子里。\n小兕子：风来了。\n"},
		{name: "序幕有场次标题", opening: "院子 日 外\n△ 风筝落在院子里。\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := drama.Preflight(intro+"\n\n"+tc.opening+scene+"\n\n第二集\n小兕子：回来了。\n第三集\n小兕子：走吧。", "script")
			episodes := drama.ScriptEpisodes(source.Units, 60)
			if len(episodes) != 2 || episodes[0].UnitFrom != 1 {
				t.Fatalf("首集应保留序言对应的原文范围：%+v", episodes)
			}
			if got := strings.SplitN(episodes[0].ScriptMD, "\n\n", 2)[0]; got != tc.opening+scene {
				t.Fatalf("首集正文起始 = %q", got)
			}
			if !strings.Contains(source.Units[0].Text, intro) {
				t.Fatal("原著对照应保留完整介绍")
			}
		})
	}
}

func TestScriptEpisodesFindBodyWithoutProjectFieldNames(t *testing.T) {
	const intro = "# 主创手记\n\n项目定位：写给异乡人的故事\n这段介绍跨了两行。"
	for _, body := range []string{
		"第一场：港口 · 夜 · 外\n阿遥：船要开了。",
		"**INT. KITCHEN - DAY**\n阿遥：出发吧。",
		"【空镜】雾从河面升起。\n阿遥：回家吧。",
		"△ 阿遥合上门。\n阿遥：明天见。",
	} {
		units := []drama.Unit{
			{No: 1, Kind: "prologue", Text: intro, Chars: 1000},
			{No: 2, Kind: "scene", Text: body, Chars: 50},
		}
		episodes := drama.ScriptEpisodes(units, 60)
		if len(episodes) != 1 || episodes[0].UnitFrom != 1 || episodes[0].UnitTo != 2 || episodes[0].ScriptMD != body {
			t.Errorf("正文 %q 导入错误：%+v", body, episodes)
		}
		if units[0].Text != intro {
			t.Fatal("导入应保留原文")
		}
	}
}

func TestScriptEpisodesKeepUnmarkedDialogueFragment(t *testing.T) {
	const text = "阿遥：船要开了。\n小舟：等等我。"
	episodes := drama.ScriptEpisodes(drama.Preflight(text, "script").Units, 60)
	if len(episodes) != 1 || episodes[0].ScriptMD != text {
		t.Fatalf("没有场次标记的对白片段应完整保留：%+v", episodes)
	}
}

func TestPromptBodyCannotReplaceProtocol(t *testing.T) {
	prompt, err := drama.PromptWithBody("breakdown_format", map[string]any{"draft_md": "原文"}, "只输出 Markdown")
	if err != nil || !strings.Contains(prompt, "只输出 Markdown") || !strings.Contains(prompt, "## 输出 JSON Schema") || !strings.Contains(prompt, "## 本步职责") {
		t.Fatalf("%s %v", prompt, err)
	}
	// 创作段的协议是输出约定，用户正文替换不了它
	draft, err := drama.PromptWithBody("scripts", map[string]any{"source": "原文"}, "只输出 Markdown")
	if err != nil || !strings.Contains(draft, "只输出 Markdown") || !strings.Contains(draft, "## 输出约定") {
		t.Fatalf("%s %v", prompt, err)
	}
	block := drama.SkillBlock("连续性", strings.Repeat("字", 20000))
	if !strings.Contains(block, "【写作方法：连续性】") || strings.Count(block, "字") != 16000 {
		t.Fatal("技能注入未按字截断")
	}
}

// 预计耗时只拿到单元字数和标题（不读正文），估出的剩余批次数要和真实分批一致。
func TestCountBatchesMatchesNextBatchWithoutText(t *testing.T) {
	p := drama.Preflight(strings.Repeat("第一段原文。\n", 9000)+strings.Repeat("短章。\n", 40), "novel")
	for _, cursor := range []int{0, 3, len(p.Units) / 2, len(p.Units) - 1, len(p.Units)} {
		want := 0
		for c := cursor; c < len(p.Units); want++ {
			batch, err := drama.NextBatch(p.Units, c, len(p.Units), 30000)
			if err != nil {
				t.Fatal(err)
			}
			c = batch[len(batch)-1].No
		}
		sizes := make([]drama.Unit, len(p.Units))
		for i, u := range p.Units {
			sizes[i] = drama.Unit{No: u.No, Title: u.Title, Chars: u.Chars}
		}
		if got := drama.CountBatches(sizes, cursor, len(p.Units), 30000); got != want {
			t.Fatalf("cursor=%d 批次数 got=%d want=%d", cursor, got, want)
		}
	}
}
