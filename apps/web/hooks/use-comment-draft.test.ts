/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
// local imports
import {
  COMMENT_DRAFT_TTL_MS,
  getCommentDraftKey,
  readCommentDraft,
  useCommentDraft,
  writeCommentDraft,
} from "./use-comment-draft";

const KEY = getCommentDraftKey("ws", "issue-1");

describe("comment draft", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores a saved draft", () => {
    writeCommentDraft(KEY, "<p>hello</p>");
    expect(readCommentDraft(KEY)).toBe("<p>hello</p>");
  });

  it("keeps drafts per work item", () => {
    writeCommentDraft(KEY, "<p>a</p>");
    expect(readCommentDraft(getCommentDraftKey("ws", "issue-2"))).toBeUndefined();
  });

  it("discards drafts older than 7 days", () => {
    writeCommentDraft(KEY, "<p>old</p>", 1000);
    expect(readCommentDraft(KEY, 1000 + COMMENT_DRAFT_TTL_MS + 1)).toBeUndefined();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps drafts that are exactly 7 days old", () => {
    writeCommentDraft(KEY, "<p>edge</p>", 1000);
    expect(readCommentDraft(KEY, 1000 + COMMENT_DRAFT_TTL_MS)).toBe("<p>edge</p>");
  });

  it("removes the draft when the content becomes empty", () => {
    writeCommentDraft(KEY, "<p>hello</p>");
    writeCommentDraft(KEY, "<p></p>");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores malformed stored data", () => {
    window.localStorage.setItem(KEY, "not json");
    expect(readCommentDraft(KEY)).toBeUndefined();
    window.localStorage.setItem(KEY, JSON.stringify({ foo: 1 }));
    expect(readCommentDraft(KEY)).toBeUndefined();
  });

  it("clears the draft via the hook", () => {
    const { result } = renderHook(() => useCommentDraft("ws", "issue-1"));
    result.current.saveDraft("<p>hi</p>");
    expect(result.current.getDraft()).toBe("<p>hi</p>");
    result.current.clearDraft();
    expect(result.current.getDraft()).toBeUndefined();
  });
});
