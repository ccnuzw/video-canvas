package script

import (
	"fmt"
	"strings"
)

// Render 把结构渲染成内置格式文本（拆解、分镜、上集衔接读的 script_md）。
// 备注不渲染；「人物：」行是本场说话人（按首次出现）加不说话的出场人物；没有内容的行跳过。
func Render(scenes []Scene, episodeNo int, names Names) string {
	var out []string
	out = append(out, fmt.Sprintf("第%d集", episodeNo))
	for i, sc := range scenes {
		out = append(out, "", sceneHeading(sc, episodeNo, i+1, names))
		if cast := castLine(sc, names); cast != "" {
			out = append(out, cast)
		}
		if len(sc.Props) > 0 {
			out = append(out, "道具："+strings.Join(sc.Props, "、"))
		}
		out = append(out, renderElements(sc.Elements, names)...)
	}
	return strings.Join(out, "\n")
}

var intExtText = map[string]string{Interior: "内", Exterior: "外", InteriorExterior: "内外"}

func sceneHeading(sc Scene, episodeNo, no int, names Names) string {
	var parts []string
	if sc.TimeLabel != "" {
		parts = append(parts, sc.TimeLabel)
	}
	if v := intExtText[sc.IntExt]; v != "" {
		parts = append(parts, v)
	}
	head := fmt.Sprintf("%d-%d", episodeNo, no)
	if len(parts) > 0 {
		head += " " + strings.Join(parts, "/")
	}
	if name := names.LocationName(sc.LocationID); sc.LocationID != 0 && name != "" {
		head += " · " + name
	}
	return head
}

func castLine(sc Scene, names Names) string {
	var ids []uint64
	seen := map[uint64]bool{}
	for _, e := range sc.Elements {
		if e.Type == Character && e.CharacterID != 0 && !seen[e.CharacterID] {
			seen[e.CharacterID] = true
			ids = append(ids, e.CharacterID)
		}
	}
	for _, id := range sc.ExtraCharacterIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	var list []string
	for _, id := range ids {
		if name := names.CharacterName(id); name != "" {
			list = append(list, name)
		}
	}
	if len(list) == 0 {
		return ""
	}
	return "人物：" + strings.Join(list, "、")
}

// renderElements 渲染场内元素；括号只附着在紧随其后的那句对白上，画外音标记附着在该角色的每句对白上。
func renderElements(els []Element, names Names) []string {
	var out []string
	var who Element
	var paren []string
	for _, e := range els {
		switch e.Type {
		case Character:
			who, paren = e, nil
		case Parenthetical:
			if e.Text != "" {
				paren = append(paren, e.Text)
			}
		case Dialogue:
			if e.Text != "" {
				out = append(out, dialogueLine(who, paren, e.Text, names))
			}
			paren = nil
		default:
			if line := plainLine(e); line != "" {
				out = append(out, line)
			}
		}
	}
	return out
}

func dialogueLine(who Element, paren []string, text string, names Names) string {
	name := names.CharacterName(who.CharacterID)
	if name == "" {
		name = "未知"
	}
	tags := paren
	if who.Extension != "" {
		tags = append([]string{who.Extension}, paren...)
	}
	if len(tags) > 0 {
		name += "（" + strings.Join(tags, "，") + "）"
	}
	return name + "：" + text
}

// plainLine 渲染不涉及人物的元素；备注和没有内容的行返回空串。
func plainLine(e Element) string {
	switch e.Type {
	case Action:
		if e.Text != "" {
			return "△ " + e.Text
		}
	case Subtitle:
		if e.Text != "" {
			return "【字幕：" + e.Text + "】"
		}
	case Shot:
		if e.Text != "" {
			return "【空镜】" + e.Text
		}
	case FlashbackStart:
		return "【闪回】"
	case FlashbackEnd:
		return "【闪回结束】"
	case Transition:
		return e.Text
	}
	return ""
}
