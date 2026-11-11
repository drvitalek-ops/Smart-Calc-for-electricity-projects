"""Persist group visibility per layer without affecting quantities or export."""
from alembic import op
import sqlalchemy as sa
revision='012'
down_revision='011'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('layers',sa.Column('hidden_groups',sa.JSON(),nullable=False,server_default=sa.text("'[]'")))


def downgrade():
    op.drop_column('layers','hidden_groups')
