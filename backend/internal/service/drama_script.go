package service

import (
	"context"
	"errors"
	"fmt"

	"video-canvas/internal/drama/script"
	"video-canvas/internal/model"
	"video-canvas/internal/pkg/errcode"
	"video-canvas/internal/pkg/idcodec"
	"video-canvas/internal/pkg/ws"
	"video-canvas/internal/repository"
)

// GetScript 读取一集的结构化剧本；整部剧还没转成结构时先在事务里转换。
// 集不存在和项目不属于用户均返回 67001。
func (s *DramaService) GetScript(ctx context.Context, userID, id uint64, no int) (*DramaScriptView, error) {
	var view *DramaScriptView
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		// 1. 确保整部剧已转成结构（只在第一次读时加项目锁转换，之后读不加锁，不挡流水线）。
		if _, e := s.structuredProject(ctx, tx, userID, id); e != nil {
			return e
		}
		// 2. 按集号取集，读出场次和元素。
		ep, e := dramaEpisodeByNo(ctx, tx, userID, id, no)
		if e != nil {
			return e
		}
		rows, e := tx.ScriptRows(ctx, userID, ep.ID)
		if e != nil {
			return e
		}
		view = scriptView(ep, scenesFromRows(rows), nil)
		return nil
	})
	if err != nil {
		return nil, dramaError(err)
	}
	return view, nil
}

// PutScript 整集保存结构化剧本，带集级 revision 乐观锁，成功后返回最新结构（新增的行带上新 ID）。
func (s *DramaService) PutScript(ctx context.Context, userID, id uint64, no int, req *SaveDramaScriptReq) (*DramaScriptView, error) {
	var view *DramaScriptView
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		var e error
		view, e = s.putScriptTx(ctx, tx, userID, id, no, req)
		return e
	})
	if err != nil {
		return nil, dramaError(err)
	}
	return view, nil
}

// putScriptTx 是 PutScript 在事务里的全部步骤。
func (s *DramaService) putScriptTx(ctx context.Context, tx repository.DramaTx, userID, id uint64, no int, req *SaveDramaScriptReq) (*DramaScriptView, error) {
	// 1. 项目行锁，保证和流水线、改名等写入串行；先转换整部剧，再读集，避免读到转换前的 script_md。
	p, err := tx.Project(ctx, userID, id, true)
	if err != nil {
		return nil, err
	}
	if err = s.ensureScriptStructured(ctx, tx, p); err != nil {
		return nil, err
	}
	ep, err := dramaEpisodeByNo(ctx, tx, userID, id, no)
	if err != nil {
		return nil, err
	}
	// 2. 锁定集只读；revision 不一致说明别处改过。
	if ep.LockedAt != nil {
		return nil, errcode.ErrDramaEpisodeLocked
	}
	if ep.Revision != req.Revision {
		return nil, errcode.ErrCanvasConflict
	}
	// 3. 校验引用和场内顺序，不合法整集不写。
	roster, err := loadScriptRoster(ctx, tx, userID, id)
	if err != nil {
		return nil, err
	}
	scenes, err := scenesFromView(req.Scenes, roster)
	if err != nil {
		return nil, err
	}
	if verr := script.Validate(scenes); verr != nil {
		return nil, scriptInvalid(verr)
	}
	// 4. 写结构并渲染 script_md，随后按 revision 保存集。
	saved, err := s.writeScriptStructure(ctx, tx, p, ep, scenes, roster)
	if err != nil {
		return nil, err
	}
	ep.ScriptStatus = "empty"
	if scriptHasContent(saved) {
		ep.ScriptStatus = "ready"
	}
	if err = tx.SaveEpisode(ctx, ep, req.Revision); err != nil {
		return nil, err
	}
	return scriptView(ep, saved, nil), nil
}

// ParseScript 把一段文本解析成场次和元素（粘贴用），不落剧本；
// 文本里新出现的人物、地点会登记进表并标为「待确认」，前端据此直接拿到可用的 ID。
func (s *DramaService) ParseScript(ctx context.Context, userID, id uint64, req *ParseDramaScriptReq) (*DramaScriptView, error) {
	var view *DramaScriptView
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		p, e := tx.Project(ctx, userID, id, true)
		if e != nil {
			return e
		}
		if e = s.ensureScriptStructured(ctx, tx, p); e != nil {
			return e
		}
		roster, e := loadScriptRoster(ctx, tx, userID, id)
		if e != nil {
			return e
		}
		res := script.Parse(req.Text, roster)
		if roster.err != nil {
			return roster.err
		}
		view = &DramaScriptView{Scenes: viewFromScenes(script.Repair(res.Scenes)), Warnings: warningViews(res.Warnings)}
		return nil
	})
	if err != nil {
		return nil, dramaError(err)
	}
	return view, nil
}

// PreviewScript 预览把一段文本写进这一集后 script_md 会是什么样：按当前人物表、地点表解析并渲染，不写库
// （新名字只在内存里分临时 ID）。Agent 改剧本的审批预览和落库用的就是这份结果，所以用户看到的和实际保存的一致，
// 而且再次解析它得到同样的 script_md，审批重放时的幂等判断仍然成立。集不存在返回 67001。
func (s *DramaService) PreviewScript(ctx context.Context, userID, id uint64, no int, text string) (string, error) {
	var md string
	err := s.repo.WithTx(ctx, func(tx repository.DramaTx) error {
		if _, e := tx.Project(ctx, userID, id, false); e != nil {
			return e
		}
		ep, e := dramaEpisodeByNo(ctx, tx, userID, id, no)
		if e != nil {
			return e
		}
		roster, e := previewScriptRoster(ctx, tx, userID, id)
		if e != nil {
			return e
		}
		md = script.Render(script.Repair(script.Parse(text, roster).Scenes), ep.No, roster)
		return nil
	})
	return md, dramaError(err)
}

// structuredProject 读取项目；整部剧还没转成结构时加锁转换（锁内重新读项目，避免两个请求都转换）。
func (s *DramaService) structuredProject(ctx context.Context, tx repository.DramaTx, userID, id uint64) (*model.DramaProject, error) {
	p, err := tx.Project(ctx, userID, id, false)
	if err != nil {
		return nil, err
	}
	if p.ScriptStructured {
		return p, nil
	}
	if p, err = tx.Project(ctx, userID, id, true); err != nil {
		return nil, err
	}
	return p, s.ensureScriptStructured(ctx, tx, p)
}

// ensureScriptStructured 把整部剧的存量文本剧本转成结构：逐集解析 script_md，说话人和地点按名字、别名登记进表（待确认）。
// 未锁定的集把 script_md 换成渲染结果（格式统一，revision 不变）；锁定集只建结构，script_md 原样保留、revision 不变，
// 这样拆解和分镜已经对着的文本不会变。已转换过的项目直接返回。
// 调用方必须在持有项目行锁的事务里先调它、再读集，否则读到的 script_md 还是转换前的。
func (s *DramaService) ensureScriptStructured(ctx context.Context, tx repository.DramaTx, p *model.DramaProject) error {
	if p.ScriptStructured {
		return nil
	}
	roster, err := loadScriptRoster(ctx, tx, p.UserID, p.ID)
	if err != nil {
		return err
	}
	eps, err := tx.Episodes(ctx, p.UserID, p.ID)
	if err != nil {
		return err
	}
	for i := range eps {
		if err = s.convertEpisode(ctx, tx, p, &eps[i], roster); err != nil {
			return err
		}
	}
	if err = tx.MarkScriptStructured(ctx, p.UserID, p.ID); err != nil {
		return err
	}
	p.ScriptStructured = true
	return nil
}

func (s *DramaService) convertEpisode(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode, roster *scriptRoster) error {
	if ep.ScriptMD == "" {
		return nil
	}
	res := script.Parse(ep.ScriptMD, roster)
	if roster.err != nil {
		return roster.err
	}
	// 存量文本不做合法性拒绝：保留用户已有的内容，闪回不成对的修掉标记即可。
	scenes := script.Repair(res.Scenes)
	if _, err := tx.ReplaceScriptRows(ctx, p.UserID, p.ID, ep.ID, rowsFromScenes(scenes)); err != nil {
		return err
	}
	if ep.LockedAt != nil {
		return nil
	}
	rows, err := tx.ScriptRows(ctx, p.UserID, ep.ID)
	if err != nil {
		return err
	}
	// 只归一格式，不升 revision：前端手里的集摘要还是旧 revision，升了会让用户随后改标题、钩子白白 409。
	ep.ScriptMD = script.Render(scenesFromRows(rows), ep.No, roster)
	return tx.SetEpisodeScriptMD(ctx, p.UserID, p.ID, ep.ID, ep.ScriptMD)
}

// writeScriptStructure 把 scenes 写成这一集的结构，并把渲染结果放进 ep.ScriptMD（保存 ep 由调用方做）。
// 带了不属于这一集的行 ID 说明别处改过，按保存冲突处理。
func (s *DramaService) writeScriptStructure(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode, scenes []script.Scene, roster *scriptRoster) ([]script.Scene, error) {
	rows, err := tx.ReplaceScriptRows(ctx, p.UserID, p.ID, ep.ID, rowsFromScenes(scenes))
	if errors.Is(err, repository.ErrScriptRowMissing) {
		return nil, errcode.ErrCanvasConflict
	}
	if err != nil {
		return nil, err
	}
	saved := scenesFromRows(rows)
	ep.ScriptMD = script.Render(saved, ep.No, roster)
	return saved, nil
}

// applyScriptText 把一段文本（模型生成、Agent 修改、规划导入）写进这一集：解析后与旧结构合并，
// 保留用户手动加的场次信息和备注，没改的行沿用原 ID，再渲染 script_md 放进 ep（保存 ep 由调用方做）。
// 调用方要已持有项目行锁，并已对项目调过 ensureScriptStructured。
func (s *DramaService) applyScriptText(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode, text string) (script.Stats, []script.Warning, error) {
	if !p.ScriptStructured {
		return script.Stats{}, nil, fmt.Errorf("applyScriptText：项目尚未转成结构")
	}
	roster, err := loadScriptRoster(ctx, tx, p.UserID, p.ID)
	if err != nil {
		return script.Stats{}, nil, err
	}
	oldRows, err := tx.ScriptRows(ctx, p.UserID, ep.ID)
	if err != nil {
		return script.Stats{}, nil, err
	}
	res := script.Parse(text, roster)
	if roster.err != nil {
		return script.Stats{}, nil, roster.err
	}
	merged, stats, warns := script.Merge(scenesFromRows(oldRows), script.Repair(res.Scenes))
	if verr := script.Validate(merged); verr != nil {
		return stats, nil, errcode.ErrDramaOutputInvalid
	}
	if _, err = s.writeScriptStructure(ctx, tx, p, ep, merged, roster); err != nil {
		return stats, nil, err
	}
	return stats, append(res.Warnings, warns...), nil
}

// resyncScript 把刚按文本写进 ep.ScriptMD 的内容同步成结构并保存（规划导入、大纲落库用）；
// 项目还没转成结构时什么也不做，之后第一次转换会把这些文本一起转。
func (s *DramaService) resyncScript(ctx context.Context, tx repository.DramaTx, p *model.DramaProject, ep *model.DramaEpisode) error {
	if !p.ScriptStructured || ep.ScriptMD == "" {
		return nil
	}
	if _, _, err := s.applyScriptText(ctx, tx, p, ep, ep.ScriptMD); err != nil {
		return err
	}
	return tx.SaveEpisode(ctx, ep, ep.Revision)
}

func dramaEpisodeByNo(ctx context.Context, tx repository.DramaTx, userID, id uint64, no int) (*model.DramaEpisode, error) {
	eps, err := tx.Episodes(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	for i := range eps {
		if eps[i].No == no {
			return &eps[i], nil
		}
	}
	return nil, errcode.ErrDramaNotFound
}

func scriptView(ep *model.DramaEpisode, scenes []script.Scene, warns []script.Warning) *DramaScriptView {
	return &DramaScriptView{Revision: ep.Revision, Locked: ep.LockedAt != nil, Warnings: warningViews(warns), Scenes: viewFromScenes(scenes)}
}

func warningViews(ws []script.Warning) []DramaScriptWarning {
	out := []DramaScriptWarning{}
	for _, w := range ws {
		out = append(out, DramaScriptWarning{Line: w.Line, Message: w.Message})
	}
	return out
}

// scriptInvalid 把校验位置写进错误信息：第几场第几行和原因。
func scriptInvalid(v *script.ValidationError) error {
	return errcode.ErrDramaScriptInvalid.WithMsg(fmt.Sprintf("第 %d 场第 %d 行：%s", v.Scene+1, v.Element+1, v.Message))
}

// publishScriptEpisodes 通知前端这些集的内容变了（改名重渲染后），不在数据库事务内发送。
func (s *DramaService) publishScriptEpisodes(ctx context.Context, userID, dramaID uint64, nos []int) {
	if s.bc == nil {
		return
	}
	for _, no := range nos {
		s.bc.Publish(ctx, ws.UserChannel(userID), ws.Message{Type: ws.TypeDramaEpisode, Data: struct {
			DramaID   idcodec.ID `json:"drama_id"`
			EpisodeNo int        `json:"episode_no"`
		}{idcodec.ID(dramaID), no}})
	}
}
