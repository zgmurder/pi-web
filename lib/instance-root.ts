import { lstatSync, realpathSync } from "fs";
import path from "path";
import { hasParentDirectorySegment, isPathWithinRoots } from "./path-security";

/** Set by the production launcher to its canonical package directory, never by a request. */
export function getInstanceRoot(): string | undefined {
  return process.env.PI_WEB_INSTANCE_ROOT || undefined;
}

export class InstancePathError extends Error {
  readonly code = "EACCES";
  constructor() {
    super("Access denied: path must stay inside this instance's extracted directory");
  }
}

/** Missing descendants may be created only beneath an existing, contained ancestor. */
export function isInstancePathAllowed(target: string, allowMissing = false): boolean {
  const root = getInstanceRoot();
  if (!root) return true;
  const roots = new Set([root]);
  if (hasParentDirectorySegment(target) || !isPathWithinRoots(target, roots)) return false;
  let candidate = path.resolve(target);
  for (;;) {
    try {
      // A dangling symlink is not a missing directory that we may create.
      lstatSync(candidate);
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = path.dirname(candidate);
      if (parent === candidate || !isPathWithinRoots(parent, roots)) return false;
      candidate = parent;
      continue;
    }
    try {
      return isPathWithinRoots(realpathSync(candidate), roots);
    } catch {
      return false;
    }
  }
}

export function assertInstancePath(target: string, allowMissing = false): void {
  if (!isInstancePathAllowed(target, allowMissing)) throw new InstancePathError();
}
