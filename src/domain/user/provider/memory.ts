import type { UserRepository } from "../repository";
import type { User } from "../types";

export class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return user;
      }
    }

    return null;
  }

  async findById(id: string): Promise<User |null> {
    return this.users.get(id) ?? null;
  }

  seed(user: User): void {
    this.users.set(user.id, user);
  }
}

export const memoryUserRepository = new MemoryUserRepository();