-- 结构化剧本：把每集剧本从一段 Markdown 拆成「场次 + 元素」，人物和地点有自己的表。
-- 设计见 docs/design/结构化剧本编辑器。drama_episodes.script_md 保留为派生列（结构写入时同一事务重渲染），
-- 所以拆解、分镜、上集衔接等读 script_md 的下游不变。
-- 与短剧其他表一致：不建跨资源外键，归属和级联删除在业务事务里校验；数据转换在服务层按项目惰性完成，不写进迁移。
-- 人物 / 地点名字在同一短剧内忽略大小写唯一，由服务层在项目行锁内保证（库里不建函数索引）。
ALTER TABLE drama_projects ADD COLUMN script_structured boolean NOT NULL DEFAULT false;

CREATE TABLE drama_script_characters (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL,
    drama_id bigint NOT NULL,
    name varchar(64) NOT NULL,
    aliases jsonb NOT NULL DEFAULT '[]',
    note text NOT NULL DEFAULT '',
    canvas_node_id varchar(64) NOT NULL DEFAULT '',
    confirmed boolean NOT NULL DEFAULT false,
    position bigint NOT NULL DEFAULT 0,
    created_at timestamptz,
    updated_at timestamptz
);
CREATE INDEX idx_drama_script_character_drama ON drama_script_characters (drama_id, user_id);

CREATE TABLE drama_script_locations (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL,
    drama_id bigint NOT NULL,
    name varchar(64) NOT NULL,
    aliases jsonb NOT NULL DEFAULT '[]',
    canvas_node_id varchar(64) NOT NULL DEFAULT '',
    confirmed boolean NOT NULL DEFAULT false,
    position bigint NOT NULL DEFAULT 0,
    created_at timestamptz,
    updated_at timestamptz
);
CREATE INDEX idx_drama_script_location_drama ON drama_script_locations (drama_id, user_id);

CREATE TABLE drama_scenes (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL,
    drama_id bigint NOT NULL,
    episode_id bigint NOT NULL,
    position bigint NOT NULL,
    int_ext varchar(24) NOT NULL DEFAULT '',
    time_label varchar(16) NOT NULL DEFAULT '',
    location_id bigint NOT NULL DEFAULT 0,
    title varchar(255) NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    emotions jsonb NOT NULL DEFAULT '[]',
    extra_character_ids jsonb NOT NULL DEFAULT '[]',
    props jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz,
    updated_at timestamptz
);
CREATE INDEX idx_drama_scenes_user_id ON drama_scenes (user_id);
CREATE INDEX idx_drama_scene_episode ON drama_scenes (episode_id, position);

CREATE TABLE drama_script_elements (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL,
    drama_id bigint NOT NULL,
    episode_id bigint NOT NULL,
    scene_id bigint NOT NULL,
    position bigint NOT NULL,
    type varchar(24) NOT NULL,
    text text NOT NULL DEFAULT '',
    character_id bigint NOT NULL DEFAULT 0,
    extension varchar(8) NOT NULL DEFAULT '',
    created_at timestamptz,
    updated_at timestamptz
);
CREATE INDEX idx_drama_script_elements_user_id ON drama_script_elements (user_id);
CREATE INDEX idx_drama_element_scene ON drama_script_elements (scene_id, position);
CREATE INDEX idx_drama_element_character ON drama_script_elements (drama_id, character_id);
