-- 生成历史里的「删除」只是从历史里隐藏：素材行与文件保留，画布、对话和资产库里的引用不受影响。
-- NULL 表示仍显示在生成历史里。
ALTER TABLE assets ADD COLUMN history_hidden_at timestamptz;
