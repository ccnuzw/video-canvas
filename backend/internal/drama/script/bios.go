package script

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Bio 是从人物传记 Markdown 里认出的一个人物：正式名、别名和小传正文。
type Bio struct {
	Name    string
	Aliases []string
	Text    string
}

var (
	reBioHeading = regexp.MustCompile(`^#{1,6}\s+(.+?)\s*#*$`)
	reBioBullet  = regexp.MustCompile(`^(?:[-*+]|\d+[.、．)）])\s+(.*)$`)
	// reBioBold 是「**名字**：内容」，冒号可以写在粗体里面，也可以没有内容
	reBioBold     = regexp.MustCompile(`^\*\*([^*]+?)\s*[:：]?\s*\*\*\s*(.*)$`)
	reBioOrdinal  = regexp.MustCompile(`^(?:\d+|[一二三四五六七八九十]+)\s*[.、．)）]\s*`)
	reBioParen    = regexp.MustCompile(`[（(]([^）)]*)[）)]`)
	reBioNameSep  = regexp.MustCompile(`\s*[／/]\s*`)
	reBioAliasSep = regexp.MustCompile(`\s*[、，,／/;；]\s*`)
	reBioAliasTag = regexp.MustCompile(`^(?:外号|又名|别名|别称|绰号|昵称|小名|本名|原名|化名|艺名|曾用名|也叫|人称|又称)\s*[:：]?\s*`)
	// reBioGroup 命中的标题是分组（「主要人物」「反派阵营」「人物关系」），不是某个人
	reBioGroup = regexp.MustCompile(`人物|角色|主角|配角|反派|群像|其他|阵营|家族|势力|关系`)
	// reBioPunct 是名字里不会出现的句读；不带粗体的「名字：内容」靠它和长度排除普通句子
	reBioPunct = regexp.MustCompile(`[，。、！？；,.!?;：:…—]`)
	reBioRole  = regexp.MustCompile(`^(?:男主|女主|男配|女配|主角|配角|反派|男一|女一|男二|女二|主人公)`)
)

// bioFieldLabels 是小传里常见的字段名，「- 身份：xx」这类行是字段，不是人名。
var bioFieldLabels = map[string]bool{
	"身份": true, "年龄": true, "性别": true, "性格": true, "外貌": true, "外形": true, "形象": true, "动机": true,
	"目标": true, "关系": true, "人物关系": true, "背景": true, "经历": true, "特点": true, "特征": true, "职业": true,
	"外号": true, "别名": true, "别称": true, "绰号": true, "又名": true, "昵称": true, "小名": true, "简介": true,
	"小传": true, "弧光": true, "人物弧光": true, "口头禅": true, "能力": true, "设定": true, "声线": true, "音色": true,
	"定位": true, "作用": true, "立场": true, "阶段": true, "成长": true, "结局": true, "秘密": true, "弱点": true,
}

// bioAliasLabels 是值为别名的字段名，「- 外号：壕天帝」里的值同时并进别名。
var bioAliasLabels = map[string]bool{"外号": true, "别名": true, "别称": true, "绰号": true, "又名": true, "昵称": true, "小名": true}

const (
	bioPlainNameMax = 20 // 不带粗体的名字段最长字数
	bioAliasMax     = 12 // 括号里没有「外号：」前缀时，当别名的最长字数
)

// bioParser 逐行读传记；cur 是正在收集小传的人物，block 表示它来自标题或单独一行粗体（下面的列表项都是它的字段）。
type bioParser struct {
	out   []Bio
	cur   *Bio
	lines []string
	block bool
}

// ParseBios 从研读生成的人物传记 Markdown 里认出每个人物。认两类写法：
//   - 列表写法：「- **正式名／别名**：小传」，也容忍不带粗体的「- 短名字：小传」，缩进子项和续行拼进上一个人；
//   - 标题写法：「## 正式名（外号：别名）」或单独一行「**正式名**」，下面的字段和段落都拼进这个人的小传。
//
// 标题里带「人物、角色、反派、关系」等词的是分组标题，不是人。小传多行用换行连接，字段保留成「标签：内容」。
func ParseBios(md string) []Bio {
	p := &bioParser{}
	for _, raw := range strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n") {
		p.line(raw)
	}
	p.flush()
	return p.out
}

func (p *bioParser) line(raw string) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return
	}
	// 1. 标题和单独一行的粗体：分组标题结束当前人物，否则开始一个「标题写法」的人物。
	if m := reBioHeading.FindStringSubmatch(text); m != nil {
		p.heading(stripBold(m[1]))
		return
	}
	if m := reBioBold.FindStringSubmatch(text); m != nil && m[2] == "" && !strings.ContainsAny(text, ":：") {
		p.heading(m[1])
		return
	}
	// 2. 列表项和「**名字**：内容」行：可能是新人物、字段或子项。
	indented := bioIndent(raw) >= 2
	body, bullet := text, false
	if m := reBioBullet.FindStringSubmatch(text); m != nil {
		body, bullet = m[1], true
	}
	if bullet || reBioBold.MatchString(body) {
		p.entry(body, indented)
		return
	}
	// 3. 普通段落拼进当前人物。
	p.add(stripBold(text))
}

// heading 处理标题或单独一行粗体。
func (p *bioParser) heading(title string) {
	p.flush()
	title = strings.TrimSpace(reBioOrdinal.ReplaceAllString(strings.TrimSpace(title), ""))
	if title == "" || reBioGroup.MatchString(reBioParen.ReplaceAllString(title, "")) {
		return
	}
	if b, extra, ok := parseBioName(title, 64); ok {
		p.start(b, true)
		p.add(extra)
	}
}

// entry 处理一个列表项（已去掉列表符号）。
func (p *bioParser) entry(body string, indented bool) {
	label, rest, bold, ok := splitBioEntry(body)
	if indented || (p.block && p.cur != nil) {
		p.field(label, rest, ok, body)
		return
	}
	if ok && (bioFieldLabels[label] || reservedLabels[label]) {
		p.field(label, rest, ok, body)
		return
	}
	if ok && reBioGroup.MatchString(reBioParen.ReplaceAllString(label, "")) && rest == "" {
		p.flush()
		return
	}
	limit := bioPlainNameMax
	if bold {
		limit = 64
	}
	if ok {
		if b, extra, good := parseBioName(label, limit); good && (bold || !reBioPunct.MatchString(reBioParen.ReplaceAllString(label, ""))) {
			p.flush()
			p.start(b, false)
			p.add(extra)
			p.add(rest)
			return
		}
	}
	// 顶层的普通句子不属于任何人，结束当前人物，免得把分组说明拼进上一个人。
	p.flush()
}

// field 把一行字段或子项拼进当前人物；值为别名的字段同时并进别名。
func (p *bioParser) field(label, rest string, ok bool, body string) {
	if p.cur == nil {
		return
	}
	if !ok {
		p.add(stripBold(body))
		return
	}
	if bioAliasLabels[label] {
		for _, a := range reBioAliasSep.Split(rest, -1) {
			p.alias(a)
		}
	}
	p.add(joinLabel(label, rest))
}

func (p *bioParser) start(b Bio, block bool) {
	p.out = append(p.out, b)
	p.cur, p.block, p.lines = &p.out[len(p.out)-1], block, nil
}

func (p *bioParser) add(s string) {
	if s = strings.TrimSpace(s); s != "" && p.cur != nil {
		p.lines = append(p.lines, s)
	}
}

func (p *bioParser) alias(a string) {
	a = strings.TrimSpace(a)
	if a == "" || a == p.cur.Name || utf8.RuneCountInString(a) > bioAliasMax || reBioPunct.MatchString(a) {
		return
	}
	for _, old := range p.cur.Aliases {
		if old == a {
			return
		}
	}
	p.cur.Aliases = append(p.cur.Aliases, a)
}

func (p *bioParser) flush() {
	if p.cur != nil {
		p.cur.Text = strings.Join(p.lines, "\n")
	}
	p.cur, p.block, p.lines = nil, false, nil
}

// splitBioEntry 把「**标签**：内容」或「标签：内容」拆开；bold 表示标签带粗体，ok 为 false 表示没有标签。
func splitBioEntry(body string) (label, rest string, bold, ok bool) {
	if m := reBioBold.FindStringSubmatch(body); m != nil {
		rest = strings.TrimSpace(m[2])
		// 粗体后面要么没有内容，要么紧跟冒号或破折号，否则只是句中强调
		if rest != "" && !strings.ContainsRune(m[0][:len(m[0])-len(m[2])], ':') && !strings.ContainsRune(m[0][:len(m[0])-len(m[2])], '：') {
			trimmed := strings.TrimLeft(rest, ":：—–- ")
			if trimmed == rest {
				return "", "", false, false
			}
			rest = trimmed
		}
		rest = strings.TrimSpace(strings.TrimLeft(rest, ":："))
		return strings.TrimSpace(m[1]), rest, true, true
	}
	i := colonOutsideParen(body)
	if i < 0 {
		return "", "", false, false
	}
	_, size := utf8.DecodeRuneInString(body[i:])
	return strings.TrimSpace(body[:i]), strings.TrimSpace(body[i+size:]), false, true
}

// colonOutsideParen 返回第一个不在括号里的冒号的字节位置，没有返回 -1。
func colonOutsideParen(s string) int {
	depth := 0
	for i, r := range s {
		switch r {
		case '（', '(':
			depth++
		case '）', ')':
			depth = max(0, depth-1)
		case ':', '：':
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// parseBioName 把名字段拆成正式名和别名：按斜杠拆，括号里带「外号：」前缀或像名字的内容当别名，
// 其余括号内容（如「男主，25岁」）作为 extra 返回，写进小传。
func parseBioName(seg string, limit int) (Bio, string, bool) {
	var extras []string
	var parenAliases []string
	plain := reBioParen.ReplaceAllStringFunc(seg, func(m string) string {
		inner := strings.TrimSpace(reBioParen.FindStringSubmatch(m)[1])
		switch {
		case inner == "":
		case reBioAliasTag.MatchString(inner):
			parenAliases = append(parenAliases, reBioAliasSep.Split(reBioAliasTag.ReplaceAllString(inner, ""), -1)...)
		case utf8.RuneCountInString(inner) <= bioAliasMax && !reBioPunct.MatchString(inner) && !reBioRole.MatchString(inner) && !strings.ContainsAny(inner, "0123456789岁"):
			parenAliases = append(parenAliases, inner)
		default:
			extras = append(extras, inner)
		}
		return ""
	})
	parts := reBioNameSep.Split(strings.TrimSpace(plain), -1)
	name := strings.TrimSpace(parts[0])
	if name == "" || utf8.RuneCountInString(name) > limit {
		return Bio{}, "", false
	}
	b := Bio{Name: name}
	seen := map[string]bool{name: true}
	for _, a := range append(parts[1:], parenAliases...) {
		if a = strings.TrimSpace(a); a != "" && !seen[a] {
			seen[a] = true
			b.Aliases = append(b.Aliases, a)
		}
	}
	return b, strings.Join(extras, "\n"), true
}

func joinLabel(label, rest string) string {
	if rest == "" {
		return label
	}
	return label + "：" + rest
}

func stripBold(s string) string { return strings.TrimSpace(strings.ReplaceAll(s, "**", "")) }

// bioIndent 返回行首缩进宽度，制表符按 4 个空格算。
func bioIndent(raw string) int {
	n := 0
	for _, r := range raw {
		switch r {
		case ' ':
			n++
		case '\t':
			n += 4
		default:
			return n
		}
	}
	return n
}

// RenderBios 把人物表渲染成传记 Markdown，每人一行「- **正式名／别名**：小传」，没有小传的只写名字；
// 小传里的多行压成一行，ParseBios 能原样读回。
func RenderBios(bios []Bio) string {
	lines := make([]string, 0, len(bios))
	for _, b := range bios {
		names := strings.Join(append([]string{b.Name}, b.Aliases...), "／")
		line := "- **" + names + "**"
		if text := oneLine(b.Text); text != "" {
			line += "：" + text
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// oneLine 把多行文字压成一行：上一行以句读结尾直接相连，否则用分号隔开。
func oneLine(s string) string {
	var out strings.Builder
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l == "" {
			continue
		}
		if out.Len() > 0 {
			prev, _ := utf8.DecodeLastRuneInString(out.String())
			if !strings.ContainsRune("。！？；…!?;", prev) {
				out.WriteString("；")
			}
		}
		out.WriteString(l)
	}
	return out.String()
}
