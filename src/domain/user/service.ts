import { getUserRepository } from "./repository";
import type { User } from "./types";

export class UserService {
  findByEmail(email: string): Promise<User | null> {
    return getUserRepository().findByEmail(email);
  }

  findById(id: string): Promise<User | null> {
    return getUserRepository().findById(id);
  }
}

export const userService = new UserService();