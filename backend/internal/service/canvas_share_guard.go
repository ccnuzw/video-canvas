package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"video-canvas/internal/config"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/outbound"
)

// AgentCanvasDeliveryGuard 通过内部服务令牌申请画布级 Agent 交付租约。
func AgentCanvasDeliveryGuard(cfg config.Agent) CanvasDeliveryGuard {
	if !cfg.Enabled {
		return nil
	}
	client := outbound.Client("agent.canvas-delivery", &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }})
	return func(ctx context.Context, owner, canvas uint64) (func(), error) {
		nonce := rand.Text()
		send := func(ctx context.Context, action string) error {
			body, err := json.Marshal(map[string]string{"canvas": strconv.FormatUint(canvas, 10), "owner": strconv.FormatUint(owner, 10), "nonce": nonce, "action": action})
			if err != nil {
				return err
			}
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(cfg.URL, "/")+"/internal/v1/canvas-delivery", bytes.NewReader(body))
			if err != nil {
				return err
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Agent-Service-Token", cfg.ServiceToken)
			res, err := client.Do(req)
			if err != nil {
				return errcode.ErrCanvasDeliveryBusy.WithMsg("暂时无法确认 Agent 状态，请稍后重试")
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				return errcode.ErrCanvasDeliveryBusy
			}
			return nil
		}
		if err := send(ctx, "acquire"); err != nil {
			return nil, err
		}
		return func() { _ = send(context.WithoutCancel(ctx), "release") }, nil
	}
}
