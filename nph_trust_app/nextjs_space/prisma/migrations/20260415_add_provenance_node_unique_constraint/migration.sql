-- CreateIndex
CREATE UNIQUE INDEX "provenance_nodes_project_id_entity_type_entity_id_key" ON "provenance_nodes"("project_id", "entity_type", "entity_id");
