/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { isCommentEmpty } from "@plane/utils";
// hooks
import { getValueFromLocalStorage, setValueIntoLocalStorage } from "@/hooks/use-local-storage";

export const COMMENT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMPTY_COMMENT_HTML = "<p></p>";

type TCommentDraft = {
  html: string;
  updatedAt: number;
};

export const getCommentDraftKey = (workspaceSlug: string, entityId: string) =>
  `comment_draft_${workspaceSlug}_${entityId}`;

/** Returns the stored draft html, or undefined when there is none or it is older than 7 days (it is removed then). */
export const readCommentDraft = (key: string, now: number = Date.now()): string | undefined => {
  const draft = getValueFromLocalStorage(key, null) as Partial<TCommentDraft> | null;
  if (!draft) return undefined;
  const isValid = typeof draft.html === "string" && typeof draft.updatedAt === "number";
  if (!isValid || now - (draft.updatedAt as number) > COMMENT_DRAFT_TTL_MS || isCommentEmpty(draft.html)) {
    window.localStorage.removeItem(key);
    return undefined;
  }
  return draft.html;
};

export const clearCommentDraft = (key: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
};

export const writeCommentDraft = (key: string, html: string, now: number = Date.now()) => {
  if (isCommentEmpty(html)) {
    clearCommentDraft(key);
    return;
  }
  setValueIntoLocalStorage(key, { html, updatedAt: now } satisfies TCommentDraft);
};

export const useCommentDraft = (workspaceSlug: string, entityId: string) => {
  const key = getCommentDraftKey(workspaceSlug, entityId);

  const getDraft = useCallback(() => readCommentDraft(key), [key]);
  const saveDraft = useCallback((html: string) => writeCommentDraft(key, html), [key]);
  const clearDraft = useCallback(() => clearCommentDraft(key), [key]);

  return { getDraft, saveDraft, clearDraft };
};
