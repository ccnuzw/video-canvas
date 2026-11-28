package script

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var (
	reEpisode  = regexp.MustCompile(`^第\s*[\d一二三四五六七八九十百]+\s*集`)
	reHeading  = regexp.MustCompile(`^\d+\s*[-–]\s*\d+\s*(?:(.+?)\s*)?[·•]\s*(.+)$`)
	reHeadBare = regexp.MustCompile(`^\d+\s*[-–]\s*\d+$`)
	// reHeadNo 是空格分隔标题「2-1 地点 日 外」的编号前缀
	reHeadNo   = regexp.MustCompile(`^\d+\s*[-–]\s*\d+\s+(.+)$`)
	reHeadEN   = regexp.MustCompile(`(?i)^(INT|EXT)\.\s*(.+?)\s*[-–]\s*(DAY|NIGHT)$`)
	reCast     = regexp.MustCompile(`^人物[:：]\s*(.+)$`)
	reProps    = regexp.MustCompile(`^道具[:：]\s*(.+)$`)
	reSubtitle = regexp.MustCompile(`^【字幕[:：](.+)】$`)
	reShot     = regexp.MustCompile(`^【空镜】(.*)$`)
	reNote     = regexp.MustCompile(`^【备注[:：](.+)】$`)
	reAction   = regexp.MustCompile(`^△\s*(.+)$`)
	reTransit  = regexp.MustCompile(`^(?:切至|切回|淡入|淡出|叠化|黑场)`)
	reDialogue = regexp.MustCompile(`^([\p{Han}A-Za-z·“”"「」]{1,10})\s*(?:[（(]([^）)]*)[）)])?\s*[:：]\s*(.+)$`)
	// reSpeaker 是单独一行的说话人「人物（语气）：」，台词在下一行
	reSpeaker = regexp.MustCompile(`^([\p{Han}A-Za-z·“”"「」]{1,10})\s*(?:[（(]([^）)]*)[）)])?\s*[:：]$`)
	// reHeadNum 是「第一场：地点 · 时间 · 内外（备注）」「场景3：…」这类编号场次标题
	reHeadNum   = regexp.MustCompile(`^(?:第\s*[\d一二三四五六七八九十百零]+\s*场|场景\s*[\d一二三四五六七八九十百零]+)(?:\s*[:：、.．]\s*|\s+|$)(.*)$`)
	reHeadNote  = regexp.MustCompile(`\s*[（(]([^）)]*)[）)]\s*$`)
	reHeadSplit = regexp.MustCompile(`[·•｜|\s]+`)
	reLeadParen = regexp.MustCompile(`^[（(]([^）)]*)[）)]\s*(.*)$`)
	reScreen    = regexp.MustCompile(`^【(?:画面|镜头|镜头语言|镜头转换)】\s*(.*)$`)
	reFlashIn   = regexp.MustCompile(`^【闪回[^】]+】`)
	reFlashOut  = regexp.MustCompile(`^【(?:回到现实|闪回结束)[^】]*】`)
	// reShotLabel 是「动作特写：」「全景：」这类镜头说明，不是说话人
	reShotLabel = regexp.MustCompile(`(?:特写|镜头|画面|全景|中景|近景|远景|空镜|蒙太奇|转场)$`)
	reHeadWrap  = regexp.MustCompile(`^#{1,6}\s+`)
	reBoldWrap  = regexp.MustCompile(`^\*\*(.+)\*\*$`)
	reListSplit = regexp.MustCompile(`[、，,\s]+`)
	reTimeSplit = regexp.MustCompile(`[/／\s]+`)
	reTagSplit  = regexp.MustCompile(`[，,]`)
	rePropSplit = regexp.MustCompile(`[、，,]+`)
)

// reservedLabels 是剧本里常见的「字段名：内容」的字段名，它们不是说话人。
var reservedLabels = map[string]bool{
	"剧名": true, "片名": true, "标题": true, "题材": true, "类型": true, "风格": true, "画风": true,
	"时代背景": true, "背景": true, "核心视觉基调": true, "视觉基调": true, "主题": true, "简介": true, "梗概": true,
	"大纲": true, "概述": true, "总述": true, "主要人物": true, "人物": true, "人物设定": true, "人物小传": true,
	"角色": true, "场景": true, "地点": true, "时间": true, "道具": true, "画面": true,
	"备注": true, "说明": true, "注": true, "提示": true, "要求": true,
	"对标剧": true, "对标": true, "核心梗": true, "一句话故事": true, "一句话梗概": true, "故事梗概": true,
	"卖点": true, "看点": true, "亮点": true, "集数": true, "时长": true,
}

// parser 逐行读文本，把每行归到当前场次。
type parser struct {
	r     Resolver
	res   ParseResult
	cur   *Scene
	extra []string // 当前场「人物：」行里的名字，场次结束时再去掉说话人
	// preamble 为 true 表示还在文头：文本里有场次标题，而现在还没读到第一个。
	// 文头通常是剧名、时代背景、人物介绍这类「字段名：内容」，不是台词，不能当说话人。
	preamble bool
	// pending 是单独一行的说话人，等下一行文字作为台词；speaking 表示上一句台词还可以续行
	pending  *pendingSpeaker
	speaking bool
}

// pendingSpeaker 是读到「人物：」单独一行后挂起的说话人，raw 用于没等到台词时原样存为动作。
type pendingSpeaker struct {
	raw   string
	name  string
	ext   string
	paren string
}

// Parse 把内置格式（也容忍常见变体）的文本解析成场次和元素。
// 认不出的行当作动作保存并给出警告，原文不丢；第一个场次标题之前的内容放进一个无地点的场次。
func Parse(text string, r Resolver) ParseResult {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	p := &parser{r: r, preamble: hasHeading(lines)}
	for i, raw := range lines {
		p.line(i+1, normalize(raw))
	}
	p.flushPending()
	p.closeScene()
	return p.res
}

// hasHeading 判断文本里有没有场次标题。没有标题的文本是粘贴来的片段（几行对白），不存在文头。
func hasHeading(lines []string) bool {
	for _, raw := range lines {
		if _, ok := parseHeading(normalize(raw)); ok {
			return true
		}
	}
	return false
}

// normalize 去掉空白、Markdown 标题井号和整行加粗。
func normalize(raw string) string {
	s := strings.TrimSpace(raw)
	s = reHeadWrap.ReplaceAllString(s, "")
	if m := reBoldWrap.FindStringSubmatch(s); m != nil {
		s = m[1]
	}
	return strings.TrimSpace(s)
}

// BodyStart 返回导入时首个明确的剧本结构所在的字节位置，找不到时返回 len(text)。
// 「名称：内容」既可能是对白也可能是文头字段，不能单独用来确定边界。
func BodyStart(text string) int {
	offset := 0
	for rest := text; rest != ""; {
		raw, next, _ := strings.Cut(rest, "\n")
		line := normalize(raw)
		if _, ok := parseHeading(line); ok || reEpisode.MatchString(line) || isOpeningCue(line) {
			return offset
		}
		offset += len(rest) - len(next)
		rest = next
	}
	return len(text)
}

// isOpeningCue 识别场次标题前也可以独立出现的剧本元素。
func isOpeningCue(line string) bool {
	return reAction.MatchString(line) || reScreen.MatchString(line) || reShot.MatchString(line) ||
		reSubtitle.MatchString(line) || reTransit.MatchString(line) ||
		line == "【闪回】" || reFlashIn.MatchString(line)
}

func (p *parser) line(no int, s string) {
	if s == "" {
		p.speaking = false // 空行结束续行，但挂起的说话人继续等台词
		return
	}
	if reEpisode.MatchString(s) {
		return
	}
	if h, ok := parseHeading(s); ok {
		p.flushPending()
		p.preamble = false
		p.openScene(h)
		return
	}
	p.ensureScene(no)
	if !p.preamble && p.continueSpeech(s) {
		return
	}
	p.flushPending()
	p.speaking = false
	// 文头里只认方括号标注和 △ 动作，其余原样作为动作保存，不识别台词；
	// 文头已经在 ensureScene 里提示过一次，这里不再逐行警告
	if p.meta(s) || p.marker(s) || (!p.preamble && (p.speech(no, s) || p.speaker(s))) {
		return
	}
	p.add(Element{Type: Action, Text: s})
	if !p.preamble {
		p.warn(no, "未识别的行已作为动作保存")
	}
}

// heading 是场次标题里读出的信息。
type heading struct {
	intExt, tm, loc, title string
}

// parseHeading 识别场次标题，返回内外景、时间、地点名和标题括号里的短标题。
func parseHeading(s string) (heading, bool) {
	var h heading
	if m := reHeadEN.FindStringSubmatch(s); m != nil {
		h.intExt = Interior
		if strings.EqualFold(m[1], "EXT") {
			h.intExt = Exterior
		}
		h.tm = "日"
		if strings.EqualFold(m[3], "NIGHT") {
			h.tm = "夜"
		}
		h.loc = strings.TrimSpace(m[2])
		return h, true
	}
	if m := reHeading.FindStringSubmatch(s); m != nil {
		for _, tok := range reTimeSplit.Split(strings.TrimSpace(m[1]), -1) {
			if !h.setIntExt(tok) && tok != "" {
				h.tm = tok
			}
		}
		h.loc = strings.TrimSpace(m[2])
		return h, true
	}
	if m := reHeadNum.FindStringSubmatch(s); m != nil {
		return parseNumberedHeading(m[1]), true
	}
	if reHeadBare.MatchString(s) {
		return h, true
	}
	return parseSpacedHeading(s)
}

// parseSpacedHeading 识别空格分隔的「2-1 大唐 立政殿 日/黄昏 内」和省掉编号的「小兕子寝宫 日 内」：
// 从行尾往前取时间、内外景，剩下的段落拼成地点。没有编号时时间和内外景都要有，免得把普通文字当成标题。
func parseSpacedHeading(s string) (heading, bool) {
	var h heading
	body, numbered := s, false
	if m := reHeadNo.FindStringSubmatch(s); m != nil {
		body, numbered = m[1], true
	}
	if strings.ContainsAny(body, "：:，,。！!？?△【】“”\"（）()") {
		return h, false
	}
	toks := strings.Fields(body)
	n := len(toks)
	for n > 1 && (h.tm == "" || h.intExt == "") && h.setSpacedSegment(toks[n-1]) {
		n--
	}
	if n == len(toks) || (!numbered && (h.tm == "" || h.intExt == "")) {
		return heading{}, false
	}
	h.loc = strings.Join(toks[:n], "·")
	return h, true
}

// setSpacedSegment 记下一段时间或内外景；「日/黄昏」这类全是时间词的段落整段作为时间。已经取过的项不重复取。
func (h *heading) setSpacedSegment(seg string) bool {
	all := true
	for _, tok := range reTimeSplit.Split(seg, -1) {
		all = all && timeWords[tok]
	}
	if all {
		if h.tm != "" {
			return false
		}
		h.tm = seg
		return true
	}
	if h.intExt != "" {
		return false
	}
	return h.setSegment(seg)
}

// parseNumberedHeading 拆「海边沙地 · 夜 · 外（意象镜头）」：能认出的时间、内外景取出，其余段落拼成地点，末尾括号作短标题。
func parseNumberedHeading(body string) heading {
	var h heading
	body = strings.TrimSpace(body)
	if m := reHeadNote.FindStringSubmatch(body); m != nil {
		h.title = strings.TrimSpace(m[1])
		body = strings.TrimSpace(body[:len(body)-len(m[0])])
	}
	var loc []string
	for _, seg := range reHeadSplit.Split(body, -1) {
		if seg == "" || h.setSegment(seg) {
			continue
		}
		loc = append(loc, seg)
	}
	h.loc = strings.Join(loc, "·")
	return h
}

// setSegment 把「夜」「内/外」「日/内」这类整段都是时间或内外景的段落记下；段落里有认不出的词时不动并返回 false。
func (h *heading) setSegment(seg string) bool {
	switch seg {
	case "内/外", "外/内", "内／外", "外／内":
		h.intExt = InteriorExterior
		return true
	}
	toks := reTimeSplit.Split(seg, -1)
	for _, tok := range toks {
		if !isIntExt(tok) && !timeWords[tok] {
			return false
		}
	}
	for _, tok := range toks {
		if !h.setIntExt(tok) {
			h.tm = tok
		}
	}
	return true
}

var timeWords = map[string]bool{
	"日": true, "夜": true, "晨": true, "晚": true, "白天": true, "夜晚": true, "清晨": true, "早晨": true, "早上": true,
	"上午": true, "中午": true, "午后": true, "下午": true, "傍晚": true, "黄昏": true, "深夜": true, "凌晨": true, "黎明": true,
}

func isIntExt(tok string) bool { return tok == "内" || tok == "外" || tok == "内外" }

func (h *heading) setIntExt(tok string) bool {
	switch tok {
	case "内":
		h.intExt = Interior
	case "外":
		h.intExt = Exterior
	case "内外":
		h.intExt = InteriorExterior
	default:
		return false
	}
	return true
}

func (p *parser) openScene(h heading) {
	p.closeScene()
	sc := Scene{IntExt: h.intExt, TimeLabel: h.tm, Title: h.title, Emotions: []string{}, Props: []string{}}
	if h.loc != "" {
		sc.LocationID = p.r.Location(h.loc)
	}
	p.cur = &sc
}

// ensureScene 在没有场次标题时补一个无地点的场次并提示。
func (p *parser) ensureScene(no int) {
	if p.cur != nil {
		return
	}
	p.openScene(heading{})
	p.warn(no, "场次标题之前的内容已放进一个没有地点的场次")
}

func (p *parser) closeScene() {
	if p.cur == nil {
		return
	}
	speakers := map[uint64]bool{}
	for _, e := range p.cur.Elements {
		if e.Type == Character {
			speakers[e.CharacterID] = true
		}
	}
	seen := map[uint64]bool{}
	for _, name := range p.extra {
		id := p.r.Character(name)
		if id == 0 || speakers[id] || seen[id] {
			continue
		}
		seen[id] = true
		p.cur.ExtraCharacterIDs = append(p.cur.ExtraCharacterIDs, id)
	}
	p.res.Scenes = append(p.res.Scenes, *p.cur)
	p.cur, p.extra = nil, nil
}

// meta 处理「人物：」「道具：」行。
func (p *parser) meta(s string) bool {
	if m := reCast.FindStringSubmatch(s); m != nil {
		p.extra = append(p.extra, splitList(m[1])...)
		return true
	}
	if m := reProps.FindStringSubmatch(s); m != nil {
		for _, name := range rePropSplit.Split(m[1], -1) {
			if name = strings.TrimSpace(name); name != "" {
				p.cur.Props = append(p.cur.Props, name)
			}
		}
		return true
	}
	return false
}

func splitList(s string) []string {
	var out []string
	for _, v := range reListSplit.Split(s, -1) {
		if v = strings.Trim(v, "。.．；;：:！!？?"); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// marker 处理方括号标注、△ 动作和转场。
// 「【闪回 / 幻想画面：…】」「【回到现实：…】」这类带说明的闪回标注拆成闪回标记加一行动作，说明不丢。
func (p *parser) marker(s string) bool {
	switch {
	case s == "【闪回】":
		p.add(Element{Type: FlashbackStart})
	case s == "【闪回结束】":
		p.add(Element{Type: FlashbackEnd})
	case reFlashOut.MatchString(s):
		p.add(Element{Type: FlashbackEnd})
		p.add(Element{Type: Action, Text: s})
	case reFlashIn.MatchString(s):
		p.add(Element{Type: FlashbackStart})
		p.add(Element{Type: Action, Text: s})
	case reScreen.MatchString(s):
		// 【画面】【镜头语言】只是段落标签，后面跟着文字时文字是动作
		if rest := strings.TrimSpace(reScreen.FindStringSubmatch(s)[1]); rest != "" {
			p.add(Element{Type: Action, Text: rest})
		}
	case reSubtitle.MatchString(s):
		p.add(Element{Type: Subtitle, Text: strings.TrimSpace(reSubtitle.FindStringSubmatch(s)[1])})
	case reShot.MatchString(s):
		p.add(Element{Type: Shot, Text: strings.TrimSpace(reShot.FindStringSubmatch(s)[1])})
	case reNote.MatchString(s):
		p.add(Element{Type: Note, Text: strings.TrimSpace(reNote.FindStringSubmatch(s)[1])})
	case reAction.MatchString(s):
		p.add(Element{Type: Action, Text: strings.TrimSpace(reAction.FindStringSubmatch(s)[1])})
	case reTransit.MatchString(s):
		p.add(Element{Type: Transition, Text: s})
	default:
		return false
	}
	return true
}

// speech 处理「人物（语气）：台词」，拆成角色行、括号行和对白行；人物解析不出来时放弃，交给动作兜底。
func (p *parser) speech(no int, s string) bool {
	m := reDialogue.FindStringSubmatch(s)
	if m == nil || notSpeaker(m[1]) {
		return false
	}
	name, suffix := splitNameExt(m[1])
	id := p.r.Character(name)
	if id == 0 {
		return false
	}
	ext, paren := splitTags(m[2])
	if ext == "" {
		ext = suffix
	}
	p.add(Element{Type: Character, CharacterID: id, Extension: ext})
	if paren != "" {
		p.add(Element{Type: Parenthetical, Text: paren})
	}
	p.add(Element{Type: Dialogue, Text: strings.TrimSpace(m[3])})
	return true
}

// notSpeaker 判断「名字：」里的名字其实是字段名或镜头说明。
func notSpeaker(name string) bool {
	return reservedLabels[name] || reShotLabel.MatchString(name)
}

// splitNameExt 把「林牧OS」「林牧VO」这类紧贴名字的画外音标记拆出来；后缀前面必须是非字母（如汉字），免得拆坏英文名。
func splitNameExt(name string) (string, string) {
	if len(name) <= 2 {
		return name, ""
	}
	rest, tail := name[:len(name)-2], name[len(name)-2:]
	for _, ext := range []string{ExtOS, ExtVO} {
		if !strings.EqualFold(tail, ext) {
			continue
		}
		if r, _ := utf8.DecodeLastRuneInString(rest); r >= utf8.RuneSelf || !unicode.IsLetter(r) {
			return rest, ext
		}
	}
	return name, ""
}

// speaker 处理单独一行的「人物（语气）：」，挂起等下一行台词；等到台词才登记人物，
// 免得「画面一：」这类后面跟着动作的段落标签变成人物。
func (p *parser) speaker(s string) bool {
	m := reSpeaker.FindStringSubmatch(s)
	if m == nil || notSpeaker(m[1]) {
		return false
	}
	name, suffix := splitNameExt(m[1])
	ext, paren := splitTags(m[2])
	if ext == "" {
		ext = suffix
	}
	p.pending = &pendingSpeaker{raw: s, name: name, ext: ext, paren: paren}
	return true
}

// continueSpeech 把普通文字行接到挂起的说话人或上一句台词后面；遇到标题、标注、新的说话人等结构行时返回 false。
func (p *parser) continueSpeech(s string) bool {
	if p.pending == nil && !p.speaking {
		return false
	}
	if isStructural(s) {
		return false
	}
	if ps := p.pending; ps != nil {
		id := p.r.Character(ps.name)
		if id == 0 {
			p.flushPending() // 人物登记不了，说话人行原样存成动作，这一行按普通行处理
			return false
		}
		p.pending = nil
		p.add(Element{Type: Character, CharacterID: id, Extension: ps.ext})
		if ps.paren != "" {
			p.add(Element{Type: Parenthetical, Text: ps.paren})
		}
		text := s
		if m := reLeadParen.FindStringSubmatch(s); m != nil && strings.TrimSpace(m[2]) != "" {
			p.add(Element{Type: Parenthetical, Text: strings.TrimSpace(m[1])})
			text = m[2]
		}
		p.add(Element{Type: Dialogue, Text: strings.TrimSpace(text)})
		p.speaking = true
		return true
	}
	last := &p.cur.Elements[len(p.cur.Elements)-1]
	last.Text += s
	return true
}

// isStructural 判断一行是不是结构行（标注、动作、转场、人物/道具行、台词或说话人），这些行不能当台词续行。
func isStructural(s string) bool {
	if strings.HasPrefix(s, "【") || reAction.MatchString(s) || reTransit.MatchString(s) ||
		reCast.MatchString(s) || reProps.MatchString(s) {
		return true
	}
	if m := reDialogue.FindStringSubmatch(s); m != nil && !notSpeaker(m[1]) {
		return true
	}
	m := reSpeaker.FindStringSubmatch(s)
	return m != nil && !notSpeaker(m[1])
}

// flushPending 挂起的说话人没等到台词时，原样存成动作，原文不丢。
func (p *parser) flushPending() {
	if p.pending == nil {
		return
	}
	p.add(Element{Type: Action, Text: p.pending.raw})
	p.pending = nil
}

// splitTags 把括号里的内容拆成画外音标记（OS/VO）和语气文字。
func splitTags(s string) (ext, paren string) {
	var rest []string
	for _, t := range reTagSplit.Split(s, -1) {
		t = strings.TrimSpace(t)
		switch strings.ToUpper(t) {
		case "":
		case ExtOS, ExtVO:
			ext = strings.ToUpper(t)
		case "画外音", "旁白":
			ext = ExtVO
		case "内心独白", "心声", "内心":
			ext = ExtOS
		default:
			rest = append(rest, t)
		}
	}
	return ext, strings.Join(rest, "，")
}

func (p *parser) add(e Element) { p.cur.Elements = append(p.cur.Elements, e) }

func (p *parser) warn(line int, msg string) {
	p.res.Warnings = append(p.res.Warnings, Warning{Line: line, Message: fmt.Sprintf("第 %d 行：%s", line, msg)})
}
