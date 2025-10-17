CREATE INDEX IF NOT EXISTS idx_message_conv_id_created_at
ON message (conversation_id, created_at DESC, id DESC);
