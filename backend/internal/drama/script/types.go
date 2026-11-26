// Package script 是结构化剧本的纯逻辑：文本解析、渲染、顺序校验和整集重写时的合并。
// 不依赖数据库；ID 为 0 表示尚未落库。设计见 docs/design/结构化剧本编辑器。
package script

// ElementType 是剧本元素类型。
type ElementType string

// 元素类型。character 只带人物引用不带文本；note 是作者备注，不渲染进 script_md。
const (
	Action         ElementType = "action"
	Character      ElementType = "character"
	Parenthetical  ElementType = "parenthetical"
	Dialogue       ElementType = "dialogue"
	Transition     ElementType = "transition"
	Subtitle       ElementType = "subtitle"
	Shot           ElementType = "shot"
	FlashbackStart ElementType = "flashback_start"
	FlashbackEnd   ElementType = "flashback_end"
	Note           ElementType = "note"
)

// 内外景取值。
const (
	Interior         = "interior"
	Exterior         = "exterior"
	InteriorExterior = "interior_exterior"
)

// 角色行的画外音标记。
const (
	ExtOS = "OS"
	ExtVO = "VO"
)

// Element 是场内的一行。
type Element struct {
	ID          uint64      `json:"id"`
	Type        ElementType `json:"type"`
	Text        string      `json:"text"`
	CharacterID uint64      `json:"character_id"`
	Extension   string      `json:"extension"`
}

// Scene 是一集里的一场。场号由顺序推出，不存。
type Scene struct {
	ID                uint64    `json:"id"`
	IntExt            string    `json:"int_ext"`
	TimeLabel         string    `json:"time_label"`
	LocationID        uint64    `json:"location_id"`
	Title             string    `json:"title"`
	Summary           string    `json:"summary"`
	Emotions          []string  `json:"emotions"`
	ExtraCharacterIDs []uint64  `json:"extra_character_ids"`
	Props             []string  `json:"props"`
	Elements          []Element `json:"elements"`
}

// Resolver 把名字解析成人物或地点 ID；名字不在表里时由实现决定是否登记，返回 0 表示无法解析。
type Resolver interface {
	// Character 按正式名或别名返回人物 ID。
	Character(name string) uint64
	// Location 按正式名或别名返回地点 ID。
	Location(name string) uint64
}

// Names 渲染时用来把 ID 变回名字。
type Names interface {
	// CharacterName 返回人物正式名，找不到返回空串。
	CharacterName(id uint64) string
	// LocationName 返回地点正式名，找不到返回空串。
	LocationName(id uint64) string
}

// Warning 是不影响保存的提示，Line 从 1 起，0 表示不对应具体行。
type Warning struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// ParseResult 是文本解析结果。
type ParseResult struct {
	Scenes   []Scene
	Warnings []Warning
}

// ValidationError 指出第几场（从 0 起）第几个元素（从 0 起）不合法。
type ValidationError struct {
	Scene   int
	Element int
	Message string
}

// Error 实现 error。
func (e *ValidationError) Error() string { return e.Message }

// Stats 是合并结果的条数统计。
type Stats struct {
	Kept     int `json:"kept"`
	Modified int `json:"modified"`
	Added    int `json:"added"`
	Deleted  int `json:"deleted"`
}
