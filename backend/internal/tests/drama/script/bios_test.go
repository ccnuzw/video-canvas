package script_test

import (
	"reflect"
	"testing"

	"video-canvas/internal/drama/script"
)

func TestParseBios(t *testing.T) {
	cases := []struct {
		name string
		md   string
		want []script.Bio
	}{
		{
			name: "主流写法：粗体名字段按全角或半角斜杠拆别名",
			md: "## 主要人物\n\n" +
				"- **迅哥儿／少年“我”**：十一二岁的周家少爷，好奇心重。\n" +
				"- **闰土/少年闰土**：海边农家少年，会捕鸟、刺猹。\n" +
				"- **阿长**：迅哥儿的保姆。\n",
			want: []script.Bio{
				{Name: "迅哥儿", Aliases: []string{"少年“我”"}, Text: "十一二岁的周家少爷，好奇心重。"},
				{Name: "闰土", Aliases: []string{"少年闰土"}, Text: "海边农家少年，会捕鸟、刺猹。"},
				{Name: "阿长", Text: "迅哥儿的保姆。"},
			},
		},
		{
			name: "冒号写在粗体里面、半角冒号、星号列表",
			md:   "* **林阳：** 外卖员\n- **苏晚**: 富家女\n",
			want: []script.Bio{
				{Name: "林阳", Text: "外卖员"},
				{Name: "苏晚", Text: "富家女"},
			},
		},
		{
			name: "不带粗体的短名字",
			md:   "- 林阳：外卖员，二十五岁。\n- 苏晚（晚晚）：富家女。\n- 这是一句很长的说明文字，并不是名字：不该识别\n",
			want: []script.Bio{
				{Name: "林阳", Text: "外卖员，二十五岁。"},
				{Name: "苏晚", Aliases: []string{"晚晚"}, Text: "富家女。"},
			},
		},
		{
			name: "缩进子项和续行拼进上一个人",
			md:   "- **林阳**：主角\n  - 身份：外卖员\n  - **性格**：嘴硬心软\n  他总是迟到。\n- **苏晚**：女主\n",
			want: []script.Bio{
				{Name: "林阳", Text: "主角\n身份：外卖员\n性格：嘴硬心软\n他总是迟到。"},
				{Name: "苏晚", Text: "女主"},
			},
		},
		{
			name: "标题写法：括号外号作别名，下面的字段和段落拼进小传",
			md: "# 人物小传\n\n## 林阳（外号：壕天帝）\n- 身份：外卖员\n- 动机：还清债务\n\n他白天送外卖，晚上直播。\n\n" +
				"## 苏晚\n- 身份：富家女\n",
			want: []script.Bio{
				{Name: "林阳", Aliases: []string{"壕天帝"}, Text: "身份：外卖员\n动机：还清债务\n他白天送外卖，晚上直播。"},
				{Name: "苏晚", Text: "身份：富家女"},
			},
		},
		{
			name: "单独一行粗体作人名，带序号的标题",
			md:   "**林阳**\n- 身份：外卖员\n- 外号：壕天帝、阿阳\n\n### 2. 苏晚\n富家女。\n",
			want: []script.Bio{
				{Name: "林阳", Aliases: []string{"壕天帝", "阿阳"}, Text: "身份：外卖员\n外号：壕天帝、阿阳"},
				{Name: "苏晚", Text: "富家女。"},
			},
		},
		{
			name: "分组标题不是人，分组下的列表才是人",
			md: "## 主角阵营\n- **林阳**：外卖员\n## 反派\n- **赵强**：债主\n" +
				"## 人物关系\n林阳欠赵强钱。\n## 家族势力\n- 赵家：本地豪门\n",
			want: []script.Bio{
				{Name: "林阳", Text: "外卖员"},
				{Name: "赵强", Text: "债主"},
				{Name: "赵家", Text: "本地豪门"},
			},
		},
		{
			name: "括号里是描述而不是别名时写进小传",
			md:   "## 林阳（男主，25岁）\n外卖员。\n",
			want: []script.Bio{
				{Name: "林阳", Text: "男主，25岁\n外卖员。"},
			},
		},
		{
			name: "没有人物或空文本",
			md:   "当前文本未发现明确人物。\n",
			want: nil,
		},
		{
			name: "空串",
			md:   "",
			want: nil,
		},
		{
			name: "列表里的字段名不当人名",
			md:   "- 身份：外卖员\n- **林阳**：主角\n- 年龄：25\n",
			want: []script.Bio{
				{Name: "林阳", Text: "主角\n年龄：25"},
			},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := script.ParseBios(c.md)
			if len(got) == 0 && len(c.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("ParseBios\n得到 %#v\n想要 %#v", got, c.want)
			}
		})
	}
}

func TestRenderBios(t *testing.T) {
	got := script.RenderBios([]script.Bio{
		{Name: "迅哥儿", Aliases: []string{"少年“我”", "我"}, Text: "周家少爷。\n身份：少爷\n年龄：12"},
		{Name: "闰土"},
	})
	// 小传多行压成一行：上一行以句读结尾直接相连，否则用分号隔开
	want := "- **迅哥儿／少年“我”／我**：周家少爷。身份：少爷；年龄：12\n- **闰土**"
	if got != want {
		t.Fatalf("RenderBios\n得到 %q\n想要 %q", got, want)
	}
	if script.RenderBios(nil) != "" {
		t.Fatal("空人物表应渲染成空串")
	}
	// 渲染结果能被 ParseBios 读回
	back := script.ParseBios(got)
	if len(back) != 2 || back[0].Name != "迅哥儿" || len(back[0].Aliases) != 2 || back[1].Name != "闰土" {
		t.Fatalf("渲染结果应能读回：%#v", back)
	}
}
