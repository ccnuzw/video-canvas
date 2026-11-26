package script

import "fmt"

// Merge 把整集重写的新解析结果合并进旧结构（重新生成、Agent 改剧本、粘贴覆盖时用），尽量保留用户手动加的信息：
//  1. 场次以「内外景 + 时间 + 地点」为键配对，不要求顺序一致；配上的沿用场次 ID、短标题、梗概、情绪；
//  2. 场内非备注元素按 (类型, 说话人, 文本) 做最长公共子序列，没变的沿用 ID；夹在中间、类型和说话人相同的按顺序配成「修改」；
//  3. 备注不在新文本里，按它原来紧挨着的前一个元素挂回去，不会夹在角色行和对白之间；整场被删的备注移到第一场开头并警告。
//
// 新场次和新元素的 ID 为 0，由调用方落库时分配。
func Merge(old, neu []Scene) ([]Scene, Stats, []Warning) {
	var stats Stats
	used := make([]bool, len(old))
	out := make([]Scene, len(neu))
	for i, ns := range neu {
		oi := findScene(old, used, ns)
		if oi < 0 {
			out[i] = ns
			stats.Added += len(ns.Elements)
			continue
		}
		used[oi] = true
		out[i] = mergeScene(old[oi], ns, &stats)
	}
	lost := 0
	for oi, os := range old {
		if !used[oi] {
			stats.Deleted += countNonNotes(os.Elements)
		}
		lost += placeNotes(os, used[oi], out, &stats)
	}
	var warns []Warning
	if lost > 0 {
		warns = append(warns, Warning{Message: fmt.Sprintf("%d 条备注的原位置已删除，已移到第一场开头", lost)})
	}
	return out, stats, warns
}

func sceneKey(s Scene) [3]any { return [3]any{s.IntExt, s.TimeLabel, s.LocationID} }

func findScene(old []Scene, used []bool, ns Scene) int {
	for i, os := range old {
		if !used[i] && sceneKey(os) == sceneKey(ns) {
			return i
		}
	}
	return -1
}

func countNonNotes(els []Element) int {
	n := 0
	for _, e := range els {
		if e.Type != Note {
			n++
		}
	}
	return n
}

// mergeScene 沿用旧场次的 ID 和场次信息，元素按 LCS 合并。
func mergeScene(os, ns Scene, stats *Stats) Scene {
	var oldEls []Element
	for _, e := range os.Elements {
		if e.Type != Note {
			oldEls = append(oldEls, e)
		}
	}
	ns.ID, ns.Title, ns.Summary, ns.Emotions = os.ID, os.Title, os.Summary, os.Emotions
	ns.Elements = mergeElements(oldEls, ns.Elements, stats)
	return ns
}

func elementKey(e Element) [3]any { return [3]any{e.Type, e.CharacterID, e.Text} }

// mergeElements 返回沿用了旧 ID 的新元素列表，并累计统计。
func mergeElements(oldEls, newEls []Element, stats *Stats) []Element {
	out := append([]Element(nil), newEls...)
	pairs := lcsPairs(oldEls, newEls)
	usedOld := make([]bool, len(oldEls))
	matched := make([]bool, len(newEls))
	for _, p := range pairs {
		out[p[1]].ID = oldEls[p[0]].ID
		usedOld[p[0]], matched[p[1]] = true, true
		stats.Kept++
	}
	bounds := append(append([][2]int{{-1, -1}}, pairs...), [2]int{len(oldEls), len(newEls)})
	for k := 0; k+1 < len(bounds); k++ {
		pairGap(oldEls, out, usedOld, matched, bounds[k], bounds[k+1], stats)
	}
	for j := range out {
		if !matched[j] {
			out[j].ID = 0
			stats.Added++
		}
	}
	for i := range oldEls {
		if !usedOld[i] {
			stats.Deleted++
		}
	}
	return out
}

// pairGap 在两个相同元素之间，把类型和说话人一致的旧、新元素按顺序配成「修改」，沿用旧 ID。
func pairGap(oldEls, out []Element, usedOld, matched []bool, from, to [2]int, stats *Stats) {
	for j := from[1] + 1; j < to[1]; j++ {
		for i := from[0] + 1; i < to[0]; i++ {
			if usedOld[i] || oldEls[i].Type != out[j].Type || oldEls[i].CharacterID != out[j].CharacterID {
				continue
			}
			out[j].ID = oldEls[i].ID
			usedOld[i], matched[j] = true, true
			stats.Modified++
			break
		}
	}
}

// lcsPairs 返回按 elementKey 相等配成的 (旧下标, 新下标) 最长公共子序列。
func lcsPairs(a, b []Element) [][2]int {
	dp := make([][]int, len(a)+1)
	for i := range dp {
		dp[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if elementKey(a[i]) == elementKey(b[j]) {
				dp[i][j] = dp[i+1][j+1] + 1
			} else {
				dp[i][j] = max(dp[i+1][j], dp[i][j+1])
			}
		}
	}
	var pairs [][2]int
	for i, j := 0, 0; i < len(a) && j < len(b); {
		switch {
		case elementKey(a[i]) == elementKey(b[j]):
			pairs = append(pairs, [2]int{i, j})
			i++
			j++
		case dp[i+1][j] >= dp[i][j+1]:
			i++
		default:
			j++
		}
	}
	return pairs
}

// placeNotes 把旧场次里的备注挂回合并结果，返回因整场被删而移到第一场开头的条数。
func placeNotes(os Scene, matchedScene bool, out []Scene, stats *Stats) int {
	target := -1
	if matchedScene {
		for i := range out {
			if out[i].ID == os.ID {
				target = i
				break
			}
		}
	}
	lost, head := 0, 0
	for idx, e := range os.Elements {
		if e.Type != Note {
			continue
		}
		switch {
		case target >= 0:
			if !insertAfterAnchor(&out[target], os.Elements[:idx], e) {
				out[target].Elements = insertAt(out[target].Elements, head, e)
				head++
			}
		case len(out) > 0:
			out[0].Elements = insertAt(out[0].Elements, head, e)
			head++
			lost++
		default:
			continue
		}
		stats.Kept++
	}
	return lost
}

// insertAfterAnchor 找到备注前面最近一个仍存在的非备注元素，把备注插到它后面；
// 插入点后面是括号或对白时往后挪到这段说话结束，并排在已经挂在同一处的备注之后。找不到锚点返回 false。
func insertAfterAnchor(sc *Scene, before []Element, note Element) bool {
	for k := len(before) - 1; k >= 0; k-- {
		if before[k].Type == Note {
			continue
		}
		at := indexOfID(sc.Elements, before[k].ID)
		if at < 0 {
			continue
		}
		pos := at + 1
		for pos < len(sc.Elements) && (sc.Elements[pos].Type == Parenthetical || sc.Elements[pos].Type == Dialogue || sc.Elements[pos].Type == Note) {
			pos++
		}
		sc.Elements = insertAt(sc.Elements, pos, note)
		return true
	}
	return false
}

func indexOfID(els []Element, id uint64) int {
	if id == 0 {
		return -1
	}
	for i, e := range els {
		if e.ID == id {
			return i
		}
	}
	return -1
}

func insertAt(els []Element, pos int, e Element) []Element {
	els = append(els, Element{})
	copy(els[pos+1:], els[pos:])
	els[pos] = e
	return els
}
