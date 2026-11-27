package repository_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"video-canvas/internal/model"
	"video-canvas/internal/repository"
)

func TestDramaTimelineRepository_RevisionVersionAndAssets(t *testing.T) {
	db := isolatedDB(t, &model.DramaProject{}, &model.DramaEpisode{}, &model.DramaEpisodeTimeline{}, &model.Asset{})
	ctx := context.Background()
	p := model.DramaProject{UserID: 1, CanvasID: 9, Title: "剧", SourceText: "文", StyleKey: "real_city_film"}
	if err := db.Create(&p).Error; err != nil {
		t.Fatal(err)
	}
	ep := model.DramaEpisode{UserID: 1, DramaID: p.ID, No: 1}
	if err := db.Create(&ep).Error; err != nil {
		t.Fatal(err)
	}
	r := repository.NewDramaRepository(db)
	// 1. 没保存过：不存在
	if _, err := r.Timeline(ctx, 1, ep.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("未保存：%v", err)
	}
	// 2. 第一次保存：版本 1，集的片段版本自增
	row := &model.DramaEpisodeTimeline{UserID: 1, EpisodeID: ep.ID, Tracks: []byte(`[{"id":"main","kind":"main","name":"主轨","clips":[]}]`), RemovedSegmentIDs: []byte(`[]`), Imports: []byte(`[]`)}
	if err := r.SaveTimeline(ctx, row, 0); err != nil || row.Revision != 1 {
		t.Fatalf("首次保存：rev=%d %v", row.Revision, err)
	}
	// 3. 并发的另一次首次保存：唯一约束冲突按版本冲突处理
	dup := &model.DramaEpisodeTimeline{UserID: 1, EpisodeID: ep.ID, Tracks: []byte(`[]`), RemovedSegmentIDs: []byte(`[]`), Imports: []byte(`[]`)}
	if err := r.SaveTimeline(ctx, dup, 0); !errors.Is(err, repository.ErrStateConflict) {
		t.Fatalf("重复首次保存：%v", err)
	}
	// 4. 按版本更新；旧版本冲突；他人读不到
	row.Tracks = []byte(`[{"id":"main","kind":"main","name":"主轨","muted":true,"clips":[]}]`)
	if err := r.SaveTimeline(ctx, row, 1); err != nil || row.Revision != 2 {
		t.Fatalf("更新：rev=%d %v", row.Revision, err)
	}
	if err := r.SaveTimeline(ctx, row, 1); !errors.Is(err, repository.ErrStateConflict) {
		t.Fatalf("旧版本：%v", err)
	}
	got, err := r.Timeline(ctx, 1, ep.ID)
	if err != nil || !strings.Contains(string(got.Tracks), `"muted": true`) || got.Revision != 2 {
		t.Fatalf("读取：%+v %v", got, err)
	}
	if _, err := r.Timeline(ctx, 2, ep.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("他人时间线：%v", err)
	}
	var fresh model.DramaEpisode
	if err := db.First(&fresh, ep.ID).Error; err != nil || fresh.SegmentVersion != 2 {
		t.Fatalf("片段版本应随两次保存自增到 2：%d %v", fresh.SegmentVersion, err)
	}
	// 5. 素材只返回本人的
	mine := model.Asset{UserID: 1, Kind: "image", StorageKey: "a.png"}
	theirs := model.Asset{UserID: 2, Kind: "image", StorageKey: "b.png"}
	if err := db.Create(&mine).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&theirs).Error; err != nil {
		t.Fatal(err)
	}
	assets, err := r.TimelineAssets(ctx, 1, []uint64{mine.ID, theirs.ID})
	if err != nil || len(assets) != 1 || assets[0].ID != mine.ID {
		t.Fatalf("素材归属：%+v %v", assets, err)
	}
}
