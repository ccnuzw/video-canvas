package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/logger"
	"video-canvas/internal/pkg/response"
	"video-canvas/internal/service"
	"video-canvas/internal/storage"
)

// 预览图上传的请求体上限：2MB 图片 + 一段 multipart 头尾余量。
const dramaPresetPreviewOverhead = 1 << 20

// DramaPresetHandler 处理开拍设置预设：后台维护（/admin/drama-presets/*）与公开预览图（/drama-presets/previews/*）。
// 后台读写都是 admin 或 super_admin（由路由挂载保证）；预览图不鉴权，靠 key 不可猜测，与 /files 同一套做法。
type DramaPresetHandler struct {
	svc *service.DramaPresetService
}

// NewDramaPresetHandler 创建预设 handler。
func NewDramaPresetHandler(svc *service.DramaPresetService) *DramaPresetHandler {
	return &DramaPresetHandler{svc: svc}
}

// AdminList 返回后台某个种类的全部预设（含停用），每条带引用数（GET /admin/drama-presets?kind=style）。
func (h *DramaPresetHandler) AdminList(c *gin.Context) {
	v, err := h.svc.AdminList(c.Request.Context(), c.Query("kind"))
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// Create 新建一条预设（POST /admin/drama-presets）。
func (h *DramaPresetHandler) Create(c *gin.Context) {
	var req model.SaveDramaPresetReq
	if !BindJSON(c, &req) {
		return
	}
	v, err := h.svc.Create(c.Request.Context(), currentUserID(c), &req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// Update 修改名称 / 描述 / 预览图地址（PUT /admin/drama-presets/:id）。
func (h *DramaPresetHandler) Update(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var req model.UpdateDramaPresetReq
	if !BindJSON(c, &req) {
		return
	}
	v, err := h.svc.Update(c.Request.Context(), currentUserID(c), id, &req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// SetEnabled 启用或停用一条预设（PUT /admin/drama-presets/:id/enabled）。
func (h *DramaPresetHandler) SetEnabled(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var req model.SetDramaPresetEnabledReq
	if !BindJSON(c, &req) {
		return
	}
	v, err := h.svc.SetEnabled(c.Request.Context(), currentUserID(c), id, *req.Enabled)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, v)
}

// Reorder 按给定的 id 顺序重排某个种类的全部预设（PUT /admin/drama-presets/order）。
func (h *DramaPresetHandler) Reorder(c *gin.Context) {
	var req model.ReorderDramaPresetsReq
	if !BindJSON(c, &req) {
		return
	}
	if err := h.svc.Reorder(c.Request.Context(), currentUserID(c), req.Kind, req.IDs); err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, nil)
}

// Delete 删除一条预设（DELETE /admin/drama-presets/:id）；有短剧在用只允许停用。
func (h *DramaPresetHandler) Delete(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), currentUserID(c), id); err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, nil)
}

// UploadPreview 上传 / 替换一条画风的预览图（POST /admin/drama-presets/:id/preview）。
func (h *DramaPresetHandler) UploadPreview(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	// 1. 限制请求体：声明的长度已超限就不必读；读取时超限由 MaxBytesReader 报错
	maxBody := int64(service.DramaPresetPreviewMaxBytes + dramaPresetPreviewOverhead)
	if c.Request.ContentLength > maxBody {
		response.Fail(c, errcode.ErrDramaPresetFileLarge)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)

	// 2. 流式读取 multipart，找到 file 字段交给 service（不先缓存整个请求体）
	mr, err := c.Request.MultipartReader()
	if err != nil {
		response.Fail(c, errcode.ErrInvalidParams.WithMsg("请使用 multipart/form-data 上传文件"))
		return
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			response.Fail(c, errcode.ErrInvalidParams.WithMsg("请选择要上传的预览图（字段名 file）"))
			return
		}
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				response.Fail(c, errcode.ErrDramaPresetFileLarge)
				return
			}
			response.Fail(c, errcode.ErrInvalidParams.WithMsg("上传中断或读取文件失败，请重试"))
			return
		}
		if part.FormName() != assetFormField || part.FileName() == "" {
			_ = part.Close()
			continue // 跳过其他字段
		}
		v, err := h.svc.UploadPreview(c.Request.Context(), currentUserID(c), id, part)
		_ = part.Close()
		if err != nil {
			response.Fail(c, err)
			return
		}
		response.OK(c, v)
		return
	}
}

// Preview 提供画风预览图（GET /drama-presets/previews/*filepath，不鉴权）。
//
// 地址永不过期：本地存储由后端直出，对象存储现签名后 302。
// 与 /files 的差别只有一处 —— 图的归属是「预设」而不是「素材」，所以按 preview_key 反查存储。
func (h *DramaPresetHandler) Preview(c *gin.Context) {
	name := strings.TrimPrefix(c.Param("filepath"), "/")
	key := service.DramaPresetPreviewObjectKey(name)
	target, err := h.svc.PreviewTarget(c.Request.Context(), key)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			c.AbortWithStatus(e.HTTPStatus())
			return
		}
		logger.Error("解析预设预览图失败", zap.String("key", key), zap.Error(err))
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	if target.Local != nil {
		// storage.FileServer 从 c.Param("filepath") 取对象 key，这里把路由参数换成完整 key（含目录前缀），
		// 这样本地直出、Range、长缓存都沿用素材那套实现
		c.Params = gin.Params{{Key: "filepath", Value: key}}
		storage.FileServer(target.Local)(c)
		return
	}

	// 跳转可以缓存一小段时间（不超过签名有效期的 1/4）；no-referrer 避免把站点地址带给存储服务商
	c.Writer.Header().Set("Cache-Control", "private, max-age="+strconv.Itoa(int(target.MaxAge.Seconds())))
	c.Writer.Header().Set("Referrer-Policy", "no-referrer")
	c.Redirect(http.StatusFound, target.RedirectURL)
}
