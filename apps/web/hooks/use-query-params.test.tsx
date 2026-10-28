/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
// local imports
import { useQueryParams } from "./use-query-params";

const createWrapper = (initialEntry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };

describe("useQueryParams", () => {
  it("adds and removes query params while keeping the rest of the URL", () => {
    const { result } = renderHook(() => useQueryParams(), {
      wrapper: createWrapper("/ws/projects/p1/modules?peekModule=m1&layout=list"),
    });

    const route = result.current.updateQueryParams({
      paramsToAdd: { status: "planned" },
      paramsToRemove: ["peekModule"],
    });

    expect(route).toBe("/ws/projects/p1/modules?layout=list&status=planned");
  });
});
