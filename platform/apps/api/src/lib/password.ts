import argon2 from 'argon2'
import { config } from '../config.js'

function pepper(value: string): string {
  return config.PASSWORD_PEPPER ? `${value}\u0000${config.PASSWORD_PEPPER}` : value
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(pepper(password), {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32
  })
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, pepper(password))
}
