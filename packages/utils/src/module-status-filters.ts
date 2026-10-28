/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { z } from "zod";
// plane imports
import type { TModuleStatus } from "@plane/types";

/**
 * Schema of the module status filters saved in the local storage.
 */
export const StoredModuleStatusFiltersSchema = z.array(
  z.enum(["backlog", "planned", "in-progress", "paused", "completed", "cancelled"])
);

/**
 * Reads saved module status filters, returning an empty list when the value is not a list.
 */
export const parseStoredModuleStatuses = (value: unknown): TModuleStatus[] => {
  const result = StoredModuleStatusFiltersSchema.safeParse(value);
  return result.success ? result.data : [];
};
