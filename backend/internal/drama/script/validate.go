package script

// Validate 校验场内顺序：对白、括号必须挂在角色行后；角色行必须选了人物且后面有台词；闪回在同一场内成对且不嵌套。
// 返回第一个不合法的位置，合法返回 nil。
func Validate(scenes []Scene) *ValidationError {
	for si, sc := range scenes {
		if err := validateScene(sc.Elements); err != nil {
			err.Scene = si
			return err
		}
	}
	return nil
}

func validateScene(els []Element) *ValidationError {
	for i, e := range els {
		if msg := speechProblem(els, i, e); msg != "" {
			return &ValidationError{Element: i, Message: msg}
		}
	}
	return flashbackProblem(els)
}

// speechProblem 检查角色、括号、对白的相互位置，合法返回空串。
func speechProblem(els []Element, i int, e Element) string {
	switch e.Type {
	case Character:
		if e.CharacterID == 0 {
			return "角色行没有选人物"
		}
		if !followedByDialogue(els, i) {
			return "角色行后面没有台词"
		}
	case Parenthetical, Dialogue:
		if i == 0 || !isSpeech(els[i-1].Type) {
			return "台词前面没有角色行"
		}
		if e.Type == Parenthetical && !followedByDialogue(els, i) {
			return "括号后面没有台词"
		}
	}
	return ""
}

// flashbackProblem 检查闪回成对且不嵌套。
func flashbackProblem(els []Element) *ValidationError {
	open := -1
	for i, e := range els {
		switch e.Type {
		case FlashbackStart:
			if open >= 0 {
				return &ValidationError{Element: i, Message: "闪回不能嵌套"}
			}
			open = i
		case FlashbackEnd:
			if open < 0 {
				return &ValidationError{Element: i, Message: "闪回结束前没有闪回"}
			}
			open = -1
		}
	}
	if open >= 0 {
		return &ValidationError{Element: open, Message: "闪回没有结束"}
	}
	return nil
}

func isSpeech(t ElementType) bool {
	return t == Character || t == Parenthetical || t == Dialogue
}

// followedByDialogue 判断第 i 个元素之后（允许中间夹括号）紧跟着对白。
func followedByDialogue(els []Element, i int) bool {
	for k := i + 1; k < len(els); k++ {
		switch els[k].Type {
		case Parenthetical:
			continue
		case Dialogue:
			return true
		default:
			return false
		}
	}
	return false
}

// Repair 丢掉不成对的闪回标记（只有开始、只有结束、嵌套的内层开始），让模型输出的文本落库前一定合法；
// 角色、对白的顺序由解析保证，这里不动。返回新切片，不改入参。
func Repair(scenes []Scene) []Scene {
	out := make([]Scene, len(scenes))
	for i, sc := range scenes {
		sc.Elements = repairFlashbacks(sc.Elements)
		out[i] = sc
	}
	return out
}

func repairFlashbacks(els []Element) []Element {
	drop := map[int]bool{}
	open := -1
	for i, e := range els {
		switch e.Type {
		case FlashbackStart:
			if open >= 0 {
				drop[open] = true // 嵌套：丢掉外层没配上的开始，保留最近的一对
			}
			open = i
		case FlashbackEnd:
			if open < 0 {
				drop[i] = true
			} else {
				open = -1
			}
		}
	}
	if open >= 0 {
		drop[open] = true
	}
	out := make([]Element, 0, len(els))
	for i, e := range els {
		if !drop[i] {
			out = append(out, e)
		}
	}
	return out
}
