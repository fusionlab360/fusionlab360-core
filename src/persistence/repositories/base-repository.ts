export abstract class BaseRepository {
  constructor(protected readonly db: D1Database) {}
}