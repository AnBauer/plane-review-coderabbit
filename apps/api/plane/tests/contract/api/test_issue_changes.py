# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import datetime, timedelta, timezone

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, State

BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Changes Project", identifier="CP", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def state(db, workspace, project):
    return State.objects.create(name="Todo", project=project, workspace=workspace, group="backlog", default=True)


@pytest.fixture
def make_issue(db, workspace, project, state, create_user):
    def _make(minutes=0, seconds=0, **kwargs):
        kwargs.setdefault("project", project)
        kwargs.setdefault("state", state)
        issue = Issue.objects.create(name="Issue", workspace=workspace, created_by=create_user, **kwargs)
        # update() bypasses auto_now so the timestamp is deterministic
        Issue.all_objects.filter(pk=issue.pk).update(updated_at=BASE + timedelta(minutes=minutes, seconds=seconds))
        return issue

    return _make


def url(workspace, project):
    return f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/work-items/changes/"


def ids(response):
    return [str(item["id"]) for item in response.data["results"]]


def follow(client, workspace, project, since, per_page):
    """Follow every next_cursor and return all results in order."""
    results, cursor = [], None
    for _ in range(100):
        params = {"since": since, "per_page": per_page}
        if cursor:
            params["cursor"] = cursor
        response = client.get(url(workspace, project), params)
        assert response.status_code == status.HTTP_200_OK, response.data
        results.extend(response.data["results"])
        if not response.data["next_page_results"]:
            return results
        cursor = response.data["next_cursor"]
    raise AssertionError("pagination did not terminate")


@pytest.mark.contract
class TestIssueChangesFeed:
    @pytest.mark.django_db
    def test_requires_api_key(self, client, workspace, project):
        response = client.get(url(workspace, project), {"since": "2026-01-01T00:00:00Z"})
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.django_db
    @pytest.mark.parametrize("since", [None, "", "not-a-date", "2026-13-45T00:00:00Z"])
    def test_missing_or_invalid_since_is_400(self, api_key_client, workspace, project, since):
        params = {} if since is None else {"since": since}
        response = api_key_client.get(url(workspace, project), params)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_non_member_is_forbidden(self, api_key_client, workspace, project, create_user):
        ProjectMember.objects.filter(project=project, member=create_user).update(is_active=False)
        response = api_key_client.get(url(workspace, project), {"since": "2026-01-01T00:00:00Z"})
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_oldest_change_first_and_since_is_exclusive(self, api_key_client, workspace, project, make_issue):
        newest = make_issue(minutes=30)
        oldest = make_issue(minutes=10)
        boundary = make_issue(minutes=5)
        middle = make_issue(minutes=20)

        since = (BASE + timedelta(minutes=5)).isoformat()
        response = api_key_client.get(url(workspace, project), {"since": since})

        assert response.status_code == status.HTTP_200_OK
        assert ids(response) == [str(oldest.id), str(middle.id), str(newest.id)]
        assert str(boundary.id) not in ids(response)

    @pytest.mark.django_db
    def test_since_with_and_without_offset(self, api_key_client, workspace, project, make_issue):
        make_issue(minutes=60)  # 13:00 UTC

        def count(since):
            response = api_key_client.get(url(workspace, project), {"since": since})
            assert response.status_code == status.HTTP_200_OK, response.data
            return len(response.data["results"])

        # Naive timestamps are UTC
        assert count("2026-01-01T12:59:59") == 1
        assert count("2026-01-01T13:00:00") == 0
        assert count("2026-01-01T12:59:59Z") == 1
        # 14:00+02:00 is 12:00 UTC (before the change), 16:00+02:00 is 14:00 UTC (after)
        assert count("2026-01-01T14:00:00+02:00") == 1
        assert count("2026-01-01T16:00:00+02:00") == 0
        # An unescaped "+" arrives as a space
        assert count("2026-01-01T14:00:00 02:00") == 1
        assert count("2026-01-01T16:00:00 02:00") == 0

    @pytest.mark.django_db
    def test_deleted_tombstone_shape_and_order(self, api_key_client, workspace, project, make_issue):
        keep = make_issue(minutes=1)
        gone = make_issue(minutes=2)
        # Queryset soft delete does not touch updated_at, as in the app
        Issue.objects.filter(pk=gone.pk).delete()
        deleted_at = Issue.all_objects.get(pk=gone.pk).deleted_at
        assert deleted_at > BASE + timedelta(days=1)  # deleted "now", after the faked updated_at

        response = api_key_client.get(url(workspace, project), {"since": BASE.isoformat()})

        assert response.status_code == status.HTTP_200_OK
        assert ids(response) == [str(keep.id), str(gone.id)]
        tombstone = response.data["results"][1]
        assert set(tombstone.keys()) == {"id", "deleted_at"}
        assert tombstone["deleted_at"] == deleted_at
        assert "name" in response.data["results"][0]

    @pytest.mark.django_db
    def test_deletion_after_since_resurfaces_old_item(self, api_key_client, workspace, project, make_issue):
        old = make_issue(minutes=1)
        Issue.objects.filter(pk=old.pk).delete()

        response = api_key_client.get(url(workspace, project), {"since": (BASE + timedelta(hours=1)).isoformat()})

        assert [item["id"] for item in response.data["results"]] == [str(old.id)]
        assert "deleted_at" in response.data["results"][0]

    @pytest.mark.django_db
    def test_archived_items_are_included_with_archived_at(self, api_key_client, workspace, project, make_issue):
        archived = make_issue(minutes=1, archived_at=BASE.date())

        response = api_key_client.get(url(workspace, project), {"since": (BASE - timedelta(days=1)).isoformat()})

        assert ids(response) == [str(archived.id)]
        assert response.data["results"][0]["archived_at"] == BASE.date().isoformat()

    @pytest.mark.django_db
    def test_same_visibility_as_list(self, api_key_client, workspace, project, state, make_issue, create_user):
        visible = make_issue(minutes=1)
        make_issue(minutes=2, is_draft=True)
        triage = State.objects.create(name="Triage", project=project, workspace=workspace, group="triage")
        make_issue(minutes=3, state=triage)
        other = Project.objects.create(name="Other", identifier="OT", workspace=workspace, created_by=create_user)
        other_state = State.objects.create(name="Todo", project=other, workspace=workspace, group="backlog")
        make_issue(minutes=4, project=other, state=other_state)

        response = api_key_client.get(url(workspace, project), {"since": (BASE - timedelta(days=1)).isoformat()})

        assert ids(response) == [str(visible.id)]

        # Everything in a project archived after the fact disappears
        Project.objects.filter(pk=project.pk).update(archived_at=BASE)
        response = api_key_client.get(url(workspace, project), {"since": (BASE - timedelta(days=1)).isoformat()})
        assert response.status_code == status.HTTP_200_OK
        assert ids(response) == []

    @pytest.mark.django_db
    def test_deleted_draft_is_not_leaked(self, api_key_client, workspace, project, make_issue):
        draft = make_issue(minutes=1, is_draft=True)
        Issue.objects.filter(pk=draft.pk).delete()

        response = api_key_client.get(url(workspace, project), {"since": (BASE - timedelta(days=1)).isoformat()})

        assert ids(response) == []

    @pytest.mark.django_db
    def test_cursor_pagination_sees_every_change_exactly_once(self, api_key_client, workspace, project, make_issue):
        # 12 distinct timestamps plus a block of 7 sharing one timestamp, which
        # straddles page boundaries for several page sizes
        expected = [str(make_issue(minutes=i).id) for i in range(1, 13)]
        tied = [make_issue(minutes=20) for _ in range(7)]
        tied_ids = sorted(str(i.id) for i in tied)
        expected += tied_ids
        expected.append(str(make_issue(minutes=30).id))
        # and a deletion whose time is after everything else
        gone = make_issue(minutes=5)
        Issue.objects.filter(pk=gone.pk).delete()
        expected.append(str(gone.id))

        since = (BASE - timedelta(days=1)).isoformat()
        for per_page in (1, 2, 3, 5, 7, 100):
            results = follow(api_key_client, workspace, project, since, per_page)
            got = [str(item["id"]) for item in results]
            assert got == expected, f"per_page={per_page}"
            assert len(set(got)) == len(got)

    @pytest.mark.django_db
    def test_next_cursor_when_exhausted_reports_no_more(self, api_key_client, workspace, project, make_issue):
        make_issue(minutes=1)
        response = api_key_client.get(url(workspace, project), {"since": BASE.isoformat(), "per_page": 1})
        assert response.data["next_page_results"] is False
        assert response.data["total_count"] == 1

        # Resuming from the exhausted cursor yields nothing, then picks up new changes
        cursor = response.data["next_cursor"]
        again = api_key_client.get(url(workspace, project), {"since": BASE.isoformat(), "cursor": cursor})
        assert ids(again) == []
        late = make_issue(minutes=2)
        more = api_key_client.get(url(workspace, project), {"since": BASE.isoformat(), "cursor": cursor})
        assert str(late.id) in ids(more)

    @pytest.mark.django_db
    def test_invalid_cursor_is_400(self, api_key_client, workspace, project):
        for cursor in ("garbage", "1:2", "99999999999999999999999:0:0", "5:0:1"):
            response = api_key_client.get(url(workspace, project), {"since": BASE.isoformat(), "cursor": cursor})
            assert response.status_code == status.HTTP_400_BAD_REQUEST, cursor
