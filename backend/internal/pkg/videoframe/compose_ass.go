package videoframe

import (
	"fmt"
	"strings"
	"unicode"
)

// 字幕用 ASS 烧录：libass 自带字体回退，中文靠系统字体（镜像里装 font-noto-cjk），文字本身由本包按字宽自行换行，
// 画面位置、字号、描边与预览对齐（字号占画面宽度的百分比，位置顶 12% / 中 / 底 9%，左右各留边距）。

// 字幕的字号（占画面宽度的百分比）和位置边距，与前端预览一致。
const (
	subtitlePct   = 4.6
	titlePct      = 7.5
	topMarginPct  = 12.0
	botMarginPct  = 9.0
	sideMarginPct = 8.0 // 左右各留，同时决定换行宽度（比预览的 6% 略宽，给不同字体的字宽差异留余量）
	// assCellRatio libass 的字号指整行高度（含上下空白），实际字宽比它小；中日韩字体的行高约为字宽的 1.3–1.45 倍，取 1.3 折算
	assCellRatio = 1.3
	assFont      = "Noto Sans CJK SC"
)

// ComposeText 字幕轨上的一条文字：起点和时长（毫秒），样式、位置和字号百分比与前端预览一致。
type ComposeText struct {
	StartMS, LenMS int64
	Text           string
	// Style 为 title 时用标题样式，其余按字幕
	Style string
	// Pos 为 top / middle，其余按底部
	Pos string
	// Size 字号占默认字号的百分比（60–180），0 按 100
	Size int
}

// glyphEm 一个字符的宽度（以字号为 1）：中日韩和全角字符占满，空格窄，拉丁字母和数字约半个字。
func glyphEm(r rune) float64 {
	switch {
	case r == ' ':
		return 0.3
	case unicode.Is(unicode.Han, r), unicode.Is(unicode.Hiragana, r), unicode.Is(unicode.Katakana, r), unicode.Is(unicode.Hangul, r),
		r >= 0x3000 && r <= 0x303F, r >= 0xFF00 && r <= 0xFFEF, r >= 0x2000 && r <= 0x206F:
		return 1
	case r < 0x80 && (unicode.IsUpper(r) || unicode.IsDigit(r)):
		return 0.62
	case r < 0x80:
		return 0.55
	default:
		return 1
	}
}

// hangsOver 行首不宜出现的收尾标点：超宽时让它挂在上一行末尾，不单独起一行。
func hangsOver(r rune) bool {
	return strings.ContainsRune("，。！？、；：）》」』”’,.!?;:)]}", r)
}

// WrapCaption 按字号 fontPx 和可用宽度 maxWidthPx 把文字折成多行：用户自己的换行保留，拉丁文优先在空格处断，
// 中文逐字断且收尾标点不单独起行。空文字返回 nil。
func WrapCaption(text string, fontPx, maxWidthPx float64) []string {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	var out []string
	for _, para := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		out = append(out, wrapParagraph(para, fontPx, maxWidthPx)...)
	}
	return out
}

// wrapParagraph 折一个不含换行的段落；空段落保留成一个空行。
func wrapParagraph(para string, fontPx, maxWidthPx float64) []string {
	var lines []string
	var line []rune
	var width float64
	lastSpace := -1
	flush := func(rest []rune) {
		lines = append(lines, strings.TrimSpace(string(line)))
		line, lastSpace = nil, -1
		width = 0
		for _, r := range rest {
			line = append(line, r)
			width += glyphEm(r) * fontPx
		}
	}
	for _, r := range para {
		w := glyphEm(r) * fontPx
		if width+w > maxWidthPx && len(line) > 0 && !hangsOver(r) {
			if r != ' ' && lastSpace > 0 {
				rest := append([]rune{}, line[lastSpace+1:]...)
				line = line[:lastSpace]
				flush(rest)
			} else {
				flush(nil)
			}
			if r == ' ' {
				continue // 断在空格处，空格不带到下一行
			}
			w = glyphEm(r) * fontPx
		}
		if r == ' ' {
			lastSpace = len(line)
		}
		line = append(line, r)
		width += w
	}
	return append(lines, strings.TrimSpace(string(line)))
}

// assTime 毫秒转成 ASS 的时间格式 H:MM:SS.cc。
func assTime(ms int64) string {
	cs := ms / 10
	return fmt.Sprintf("%d:%02d:%02d.%02d", cs/360000, cs/6000%60, cs/100%60, cs%100)
}

// assText 转义用户文字：花括号和反斜杠会被 ASS 当成覆盖标签，换成全角字符；行与行之间用硬换行。
func assText(lines []string) string {
	esc := strings.NewReplacer(`\`, "＼", "{", "｛", "}", "｝")
	parts := make([]string, len(lines))
	for i, l := range lines {
		parts[i] = esc.Replace(l)
	}
	return strings.Join(parts, `\N`)
}

// BuildASS 生成整条字幕轨的 ASS 文件内容；width、height 是成片画面尺寸，字号和边距按它折算。
func BuildASS(texts []ComposeText, width, height int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n", width, height)
	b.WriteString("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	fmt.Fprintf(&b, "Style: Default,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,%d,%d,0,1\n\n", assFont, int(float64(width)*subtitlePct/100*assCellRatio), int(float64(width)*sideMarginPct/100), int(float64(width)*sideMarginPct/100))
	b.WriteString("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	for _, t := range texts {
		if line := dialogue(t, width, height); line != "" {
			b.WriteString(line)
		}
	}
	return b.String()
}

// dialogue 一条文字对应的 ASS 事件行；文字为空或没有时长返回空串。
func dialogue(t ComposeText, width, height int) string {
	pct, spacing := subtitlePct, 0.0
	if t.Style == "title" {
		pct, spacing = titlePct, 0.04
	}
	size := t.Size
	if size <= 0 {
		size = 100
	}
	em := float64(width) * pct / 100 * float64(size) / 100 // 一个字的宽度（像素）
	lines := WrapCaption(t.Text, em, float64(width)*(1-2*sideMarginPct/100))
	if len(lines) == 0 || t.LenMS <= 0 {
		return ""
	}
	an, marginV := 2, int(float64(height)*botMarginPct/100)
	switch t.Pos {
	case "top":
		an, marginV = 8, int(float64(height)*topMarginPct/100)
	case "middle":
		an, marginV = 5, 0
	}
	side := int(float64(width) * sideMarginPct / 100)
	tags := fmt.Sprintf(`\an%d\fs%d\bord%d\fsp%.1f`, an, int(em*assCellRatio), max(2, int(em/9)), em*spacing)
	return fmt.Sprintf("Dialogue: 0,%s,%s,Default,,%d,%d,%d,,{%s}%s\n", assTime(t.StartMS), assTime(t.StartMS+t.LenMS), side, side, marginV, tags, assText(lines))
}
