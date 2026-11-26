CREATE TABLE canvas_viewers (
    canvas_id bigint NOT NULL,
    user_id bigint NOT NULL,
    CONSTRAINT fk_canvas_viewers_canvas FOREIGN KEY (canvas_id) REFERENCES canvas_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_viewers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (canvas_id, user_id)
);
CREATE INDEX idx_canvas_viewers_user ON canvas_viewers (user_id, canvas_id);

CREATE TABLE canvas_deliveries (
    user_id bigint NOT NULL,
    request_key varchar(64) NOT NULL,
    canvas_id bigint NOT NULL,
    attempt varchar(64) NOT NULL,
    revision bigint NOT NULL,
    recipient bigint NOT NULL,
    mode varchar(12) NOT NULL,
    result_id bigint NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'running',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_key)
);

CREATE TABLE canvas_delivery_stages (
 storage_key text PRIMARY KEY, storage_id bigint NOT NULL, attempt varchar(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_canvas_delivery_stage_expiry ON canvas_delivery_stages(created_at);
CREATE INDEX idx_canvas_delivery_stage_attempt ON canvas_delivery_stages(attempt);
