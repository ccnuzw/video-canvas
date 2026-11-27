package handler_test

import (
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
)

func TestDramaTimelineHandler_Contracts(t *testing.T) {
	r, repo := segmentHTTP()
	chosen, canvas := uint64(101), uint64(9)
	repo.Rows = []model.DramaSegment{{BaseModel: model.BaseModel{ID: 1}, UserID: 1, EpisodeID: 10, Seq: 0, Seconds: 15, ChosenTaskID: &chosen, Revision: 1}}
	repo.Tasks = []model.GenerationTask{{ID: 101, UserID: 1, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(1), Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: []byte(`[{"asset_id":501,"media_type":"video"}]`)}}
	repo.Library = []model.Asset{{ID: 501, UserID: 1, Kind: "video", DurationMs: 15000}}
	path := "/dramas/" + idcodec.Encode(7) + "/episodes/1/timeline"
	clip := `{"id":"a","kind":"segment","segment_id":"` + idcodec.Encode(1) + `","task_id":"` + idcodec.Encode(101) + `","in_ms":1000,"out_ms":9000,"volume":100}`
	tracks := func(clips string) string {
		return `[{"id":"main","kind":"main","name":"主轨","clips":[` + clips + `]}]`
	}
	for _, tc := range []struct {
		name, method, body string
		status, code       int
	}{
		{"读取默认时间线", "GET", "", 200, 0},
		{"第一次保存", "PUT", `{"revision":0,"tracks":` + tracks(clip) + `}`, 200, 0},
		{"旧版本冲突", "PUT", `{"revision":0,"tracks":` + tracks(clip) + `}`, 409, errcode.ErrDramaTimelineConflict.Code},
		{"没有主轨", "PUT", `{"revision":1,"tracks":[{"id":"t1","kind":"text","clips":[]}]}`, 400, errcode.ErrDramaTimelineInvalid.Code},
		{"版本为负", "PUT", `{"revision":-1,"tracks":[]}`, 400, 10001},
		{"ID 不是编码串", "PUT", `{"revision":1,"tracks":` + tracks(`{"id":"a","kind":"segment","segment_id":1}`) + `}`, 400, 10001},
		{"内容不合法", "PUT", `{"revision":1,"tracks":` + tracks(`{"id":"a","kind":"segment","segment_id":"`+idcodec.Encode(1)+`","task_id":"`+idcodec.Encode(101)+`","in_ms":0,"out_ms":100}`) + `}`, 400, errcode.ErrDramaTimelineInvalid.Code},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := characterCall(t, r, tc.method, path, tc.body)
			if status != tc.status || responseCode(t, body) != tc.code {
				t.Fatalf("status=%d body=%+v", status, body)
			}
		})
	}
	_, body := characterCall(t, r, "GET", path, "")
	data := responseData(t, body)
	saved := data["tracks"].([]any)
	main := saved[0].(map[string]any)
	if data["revision"].(float64) != 1 || len(saved) != 1 || len(main["clips"].([]any)) != 1 {
		t.Fatalf("保存后读取 %+v", data)
	}
	if first := main["clips"].([]any)[0].(map[string]any); first["volume"].(float64) != 100 || first["start_ms"].(float64) != 0 {
		t.Fatalf("数字字段应始终序列化：%+v", first)
	}
}

// 素材 ID 和素材接口、画布节点一致，是原始数字（不是编码串）：保存时收数字，读取时也返回数字，
// 和同一个响应里 assets 的 id 对得上。
func TestDramaTimelineHandler_AssetIDsAreRawNumbers(t *testing.T) {
	r, repo := segmentHTTP()
	chosen, canvas := uint64(101), uint64(9)
	repo.Rows = []model.DramaSegment{{BaseModel: model.BaseModel{ID: 1}, UserID: 1, EpisodeID: 10, Seq: 0, Seconds: 15, ChosenTaskID: &chosen, Revision: 1}}
	repo.Tasks = []model.GenerationTask{{ID: 101, UserID: 1, CanvasProjectID: &canvas, NodeID: "seg:" + idcodec.Encode(1), Kind: model.KindVideo, Status: model.TaskSucceeded, OutputJSON: []byte(`[{"asset_id":501,"media_type":"video"}]`)}}
	repo.Library = []model.Asset{{ID: 501, UserID: 1, Kind: "video", DurationMs: 15000}, {ID: 1036, UserID: 1, Kind: "image"}}
	path := "/dramas/" + idcodec.Encode(7) + "/episodes/1/timeline"
	segment := `{"id":"a","kind":"segment","segment_id":"` + idcodec.Encode(1) + `","task_id":"` + idcodec.Encode(101) + `","in_ms":0,"out_ms":9000,"volume":100}`
	image := `{"id":"b","kind":"asset","asset_id":1036,"media":"image","in_ms":0,"out_ms":3000,"volume":100}`
	body := `{"revision":0,"tracks":[{"id":"main","kind":"main","name":"主轨","clips":[` + segment + `,` + image + `]}],"imports":[1036]}`
	status, resp := characterCall(t, r, "PUT", path, body)
	if status != 200 {
		t.Fatalf("原始数字的素材 ID 应能保存：status=%d body=%+v", status, resp)
	}
	data := responseData(t, resp)
	clips := data["tracks"].([]any)[0].(map[string]any)["clips"].([]any)
	if id := clips[1].(map[string]any)["asset_id"]; id != float64(1036) {
		t.Fatalf("返回的素材 ID 应是原始数字 1036，得到 %#v", id)
	}
	if imports := data["imports"].([]any); len(imports) != 1 || imports[0] != float64(1036) {
		t.Fatalf("已导入应是原始数字：%#v", data["imports"])
	}
}
