import type { JSONSchema } from "@pa/core";

/**
 * Простая проверка входа инструмента по схеме: объект, обязательные поля, базовые типы.
 * Возвращает текст ошибки или null.
 */
export function validateInput(schema: JSONSchema, input: unknown): string | null {
  return check(schema, input, "вход");
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function check(schema: JSONSchema, value: unknown, where: string): string | null {
  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === "number" && t === "integer");
    if (!ok) return `${where}: ожидался тип ${schema.type}, получен ${t}`;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    return `${where}: допустимые значения — ${schema.enum.join(", ")}`;
  }
  if (schema.type === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) return `${where}: нет обязательного поля "${key}"`;
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined) {
        const err = check(sub, obj[key], `${where}.${key}`);
        if (err) return err;
      }
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = check(schema.items, value[i], `${where}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}
