package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/repository"
)

// DramaPromptPresetRepo 支持一致读目录和在分类锁内写审计。
type DramaPromptPresetRepo interface {
	// PresetRows 返回目录；仅管理员或默认模板正文查询会读取正文。
	PresetRows(context.Context, bool, bool) ([]model.DramaPromptPresetRow, error)
	// Preset 按分类和模板 ID 查询，不允许跨分类引用。
	Preset(context.Context, string, uint64) (*model.DramaPromptPreset, error)
	// WithTx 串联锁分类、修改和操作审计。
	WithTx(context.Context, func(repository.DramaPromptPresetTx) error) error
}

// DramaPromptTemplateView 是现有个人编辑器读取的可替换正文，不含协议。
type DramaPromptTemplateView struct {
	Step  string                `json:"step"`
	Pages []DramaPromptPageView `json:"pages"`
}

// DramaPromptPageView 描述某类提示词的编辑页。
type DramaPromptPageView struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Body  string `json:"body"`
}

// PromptPresetCatalog 返回六类默认项和目录；只有管理端读取启停状态和正文。
func (s *DramaService) PromptPresetCatalog(ctx context.Context, admin bool) ([]model.DramaPromptPresetGroupView, error) {
	rows, err := s.presetRows(ctx, admin, false)
	if err != nil {
		return nil, err
	}
	groups := make([]model.DramaPromptPresetGroupView, 0, len(DramaPromptSteps))
	for _, step := range DramaPromptSteps {
		group := presetGroupView(step, rows, admin)
		if admin && s.presets != nil {
			group.OriginalBody = drama.PromptBody(DramaPromptPages(step)[0])
		}
		if s.presets != nil && group.DefaultID == "" {
			return nil, errcode.ErrInternal
		}
		groups = append(groups, group)
	}
	return groups, nil
}

// presetGroupView 先填默认项，再按 ID 追加其他候选。
func presetGroupView(step string, rows []model.DramaPromptPresetRow, admin bool) model.DramaPromptPresetGroupView {
	group := model.DramaPromptPresetGroupView{Step: step, Items: []model.DramaPromptPresetView{}}
	for _, row := range rows {
		if row.Step != step || (!admin && row.Status != model.DramaPresetEnabled) {
			continue
		}
		item := presetView(row.DramaPromptPreset, admin)
		if row.ID == row.DefaultID && row.Status == model.DramaPresetEnabled {
			group.DefaultID = item.ID
			group.Items = append([]model.DramaPromptPresetView{item}, group.Items...)
		} else {
			group.Items = append(group.Items, item)
		}
		if admin {
			group.Revision = row.GroupRevision
		}
	}
	return group
}

// presetView 有意把管理字段与用户目录隔开。
func presetView(row model.DramaPromptPreset, admin bool) model.DramaPromptPresetView {
	item := model.DramaPromptPresetView{ID: idcodec.Encode(row.ID), Name: row.Name, Description: row.Description, Revision: row.Revision}
	if admin {
		item.Body, item.Status, item.UpdatedAt = row.Body, row.Status, &row.UpdatedAt
		if row.UpdatedBy > 0 {
			item.UpdatedBy = idcodec.Encode(row.UpdatedBy)
		}
	}
	return item
}

// PromptTemplates 给个人编辑器提供当前默认正文；旧测试或停用目录时沿用代码内置。
func (s *DramaService) PromptTemplates(ctx context.Context) ([]DramaPromptTemplateView, error) {
	defaults, err := s.presetDefaults(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]DramaPromptTemplateView, 0, len(DramaPromptSteps))
	for _, step := range DramaPromptSteps {
		key := DramaPromptPages(step)[0]
		body := drama.PromptBody(key)
		if preset, ok := defaults[step]; ok {
			body = preset.Body
		}
		items = append(items, DramaPromptTemplateView{Step: step, Pages: []DramaPromptPageView{{Key: key, Label: DramaPromptStepLabel(step), Body: body}}})
	}
	return items, nil
}

// DramaPromptStepLabel 返回用户可见的分类名称。
func DramaPromptStepLabel(step string) string {
	return map[string]string{"plan": "分集规划", "scripts": "分集剧本", "assets": "资产拆解", "asset_prompts": "资产图提示词", "video": "视频提示词", "board": "故事板提示词"}[step]
}

// presetRows 未注入目录时维持旧服务行为。
func (s *DramaService) presetRows(ctx context.Context, admin, bodies bool) ([]model.DramaPromptPresetRow, error) {
	if s.presets == nil {
		return nil, nil
	}
	return s.presets.PresetRows(ctx, admin, bodies)
}

// presetDefaults 用同一次读取锁定六类默认项，并拒绝损坏的目录。
func (s *DramaService) presetDefaults(ctx context.Context) (map[string]model.DramaPromptPreset, error) {
	rows, err := s.presetRows(ctx, false, true)
	if err != nil || s.presets == nil {
		return nil, err
	}
	defaults := make(map[string]model.DramaPromptPreset, len(rows))
	for _, row := range rows {
		if row.ID == row.DefaultID && row.Status == model.DramaPresetEnabled && strings.TrimSpace(row.Body) != "" {
			defaults[row.Step] = row.DramaPromptPreset
		}
	}
	for _, step := range DramaPromptSteps {
		if _, ok := defaults[step]; !ok {
			return nil, errcode.ErrInternal
		}
	}
	return defaults, nil
}

// SavePromptPreset 新建停用项或保存一个模板的新版本。
func (s *DramaService) SavePromptPreset(ctx context.Context, actor, id uint64, step string, req model.SaveDramaPromptPresetReq) (*model.DramaPromptPresetView, error) {
	// 1. 复用正文规则，尤其是故事板占位符；不允许创建时跳过停用状态。
	if err := validatePresetEdit(step, id, &req); err != nil {
		return nil, err
	}
	return s.writePromptPreset(ctx, actor, id, step, func(tx repository.DramaPromptPresetTx, _ *model.DramaPromptPresetGroup, row *model.DramaPromptPreset) (string, error) {
		if row.Status == model.DramaPresetArchived {
			return "", errcode.ErrDramaPresetInactive
		}
		if row.Revision != req.Revision {
			return "", errcode.ErrDramaPresetChanged
		}
		row.Name, row.Description, row.Body = req.Name, req.Description, req.Body
		row.Revision++
		action := "update"
		if id == 0 {
			action = "create"
		}
		return action, tx.SavePreset(ctx, row)
	})
}

// validatePresetEdit 规范正文和名称，避免空白名称或空白正文被启用。
func validatePresetEdit(step string, id uint64, req *model.SaveDramaPromptPresetReq) error {
	pages := DramaPromptPages(step)
	if len(pages) == 0 || (id == 0) != (req.Revision == 0) {
		return errcode.ErrInvalidParams
	}
	req.Name, req.Description, req.Body = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), strings.TrimSpace(req.Body)
	if utf8.RuneCountInString(req.Description) > 240 || utf8.RuneCountInString(req.Name) > 80 || req.Name == "" {
		return errcode.ErrInvalidParams
	}
	if req.Body == "" || utf8.RuneCountInString(req.Body) > 20000 {
		return errcode.ErrDramaPromptInvalid
	}
	if step == "board" {
		return checkBoardTemplate(req.Body)
	}
	return nil
}

// SetPromptPresetState 串行校验默认项与候选状态，确保每类始终有已启用的默认。
func (s *DramaService) SetPromptPresetState(ctx context.Context, actor, id uint64, step string, req model.UpdateDramaPromptPresetStateReq) (*model.DramaPromptPresetView, error) {
	if id == 0 || req.Revision < 1 {
		return nil, errcode.ErrInvalidParams
	}
	return s.writePromptPreset(ctx, actor, id, step, func(tx repository.DramaPromptPresetTx, group *model.DramaPromptPresetGroup, row *model.DramaPromptPreset) (string, error) {
		if req.Action == "default" {
			return switchPresetDefault(ctx, tx, group, row, req.Revision)
		}
		return setPresetStatus(ctx, tx, group, row, req)
	})
}

// switchPresetDefault 用分类版本切换唯一默认，重放已达成的请求无副作用。
func switchPresetDefault(ctx context.Context, tx repository.DramaPromptPresetTx, group *model.DramaPromptPresetGroup, row *model.DramaPromptPreset, revision int) (string, error) {
	if row.Status != model.DramaPresetEnabled {
		return "", errcode.ErrDramaPresetInactive
	}
	if group.DefaultID == row.ID {
		return "", nil
	}
	if group.Revision != revision {
		return "", errcode.ErrDramaPresetChanged
	}
	group.DefaultID = row.ID
	group.Revision++
	return "default", tx.SaveGroup(ctx, group)
}

// setPresetStatus 保护当前默认项，归档为终态。
func setPresetStatus(ctx context.Context, tx repository.DramaPromptPresetTx, group *model.DramaPromptPresetGroup, row *model.DramaPromptPreset, req model.UpdateDramaPromptPresetStateReq) (string, error) {
	statuses := map[string]string{"enable": model.DramaPresetEnabled, "disable": model.DramaPresetDisabled, "archive": model.DramaPresetArchived}
	next, ok := statuses[req.Action]
	if !ok {
		return "", errcode.ErrInvalidParams
	}
	if row.Status == next {
		return "", nil
	}
	if row.Status == model.DramaPresetArchived {
		return "", errcode.ErrDramaPresetInactive
	}
	if group.DefaultID == row.ID {
		return "", errcode.ErrDramaPresetDefault
	}
	if row.Revision != req.Revision {
		return "", errcode.ErrDramaPresetChanged
	}
	row.Status = next
	row.Revision++
	return req.Action, tx.SavePreset(ctx, row)
}

type mutatePreset func(repository.DramaPromptPresetTx, *model.DramaPromptPresetGroup, *model.DramaPromptPreset) (string, error)

// writePromptPreset 锁住分类后加载目标，业务变更和审计同成同败。
func (s *DramaService) writePromptPreset(ctx context.Context, actor, id uint64, step string, mutate mutatePreset) (*model.DramaPromptPresetView, error) {
	if DramaPromptPages(step) == nil || actor == 0 {
		return nil, errcode.ErrInvalidParams
	}
	if s.presets == nil {
		return nil, errcode.ErrDramaPromptPresetNotFound
	}
	var out model.DramaPromptPresetView
	err := s.presets.WithTx(ctx, func(tx repository.DramaPromptPresetTx) error {
		group, err := tx.LockGroup(ctx, step)
		if err != nil {
			return err
		}
		row := &model.DramaPromptPreset{Step: step, Status: model.DramaPresetDisabled}
		if id != 0 {
			row, err = tx.Preset(ctx, step, id)
			if err != nil {
				return err
			}
		}
		before, defaultID := *row, group.DefaultID
		row.UpdatedBy = actor
		action, err := mutate(tx, group, row)
		if err != nil {
			return err
		}
		if action == "" || action == "default" {
			row.UpdatedBy = before.UpdatedBy
		}
		out = presetView(*row, true)
		if action == "" {
			return nil
		}
		return tx.InsertAudit(ctx, presetAudit(actor, action, before, *row, defaultID, group.DefaultID))
	})
	if errors.Is(err, repository.ErrNotFound) {
		return nil, errcode.ErrDramaPromptPresetNotFound
	}
	if errors.Is(err, repository.ErrDuplicate) {
		return nil, errcode.ErrDramaPromptInvalid
	}
	return &out, err
}

// presetAudit 保存可追踪的变更元信息，不把正文复制到审计日志。
func presetAudit(actor uint64, action string, before, after model.DramaPromptPreset, oldDefault, newDefault uint64) *model.AdminAuditLog {
	detail, _ := json.Marshal(map[string]any{"step": after.Step, "old_revision": before.Revision, "new_revision": after.Revision,
		"old_status": before.Status, "new_status": after.Status, "old_default_id": idcodec.Encode(oldDefault), "new_default_id": idcodec.Encode(newDefault)})
	return &model.AdminAuditLog{ActorID: actor, Action: "drama_preset." + action, TargetType: "drama_preset", TargetID: after.ID, DetailJSON: model.JSONText(detail)}
}
