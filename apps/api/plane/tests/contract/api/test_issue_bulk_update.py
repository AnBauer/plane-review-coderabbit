# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import pytest
from rest_framework import status

from plane.celery import app as celery_app
from plane.db.models import Issue, IssueAssignee, IssueLabel, Label, Project, ProjectMember, State, User


@pytest.fixture(autouse=True)
def celery_eager():
    """Run Celery tasks in-process; there is no broker in the test sandbox."""
    original_always_eager = celery_app.conf.task_always_eager
    original_eager_propagates = celery_app.conf.task_eager_propagates
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = False
    yield
    celery_app.conf.task_always_eager = original_always_eager
    celery_app.conf.task_eager_propagates = original_eager_propagates


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Test Project", identifier="TP", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def backlog_state(db, project, workspace, create_user):
    return State.objects.create(
        name="Backlog",
        color="#000000",
        group="backlog",
        default=True,
        project=project,
        workspace=workspace,
        created_by=create_user,
    )


@pytest.fixture
def done_state(db, project, workspace, create_user):
    return State.objects.create(
        name="Done",
        color="#00ff00",
        group="completed",
        project=project,
        workspace=workspace,
        created_by=create_user,
    )


@pytest.fixture
def issues(db, project, workspace, create_user, backlog_state):
    return [
        Issue.objects.create(
            name=f"Issue {i}", project=project, workspace=workspace, created_by=create_user, state=backlog_state
        )
        for i in range(3)
    ]


@pytest.fixture
def label(db, project):
    return Label.objects.create(name="Bug", project=project)


@pytest.fixture
def member_user(db, project):
    user = User.objects.create(email="member@plane.so", username="member-user")
    ProjectMember.objects.create(project=project, member=user, role=15, is_active=True)
    return user


@pytest.mark.contract
class TestIssueBulkUpdateContract:
    def get_url(self, workspace_slug, project_id):
        return f"/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/bulk-update/"

    def post(self, client, workspace, project, work_items, properties):
        return client.post(
            self.get_url(workspace.slug, project.id),
            {"work_item_ids": [str(i.id) for i in work_items], "properties": properties},
            format="json",
        )

    @pytest.mark.django_db
    def test_requires_api_key(self, api_client, workspace, project, issues):
        response = self.post(api_client, workspace, project, issues, {"priority": "high"})

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.django_db
    def test_updates_all_properties_on_all_work_items(
        self, api_key_client, workspace, project, issues, done_state, label, member_user
    ):
        response = self.post(
            api_key_client,
            workspace,
            project,
            issues,
            {
                "state_id": str(done_state.id),
                "priority": "high",
                "assignee_ids": [str(member_user.id)],
                "label_ids": [str(label.id)],
            },
        )

        assert response.status_code == status.HTTP_200_OK
        results = response.data["results"]
        assert [str(r["id"]) for r in results] == [str(i.id) for i in issues]
        for result in results:
            assert result["state"] == done_state.id
            assert result["priority"] == "high"
            assert result["assignees"] == [str(member_user.id)]
            assert result["labels"] == [str(label.id)]
        for issue in Issue.objects.filter(pk__in=[i.id for i in issues]):
            assert issue.state_id == done_state.id
            assert issue.priority == "high"
            assert issue.completed_at is not None

    @pytest.mark.django_db
    def test_only_given_properties_change(self, api_key_client, workspace, project, issues, label, backlog_state):
        issue = issues[0]
        IssueLabel.objects.create(issue=issue, label=label, project=project, workspace=workspace)

        response = self.post(api_key_client, workspace, project, [issue], {"priority": "urgent"})

        assert response.status_code == status.HTTP_200_OK
        issue.refresh_from_db()
        assert issue.priority == "urgent"
        assert issue.state_id == backlog_state.id
        assert [il.label_id for il in IssueLabel.objects.filter(issue=issue)] == [label.id]

    @pytest.mark.django_db
    def test_assignees_and_labels_replace_current_lists(
        self, api_key_client, workspace, project, issues, label, member_user, create_user
    ):
        issue = issues[0]
        old_label = Label.objects.create(name="Old", project=project)
        IssueLabel.objects.create(issue=issue, label=old_label, project=project, workspace=workspace)
        IssueAssignee.objects.create(issue=issue, assignee=create_user, project=project, workspace=workspace)

        response = self.post(
            api_key_client,
            workspace,
            project,
            [issue],
            {"assignee_ids": [str(member_user.id)], "label_ids": [str(label.id)]},
        )

        assert response.status_code == status.HTTP_200_OK
        assert [ia.assignee_id for ia in IssueAssignee.objects.filter(issue=issue)] == [member_user.id]
        assert [il.label_id for il in IssueLabel.objects.filter(issue=issue)] == [label.id]

    @pytest.mark.django_db
    def test_empty_lists_clear_assignees_and_labels(self, api_key_client, workspace, project, issues, label):
        issue = issues[0]
        IssueLabel.objects.create(issue=issue, label=label, project=project, workspace=workspace)

        response = self.post(api_key_client, workspace, project, [issue], {"label_ids": []})

        assert response.status_code == status.HTTP_200_OK
        assert list(IssueLabel.objects.filter(issue=issue)) == []

    @pytest.mark.django_db
    def test_more_than_100_work_items_is_rejected(self, api_key_client, workspace, project):
        response = api_key_client.post(
            self.get_url(workspace.slug, project.id),
            {"work_item_ids": [str(uuid.uuid4()) for _ in range(101)], "properties": {"priority": "high"}},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "work_item_ids" in response.data

    @pytest.mark.django_db
    def test_exactly_100_work_items_is_accepted(self, api_key_client, workspace, project, create_user, backlog_state):
        created = Issue.objects.bulk_create(
            [
                Issue(name=f"Bulk {i}", project=project, workspace=workspace, created_by=create_user, state=backlog_state)
                for i in range(100)
            ]
        )

        response = self.post(api_key_client, workspace, project, created, {"priority": "low"})

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 100
        assert Issue.objects.filter(project=project, priority="low").count() == 100

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "body",
        [
            {"properties": {"priority": "high"}},
            {"work_item_ids": [], "properties": {"priority": "high"}},
            {"work_item_ids": [str(uuid.uuid4())]},
            {"work_item_ids": [str(uuid.uuid4())], "properties": {}},
            {"work_item_ids": [str(uuid.uuid4())], "properties": {"priority": "bogus"}},
            {"work_item_ids": [str(uuid.uuid4())], "properties": {"name": "renamed"}},
            {"work_item_ids": ["not-a-uuid"], "properties": {"priority": "high"}},
        ],
    )
    def test_invalid_body_is_rejected(self, api_key_client, workspace, project, body):
        response = api_key_client.post(self.get_url(workspace.slug, project.id), body, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_unknown_work_item_is_404_and_nothing_changes(self, api_key_client, workspace, project, issues):
        missing = uuid.uuid4()

        response = api_key_client.post(
            self.get_url(workspace.slug, project.id),
            {"work_item_ids": [str(issues[0].id), str(missing)], "properties": {"priority": "high"}},
            format="json",
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.data["work_item_ids"] == [str(missing)]
        issues[0].refresh_from_db()
        assert issues[0].priority == "none"

    @pytest.mark.django_db
    def test_work_item_of_other_project_is_404(self, api_key_client, workspace, project, issues, create_user):
        other_project = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
        foreign = Issue.objects.create(name="Foreign", project=other_project, workspace=workspace)

        response = self.post(api_key_client, workspace, project, [issues[0], foreign], {"priority": "high"})

        assert response.status_code == status.HTTP_404_NOT_FOUND
        foreign.refresh_from_db()
        assert foreign.priority == "none"

    @pytest.mark.django_db
    def test_invalid_value_rolls_back_all_work_items(self, api_key_client, workspace, project, issues):
        outsider = User.objects.create(email="outsider@plane.so", username="outsider-user")

        response = self.post(
            api_key_client,
            workspace,
            project,
            issues,
            {"priority": "high", "assignee_ids": [str(outsider.id)]},
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Issue.objects.filter(pk__in=[i.id for i in issues], priority="high").count() == 0

    @pytest.mark.django_db
    def test_state_from_other_project_is_rejected(self, api_key_client, workspace, project, issues):
        other_project = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
        foreign_state = State.objects.create(
            name="Foreign", color="#111111", group="started", project=other_project, workspace=workspace
        )

        response = self.post(api_key_client, workspace, project, issues, {"state_id": str(foreign_state.id)})

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert Issue.objects.filter(pk__in=[i.id for i in issues], state=foreign_state).count() == 0

    @pytest.mark.django_db
    def test_label_from_other_project_is_rejected(self, api_key_client, workspace, project, issues):
        other_project = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
        foreign_label = Label.objects.create(name="Foreign", project=other_project)

        response = self.post(api_key_client, workspace, project, issues, {"label_ids": [str(foreign_label.id)]})

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert IssueLabel.objects.filter(label=foreign_label).count() == 0

    @pytest.mark.django_db
    def test_duplicate_ids_are_updated_once(self, api_key_client, workspace, project, issues):
        response = self.post(api_key_client, workspace, project, [issues[0], issues[0]], {"priority": "high"})

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1

    @pytest.mark.django_db
    def test_guest_cannot_bulk_update(self, api_key_client, workspace, project, issues, create_user):
        ProjectMember.objects.filter(project=project, member=create_user).update(role=5)

        response = self.post(api_key_client, workspace, project, issues, {"priority": "high"})

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Issue.objects.filter(pk__in=[i.id for i in issues], priority="high").count() == 0

    @pytest.mark.django_db
    def test_non_member_cannot_bulk_update(self, api_key_client, workspace, project, issues, create_user):
        ProjectMember.objects.filter(project=project, member=create_user).delete()

        response = self.post(api_key_client, workspace, project, issues, {"priority": "high"})

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert Issue.objects.filter(pk__in=[i.id for i in issues], priority="high").count() == 0

    @pytest.mark.django_db
    def test_member_role_can_bulk_update(self, api_key_client, workspace, project, issues, create_user):
        ProjectMember.objects.filter(project=project, member=create_user).update(role=15)

        response = self.post(api_key_client, workspace, project, issues, {"priority": "medium"})

        assert response.status_code == status.HTTP_200_OK
