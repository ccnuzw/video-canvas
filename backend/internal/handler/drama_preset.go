package handler

import (
	"github.com/gin-gonic/gin"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/response"
)

// PromptPresetCatalog 返回登录用户可选择的内置模板目录。
func (h *DramaHandler) PromptPresetCatalog(c *gin.Context) { h.presetCatalog(c, false) }

// AdminPromptPresetCatalog 返回含正文和状态的内置模板管理目录。
func (h *DramaHandler) AdminPromptPresetCatalog(c *gin.Context) { h.presetCatalog(c, true) }

func (h *DramaHandler) presetCatalog(c *gin.Context, admin bool) {
	items, err := h.svc.PromptPresetCatalog(c.Request.Context(), admin)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, gin.H{"items": items})
}

// CreatePromptPreset 新建尚未启用的内置模板。
func (h *DramaHandler) CreatePromptPreset(c *gin.Context) { h.savePromptPreset(c, 0) }

// UpdatePromptPreset 按版本保存内置模板。
func (h *DramaHandler) UpdatePromptPreset(c *gin.Context) {
	if id, ok := CanvasPathID(c); ok {
		h.savePromptPreset(c, id)
	}
}

func (h *DramaHandler) savePromptPreset(c *gin.Context, id uint64) {
	var req model.SaveDramaPromptPresetReq
	if !BindJSON(c, &req) {
		return
	}
	item, err := h.svc.SavePromptPreset(c.Request.Context(), currentUserID(c), id, c.Param("step"), req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	if id == 0 {
		response.Created(c, item)
		return
	}
	response.OK(c, item)
}

// SetPromptPresetState 启停、归档模板或设为分类默认。
func (h *DramaHandler) SetPromptPresetState(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	var req model.UpdateDramaPromptPresetStateReq
	if !BindJSON(c, &req) {
		return
	}
	item, err := h.svc.SetPromptPresetState(c.Request.Context(), currentUserID(c), id, c.Param("step"), req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, item)
}
