package canvasdoc_test

import (
	"encoding/json"
	"strings"
	"testing"

	"video-canvas/internal/canvasdoc"
)

func TestProjectSharedCanvas_RemovesPrivateStateAndRewritesMedia(t *testing.T) {
	raw := []byte(`{"title":"board","chatSessions":[{"id":"private"}],"nodes":[{"id":"n1","type":"canvas","position":{"x":4,"y":8},"data":{"assetId":"123","src":"/files/u1/a.png","taskId":"987","pendingTaskIds":["988"],"params":{"voiceTaskId":"989"},"text":"prompt"}}],"edges":[],"viewport":{"x":1,"y":2,"zoom":1.5}}`)
	got, err := canvasdoc.ProjectShared(raw, func(id string) string { return "/api/v1/canvas/shared/media/" + id })
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(got, &payload); err != nil {
		t.Fatal(err)
	}
	if _, ok := payload["chatSessions"]; ok {
		t.Fatal("共享 payload 不应包含私有会话")
	}
	node := payload["nodes"].([]any)[0].(map[string]any)
	data := node["data"].(map[string]any)
	if data["src"] != "/api/v1/canvas/shared/media/123" || data["text"] != "prompt" {
		t.Fatalf("媒体地址应代理化且创作内容应保留: %#v", data)
	}
	for _, key := range []string{"taskId", "pendingTaskIds"} {
		if _, ok := data[key]; ok {
			t.Errorf("共享 payload 不应包含 %s", key)
		}
	}
	params := data["params"].(map[string]any)
	if _, ok := params["voiceTaskId"]; ok {
		t.Error("嵌套任务引用也应剔除")
	}
	if payload["viewport"].(map[string]any)["zoom"] != 1.5 {
		t.Error("画布布局应保留")
	}
}

func TestProjectSharedCanvas_RejectsInvalidPayload(t *testing.T) {
	if _, err := canvasdoc.ProjectShared([]byte(`[]`), func(string) string { return "" }); err == nil {
		t.Fatal("非法画布结构应返回错误")
	}
}

func TestProjectSharedCanvasTextWithDirectoryName(t *testing.T) {
	raw := []byte(`{"nodes":[{"type":"canvas","data":{"kind":"script","text":"说明 /files/ 目录的用途"}}]}`)
	got, err := canvasdoc.ProjectShared(raw, func(string) string { return "" })
	if err != nil || !strings.Contains(string(got), "说明 /files/ 目录的用途") {
		t.Fatal(string(got), err)
	}
}

func TestProjectSharedCanvasNamedParamAsset(t *testing.T) {
	raw := []byte(`{"nodes":[{"id":"n","type":"canvas","data":{"params":{"mask":"23"},"paramAssets":{"mask":{"url":"/files/private"}}}}]}`)
	got, err := canvasdoc.ProjectShared(raw, func(id string) string { return "/reader/" + id })
	if err != nil || !strings.Contains(string(got), `"url":"/reader/23"`) {
		t.Fatalf("命名素材参数未映射: %s %v", got, err)
	}
}
