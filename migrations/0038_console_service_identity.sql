CREATE TABLE IF NOT EXISTS console_service_clients (
  client_id TEXT PRIMARY KEY NOT NULL,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);
