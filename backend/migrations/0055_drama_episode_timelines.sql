-- 成片粗剪：每集一份剪辑清单；不存在时由片段现算默认时间线。
CREATE TABLE drama_episode_timelines (
    id bigserial PRIMARY KEY,
    created_at timestamptz,
    updated_at timestamptz,
    deleted_at timestamptz,
    user_id bigint NOT NULL,
    episode_id bigint NOT NULL,
    clips jsonb NOT NULL DEFAULT '[]'::jsonb,
    muted boolean NOT NULL DEFAULT false,
    removed_segment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    imports jsonb NOT NULL DEFAULT '[]'::jsonb,
    revision bigint NOT NULL DEFAULT 1
);
CREATE INDEX idx_drama_episode_timelines_deleted_at ON drama_episode_timelines (deleted_at);
CREATE INDEX idx_drama_episode_timelines_user_id ON drama_episode_timelines (user_id);
CREATE UNIQUE INDEX uk_drama_episode_timeline ON drama_episode_timelines (episode_id);
