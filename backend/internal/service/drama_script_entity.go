package service

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"video-canvas/internal/drama/script"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
)

// 剧本实体的两种类型，同时也是 ScriptRefs / ScriptUsage 的 kind 参数。
const (
	scriptKindCharacter = "character"
	scriptKindLocation  = "location"
)

// scriptEntity 是人物和地点共用的工作形态，保存时再按类型落到各自的表。
type scriptEntity struct {
	ID        uint64
	Name      string
	Aliases   []string
	Note      string
	Node      string
	Confirmed bool
	Position  int
}

func loadScriptEntities(ctx context.Context, tx repository.DramaTx, userID, id uint64, kind string) ([]scriptEntity, error) {
	if kind == scriptKindLocation {
		rows, err := tx.ScriptLocations(ctx, userID, id)
		out := make([]scriptEntity, len(rows))
		for i, r := range rows {
			out[i] = scriptEntity{ID: r.ID, Name: r.Name, Aliases: orEmpty([]string(r.Aliases)), Note: r.Note, Node: r.CanvasNodeID, Confirmed: r.Confirmed, Position: r.Position}
		}
		return out, err
	}
	rows, err := tx.ScriptCharacters(ctx, userID, id)
	out := make([]scriptEntity, len(rows))
	for i, r := range rows {
		out[i] = scriptEntity{ID: r.ID, Name: r.Name, Aliases: orEmpty([]string(r.Aliases)), Note: r.Note, Node: r.CanvasNodeID, Confirmed: r.Confirmed, Position: r.Position}
	}
	return out, err
}

func saveScriptEntity(ctx context.Context, tx repository.DramaTx, userID, id uint64, kind string, e *scriptEntity) error {
	if kind == scriptKindLocation {
		row := model.DramaScriptLocation{ID: e.ID, UserID: userID, DramaID: id, Name: e.Name, Aliases: e.Aliases, Note: e.Note, CanvasNodeID: e.Node, Confirmed: e.Confirmed, Position: e.Position}
		err := tx.SaveScriptLocation(ctx, &row)
		e.ID = row.ID
		return err
	}
	row := model.DramaScriptCharacter{ID: e.ID, UserID: userID, DramaID: id, Name: e.Name, Aliases: e.Aliases, Note: e.Note, CanvasNodeID: e.Node, Confirmed: e.Confirmed, Position: e.Position}
	err := tx.SaveScriptCharacter(ctx, &row)
	e.ID = row.ID
	return err
}

// nameTaken 判断 name 和 aliases 里有没有谁已被其他条目的名字或别名占用（忽略大小写和首尾空白）。
func nameTaken(all []scriptEntity, selfID uint64, name string, aliases []string) bool {
	mine := append([]string{name}, aliases...)
	for _, other := range all {
		if other.ID == selfID {
			continue
		}
		for _, n := range mine {
			if nameMatches(other.Name, other.Aliases, normName(n)) {
				return true
			}
		}
	}
	return false
}

// cleanAliases 去掉空白、与正式名相同和重复的别名。
func cleanAliases(name string, aliases []string) []string {
	out := []string{}
	seen := map[string]bool{normName(name): true}
	for _, a := range aliases {
		a = strings.TrimSpace(a)
		if a == "" || seen[normName(a)] {
			continue
		}
		seen[normName(a)] = true
		out = append(out, a)
	}
	return out
}

// ListScriptEntities 返回人物表（kind=character）或地点表（kind=location），带每个条目出现的集号和人物的发言次数。
// 列人物表时，研读的人物传记还没导入就先导入（只在需要时加项目锁）。
func (s *DramaService) ListScriptEntities(ctx context.Context, userID, id uint64, kind string) ([]DramaScriptEntityView, error) {
	var out []DramaScriptEntityView
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, e := s.structuredProject(ctx, tx, userID, id)
		if e != nil {
			return e
		}
		if kind == scriptKindCharacter && !p.ScriptBiosImported {
			if p, e = tx.Project(ctx, userID, id, true); e != nil {
				return e
			}
			if e = s.ensureBiosImported(ctx, tx, p); e != nil {
				return e
			}
		}
		list, e := loadScriptEntities(ctx, tx, userID, id, kind)
		if e != nil {
			return e
		}
		usage, e := tx.ScriptUsage(ctx, userID, id, kind)
		if e != nil {
			return e
		}
		out = entityViews(list, usage)
		return nil
	})
	return out, dramaError(err)
}

func entityViews(list []scriptEntity, usage []model.DramaScriptUsage) []DramaScriptEntityView {
	eps := map[uint64][]int{}
	lines := map[uint64]int{}
	for _, u := range usage {
		eps[u.ID] = append(eps[u.ID], u.EpisodeNo)
		lines[u.ID] += u.Count
	}
	out := make([]DramaScriptEntityView, len(list))
	for i, e := range list {
		nos := eps[e.ID]
		slices.Sort(nos)
		out[i] = DramaScriptEntityView{ID: idcodec.ID(e.ID), Name: e.Name, Aliases: e.Aliases, Note: e.Note, CanvasNodeID: e.Node, Confirmed: e.Confirmed, Episodes: orEmpty(nos), Lines: lines[e.ID]}
	}
	return out
}

// CreateScriptEntity 手动新建人物或地点，直接为已确认；名字或别名与已有条目冲突返回 67033。
func (s *DramaService) CreateScriptEntity(ctx context.Context, userID, id uint64, kind string, req *CreateDramaScriptEntityReq) (*DramaScriptEntityView, error) {
	var view DramaScriptEntityView
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, e := tx.Project(ctx, userID, id, true)
		if e != nil {
			return e
		}
		if e = s.ensureScriptStructured(ctx, tx, p); e != nil {
			return e
		}
		all, e := loadScriptEntities(ctx, tx, userID, id, kind)
		if e != nil {
			return e
		}
		name := strings.TrimSpace(req.Name)
		if !validScriptName(name) {
			return errcode.ErrInvalidParams.WithMsg("名字不能为空")
		}
		ent := scriptEntity{Name: name, Aliases: cleanAliases(name, req.Aliases), Note: req.Note, Confirmed: true, Position: len(all) + 1}
		if nameTaken(all, 0, ent.Name, ent.Aliases) {
			return errcode.ErrDramaScriptNameTaken
		}
		if e = saveScriptEntity(ctx, tx, userID, id, kind, &ent); e != nil {
			return e
		}
		view = entityViews([]scriptEntity{ent}, nil)[0]
		return nil
	})
	if err != nil {
		return nil, dramaError(err)
	}
	return &view, nil
}

// UpdateScriptEntity 部分更新人物或地点。改名时旧名自动进别名；改过名字、别名、备注或点了确认，条目即为已确认。
// 名字变了要把未锁定集的 script_md 按新名字重渲染（revision+1）并通知前端；已锁定集的 script_md 冻结不动，
// 因为拆解和分镜已经对着那份文本和画布资产名。
func (s *DramaService) UpdateScriptEntity(ctx context.Context, userID, id uint64, kind string, entityID uint64, req *UpdateDramaScriptEntityReq) (*DramaScriptEntityView, error) {
	var view DramaScriptEntityView
	var changed []int
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, e := tx.Project(ctx, userID, id, true)
		if e != nil {
			return e
		}
		if e = s.ensureScriptStructured(ctx, tx, p); e != nil {
			return e
		}
		all, e := loadScriptEntities(ctx, tx, userID, id, kind)
		if e != nil {
			return e
		}
		ent, renamed, e := patchScriptEntity(all, entityID, req)
		if e != nil {
			return e
		}
		if e = saveScriptEntity(ctx, tx, userID, id, kind, ent); e != nil {
			return dramaError(e)
		}
		if renamed {
			if changed, e = s.rerenderUnlocked(ctx, tx, userID, id); e != nil {
				return e
			}
		}
		view = entityViews([]scriptEntity{*ent}, nil)[0]
		return nil
	})
	if err != nil {
		return nil, dramaError(err)
	}
	s.publishScriptEpisodes(ctx, userID, id, changed)
	return &view, nil
}

// patchScriptEntity 把请求应用到目标条目上，返回条目和名字是否变了；目标不存在返回 67001，重名返回 67033。
func patchScriptEntity(all []scriptEntity, entityID uint64, req *UpdateDramaScriptEntityReq) (*scriptEntity, bool, error) {
	var ent *scriptEntity
	for i := range all {
		if all[i].ID == entityID {
			ent = &all[i]
		}
	}
	if ent == nil {
		return nil, false, errcode.ErrDramaNotFound
	}
	renamed, edited := false, false
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if !validScriptName(name) {
			return nil, false, errcode.ErrInvalidParams.WithMsg("名字不能为空")
		}
		if name != ent.Name {
			ent.Aliases = append([]string{ent.Name}, ent.Aliases...)
			ent.Name, renamed, edited = name, true, true
		}
	}
	if req.Aliases != nil {
		ent.Aliases, edited = *req.Aliases, true
	}
	if req.Note != nil {
		ent.Note, edited = *req.Note, true
	}
	ent.Aliases = cleanAliases(ent.Name, ent.Aliases)
	if nameTaken(all, ent.ID, ent.Name, ent.Aliases) {
		return nil, false, errcode.ErrDramaScriptNameTaken
	}
	if edited || (req.Confirmed != nil && *req.Confirmed) {
		ent.Confirmed = true
	}
	return ent, renamed, nil
}

// rerenderUnlocked 把所有未锁定、已有结构的集按当前名字重渲染 script_md，返回内容有变的集号。
func (s *DramaService) rerenderUnlocked(ctx context.Context, tx repository.DramaTx, userID, id uint64) ([]int, error) {
	roster, err := loadScriptRoster(ctx, tx, userID, id)
	if err != nil {
		return nil, err
	}
	eps, err := tx.Episodes(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	var changed []int
	for i := range eps {
		ep := &eps[i]
		if ep.LockedAt != nil {
			continue
		}
		rows, err := tx.ScriptRows(ctx, userID, ep.ID)
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			continue
		}
		md := script.Render(scenesFromRows(rows), ep.No, roster)
		if md == ep.ScriptMD {
			continue
		}
		ep.ScriptMD = md
		if err = tx.SaveEpisode(ctx, ep, ep.Revision); err != nil {
			return nil, err
		}
		changed = append(changed, ep.No)
	}
	return changed, nil
}

// DeleteScriptEntity 删除人物或地点；仍被剧本引用时返回 67032，信息里写明引用它的集号。
func (s *DramaService) DeleteScriptEntity(ctx context.Context, userID, id uint64, kind string, entityID uint64) error {
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, e := tx.Project(ctx, userID, id, true)
		if e != nil {
			return e
		}
		if e = s.ensureScriptStructured(ctx, tx, p); e != nil {
			return e
		}
		refs, e := tx.ScriptRefs(ctx, userID, id, kind, entityID)
		if e != nil {
			return e
		}
		if len(refs) > 0 {
			return s.refsError(ctx, tx, userID, id, refs)
		}
		if kind == scriptKindLocation {
			return tx.DeleteScriptLocation(ctx, userID, id, entityID)
		}
		return tx.DeleteScriptCharacter(ctx, userID, id, entityID)
	})
	return dramaError(err)
}

func (s *DramaService) refsError(ctx context.Context, tx repository.DramaTx, userID, id uint64, epIDs []uint64) error {
	eps, err := tx.Episodes(ctx, userID, id)
	if err != nil {
		return err
	}
	var nos []string
	for _, ep := range eps {
		if slices.Contains(epIDs, ep.ID) {
			nos = append(nos, fmt.Sprint(ep.No))
		}
	}
	return errcode.ErrDramaScriptRefs.WithMsg("第 " + strings.Join(nos, "、") + " 集仍在引用，先在这些集里改掉")
}
