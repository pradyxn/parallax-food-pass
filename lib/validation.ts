export type Preference = "VEG" | "NON_VEG";
export type Source = "IMPORT" | "WALK_IN" | "MANUAL";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AttendeeCsvField = "name" | "roll_number" | "branch" | "preference" | "email";

export function normalizeCsvHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function identifyAttendeeCsvField(header: string): AttendeeCsvField | null {
  const normalized = normalizeCsvHeader(header);
  if (/(^|_)(student_)?(full_)?name($|_)/.test(normalized) || /(^|_)name_of_student($|_)/.test(normalized)) {
    return "name";
  }
  if (
    /(^|_)roll(?:_?(?:number|no|id))?(?:_|$)/.test(normalized)
    || /hall_?ticket/.test(normalized)
    || /(^|_)registration_number($|_)/.test(normalized)
    || /(^|_)student_id($|_)/.test(normalized)
  ) {
    return "roll_number";
  }
  if (normalized === "email" || normalized === "email_address" || normalized === "email_id" || /(^|_)email(_|$)/.test(normalized)) return "email";
  if (/(^|_)(branch|department|dept|course|section)(_|$)/.test(normalized)) {
    return "branch";
  }
  if (
    normalized === "preference"
    ||
    (/(food|meal)/.test(normalized) && /(preference|prefer|choice|select|type|veg)/.test(normalized))
    || /(^|_)(food|meal)$/.test(normalized)
    || /vegetarian.*non_?vegetarian/.test(normalized)
    || /(^|_)(veg|non_veg)_?(preference|choice|meal)($|_)/.test(normalized)
  ) {
    return "preference";
  }
  return null;
}

export function normalizeAttendeeCsvHeader(header: string) {
  return identifyAttendeeCsvField(header) ?? normalizeCsvHeader(header);
}

export function readAttendeeCsvField(row: Record<string, unknown>, field: AttendeeCsvField) {
  for (const [header, value] of Object.entries(row)) {
    if (identifyAttendeeCsvField(header) === field && cleanText(value)) return value;
  }
  return undefined;
}

export function cleanText(value: unknown, max = 120): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function cleanPreference(value: unknown): Preference | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (["VEG", "VEGETARIAN"].includes(normalized)) return "VEG";
  if (["NON_VEG", "NONVEG", "NON_VEGETARIAN", "NONVEGETARIAN"].includes(normalized)) return "NON_VEG";
  return null;
}

export function normalizeRollNumber(value: unknown): string | null {
  const valueText = cleanText(value, 60);
  return valueText ? valueText.toUpperCase() : null;
}

export function validRegistration(input: Record<string, unknown>) {
  const name = cleanText(input.name, 100);
  const roll_number = normalizeRollNumber(input.roll_number);
  const branch = cleanText(input.branch, 80);
  const preference = cleanPreference(input.preference);
  if (name.length < 2) return { error: "Enter the attendee's full name." } as const;
  if (!preference) return { error: "Choose VEG or NON-VEG." } as const;
  return { value: { name, roll_number, branch: branch || null, preference } } as const;
}
