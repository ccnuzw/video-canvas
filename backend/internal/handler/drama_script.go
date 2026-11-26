package handler

import (
	"github.com/gin-gonic/gin"

	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/response"
	"video-canvas/internal/service"
)

// GetScript 返回一集的结构化剧本（场次和元素）；整部剧还没转成结构时先转换。
func (h *DramaHandler) GetScript(c *gin.Context) {
	id, no, ok := dramaEpisodePath(c)
	if !ok {
		return
	}
	v, err := h.svc.GetScript(c.Request.Context(), currentUserID(c), id, no)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// PutScript 整集保存结构化剧本，带 revision 乐观锁。
func (h *DramaHandler) PutScript(c *gin.Context) {
	id, no, ok := dramaEpisodePath(c)
	if !ok {
		return
	}
	var req service.SaveDramaScriptReq
	if !BindJSON(c, &req) {
		return
	}
	v, err := h.svc.PutScript(c.Request.Context(), currentUserID(c), id, no, &req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// ParseScript 把一段文本解析成场次和元素（粘贴用），不保存剧本。
func (h *DramaHandler) ParseScript(c *gin.Context) {
	id, ok := CanvasPathID(c)
	if !ok {
		return
	}
	var req service.ParseDramaScriptReq
	if !BindJSON(c, &req) {
		return
	}
	v, err := h.svc.ParseScript(c.Request.Context(), currentUserID(c), id, &req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// entityPath 取短剧 ID 和人物 / 地点 ID，两者都是十六进制串。
func entityPath(c *gin.Context) (dramaID, entityID uint64, ok bool) {
	var uri struct {
		ID  string `uri:"id" binding:"required"`
		EID string `uri:"eid" binding:"required"`
	}
	if !bindURI(c, &uri) {
		return 0, 0, false
	}
	dramaID, ok1 := idcodec.Decode(uri.ID)
	entityID, ok2 := idcodec.Decode(uri.EID)
	if !ok1 || !ok2 {
		response.Fail(c, errcode.ErrInvalidParams.WithMsg("id 格式错误"))
		return 0, 0, false
	}
	return dramaID, entityID, true
}

// ListScriptEntities 返回人物表或地点表（kind 固定在路由注册处）。
func (h *DramaHandler) ListScriptEntities(kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := CanvasPathID(c)
		if !ok {
			return
		}
		v, err := h.svc.ListScriptEntities(c.Request.Context(), currentUserID(c), id, kind)
		if err != nil {
			response.Fail(c, err)
			return
		}
		response.OK(c, v)
	}
}

// CreateScriptEntity 手动新建人物或地点，返回 201。
func (h *DramaHandler) CreateScriptEntity(kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := CanvasPathID(c)
		if !ok {
			return
		}
		var req service.CreateDramaScriptEntityReq
		if !BindJSON(c, &req) {
			return
		}
		v, err := h.svc.CreateScriptEntity(c.Request.Context(), currentUserID(c), id, kind, &req)
		if err != nil {
			response.Fail(c, err)
			return
		}
		response.Created(c, v)
	}
}

// UpdateScriptEntity 部分更新人物或地点（改名、别名、备注、确认）。
func (h *DramaHandler) UpdateScriptEntity(kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, eid, ok := entityPath(c)
		if !ok {
			return
		}
		var req service.UpdateDramaScriptEntityReq
		if !BindJSON(c, &req) {
			return
		}
		v, err := h.svc.UpdateScriptEntity(c.Request.Context(), currentUserID(c), id, kind, eid, &req)
		if err != nil {
			response.Fail(c, err)
			return
		}
		response.OK(c, v)
	}
}

// DeleteScriptEntity 删除人物或地点，仍被剧本引用时返回 67032，成功返回 204。
func (h *DramaHandler) DeleteScriptEntity(kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, eid, ok := entityPath(c)
		if !ok {
			return
		}
		if err := h.svc.DeleteScriptEntity(c.Request.Context(), currentUserID(c), id, kind, eid); err != nil {
			response.Fail(c, err)
			return
		}
		response.NoContent(c)
	}
}
