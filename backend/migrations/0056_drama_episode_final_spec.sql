-- 已有成片没有导出规格记录，保留为 NULL。
ALTER TABLE drama_episodes ADD COLUMN final_spec jsonb;
