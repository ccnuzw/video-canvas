-- 人物小传以剧本人物表的 note 为准：研读生成的人物传记（drama_projects.characters_md）由服务层按项目惰性导入人物表，
-- script_bios_imported 记录当前这份传记是否已导入；研读重写传记时置回 false，下次只补空 note、新建新人物。
-- 地点也要有描述，和人物表一样加 note 列。
ALTER TABLE drama_script_locations ADD COLUMN note text NOT NULL DEFAULT '';
ALTER TABLE drama_projects ADD COLUMN script_bios_imported boolean NOT NULL DEFAULT false;
