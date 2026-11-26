package drama_test

import (
	"context"
	"errors"
	"io/fs"
	"regexp"
	"strconv"
	"strings"
	"testing"

	. "video-canvas/internal/drama"
	"video-canvas/migrations"
)

// fakeCatalog 构造一个目录快照，enabled 里的键是 EnabledKey(kind, key)。
func fakeCatalog(enabled map[string]bool) Catalog {
	c := Catalog{
		Genres:  []Genre{{Key: "suspense", Name: "悬疑推理"}},
		Styles:  []Style{{Key: "real_city_film", Name: "真人都市电影", Prompt: "都市电影质感", PreviewURL: "/p/a.webp"}},
		Enabled: make(map[string]bool, len(enabled)),
	}
	for k, v := range enabled {
		c.Enabled[k] = v
	}
	return c
}

// useCatalogSource 注入一个临时目录源，测试结束恢复成内置。
func useCatalogSource(t *testing.T, load func(context.Context) (Catalog, error)) {
	t.Helper()
	SetCatalogSource(load)
	t.Cleanup(func() { SetCatalogSource(nil) })
}

// TestCatalogSourceFiltersDisabled 检查注入后的目录只把启用项吐给开拍设置，停用项仍算「存在」。
func TestCatalogSourceFiltersDisabled(t *testing.T) {
	useCatalogSource(t, func(context.Context) (Catalog, error) {
		return fakeCatalog(map[string]bool{
			EnabledKey("genre", "suspense"):         true,
			EnabledKey("style", "real_city_film"):   false, // 运营停用了这条画风
			EnabledKey("style", "another_disabled"): false,
		}), nil
	})

	view := Styles()
	if len(view.Styles) != 0 {
		t.Fatalf("停用的画风不应出现在可选清单里：%+v", view.Styles)
	}
	if len(view.Genres) != 1 || view.Genres[0].Key != "suspense" {
		t.Fatalf("启用的题材应保留：%+v", view.Genres)
	}
	// 停用不等于不存在：老项目保存其它字段时靠它放行
	if !StyleKnown("real_city_film") {
		t.Fatal("停用的画风仍应被 StyleKnown 认作存在")
	}
	if !StyleKnown("another_disabled") {
		t.Fatal("目录里有、但没有启用标记的条目也应算存在")
	}
	if StyleKnown("never_existed") {
		t.Fatal("目录里没有的画风不应被认作存在")
	}
}

// TestCatalogInvalidate 检查后台写入后 InvalidateCatalog 能立刻让新数据生效。
func TestCatalogInvalidate(t *testing.T) {
	toggle := false
	useCatalogSource(t, func(context.Context) (Catalog, error) {
		if toggle {
			return fakeCatalog(map[string]bool{EnabledKey("style", "real_city_film"): true}), nil
		}
		return fakeCatalog(map[string]bool{EnabledKey("style", "real_city_film"): false}), nil
	})

	if len(Styles().Styles) != 0 {
		t.Fatal("第一版目录里画风是停用的")
	}
	toggle = true
	// 没失效前仍读缓存
	if len(Styles().Styles) != 0 {
		t.Fatal("TTL 内不应重新加载")
	}
	InvalidateCatalog()
	if got := Styles().Styles; len(got) != 1 || got[0].PreviewURL != "/p/a.webp" {
		t.Fatalf("失效后应读到新目录（含 preview_url）：%+v", got)
	}
}

// TestCatalogFallback 检查加载失败与空目录都回落内置，保证开拍不会没有画风可选。
func TestCatalogFallback(t *testing.T) {
	useCatalogSource(t, func(context.Context) (Catalog, error) {
		return Catalog{}, errors.New("数据库不可用")
	})
	if len(Styles().Styles) == 0 {
		t.Fatal("加载失败时应回落内置目录")
	}

	useCatalogSource(t, func(context.Context) (Catalog, error) { return Catalog{}, nil })
	if len(Styles().Styles) == 0 {
		t.Fatal("目录为空（迁移没跑 / 条目被删光）时应回落内置目录")
	}
}

// seedRow 是迁移 0049 里的一行种子。
type seedRow struct {
	kind, key, name, prompt, previewURL string
	sort                                int
}

// 一行形如 ('style', 'key', '名称', '描述', '预览地址', 3, true, true)：
// 末尾两列是 enabled / is_builtin，种子恒为 true，但解析时允许缺省，免得以后加列又要改这里。
var seedRowPattern = regexp.MustCompile(`\('(genre|style)', '([a-z0-9_]+)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+)(?:, (?:true|false), (?:true|false))?\)`)

// TestSeedMatchesBuiltin 保证迁移种子与编译期内置目录逐字一致。
//
// styles.json 现在是「种子来源 + 空表兜底」：两边一旦漂移，空库部署与正常部署会给出不同的画风，
// 而且没人会立刻发现。这条测试把两边钉死。
func TestSeedMatchesBuiltin(t *testing.T) {
	raw, err := fs.ReadFile(migrations.FS, "0049_drama_presets.sql")
	if err != nil {
		t.Fatal(err)
	}
	var rows []seedRow
	for _, m := range seedRowPattern.FindAllStringSubmatch(string(raw), -1) {
		sort, err := strconv.Atoi(m[6])
		if err != nil {
			t.Fatalf("解析 sort_order 失败：%v", err)
		}
		rows = append(rows, seedRow{
			kind: m[1], key: m[2],
			name:       strings.ReplaceAll(m[3], "''", "'"),
			prompt:     strings.ReplaceAll(m[4], "''", "'"),
			previewURL: strings.ReplaceAll(m[5], "''", "'"),
			sort:       sort,
		})
	}
	if len(rows) == 0 {
		t.Fatal("迁移里没有解析到任何种子行")
	}

	view := Styles() // 内置目录全部启用，等于内置清单本身
	if len(rows) != len(view.Genres)+len(view.Styles) {
		t.Fatalf("种子 %d 行，内置目录 %d 条，数量不一致", len(rows), len(view.Genres)+len(view.Styles))
	}
	genres := map[string]Genre{}
	for _, g := range view.Genres {
		genres[g.Key] = g
	}
	styles := map[string]Style{}
	for _, s := range view.Styles {
		styles[s.Key] = s
	}
	for i, row := range rows {
		switch row.kind {
		case "genre":
			g, ok := genres[row.key]
			if !ok || g.Name != row.name {
				t.Fatalf("第 %d 行题材与内置不一致：种子 %+v，内置 %+v", i+1, row, g)
			}
			if row.prompt != "" || row.previewURL != "" {
				t.Fatalf("题材不应带描述或预览图：%+v", row)
			}
		case "style":
			s, ok := styles[row.key]
			if !ok || s.Name != row.name || s.Prompt != row.prompt || s.PreviewURL != row.previewURL {
				t.Fatalf("第 %d 行画风与内置不一致：\n种子 %+v\n内置 %+v", i+1, row, s)
			}
		}
	}
}
