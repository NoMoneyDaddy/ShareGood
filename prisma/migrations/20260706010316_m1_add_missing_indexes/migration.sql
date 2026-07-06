-- CreateIndex
CREATE INDEX "claim_comments_user_id_idx" ON "claim_comments"("user_id");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");

-- CreateIndex
CREATE INDEX "handover_records_receiver_id_idx" ON "handover_records"("receiver_id");

-- CreateIndex
CREATE INDEX "item_images_thumb_object_id_idx" ON "item_images"("thumb_object_id");

-- CreateIndex
CREATE INDEX "item_images_medium_object_id_idx" ON "item_images"("medium_object_id");
