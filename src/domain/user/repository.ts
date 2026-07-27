import type { User } from "./types";

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;

  findById(id: string): Promise<User | null>;
}

let repository: UserRepository | null = null;

export function registerUserRepository(
  value: UserRepository,
): void {
  repository = value;
}

export function getUserRepository(): UserRepository {
  if (!repository) {
    throw new Error("UserRepository has not been registered.");
  }

  return repository;
}