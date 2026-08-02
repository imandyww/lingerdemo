"""Create the consent-aware family archive schema.

Revision ID: 20260801_0001
Revises:
Create Date: 2026-08-01
"""

from collections.abc import Sequence

from alembic import op
from linger_api import models  # noqa: F401
from linger_api.database import Base

revision: str = "20260801_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # create_all is intentional for the initial revision: SQLAlchemy emits only missing tables, making the
    # bootstrap safe for existing local demo databases while Alembic still records the revision normally.
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
