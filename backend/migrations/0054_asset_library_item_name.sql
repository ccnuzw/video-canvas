-- 库内名称独立于原始文件名；旧条目继续显示原始文件名。
ALTER TABLE asset_library_items ADD COLUMN name varchar(255) NOT NULL DEFAULT '';
