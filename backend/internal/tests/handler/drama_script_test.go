package handler_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"video-canvas/internal/pkg/idcodec"
)

func dataOf(t *testing.T, resp map[string]any) map[string]any {
	t.Helper()
	d, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("响应缺少 data：%+v", resp)
	}
	return d
}

func TestDramaScriptHandler_Flow(t *testing.T) {
	r := httpDramaRouter()
	base := "/dramas/" + idcodec.Encode(7)
	script := base + "/episodes/1/script"

	// 读：整部剧第一次读时转换，「正文」变成一个动作元素
	status, resp := characterCall(t, r, "GET", script, "")
	if status != 200 || responseCode(t, resp) != 0 {
		t.Fatalf("GET script: %d %+v", status, resp)
	}
	view := dataOf(t, resp)
	scenes := view["scenes"].([]any)
	if len(scenes) != 1 || len(scenes[0].(map[string]any)["elements"].([]any)) != 1 {
		t.Fatalf("转换结果：%+v", view)
	}
	revision := int(view["revision"].(float64))

	// 新建人物，再整集保存一段带对白的剧本
	status, resp = characterCall(t, r, "POST", base+"/script-characters", `{"name":"林骁","aliases":["林川"]}`)
	if status != 201 {
		t.Fatalf("POST 人物: %d %+v", status, resp)
	}
	cid := dataOf(t, resp)["id"].(string)
	put := fmt.Sprintf(`{"revision":%d,"scenes":[{"int_ext":"exterior","time_label":"夜","title":"码头","elements":[{"type":"action","text":"雨。"},{"type":"character","character_id":%q},{"type":"dialogue","text":"走。"}]}]}`, revision, cid)
	status, resp = characterCall(t, r, "PUT", script, put)
	if status != 200 {
		t.Fatalf("PUT script: %d %+v", status, resp)
	}
	saved := dataOf(t, resp)
	if int(saved["revision"].(float64)) != revision+1 {
		t.Fatalf("保存后 revision 应 +1：%+v", saved)
	}

	// 参数校验失败：缺 revision、元素类型不认识 → 400 + 10001
	for name, body := range map[string]string{
		"缺 revision": `{"scenes":[]}`,
		"未知元素类型":     fmt.Sprintf(`{"revision":%d,"scenes":[{"elements":[{"type":"bogus","text":"x"}]}]}`, revision+1),
		"画外音标记不合法":   fmt.Sprintf(`{"revision":%d,"scenes":[{"elements":[{"type":"character","character_id":%q,"extension":"XX"}]}]}`, revision+1, cid),
	} {
		if status, resp = characterCall(t, r, "PUT", script, body); status != 400 || responseCode(t, resp) != 10001 {
			t.Fatalf("%s：%d %+v", name, status, resp)
		}
	}

	// 业务错误：旧 revision → 409；对白无说话人 → 67043
	if status, resp = characterCall(t, r, "PUT", script, put); status != 409 || responseCode(t, resp) != 30002 {
		t.Fatalf("旧 revision：%d %+v", status, resp)
	}
	orphan := fmt.Sprintf(`{"revision":%d,"scenes":[{"elements":[{"type":"dialogue","text":"x"}]}]}`, revision+1)
	if status, resp = characterCall(t, r, "PUT", script, orphan); status != 400 || responseCode(t, resp) != 67043 {
		t.Fatalf("对白无说话人：%d %+v", status, resp)
	}

	// 人物表：被引用的不能删（67044）、重名（67045）、列表带出现集号
	if status, resp = characterCall(t, r, "DELETE", base+"/script-characters/"+cid, ""); status != 409 || responseCode(t, resp) != 67044 {
		t.Fatalf("删除被引用人物：%d %+v", status, resp)
	}
	if status, resp = characterCall(t, r, "POST", base+"/script-characters", `{"name":"林川"}`); status != 409 || responseCode(t, resp) != 67045 {
		t.Fatalf("别名重名：%d %+v", status, resp)
	}
	if status, resp = characterCall(t, r, "PATCH", base+"/script-characters/"+cid, `{"name":"林晓"}`); status != 200 {
		t.Fatalf("改名：%d %+v", status, resp)
	}
	status, resp = characterCall(t, r, "GET", base+"/script-characters", "")
	list, _ := json.Marshal(resp["data"])
	if status != 200 || len(list) == 0 {
		t.Fatalf("列表：%d %s", status, list)
	}
}

func TestDramaScriptHandler_ParseAndNotFound(t *testing.T) {
	r := httpDramaRouter()
	base := "/dramas/" + idcodec.Encode(7)
	if status, resp := characterCall(t, r, "POST", base+"/script/parse", `{"text":""}`); status != 400 || responseCode(t, resp) != 10001 {
		t.Fatalf("空文本：%d %+v", status, resp)
	}
	status, resp := characterCall(t, r, "POST", base+"/script/parse", `{"text":"1-1 夜/外 · 天台\n护士：林先生！"}`)
	if status != 200 || len(dataOf(t, resp)["scenes"].([]any)) != 1 {
		t.Fatalf("解析：%d %+v", status, resp)
	}
	for _, path := range []string{"/dramas/" + idcodec.Encode(8) + "/episodes/1/script", base + "/episodes/9/script"} {
		if status, resp = characterCall(t, r, "GET", path, ""); status != 404 || responseCode(t, resp) != 67001 {
			t.Fatalf("%s：%d %+v", path, status, resp)
		}
	}
	if status, resp = characterCall(t, r, "PATCH", base+"/script-characters/not-hex", `{"name":"x"}`); status != 400 || responseCode(t, resp) != 10001 {
		t.Fatalf("坏 id：%d %+v", status, resp)
	}
}
