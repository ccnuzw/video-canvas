-- 短剧开拍设置的预设目录（题材 / 画风）搬到后台维护。
-- 设计：docs/design/短剧预设后台/短剧预设后台.md
--
-- 迁移前这两份清单硬编码在 internal/drama/styles.json（//go:embed 进二进制），加一条要改代码 + 发版。
-- 迁移后用这张表做单一事实源，styles.json 退化为「种子来源 + 空表兜底」。
--
-- 几条约束：
--   * key 创建后不可改：drama_projects.style_key / genre 存的是 key，没有外键，改 key 会静默切断历史项目；
--   * 删除走硬删（不软删）：唯一索引 (kind, key) 与软删除叠加会让删掉的 key 永远无法重建；
--   * preview_url 存可访问地址：内置 12 条用前端静态相对路径，后台新上传的写平台存储的绝对地址；
--   * is_builtin 标记随迁移种入的条目，用于「恢复默认」与「内置条目不允许改 key」的提示，不影响运行。
CREATE TABLE drama_presets (
    id bigserial PRIMARY KEY,
    created_at timestamptz,
    updated_at timestamptz,
    deleted_at timestamptz,
    kind varchar(8) NOT NULL,
    key varchar(32) NOT NULL,
    name varchar(64) NOT NULL,
    prompt text NOT NULL DEFAULT '',
    preview_url varchar(1024) NOT NULL DEFAULT '',
    sort_order bigint NOT NULL DEFAULT 0,
    enabled boolean NOT NULL,
    is_builtin boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX uk_drama_presets_kind_key ON drama_presets (kind, key);
CREATE INDEX idx_drama_presets_deleted_at ON drama_presets (deleted_at);
CREATE INDEX idx_drama_presets_kind_order ON drama_presets (kind, sort_order);

-- 种子：12 类题材 + 12 种画风，与迁移前 styles.json 逐字一致（TestSeedMatchesBuiltin 会比对）。
-- ON CONFLICT DO NOTHING 保证重复执行安全（后台改过名称 / prompt 的条目不会被回滚覆盖）。
INSERT INTO drama_presets (kind, key, name, prompt, preview_url, sort_order, enabled, is_builtin)
VALUES
    ('genre', 'sweet_romance', '甜宠言情', '', '', 0, true, true),
    ('genre', 'suspense', '悬疑推理', '', '', 1, true, true),
    ('genre', 'youth_action', '热血少年与动作', '', '', 2, true, true),
    ('genre', 'comedy', '喜剧搞笑', '', '', 3, true, true),
    ('genre', 'sci_fi_apocalypse', '科幻末世', '', '', 4, true, true),
    ('genre', 'urban_workplace', '都市职场', '', '', 5, true, true),
    ('genre', 'xianxia', '古风仙侠', '', '', 6, true, true),
    ('genre', 'historical_epic', '历史史诗', '', '', 7, true, true),
    ('genre', 'family', '家庭温情', '', '', 8, true, true),
    ('genre', 'coming_of_age', '青春成长', '', '', 9, true, true),
    ('genre', 'horror', '恐怖灵异', '', '', 10, true, true),
    ('genre', 'psychological', '心理博弈', '', '', 11, true, true),
    ('style', 'anime_90s', '90年代日式动画', '以九十年代手绘赛璐璐动画呈现，线条清晰而带有细微手工起伏，人物五官简洁鲜明，头发与服装采用成块明暗。背景以水彩般的柔和笔触描绘空间，暖色高光与偏冷阴影形成层次，少量胶片颗粒使画面保留年代感。', '/drama-styles/anime_90s.webp', 0, true, true),
    ('style', 'chinese_anime', '国风二次元', '采用精致的国风二维动画语言，以流畅轮廓与细腻平涂塑造人物，服饰纹样、发饰和建筑融入中国传统审美。色彩清透协调，局部以淡墨晕染和柔光营造空气感，人物表情灵动，构图兼顾叙事清晰度与东方留白。', '/drama-styles/chinese_anime.webp', 1, true, true),
    ('style', 'flat_2d', '二维扁平设计', '以简洁几何形和稳定色块构成二维画面，轮廓干净，形体概括准确，人物姿态与道具特征一目了然。使用少量协调的主题色与明确的前后层级，通过形状、比例和留白组织视觉重心，保持整组资产统一的图形语言。', '/drama-styles/flat_2d.webp', 2, true, true),
    ('style', 'mature_urban_anime', '成熟都市言情动画', '以面向成熟观众的都市爱情动画表现，人物比例修长自然，面部结构精致，眼神与细微表情承载情绪。服装剪裁、室内陈设与城市光影具有当代生活质感，使用克制的柔和色调和细腻渐层，形成温润而具有电影感的二维画面。', '/drama-styles/mature_urban_anime.webp', 3, true, true),
    ('style', 'animation_3d', '三维动画渲染', '采用高品质三维动画渲染，角色形体饱满且轮廓鲜明，皮肤、织物与硬质道具具有清晰而协调的材质差异。柔和全局光照与适度景深突出主体，表情生动，色彩明快，保持动画化比例和精细制作的统一观感。', '/drama-styles/animation_3d.webp', 4, true, true),
    ('style', 'chinese_3d', '国风三维', '以精细国风三维动画塑造人物与环境，服饰层叠、刺绣、玉石和木石结构呈现丰富材质。人物面貌融入东方审美，光线透过云雾或窗棂形成柔和层次，传统建筑与山水空间呼应，整体庄重雅致且具空间纵深。', '/drama-styles/chinese_3d.webp', 5, true, true),
    ('style', 'clay_stop_motion', '黏土定格', '呈现手工黏土定格动画质感，角色和道具具有圆润造型、可见的指压痕迹与细小表面起伏。布景如精心搭建的微缩模型，使用柔和棚灯、真实接触阴影和浅景深，色彩温暖，保留手作材料的亲近感与趣味。', '/drama-styles/clay_stop_motion.webp', 6, true, true),
    ('style', 'chinese_cyber_3d', '国风赛博三维', '将中式屋檐、纹样和服饰轮廓与未来城市工业结构融合，以精细三维材质表现金属、玻璃和织物。青蓝与暖红光源交织，潮湿表面反射城市灯光，空间中保留可辨识的东方文化细节，形成层次丰富的近未来视觉。', '/drama-styles/chinese_cyber_3d.webp', 7, true, true),
    ('style', 'real_historical', '古风真人', '采用古装真人影视摄影语言，人物肤质与衣料纹理自然真实，发髻、妆容、服饰和器物符合故事所处时代。以庭院、殿宇和自然景观组织场景，借助窗光、烛光或自然天光塑造人物，色彩典雅，构图具有清晰的戏剧重心。', '/drama-styles/real_historical.webp', 8, true, true),
    ('style', 'real_city_film', '真人都市电影', '以当代都市真人电影的摄影质感呈现，自然的人体比例与真实皮肤纹理结合细致的日常服装和生活空间。使用有方向的自然光或城市实景照明，以克制的色彩、细腻明暗和适度景深传递情绪，画面具有可信的生活细节。', '/drama-styles/real_city_film.webp', 9, true, true),
    ('style', 'real_sweet_romance', '都市甜宠写实', '以明亮温柔的都市爱情真人影像呈现，人物妆发自然精致，服装清爽，生活场景细节真实。柔和侧光、暖色反光和轻盈景深突出眼神交流与亲密氛围，采用通透的浅色系与舒适构图，让人物关系成为画面中心。', '/drama-styles/real_sweet_romance.webp', 10, true, true),
    ('style', 'hyperreal_cg_3d', '超写实3A级CG', '以 3A 级游戏 CG 的三维动画语言呈现，角色保留动漫化的五官与体型比例，同时具备超写实的皮肤、毛发与织物细节，材质按物理渲染规律表现反射、粗糙度与次表面散射。多层布光形成清晰的光影层次，环境的天光、反射与色温真实地落在肤色和服装上，微风带动发丝与衣摆产生自然动态，整体质感接近电影级实时渲染。', '/drama-styles/hyperreal_cg_3d.webp', 11, true, true)
ON CONFLICT (kind, key) DO NOTHING;
