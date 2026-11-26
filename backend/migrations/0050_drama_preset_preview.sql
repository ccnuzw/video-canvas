-- 预设预览图落平台存储后的定位信息（preview_key / preview_storage_id）。
--
-- 为什么不能只靠 preview_url：公开预览地址必须是「永不过期」的稳定地址。
--   * 本地存储的 URL() 返回 /files/<key>，而 /files 是按 assets 表反查存储的，
--     预设预览图没有素材行，直接存这个地址会 404；
--   * 对象存储的 URL() 在私有桶下返回带 ttl 的预签名地址，存进表里过期即裂图。
-- 所以预览图走独立公开路由 /api/v1/drama-presets/previews/*（后端按 key 现取现签），
-- 这两列就是那条路由做「去哪读」判断的依据。
--
-- 内置 12 条画风的预览图仍是前端发布包里的静态文件（web/public/drama-styles/*.webp），
-- 这两列为空串 / 0，走静态相对路径，不经过平台存储。
ALTER TABLE drama_presets
    ADD COLUMN preview_key        varchar(512) NOT NULL DEFAULT '',
    ADD COLUMN preview_storage_id bigint       NOT NULL DEFAULT 0;

-- 公开预览路由按对象 key 反查预设（取所在存储），必须能走索引
CREATE INDEX idx_drama_presets_preview_key ON drama_presets (preview_key);
