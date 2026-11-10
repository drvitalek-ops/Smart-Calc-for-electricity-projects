"""Preserve manually renamed default layers across application startup."""
from alembic import op
import sqlalchemy as sa

revision='009'
down_revision='008'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('layers',sa.Column('seed_key',sa.String(200),nullable=True))


def downgrade():
    op.drop_column('layers','seed_key')
