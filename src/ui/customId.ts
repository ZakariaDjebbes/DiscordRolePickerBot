/**
 * The custom_id protocol.
 *
 * A component carries both levels — which group, and (for buttons) which role —
 * so one handler serves every group without a line of per-group code.
 *
 *   rolepicker:btn:<groupKey>:<roleKey>
 *   rolepicker:menu:<groupKey>
 *
 * Discord caps custom_id at 100 characters; config keys are capped at 32 to
 * keep both forms inside it.
 */
export const NAMESPACE = "rolepicker";

export type ComponentRef =
  | { kind: "button"; groupKey: string; roleKey: string }
  | { kind: "menu"; groupKey: string };

export function buttonId(groupKey: string, roleKey: string): string {
  return `${NAMESPACE}:btn:${groupKey}:${roleKey}`;
}

export function menuId(groupKey: string): string {
  return `${NAMESPACE}:menu:${groupKey}`;
}

/** Returns null for any component that is not ours. */
export function parseComponentId(customId: string): ComponentRef | null {
  const parts = customId.split(":");
  if (parts[0] !== NAMESPACE) return null;

  if (parts[1] === "btn" && parts.length === 4) {
    const [, , groupKey, roleKey] = parts;
    if (groupKey && roleKey) return { kind: "button", groupKey, roleKey };
    return null;
  }

  if (parts[1] === "menu" && parts.length === 3) {
    const [, , groupKey] = parts;
    if (groupKey) return { kind: "menu", groupKey };
    return null;
  }

  return null;
}
