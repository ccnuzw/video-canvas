package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

// scriptNameMax 是人物、地点名字的长度上限（与列宽一致）。
const scriptNameMax = 64

// scriptRoster 是一部短剧的人物表和地点表在事务里的工作副本：解析剧本时按名字或别名认人，
// 认不出的名字登记成「待确认」的新条目；同时用来把 ID 渲染回名字。它同时实现 script.Resolver 和 script.Names。
// 登记失败的错误记在 err 里（接口签名没法返回），调用方解析完必须检查。
type scriptRoster struct {
	ctx     context.Context
	tx      repository.DramaTx
	userID  uint64
	dramaID uint64
	chars   []model.DramaScriptCharacter
	locs    []model.DramaScriptLocation
	err     error
	// readOnly 为 true 时认不出的名字只在内存里分临时 ID，不写库，用于预览。
	readOnly bool
	temp     uint64
}

// scriptTempIDBase 是预览用临时 ID 的起点，远大于任何真实自增 ID。
const scriptTempIDBase = uint64(1) << 62

// previewScriptRoster 读取人物表和地点表，但新名字不登记进库。
func previewScriptRoster(ctx context.Context, tx repository.DramaTx, userID, dramaID uint64) (*scriptRoster, error) {
	r, err := loadScriptRoster(ctx, tx, userID, dramaID)
	if r != nil {
		r.readOnly = true
	}
	return r, err
}

func (r *scriptRoster) nextTemp() uint64 {
	r.temp++
	return scriptTempIDBase + r.temp
}

// loadScriptRoster 读取人物表和地点表。
func loadScriptRoster(ctx context.Context, tx repository.DramaTx, userID, dramaID uint64) (*scriptRoster, error) {
	chars, err := tx.ScriptCharacters(ctx, userID, dramaID)
	if err != nil {
		return nil, err
	}
	locs, err := tx.ScriptLocations(ctx, userID, dramaID)
	if err != nil {
		return nil, err
	}
	return &scriptRoster{ctx: ctx, tx: tx, userID: userID, dramaID: dramaID, chars: chars, locs: locs}, nil
}

// normName 忽略大小写和首尾空白，名字唯一性和匹配都按它比较。
func normName(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func nameMatches(name string, aliases []string, want string) bool {
	if normName(name) == want {
		return true
	}
	for _, a := range aliases {
		if normName(a) == want {
			return true
		}
	}
	return false
}

// validScriptName 名字不能为空，也不能超过列宽。
func validScriptName(name string) bool {
	n := strings.TrimSpace(name)
	return n != "" && utf8.RuneCountInString(n) <= scriptNameMax
}

// Character 按正式名或别名返回人物 ID；表里没有就登记成待确认的新人物。名字不合法或登记失败返回 0。
func (r *scriptRoster) Character(name string) uint64 {
	if !validScriptName(name) {
		return 0
	}
	want := normName(name)
	for _, c := range r.chars {
		if nameMatches(c.Name, c.Aliases, want) {
			return c.ID
		}
	}
	if r.err != nil {
		return 0
	}
	c := model.DramaScriptCharacter{UserID: r.userID, DramaID: r.dramaID, Name: strings.TrimSpace(name), Aliases: []string{}, Position: len(r.chars) + 1}
	if r.readOnly {
		c.ID = r.nextTemp()
	} else if r.err = r.tx.SaveScriptCharacter(r.ctx, &c); r.err != nil {
		return 0
	}
	r.chars = append(r.chars, c)
	return c.ID
}

// Location 按正式名或别名返回地点 ID；表里没有就登记成待确认的新地点。名字不合法或登记失败返回 0。
func (r *scriptRoster) Location(name string) uint64 {
	if !validScriptName(name) {
		return 0
	}
	want := normName(name)
	for _, l := range r.locs {
		if nameMatches(l.Name, l.Aliases, want) {
			return l.ID
		}
	}
	if r.err != nil {
		return 0
	}
	l := model.DramaScriptLocation{UserID: r.userID, DramaID: r.dramaID, Name: strings.TrimSpace(name), Aliases: []string{}, Position: len(r.locs) + 1}
	if r.readOnly {
		l.ID = r.nextTemp()
	} else if r.err = r.tx.SaveScriptLocation(r.ctx, &l); r.err != nil {
		return 0
	}
	r.locs = append(r.locs, l)
	return l.ID
}

// CharacterName 返回人物正式名，找不到返回空串。
func (r *scriptRoster) CharacterName(id uint64) string {
	for _, c := range r.chars {
		if c.ID == id {
			return c.Name
		}
	}
	return ""
}

// LocationName 返回地点正式名，找不到返回空串。
func (r *scriptRoster) LocationName(id uint64) string {
	for _, l := range r.locs {
		if l.ID == id {
			return l.Name
		}
	}
	return ""
}

func (r *scriptRoster) hasCharacter(id uint64) bool { return r.CharacterName(id) != "" }
func (r *scriptRoster) hasLocation(id uint64) bool  { return r.LocationName(id) != "" }
