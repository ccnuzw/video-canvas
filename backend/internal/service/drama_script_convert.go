package service

import (
	"fmt"

	"video-canvas/internal/drama/script"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
)

// scenesFromRows 把库里的行转成纯逻辑包的场次。
func scenesFromRows(rows []model.DramaSceneRows) []script.Scene {
	out := make([]script.Scene, len(rows))
	for i, row := range rows {
		s := row.Scene
		sc := script.Scene{ID: s.ID, IntExt: s.IntExt, TimeLabel: s.TimeLabel, LocationID: s.LocationID, Title: s.Title, Summary: s.Summary,
			Emotions: append([]string{}, s.Emotions...), ExtraCharacterIDs: append([]uint64{}, s.ExtraCharacterIDs...), Props: append([]string{}, s.Props...)}
		for _, e := range row.Elements {
			sc.Elements = append(sc.Elements, script.Element{ID: e.ID, Type: script.ElementType(e.Type), Text: e.Text, CharacterID: e.CharacterID, Extension: e.Extension})
		}
		out[i] = sc
	}
	return out
}

// rowsFromScenes 把纯逻辑包的场次转成待落库的行；归属字段由仓储统一填。
func rowsFromScenes(scenes []script.Scene) []model.DramaSceneRows {
	out := make([]model.DramaSceneRows, len(scenes))
	for i, sc := range scenes {
		row := model.DramaSceneRows{Scene: model.DramaScene{ID: sc.ID, IntExt: sc.IntExt, TimeLabel: sc.TimeLabel, LocationID: sc.LocationID, Title: sc.Title, Summary: sc.Summary,
			Emotions: orEmpty(sc.Emotions), ExtraCharacterIDs: orEmpty(sc.ExtraCharacterIDs), Props: orEmpty(sc.Props)}}
		for _, e := range sc.Elements {
			row.Elements = append(row.Elements, model.DramaScriptElement{ID: e.ID, Type: string(e.Type), Text: e.Text, CharacterID: e.CharacterID, Extension: e.Extension})
		}
		out[i] = row
	}
	return out
}

func orEmpty[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

// viewFromScenes 转成对外的响应。
func viewFromScenes(scenes []script.Scene) []DramaScriptSceneView {
	out := make([]DramaScriptSceneView, len(scenes))
	for i, sc := range scenes {
		v := DramaScriptSceneView{ID: idcodec.ID(sc.ID), IntExt: sc.IntExt, TimeLabel: sc.TimeLabel, LocationID: idcodec.ID(sc.LocationID), Title: sc.Title, Summary: sc.Summary,
			Emotions: orEmpty(sc.Emotions), Props: orEmpty(sc.Props), ExtraCharacterIDs: []idcodec.ID{}, Elements: []DramaScriptElementView{}}
		for _, id := range sc.ExtraCharacterIDs {
			v.ExtraCharacterIDs = append(v.ExtraCharacterIDs, idcodec.ID(id))
		}
		for _, e := range sc.Elements {
			v.Elements = append(v.Elements, DramaScriptElementView{ID: idcodec.ID(e.ID), Type: string(e.Type), Text: e.Text, CharacterID: idcodec.ID(e.CharacterID), Extension: e.Extension})
		}
		out[i] = v
	}
	return out
}

// scenesFromView 把请求转成场次，并校验引用的人物、地点都在这部短剧的表里；
// 角色行不带正文、非角色行不带人物和画外音标记，请求里多带的会被忽略（而不是报错），以结构为准。
func scenesFromView(views []DramaScriptSceneView, roster *scriptRoster) ([]script.Scene, error) {
	out := make([]script.Scene, len(views))
	for i, v := range views {
		if v.LocationID != 0 && !roster.hasLocation(uint64(v.LocationID)) {
			return nil, errcode.ErrInvalidParams.WithMsg(fmt.Sprintf("第 %d 场的地点不存在", i+1))
		}
		sc := script.Scene{ID: uint64(v.ID), IntExt: v.IntExt, TimeLabel: v.TimeLabel, LocationID: uint64(v.LocationID), Title: v.Title, Summary: v.Summary, Emotions: orEmpty(v.Emotions), Props: orEmpty(v.Props)}
		for _, id := range v.ExtraCharacterIDs {
			if !roster.hasCharacter(uint64(id)) {
				return nil, errcode.ErrInvalidParams.WithMsg(fmt.Sprintf("第 %d 场的出场人物不存在", i+1))
			}
			sc.ExtraCharacterIDs = append(sc.ExtraCharacterIDs, uint64(id))
		}
		for j, e := range v.Elements {
			el, err := elementFromView(e, roster)
			if err != nil {
				return nil, errcode.ErrInvalidParams.WithMsg(fmt.Sprintf("第 %d 场第 %d 行：%s", i+1, j+1, err.Error()))
			}
			sc.Elements = append(sc.Elements, el)
		}
		out[i] = sc
	}
	return out, nil
}

func elementFromView(e DramaScriptElementView, roster *scriptRoster) (script.Element, error) {
	el := script.Element{ID: uint64(e.ID), Type: script.ElementType(e.Type), Text: e.Text}
	if el.Type == script.Character {
		if e.CharacterID != 0 && !roster.hasCharacter(uint64(e.CharacterID)) {
			return el, fmt.Errorf("人物不存在")
		}
		el.CharacterID, el.Extension, el.Text = uint64(e.CharacterID), e.Extension, ""
	}
	return el, nil
}

// scriptHasContent 判断结构里有没有拍摄内容（只有备注不算）。
func scriptHasContent(scenes []script.Scene) bool {
	for _, sc := range scenes {
		for _, e := range sc.Elements {
			if e.Type != script.Note {
				return true
			}
		}
	}
	return false
}
