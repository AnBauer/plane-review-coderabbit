/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
// local imports
import { useModuleStatusFilter } from "./use-module-status-filter";

const createWrapper = (initialEntry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };

const renderFilter = (initialEntry: string, initialStatuses?: string) =>
  renderHook(
    () => ({
      filter: useModuleStatusFilter(initialStatuses),
      location: useLocation(),
    }),
    { wrapper: createWrapper(initialEntry) }
  );

describe("useModuleStatusFilter", () => {
  it("reads the statuses from the URL", () => {
    const { result } = renderFilter("/ws/projects/p1/modules?status=planned,paused");

    expect(result.current.filter.activeStatuses).toEqual(["planned", "paused"]);
  });

  it("ignores unknown values", () => {
    const { result } = renderFilter("/ws/projects/p1/modules?status=planned,foo");

    expect(result.current.filter.activeStatuses).toEqual(["planned"]);
  });

  it("switches a status on and off", async () => {
    const { result } = renderFilter("/ws/projects/p1/modules?view=1");

    act(() => result.current.filter.switchStatus("planned"));
    await waitFor(() => expect(result.current.location.search).toContain("status=planned"));
    expect(result.current.location.search).toContain("view=1");

    act(() => result.current.filter.switchStatus("planned"));
    await waitFor(() => expect(result.current.location.search).not.toContain("status"));
    expect(result.current.location.search).toContain("view=1");
  });

  it("applies initialStatuses", async () => {
    const { result } = renderFilter("/ws/projects/p1/modules", "completed");

    await waitFor(() => expect(result.current.location.search).toContain("status=completed"));
  });
});
