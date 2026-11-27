package handler

import (
	"github.com/gin-gonic/gin"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/response"
)

// Timeline 返回分集对账后的粗剪时间线；没保存过返回默认时间线（revision 为 0）。
func (h *DramaSegmentHandler) Timeline(c *gin.Context) {
	id, no, ok := dramaEpisodePath(c)
	if !ok {
		return
	}
	v, err := h.svc.Timeline(c.Request.Context(), currentUserID(c), id, no)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// SaveTimeline 按revision保存整份时间线，返回对账后的最新时间线。
func (h *DramaSegmentHandler) SaveTimeline(c *gin.Context) {
	id, no, ok := dramaEpisodePath(c)
	if !ok {
		return
	}
	var req model.SaveDramaTimelineReq
	if !BindJSON(c, &req) {
		return
	}
	v, err := h.svc.SaveTimeline(c.Request.Context(), currentUserID(c), id, no, &req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}
