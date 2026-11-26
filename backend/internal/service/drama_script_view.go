package service

import "video-canvas/internal/pkg/idcodec"

// DramaScriptElementView 是剧本里的一行；请求里 id 为空表示新增，没有出现在请求里的已有行视为删除。
type DramaScriptElementView struct {
	ID          idcodec.ID `json:"id"`
	Type        string     `json:"type" binding:"required,oneof=action character parenthetical dialogue transition subtitle shot flashback_start flashback_end note" label:"元素类型"`
	Text        string     `json:"text" binding:"max=20000" label:"正文"`
	CharacterID idcodec.ID `json:"character_id"`
	Extension   string     `json:"extension" binding:"omitempty,oneof=OS VO" label:"画外音标记"`
}

// DramaScriptSceneView 是一集里的一场；场号由顺序推出。
type DramaScriptSceneView struct {
	ID                idcodec.ID               `json:"id"`
	IntExt            string                   `json:"int_ext" binding:"omitempty,oneof=interior exterior interior_exterior" label:"内外景"`
	TimeLabel         string                   `json:"time_label" binding:"max=16" label:"时间"`
	LocationID        idcodec.ID               `json:"location_id"`
	Title             string                   `json:"title" binding:"max=255" label:"场次标题"`
	Summary           string                   `json:"summary" binding:"max=4000" label:"场次梗概"`
	Emotions          []string                 `json:"emotions" binding:"max=12,dive,max=16" label:"情绪"`
	ExtraCharacterIDs []idcodec.ID             `json:"extra_character_ids" binding:"max=60"`
	Props             []string                 `json:"props" binding:"max=60,dive,max=64" label:"道具"`
	Elements          []DramaScriptElementView `json:"elements" binding:"max=3000,dive"`
}

// DramaScriptWarning 是不影响保存的提示。
type DramaScriptWarning struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// DramaScriptView 是一集的结构化剧本。
type DramaScriptView struct {
	Revision int64                  `json:"revision"`
	Locked   bool                   `json:"locked"`
	Warnings []DramaScriptWarning   `json:"warnings"`
	Scenes   []DramaScriptSceneView `json:"scenes"`
}

// SaveDramaScriptReq 整集保存：带 revision 的乐观锁。
type SaveDramaScriptReq struct {
	Revision int64                  `json:"revision" binding:"required,min=1"`
	Scenes   []DramaScriptSceneView `json:"scenes" binding:"max=300,dive"`
}

// ParseDramaScriptReq 把一段文本解析成场次和元素（粘贴用），新出现的人物和地点会登记为「待确认」。
type ParseDramaScriptReq struct {
	Text string `json:"text" binding:"required,max=200000" label:"文本"`
}

// DramaScriptEntityView 是人物或地点；Lines 只对人物有意义，是该人物的发言次数（角色行条数）。
type DramaScriptEntityView struct {
	ID           idcodec.ID `json:"id"`
	Name         string     `json:"name"`
	Aliases      []string   `json:"aliases"`
	Note         string     `json:"note"`
	CanvasNodeID string     `json:"canvas_node_id"`
	Confirmed    bool       `json:"confirmed"`
	Episodes     []int      `json:"episodes"`
	Lines        int        `json:"lines"`
}

// CreateDramaScriptEntityReq 新建人物或地点，手动新建的直接为已确认。
type CreateDramaScriptEntityReq struct {
	Name    string   `json:"name" binding:"required,max=64" label:"名字"`
	Aliases []string `json:"aliases" binding:"max=20,dive,max=64" label:"别名"`
	Note    string   `json:"note" binding:"max=500" label:"备注"`
}

// UpdateDramaScriptEntityReq 部分更新；改名时旧名自动进别名，改过或点确认后即为已确认。
type UpdateDramaScriptEntityReq struct {
	Name      *string   `json:"name" binding:"omitempty,max=64" label:"名字"`
	Aliases   *[]string `json:"aliases" binding:"omitempty,max=20,dive,max=64" label:"别名"`
	Note      *string   `json:"note" binding:"omitempty,max=500" label:"备注"`
	Confirmed *bool     `json:"confirmed"`
}
