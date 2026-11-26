// Package dramafake 给短剧服务和处理器测试的内存仓储提供「剧本结构、人物表、地点表」那一组原语，
// 让它们不必各自重写。用法：把假仓储里嵌入的 repository.DramaTx 换成 dramafake.ScriptTx，
// 并自己实现 MarkScriptStructured（它要改假仓储自己持有的项目）。
package dramafake

import (
	"context"
	"slices"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

// ScriptTx 在内存里实现剧本结构相关的 DramaTx 方法，其余方法仍由内嵌的接口承接（未实现的会 panic，暴露漏掉的调用）。
type ScriptTx struct {
	repository.DramaTx
	nextID uint64
	rows   map[uint64][]model.DramaSceneRows // 集 ID → 场次
	chars  []model.DramaScriptCharacter
	locs   []model.DramaScriptLocation
}

func (s *ScriptTx) id() uint64 {
	if s.nextID == 0 {
		s.nextID = 1000
	}
	s.nextID++
	return s.nextID
}

// ScriptRows 读取一集的场次和元素。
func (s *ScriptTx) ScriptRows(_ context.Context, _ uint64, episodeID uint64) ([]model.DramaSceneRows, error) {
	return slices.Clone(s.rows[episodeID]), nil
}

// ReplaceScriptRows 整集替换，给新行分配 ID。
func (s *ScriptTx) ReplaceScriptRows(_ context.Context, userID, dramaID, episodeID uint64, scenes []model.DramaSceneRows) ([]model.DramaSceneRows, error) {
	if s.rows == nil {
		s.rows = map[uint64][]model.DramaSceneRows{}
	}
	out := make([]model.DramaSceneRows, len(scenes))
	for i, sc := range scenes {
		sc.Scene.UserID, sc.Scene.DramaID, sc.Scene.EpisodeID, sc.Scene.Position = userID, dramaID, episodeID, i
		if sc.Scene.ID == 0 {
			sc.Scene.ID = s.id()
		}
		els := make([]model.DramaScriptElement, len(sc.Elements))
		for j, e := range sc.Elements {
			e.SceneID, e.Position = sc.Scene.ID, j
			if e.ID == 0 {
				e.ID = s.id()
			}
			els[j] = e
		}
		sc.Elements = els
		out[i] = sc
	}
	s.rows[episodeID] = out
	return slices.Clone(out), nil
}

// DeleteEpisodeScript 删除一集的结构。
func (s *ScriptTx) DeleteEpisodeScript(_ context.Context, _ uint64, episodeID uint64) error {
	delete(s.rows, episodeID)
	return nil
}

// DeleteDramaScript 删除整部剧的结构、人物表和地点表。
func (s *ScriptTx) DeleteDramaScript(context.Context, uint64, uint64) error {
	s.rows, s.chars, s.locs = nil, nil, nil
	return nil
}

// ScriptCharacters 读取人物表。
func (s *ScriptTx) ScriptCharacters(context.Context, uint64, uint64) ([]model.DramaScriptCharacter, error) {
	return slices.Clone(s.chars), nil
}

// ScriptLocations 读取地点表。
func (s *ScriptTx) ScriptLocations(context.Context, uint64, uint64) ([]model.DramaScriptLocation, error) {
	return slices.Clone(s.locs), nil
}

// SaveScriptCharacter 新建或更新人物。
func (s *ScriptTx) SaveScriptCharacter(_ context.Context, c *model.DramaScriptCharacter) error {
	if c.ID == 0 {
		c.ID = s.id()
		s.chars = append(s.chars, *c)
		return nil
	}
	for i := range s.chars {
		if s.chars[i].ID == c.ID {
			s.chars[i] = *c
			return nil
		}
	}
	return repository.ErrNotFound
}

// SaveScriptLocation 新建或更新地点。
func (s *ScriptTx) SaveScriptLocation(_ context.Context, l *model.DramaScriptLocation) error {
	if l.ID == 0 {
		l.ID = s.id()
		s.locs = append(s.locs, *l)
		return nil
	}
	for i := range s.locs {
		if s.locs[i].ID == l.ID {
			s.locs[i] = *l
			return nil
		}
	}
	return repository.ErrNotFound
}

// DeleteScriptCharacter 删除人物。
func (s *ScriptTx) DeleteScriptCharacter(_ context.Context, _, _, id uint64) error {
	n := len(s.chars)
	s.chars = slices.DeleteFunc(s.chars, func(c model.DramaScriptCharacter) bool { return c.ID == id })
	if len(s.chars) == n {
		return repository.ErrNotFound
	}
	return nil
}

// DeleteScriptLocation 删除地点。
func (s *ScriptTx) DeleteScriptLocation(_ context.Context, _, _, id uint64) error {
	n := len(s.locs)
	s.locs = slices.DeleteFunc(s.locs, func(l model.DramaScriptLocation) bool { return l.ID == id })
	if len(s.locs) == n {
		return repository.ErrNotFound
	}
	return nil
}

// ScriptRefs 返回引用某人物或地点的集 ID。
func (s *ScriptTx) ScriptRefs(_ context.Context, _, _ uint64, kind string, id uint64) ([]uint64, error) {
	var out []uint64
	for epID, scenes := range s.rows {
		if refersTo(scenes, kind, id) {
			out = append(out, epID)
		}
	}
	slices.Sort(out)
	return out, nil
}

func refersTo(scenes []model.DramaSceneRows, kind string, id uint64) bool {
	for _, sc := range scenes {
		if kind == "location" && sc.Scene.LocationID == id {
			return true
		}
		if kind != "location" && slices.Contains([]uint64(sc.Scene.ExtraCharacterIDs), id) {
			return true
		}
		for _, e := range sc.Elements {
			if kind != "location" && e.Type == "character" && e.CharacterID == id {
				return true
			}
		}
	}
	return false
}

// ScriptUsage 假实现不统计出现次数。
func (s *ScriptTx) ScriptUsage(context.Context, uint64, uint64, string) ([]model.DramaScriptUsage, error) {
	return nil, nil
}
