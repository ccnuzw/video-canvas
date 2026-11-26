package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"video-canvas/internal/model"
)

// ErrScriptRowMissing 表示整集保存里带了 ID 的场次或元素不属于这一集（已被删除或别处改过）。
var ErrScriptRowMissing = errors.New("剧本行不存在或不属于这一集")

// ScriptRows 读取一集的全部场次和元素，场次按 position、元素按场内 position 排序；只返回该用户的行。
func (r *DramaRepository) ScriptRows(ctx context.Context, userID, episodeID uint64) ([]model.DramaSceneRows, error) {
	var scenes []model.DramaScene
	if err := r.db.WithContext(ctx).Where("user_id = ? AND episode_id = ?", userID, episodeID).Order("position ASC, id ASC").Find(&scenes).Error; err != nil {
		return nil, err
	}
	var els []model.DramaScriptElement
	if err := r.db.WithContext(ctx).Where("user_id = ? AND episode_id = ?", userID, episodeID).Order("position ASC, id ASC").Find(&els).Error; err != nil {
		return nil, err
	}
	out := make([]model.DramaSceneRows, len(scenes))
	index := make(map[uint64]int, len(scenes))
	for i, s := range scenes {
		out[i].Scene = s
		index[s.ID] = i
	}
	for _, e := range els {
		if i, ok := index[e.SceneID]; ok {
			out[i].Elements = append(out[i].Elements, e)
		}
	}
	return out, nil
}

// ReplaceScriptRows 把一集的结构整体换成 scenes：带 ID 的更新、不带 ID 的新增、数据库里有而这里没有的删除。
// 归属字段（user、drama、episode）一律以参数为准，不信任行里带的值；元素允许在场次之间移动。
// 带了不属于这一集的 ID 返回 ErrScriptRowMissing。返回的行带上新分配的 ID，顺序与入参一致；必须在项目行锁内的事务里调用。
func (r *DramaRepository) ReplaceScriptRows(ctx context.Context, userID, dramaID, episodeID uint64, scenes []model.DramaSceneRows) ([]model.DramaSceneRows, error) {
	existing, err := r.ScriptRows(ctx, userID, episodeID)
	if err != nil {
		return nil, err
	}
	keepScene, keepEl := map[uint64]bool{}, map[uint64]bool{}
	have := scriptIDs(existing)
	for i := range scenes {
		sc := &scenes[i]
		sc.Scene.UserID, sc.Scene.DramaID, sc.Scene.EpisodeID, sc.Scene.Position = userID, dramaID, episodeID, i
		if err := r.saveScene(ctx, &sc.Scene, have.scenes); err != nil {
			return nil, err
		}
		keepScene[sc.Scene.ID] = true
		for j := range sc.Elements {
			el := &sc.Elements[j]
			el.UserID, el.DramaID, el.EpisodeID, el.SceneID, el.Position = userID, dramaID, episodeID, sc.Scene.ID, j
			if err := r.saveElement(ctx, el, have.elements); err != nil {
				return nil, err
			}
			keepEl[el.ID] = true
		}
	}
	return scenes, r.deleteStale(ctx, userID, episodeID, have, keepScene, keepEl)
}

type scriptIDSet struct{ scenes, elements map[uint64]bool }

func scriptIDs(rows []model.DramaSceneRows) scriptIDSet {
	set := scriptIDSet{scenes: map[uint64]bool{}, elements: map[uint64]bool{}}
	for _, row := range rows {
		set.scenes[row.Scene.ID] = true
		for _, e := range row.Elements {
			set.elements[e.ID] = true
		}
	}
	return set
}

func (r *DramaRepository) saveScene(ctx context.Context, s *model.DramaScene, have map[uint64]bool) error {
	db := r.db.WithContext(ctx)
	if s.ID == 0 {
		return db.Create(s).Error
	}
	if !have[s.ID] {
		return ErrScriptRowMissing
	}
	return db.Model(s).Select("position", "int_ext", "time_label", "location_id", "title", "summary", "emotions", "extra_character_ids", "props").Updates(s).Error
}

func (r *DramaRepository) saveElement(ctx context.Context, e *model.DramaScriptElement, have map[uint64]bool) error {
	db := r.db.WithContext(ctx)
	if e.ID == 0 {
		return db.Create(e).Error
	}
	if !have[e.ID] {
		return ErrScriptRowMissing
	}
	return db.Model(e).Select("scene_id", "position", "type", "text", "character_id", "extension").Updates(e).Error
}

func (r *DramaRepository) deleteStale(ctx context.Context, userID, episodeID uint64, have scriptIDSet, keepScene, keepEl map[uint64]bool) error {
	db := r.db.WithContext(ctx)
	if ids := missingIDs(have.elements, keepEl); len(ids) > 0 {
		if err := db.Where("user_id = ? AND episode_id = ? AND id IN ?", userID, episodeID, ids).Delete(&model.DramaScriptElement{}).Error; err != nil {
			return err
		}
	}
	if ids := missingIDs(have.scenes, keepScene); len(ids) > 0 {
		return db.Where("user_id = ? AND episode_id = ? AND id IN ?", userID, episodeID, ids).Delete(&model.DramaScene{}).Error
	}
	return nil
}

func missingIDs(have, keep map[uint64]bool) []uint64 {
	var out []uint64
	for id := range have {
		if !keep[id] {
			out = append(out, id)
		}
	}
	return out
}

// DeleteEpisodeScript 删除一集的全部场次和元素（删集或删剧时调用）。
func (r *DramaRepository) DeleteEpisodeScript(ctx context.Context, userID, episodeID uint64) error {
	db := r.db.WithContext(ctx)
	if err := db.Where("user_id = ? AND episode_id = ?", userID, episodeID).Delete(&model.DramaScriptElement{}).Error; err != nil {
		return err
	}
	return db.Where("user_id = ? AND episode_id = ?", userID, episodeID).Delete(&model.DramaScene{}).Error
}

// DeleteDramaScript 删除一部短剧的全部剧本结构、人物表和地点表。
func (r *DramaRepository) DeleteDramaScript(ctx context.Context, userID, dramaID uint64) error {
	db := r.db.WithContext(ctx)
	for _, m := range []any{&model.DramaScriptElement{}, &model.DramaScene{}, &model.DramaScriptCharacter{}, &model.DramaScriptLocation{}} {
		if err := db.Where("user_id = ? AND drama_id = ?", userID, dramaID).Delete(m).Error; err != nil {
			return err
		}
	}
	return nil
}

// MarkScriptStructured 把项目标为整部剧已转成结构；不动项目 revision（它不是用户可见的内容变化）。
func (r *DramaRepository) MarkScriptStructured(ctx context.Context, userID, dramaID uint64) error {
	return r.db.WithContext(ctx).Model(&model.DramaProject{}).Where("user_id = ? AND id = ?", userID, dramaID).UpdateColumn("script_structured", true).Error
}

// MarkScriptBiosImported 把项目标为人物传记已导入人物表；同样不动项目 revision。
func (r *DramaRepository) MarkScriptBiosImported(ctx context.Context, userID, dramaID uint64) error {
	return r.db.WithContext(ctx).Model(&model.DramaProject{}).Where("user_id = ? AND id = ?", userID, dramaID).UpdateColumn("script_bios_imported", true).Error
}

// ScriptCharacters 读取一部短剧的人物表，按 position、ID 排序。
func (r *DramaRepository) ScriptCharacters(ctx context.Context, userID, dramaID uint64) ([]model.DramaScriptCharacter, error) {
	var rows []model.DramaScriptCharacter
	err := r.db.WithContext(ctx).Where("user_id = ? AND drama_id = ?", userID, dramaID).Order("position ASC, id ASC").Find(&rows).Error
	return rows, err
}

// ScriptLocations 读取一部短剧的地点表，按 position、ID 排序。
func (r *DramaRepository) ScriptLocations(ctx context.Context, userID, dramaID uint64) ([]model.DramaScriptLocation, error) {
	var rows []model.DramaScriptLocation
	err := r.db.WithContext(ctx).Where("user_id = ? AND drama_id = ?", userID, dramaID).Order("position ASC, id ASC").Find(&rows).Error
	return rows, err
}

// SaveScriptCharacter 新建人物（ID 为 0）或按用户和短剧更新全部可编辑列；更新时找不到返回 ErrNotFound。
func (r *DramaRepository) SaveScriptCharacter(ctx context.Context, c *model.DramaScriptCharacter) error {
	db := r.db.WithContext(ctx)
	if c.ID == 0 {
		return db.Create(c).Error
	}
	res := db.Model(c).Where("user_id = ? AND drama_id = ?", c.UserID, c.DramaID).Select("name", "aliases", "note", "canvas_node_id", "confirmed", "position").Updates(c)
	return rowsOrNotFound(res)
}

// SaveScriptLocation 新建地点（ID 为 0）或按用户和短剧更新全部可编辑列；更新时找不到返回 ErrNotFound。
func (r *DramaRepository) SaveScriptLocation(ctx context.Context, l *model.DramaScriptLocation) error {
	db := r.db.WithContext(ctx)
	if l.ID == 0 {
		return db.Create(l).Error
	}
	res := db.Model(l).Where("user_id = ? AND drama_id = ?", l.UserID, l.DramaID).Select("name", "aliases", "note", "canvas_node_id", "confirmed", "position").Updates(l)
	return rowsOrNotFound(res)
}

func rowsOrNotFound(res *gorm.DB) error {
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteScriptCharacter 删除人物，找不到返回 ErrNotFound；调用方先用 ScriptRefs 确认没人引用。
func (r *DramaRepository) DeleteScriptCharacter(ctx context.Context, userID, dramaID, id uint64) error {
	return rowsOrNotFound(r.db.WithContext(ctx).Where("user_id = ? AND drama_id = ? AND id = ?", userID, dramaID, id).Delete(&model.DramaScriptCharacter{}))
}

// DeleteScriptLocation 删除地点，找不到返回 ErrNotFound；调用方先用 ScriptRefs 确认没人引用。
func (r *DramaRepository) DeleteScriptLocation(ctx context.Context, userID, dramaID, id uint64) error {
	return rowsOrNotFound(r.db.WithContext(ctx).Where("user_id = ? AND drama_id = ? AND id = ?", userID, dramaID, id).Delete(&model.DramaScriptLocation{}))
}

// ScriptRefs 返回引用某个人物（kind=character）或地点（kind=location）的集 ID，去重升序。
// 人物被角色行或场次的 extra_character_ids 引用；地点被场次 location_id 引用。
func (r *DramaRepository) ScriptRefs(ctx context.Context, userID, dramaID uint64, kind string, id uint64) ([]uint64, error) {
	db := r.db.WithContext(ctx)
	var ids []uint64
	var err error
	if kind == "location" {
		err = db.Model(&model.DramaScene{}).Where("user_id = ? AND drama_id = ? AND location_id = ?", userID, dramaID, id).Distinct().Order("episode_id").Pluck("episode_id", &ids).Error
		return ids, err
	}
	err = db.Raw(`SELECT DISTINCT episode_id FROM (
		SELECT episode_id FROM drama_script_elements WHERE user_id = ? AND drama_id = ? AND type = 'character' AND character_id = ?
		UNION
		SELECT episode_id FROM drama_scenes WHERE user_id = ? AND drama_id = ? AND extra_character_ids @> to_jsonb(?::bigint)
	) refs ORDER BY episode_id`, userID, dramaID, id, userID, dramaID, id).Scan(&ids).Error
	return ids, err
}

// ScriptUsage 统计人物（kind=character）或地点（kind=location）在各集的出现次数：
// 人物按角色行条数，不说话但出场的人物计 0 次；地点按引用它的场次数。
func (r *DramaRepository) ScriptUsage(ctx context.Context, userID, dramaID uint64, kind string) ([]model.DramaScriptUsage, error) {
	db := r.db.WithContext(ctx)
	var rows []model.DramaScriptUsage
	var err error
	if kind == "location" {
		err = db.Raw(`SELECT s.location_id AS id, ep.no AS episode_no, COUNT(*) AS count
			FROM drama_scenes s JOIN drama_episodes ep ON ep.id = s.episode_id AND ep.deleted_at IS NULL
			WHERE s.user_id = ? AND s.drama_id = ? AND s.location_id <> 0
			GROUP BY s.location_id, ep.no`, userID, dramaID).Scan(&rows).Error
		return rows, err
	}
	err = db.Raw(`SELECT id, episode_no, SUM(count) AS count FROM (
			SELECT el.character_id AS id, ep.no AS episode_no, COUNT(*) AS count
			FROM drama_script_elements el JOIN drama_episodes ep ON ep.id = el.episode_id AND ep.deleted_at IS NULL
			WHERE el.user_id = ? AND el.drama_id = ? AND el.type = 'character' AND el.character_id <> 0
			GROUP BY el.character_id, ep.no
			UNION ALL
			SELECT x::bigint AS id, ep.no AS episode_no, 0 AS count
			FROM drama_scenes s JOIN drama_episodes ep ON ep.id = s.episode_id AND ep.deleted_at IS NULL,
			     jsonb_array_elements_text(s.extra_character_ids) x
			WHERE s.user_id = ? AND s.drama_id = ?
		) u GROUP BY id, episode_no`, userID, dramaID, userID, dramaID).Scan(&rows).Error
	return rows, err
}

// SetEpisodeScriptMD 只改一集的 script_md，不动 revision：用于存量文本转成结构时的格式归一，
// 这不是用户可见的内容变化，不能让前端手里的旧 revision 白白失效。找不到返回 ErrNotFound。
func (r *DramaRepository) SetEpisodeScriptMD(ctx context.Context, userID, dramaID, episodeID uint64, md string) error {
	res := r.db.WithContext(ctx).Model(&model.DramaEpisode{}).Where("user_id = ? AND drama_id = ? AND id = ?", userID, dramaID, episodeID).UpdateColumn("script_md", md)
	return rowsOrNotFound(res)
}
