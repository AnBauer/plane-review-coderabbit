# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for ``IssueMoveEndpoint``
(``POST /workspaces/<slug>/projects/<project_id>/issues/<issue_id>/move/``)."""

from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    IssueSequence,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
)

MOVE_URL = "/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/move/"


def _make_project(workspace, user, name, identifier, role=20):
    project = Project.objects.create(name=name, identifier=identifier, workspace=workspace, created_by=user)
    if role is not None:
        ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=role)
    return project


def _make_state(project, name, group="unstarted", default=False):
    return State.objects.create(
        name=name, project=project, workspace=project.workspace, group=group, color="#000000", default=default
    )


def _make_issue(project, name, state=None, parent=None, **extra):
    issue = Issue(name=name, project=project, workspace=project.workspace, state=state, parent=parent, **extra)
    issue.save()
    return issue


@pytest.fixture
def source(db, workspace, create_user):
    return _make_project(workspace, create_user, "Source", "SRC")


@pytest.fixture
def target(db, workspace, create_user):
    return _make_project(workspace, create_user, "Target", "TGT")


@pytest.fixture
def states(source, target):
    return {
        "src_todo": _make_state(source, "Todo", default=True),
        "src_special": _make_state(source, "Special"),
        "tgt_todo": _make_state(target, "Todo"),
        "tgt_default": _make_state(target, "Backlog", group="backlog", default=True),
    }


def _move(client, workspace, source, issue, target_id):
    return client.post(
        MOVE_URL.format(slug=workspace.slug, project_id=source.id, issue_id=issue.id),
        {"target_project_id": str(target_id)},
        format="json",
    )


@pytest.mark.contract
class TestIssueMove:
    @pytest.mark.django_db
    def test_move_keeps_fields_and_assigns_next_sequence(self, session_client, workspace, source, target, states, create_user):
        _make_issue(target, "existing target issue", states["tgt_todo"])
        issue = _make_issue(
            source,
            "Wrong project",
            states["src_todo"],
            description_html="<p>details</p>",
            priority="high",
            start_date="2026-01-01",
            target_date="2026-02-01",
        )
        IssueAssignee.objects.create(issue=issue, assignee=create_user, project=source, workspace=workspace)
        comment = IssueComment.objects.create(
            issue=issue, comment_html="<p>c</p>", project=source, workspace=workspace, actor=create_user
        )

        response = _move(session_client, workspace, source, issue, target.id)

        assert response.status_code == status.HTTP_200_OK, response.data
        issue.refresh_from_db()
        assert issue.project_id == target.id
        assert issue.sequence_id == 2
        assert issue.name == "Wrong project"
        assert issue.description_html == "<p>details</p>"
        assert issue.priority == "high"
        assert str(issue.start_date) == "2026-01-01"
        assert str(issue.target_date) == "2026-02-01"
        assert IssueSequence.objects.filter(issue=issue, project=target, sequence=2).exists()
        assignee = IssueAssignee.objects.get(issue=issue)
        assert assignee.assignee_id == create_user.id and assignee.project_id == target.id
        comment.refresh_from_db()
        assert comment.project_id == target.id

    @pytest.mark.django_db
    def test_state_mapped_by_name_else_default(self, session_client, workspace, source, target, states):
        same_name = _make_issue(source, "same name", states["src_todo"])
        no_match = _make_issue(source, "no match", states["src_special"])

        assert _move(session_client, workspace, source, same_name, target.id).status_code == 200
        assert _move(session_client, workspace, source, no_match, target.id).status_code == 200

        same_name.refresh_from_db()
        no_match.refresh_from_db()
        assert same_name.state_id == states["tgt_todo"].id
        assert no_match.state_id == states["tgt_default"].id

    @pytest.mark.django_db
    def test_labels_mapped_by_name_and_unknown_dropped(self, session_client, workspace, source, target, states):
        src_kept = Label.objects.create(name="bug", project=source, workspace=workspace)
        src_dropped = Label.objects.create(name="only-source", project=source, workspace=workspace)
        tgt_bug = Label.objects.create(name="bug", project=target, workspace=workspace)
        issue = _make_issue(source, "labelled", states["src_todo"])
        for label in (src_kept, src_dropped):
            IssueLabel.objects.create(issue=issue, label=label, project=source, workspace=workspace)

        assert _move(session_client, workspace, source, issue, target.id).status_code == 200

        links = IssueLabel.objects.filter(issue=issue)
        assert [link.label_id for link in links] == [tgt_bug.id]
        assert links[0].project_id == target.id

    @pytest.mark.django_db
    def test_leaves_cycles_and_modules(self, session_client, workspace, create_user, source, target, states):
        issue = _make_issue(source, "planned", states["src_todo"])
        cycle = Cycle.objects.create(name="C", project=source, workspace=workspace, owned_by=create_user)
        module = Module.objects.create(name="M", project=source, workspace=workspace)
        CycleIssue.objects.create(cycle=cycle, issue=issue, project=source, workspace=workspace)
        ModuleIssue.objects.create(module=module, issue=issue, project=source, workspace=workspace)

        assert _move(session_client, workspace, source, issue, target.id).status_code == 200

        assert not CycleIssue.objects.filter(issue=issue).exists()
        assert not ModuleIssue.objects.filter(issue=issue).exists()

    @pytest.mark.django_db
    def test_sub_issues_move_with_parent(self, session_client, workspace, source, target, states):
        parent = _make_issue(source, "parent", states["src_todo"])
        child = _make_issue(source, "child", states["src_todo"], parent=parent)
        grandchild = _make_issue(source, "grandchild", states["src_todo"], parent=child)
        unrelated = _make_issue(source, "unrelated", states["src_todo"])

        assert _move(session_client, workspace, source, parent, target.id).status_code == 200

        for moved in (parent, child, grandchild):
            moved.refresh_from_db()
            assert moved.project_id == target.id
        assert {parent.sequence_id, child.sequence_id, grandchild.sequence_id} == {1, 2, 3}
        assert child.parent_id == parent.id and grandchild.parent_id == child.id
        unrelated.refresh_from_db()
        assert unrelated.project_id == source.id

    @pytest.mark.django_db
    def test_records_activity(self, session_client, workspace, source, target, states, create_user):
        issue = _make_issue(source, "activity", states["src_todo"])

        assert _move(session_client, workspace, source, issue, target.id).status_code == 200

        activity = IssueActivity.objects.get(issue=issue, field="project")
        assert activity.comment == "moved the work item from Source to Target"
        assert activity.old_value == "Source" and activity.new_value == "Target"
        assert activity.project_id == target.id
        assert activity.actor_id == create_user.id

    @pytest.mark.django_db
    def test_requires_create_permission_in_target(self, session_client, workspace, create_user, source, states):
        guest_target = _make_project(workspace, create_user, "Guest", "GST", role=5)
        no_member_target = _make_project(workspace, create_user, "Outsider", "OUT", role=None)
        issue = _make_issue(source, "stays", states["src_todo"])

        for forbidden in (guest_target, no_member_target):
            response = _move(session_client, workspace, source, issue, forbidden.id)
            assert response.status_code == status.HTTP_403_FORBIDDEN

        issue.refresh_from_db()
        assert issue.project_id == source.id

    @pytest.mark.django_db
    def test_requires_edit_permission_in_source(self, session_client, workspace, create_user, target, states):
        guest_source = _make_project(workspace, create_user, "GuestSrc", "GSR", role=5)
        issue = _make_issue(guest_source, "not mine", _make_state(guest_source, "Todo"))
        # A guest may only edit work items they created themselves.
        Issue.objects.filter(pk=issue.pk).update(created_by=None)
        # Workspace admins pass the permission check regardless of project role.
        WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=15)

        response = _move(session_client, workspace, guest_source, issue, target.id)

        assert response.status_code == status.HTTP_403_FORBIDDEN
        issue.refresh_from_db()
        assert issue.project_id == guest_source.id

    @pytest.mark.django_db
    def test_invalid_targets(self, session_client, workspace, source, states):
        issue = _make_issue(source, "x", states["src_todo"])

        assert _move(session_client, workspace, source, issue, "not-a-uuid").status_code == 400
        assert _move(session_client, workspace, source, issue, source.id).status_code == 400
        assert _move(session_client, workspace, source, issue, uuid4()).status_code == 404

    @pytest.mark.django_db
    def test_issue_from_other_project_not_found(self, session_client, workspace, source, target, states, create_user):
        other = _make_project(workspace, create_user, "Other", "OTH")
        issue = _make_issue(other, "elsewhere", _make_state(other, "Todo"))

        response = _move(session_client, workspace, source, issue, target.id)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        issue.refresh_from_db()
        assert issue.project_id == other.id
