package repository_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"video-canvas/internal/handler"
	"video-canvas/internal/middleware"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/utils"
	"video-canvas/internal/repository"
	"video-canvas/internal/router"
	"video-canvas/internal/service"
)

func TestCanvasShareHTTPScopedMedia(t *testing.T) {
	db, svc, _ := canvasSeed(t)
	const secret = "canvas-share-http-test-secret"
	handlers := router.Handlers{Health: &handler.HealthHandler{}, CanvasProject: handler.NewCanvasProjectHandler(service.NewCanvasProjectService(repository.NewCanvasProjectRepository(db))), CanvasShare: handler.NewCanvasShareHandler(svc), UserState: func(context.Context, uint64) (*middleware.UserState, error) {
		return &middleware.UserState{Status: "active", Role: "user", TokenVersion: 1}, nil
	}}
	engine := router.New("test", secret, handlers)
	send := func(method, path, body string, user uint64, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if user != 0 {
			token, _, err := utils.GenerateToken(uint(user), "", 1, secret, "test", 1)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w
	}
	canvas := "/canvas/" + idcodec.Encode(8)
	media := "/canvas-media/" + idcodec.Encode(8) + "/" + idcodec.Encode(10)
	if w := send("POST", canvas+"/shares", `{"mode":"view","email":"recv@test.example"}`, 42, nil); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := send("GET", canvas, "", 1, nil); w.Code != 404 {
		t.Fatal("普通详情未隔离", w.Code)
	}
	reader := send("GET", canvas+"/reader", "", 1, nil)
	cookies := reader.Result().Cookies()
	if reader.Code != 200 || len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("缺少限定作用域的媒体凭据", reader.Code)
	}
	if w := send("GET", media, "", 0, cookies[0]); w.Code != 200 || w.Body.String() != "sample" || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatal("媒体读取失败", w.Code)
	}
	if w := send("GET", "/canvas-media/"+idcodec.Encode(9)+"/"+idcodec.Encode(10), "", 0, cookies[0]); w.Code != 401 {
		t.Fatal("跨画布票据应失效", w.Code)
	}
	if w := send("DELETE", canvas+"/shares/"+idcodec.Encode(1), "", 42, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w := send("GET", media, "", 0, cookies[0]); w.Code != 404 {
		t.Fatal("已撤权的票据仍可读", w.Code)
	}
}
