let counter = 0;

/** Short, collision-resistant ids for arena objects and saved projects. */
export function makeId(prefix = 'id'): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${random}`;
}
