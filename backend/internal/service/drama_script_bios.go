package service

import (
	"context"
	"strings"

	"video-canvas/internal/drama/script"
	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

// ensureBiosImported 把研读生成的人物传记（characters_md）导入人物表，之后小传以人物表的 note 为准。
// 按正式名、再按别名匹配已有人物：note 为空才填小传，新别名并进去（被别的条目占用的跳过），条目变已确认；
// 匹配不到的新建为已确认、排在末尾。已导入过的项目直接返回。调用方必须持有项目行锁。
func (s *DramaService) ensureBiosImported(ctx context.Context, tx repository.DramaTx, p *model.DramaProject) error {
	if p.ScriptBiosImported {
		return nil
	}
	all, err := loadScriptEntities(ctx, tx, p.UserID, p.ID, scriptKindCharacter)
	if err != nil {
		return err
	}
	for _, bio := range script.ParseBios(p.CharactersMD) {
		if !validScriptName(bio.Name) {
			continue
		}
		if all, err = importBio(ctx, tx, p, all, bio); err != nil {
			return err
		}
	}
	if err = tx.MarkScriptBiosImported(ctx, p.UserID, p.ID); err != nil {
		return err
	}
	p.ScriptBiosImported = true
	return nil
}

// importBio 把一条小传并进人物表，返回更新后的人物表。
func importBio(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, all []scriptEntity, bio script.Bio) ([]scriptEntity, error) {
	name := strings.TrimSpace(bio.Name)
	ent := matchBio(all, name, bio.Aliases)
	if ent == nil {
		last := 0
		for _, e := range all {
			last = max(last, e.Position)
		}
		all = append(all, scriptEntity{Name: name, Position: last + 1})
		ent = &all[len(all)-1]
	}
	// 已有条目的正式名不动，传记里的正式名和别名都当别名候选；被别的条目占用的跳过。
	aliases := ent.Aliases
	for _, a := range append([]string{name}, bio.Aliases...) {
		if !validScriptName(a) || nameTaken(all, ent.ID, a, nil) {
			continue
		}
		aliases = append(aliases, a)
	}
	ent.Aliases = cleanAliases(ent.Name, aliases)
	if strings.TrimSpace(ent.Note) == "" {
		ent.Note = bio.Text
	}
	ent.Confirmed = true
	if err := saveScriptEntity(ctx, tx, p.UserID, p.ID, scriptKindCharacter, ent); err != nil {
		return nil, err
	}
	return all, nil
}

// matchBio 先按正式名、再按别名在人物表里找传记里的人物，规则同剧本里的名字匹配（忽略大小写和首尾空白）。
func matchBio(all []scriptEntity, name string, aliases []string) *scriptEntity {
	for _, want := range append([]string{name}, aliases...) {
		for i := range all {
			if nameMatches(all[i].Name, all[i].Aliases, normName(want)) {
				return &all[i]
			}
		}
	}
	return nil
}

// scriptCharactersMD 由人物表拼出写剧本用的人物设定：只列已确认的人物，每人一行「- **正式名／别名**：小传」。
// 人物表里没有已确认人物时退回研读的人物传记。
func scriptCharactersMD(all []scriptEntity, fallback string) string {
	var bios []script.Bio
	for _, e := range all {
		if e.Confirmed {
			bios = append(bios, script.Bio{Name: e.Name, Aliases: e.Aliases, Text: e.Note})
		}
	}
	if md := script.RenderBios(bios); md != "" {
		return md
	}
	return fallback
}

// scriptLocationsMD 由地点表拼出场景设定：只列写了描述的地点（没描述的只有名字，不提供信息），每个一行「- **名字／别名**：描述」。
func scriptLocationsMD(all []scriptEntity) string {
	var bios []script.Bio
	for _, e := range all {
		if strings.TrimSpace(e.Note) != "" {
			bios = append(bios, script.Bio{Name: e.Name, Aliases: e.Aliases, Text: e.Note})
		}
	}
	return script.RenderBios(bios)
}

// scriptSettings 在项目行锁内确保剧本已转成结构、传记已导入人物表，返回由人物表、地点表拼出的人物设定和场景设定。
// 写剧本读人物设定；拆解、资产图提示词、分镜两样都读，用户在卡片上改的小传、写的地点描述才会真正影响模型。
func (s *DramaService) scriptSettings(ctx context.Context, userID, id uint64) (characters, locations string, err error) {
	err = s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, e := tx.Project(ctx, userID, id, true)
		if e != nil {
			return e
		}
		if e = s.ensureScriptStructured(ctx, tx, p); e != nil {
			return e
		}
		if e = s.ensureBiosImported(ctx, tx, p); e != nil {
			return e
		}
		people, e := loadScriptEntities(ctx, tx, userID, id, scriptKindCharacter)
		if e != nil {
			return e
		}
		places, e := loadScriptEntities(ctx, tx, userID, id, scriptKindLocation)
		if e != nil {
			return e
		}
		characters = scriptCharactersMD(people, p.CharactersMD)
		locations = scriptLocationsMD(places)
		return nil
	})
	return characters, locations, err
}
