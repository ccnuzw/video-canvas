package service

import (
	"context"

	"video-canvas/internal/drama"
	"video-canvas/internal/model"
)

// DramaPresetSource 是目录加载需要的只读能力，由 repository.DramaPresetRepository 实现。
// 只取一次全量（含停用）：启用项做可选清单，停用项用于「画风是否还存在」的判断。
type DramaPresetSource interface {
	List(ctx context.Context) ([]model.DramaPreset, error)
}

// LoadDramaCatalog 把 drama_presets 的全量条目转成目录快照，供 internal/drama 的进程内缓存使用。
func LoadDramaCatalog(ctx context.Context, src DramaPresetSource) (drama.Catalog, error) {
	rows, err := src.List(ctx)
	if err != nil {
		return drama.Catalog{}, err
	}
	catalog := drama.Catalog{
		Genres:  make([]drama.Genre, 0, len(rows)),
		Styles:  make([]drama.Style, 0, len(rows)),
		Enabled: make(map[string]bool, len(rows)),
	}
	for _, row := range rows {
		catalog.Enabled[drama.EnabledKey(row.Kind, row.Key)] = row.Enabled
		switch row.Kind {
		case model.DramaPresetKindGenre:
			catalog.Genres = append(catalog.Genres, drama.Genre{Key: row.Key, Name: row.Name})
		case model.DramaPresetKindStyle:
			catalog.Styles = append(catalog.Styles, drama.Style{
				Key:        row.Key,
				Name:       row.Name,
				Prompt:     row.Prompt,
				PreviewURL: row.PreviewURL,
			})
		}
	}
	return catalog, nil
}
