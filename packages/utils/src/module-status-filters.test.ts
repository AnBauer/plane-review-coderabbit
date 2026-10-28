/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
// local imports
import { parseStoredModuleStatuses } from "./module-status-filters";

describe("parseStoredModuleStatuses", () => {
  it("keeps known statuses", () => {
    expect(parseStoredModuleStatuses(["planned", "paused"])).toEqual(["planned", "paused"]);
  });

  it("returns an empty list for malformed input", () => {
    expect(parseStoredModuleStatuses("planned")).toEqual([]);
    expect(parseStoredModuleStatuses(null)).toEqual([]);
    expect(parseStoredModuleStatuses({})).toEqual([]);
  });
});
