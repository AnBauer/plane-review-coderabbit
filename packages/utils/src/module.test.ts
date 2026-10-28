/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
// plane imports
import type { IModule, TModuleDisplayFilters, TModuleFilters } from "@plane/types";
// local imports
import { shouldFilterModule } from "./module";

const buildModule = (status: string): IModule => ({ id: "m1", status }) as unknown as IModule;

const displayFilters: TModuleDisplayFilters = {};

describe("shouldFilterModule", () => {
  it("keeps a module whose status is in the status filter", () => {
    const filters: TModuleFilters = { status: ["planned", "in-progress"] };
    expect(shouldFilterModule(buildModule("planned"), displayFilters, filters)).toBe(true);
  });

  it("drops a module whose status is not in the status filter", () => {
    const filters: TModuleFilters = { status: ["completed"] };
    expect(shouldFilterModule(buildModule("planned"), displayFilters, filters)).toBe(false);
  });

  it("keeps every module when the status filter is empty", () => {
    const filters: TModuleFilters = { status: [] };
    expect(shouldFilterModule(buildModule("planned"), displayFilters, filters)).toBe(true);
    expect(shouldFilterModule(buildModule("completed"), displayFilters, filters)).toBe(true);
  });
});
