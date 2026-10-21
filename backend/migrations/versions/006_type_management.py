"""Persist nomenclature visibility and builtin identity across edits and restarts."""
from alembic import op
import sqlalchemy as sa

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('element_types', sa.Column('active',sa.Boolean(),nullable=False,server_default=sa.true()))
    op.add_column('element_types', sa.Column('seed_key',sa.String(500),nullable=True))


def downgrade():
    op.drop_column('element_types','seed_key')
    op.drop_column('element_types','active')
